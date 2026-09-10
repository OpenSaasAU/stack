---
'@opensaas/stack-core': minor
'@opensaas/stack-cli': minor
'@opensaas/stack-auth': minor
'@opensaas/stack-ui': minor
'@opensaas/stack-rag': minor
'@opensaas/stack-storage': minor
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
