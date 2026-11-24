import type { ListConfig } from '@opensaas/stack-core'

/**
 * `ListConfig<any>['fields']` types every field down to `BaseFieldConfig` —
 * there is no field-type union to narrow through (`FieldConfig` IS
 * `BaseFieldConfig`, root CLAUDE.md). `deriveAuthLists`/`getAuthLists` return
 * exactly that generic shape, but these tests read the relationship- and
 * scalar-specific properties the derivation actually sets at runtime.
 */
export type AnyField = ListConfig<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
  any
>['fields'][string] & {
  ref?: string
  isIndexed?: true | 'unique'
  validation?: { isRequired?: boolean }
  db?: { foreignKey?: boolean; onDelete?: string }
}

export type AnyListConfig = Omit<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
  ListConfig<any>,
  'fields'
> & { fields: Record<string, AnyField> }

export type AnyLists = Record<string, AnyListConfig>
