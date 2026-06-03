# Migrating from KeystoneJS

This is the canonical guide for migrating a KeystoneJS project to OpenSaaS Stack. KeystoneJS and OpenSaaS Stack share a config-first philosophy, Keystone-compliant hooks, and the same access-control shape, so most concepts map across directly.

{% callout type="info" %}
This page is the canonical entry point for Keystone migrations. The full step-by-step instructions live in the [Migration Guide](/docs/guides/migration), which covers KeystoneJS, Prisma, and Next.js sources. This page summarises the Keystone-specific parts and links to the detail.
{% /callout %}

## What maps across directly

| KeystoneJS concept                | OpenSaaS Stack equivalent                                                           |
| --------------------------------- | ----------------------------------------------------------------------------------- |
| `config({ lists })`               | `config({ lists })`                                                                 |
| `list({ fields, access, hooks })` | `list({ fields, access, hooks })`                                                   |
| Field builders (`text()`, …)      | Field builders (`text()`, …) — see [Field Types](/docs/core-concepts/field-types)   |
| Access control functions          | Access control functions — see [Access Control](/docs/core-concepts/access-control) |
| List & field hooks                | List & field hooks — see [Hooks System](/docs/core-concepts/hooks)                  |
| `context.graphql.run()`           | Fragment-based queries — see [Queries & Fragments](/docs/core-concepts/queries)     |
| GraphQL codegen (`ResultOf`)      | Built-in TypeScript inference via `ResultOf`                                        |

## Migration steps

1. **Run the migration command.** From your Keystone project root:

   ```bash
   npx @opensaas/stack-cli migrate --type keystone
   ```

   This detects your `keystone.config.ts`, counts your lists, and (with `--with-ai`) sets up Claude Code integration. See [Quick Start (AI-Assisted Migration)](/docs/guides/migration#quick-start-ai-assisted-migration).

2. **Translate your config.** Lists, fields, access control, and hooks map across with minimal changes. See [Manual Migration](/docs/guides/migration#manual-migration) and the [KeystoneJS field mapping table](/docs/guides/migration#keystonejs--opensaas).

3. **Replace `context.graphql.run`.** OpenSaaS Stack has no GraphQL layer. Replace GraphQL queries with type-safe fragments — `defineFragment`, `runQuery`/`runQueryOne`, and `ResultOf`. See [Queries & Fragments](/docs/core-concepts/queries) and [Migrating context.graphql.run](/docs/guides/migration#migrating-contextgraphqlrun).

4. **Preserve your data.** Keystone and Prisma use different many-to-many join-table naming conventions. Use `joinTableNaming: 'keystone'` or per-field `db.relationName` to keep your existing tables. See the [KeystoneJS Projects](/docs/guides/migration#keystonejs-projects) notes.

5. **Adopt auth (optional).** If your Keystone project used `@keystone-6/auth`, swap it for the [auth plugin](/docs/guides/authentication).

## Where to go next

- **[Migration Guide](/docs/guides/migration)** — the complete, step-by-step walkthrough for all project types.
- **[Queries & Fragments](/docs/core-concepts/queries)** — the `context.graphql.run` replacement (`defineFragment`, `runQuery`, `ResultOf`).
- **[Field Types](/docs/core-concepts/field-types)** — the OpenSaaS field builders.
- **[Access Control](/docs/core-concepts/access-control)** — access patterns shared with Keystone.
- **[Hooks System](/docs/core-concepts/hooks)** — Keystone-compliant hooks.

For the detailed design notes and exhaustive recipes, see the [Keystone migration spec](https://github.com/OpenSaasAU/stack/blob/main/specs/keystone-migration.md).
