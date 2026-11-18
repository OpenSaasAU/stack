---
'@opensaas/stack-core': minor
'create-opensaas-app': patch
---

`opensaas generate` refuses a computed (virtual) or multi-column field keyed like another field's foreign-key or part column

Such a field used to be accepted and then win every name lookup, so the foreign-key or part column it shadowed could not be named in `where`, `orderBy` or `select`. Generate, `deriveContract` and the List member resolver now refuse it with the same message, naming the list, both fields and the fix. A stored field keyed like another field's part column, already refused, now gets the same named message (reason `part-column-collision`):

```
List "Post": fields.authorId collides with the foreign-key column "authorId" that fields.author derives for its relationship. Rename fields.authorId, or remove it and read the key through fields.author.
```

Migration: rename the virtual or multi-column field.

```ts
// Before: refused by generate
Post: list({
  fields: {
    author: relationship({ ref: 'Author' }),
    authorId: virtual({ type: 'string', hooks: { resolveOutput: () => '' } }),
  },
})

// After
Post: list({
  fields: {
    author: relationship({ ref: 'Author' }),
    authorLabel: virtual({ type: 'string', hooks: { resolveOutput: () => '' } }),
  },
})
```
