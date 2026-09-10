---
'@opensaas/stack-core': minor
'@opensaas/stack-cli': minor
'@opensaas/stack-auth': minor
'@opensaas/stack-ui': minor
'@opensaas/stack-rag': minor
'@opensaas/stack-storage': minor
'@opensaas/stack-storage-vercel': minor
'@opensaas/stack-tiptap': minor
'create-opensaas-app': minor
---

Rewrite each package README against the Prisma 8 surface

The READMEs now document the API the packages actually ship, replacing the
Prisma 7 spellings that no longer resolve.

Reads compose on `context.db` keyed by the list's PascalCase config key and end
in a terminal, rather than calling a Prisma delegate:

```ts
const posts = await context.db.Post.where({ status: { equals: 'published' } })
  .orderBy({ createdAt: 'desc' })
  .limit(20)
  .all()

const post = await context.db.Post.where({ id }).first()
if (!post) return null
```

`findMany`, `findUnique`, `findFirst` and `count()` are gone; the terminals are
`all()`, `first()`, `aggregate()` and `nearest()`. A denied read is silent, so
every `first()` result is a null check.

Writes take an args object with an identity-only `where`, and a relationship is
set with `connect` or cleared with `null`:

```ts
const updated = await context.db.Post.update({
  where: { id },
  data: { title, author: { connect: { id: authorId } } },
})
```

The database config documented in each README is the one `DatabaseConfig`
carries — `provider: 'postgresql'`, `idField`, `timestamps`, `schemas`,
`extensions` and `client`. `prismaClientConstructor`, `db.url` and
`extendPrismaSchema` are gone, and the connection is resolved from the
environment rather than named in the config.

Review round two swept each README against the built `.d.ts` rather than against
another doc, and corrected what the grep-shaped sweep had missed:

- The UI README's theming block documented bare `--background`/`--primary` HSL
  triplets under a `.dark` class. The shipped contract is `--color-*` tokens in
  `oklch()`, resolved through `light-dark()` and switched by `data-theme` — the
  stylesheet's own header says the design exists "without a duplicated `.dark`
  block". Its primitives list also omitted eight real exports (`Textarea`,
  `Popover`, `Calendar`, `TimePicker`, `DateTimePicker`, `Combobox`, `Badge`,
  `Avatar`), and two samples read `config.lists` without awaiting `config`.
- The tiptap README reused a filter-returning `AccessControl` rule as
  **field-level** `access.update`. `FieldAccess` types those slots as
  boolean-returning, so that is a type error and a runtime
  `InvalidFieldAccessResultError`, not a scoped update.
- The storage README's upload route was the last copy still casting
  `formData.get(...) as string` / `as 'file' | 'image'` off a
  `FormDataEntryValue | null`.
- The auth README's Account shape named `providerId: 'credentials'`; better-auth
  1.7 uses `'credential'` for email/password, and the model carries `issuer`.
- The Vercel Blob README passed `cacheControl` to `vercelBlobStorage()`. The
  provider option is `cacheControlMaxAge` (a number of seconds);
  `VercelBlobStorageConfig` carries an index signature, so the wrong spelling
  type-checked and was silently ignored.
