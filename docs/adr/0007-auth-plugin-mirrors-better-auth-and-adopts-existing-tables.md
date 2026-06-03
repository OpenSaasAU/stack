# authPlugin mirrors better-auth config and its lists can adopt existing tables

`authPlugin` is a thin wrapper over better-auth: the OpenSaaS auth lists (user/session/account/verification) are **derived from the better-auth config the developer already writes** — list keys from better-auth's per-model `modelName`, table/column maps from its `fields` — rather than from a separate, stack-invented set of knobs. On top of that, the lists can be placed in a non-`public` database schema. Together this lets a project with pre-existing better-auth tables (e.g. `AuthUser`/`AuthSession`/`AuthAccount`/`AuthVerification` in an `auth` Postgres schema) adopt the plugin and reach **Schema parity** with no destructive migration.

## Decisions

- **The plugin mirrors better-auth.** List keys, table `@@map`, and field-name mappings are taken from the standard better-auth config (`modelName`, `fields`, additional fields). The plugin does not introduce a parallel `listKeys` configuration surface. `getAuthLists`/`convertBetterAuthSchema` derive the OpenSaaS lists from that config. The runtime `userListKey` (currently a hardcoded `'user'` TODO) is resolved from the configured user model.
- **Auth lists are relocatable to a schema.** A plugin-level `schema` option (with a per-list override) places the generated auth lists in a non-`public` Postgres schema via the stack's existing multi-schema support (`@@schema`).
- **"Adopt" means a clean diff, not ownership.** With keys, schema, and field shapes matching the live tables, the generated auth lists diff clean against the existing database — they are modelled for runtime and types without producing a migration. An "adopt existing better-auth tables" preset/recipe sets these defaults.
- **The app's User is separate from the auth identity.** The plugin no longer assumes its user list is the application's `User`. An app may keep its own domain `User` (keyed however it likes) distinct from the better-auth user; linking the two is the application's concern (a relationship/field it declares), not the plugin's.

## Why this is worth recording

The plugin previously hardcoded the four list keys and the `public` schema, and silently `extendList`-ed any existing `User` — which would overwrite an app's own `User` and force a destructive auth migration. A future reader will wonder why the auth lists are derived from better-auth config and freely renamable/relocatable rather than fixed; the answer is that adopting a real, pre-existing better-auth installation on a separate schema is a first-class requirement, and reversing it (re-fixing the keys/schema) would reintroduce the destructive-migration blocker. This was the key blocker reported during the migration.
