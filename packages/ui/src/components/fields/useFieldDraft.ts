'use client'

import { useContext, useState } from 'react'
import {
  FieldValidityContext,
  useFieldValidity,
  type FieldFocusTarget,
} from '../../lib/fieldValidity.js'

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

/** The text a parsing field is editing, ahead of its committed value. */
export function useFieldDraft({ name, mode, committedText, focusTarget }: UseFieldDraftOptions) {
  const [draft, setDraft] = useState<FieldDraft | null>(null)
  const canRefuseSubmit = useContext(FieldValidityContext) !== null

  if (draft?.error !== undefined && draft.committedText !== committedText) {
    setDraft(null)
  }

  useFieldValidity(name, mode === 'edit' && draft?.error !== undefined, focusTarget)

  return {
    text: draft?.text ?? committedText,
    parseError: draft?.error,
    setDraftText: (text: string, error?: string) => setDraft({ text, error, committedText }),
    endEditing: () =>
      setDraft((current) => (canRefuseSubmit && current?.error !== undefined ? current : null)),
  }
}
