'use client'

import { useState } from 'react'
import { useFieldValidity, type FieldFocusTarget } from '../../lib/fieldValidity.js'

interface FieldDraft {
  text: string
  error?: string
  committedText: string
}

export interface UseFieldDraftOptions {
  name: string
  mode: 'read' | 'edit'
  /** The committed value as the control displays it. */
  committedText: string
  focusTarget: FieldFocusTarget
}

/**
 * The text a parsing field is editing, ahead of its committed value. A draft
 * that parsed gives way to the committed value on blur. One that did not stays
 * on screen, invalid, until it is corrected or the committed value changes
 * underneath it, because reverting it would leave the error describing text
 * the user can no longer see.
 */
export function useFieldDraft({ name, mode, committedText, focusTarget }: UseFieldDraftOptions) {
  const [draft, setDraft] = useState<FieldDraft | null>(null)

  if (draft?.error !== undefined && draft.committedText !== committedText) {
    setDraft(null)
  }

  useFieldValidity(name, mode === 'edit' && draft?.error !== undefined, focusTarget)

  return {
    text: draft?.text ?? committedText,
    parseError: draft?.error,
    setDraftText: (text: string, error?: string) => setDraft({ text, error, committedText }),
    endEditing: () => setDraft((current) => (current?.error === undefined ? null : current)),
  }
}
