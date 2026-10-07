# A field belongs to the plugin that introduced it

Status: accepted

The plugin engine records which plugin first introduced each field key (via `addList` or `extendList`); fields declared by the application belong to the app. An `extendList` from plugin P that redeclares a field owned by a **different plugin** throws a config error naming P, the owner, the list and the field. Redeclaring an app-declared field, or P's own field, is allowed and replaces per key as before.

## Context

`extendList` merges fields as `{ ...existing.fields, ...extension.fields }`, so a later plugin silently discarded an earlier plugin's field-level `access`, hooks and options. ADR-0013 closed the operation-level equivalent; this closes the field-level one. Plugins legitimately refine fields by redeclaring them (RAG defaults `dimensions` and wires `autoGenerate` on its own and app-declared `embedding()` fields), so a blanket refusal was not an option.

## Considered options

- **Ownership guard (chosen).** Loud, no composition semantics, leaves legitimate refinement intact.
- **Deep-merge a field's `access`.** Rejected: access rules return booleans or Where conditions, composing them is surprising (same reason as ADR-0013), and it still lets a plugin alter a field it does not own.
- **Opt-out flag.** Rejected: a plugin-held flag lets the plugin re-silence the overwrite, as in ADR-0013.

## Consequences

- Ownership is engine-internal state, not exposed on the resolved config.
- Hook chaining and the operation-access refusal are unchanged.
