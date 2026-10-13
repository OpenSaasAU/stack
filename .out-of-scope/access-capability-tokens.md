# Access capability tokens

The stack does not let an access rule, hook or caller mint a **capability**: a token, permit or intent flag that grants one operation on one exact input and thereby satisfies operation- and field-level gates the session would otherwise fail.

## Why this is out of scope

Access control in the stack is a function of the session and, for row-scoped operations, of the row. It never depends on a value the caller carries alongside the write. A capability would add a second authority path whose validity the engine cannot prove: where it was minted, whether it was consumed, and whether it is bound to this payload are all application state, held in application memory. Every such token is one leaked reference away from a bypass that no access rule can see.

The route for "this actor may create exactly this row under a permit my service holds" needs no token. Its first part works today. The other three are accepted but **not yet implemented**: until #1643, #1684 and #1686 land, field write access vetoes hook output, `access: { write: 'hooks' }` does not exist, and a write returns every field-readable column regardless of `query` access.

- Operation-level `create` access stays a boolean of the session. An input-dependent check (does this actor hold a live permit for this payload?) belongs in `resolveInput` or `validate`, where the input is in scope. `InvalidCreateAccessResultError` says the same.
- Field write access gates caller-supplied keys rather than hook output (#1643), so the list's own `resolveInput` can fill fields from the permit it consumes.
- Fields that only the system may set are marked `access: { write: 'hooks' }` (#1684), which refuses them from every caller, `sudo()` included. The caller's payload names nothing gated.
- A session that may write a row but not query it gets back only the row's system fields (#1686), so read access stays the single source of truth for what a caller sees.

The shape once all three have landed:

```ts
const Ledger = list({
  fields: {
    amount: decimal({ access: { write: 'hooks' } }),
    attributedTo: text({ access: { write: 'hooks' } }),
  },
  access: { operation: { query: isAdmin, create: ({ session }) => session !== null } },
  hooks: {
    resolveInput: async ({ operation, resolvedData, context }) => {
      if (operation !== 'create') return resolvedData
      const permit = consumePermit(context)
      if (permit === null) throw new Error('No live permit for this write')
      return { ...resolvedData, amount: permit.amount, attributedTo: 'SYSTEM' }
    },
  },
})
```

The same reasoning rejected a user-settable integrity flag on transaction owners (#1616) and trusted cross-list hook writes (#1684).

## Prior requests

- #1686 — "Write-only permit: let a permitted non-ADMIN create a row (and get its id) on an ADMIN-query-only list without sudo()"
