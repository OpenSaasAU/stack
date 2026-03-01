---
'@opensaas/stack-core': minor
'@opensaas/stack-cli': minor
---

Add `db.type: 'enum'` support to the `select` field for native database enum storage

The `select` field now supports `db.type: 'enum'` to store values as a native Prisma enum type rather than a plain string. This generates an `enum` block in the Prisma schema and uses the enum type in the model, matching Keystone 6's enum select behaviour.

```typescript
import { select } from '@opensaas/stack-core/fields'

lists: {
  Post: list({
    fields: {
      status: select({
        options: [
          { label: 'Draft', value: 'draft' },
          { label: 'Published', value: 'published' },
          { label: 'Archived', value: 'archived' },
        ],
        db: { type: 'enum' },   // generates a Prisma enum
        defaultValue: 'draft',
      }),
    },
  }),
}
```

This generates the following Prisma schema:

```prisma
enum PostStatus {
  draft
  published
  archived
}

model Post {
  id        String     @id @default(cuid())
  status    PostStatus @default(draft)
  createdAt DateTime   @default(now())
  updatedAt DateTime   @default(now()) @updatedAt
}
```

**Notes:**

- The enum name is derived from `<ListName><FieldName>` in PascalCase (e.g. `PostStatus`, `UserRole`)
- Default values use unquoted Prisma enum syntax (`@default(draft)` not `@default("draft")`)
- Enum option values must be valid Prisma identifiers: start with a letter, contain only letters, digits, and underscores (e.g. `in_progress` is valid, `in-progress` is not)
- The TypeScript union type (`'draft' | 'published'`) is generated identically to a string select field
- Omitting `db.type` or setting `db.type: 'string'` (the default) preserves the existing `String` column behaviour
