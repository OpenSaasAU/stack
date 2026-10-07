# Field write access gates caller input, not hook output

Status: accepted

Field-level `create`/`update` access is evaluated over the keys the caller supplied in `inputData`, including a foreign-key column or multi-column part column mapped back to its owning field. Keys a list-level or field-level `resolveInput` introduces or changes are trusted and persisted. A caller-supplied denied key is refused even if a hook later overwrites or removes it.

## Context

The gate ran over `resolvedData`, after `resolveInput`. A field write-denied to callers therefore could not be set by the list's own `resolveInput`, so the Keystone pattern of a hook-set `createdBy` or `status` was inexpressible and hooks have no `sudo()` (issue #1643).

## Considered options

- **Gate `inputData` keys (chosen).** Gating caller input is what prevents smuggling; hook code is application-authored and trusted.
- **Keep the veto and document it.** Rejected: the pattern stays unexpressible.

## Consequences

- A hook can write any declared field regardless of its field access; `sudo()` is unchanged.
- A `defaultValue` filled on create stays gated as before (`allowCreateDefault` still governs the exemption).
- A hook that copies a caller-supplied value into a denied field cannot launder it: the caller's own key is still gated.
