---
'create-opensaas-app': minor
---

Scaffolded apps no longer read another user's drafts as an anonymous caller

`lib/actions/posts.ts` in both templates built its context as
`getContext({ userId })` from a `getPost(postId, userId?)` whose id is optional.
`getContext` stores what it is handed as `session ?? null`, so `{ userId: undefined }`
is a _signed-in_ session with no user: `Post`'s query rule took its `return true`
branch instead of the published-only filter, and an anonymous caller read drafts.

The session is now derived from the optional id in one place, so the shape cannot
be written wrongly at a call site:

```typescript
function sessionFor(userId?: string) {
  return userId ? { userId } : undefined
}

export async function getPost(postId: string, userId?: string) {
  const context = await getContext(sessionFor(userId))

  return context.db.Post.where({ id: { equals: postId } }).first()
}
```

The templates are copied from `examples/starter` and `examples/starter-auth` at
build time, which is where the fix lives.
