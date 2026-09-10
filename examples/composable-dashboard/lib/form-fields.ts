import type { FieldConfig } from '@opensaas/stack-core'

/**
 * The declarative half of a field config — what a form needs, and all a Client
 * Component may be handed.
 *
 * A field type is self-contained: its config carries its own methods
 * (`getZodSchema`, `getContractField`, `getFilterSpec`, …) alongside its
 * declarations, and its `hooks` and `access` rules are functions too. React
 * refuses to serialise a function across the server/client boundary, so a page
 * that hands `config.lists.Post.fields` straight to a `'use client'` component
 * fails at render. None of it is anything the form uses.
 */
export function formFields(fields: Record<string, FieldConfig>): Record<string, FieldConfig> {
  return Object.fromEntries(Object.entries(fields).map(([name, field]) => [name, formField(field)]))
}

function formField(field: FieldConfig): FieldConfig {
  const {
    getZodSchema: _getZodSchema,
    getFilterSpec: _getFilterSpec,
    getColumnNames: _getColumnNames,
    assembleColumns: _assembleColumns,
    splitColumns: _splitColumns,
    getContractField: _getContractField,
    getVectorColumn: _getVectorColumn,
    hooks: _hooks,
    access: _access,
    ...declarative
  } = field
  return declarative
}
