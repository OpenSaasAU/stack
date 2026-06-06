# OpenSaas Stack

Config-first stack for admin-heavy Next.js applications, whose defining feature is an access-control engine that automatically secures every database operation.

## Language

### Access control

**Operation-level access**:
A check that gates whether a session may perform an action (query/create/update/delete) on a list, returning either a boolean or a Prisma filter that scopes which rows are visible.
_Avoid_: list access, row access

**Field-level access**:
A check that gates whether a session may read or write a single field, returning a boolean only. Cannot scope rows — a denied field is removed, not used to exclude records.
_Avoid_: column access, property access

**Access Filter** (pre-query phase):
The first pass of a read, run before the database is hit. Uses operation-level access to build the access-scoped `include`/`where` so the database only returns rows and relations the session is allowed to see.
_Avoid_: query builder, include builder

**Field Visibility** (post-query phase):
The second pass of a read, run on the returned rows. Removes fields the session cannot read, runs `resolveOutput` hooks, and computes virtual fields.
_Avoid_: result filter, output filter, field stripper

**Silent failure**:
The convention that an access-denied operation returns `null` (single) or `[]` (many) rather than throwing, so callers cannot distinguish "denied" from "does not exist".
_Avoid_: access error, permission error

**Write Pipeline**:
The single module that runs the canonical, secured write sequence (hooks → validation → operation-level access → writable-field filtering → nested operations → persistence → after-hooks → Field Visibility) for one create/update/delete. Owns the phase order in one place; per-operation differences (target resolution, which input phases run, the database verb and returned row) are supplied by a per-operation strategy.
_Avoid_: operation handler, mutation service

**Hook Pipeline**:
The module that runs the transform+validate span of a write — list `resolveInput` → field `resolveInput` → list `validate` → field `validate` → built-in field rules — owning that order and the `resolvedData` threading through it. It throws a validation error (never silent) when a validate hook reports via `addValidationError` or a built-in field rule fails, and returns the transformed `resolvedData` on success. The Write Pipeline delegates this span to it; side-effect hooks (`beforeOperation`/`afterOperation`), access, writable-field filtering, persistence and Field Visibility stay in the Write Pipeline.
_Avoid_: validation service, input resolver

### Migration & schema generation

**Schema parity**:
The property that the generator's Prisma schema diffs clean — an empty `prisma migrate diff` in both directions — against a pre-existing (typically Keystone-generated) database, so a project can adopt the stack without a destructive migration. It is the go/no-go gate for every migration phase.
_Avoid_: schema match, clean diff, byte-compatibility

**Keystone-compat mode**:
An opt-in generator setting that makes schema output follow Keystone 6 conventions a migrating project depends on but a greenfield project would not want by default (e.g. non-null text columns defaulting to `""`). Conventions that every project wants are the plain default, not part of this mode.
_Avoid_: legacy mode, compatibility flag, migration mode

### Code generation

**Generated bundle**:
The `.opensaas/` directory the generator emits from `opensaas.config.ts` — the `getContext`/`config` factory plus the Prisma client tree. Its imports are only relative paths and npm packages, never the host app's path aliases; the bundle's own loadability in a given runtime is the stack's concern, while what the app's `opensaas.config` reaches (and so drags into the load) is the app's.
_Avoid_: generated context, output dir, .opensaas folder

### Authentication

**Auth lists**:
The user/session/account/verification lists the auth plugin derives from the better-auth config — their keys, table/column maps, and database schema all follow that config, so they can be modelled to match (adopt) pre-existing better-auth tables. Distinct from any application domain User.
_Avoid_: auth tables, auth models, auth schema

**Auth identity**:
The better-auth-owned record of who a session belongs to (the better-auth user). Separate from, and not assumed to be, the application's own domain User; an app links the two itself when it needs to.
_Avoid_: auth user, principal, account
