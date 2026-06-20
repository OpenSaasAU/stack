# The generator emits Keystone-compatible schema defaults

To make Keystone → stack migrations reach Schema parity without per-project `extendPrismaSchema` surgery, the Prisma generator's default output is aligned to Keystone 6 conventions. Most of these are unconditional new defaults (acceptable to change directly while the stack is in beta); the one convention a greenfield project would not want — empty-string text defaults — is gated behind Keystone-compat mode.

## Decisions

- **Fields honour `defaultValue`.** `text()`, `integer()`, and `json()` emit `@default(...)` from their `defaultValue` in `getPrismaType` (matching how `checkbox()`/`decimal()` already behave). Previously these silently dropped the default, forcing migrators to inject it via `extendPrismaSchema`.
- **Auto-timestamps are off by default.** The generator no longer appends `createdAt`/`updatedAt` to every model. A list opts in by declaring the fields itself or via `db: { timestamps: true }`; when timestamps are enabled and the list also declares its own `createdAt`/`updatedAt`, the auto pair is skipped (no duplicate-field `P1012`). This is a breaking change to existing stack apps and is acceptable in beta.
- **Singleton `id` is bare.** Singleton lists emit `id Int @id` (no `@default(1)`), matching Keystone 6.
- **`select()` nullability is explicit.** A `select()` with a `defaultValue` keeps generating `NOT NULL` by default, but `select({ db: { isNullable: true } })` forces the nullable `?`. We chose an explicit opt-in over auto-restoring `?` so the common (required) case is unaffected.
- **Native-enum names are configurable.** `select({ db: { type: 'enum', enumName: '…' } })` sets the generated enum type name, so a live DB enum (e.g. Keystone's `…Type` suffix) can be matched from config instead of the derived `<List><Field>`.
- **Keystone-compat mode covers empty-string text defaults.** With the mode enabled, non-null text columns without an explicit `defaultValue` emit `@default("")` (Keystone's implicit behaviour). This stays opt-in because a greenfield project would not want it.

## Why this is worth recording

A future reader will look at the generator and wonder why it deliberately omits `createdAt`/`updatedAt` and the singleton `id` default that earlier versions emitted "to match Keystone 6 behaviour" — these are reversals of long-standing defaults, made specifically to keep migrations non-destructive (Schema parity). Each is a real trade-off between greenfield ergonomics and migration fidelity, and reversing any of them touches the generator, the field builders, and the migration guide together. Supersedes the narrower discussion in issues #301, #303, and #304.
