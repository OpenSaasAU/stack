---
'@opensaas/stack-core': minor
'@opensaas/stack-cli': patch
---

Field builders declare their contract contribution as a structured descriptor, and `needs` accepts stored columns

Every core field builder now carries `getContractField(fieldName, listKey, config)`, returning a `ContractFieldDescriptor`: a stored column as a pack-qualified type constructor (`{ pack, type, args }`) with native type, nullability and column mapping; for a relationship, the relation and the foreign-key column this side owns; for a virtual field, `{ kind: 'computed' }`. It sits beside the PSL-shaped `getPrismaType`/`getPrismaColumns`/`getPrismaRelation`, which keep working until core's contract derivation lands on it.

```typescript
import type { BaseFieldConfig } from '@opensaas/stack-core/extend'

export function embedding(dimensions: number): BaseFieldConfig<TypeInfo> {
  return {
    type: 'embedding',
    getContractField: (fieldName) => ({
      kind: 'column',
      name: fieldName,
      type: { pack: 'pgvector', type: 'Vector', args: [dimensions] },
      nullable: true,
    }),
    // ...getZodSchema and the rest of the builder
  }
}

text().getContractField('title', 'Post', config)
// { kind: 'column', name: 'title', type: { pack: 'pg', type: 'text' }, nullable: true }

relationship({ ref: 'User.posts' }).getContractField('author', 'Post', config)
// { kind: 'relation', target: 'User', inverse: { field: 'posts', synthetic: false }, many: false,
//   foreignKey: { name: 'authorId', map: 'author', nullable: true, unique: false, index: true,
//                 references: { list: 'User', field: 'id' } } }
```

A default that is not a JSON literal (a `Date`, a `Decimal`, a `Map`) is refused by the builder, naming the list and field, rather than silently dropped; a `bigint` default is carried as its decimal string whether written `42n`, `42` or `'42'`. A caller-supplied `outputType`/`inputType` now wins over the `select`, `password` and `calendarDay` builder defaults.

A field's TypeScript face is one pair of `TypeDescriptor` values — `outputType` (what a read returns) and `inputType` (what a write accepts) — set only where it differs from the column's codec type: `password` reads as `HashedPassword`, `select` reads and writes its option union, `calendarDay` reads and writes a `YYYY-MM-DD` string, and `virtual({ type })` keeps its spelling with `outputType` as the computed entry. A stored field that sets neither takes the codec's type.

`needs` now accepts stored-column keys as well as relations (`needs: ['lineItems', 'price']`), and `pnpm generate` refuses a `needs` on a field with no `resolveOutput` hook, naming the list and field. A declared column is honoured at runtime: under a fragment `query` that selects only the computed field, the hook's `item` still carries the column and the result still does not.

```typescript
total: virtual({
  type: 'number',
  needs: ['price', 'quantity'],
  hooks: { resolveOutput: ({ item }) => item.price * item.quantity },
})
```
