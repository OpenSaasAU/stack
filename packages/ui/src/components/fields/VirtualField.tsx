'use client'

import { FieldRoot, FieldLabel, FieldReadValue } from './field-shell.js'

export interface VirtualFieldProps {
  name: string
  value: unknown
  onChange: (value: unknown) => void
  label: string
  mode?: 'read' | 'edit'
}

/**
 * A virtual field may declare any `outputType` (e.g. `Decimal`, a plain
 * object) and crosses the server/client boundary through a JSON round-trip,
 * so a non-primitive value must be stringified rather than rendered via
 * `String()` (which would print `[object Object]`).
 */
function formatVirtualValue(value: unknown): string {
  if (value === null || value === undefined) return '-'
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value)
    } catch {
      return String(value)
    }
  }
  return String(value)
}

/**
 * Default read-only renderer for `virtual` fields (issue #821). Virtual
 * fields are computed and unwritable, so this component never offers an
 * editable control — `FieldRenderer` forces `mode: 'read'` for any field
 * config flagged `virtual`, but the component itself renders read-only
 * regardless of the `mode` it's given as defence-in-depth.
 */
export function VirtualField({ label, value }: VirtualFieldProps) {
  return (
    <FieldRoot mode="read">
      <FieldLabel muted>{label}</FieldLabel>
      <FieldReadValue>{formatVirtualValue(value)}</FieldReadValue>
    </FieldRoot>
  )
}
