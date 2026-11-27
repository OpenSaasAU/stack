# A procedure is a named action its surfaces expose by opt-in

Status: accepted

An application wrote each domain action as a `'use server'` function that resolved the session, chose a context, read `null` as denial and invented a result shape. Those functions run only inside Next.js, so an agent needed the same action again as a custom MCP tool with an untyped input, and enabling MCP also handed an agent generated create, update and delete tools on every list it could reach (#2531).

We decided an action is a **Procedure**: a named value with a description, an input schema, an output schema, an access rule, an explicit exposure and a `run` function, defined once and called through hosts that share one pipeline.

## Identity

- **The name is the identity.** A procedure is registered under its name in an application-owned registry, and every surface addresses it by that name: one HTTP route per name, one MCP tool per name. Procedure names share one namespace with MCP tools, the generated tool names included, and a collision is refused when a host is created: a name matching the reserved `list_<list>_<operation>` pattern always, whether or not that generated tool is enabled, and a name a list custom tool or a plugin-registered tool carries whenever the host is given the config. The HTTP host takes the config as an option because it has no other need of it; a host created without it checks the reserved pattern only.
- **The registry is not the config.** Procedures import SDKs and application code; the config is loaded by tooling that must never do either. The generated bundle carries a builder typed to the app's own `Context` (`.opensaas/procedures.ts`), which imports only core's builder and the bundle's types, and the application hands its registry to each host at runtime. Generation therefore never loads a procedure.
- **Lookup is by own property only**, so nothing inherited from a prototype answers to a name.
- **Who is calling is the host's to say.** A host resolves the session from its own credential and nothing in a call can supply one. The HTTP host reads a cookie session only from an allowed origin and refuses any `Authorization` header, with or without a cookie; no credential means anonymous, and the access rule decides. Every session a host builds is to carry an **Actor**, human or agent-on-behalf-of-a-human, set after claims are copied and stripped from anything incoming, with an absent actor never read as human. No host sets one yet; #2536 delivers it.

## Exposure

- **Exposure is required and never empty.** A procedure names `'web'`, `'mcp'` or both. There is no default, so a procedure reaches an agent only because its author said so.
- **An unexposed procedure is an unknown one.** A surface answers a name it does not expose exactly as it answers a name that does not exist, so names are not disclosed.
- **Access runs before the input is read and never sees it.** The HTTP host does not consume the request body for a call access refuses. Listing a procedure and calling it can then make the same decision. Only `true` admits; a procedure open to anonymous callers says so by returning `true` for a `null` session.
- **The context `run` receives is narrowed at runtime.** It is a new object carrying the secured surface, the session, storage, plugin services and `transaction`. `sudo`, the Unsafe surface, session switching, the admin's action and the engine face are absent from the value, not only from its type. List access, Field Visibility and hooks still run on every `context.db` operation. The narrowing is shallow: `context.plugins` is the application context's own registry, and a plugin service keeps whatever capabilities its plugin built it with, `sudo` included, so a procedure calling one acts with that service's privilege.
- **Output is parsed by its own schema.** A default `z.object` removes a key it does not declare before a result leaves any host, and a strict one refuses it. The open-ended shapes Zod provides, which do neither, are refused when a host is created. That is not a guarantee about every schema: a hand-written one that accepts as much, such as a recursive union of every JSON type, is not recognised and returns whatever `run` returned.
- **A schema a host cannot carry safely is refused when the host is created.** `input` must convert to JSON Schema on its input side and `output` on its output side, by Zod's own conversion, which refuses dates, bigints and output transforms. Zod converts `z.any()`, `z.unknown()`, `z.json()`, a loose object, a `z.looseRecord`, a `z.record` of `any`/`unknown` and `z.file()`, so the host refuses those itself at any depth, on both sides. `z.json()` is recognised by its structure, a lazy union of string, number, boolean, null, an array of itself and a record of itself, so a recursive schema that declares its shape is accepted. An output object with a `.catchall()` of any type is refused as well, because it returns keys the schema does not declare; an input one with a typed catchall and a `z.record` with a declared value type are accepted. One module holds the check (`procedures/validate.ts`) and every host calls it. Each refusal names the procedure, the offending part and the fix.
- **Failures have reserved codes.** `UNAUTHENTICATED`, `DENIED`, `INVALID_INPUT`, `VALIDATION`, `RETRY`, `CONFLICT` and `INTERNAL` are the stack's; over HTTP they are 401, 403, 400, 400, 409, 409 and 500. The HTTP host's transport refusals (404, 405, 413, 415) are not pipeline results and answer `{ error: "<message>" }` instead of the result envelope. Only what the existing client-safe rule admits keeps its message; anything else is `INTERNAL`, logged with the procedure's name, and its message reaches no client. A database failure other than a unique-constraint violation or a serialization failure (`RETRY`, the designed outcome of a lost race per ADR-0078), and an engine refusal of a payload the procedure itself wrote, keep their status and message and are also reported to the operator with the procedure's name. A `CONFLICT`'s `fieldErrors` are keyed by the list's field names, not by the procedure's input keys.

## Transactions and declared failures

- **`run` opens no transaction; the context offers one.** `context.transaction(fn)` is the application context's own interactive transaction (ADR-0012): it takes no options, runs at Read Committed (ADR-0042), and a nested call joins the open one. Its callback receives a context narrowed exactly as the outer one is, built over the transaction's own `db`. The row lock (`.forUpdate()`, ADR-0047) and `advisoryLock` are present; `sudo`, the Unsafe surface, session switching, the admin's action and the engine face are absent from the value. The session is the caller's throughout. Work that must not hold row locks, such as an SMS or a model call, sits outside the callback (ADR-0028).
- **The definition narrows, not the host.** A defined procedure's `access` and `run` take the application's context and build the narrowed one themselves, so a host cannot hand a procedure the unnarrowed context by leaving a step out. The builder is also the one place that knows both the context's type and its transaction context's, which lets the narrowed transaction keep the app's own typed `db` without a cast.
- **A declared failure is constructed by a helper and thrown.** A procedure declares `failures` as code and message, and `run` receives `fail`, typed to exactly those codes, so an undeclared code is a compile error. Throwing is what rolls an open transaction back, and it is the documented form. A failure returned instead, from `run` or from a transaction callback, is treated as thrown: the transaction's context throws it once the callback resolves, so the writes before it roll back and the call answers its code. The message a caller receives is the declared one unless the throw replaces it.
- **A failure counts only for the procedure whose helper constructed it.** The helper records which procedure built each failure. A failure constructed by another procedure's helper, even one declaring the same code, or an error that merely looks like one, is an unexpected error: `INTERNAL`, redacted and reported.
- **A declared failure is 200.** It is an outcome the procedure designed, and the call was served. The reserved codes keep their statuses: `VALIDATION` is 400 with field errors, `RETRY` and `CONFLICT` are 409.
- **A reserved code cannot be declared.** It is a compile error, the builder refuses it when the procedure is defined, which covers a declaration widened past the type, and a host refuses the registry when it is created. A declared code is upper-case letters, digits and `_`, refused at definition otherwise, so no declared code differs from a reserved one only by case.
- **`RETRY` reports a rollback and nothing retries.** A serialization failure is `RETRY`; every other stack-owned database error is `CONFLICT`. `RETRY` says the transaction that lost the race rolled back. It does not say that work outside the transaction was undone, so neither a host nor a client runs the call again on its own.
- **Output is parsed after `run` returns, so after any transaction it opened has committed.** Output that fails its schema is `INTERNAL` and undoes nothing. A procedure that must not commit work it cannot report checks what it will return inside the transaction.

## The browser client

- **The client is typed from the registry and imports none of it.** `createProcedureClient<typeof procedures>()` takes the registry as a type argument. Its module imports types only, apart from the reserved codes and their statuses, the host's refusal statuses and the name and declared-code patterns, which live in a module of their own that imports nothing, so client and host read one table. The registry, its schemas and whatever `run` reaches stay out of the browser bundle, and `pnpm check:client-server-graph` holds it to that as a client entry. A call names the procedure, and the name, the input and the result are inferred from it, so an unknown name or a renamed input field is a compile error. A registry type whose names are any string, an annotated one or a client created with no type argument, leaves no name callable rather than every name, so that guarantee cannot lapse silently. A name typed as a union of names is not callable either: the input one procedure requires cannot be typed for another (Zod types `z.object({})`'s input as `Record<string, never>`, so an intersection admits nothing), and the caller narrows the name first.
- **Having no schemas, the client does not parse.** The input is checked by the host and the data was parsed by the host's output schema. The client checks the shape of the envelope and nothing inside `data`.
- **A transport failure is a third outcome, returned and never thrown.** A call resolves to success, a pipeline failure, or a failure whose code is `'transport'`: the request was never sent (`unsent`: the input cannot be serialised as JSON, or the name is not one a host can serve), it was not answered (`network`), the host refused it before the pipeline (`refused`, carrying the host's message), or the answer is not the host's (`malformed`). `unsent` is its own reason because it is the one transport failure after which the call certainly did not run. The code is lower-case because a declared code cannot be, so it collides with no procedure's own and one `switch` over `error.code` is exhaustive across all three kinds.
- **Status and shape are read together.** An answer is a result only when it has the envelope's shape under the status the host gives it: success at 200, a reserved code at its own status, a code matching the declared-code pattern at 200. A refusal is `{ error }` under one of the host's refusal statuses (404, 405, 413, 415) and no other, so a gateway's 502 or 504 after the procedure ran is not reported as a call that never ran. Anything else is `malformed`, so an intermediary's error page or a JSON body from something that is not the host is never taken for a pipeline result. A success needs no `data` key, because the host emits `{ success: true }` for an output schema that accepts `undefined`, such as `z.object({ … }).optional()`.
- **The name is checked before it is sent.** A name the host's own name pattern refuses is `unsent`. Encoding it would not be enough: the URL parser reads `..` and `%2e%2e` alike as a parent segment, so the check is what keeps every call at `POST <baseUrl>/<name>`.
- **The client sends the input as given.** No input is an empty body, which the host reads as `undefined`, and the argument may be left out only when the input schema accepts `undefined`. The client never substitutes `{}`.
- **The client never retries.** Not on `RETRY`, for the reason above, and not on a `network` failure, after which the call may already have run.
- **Identity is the cookie.** The client sends no `Authorization` header and offers no way to add one. Credentials default to `same-origin`, and a host on the page's own origin needs nothing more. A host on another origin needs more than the host offers: every call is a JSON `POST`, so the browser preflights it, and the host answers `OPTIONS` with 405 and sends no `Access-Control-*` headers. The application answers the preflight and adds the CORS headers itself, in addition to listing the page's origin in `allowedOrigins` and passing `credentials: 'include'`; without them every call is `network`.

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

**A client object with a method per procedure.** Rejected. It needs a `Proxy`, which answers to every name, `then` included, so the client would be mistaken for a thenable wherever it is awaited or returned. A function taking the name is typed as precisely.

**Throwing on a transport failure.** Rejected. A thrown value is untyped at the catch site, and a caller who forgets the `try` gets an unhandled rejection in an event handler.

**A separate discriminator for transport failures.** Rejected. A second field to test before `error.code` gives two places to forget; a code no procedure can declare gives one exhaustive switch.

**Returning a failure from `run`.** Rejected. Returned from a transaction callback it commits the writes before it; a throw cannot be mistaken for success.

**Parsing output inside the transaction.** Rejected. The transaction is the procedure's own and may have committed, or never existed, by the time `run` returns.

**Narrowing the context in types only.** Rejected. A cast, a plain-JavaScript caller or `engineContextOf` would reach `sudo` again.

**Accepting a bearer token on the HTTP host and preferring it to a cookie.** Rejected for this version. Mixing credentials lets an MCP token present itself as a web user; bearer authentication for mobile is later work that changes no procedure.

## Consequences

- A rule written only in a procedure is not an invariant: the admin UI and any enabled MCP write tool can change the same list. A rule that must always hold belongs in list access or a validate hook.
- Any `Authorization` header is refused, whatever its scheme. A site behind HTTP Basic auth, or behind a proxy that adds the header, gets 401 on every procedure call, anonymous ones included.
- Access is decided before the body arrives, because the body is read only once access admits the call. A caller can pass access and then send the body slowly, up to the server's request timeout, so `run` executes with a session that old.
- `run` opens no transaction of its own; one it needs is explicit, so external work can sit outside it (ADR-0028). A write made outside a transaction stays when a later step fails, a declared failure included.
- The client's type offers every procedure in the registry, the ones not exposed to `'web'` included, because exposure is not in a procedure's type. Calling one answers a `refused` 404.
- A registry annotated as `ProcedureRegistry<Context>` loses its per-name types, and the client then has no callable name. `satisfies` keeps them.
- A name typed as a union of names must be narrowed before the call.
- The platform `fetch` follows redirects. A 307 or 308 sends the `POST` again to the new location; a 301, 302 or 303 turns it into a `GET`, which the host answers as a `refused` 405.
- A procedure whose output fails its schema has already committed. The caller gets `INTERNAL` for work that happened.
- The first slice (#2533) ships the builder, the registry and the HTTP host, #2535 the startup refusals for unrepresentable schemas and name collisions, and #2534 transactions and declared failures. The Actor (#2536), the MCP write default (#2537), MCP exposure and the in-process caller follow in their own changes against this record. The browser client is #2540.
