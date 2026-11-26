# A procedure is a named action its surfaces expose by opt-in

Status: accepted

An application wrote each domain action as a `'use server'` function that resolved the session, chose a context, read `null` as denial and invented a result shape. Those functions run only inside Next.js, so an agent needed the same action again as a custom MCP tool with an untyped input, and enabling MCP also handed an agent generated create, update and delete tools on every list it could reach (#2531).

We decided an action is a **Procedure**: a named value with a description, an input schema, an output schema, an access rule, an explicit exposure and a `run` function, defined once and called through hosts that share one pipeline.

## Identity

- **The name is the identity.** A procedure is registered under its name in an application-owned registry, and every surface addresses it by that name: one HTTP route per name, one MCP tool per name. Procedure names share one namespace with MCP tools, the generated tool names included, and a collision is to be refused when a host is created. That refusal is not in the first slice; #2535 delivers it.
- **The registry is not the config.** Procedures import SDKs and application code; the config is loaded by tooling that must never do either. The generated bundle carries a builder typed to the app's own `Context` (`.opensaas/procedures.ts`), which imports only core's builder and the bundle's types, and the application hands its registry to each host at runtime. Generation therefore never loads a procedure.
- **Lookup is by own property only**, so nothing inherited from a prototype answers to a name.
- **Who is calling is the host's to say.** A host resolves the session from its own credential and nothing in a call can supply one. The HTTP host reads a cookie session only from an allowed origin and refuses any `Authorization` header, with or without a cookie; no credential means anonymous, and the access rule decides. Every session a host builds is to carry an **Actor**, human or agent-on-behalf-of-a-human, set after claims are copied and stripped from anything incoming, with an absent actor never read as human. No host sets one yet; #2536 delivers it.

## Exposure

- **Exposure is required and never empty.** A procedure names `'web'`, `'mcp'` or both. There is no default, so a procedure reaches an agent only because its author said so.
- **An unexposed procedure is an unknown one.** A surface answers a name it does not expose exactly as it answers a name that does not exist, so names are not disclosed.
- **Access runs before the input is read and never sees it.** The HTTP host does not consume the request body for a call access refuses. Listing a procedure and calling it can then make the same decision. Only `true` admits; a procedure open to anonymous callers says so by returning `true` for a `null` session.
- **The context `run` receives is narrowed at runtime.** It is a new object carrying the secured surface, the session, storage, plugin services and `transaction`. `sudo`, the Unsafe surface, session switching, the admin's action and the engine face are absent from the value, not only from its type. List access, Field Visibility and hooks still run on every `context.db` operation. The narrowing is shallow: `context.plugins` is the application context's own registry, and a plugin service keeps whatever capabilities its plugin built it with, `sudo` included, so a procedure calling one acts with that service's privilege.
- **Output is parsed by its own schema.** A default `z.object` removes a key it does not declare before a result leaves any host, and a strict one refuses it. A schema that does neither (`z.looseObject`, `z.record`, `z.unknown`) returns whatever `run` returned; refusing such a schema when a host is created is #2535.
- **Failures have reserved codes.** `UNAUTHENTICATED`, `DENIED`, `INVALID_INPUT`, `VALIDATION`, `RETRY`, `CONFLICT` and `INTERNAL` are the stack's; over HTTP they are 401, 403, 400, 400, 409, 409 and 500. The HTTP host's transport refusals (404, 405, 413, 415) are not pipeline results and answer `{ error: "<message>" }` instead of the result envelope. Only what the existing client-safe rule admits keeps its message; anything else is `INTERNAL`, logged with the procedure's name, and its message reaches no client. A database failure other than a unique-constraint violation or a serialization failure (`RETRY`, the designed outcome of a lost race per ADR-0078), and an engine refusal of a payload the procedure itself wrote, keep their status and message and are also reported to the operator with the procedure's name. A `CONFLICT`'s `fieldErrors` are keyed by the list's field names, not by the procedure's input keys.

## Transactions and declared failures

- **`run` opens no transaction; the context offers one.** `context.transaction(fn)` is the application context's own interactive transaction (ADR-0012): it takes no options, runs at Read Committed (ADR-0042), and a nested call joins the open one. Its callback receives a context narrowed exactly as the outer one is, built over the transaction's own `db`. The row lock (`.forUpdate()`, ADR-0047) and `advisoryLock` are present; `sudo`, the Unsafe surface, session switching, the admin's action and the engine face are absent from the value. The session is the caller's throughout. Work that must not hold row locks, such as an SMS or a model call, sits outside the callback (ADR-0028).
- **The definition narrows, not the host.** A defined procedure's `access` and `run` take the application's context and build the narrowed one themselves, so a host cannot hand a procedure the unnarrowed context by leaving a step out. The builder is also the one place that knows both the context's type and its transaction context's, which lets the narrowed transaction keep the app's own typed `db` without a cast.
- **A declared failure is constructed by a helper and thrown.** A procedure declares `failures` as code and message, and `run` receives `fail`, typed to exactly those codes, so an undeclared code is a compile error. Throwing is what rolls an open transaction back; a failure returned from a transaction callback would commit the writes before it. The message a caller receives is the declared one unless the throw replaces it.
- **A failure counts only for the procedure that declares its code.** A failure constructed by another procedure's helper, or an error that merely looks like one, is an unexpected error: `INTERNAL`, redacted and reported.
- **A declared failure is 200.** It is an outcome the procedure designed, and the call was served. The reserved codes keep their statuses: `VALIDATION` is 400 with field errors, `RETRY` and `CONFLICT` are 409.
- **A reserved code cannot be declared.** It is a compile error, and a host refuses the registry when it is created. A declared code is upper-case letters, digits and `_`, refused at definition otherwise, so no declared code differs from a reserved one only by case.
- **`RETRY` reports a rollback and nothing retries.** A serialization failure is `RETRY`; every other stack-owned database error is `CONFLICT`. `RETRY` says the transaction that lost the race rolled back. It does not say that work outside the transaction was undone, so neither a host nor a client runs the call again on its own.
- **Output is parsed after `run` returns, so after any transaction it opened has committed.** Output that fails its schema is `INTERNAL` and undoes nothing. A procedure that must not commit work it cannot report checks what it will return inside the transaction.

## The MCP write default

This section records a decision that #2537 delivers; until it merges, generated MCP write tools behave as before.

Generated MCP create, update and delete tools are to default to **off**, with a list enabling each one through its own setting. The app-wide MCP default is to keep only its read key, and a config that sets a removed app-wide write key, even to `false`, is to be refused with the per-list key named rather than silently ignored. Read tools, custom tools and plugin tools stay unchanged. List access, hooks and scopes still apply to every enabled tool.

The reason is the same as exposure's: an agent should be able to do what the application opened to it, and a generic write tool beside a carefully written procedure for the same data reopens what the procedure closed. This is a breaking change; the project has no outside consumers, so no compatibility mode is planned.

## Considered Options

**Procedures in the config.** Rejected. Generation would load their SDKs and the application's runtime code, which the config is kept free of.

**A query/mutation label.** Rejected. Nothing would enforce it, and a mislabelled write would run on a read-scoped token.

**Exposure defaulting to both surfaces.** Rejected. Agent access would follow from forgetting to say anything.

**Answering an unexposed name with 403.** Rejected. It discloses that the name exists.

**Wrapping `run` in a transaction.** Rejected. Every external call a procedure makes would hold its row locks, and the author could not choose where the transaction ends.

**Returning a failure from `run`.** Rejected. Returned from a transaction callback it commits the writes before it; a throw cannot be mistaken for success.

**Parsing output inside the transaction.** Rejected. The transaction is the procedure's own and may have committed, or never existed, by the time `run` returns.

**Narrowing the context in types only.** Rejected. A cast, a plain-JavaScript caller or `engineContextOf` would reach `sudo` again.

**Accepting a bearer token on the HTTP host and preferring it to a cookie.** Rejected for this version. Mixing credentials lets an MCP token present itself as a web user; bearer authentication for mobile is later work that changes no procedure.

## Consequences

- A rule written only in a procedure is not an invariant: the admin UI and any enabled MCP write tool can change the same list. A rule that must always hold belongs in list access or a validate hook.
- Any `Authorization` header is refused, whatever its scheme. A site behind HTTP Basic auth, or behind a proxy that adds the header, gets 401 on every procedure call, anonymous ones included.
- Access is decided before the body arrives, because the body is read only once access admits the call. A caller can pass access and then send the body slowly, up to the server's request timeout, so `run` executes with a session that old.
- `run` opens no transaction of its own; one it needs is explicit, so external work can sit outside it (ADR-0028). A write made outside a transaction stays when a later step fails, a declared failure included.
- A procedure whose output fails its schema has already committed. The caller gets `INTERNAL` for work that happened.
- The first slice (#2533) ships the builder, the registry and the HTTP host. Transactions (#2534), declared failures, startup refusals for unrepresentable schemas and name collisions (#2535), the Actor (#2536), the MCP write default (#2537), MCP exposure, the in-process caller and the browser client follow in their own changes against this record.
