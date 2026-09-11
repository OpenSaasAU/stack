'use client'

import { useEditor, EditorContent, type JSONContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import { useEffect, useRef } from 'react'
import '../styles/tiptap.css'

export interface TiptapFieldProps {
  name: string
  value: JSONContent | null
  onChange: (value: JSONContent) => void
  label: string
  error?: string
  disabled?: boolean
  required?: boolean
  mode?: 'read' | 'edit'
  placeholder?: string
  minHeight?: number
  maxHeight?: number
}

/**
 * Tiptap rich text editor field component
 * Supports both edit and read-only modes with JSON content storage
 */
export function TiptapField({
  name,
  value,
  onChange,
  label,
  error,
  disabled,
  required,
  mode = 'edit',
  placeholder = 'Start writing...',
  minHeight = 200,
  maxHeight,
}: TiptapFieldProps) {
  const isEditable = mode === 'edit' && !disabled
  // `undefined` is the "nothing emitted yet" sentinel: `value` is
  // `JSONContent | null`, so it can never collide with a real incoming value
  // the way an initial `null` would with a form resetting the field to null.
  const lastEmitted = useRef<JSONContent | undefined>(undefined)

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: {
          levels: [1, 2, 3],
        },
      }),
      Placeholder.configure({
        placeholder,
      }),
    ],
    content: value || undefined,
    editable: isEditable,
    // Don't render immediately on the server to avoid SSR issues
    immediatelyRender: false,
    onUpdate: ({ editor }) => {
      if (!isEditable || !onChange) return
      const json = editor.getJSON()
      lastEmitted.current = json
      onChange(json)
    },
    editorProps: {
      attributes: {
        class: 'tiptap',
      },
    },
  })

  useEffect(() => {
    if (!editor) return
    // The parent handing back the very object this editor just emitted is not
    // an external change. Identity settles the keystroke path in O(1).
    if (value === lastEmitted.current) return
    // A parent that clones or normalises what it stores defeats that check, so
    // fall back to comparing serialised forms: `getJSON()` allocates a fresh
    // object every call, and re-running `setContent` on an unchanged document
    // resets it and drops the selection mid-typing.
    if (JSON.stringify(value) === JSON.stringify(editor.getJSON())) return
    // `emitUpdate` defaults to true in Tiptap v3, which would report this
    // externally-driven change back as if the user had made it — on mount with
    // a null value that writes an empty document into an untouched field.
    editor.commands.setContent(value ?? '', { emitUpdate: false })
  }, [editor, value])

  useEffect(() => {
    if (!editor) return
    // `setEditable`'s second argument is `emitUpdate`, defaulted to true: it
    // emits an `update` unconditionally, which this component would report as
    // a user edit. Changing editability is not a content change.
    editor.setEditable(isEditable, false)
  }, [editor, isEditable])

  if (mode === 'read') {
    return (
      <div className="space-y-2">
        <label className="text-sm font-medium text-foreground">{label}</label>
        <div className="tiptap-read-only">
          <EditorContent editor={editor} />
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <label htmlFor={name} className="text-sm font-medium text-foreground flex items-center gap-1">
        {label}
        {required && <span className="text-destructive">*</span>}
      </label>

      <div className={`tiptap-editor ${error ? 'border-destructive' : ''}`}>
        {isEditable && editor && (
          <div className="tiptap-toolbar">
            <button
              type="button"
              onClick={() => editor.chain().focus().toggleBold().run()}
              disabled={!editor.can().chain().focus().toggleBold().run()}
              className={editor.isActive('bold') ? 'is-active' : ''}
            >
              <strong>Bold</strong>
            </button>
            <button
              type="button"
              onClick={() => editor.chain().focus().toggleItalic().run()}
              disabled={!editor.can().chain().focus().toggleItalic().run()}
              className={editor.isActive('italic') ? 'is-active' : ''}
            >
              <em>Italic</em>
            </button>
            <button
              type="button"
              onClick={() => editor.chain().focus().toggleStrike().run()}
              disabled={!editor.can().chain().focus().toggleStrike().run()}
              className={editor.isActive('strike') ? 'is-active' : ''}
            >
              <s>Strike</s>
            </button>
            <div className="tiptap-divider" />
            <button
              type="button"
              onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
              className={editor.isActive('heading', { level: 1 }) ? 'is-active' : ''}
            >
              H1
            </button>
            <button
              type="button"
              onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
              className={editor.isActive('heading', { level: 2 }) ? 'is-active' : ''}
            >
              H2
            </button>
            <button
              type="button"
              onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
              className={editor.isActive('heading', { level: 3 }) ? 'is-active' : ''}
            >
              H3
            </button>
            <div className="tiptap-divider" />
            <button
              type="button"
              onClick={() => editor.chain().focus().toggleBulletList().run()}
              className={editor.isActive('bulletList') ? 'is-active' : ''}
            >
              Bullet List
            </button>
            <button
              type="button"
              onClick={() => editor.chain().focus().toggleOrderedList().run()}
              className={editor.isActive('orderedList') ? 'is-active' : ''}
            >
              Ordered List
            </button>
            <button
              type="button"
              onClick={() => editor.chain().focus().toggleBlockquote().run()}
              className={editor.isActive('blockquote') ? 'is-active' : ''}
            >
              Quote
            </button>
          </div>
        )}

        <div
          className={disabled ? 'opacity-50 cursor-not-allowed' : ''}
          style={{
            minHeight: `${minHeight}px`,
            maxHeight: maxHeight ? `${maxHeight}px` : undefined,
            overflowY: maxHeight ? 'auto' : undefined,
          }}
        >
          <EditorContent editor={editor} />
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  )
}
