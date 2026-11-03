---
'@opensaas/stack-cli': minor
---

Bring the CLI's MCP server onto the Prisma 8 surface

`opensaas_implement_feature` wrote a config the stack cannot load: `provider: 'sqlite'`
with a `prismaClientConstructor`, under an `@prisma/adapter-better-sqlite3` import, and
finished by telling the user to run `pnpm db:push`. The feature generator now emits the
Postgres-only block, and every instruction the server prints names a command that exists:

```typescript
// Emitted into the user's opensaas.config.ts
export default config({
  plugins: [authPlugin({ ... })],
  db: {
    provider: 'postgresql',
  },
  lists: { ... },
})
```

Next steps now read "Run `pnpm dev` — `opensaas dev` starts the Dev database, regenerates,
and reconciles it with the new schema", with `pnpm db:update` for a change held back as
destructive. `opensaas_feature_docs`, `opensaas_answer_migration`, the wizard completion
text and the validation checklist carry the same substitutions, and the migration wizard
offers `postgresql` as the only `db_provider`.

Three emitted-code bugs found by running the generator are fixed with it. The `avatar` and
`featuredImage` field entries carried a trailing `//` comment that swallowed the
comma-separator and the field after it, so the object literal did not parse. The blog
feature emitted `Post.tags` and `Tag.posts` as an implicit many-to-many, which ADR-0048
deletes and the contract validator refuses by name — both ends now point at a `PostTag`
junction list carrying a unique `db.indexes` entry over the pair. And the `file-upload`
feature placed its `image()`/`file()` entries directly in `lists`, where list declarations
belong; they now sit inside the list that owns them.

```typescript
// Emitted for a blog with Tags
Post: list({ fields: { tags: relationship({ ref: 'PostTag.post', many: true }) } }),
Tag: list({ fields: { posts: relationship({ ref: 'PostTag.tag', many: true }) } }),
PostTag: list({
  fields: {
    post: relationship({ ref: 'Post.tags' }),
    tag: relationship({ ref: 'Tag.posts' }),
  },
  db: { indexes: [{ fields: ['post', 'tag'], unique: true }] },
}),
```

A new suite generates all 13 wizard answer paths derived from the catalog. Each asserts the
result parses as TypeScript and names none of the dead surface; the 12 that declare lists
also evaluate those declarations and run them through the chain `opensaas generate` runs
before it writes anything — `validateConfigFields`, `validateNeedsDeclarations`,
`validateDatabaseConfig`, `validateRelations`, `deriveContract` — so a config the stack
refuses fails the suite rather than passing because it parsed.
