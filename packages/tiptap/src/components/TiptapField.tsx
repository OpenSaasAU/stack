'use client'

import { useEditor, EditorContent, type JSONContent } from '@tiptap/react'
import Placeholder from '@tiptap/extension-placeholder'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  defaultRichTextFeatures,
  isAllowedHref,
  richTextExtensions,
  type RichTextFeatures,
} from '../features/features.js'
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
  features?: RichTextFeatures
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
  features = defaultRichTextFeatures,
  placeholder = 'Start writing...',
  minHeight = 200,
  maxHeight,
}: TiptapFieldProps) {
  const isEditable = mode === 'edit' && !disabled
  // `undefined` is the "nothing emitted yet" sentinel: `value` is
  // `JSONContent | null`, so it can never collide with a real incoming value
  // the way an initial `null` would with a form resetting the field to null.
  const lastEmitted = useRef<JSONContent | undefined>(undefined)

  const [linkDraft, setLinkDraft] = useState<string | null>(null)
  const [linkError, setLinkError] = useState(false)
  const extensions = useMemo(
    () => [
      ...richTextExtensions(features, { editor: true }),
      Placeholder.configure({ placeholder }),
    ],
    [features, placeholder],
  )

  const editor = useEditor(
    {
      extensions,
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
    },
    [extensions],
  )

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
            {features.bold && (
              <button
                type="button"
                onClick={() => editor.chain().focus().toggleBold().run()}
                disabled={!editor.can().chain().focus().toggleBold().run()}
                className={editor.isActive('bold') ? 'is-active' : ''}
              >
                <strong>Bold</strong>
              </button>
            )}
            {features.italic && (
              <button
                type="button"
                onClick={() => editor.chain().focus().toggleItalic().run()}
                disabled={!editor.can().chain().focus().toggleItalic().run()}
                className={editor.isActive('italic') ? 'is-active' : ''}
              >
                <em>Italic</em>
              </button>
            )}
            {features.strike && (
              <button
                type="button"
                onClick={() => editor.chain().focus().toggleStrike().run()}
                disabled={!editor.can().chain().focus().toggleStrike().run()}
                className={editor.isActive('strike') ? 'is-active' : ''}
              >
                <s>Strike</s>
              </button>
            )}
            {features.underline && (
              <button
                type="button"
                onClick={() => editor.chain().focus().toggleUnderline().run()}
                className={editor.isActive('underline') ? 'is-active' : ''}
              >
                <u>Underline</u>
              </button>
            )}
            {features.code && (
              <button
                type="button"
                onClick={() => editor.chain().focus().toggleCode().run()}
                className={editor.isActive('code') ? 'is-active' : ''}
              >
                Code
              </button>
            )}
            {features.link && (
              <button
                type="button"
                onClick={() => {
                  setLinkError(false)
                  setLinkDraft(editor.getAttributes('link').href ?? '')
                }}
                className={editor.isActive('link') ? 'is-active' : ''}
              >
                Link
              </button>
            )}
            {features.heading?.levels.map((level) => (
              <button
                key={level}
                type="button"
                onClick={() => editor.chain().focus().toggleHeading({ level }).run()}
                className={editor.isActive('heading', { level }) ? 'is-active' : ''}
              >
                {`H${level}`}
              </button>
            ))}
            {features.bulletList && (
              <button
                type="button"
                onClick={() => editor.chain().focus().toggleBulletList().run()}
                className={editor.isActive('bulletList') ? 'is-active' : ''}
              >
                Bullet List
              </button>
            )}
            {features.orderedList && (
              <button
                type="button"
                onClick={() => editor.chain().focus().toggleOrderedList().run()}
                className={editor.isActive('orderedList') ? 'is-active' : ''}
              >
                Ordered List
              </button>
            )}
            {features.blockquote && (
              <button
                type="button"
                onClick={() => editor.chain().focus().toggleBlockquote().run()}
                className={editor.isActive('blockquote') ? 'is-active' : ''}
              >
                Quote
              </button>
            )}
            {features.codeBlock && (
              <button
                type="button"
                onClick={() => editor.chain().focus().toggleCodeBlock().run()}
                className={editor.isActive('codeBlock') ? 'is-active' : ''}
              >
                Code Block
              </button>
            )}
            {features.horizontalRule && (
              <button
                type="button"
                onClick={() => editor.chain().focus().setHorizontalRule().run()}
              >
                Rule
              </button>
            )}
            {features.hardBreak && (
              <button type="button" onClick={() => editor.chain().focus().setHardBreak().run()}>
                Line Break
              </button>
            )}
          </div>
        )}

        {isEditable && features.link && linkDraft !== null && (
          <div className="tiptap-link-input">
            <input
              type="text"
              aria-label="Link URL"
              value={linkDraft}
              onChange={(event) => {
                setLinkError(false)
                setLinkDraft(event.target.value)
              }}
            />
            <button
              type="button"
              onClick={() => {
                if (linkDraft.trim() === '') {
                  editor?.chain().focus().extendMarkRange('link').unsetLink().run()
                } else if (!isAllowedHref(linkDraft, features.link ?? {})) {
                  setLinkError(true)
                  return
                } else {
                  const href = linkDraft.trim()
                  if (editor?.state.selection.empty) {
                    editor
                      .chain()
                      .focus()
                      .insertContent({
                        type: 'text',
                        text: href,
                        marks: [{ type: 'link', attrs: { href } }],
                      })
                      .run()
                  } else {
                    editor?.chain().focus().extendMarkRange('link').setLink({ href }).run()
                  }
                }
                setLinkDraft(null)
              }}
            >
              Apply link
            </button>
            <button type="button" onClick={() => setLinkDraft(null)}>
              Cancel
            </button>
            {linkError && <p className="text-sm text-destructive">This link is not allowed</p>}
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
