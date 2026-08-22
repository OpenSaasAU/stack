# Access Control for Pre-Account and Anonymous Flows

A signed-in-but-not-yet-onboarded session — an anonymous Better Auth session
mid-signup, say — has a real `session.userId` but no row yet for whatever your
access rules normally key off (an `Organization`, a `Workspace`, a `Profile`).
A filter like `{ workspaceId: { equals: session.data.workspaceId } }` can't
resolve, because the thing it scopes to doesn't exist yet. The tempting
workaround is to drop to `sudo()` and re-implement ownership by hand:

```typescript
const ctx = getSudoContext(session)
const project = await ctx.db.project.findUnique({ where: { id: projectId } })
if (project?.workspace?.id !== derivedWorkspaceId) throw forbidden() // manual, not the access layer
```

This inverts Stack's usual posture. Filter-based access **fails closed** — a
session that can't resolve its scope simply sees and writes nothing. A
`sudo()` + manual-check path **fails open**: it's only safe as long as every
hand-rolled check is present and correct, and a future edit that drops one
silently becomes an IDOR, because the manual check is the _only_ thing
standing between a client-supplied id and a privileged write.

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
  // ...
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
once onboarding finishes:

```typescript
Workspace: list({
  // ...
  access: {
    operation: {
      query: ({ session }) =>
        session ? { owner: { id: { equals: session.userId } } } : false,
    },
  },
}),
```

The same traversal composes across hops. `Project` doesn't carry a `userId`
column at all — it reaches the session through `Workspace`:

```typescript
Project: list({
  // ...
  access: {
    operation: {
      query: ({ session }) =>
        session
          ? { workspace: { owner: { id: { equals: session.userId } } } }
          : false,
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
`context.db.template.findFirst(...)` lookup) would find nothing for
_any_ caller, template ownership notwithstanding:

```typescript
Template: list({
  // ...
  access: {
    operation: {
      query: ({ session }) =>
        session
          ? { workspace: { owner: { id: { equals: session.userId } } } }
          : false,
    },
  },
}),
```

## Deny explicitly when there's no session

Notice the pattern above is `session ? { ... } : false`, not a filter built
directly from a possibly-null `session.userId`. Returning a filter
unconditionally is the mistake to avoid:

```typescript
// ❌ Looks equivalent, isn't. Every access rule reasons about the shape of
// its OWN filter — nothing evaluates `session.userId` for you and swaps in
// `false` when it's missing.
query: ({ session }) => ({ owner: { id: { equals: session?.userId } } })

// ✅ Deny outright when there's no session to scope to.
query: ({ session }) => (session ? { owner: { id: { equals: session.userId } } } : false)
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
than check a client-supplied one:

```typescript
Workspace: list({
  // ...
  access: {
    operation: {
      create: ({ session }) => !!session, // may create; ownership forced below
    },
  },
  hooks: {
    resolveInput: ({ resolvedData, context }) => ({
      ...resolvedData,
      // Whatever the client sent for `owner` is discarded — this is the
      // whole point. A client-supplied owner id is irrelevant, not merely
      // rejected: there's nothing left to reject.
      owner: { connect: { id: context.session!.userId } },
    }),
  },
}),
```

`Project`'s ownership is one hop further — its owner is the caller's
_workspace_, which by now exists. Look it up through the same access-scoped
`context.db` read used for querying (never `sudo()` — a scoped read that
finds nothing is itself the fail-closed signal you want), and force the
connection the same way:

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
      const workspace = await context.db.workspace.findFirst({
        where: { owner: { id: { equals: context.session!.userId } } },
      })
      if (!workspace) return resolvedData // no workspace yet — validate below rejects it
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
the write in `validate` instead, once the relevant rows are in hand:

```typescript
Project: list({
  // ...
  hooks: {
    resolveInput: async ({ resolvedData, context }) => {
      /* ...as above... */
    },
    validate: async ({ resolvedData, context, addValidationError }) => {
      if (!resolvedData.workspace) {
        addValidationError('Complete workspace setup before creating a project')
        return
      }
      const templateId = resolvedData.template?.connect?.id
      if (!templateId) return
      const template = await context.db.template.findFirst({
        where: {
          id: { equals: templateId },
          workspace: { id: { equals: resolvedData.workspace.connect.id } },
        },
      })
      if (!template) {
        addValidationError('Selected template does not belong to your workspace')
      }
    },
  },
}),
```

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

```typescript
// A queued job finishing onboarding after email verification — it has the
// now-verified session on record, but isn't running inside that user's
// original request.
async function finishOnboarding(
  context: StackContext,
  job: { ownerSession: Session; name: string },
) {
  const asOwner = context.withSession(job.ownerSession)
  // Same Workspace.resolveInput as above forces `owner` from asOwner.session —
  // the job can't create a Workspace owned by anyone but job.ownerSession.
  return asOwner.db.workspace.create({ data: { name: job.name } })
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
access would only ever let them see their own workspace:

```typescript
async function isWorkspaceNameTaken(context: StackContext, name: string) {
  const existing = await context
    .sudo()
    .db.workspace.findFirst({ where: { name: { equals: name } } })
  return !!existing // only the boolean crosses back — never the row itself
}
```

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
