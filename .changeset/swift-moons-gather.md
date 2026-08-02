---
'@opensaas/stack-core': patch
'@opensaas/stack-cli': patch
---

Fix `isIndexed: true` on `text`, `decimal` and `calendarDay` emitting an invalid inline `@index` attribute, producing a schema Prisma rejects with "Attribute not known: @index".
Non-unique indexes are now emitted as block-level `@@index([field])`; `isIndexed: 'unique'` is unchanged.
