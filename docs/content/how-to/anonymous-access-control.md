# Access Control for Pre-Account and Anonymous Flows

A signed-in-but-not-yet-onboarded session — an anonymous Better Auth session
mid-signup, say — has a real `session.userId` but no row yet for whatever your
access rules normally key off (an `Organization`, a `Workspace`, a `Profile`).
A filter like `{ workspaceId: { equals: session.data.workspaceId } }` can't
resolve, because the thing it scopes to doesn't exist yet. The tempting
workaround is to drop to `sudo()` and re-implement ownership by hand:

```typescript
const project = await context.sudo().db.Project.where({ id: { equals: projectId } }).first()
if (project === null || project.workspaceId !== derivedWorkspaceId) {
  throw forbidden()
}
```

That `if` is a hand-rolled check, not the access layer, and it inverts Stack's
usual posture. Filter-based access **fails closed** — a session that can't
resolve its scope simply sees and writes nothing. A `sudo()` + manual-check path
**fails open**: it's only safe as long as every hand-rolled check is present and
correct, and a future edit that drops one silently becomes an IDOR, because the
manual check is the _only_ thing standing between a client-supplied id and a
privileged write.

Everything below is already available in Stack today — this page is about
which pieces to reach for, and in what order, so a pre-account flow keeps the
same fail-closed guarantee as the rest of the access layer.

## The running example

One `opensaas.config.ts`, three lists, in the shape a real signup-to-first-write
flow takes. The example assumes `authPlugin()` with its defaults — a `User`
list is the auth identity `session.userId` names (see the [Authentication
guide](/docs/how-to/authentication) if you haven't set that up yet):

- **`Workspace`** — created once, during signup. Owned by the auth identity
  via an `owner` relationship. Deliberately not named `Account`: that's the
  auth plugin's own default list for OAuth/credential accounts, and reusing
  the name collides with it the moment `authPlugin()` is in the config.
- **`Project`** — created after signup, owned indirectly through `Workspace`.
- **`Template`** — existing rows the caller picks from when creating a
  `Project`; ownership can't be forced, only checked.

The auth `User` list ships with no operation-level access by default (ADR-0013
— see [Access control: closed by
default](/docs/how-to/authentication#access-control-closed-by-default)). Every
`owner: { connect: { id: … } }` below needs self-only `query` access granted
on `User`, because a nested `connect` is gated by read access on its target
list (see [Nested `connect` is gated by the owning relationship field's
access](/docs/concepts/access-control#nested-connect-is-gated-by-the-owning-relationship-fields-access))
— without it, every `Workspace` create in this guide would be denied:

```typescript
import { config, list } from '@opensaas/stack-core'
import { text, relationship } from '@opensaas/stack-core/fields'
import { authPlugin } from '@opensaas/stack-auth'

export default config({
  plugins: [
    authPlugin({
      emailAndPassword: { enabled: true },
      access: {
        user: {
          operation: {
            query: ({ session }) => (session ? { id: { equals: session.userId } } : false),
          },
        },
      },
    }),
  ],
  db: { provider: 'postgresql' },
  lists: {
    Workspace: list({
      fields: {
        name: text({ validation: { isRequired: true } }),
        owner: relationship({ ref: 'User' }),
        projects: relationship({ ref: 'Project.workspace', many: true }),
      },
    }),
    Project: list({
      fields: {
        name: text({ validation: { isRequired: true } }),
        workspace: relationship({ ref: 'Workspace.projects' }),
        template: relationship({ ref: 'Template' }),
      },
    }),
    Template: list({
      fields: {
        name: text({ validation: { isRequired: true } }),
        workspace: relationship({ ref: 'Workspace' }),
      },
    }),
  },
})
```

## Scope by traversal from `session.userId`, not a derived session field

Key the filter off the identity the session actually carries — `userId` —
and traverse the relationship graph to reach the row you care about, rather
than keying off a field (`session.data.workspaceId`) that's only populated
once onboarding finishes.

`Workspace` owns the edge, so its foreign-key column is directly queryable —
a to-one `relationship` field named `owner` makes `ownerId` a scalar you can
filter on without a hop at all:

```typescript
Workspace: list({
  // ...
  access: {
    operation: {
      query: ({ session }) => (session ? { ownerId: { equals: session.userId } } : false),
    },
  },
}),
```

`Project` doesn't carry a `userId` column at all — it reaches the session
through `Workspace`, which means crossing a relationship. A relationship key in
a `where` takes one of exactly three quantifiers, `some`, `every` or `none`, and
that holds for a to-one edge as much as a to-many one — `some` is the spelling
for "the related row matches":

```typescript
Project: list({
  // ...
  access: {
    operation: {
      query: ({ session }) =>
        session ? { workspace: { some: { ownerId: { equals: session.userId } } } } : false,
    },
  },
}),
```

This resolves correctly **whether or not the `Workspace` row exists yet**.
Before signup completes there's no `Workspace` row with a matching
`owner.id`, so the filter matches nothing — the fail-closed outcome you want,
produced by the filter itself, no derived field required. Compare that to
keying off `session.data.workspaceId`: that field simply isn't there yet, and
the filter can't be built at all — the actual root of the problem this page
opened with. It was a session-shape choice, not a limit in the access layer.

`Template` needs the identical treatment — without a `query` rule it denies
by default, and the `validate` hook a later section adds (a scoped
`context.db.Template` lookup) would find nothing for _any_ caller, template
ownership notwithstanding:

```typescript
Template: list({
  // ...
  access: {
    operation: {
      query: ({ session }) =>
        session ? { workspace: { some: { ownerId: { equals: session.userId } } } } : false,
    },
  },
}),
```

## Deny explicitly when there's no session

Notice the pattern above is `session ? { ... } : false`, not a filter built
directly from a possibly-null `session.userId`. Returning a filter
unconditionally is the mistake to avoid.

Nothing evaluates `session.userId` for you and swaps in `false` when it's
missing. Lowering a predicate is total: a condition that resolved to `undefined`
is refused with an `UndefinedAccessFilterError`, never dropped as a clause — so
the first rule below fails the read outright rather than widening it to every
row. The second denies, which is the answer you actually wanted:

```typescript
// ❌ Refused for an anonymous caller, not scoped.
query: ({ session }) => ({ ownerId: { equals: session?.userId } })

// ✅ Deny outright when there's no session to scope to.
query: ({ session }) => (session ? { ownerId: { equals: session.userId } } : false)
```

An access rule returning a filter is scoping rows for an identity — an
anonymous caller has none to scope to, and denying is the only correct
answer. This is the same discipline the [Access Control concepts
page](/docs/concepts/access-control#common-pitfalls) already asks for
("Always Check for Session"); it's just as load-bearing here, where the
row being scoped to doesn't exist yet either.

## Force ownership on create in `resolveInput`, don't validate it

Operation-level `create` access never sees the input data — only `session`
and `context` (there's no row yet to hand back as `item`, and no `inputData`
argument on the type either). That means create access can decide **whether**
a session may create at all, but it cannot express **who owns the result**.
Ownership on create belongs in a hook that runs after access has approved the
operation, and it must **overwrite** the owner field from the session rather
than check a client-supplied one. `create` here returns a plain boolean, which
is all it may return — a filter result on `create` throws
`InvalidCreateAccessResultError` rather than being treated as an allow.

Whatever the client sent for `owner` is discarded by the spread below. That is
the whole point: a client-supplied owner id is irrelevant, not merely rejected,
because there is nothing left to reject.

```typescript
Workspace: list({
  // ...
  access: {
    operation: {
      create: ({ session }) => !!session,
    },
  },
  hooks: {
    resolveInput: ({ resolvedData, context }) => {
      const userId = context.session?.userId
      if (typeof userId !== 'string') throw new Error('Workspace create requires a session')
      return { ...resolvedData, owner: { connect: { id: userId } } }
    },
  },
}),
```

`connect` is the only relation input the FK-owning side takes, alongside a bare
`null` to clear the edge. There is no `disconnect`, and no nested create.

`Project`'s ownership is one hop further — its owner is the caller's
_workspace_, which by now exists. Look it up through the same access-scoped
`context.db` read used for querying (never `sudo()` — a scoped read that
finds nothing is itself the fail-closed signal you want), and force the
connection the same way.

`.first()` returns `null` when the read matched nothing **and** when access
denied it — one indistinguishable answer, which is exactly the fail-closed
signal. Returning `resolvedData` unchanged in that case leaves `workspace`
unset for the `validate` hook below to reject:

```typescript
Project: list({
  // ...
  access: {
    operation: {
      create: ({ session }) => !!session,
    },
  },
  hooks: {
    resolveInput: async ({ resolvedData, context }) => {
      const userId = context.session?.userId
      if (typeof userId !== 'string') throw new Error('Project create requires a session')
      const workspace = await context.db.Workspace.where({
        ownerId: { equals: userId },
      }).first()
      if (workspace === null) return resolvedData
      return { ...resolvedData, workspace: { connect: { id: workspace.id } } }
    },
  },
}),
```

Overwriting, not validating, is what makes a forged `workspace`/`owner` id in
the request body inert. A rule that instead compared the supplied id against
the session and rejected a mismatch is still trusting the client for the
_matching_ case — one dropped comparison anywhere in that logic and the check
is gone. There's no such gap here: the connect the database ends up writing
never came from the client at all.

## Use `validate` for what a hook can't force

Not every relationship has a single correct value a hook can derive from the
session — sometimes the caller is legitimately choosing among several rows
they own, and the hook's job is to confirm the choice rather than replace it.
`Project.template` is that case: the caller picks an existing `Template`, and
`resolveInput` has no session-derived value to substitute in its place. Reject
the write in `validate` instead, once the relevant rows are in hand.

`validate`'s arguments are a union over the operation, and the `delete` member
carries no `resolvedData` — narrow on `args.operation` before reaching for it:

```typescript
Project: list({
  // ...
  hooks: {
    validate: async (args) => {
      if (args.operation === 'delete') return
      const { resolvedData, context, addValidationError } = args
      if (!resolvedData.workspace) {
        addValidationError('Complete workspace setup before creating a project')
        return
      }
      const templateId = resolvedData.template?.connect?.id
      if (!templateId) return
      const template = await context.db.Template.where({
        id: { equals: templateId },
        workspace: { some: { id: { equals: resolvedData.workspace.connect.id } } },
      }).first()
      if (template === null) {
        addValidationError('Selected template does not belong to your workspace')
      }
    },
  },
}),
```

The `resolveInput` from the previous section stays alongside this `validate`;
it is elided here only to keep the hook in view.

Two failure modes are covered by the same hook, because `resolveInput` runs
first (per the [hook execution order](/docs/concepts/hooks#hook-execution-order))
and `validate` sees its result: no workspace yet (the `resolveInput` above
leaves `resolvedData.workspace` unset when the lookup fails) and a
workspace-mismatched template. Both are expressed as access-layer denials —
an `addValidationError` call, not a `sudo()` read followed by a hand-rolled
`if`.

## `context.withSession()` substitutes the session without elevating

Some steps in a pre-account flow are legitimately performed _as_ a different
identity than the one on the incoming request — most commonly, an unattended
job continuing a signup after the request that started it has already
returned. `context.withSession()` is the tool for that: it swaps the session
a derived context's access rules and hooks see, and **access control still
runs**, against the new session, exactly as if that context had been built
with that session to begin with.

The job below finishes onboarding after email verification: it holds the
now-verified session on record, but isn't running inside that user's original
request. The same `Workspace.resolveInput` shown above still forces `owner` from
`asOwner.session`, so the job cannot create a `Workspace` owned by anyone but
`job.ownerSession`. `create` returns `null` if access denies it, which is why the
caller gets `Workspace | null` back rather than a row:

```typescript
async function finishOnboarding(
  context: StackContext,
  job: { ownerSession: Session; name: string },
) {
  const asOwner = context.withSession(job.ownerSession)
  return asOwner.db.Workspace.create({ data: { name: job.name } })
}
```

**This is not an authorization.** `withSession()` doesn't grant the derived
context any capability the named session didn't already have — it can do
exactly what a context built with that session directly could do, no more.
Deciding whether `finishOnboarding` may be called at all — that the job
actually corresponds to a completed verification, say — is the caller's job,
same as it would be for any code path that ends up constructing a context
with a particular session.

That's the whole contrast with `sudo()`: `sudo()` keeps the session and drops
access control; `withSession()` keeps access control and swaps the session.
They compose (`context.withSession(s).sudo()` and `context.sudo().withSession(s)`
are equivalent), but reaching for `withSession()` where the need is really "act
as this other, legitimate identity" — not "bypass the rule" — is what keeps
`sudo()` from creeping into flows that never needed it.

## When `sudo()` is still the right call

`sudo()` bypasses **both** operation-level and field-level access control — a
`sudo()` read returns fields a normal read for that session would have
stripped, not just rows a normal read would have filtered out. It's still the
correct tool for a check that is legitimately global and never a fact about
the requesting session's own rows — for example, confirming a `Workspace`
name is unique platform-wide during signup, when the caller's own `query`
access would only ever let them see their own workspace. Only the boolean
crosses back out of the `sudo()` read — never the row itself:

```typescript
async function isWorkspaceNameTaken(context: StackContext, name: string) {
  const existing = await context.sudo().db.Workspace.where({ name: { equals: name } }).first()
  return existing !== null
}
```

`sudo()` skips access control, not validation: the Where vocabulary is still
checked, so a `startsWith` or a `mode: 'insensitive'` is refused here exactly as
it would be on an ordinary read.

The reason the patterns above are preferred whenever they apply: every
ownership check under `sudo()` is hand-rolled, and hand-rolled means
fail-open — the code above is safe today because it returns a boolean and
nothing else, but nothing stops a future edit from returning `existing`
itself, and the type system won't catch it. `sudo()`'s blast radius (every
row, every field, no exceptions) is exactly why it should be reserved for
checks that are genuinely session-independent, with the smallest possible
surface — a boolean here, not a record — crossing back out of it.

## Next steps

- **[Access Control](/docs/concepts/access-control)** — the full access-control model this page builds on
- **[Hooks System](/docs/concepts/hooks)** — `resolveInput`/`validate` execution order and arguments
- **[Context API](/docs/reference/context-api)** — `sudo()` and `withSession()` reference
- **[Authentication Guide](/docs/how-to/authentication)** — setting up the session this page assumes
