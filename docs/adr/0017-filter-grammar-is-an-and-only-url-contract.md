# Filter grammar is an AND-only URL contract

The admin UI's filter builder stores its raw query in a URL search param and executes it server-side through the secured context, so the query grammar is a public contract the moment users bookmark or share a filtered view. We deliberately committed v1 to the smallest honest grammar — tokens joined by implicit AND, quoted values for spaces (`name:"Ada Lovelace"`), comparison operators on numeric/date fields (`orders:>5`), bare words as free-text search — and rejected OR, grouping, and negation for now, because every construct we ship must parse identically forever while the rejected ones can all be added later without changing the meaning of any existing URL. Fields participate by declaring a Filter spec on the field builder itself (the same self-contained pattern as `getPrismaType` et al.); a field without one is not filterable, which is also what retires the old hard-coded `type === 'text'` search behaviour.

## Consequences

- The parser must treat unknown syntax as free text, never as an error, so future grammar additions degrade gracefully in old deployments.
- Suggestion UX is structural only (fields, operators, config-enumerated values, relationship label search) — no data-derived value suggestions, so no distinct-values endpoint exists to secure.
