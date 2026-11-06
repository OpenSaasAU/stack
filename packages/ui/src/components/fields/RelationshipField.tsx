'use client'

import { ComboboxField } from './ComboboxField.js'
import { RelationshipManager } from './RelationshipManager.js'
import type { ServerActionInput } from '../../server/types.js'

export interface RelationshipFieldProps {
  name: string
  /** The control's DOM id. `FieldRenderer` supplies one unique to the form. Defaults to `name`. */
  id?: string
  value: string | string[] | null
  onChange: (value: string | string[] | null) => void
  label: string
  items: Array<{ id: string; label: string }>
  error?: string
  disabled?: boolean
  required?: boolean
  mode?: 'read' | 'edit'
  isLoading?: boolean
  helpText?: string
  many?: boolean
  relatedListKey?: string
  basePath?: string
  /** Raw list key of the list being edited — required (with `serverAction`) to live-search. */
  listKey?: string
  /** Generic server action used to resolve `relationshipOptions`. */
  serverAction?: (input: ServerActionInput) => Promise<unknown>
}

export function RelationshipField({
  name,
  id,
  value,
  onChange,
  label,
  items,
  error,
  disabled,
  required,
  mode = 'edit',
  isLoading = false,
  helpText,
  many = false,
  relatedListKey,
  basePath,
  listKey,
  serverAction,
}: RelationshipFieldProps) {
  if (many) {
    return (
      <RelationshipManager
        name={name}
        id={id}
        value={Array.isArray(value) ? value : []}
        onChange={onChange}
        label={label}
        items={items}
        error={error}
        disabled={disabled}
        required={required}
        mode={mode}
        isLoading={isLoading}
        helpText={helpText}
        relatedListKey={relatedListKey}
        basePath={basePath}
        listKey={listKey}
        serverAction={serverAction}
      />
    )
  }

  return (
    <ComboboxField
      name={name}
      id={id}
      value={typeof value === 'string' ? value : null}
      onChange={onChange}
      label={label}
      items={items}
      error={error}
      disabled={disabled}
      required={required}
      mode={mode}
      isLoading={isLoading}
      helpText={helpText}
      listKey={listKey}
      serverAction={serverAction}
    />
  )
}
