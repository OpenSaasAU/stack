---
'@opensaas/stack-core': minor
---

MCP's `tools/list` now gates its published vocabulary at field grain, per session

A field whose access rule the session alone decides — a rule that never reaches
into the row or the payload — and which denies, no longer appears in what MCP
advertises: not in the `query` tool's `fields` projection at either level, and
not in the `create`/`update` tools' `data` schemas. A rule that does reach into
the row stays advertised, because it may pass for rows the session owns.

```typescript
Memo: list({
  fields: {
    title: text(),
    // Row-independent: never advertised to a non-admin session.
    internal: text({ access: { read: () => false, update: () => false } }),
    // Row-dependent: stays advertised to everyone.
    ownerNotes: text({
      access: { read: ({ session, item }) => item?.ownerId === session?.userId },
    }),
  },
})
```

A list whose `create` needs a field the session can never write no longer
advertises a `create` tool at all, rather than offering one that refuses every
call. Naming a field the schema withheld — including a relation whose target
list this session cannot reach — is refused with the same message an unknown
field name gets, so the refusal discloses nothing the schema held back.

A field rule that throws while `tools/list` decides whether to advertise the
field costs that one field its advertisement rather than the whole listing, and
is reported on the server console. The rule still throws when the field is
actually read or written.

Classification runs per session and is not cached. No configuration is
required — the behaviour follows from the field-level access rules already in
your config.
