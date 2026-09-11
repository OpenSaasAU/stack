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

Two emitted-code bugs found by running the generator are fixed with it: the `avatar` and
`featuredImage` field entries carried a trailing `//` comment that swallowed the
comma-separator and the field after it, so the object literal did not parse. A new suite
generates every wizard answer path and asserts the result parses as TypeScript and names
none of the dead surface.
