'use client'

import { createContext, useContext, useLayoutEffect, type RefObject } from 'react'

/** What the form focuses when this field is the first invalid one. */
export type FieldFocusTarget = RefObject<{ focus: () => void } | null>

export interface FieldValidityChannel {
  /** Marks a field invalid; the returned function clears the mark. */
  markInvalid: (fieldName: string, focusTarget: FieldFocusTarget) => () => void
  /** Whether the form's last submit was refused because a field was invalid. */
  submitRefused: boolean
}

export const FieldValidityContext = createContext<FieldValidityChannel | null>(null)

/**
 * Report that a field holds input it cannot commit, so the form refuses to
 * submit. Call it on every render from a field component, with `name` being the
 * `name` prop the field received.
 *
 * The form refuses while `invalid` is true and this component is mounted, and
 * focuses `focusTarget` when this is the first invalid field. The field shows
 * its own error. Outside an item form this does nothing.
 *
 * @returns `true` once the form has refused a submit, for a field that holds an
 * error back until then.
 *
 * @example
 * ```tsx
 * const inputRef = useRef<HTMLInputElement>(null)
 * const parseError = parse(text).error
 * useFieldValidity(name, mode === 'edit' && parseError !== undefined, inputRef)
 * ```
 */
export function useFieldValidity(
  name: string,
  invalid: boolean,
  focusTarget: FieldFocusTarget,
): boolean {
  const channel = useContext(FieldValidityContext)
  const markInvalid = channel?.markInvalid

  // A layout effect, so the mark is in place before the next event can submit.
  useLayoutEffect(() => {
    if (invalid) return markInvalid?.(name, focusTarget)
  }, [markInvalid, name, invalid, focusTarget])

  return channel?.submitRefused ?? false
}
