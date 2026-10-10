# Hook-only fields are refused for every caller, including other lists' hooks

Status: accepted

A field declared `access: { write: 'hooks' }` is refused in any create or update whose caller `inputData` names it — a session, `sudo()`, a server action, the admin UI, MCP, or another list's hook. Only the owning list's own list-level and field-level `resolveInput` (and `defaultValue` on create) may set it. `context.unsafe` and `writePluginOwnedField` are unaffected.

## Context

`sudo()` bypasses field access, so an application needing a field only the system may change re-implemented the guard in `validate` per list (issue #1684). ADR-0075 made the field-write gate run over caller-supplied keys, so hook output is already trusted.

## Considered options

- **Refuse every caller, set it from the list's own `resolveInput` (chosen).** Nothing on a context can prove a write came from a hook, so the marker does not try to.
- **Trust writes from other lists' hooks, or capability/intent tokens.** Rejected: unprovable without a token scheme the stack does not carry.

## Consequences

- Combining `write: 'hooks'` with a field `create`/`update` rule is a type error.
- The admin form renders the field read-only and never submits it; MCP omits it from write vocabulary, so naming it is refused as an unknown name is (ADR-0053).
- A write from another list's hook must have the target list derive the value in its own `resolveInput`.
