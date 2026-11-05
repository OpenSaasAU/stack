'use client'

import { createContext, useContext, useLayoutEffect, useState, type RefObject } from 'react'

/** What the form focuses when this field is the first invalid one. */
export type FieldFocusTarget = RefObject<{ focus: () => void } | null>

export interface FieldValidityChannel {
  /**
   * Marks a field invalid until the returned function runs. `onRefused` runs
   * each time the form refuses a submit while the mark stands.
   */
  markInvalid: (
    fieldName: string,
    focusTarget: FieldFocusTarget,
    onRefused: () => void,
  ) => () => void
}

export const FieldValidityContext = createContext<FieldValidityChannel | null>(null)

/**
 * Report that a field holds input it cannot commit, so the form refuses to
 * submit. Call it on every render from a field component, with `name` being the
 * `name` prop the field received. A field with two inputs can call it once for
 * each.
 *
 * The form refuses while `invalid` is true and this component is mounted, and
 * focuses `focusTarget`, which must be a stable ref, when this is the first
 * invalid field. The field shows its own error. Outside an item form nothing
 * refuses a submit, so this does nothing.
 *
 * @returns `true` once a submit has been refused while this call reported
 * invalid, until it stops reporting invalid, for a field that holds an error
 * back until then.
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
  const markInvalid = useContext(FieldValidityContext)?.markInvalid
  const [refused, setRefused] = useState(false)

  // A layout effect, so the mark is in place before the next event can submit.
  useLayoutEffect(() => {
    if (!invalid || !markInvalid) return
    const clearMark = markInvalid(name, focusTarget, () => setRefused(true))
    return () => {
      clearMark()
      setRefused(false)
    }
  }, [markInvalid, name, invalid, focusTarget])

  return refused
}
