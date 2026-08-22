---
'@opensaas/stack-core': minor
---

Extend `isIndexed` to `integer`, `timestamp`, and `select`, matching `text`, `decimal`, `bigInt`, `calendarDay`, and `relationship`.

```typescript
fields: {
  rank: integer({ isIndexed: true }),
  publishedAt: timestamp({ isIndexed: true }),
  status: select({
    options: [{ label: 'Draft', value: 'draft' }],
    isIndexed: 'unique',
  }),
}
```

`isIndexed: true` generates a block-level `@@index([field])`; `isIndexed: 'unique'` generates an inline `@unique`. `select` supports both under the default string column and a native-enum column (`db: { type: 'enum' }`). No field type's default indexing behavior changes — an existing config generates the same schema as before.
