# A procedure is a named action its surfaces expose by opt-in

Status: accepted

An application wrote each domain action as a `'use server'` function that resolved the session, chose a context, read `null` as denial and invented a result shape. Those functions run only inside Next.js, so an agent needed the same action again as a custom MCP tool with an untyped input, and enabling MCP also handed an agent generated create, update and delete tools on every list it could reach (#2531).

We decided an action is a **Procedure**: a named value with a description, an input schema, an output schema, an access rule, an explicit exposure and a `run` function, defined once and called through hosts that share one pipeline.

## Identity

- **The name is the identity.** A procedure is registered under its name in an application-owned registry, and every surface addresses it by that name: one HTTP route per name, one MCP tool per name. Procedure names share one namespace with MCP tools, the generated tool names included, and a collision is refused when a host is created: a name matching the reserved `list_<list>_<operation>` pattern always, whether or not that generated tool is enabled, and a name a list custom tool or a plugin-registered tool carries whenever the host is given the config. The HTTP host takes the config as an option because it has no other need of it; a host created without it checks the reserved pattern only.
- **The registry is not the config.** Procedures import SDKs and application code; the config is loaded by tooling that must never do either. The generated bundle carries a builder typed to the app's own `Context` (`.opensaas/procedures.ts`), which imports only core's builder and the bundle's types, and the application hands its registry to each host at runtime. Generation therefore never loads a procedure.
- **Lookup is by own property only**, so nothing inherited from a prototype answers to a name.
- **Who is calling is the host's to say.** A host resolves the session from its own credential and nothing in a call can supply one. The HTTP host reads a cookie session only from an allowed origin and refuses any `Authorization` header, with or without a cookie; no credential means anonymous, and the access rule decides. Every session a host builds carries an **Actor** under the reserved `actor` key, put in place of whatever a session provider, a token claim or `getSession` supplied under that name. Only a host mints one: core records the actor objects it creates and the context factory strips any other `actor` before a session reaches a rule, a hook or a transaction, so application code that spreads untrusted input into `getContext` or `withSession` cannot forge one, and the session a context carries is a frozen copy. The HTTP host sets `{ kind: 'human', userId, via: 'web' }` from the session's own `userId`, a non-empty string or a finite number carried as given, and fails the call with `INTERNAL` otherwise. The MCP handler sets `{ kind: 'agent', clientId, onBehalfOf, via: 'mcp' }`, and the session keeps the user's `userId`, so existing rules scope an agent as the user it acts for. The client id is not a claim: an MCP session provider returns it as `McpSession.clientId`, apart from the fields that flow into the session, and the handler answers `500` when it is missing or empty, since a session that is present but unusable is the server's misconfiguration and `401` would send the client back to re-authorize for nothing. A context built outside the handler gets the same agent session from `mcpContextSession`. The better-auth adapter reads it from the verified token's `azp`, which better-auth's OAuth provider writes after the application's custom claims, and refuses a token without one. An absent actor is never read as human, so a session no host built (a server component's `getContext(session)`, a job runner's `withSession`) fails a rule that asks for a human. There is no system actor: a rule written `session !== null` to mean a signed-in user would admit one.

## Exposure

- **Exposure is required and never empty.** A procedure names `'web'`, `'mcp'` or both. There is no default, so a procedure reaches an agent only because its author said so.
- **An unexposed procedure is an unknown one.** A surface answers a name it does not expose exactly as it answers a name that does not exist, so names are not disclosed.
- **Access runs before the input is read and never sees it.** The HTTP host does not consume the request body for a call access refuses. Listing a procedure and calling it can then make the same decision. Only `true` admits; a procedure open to anonymous callers says so by returning `true` for a `null` session.
- **The context `run` receives is narrowed at runtime.** It is a new object carrying the secured surface, the session, storage and plugin services. `sudo`, the Unsafe surface, session switching, the admin's action and the engine face are absent from the value, not only from its type. List access, Field Visibility and hooks still run on every `context.db` operation. The narrowing is shallow: `context.plugins` is the application context's own registry, and a plugin service keeps whatever capabilities its plugin built it with, `sudo` included, so a procedure calling one acts with that service's privilege.
- **Output is parsed by its own schema.** A default `z.object` removes a key it does not declare before a result leaves any host, and a strict one refuses it. The open-ended shapes Zod provides, which do neither, are refused when a host is created. That is not a guarantee about every schema: a hand-written one that accepts as much, such as a recursive union of every JSON type, is not recognised and returns whatever `run` returned.
- **A schema a host cannot carry safely is refused when the host is created.** `input` must convert to JSON Schema on its input side and `output` on its output side, by Zod's own conversion, which refuses dates, bigints and output transforms. Zod converts `z.any()`, `z.unknown()`, `z.json()`, a loose object, a `z.looseRecord`, a `z.record` of `any`/`unknown` and `z.file()`, so the host refuses those itself at any depth, on both sides. `z.json()` is recognised by its structure, a lazy union of string, number, boolean, null, an array of itself and a record of itself, so a recursive schema that declares its shape is accepted. An output object with a `.catchall()` of any type is refused as well, because it returns keys the schema does not declare; an input one with a typed catchall and a `z.record` with a declared value type are accepted. One module holds the check (`procedures/validate.ts`) and every host calls it. Each refusal names the procedure, the offending part and the fix.
- **Failures have reserved codes.** `UNAUTHENTICATED`, `DENIED`, `INVALID_INPUT`, `VALIDATION`, `RETRY`, `CONFLICT` and `INTERNAL` are the stack's; over HTTP they are 401, 403, 400, 400, 409, 409 and 500. The HTTP host's transport refusals (404, 405, 413, 415) are not pipeline results and answer `{ error: "<message>" }` instead of the result envelope. Only what the existing client-safe rule admits keeps its message; anything else is `INTERNAL`, logged with the procedure's name, and its message reaches no client. A database failure other than a unique-constraint violation or a serialization failure (`RETRY`, the designed outcome of a lost race per ADR-0078), and an engine refusal of a payload the procedure itself wrote, keep their status and message and are also reported to the operator with the procedure's name. A `CONFLICT`'s `fieldErrors` are keyed by the list's field names, not by the procedure's input keys.

## The MCP write default

This section records a decision that #2537 delivers; until it merges, generated MCP write tools behave as before.

Generated MCP create, update and delete tools are to default to **off**, with a list enabling each one through its own setting. The app-wide MCP default is to keep only its read key, and a config that sets a removed app-wide write key, even to `false`, is to be refused with the per-list key named rather than silently ignored. Read tools, custom tools and plugin tools stay unchanged. List access, hooks and scopes still apply to every enabled tool.

The reason is the same as exposure's: an agent should be able to do what the application opened to it, and a generic write tool beside a carefully written procedure for the same data reopens what the procedure closed. This is a breaking change; the project has no outside consumers, so no compatibility mode is planned.

## Considered Options

**Procedures in the config.** Rejected. Generation would load their SDKs and the application's runtime code, which the config is kept free of.

**A query/mutation label.** Rejected. Nothing would enforce it, and a mislabelled write would run on a read-scoped token.

**Exposure defaulting to both surfaces.** Rejected. Agent access would follow from forgetting to say anything.

**Answering an unexposed name with 403.** Rejected. It discloses that the name exists.

**Narrowing the context in types only.** Rejected. A cast, a plain-JavaScript caller or `engineContextOf` would reach `sudo` again.

**Accepting a bearer token on the HTTP host and preferring it to a cookie.** Rejected for this version. Mixing credentials lets an MCP token present itself as a web user; bearer authentication for mobile is later work that changes no procedure.

## Consequences

- A rule written only in a procedure is not an invariant: the admin UI and any enabled MCP write tool can change the same list. A rule that must always hold belongs in list access or a validate hook.
- Any `Authorization` header is refused, whatever its scheme. A site behind HTTP Basic auth, or behind a proxy that adds the header, gets 401 on every procedure call, anonymous ones included.
- Access is decided before the body arrives, because the body is read only once access admits the call. A caller can pass access and then send the body slowly, up to the server's request timeout, so `run` executes with a session that old.
- `run` opens no transaction of its own; one it needs is explicit, so external work can sit outside it (ADR-0028).
- The first slice (#2533) ships the builder, the registry and the HTTP host, #2535 the startup refusals for unrepresentable schemas and name collisions, and #2536 the Actor. Transactions (#2534), declared failures, the MCP write default (#2537), MCP exposure, the in-process caller and the browser client follow in their own changes against this record.
