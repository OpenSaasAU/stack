import { describe, it, expect, vi } from 'vitest'
import { useState } from 'react'
import { render, waitFor, act } from '@testing-library/react'
import type { Editor, JSONContent } from '@tiptap/react'
import { TiptapField } from '../src/components/TiptapField.js'

/**
 * These cover the two ways this component can corrupt a form it is only
 * supposed to report on: emitting an edit nobody made, and resetting the
 * document out from under someone typing into it. Neither is visible to
 * `tsc`, to the schema-level suite next door, or to `next build` — both
 * shipped once because nothing rendered the component.
 */

// Tiptap hangs the editor off the ProseMirror DOM node, which is how a test
// drives real transactions rather than simulating keystrokes happy-dom would
// not deliver to ProseMirror anyway.
function editorFrom(container: HTMLElement): Editor {
  const dom = container.querySelector('.tiptap')
  if (!dom) throw new Error('editor did not mount')
  const editor = (dom as HTMLElement & { editor?: Editor }).editor
  if (!editor) throw new Error('editor instance not attached to the ProseMirror node')
  return editor
}

async function mounted(container: HTMLElement): Promise<Editor> {
  await waitFor(() => {
    expect(container.querySelector('.tiptap')).not.toBeNull()
  })
  return editorFrom(container)
}

const paragraph = (text: string): JSONContent => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
})

/** The admin form's shape: state in, `onChange` back out, re-render. */
function ControlledField({
  initial,
  onChange,
  mode,
}: {
  initial: JSONContent | null
  onChange?: (value: JSONContent) => void
  mode?: 'read' | 'edit'
}) {
  const [value, setValue] = useState<JSONContent | null>(initial)
  return (
    <TiptapField
      name="content"
      label="Content"
      mode={mode}
      value={value}
      onChange={(next) => {
        setValue(next)
        onChange?.(next)
      }}
    />
  )
}

describe('TiptapField', () => {
  describe('does not emit an edit nobody made', () => {
    it('emits nothing on mount with a null value', async () => {
      const onChange = vi.fn()
      const { container } = render(
        <TiptapField name="content" value={null} onChange={onChange} label="Content" />,
      )
      await mounted(container)

      expect(onChange).not.toHaveBeenCalled()
    })

    it('emits nothing on mount with an existing document', async () => {
      const onChange = vi.fn()
      const { container } = render(
        <TiptapField
          name="content"
          value={paragraph('already saved')}
          onChange={onChange}
          label="Content"
        />,
      )
      await mounted(container)

      expect(onChange).not.toHaveBeenCalled()
    })

    it('emits nothing on mount in read mode', async () => {
      const onChange = vi.fn()
      const { container } = render(
        <TiptapField name="content" value={null} onChange={onChange} label="Content" mode="read" />,
      )
      await mounted(container)

      expect(onChange).not.toHaveBeenCalled()
    })

    it('leaves an untouched optional field null rather than an empty document', async () => {
      const onChange = vi.fn()
      const { container } = render(
        <ControlledField initial={null} onChange={onChange} />, // the form's own state
      )
      await mounted(container)

      // Nothing was typed, so the form still holds `null` — not
      // `{"type":"doc","content":[{"type":"paragraph"}]}`, which is what a
      // required field would have been silently satisfied by.
      expect(onChange).not.toHaveBeenCalled()
    })

    it('emits nothing when editability changes', async () => {
      const onChange = vi.fn()
      const { container, rerender } = render(
        <TiptapField name="content" value={null} onChange={onChange} label="Content" />,
      )
      await mounted(container)

      rerender(
        <TiptapField name="content" value={null} onChange={onChange} label="Content" disabled />,
      )
      await waitFor(() => {
        expect(editorFrom(container).isEditable).toBe(false)
      })

      expect(onChange).not.toHaveBeenCalled()
    })
  })

  describe('does not reset the document while it is being edited', () => {
    it('keeps every character across the controlled round trip', async () => {
      const onChange = vi.fn()
      const { container } = render(<ControlledField initial={null} onChange={onChange} />)
      const editor = await mounted(container)

      // One transaction per character, each echoed back through React as a new
      // `value` prop — the loop that made the old identity check reset the
      // document and drop the selection on every keystroke.
      for (const char of 'hello world') {
        await act(async () => {
          editor.commands.insertContent(char)
        })
      }

      expect(editor.getText()).toBe('hello world')
      expect(onChange).toHaveBeenCalledTimes('hello world'.length)
    })

    it('dispatches no transaction of its own for the echo of a keystroke', async () => {
      const { container } = render(<ControlledField initial={null} />)
      const editor = await mounted(container)

      // A `setContent` the guard should have skipped is still a dispatched
      // transaction, so counting them separates "the document happens to end
      // up right" from "the component left it alone". Typing is one
      // transaction per character; a redundant re-set doubles the count.
      let transactions = 0
      const count = () => {
        transactions += 1
      }
      editor.on('transaction', count)

      const typed = 'hello world'
      for (const char of typed) {
        await act(async () => {
          editor.commands.insertContent(char)
        })
      }
      editor.off('transaction', count)

      expect(transactions).toBe(typed.length)
    })

    it('keeps the selection at the caret rather than resetting it to the start', async () => {
      const { container } = render(<ControlledField initial={paragraph('abc')} />)
      const editor = await mounted(container)

      await act(async () => {
        editor.commands.focus('end')
        editor.commands.insertContent('d')
      })

      expect(editor.getText()).toBe('abcd')
      // A `setContent` reset would put the head back at the document start.
      expect(editor.state.selection.head).toBe(editor.state.doc.content.size - 1)
    })

    it('still applies a genuinely external change', async () => {
      const onChange = vi.fn()
      const { container, rerender } = render(
        <TiptapField
          name="content"
          value={paragraph('from the server')}
          onChange={onChange}
          label="Content"
        />,
      )
      const editor = await mounted(container)
      expect(editor.getText()).toBe('from the server')

      rerender(
        <TiptapField
          name="content"
          value={paragraph('reloaded row')}
          onChange={onChange}
          label="Content"
        />,
      )

      await waitFor(() => {
        expect(editor.getText()).toBe('reloaded row')
      })
      // Applying it must not be reported back as if the user had typed it.
      expect(onChange).not.toHaveBeenCalled()
    })

    it('clears the document when the form resets the field to null', async () => {
      const onChange = vi.fn()
      const { container, rerender } = render(
        <TiptapField
          name="content"
          value={paragraph('draft')}
          onChange={onChange}
          label="Content"
        />,
      )
      const editor = await mounted(container)

      rerender(<TiptapField name="content" value={null} onChange={onChange} label="Content" />)

      await waitFor(() => {
        expect(editor.getText()).toBe('')
      })
      expect(onChange).not.toHaveBeenCalled()
    })
  })
})
