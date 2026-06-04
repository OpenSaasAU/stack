# Keystone → OpenSaaS Stack migration — design notes

> **This spec has been superseded by the published, canonical guide.**
>
> The complete, maintained Keystone → OpenSaaS Stack migration guide now lives in the docs and is the single source of truth:
>
> - **Published guide:** <https://stack.opensaas.au/docs/guides/migrating-from-keystone>
> - **Source:** [`docs/content/guides/migrating-from-keystone.md`](../docs/content/guides/migrating-from-keystone.md)
>
> The recipes that previously lived here (config translation, field-type / hook /
> access mapping, `context.graphql.run` → `context.db.*` with fragments, M2M
> join-table naming, and auth) have been folded into that guide and kept
> consistent with the shipped Area A–E behaviour. Edit the published guide, not
> this file.

## Scope of this note

This file is retained only as a pointer plus a map of where each migration topic
is now maintained, so older references resolve and design discussion has a home.

| Topic                                           | Now lives in                                                                                                                                                                                                            |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Config translation, field/hook/access mapping   | [Canonical guide §1–§7](https://stack.opensaas.au/docs/guides/migrating-from-keystone)                                                                                                                                  |
| Generator parity (Area A)                       | [Canonical guide §3](https://stack.opensaas.au/docs/guides/migrating-from-keystone) · [ADR-0004](../docs/adr/0004-generator-emits-keystone-compatible-defaults.md)                                                      |
| `context.graphql.run` → `context.db.*` (Area B) | [Queries & Fragments](https://stack.opensaas.au/docs/core-concepts/queries) · `migrate-context-calls` skill · [ADR-0005](../docs/adr/0005-no-graphql-layer-migrate-via-fragments.md)                                    |
| Image / file migration (Area C)                 | [Keystone Image & File Field Migration guide](./keystone-image-migration.md) · [ADR-0006](../docs/adr/0006-image-file-migration-prefers-multi-column-parity.md)                                                         |
| Auth adoption (Area D)                          | [Authentication guide](https://stack.opensaas.au/docs/guides/authentication#adopting-an-existing-better-auth-installation) · [ADR-0007](../docs/adr/0007-auth-plugin-mirrors-better-auth-and-adopts-existing-tables.md) |
| Configurable output paths (Area E)              | [Canonical guide §11](https://stack.opensaas.au/docs/guides/migrating-from-keystone)                                                                                                                                    |
