---
'@opensaas/stack-cli': minor
---

Singleton lists now emit a bare `id Int @id` (no `@default(1)`) to match Keystone 6, so singletons reach Schema parity from config alone instead of needing `extendPrismaSchema` to strip the column default (see ADR-0004).

```ts
lists: {
  Settings: list({
    isSingleton: true,
    fields: { siteName: text() },
  }),
}
```

Generated Prisma schema:

```prisma
model Settings {
  id        Int      @id
  siteName  String
}
```

Non-singleton lists are unaffected and continue to emit `id String @id @default(cuid())`.
