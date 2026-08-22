---
'@opensaas/stack-core': minor
'@opensaas/stack-cli': minor
---

Add `context.withSession(session)` — a sibling to `sudo()` for the other axis. It derives a `StackContext` that reuses the receiver's already-resolved config, client (including a transaction client — a call inside `context.transaction()` stays in that transaction), and storage, but carries a substituted session, so access control and hooks run against the new session as normal.

This closes a gap for callers that are legitimately authorised but arrive without the session a list `validate` hook expects — an unattended dispatcher, a service principal, or a job runner:

```typescript
// Runs with the job owner's session so hooks see the right identity, while
// still going through the normal access control checks for that session.
const asOwner = context.withSession(job.ownerSession)
await asOwner.db.task.update({ where: { id: job.taskId }, data: { status: 'done' } })

// Drop to anonymous
const anonymous = context.withSession(null)
```

`withSession` grants no authority of its own — the derived context can do exactly what any context built with that session directly could do. It's orthogonal to `sudo()`: `context.withSession(s).sudo()` and `context.sudo().withSession(s)` are equivalent, since `withSession` preserves the receiver's sudo state instead of resetting it.

The generated `Context<TSession>` type (`.opensaas/types.ts`) now includes `withSession: (session: TSession | null) => Context<TSession>` alongside `sudo`, so the method is typed in application code — run `opensaas generate` (or `pnpm generate`) to pick it up.
