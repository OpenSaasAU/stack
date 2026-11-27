# create-opensaas-app

## 0.4.0-alpha.5

### Minor Changes

- [#2568](https://github.com/OpenSaasAU/stack/pull/2568) [`339d7ba`](https://github.com/OpenSaasAU/stack/commit/339d7ba9de66b9248a0112735106dd4b61570485) Thanks [@borisno2](https://github.com/borisno2)! - The `with-auth` template now writes its post mutations as procedures and ships lint guardrails.

  A scaffolded auth app gets:

  - `lib/procedures.ts`: `createPost`, `updatePost`, `publishPost` and `deletePost`, each with Zod input and output, declared failures, `access: ({ session }) => session?.actor?.kind === 'human'` and `expose: ['web']`
  - `lib/server.ts`: the one module that imports `getContext`, exporting `callProcedure`, `getServerContext()` and the HTTP host served at `app/api/procedures/[name]/route.ts`
  - a `/posts` page that reads through `getServerContext()`, creates through a server action that only calls a procedure and redirects, and updates, publishes and deletes through the typed browser client
  - `eslint.config.js`, run by `pnpm lint`, which refuses any other import of the context factory and allows `'use server'` only in `lib/actions/*.ts` and the admin page, and refuses `withSession` and `sudo` calls there, over TypeScript and JavaScript files alike

  ```typescript
  // lib/actions/posts.ts
  'use server'

  import { redirect } from 'next/navigation'
  import { callProcedure } from '@/lib/server'

  export async function publishPostAction(id: string) {
    const result = await callProcedure('publishPost', { id })
    if (!result.success) return { error: result.error.message }
    redirect('/posts')
  }
  ```

  The lint rules are a guardrail, not a security boundary: list access control is what protects the data. The unused `lib/actions/users.ts` is removed.

### Patch Changes

- [#2559](https://github.com/OpenSaasAU/stack/pull/2559) [`9ead1d9`](https://github.com/OpenSaasAU/stack/commit/9ead1d9233bde5ce9c5396fd56b43227cbeabd7a) Thanks [@borisno2](https://github.com/borisno2)! - Scaffolded apps pick up `session.actor` on host-built sessions.

- [#2553](https://github.com/OpenSaasAU/stack/pull/2553) [`299fd83`](https://github.com/OpenSaasAU/stack/commit/299fd83a50593f4e8eee0265253b750964fd2327) Thanks [@borisno2](https://github.com/borisno2)! - A procedure can run several operations atomically and throw a named failure that rolls them back.

  `run` opens no transaction of its own. Wrap the writes that must succeed together in `context.transaction`; its context is narrowed like the procedure's own (no `sudo`, `unsafe`, `withSession` or `serverAction`, at runtime as well as in the type) and keeps `.forUpdate()` and `advisoryLock`. Declare the outcomes a caller should handle in `failures`, and throw what `fail` constructs:

  ```typescript
  import * as z from 'zod'
  import { procedure } from '@/.opensaas/procedures'

  export const bookSlot = procedure({
    description: 'Book a place in a slot',
    input: z.object({ slotId: z.string() }),
    output: z.object({ bookingId: z.string() }),
    failures: { SLOT_FULL: 'The slot has no places left', NO_SLOT: 'No such slot' },
    access: ({ session }) => session !== null,
    expose: ['web'],
    run: async ({ input, context, fail }) =>
      context.transaction(async (tx) => {
        const held = await tx.db.Slot.where({ id: { equals: input.slotId } })
          .forUpdate()
          .first()
        if (held === null) throw fail('NO_SLOT')

        const booking = await tx.db.Booking.create({ data: { slotId: input.slotId } })
        const slot = await tx.db.Slot.where({ id: { equals: input.slotId } }).first()
        const { taken } = await tx.db.Booking.where({ slotId: { equals: input.slotId } }).aggregate(
          (aggregate) => ({ taken: aggregate.count() }),
        )
        // Thrown after the write: the booking is rolled back.
        if (booking === null || slot === null || taken > slot.capacity) throw fail('SLOT_FULL')
        return { bookingId: booking.id }
      }),
  })
  ```

  `fail` accepts only the codes the procedure declares, so an undeclared code is a compile error, and `ProcedureResultOf<typeof bookSlot>` exposes the declared codes beside the reserved ones. Over HTTP a declared failure answers 200 with `{ success: false, error: { code, message } }`; `VALIDATION` stays 400 with field errors and `RETRY` and `CONFLICT` stay 409. Nothing retries a `RETRY` automatically: it reports that the transaction rolled back, not that work outside it was undone.

  Things to know:

  - `throw` a failure. One returned from `run` or from a transaction callback is treated as thrown, so it still rolls the transaction back and answers its code.
  - A code is upper-case letters, digits and `_`. Declaring a reserved code (`UNAUTHENTICATED`, `DENIED`, `INVALID_INPUT`, `VALIDATION`, `RETRY`, `CONFLICT`, `INTERNAL`) is a compile error and is refused when the procedure is defined.
  - Output is parsed after `run` returns, so output that fails its schema is `INTERNAL` and does not undo a transaction that already committed.
  - A defined procedure's `access` and `run` now take the application context (`{ context }` and `{ input, context }`) and narrow it themselves. This only matters to code that called them directly instead of going through a host.

  See ADR-0086.

- [#2493](https://github.com/OpenSaasAU/stack/pull/2493) [`f4975cd`](https://github.com/OpenSaasAU/stack/commit/f4975cdac9645c4732fb2a70440d6bc17e7315b9) Thanks [@borisno2](https://github.com/borisno2)! - The auth template ignores `DISABLE_RATE_LIMITING` under `NODE_ENV=production`, ships a commented `advanced.ipAddress` block, and no longer ships the variable active in `.env.example`.

- [#2471](https://github.com/OpenSaasAU/stack/pull/2471) [`4b768f2`](https://github.com/OpenSaasAU/stack/commit/4b768f232d8fed6af88b292e469e05ffb5203983) Thanks [@borisno2](https://github.com/borisno2)! - Internal restructuring: every write return now goes through Field Visibility's read funnel and carries the visible-row brand.

- [#2451](https://github.com/OpenSaasAU/stack/pull/2451) [`28ff344`](https://github.com/OpenSaasAU/stack/commit/28ff34407741a466cafd21048a8e385b7800652e) Thanks [@borisno2](https://github.com/borisno2)! - Contract derivation, the constraint map and generate-time field-name validation read names and foreign-key ownership from the List member table; the contract is unchanged.
  A `db.indexes`/`db.foreignKeys` entry naming a field with a `computed` descriptor is now refused by name at generate.

- [#2431](https://github.com/OpenSaasAU/stack/pull/2431) [`6422e97`](https://github.com/OpenSaasAU/stack/commit/6422e97c0a5e22a3ae19c5cb2fbe9a076feee34e) Thanks [@borisno2](https://github.com/borisno2)! - Add client-safe entry points so `next build --webpack` builds the admin

  A `'use client'` module that imported from `@opensaas/stack-core` or `@opensaas/stack-ui` pulled the
  server graph into the browser bundle, and webpack refused it (`UnhandledSchemeError: node:async_hooks`).
  Turbopack tolerated the same graph, so only `next build --webpack` failed. The admin's own client
  components now import from two new entries that reach nothing server-side:

  - `@opensaas/stack-core/client-safe` — `getUrlKey`, `getListKeyFromUrl`, `resolveListKeyFromUrl` and the
    filter-query helpers (`parseFilterQuery`, `serializeFilterQuery`, `recordIdFilterToken`, …). The root
    entry still exports the same bindings.
  - `@opensaas/stack-ui/cells` — the cell components and `registerCellComponent`.

  A field-registration module in your app should import from these, never from a package root:

  ```ts
  // lib/register-fields.ts
  'use client'

  // Before: pulled AdminUI and the server graph into the client bundle
  // import { registerFieldComponent } from '@opensaas/stack-ui'
  import { registerFieldComponent } from '@opensaas/stack-ui/fields'
  import { registerCellComponent } from '@opensaas/stack-ui/cells'
  import { getUrlKey } from '@opensaas/stack-core/client-safe'
  ```

  The rag and tiptap registration modules now do the same.

- [#2480](https://github.com/OpenSaasAU/stack/pull/2480) [`846f622`](https://github.com/OpenSaasAU/stack/commit/846f622c7e2f080c1d746f7ccd284fba214f5b6a) Thanks [@borisno2](https://github.com/borisno2)! - Fix part columns of a multi-column field without `assembleColumns` reaching a session the field's own `read` rule denies.

- [#2562](https://github.com/OpenSaasAU/stack/pull/2562) [`76fce00`](https://github.com/OpenSaasAU/stack/commit/76fce00b7ea85b0ac2af8d4f979757d1600912e9) Thanks [@borisno2](https://github.com/borisno2)! - Scaffolded apps can call procedures in-process with `createServerCaller`.

- [#2425](https://github.com/OpenSaasAU/stack/pull/2425) [`bc97369`](https://github.com/OpenSaasAU/stack/commit/bc973693857be40587c0c6903557cf32fe118ce5) Thanks [@borisno2](https://github.com/borisno2)! - Resolve Session vocabulary answers lazily, one question at a time

  A list's Session vocabulary no longer resolves every rule of the list on the first ask. Each answer (an operation, a field's `read`/`create`/`update`, `filterable`, `sortable`) is asked only when a consumer needs it, and is memoised on its own for the context's life, so asking a related list's `query` and one field's `filterable` asks only those two rules. The whole vocabulary is assembled from the same answers, so no rule is asked twice per context.

  The admin's list view filter labels, Relationship table column labels and link controls, item form relationship options and operation gates ask a related list only the questions they need.

  `resolveNavCounts` behaviour changes:

  - A list whose vocabulary read fails is now omitted and logged instead of rejecting the whole call.
  - A framework's control flow (`redirect()`, `notFound()`) raised by a list's count call (`aggregate`) was previously caught, logged and the badge dropped; it now propagates out of `resolveNavCounts`, as control flow from the vocabulary read already did.

- [#2474](https://github.com/OpenSaasAU/stack/pull/2474) [`9774d08`](https://github.com/OpenSaasAU/stack/commit/9774d082befd990e392748487bab65fbd916c27c) Thanks [@borisno2](https://github.com/borisno2)! - Internal restructuring: Field Visibility gains a single traversal for reads and write returns with no relation nodes, behind an internal switch that defaults to the existing walks.

- [#2547](https://github.com/OpenSaasAU/stack/pull/2547) [`878c2ca`](https://github.com/OpenSaasAU/stack/commit/878c2ca8c30b0f7862ce71d639af00bacca7fa6d) Thanks [@borisno2](https://github.com/borisno2)! - Define an application action once as a procedure and call it over HTTP.

  `opensaas generate` now writes `.opensaas/procedures.ts`, a `procedure` builder typed to your own `Context`. Keep procedures in a registry module of your own (never in `opensaas.config.ts`) and serve it with `createProcedureHandler` from `@opensaas/stack-core/procedures`:

  ```typescript
  // lib/procedures.ts
  import * as z from 'zod'
  import { procedure } from '@/.opensaas/procedures'

  export const procedures = {
    createPost: procedure({
      description: 'Create a draft post authored by the caller',
      input: z.object({ title: z.string().min(1) }),
      output: z.object({ id: z.string(), title: z.string() }),
      access: ({ session }) => session !== null,
      expose: ['web'],
      run: async ({ input, context }) => {
        const post = await context.db.Post.create({ data: { title: input.title } })
        if (post === null) throw new Error('Post was not created')
        return post
      },
    }),
  }

  // app/api/procedures/[name]/route.ts
  import { createProcedureHandler } from '@opensaas/stack-core/procedures'
  import { getContext } from '@/.opensaas/context'
  import { procedures } from '@/lib/procedures'
  import { auth } from '@/lib/auth'

  export const POST = createProcedureHandler({
    procedures,
    getContext,
    getSession: async (request) => {
      const result = await auth.api.getSession({ headers: request.headers })
      return result ? { userId: result.user.id } : null
    },
    allowedOrigins: ['http://localhost:3000'],
  })
  ```

  A caller POSTs JSON to `/api/procedures/<name>`. A call that reaches the procedure pipeline gets `{ success: true, data }` or `{ success: false, error: { code, message, fieldErrors? } }`. Transport failures do not use that envelope: 404 (unknown or unexposed name), 405 (not `POST`), 413 (body too large) and 415 (not `application/json`) answer `{ error: "<message>" }` with `error` as a string, so branch on the status first. Description, input, output, access and a non-empty `expose` are required. `run` receives `db`, `session`, `storage` and `plugins` only. A cookie request must come from an allowed origin, any `Authorization` header is refused, and unknown and unexposed names both answer 404. A default `z.object` output schema removes keys it does not declare and a strict one refuses them; a schema that does neither returns whatever `run` returned, and refusing such schemas when the host is created is [#2535](https://github.com/OpenSaasAU/stack/issues/2535). See ADR-0086.

- [#2420](https://github.com/OpenSaasAU/stack/pull/2420) [`4374e65`](https://github.com/OpenSaasAU/stack/commit/4374e651496547cafd7094fbd8330620b088a2ff) Thanks [@borisno2](https://github.com/borisno2)! - `checkFieldAccess` and `isListQueryStaticallyDenied` are gone from core's entry points, nav counts read the Session vocabulary, and the vocabulary rethrows only real framework control flow

  The admin reads the Session vocabulary instead of evaluating access rules itself, so the field-access evaluator leaves `@opensaas/stack-core/internal`, and `isListQueryStaticallyDenied` leaves the root entry point.

  `resolveNavCounts` counts a list only where the session's vocabulary does not deny `query`. A `query` rule returning `null` or `undefined` now shows no nav count instead of a `0`, and a context that resolves no vocabulary counts nothing.

  A rule that throws while the vocabulary or MCP decides what to advertise is rethrown only when it is framework control flow: a string `digest` starting with one of Next.js's control-flow prefixes (`NEXT_REDIRECT`, `NEXT_HTTP_ERROR_FALLBACK`, `NEXT_NOT_FOUND`, `DYNAMIC_SERVER_USAGE`, `BAILOUT_TO_CLIENT_SIDE_RENDERING`, `HANGING_PROMISE_REJECTION`, `NEXT_PRERENDER_INTERRUPTED`), or React's postpone. As Next's `unstable_rethrow` does, an `Error` whose `cause` chain reaches one of those has that cause rethrown, so a rule wrapping `redirect()` in `new Error(message, { cause })` still redirects. Any other throw, including one carrying an unrelated `digest` or an unrelated `cause`, denies that answer and logs a warning.

  `isHookOnlyField(field)` is added to `@opensaas/stack-core/internal`, so the admin marks a Hook-only field without reading its `access` itself.

- [#2516](https://github.com/OpenSaasAU/stack/pull/2516) [`9f17366`](https://github.com/OpenSaasAU/stack/commit/9f17366402cb263793d2a38c8ca52791ed79be1b) Thanks [@borisno2](https://github.com/borisno2)! - Scaffolded apps pick up the object form of `needs`.

- [#2412](https://github.com/OpenSaasAU/stack/pull/2412) [`ad85f09`](https://github.com/OpenSaasAU/stack/commit/ad85f095916eae5500e6e6b7e77e1ccbff24fa36) Thanks [@borisno2](https://github.com/borisno2)! - Track the stack's Session vocabulary release

- [#2475](https://github.com/OpenSaasAU/stack/pull/2475) [`756558e`](https://github.com/OpenSaasAU/stack/commit/756558eee7b8723827ff8770f0b346b43b4bd895) Thanks [@borisno2](https://github.com/borisno2)! - Internal restructuring: Field Visibility's single traversal now also handles reads with plain includes, behind the same internal switch, which still defaults to the existing walks.

- [#2470](https://github.com/OpenSaasAU/stack/pull/2470) [`df46667`](https://github.com/OpenSaasAU/stack/commit/df466677dd0d9a1b3de7cda12cd3901e656b8b3a) Thanks [@borisno2](https://github.com/borisno2)! - Internal restructuring: Field Visibility's tests now run through the secured surface, and its field-strip step drops an unused depth parameter.

- [#2566](https://github.com/OpenSaasAU/stack/pull/2566) [`e06f639`](https://github.com/OpenSaasAU/stack/commit/e06f639fb3099b71586771008bdf0be5f9a5f93d) Thanks [@borisno2](https://github.com/borisno2)! - Scaffolded apps can serve their procedures as MCP tools.

- [#2546](https://github.com/OpenSaasAU/stack/pull/2546) [`a2598d5`](https://github.com/OpenSaasAU/stack/commit/a2598d5613274027b3c9500ad99f4b352547cecf) Thanks [@borisno2](https://github.com/borisno2)! - MCP write tools are now opt-in per list. This changes a default.

  Enabling MCP gives each list its `list_<list>_query` tool and no generated `create`, `update` or `delete` tool. A list enables each write tool deliberately in its own `mcp.tools`; a write tool it has not enabled is neither listed nor callable (`Unknown tool`). An enabled tool still runs the list's access control, hooks and scopes. Custom and plugin tools are unchanged.

  ```typescript
  Post: list({
    fields: { title: text() },
    mcp: { tools: { create: true, update: true } }, // delete stays off
  })
  ```

  `mcp.defaultTools` now takes `read` only. A config setting `create`, `update` or `delete` there, even to `false`, is refused by `config()` and `createMcpHandlers` with an error naming `lists.<List>.mcp.tools.<operation>`. `config()` refuses it even when `mcp.enabled` is not `true`, so an app with MCP switched off and the old `defaultTools` shape must remove those keys too.

  To keep a list's write tools, move them onto the list:

  ```typescript
  // Before
  mcp: { enabled: true, defaultTools: { read: true, create: true, update: true, delete: true } }

  // After
  mcp: { enabled: true, defaultTools: { read: true } }
  // and on each list agents may write to:
  Post: list({ fields: { /* ... */ }, mcp: { tools: { create: true, update: true, delete: true } } })
  ```

- [#2468](https://github.com/OpenSaasAU/stack/pull/2468) [`94e8358`](https://github.com/OpenSaasAU/stack/commit/94e8358c069e34b96ee2f75e9581029572abbe59) Thanks [@borisno2](https://github.com/borisno2)! - Cover the delete path's Session vocabulary clear with a test.

- [#2444](https://github.com/OpenSaasAU/stack/pull/2444) [`6840f89`](https://github.com/OpenSaasAU/stack/commit/6840f89e366f6e52bbe0612628169db6f83fd566) Thanks [@borisno2](https://github.com/borisno2)! - Add an internal List member resolver that answers, once per list, what each usable name on a list is. No call site uses it yet.

- [#2426](https://github.com/OpenSaasAU/stack/pull/2426) [`a4dcb7e`](https://github.com/OpenSaasAU/stack/commit/a4dcb7e45a3aadab0251121d566520cee027b654) Thanks [@borisno2](https://github.com/borisno2)! - Fix the session vocabulary keeping stale answers: a successful write or committed transaction clears it, `rawOpensaasContext` keeps nothing, and a `resolveOutput` hook no longer waits on its own pending answer.

- [#2428](https://github.com/OpenSaasAU/stack/pull/2428) [`21bce38`](https://github.com/OpenSaasAU/stack/commit/21bce381ec8a4459bd591c3651962c4d6b21f646) Thanks [@borisno2](https://github.com/borisno2)! - Track the stack release that makes the framework control-flow predicate injectable.

- [#2447](https://github.com/OpenSaasAU/stack/pull/2447) [`dff4310`](https://github.com/OpenSaasAU/stack/commit/dff4310b1cbf901f9ba401b85f33b0200fd81179) Thanks [@borisno2](https://github.com/borisno2)! - MCP asks the List member resolver which names a `where`, `orderBy`, write `data` and singleton read accept, and refuses a config `generate` refuses when its handlers are created.

- [#2466](https://github.com/OpenSaasAU/stack/pull/2466) [`5bd3fc6`](https://github.com/OpenSaasAU/stack/commit/5bd3fc6cd474acc1fea2cffa94d85209ddc913a6) Thanks [@borisno2](https://github.com/borisno2)! - A failed declared-rows fetch for a caller-shaped include now poisons its transaction owner, as every other engine read does.

- [#2482](https://github.com/OpenSaasAU/stack/pull/2482) [`bab30df`](https://github.com/OpenSaasAU/stack/commit/bab30dfe01663f03ba49717d5c3d688ef0792f42) Thanks [@borisno2](https://github.com/borisno2)! - Scaffold against the stack release that requires `assembleColumns` on a multi-column field.

- [#2424](https://github.com/OpenSaasAU/stack/pull/2424) [`565c4ca`](https://github.com/OpenSaasAU/stack/commit/565c4ca5de288b8c54cf2e3b5c811b44e913bf47) Thanks [@borisno2](https://github.com/borisno2)! - The engine context answers whether a singleton's row is stored, so `serializeItemForForm` can read a singleton without triggering `get()`'s auto-create.

- [#2420](https://github.com/OpenSaasAU/stack/pull/2420) [`4374e65`](https://github.com/OpenSaasAU/stack/commit/4374e651496547cafd7094fbd8330620b088a2ff) Thanks [@borisno2](https://github.com/borisno2)! - The singleton view and every Create and Delete affordance now read the Session vocabulary

  `SingletonView` shows its editor only when the session's vocabulary for the singleton allows `query`, and offers its create-on-first-save form only where `create` is not denied. An operation rule returning `null` or `undefined` now hides the editor, as the engine already denied the read ([#2382](https://github.com/OpenSaasAU/stack/issues/2382)), and a sudo context on a singleton with no operation rules sees the editor. A query-denied singleton renders the same unavailable state the list view does (`data-slot="singleton-view-unavailable"`), and `get()` is not called for it. If reading the vocabulary throws, the singleton view logs the error and shows a load-failure state for that view (`data-slot="singleton-view-error"`) instead of failing the whole admin page. Framework control flow such as `redirect()` still propagates.

  Create and Delete are offered only where the vocabulary does not deny `create` or `delete`, on top of `ui.hideCreate` and `ui.hideDelete`. This covers the list view's Create link and table Delete, the dashboard's Quick Actions Create links, and the item page's Delete. The `/create` route renders an unavailable state (`data-slot="item-create-unavailable"`) instead of a form where `create` is denied.

  The admin package's own access classification (`isOperationPotentiallyAllowed`, `isFieldPotentiallyWritable`, `markWriteDeniedFields`) is deleted. Nothing in the admin calls an access rule, reads one off a config or calls the field-access evaluator: every affordance reads the vocabulary core resolves, so a write rule that optional-chains `item` is answered as row-dependent rather than as a static deny ([#2383](https://github.com/OpenSaasAU/stack/issues/2383)).

- [#2416](https://github.com/OpenSaasAU/stack/pull/2416) [`495ad87`](https://github.com/OpenSaasAU/stack/commit/495ad87b024a41a1eae4320256ce5106b2d102a1) Thanks [@borisno2](https://github.com/borisno2)! - Relationship tables and item-form relationship lookups read the Session vocabulary

  What a Relationship table tells the browser about its related list now comes from that list's own Session vocabulary rather than from the admin evaluating access rules itself:

  - A related column the session can never read is left out of the columns, field configs, rows, sums and editable columns the client receives.
  - Inline cell edit is offered wherever the related list's vocabulary does not deny the write. A field update rule written as `item?.ownerId === session?.userId` is row-dependent, so owners can edit their own rows inline; the secured commit still decides each row.
  - Remove, disconnect, create and link controls appear only where the related list's (or junction list's) operation is not denied. An operation rule returning `null` or `undefined` now hides them, as the engine denies it.
  - Disconnect and the foreign-key link also need the back-reference field's own `update`; "+ Add" needs its `create`; a junction link needs `create` on both of the junction's foreign keys.
  - A related list the session may not query renders as unavailable, with no columns, rows, count or write controls. A related list the context cannot resolve does the same instead of failing the page.
  - A relationship column's labels, and an item form's relationship options, are looked up only when the session may query the related list.

  ```ts
  // Task.status is inline-editable for the row's assignee
  status: text({
    access: { update: ({ session, item }) => item?.assignee === session?.userId },
  }),
  ```

- [#2478](https://github.com/OpenSaasAU/stack/pull/2478) [`1b45d87`](https://github.com/OpenSaasAU/stack/commit/1b45d877684393fb2dd61ac53ac3e4176fb5b322) Thanks [@borisno2](https://github.com/borisno2)! - Internal restructuring: Field Visibility has one implementation, its single traversal; the old walks, the switch between them and the comparison harness are deleted.

- [#2424](https://github.com/OpenSaasAU/stack/pull/2424) [`565c4ca`](https://github.com/OpenSaasAU/stack/commit/565c4ca5de288b8c54cf2e3b5c811b44e913bf47) Thanks [@borisno2](https://github.com/borisno2)! - `serializeItemForForm` takes the record's id and reads the row itself

  `serializeItemForForm(context, listKey, id, purpose?)` on `@opensaas/stack-ui/server` now reads the row through the session's own secured surface, so Field Visibility applies every `read` rule, one that depends on the row included. It no longer takes a row, so a row from `context.unsafe`, a `sudo()` read or a hand-built object cannot reach a `'use client'` form: passing one is a compile error.

  The id is parsed against the list's `db.idField`, as an admin URL segment is, so a string route param works for an `int autoincrement` list. The result is `null` when the session may not read the row, when no row has that id, and when the id is not one the list's key type can hold. A to-one relationship comes back as its related id. A to-many relationship is not prefilled. On a singleton list the row is read through `get()` and never auto-created, so a singleton with no stored row answers `null`. The access that applies is that of the context you pass: `context.sudo()` reads as sudo.

  Migration:

  ```tsx
  // Before
  const post = await context.db.Post.where({ id: { equals: params.id } }).first()
  if (post === null) notFound()
  const initialData = await serializeItemForForm(context, 'Post', {
    id: post.id,
    title: post.title,
    status: post.status,
  })

  // After
  const initialData = await serializeItemForForm(context, 'Post', params.id)
  if (initialData === null) notFound()
  ```

- [#2472](https://github.com/OpenSaasAU/stack/pull/2472) [`5850dd6`](https://github.com/OpenSaasAU/stack/commit/5850dd64bbbda381027f344044ebc803cac76958) Thanks [@borisno2](https://github.com/borisno2)! - Internal restructuring: Field Visibility is one module, driven by the resolved read plan alone, and no longer imports the context module.

- [#2415](https://github.com/OpenSaasAU/stack/pull/2415) [`59e8d70`](https://github.com/OpenSaasAU/stack/commit/59e8d70029aa90c01373aa8600a665bc538523ce) Thanks [@borisno2](https://github.com/borisno2)! - `serializeFieldConfigs` now takes the context and the list key, and applies the session's Session vocabulary

  Field configs can no longer reach a client without the session applied. The serialiser on `@opensaas/stack-ui/server` reads the vocabulary itself: a field the session can never read is withheld, and a field it can never write for the form's operation is marked read-only. A rule that reads the row keeps its field editable when there is no row to answer it for, so a create rule written as `item?.ownerId === session.userId` no longer locks the field on a create form ([#2383](https://github.com/OpenSaasAU/stack/issues/2383)).

  ```tsx
  // app/posts/new/page.tsx (server)
  import { serializeFieldConfigs } from '@opensaas/stack-ui/server'
  import { getContext } from '@/.opensaas/context'

  const context = await getContext(session)
  const fields = await serializeFieldConfigs(context, 'Post', 'create') // or 'update', or 'display' (default)
  ```

  An edit form's values come from `serializeItemForForm`, also on `@opensaas/stack-ui/server`. It applies each field's `ui.valueForClientSerialization` (a `password()` field becomes `{ isSet }`) and leaves out every field the serialiser withholds:

  ```tsx
  const editFields = await serializeFieldConfigs(context, 'Post', 'update', post) // answers row-dependent rules for `post`
  const initialData = await serializeItemForForm(context, 'Post', post.id)
  if (initialData === null) notFound()
  ```

  ```tsx
  // a 'use client' component
  <ItemCreateForm fields={fields} onSubmit={createPost} />
  <ItemEditForm fields={editFields} initialData={initialData} onSubmit={updatePost} />
  ```

  `ItemCreateForm` and `ItemEditForm` take the serialised result and no longer serialise on the client: their `fields` prop is `Record<string, SerializableFieldConfig>`, and the `listKey` and `config` props are gone (the serialiser marks the non-owning end of a one-to-one itself). `serializeFieldConfig` (singular) is no longer exported. `ItemEditForm` no longer applies a field's `ui.valueForClientSerialization` to `initialData`; pass it `serializeItemForForm`'s result. Its `TData` type parameter now extends `Record<string, unknown>`.

  The admin's item forms read the same vocabulary, so a field whose write rule throws is now read-only rather than editable, a field on a list whose `update` operation the session is denied is read-only on the edit form, and per-row edit gating is preserved: on the edit form, a field whose update rule reads the row is answered through core against the row being edited as stored, as the update decides it, and is read-only on a row the rule denies ([#1402](https://github.com/OpenSaasAU/stack/issues/1402)). A rule that reaches for a relation off `item` is read-only, because the update itself rejects it: the stored row carries no relation. A field whose `read` rule depends on the row stays on the edit form, and its value is whatever the form's own secured read returned, Field Visibility applied. On a list the session may create but not query, an editable relationship field keeps its options on the create form.

- [#2463](https://github.com/OpenSaasAU/stack/pull/2463) [`a66e95e`](https://github.com/OpenSaasAU/stack/commit/a66e95e1fdbf6fe902b70b3ecd346084647e70cf) Thanks [@borisno2](https://github.com/borisno2)! - The dependency table, synthetic back-relation lookup, multi-column read assembly and singleton checks read from the List member table, so generated contracts and tables are unchanged.
  A multi-column field is now assembled from its `columns` descriptor even without `getColumnNames`, and Field Visibility always resolves the list it reads, so a denied multi-column field's raw part columns never pass through.

- [#2448](https://github.com/OpenSaasAU/stack/pull/2448) [`b3120a1`](https://github.com/OpenSaasAU/stack/commit/b3120a1d6cc843ae53a7865a5d7e8696a3b3c935) Thanks [@borisno2](https://github.com/borisno2)! - Fix `select()` silently dropping a foreign key the list does not own ([#2388](https://github.com/OpenSaasAU/stack/issues/2388)), `distinct`/`distinctOn` refusing one it does own ([#2389](https://github.com/OpenSaasAU/stack/issues/2389)), and an undeclared `createdAt`/`updatedAt` on a list without timestamps being treated as a system field instead of an unknown name ([#2390](https://github.com/OpenSaasAU/stack/issues/2390)).

- [#2449](https://github.com/OpenSaasAU/stack/pull/2449) [`e2e18be`](https://github.com/OpenSaasAU/stack/commit/e2e18be4812600f83c924e62d1ece0b05ee0f180) Thanks [@borisno2](https://github.com/borisno2)! - The Write Pipeline's ownership, singleton and part-column checks ask the List member resolver instead of re-deriving them from the config.

  - Writes on a config whose list or member names `opensaas generate` refuses now throw generate's own error.
  - Under sudo, a Synthetic back-relation key whose value is `undefined` is now refused as undeclared, like any other unknown key.
  - `RelationTargetMissingError` is removed from `@opensaas/stack-core`: a `connect` to an undeclared list now fails with generate's refusal, so the error could no longer be thrown.

  **Migrating:** remove any `instanceof RelationTargetMissingError` checks. The same mistake (a relationship whose `ref` names a list that does not exist) is now refused by `pnpm generate`, with a message naming the list and field, before any context is built.

- [#2469](https://github.com/OpenSaasAU/stack/pull/2469) [`2f48eab`](https://github.com/OpenSaasAU/stack/commit/2f48eab7d64911588624fe7e66741c0c0ba540a9) Thanks [@borisno2](https://github.com/borisno2)! - Add `@opensaas/stack-core/db-client`, the server-only subpath for `resolveRuntimeConnection`, and deprecate `@opensaas/stack-core/client`

  `/client` sat beside `/client-safe` and read as browser-safe, but it reaches `pg`. `opensaas generate` now emits the new subpath in `.opensaas/context.ts`. `/client` still resolves to the same bindings, marked `@deprecated`, and is removed at the next major.

  Migration — regenerate (`pnpm generate`) and update any hand-written import:

  ```typescript
  // Before
  import { resolveRuntimeConnection } from '@opensaas/stack-core/client'

  // After
  import { resolveRuntimeConnection } from '@opensaas/stack-core/db-client'
  ```

- [#2476](https://github.com/OpenSaasAU/stack/pull/2476) [`d417e3a`](https://github.com/OpenSaasAU/stack/commit/d417e3a4a1fef505587b6f83edcc6568e9db82e7) Thanks [@borisno2](https://github.com/borisno2)! - refactor(core): the single Field Visibility traversal handles reductions, caller-shaped declared relations and row-lock re-reads, with no hand-off to the old walks ([#2410](https://github.com/OpenSaasAU/stack/issues/2410))

- [#2462](https://github.com/OpenSaasAU/stack/pull/2462) [`5621a97`](https://github.com/OpenSaasAU/stack/commit/5621a977d4d13104c72d5166301ab8a3d2c535e7) Thanks [@relationship({](https://github.com/relationship({), [@relationship({](https://github.com/relationship({)! - `opensaas generate` refuses a computed (virtual) or multi-column field keyed like another field's foreign-key or part column

  Such a field used to be accepted and then win every name lookup, so the foreign-key or part column it shadowed could not be named in `where`, `orderBy` or `select`. Generate, `deriveContract` and the List member resolver now refuse it with the same message, naming the list, both fields and the fix. A stored field keyed like another field's part column, already refused, now gets the same named message (reason `part-column-collision`):

  ```
  List "Post": fields.authorId collides with the foreign-key column "authorId" that fields.author derives for its relationship. Rename fields.authorId, or remove it and read the key through fields.author.
  ```

  Migration: rename the virtual or multi-column field.

  ```ts
  // Before: refused by generate
  Post: list({
    fields: {
   ref: 'Author' }),
      authorId: virtual({ type: 'string', hooks: { resolveOutput: () => '' } }),
    },
  })

  // After
  Post: list({
    fields: {
   ref: 'Author' }),
      authorLabel: virtual({ type: 'string', hooks: { resolveOutput: () => '' } }),
    },
  })
  ```

- [#2510](https://github.com/OpenSaasAU/stack/pull/2510) [`9890c12`](https://github.com/OpenSaasAU/stack/commit/9890c128bf4baf45bd143f8da19d0dc5b583818f) Thanks [@borisno2](https://github.com/borisno2)! - Template `build` script runs `opensaas generate` instead of `pnpm generate`, so `npm run build` works without pnpm; the `starter` example (basic template) now sets a new post's author to the signed-in user.

- [#2561](https://github.com/OpenSaasAU/stack/pull/2561) [`df9191f`](https://github.com/OpenSaasAU/stack/commit/df9191f4b8f9810cc25280a822b8786d03cca3cd) Thanks [@borisno2](https://github.com/borisno2)! - Refresh templates for the latest stack release.

- [#2552](https://github.com/OpenSaasAU/stack/pull/2552) [`6e9c64f`](https://github.com/OpenSaasAU/stack/commit/6e9c64f6afa74705ac5f5a34a5d13829ff4ba4ac) Thanks [@borisno2](https://github.com/borisno2)! - Refuse unsafe procedure definitions when the host is created.

  `createProcedureHandler` now throws `ProcedureHostError`, naming the procedure, the offending part and the fix, for:

  - an `input` or `output` schema that does not convert to JSON Schema on its own side (dates, bigints, output transforms, `z.undefined()`, `z.void()`)
  - the open-ended shapes Zod provides, at any depth: `z.any()`, `z.unknown()`, `z.json()`, a loose object, a `z.looseRecord` or a `z.record` of `any`/`unknown`; and an output object with a `.catchall()`. A hand-written schema that accepts as much is not recognised
  - `z.file()`, which a JSON body cannot carry
  - a `config` option that is not a resolved config, such as an un-awaited promise
  - a name matching the reserved `list_<list>_<operation>` pattern of generated MCP tools
  - a name a list custom tool or a plugin-registered MCP tool already carries, when the host is given the config

  ```typescript
  // app/api/procedures/[name]/route.ts
  import { createProcedureHandler } from '@opensaas/stack-core/procedures'
  import config from '@/opensaas.config'
  import { getContext } from '@/.opensaas/context'
  import { procedures } from '@/lib/procedures'
  import { getSession } from '@/lib/auth'

  export const POST = createProcedureHandler({
    procedures,
    config: await config, // optional: adds the custom and plugin tool name check
    getContext,
    getSession: (request) => getSession(request.headers),
    allowedOrigins: ['http://localhost:3000'],
  })
  ```

  A procedure that takes no input uses `z.object({}).optional()`, one that returns nothing uses `z.null()`, and a date travels as `z.iso.datetime()`. The checks are also exported for other hosts: `assertProcedureRegistry`, `assertProcedureSchemas` and `assertProcedureNamesAvailable`.

## 0.4.0-alpha.4

### Patch Changes

- [#2381](https://github.com/OpenSaasAU/stack/pull/2381) [`8f30988`](https://github.com/OpenSaasAU/stack/commit/8f309883b9072c435bfd3e92bf2f0db51e116f8c) Thanks [@dependabot](https://github.com/apps/dependabot)! - Align better-auth dev dependencies on ^1.7.18 so a single `@better-auth/core` copy is installed alongside `@better-auth/mcp` 1.7.18

- [#2393](https://github.com/OpenSaasAU/stack/pull/2393) [`bf9aac3`](https://github.com/OpenSaasAU/stack/commit/bf9aac34f50453ad250f09415f97eff031b4e928) Thanks [@borisno2](https://github.com/borisno2)! - Bump Prisma to 8.0.0-rc.23 (CLI 8.0.0-rc.33); decimal columns use the renamed `numericStringColumn` helper.

- [#2144](https://github.com/OpenSaasAU/stack/pull/2144) [`8bbaeae`](https://github.com/OpenSaasAU/stack/commit/8bbaeaef7e544c69cb17756ca67813521e0ef490) Thanks [@borisno2](https://github.com/borisno2)! - Refresh templates for the latest stack release.

- [#2217](https://github.com/OpenSaasAU/stack/pull/2217) [`eaeee36`](https://github.com/OpenSaasAU/stack/commit/eaeee363778e5717371720deec7c4518dfaa80e1) Thanks [@borisno2](https://github.com/borisno2)! - Refresh templates for the latest stack release.

- [#2201](https://github.com/OpenSaasAU/stack/pull/2201) [`0933b4b`](https://github.com/OpenSaasAU/stack/commit/0933b4bb6e19f56a2629623c3e5facb28fe8af73) Thanks [@dependabot](https://github.com/apps/dependabot)! - Scaffold projects on Prisma ORM 8.0.0-rc.22 and the `prisma` CLI 8.0.0-rc.30.

- [#2196](https://github.com/OpenSaasAU/stack/pull/2196) [`80c9ac0`](https://github.com/OpenSaasAU/stack/commit/80c9ac0f721058b566dc93dea1caf97d39c1cc94) Thanks [@borisno2](https://github.com/borisno2)! - Refresh templates for the latest stack release.

- [#2143](https://github.com/OpenSaasAU/stack/pull/2143) [`a854243`](https://github.com/OpenSaasAU/stack/commit/a85424322701f3db9682b0f54acdc51bee404912) Thanks [@borisno2](https://github.com/borisno2)! - Refresh templates for the latest stack release.

- [#2141](https://github.com/OpenSaasAU/stack/pull/2141) [`2f287d5`](https://github.com/OpenSaasAU/stack/commit/2f287d5624fdcf107dddf68d52843d3d43c49f6e) Thanks [@borisno2](https://github.com/borisno2)! - Refresh templates for the latest stack release.

- [#2270](https://github.com/OpenSaasAU/stack/pull/2270) [`e5ab353`](https://github.com/OpenSaasAU/stack/commit/e5ab353d7ec1d13c3cc73042deb8744ed95caeb2) Thanks [@borisno2](https://github.com/borisno2)! - Refresh templates for the latest stack release.

- [#2218](https://github.com/OpenSaasAU/stack/pull/2218) [`357f9bb`](https://github.com/OpenSaasAU/stack/commit/357f9bbf16499fd1d7da1a02e5c9370d60ae661a) Thanks [@borisno2](https://github.com/borisno2)! - Refresh templates for the latest stack release.

- [#2266](https://github.com/OpenSaasAU/stack/pull/2266) [`245ed13`](https://github.com/OpenSaasAU/stack/commit/245ed137dc768fafd83eb777bdc602af29ae0889) Thanks [@borisno2](https://github.com/borisno2)! - Refresh templates for the latest stack release.

- [#2230](https://github.com/OpenSaasAU/stack/pull/2230) [`ad45bd0`](https://github.com/OpenSaasAU/stack/commit/ad45bd0bf8dcaf63f023344f9de7d376205be697) Thanks [@borisno2](https://github.com/borisno2)! - Refresh templates for the latest stack release.

- [#2195](https://github.com/OpenSaasAU/stack/pull/2195) [`ddb9e8c`](https://github.com/OpenSaasAU/stack/commit/ddb9e8cdbf67e42467ec3fec98f22c037f2a5de2) Thanks [@borisno2](https://github.com/borisno2)! - Scaffold against the stack release with the root update lock fix.

- [#2205](https://github.com/OpenSaasAU/stack/pull/2205) [`dec240b`](https://github.com/OpenSaasAU/stack/commit/dec240b2e1596cb7edfa4da21cb7c2e146d05ab4) Thanks [@borisno2](https://github.com/borisno2)! - The with-auth template wires a real sign-out into the admin UI.

- [#2291](https://github.com/OpenSaasAU/stack/pull/2291) [`9776d3f`](https://github.com/OpenSaasAU/stack/commit/9776d3f45abc83db10ecacf0712657b8b0ad7c44) Thanks [@borisno2](https://github.com/borisno2)! - The admin list view no longer sends a field whose `read` rule denies the session for every row to the browser: its name, type, UI config, relationship ref, foreign key and label column are withheld.

- [#2202](https://github.com/OpenSaasAU/stack/pull/2202) [`bd03766`](https://github.com/OpenSaasAU/stack/commit/bd03766d61aff8c72423bd9255f0b5b9d736ff50) Thanks [@dependabot](https://github.com/apps/dependabot)! - Refresh templates for the latest stack release.

- [#2219](https://github.com/OpenSaasAU/stack/pull/2219) [`9a87cfa`](https://github.com/OpenSaasAU/stack/commit/9a87cfa75c464b1940908d20c0fe16c2a30ebf60) Thanks [@borisno2](https://github.com/borisno2)! - Refresh templates for the latest stack release.

- [#2208](https://github.com/OpenSaasAU/stack/pull/2208) [`0dd7eb4`](https://github.com/OpenSaasAU/stack/commit/0dd7eb4b4a9e5b3ec338b39f8ca83e135de36480) Thanks [@borisno2](https://github.com/borisno2)! - Stamp the stack version carrying the `combine()` read-rule fix into new projects.

- [#2378](https://github.com/OpenSaasAU/stack/pull/2378) [`7d5f540`](https://github.com/OpenSaasAU/stack/commit/7d5f540d8837b298186c6837f559bf388ad8aead) Thanks [@borisno2](https://github.com/borisno2)! - `opensaas` and `create-opensaas-app` now exit 1 naming Node.js 22.18 when run on an older Node (fixes [#2318](https://github.com/OpenSaasAU/stack/issues/2318)).

- [#2209](https://github.com/OpenSaasAU/stack/pull/2209) [`4a8b631`](https://github.com/OpenSaasAU/stack/commit/4a8b631e7dcfb3bf5e3eb118193722b2e31d842e) Thanks [@borisno2](https://github.com/borisno2)! - Fix `opensaas generate` failing with "gen is not defined" when a config uses the `cuid` id strategy and no list uses `uuid7`, `cuid2` or `updatedAt`

- [#2232](https://github.com/OpenSaasAU/stack/pull/2232) [`fa03c43`](https://github.com/OpenSaasAU/stack/commit/fa03c4313851a5f2caf016190843bb8a21f15f41) Thanks [@borisno2](https://github.com/borisno2)! - Templates pick up the read-rule fix for withheld relations.

- [#2289](https://github.com/OpenSaasAU/stack/pull/2289) [`cb7e21d`](https://github.com/OpenSaasAU/stack/commit/cb7e21d153d26ee5edb9c4566c9f393891e3e62b) Thanks [@borisno2](https://github.com/borisno2)! - The admin list's column picker, `?columns=` and default columns omit a field whose `read` rule denies the session for every row, matching the MCP vocabulary.

- [#2348](https://github.com/OpenSaasAU/stack/pull/2348) [`78e8fba`](https://github.com/OpenSaasAU/stack/commit/78e8fba88c2d40b3a5fa9ad5de4e05988e7ab496) Thanks [@borisno2](https://github.com/borisno2)! - Add `signOutAndConfirm(auth, headers)` to `@opensaas/stack-auth/server`. It throws when better-auth swallowed a failed session delete, and returns the identity provider's logout URL for the action to redirect to. The example and generated `signOutAction` use it: `redirect((await signOutAndConfirm(auth, await headers())) ?? '/sign-in')`.

- [#2258](https://github.com/OpenSaasAU/stack/pull/2258) [`fb1a7a6`](https://github.com/OpenSaasAU/stack/commit/fb1a7a63429586f3ead4fbd9ab506e9aa9b50847) Thanks [@borisno2](https://github.com/borisno2)! - Refresh templates for the latest stack release.

- [#2142](https://github.com/OpenSaasAU/stack/pull/2142) [`bb87f3b`](https://github.com/OpenSaasAU/stack/commit/bb87f3bf253f31c9aee6b91338f54057ee923ffe) Thanks [@borisno2](https://github.com/borisno2)! - Refresh templates for the latest stack release.

- [#2362](https://github.com/OpenSaasAU/stack/pull/2362) [`40ad8ba`](https://github.com/OpenSaasAU/stack/commit/40ad8babdef2afd79e93100af63d979a0f6069ba) Thanks [@borisno2](https://github.com/borisno2)! - Fix `npm install` on the with-auth template: scaffold npm `overrides` for better-auth's `prisma` peer and pnpm `peerDependencyRules`.

- [#2236](https://github.com/OpenSaasAU/stack/pull/2236) [`384e007`](https://github.com/OpenSaasAU/stack/commit/384e0074f26f05f50cd279fcc0bea81c4aa24c7e) Thanks [@borisno2](https://github.com/borisno2)! - Scaffolds write an allowed-builds `pnpm-workspace.yaml`, and ignored build scripts no longer abort setup on current pnpm.

- [#2265](https://github.com/OpenSaasAU/stack/pull/2265) [`d348bba`](https://github.com/OpenSaasAU/stack/commit/d348bba8c21c466b1d0fa4645b12ca757be7c02f) Thanks [@borisno2](https://github.com/borisno2)! - Refresh templates for the latest stack release.

- [#2212](https://github.com/OpenSaasAU/stack/pull/2212) [`bea32ad`](https://github.com/OpenSaasAU/stack/commit/bea32adade0c2aa73ab4a923692656929165d020) Thanks [@borisno2](https://github.com/borisno2)! - Refresh templates for the latest stack release.

- [#2211](https://github.com/OpenSaasAU/stack/pull/2211) [`af04b65`](https://github.com/OpenSaasAU/stack/commit/af04b65745d55e0e174c2b95b04f0577651f0861) Thanks [@borisno2](https://github.com/borisno2)! - Fix admin lists emptying on a sort the column cannot take: sorting now follows the ORM's own `order` answer per column, and `orderBy` refuses a virtual or multi-column field as a `ValidationError`.
  A failed list read now shows an error state rather than the first-run empty state.

- [#2222](https://github.com/OpenSaasAU/stack/pull/2222) [`97a9e88`](https://github.com/OpenSaasAU/stack/commit/97a9e882a52733d3a8217fdf15b045a6a73220f8) Thanks [@borisno2](https://github.com/borisno2)! - Templates pick up the admin's keyboard and labelling fixes.

- [#2231](https://github.com/OpenSaasAU/stack/pull/2231) [`5177197`](https://github.com/OpenSaasAU/stack/commit/517719783862d3e6034611c9c5889f47e3575546) Thanks [@borisno2](https://github.com/borisno2)! - Refresh templates for the latest stack release.

- [#2277](https://github.com/OpenSaasAU/stack/pull/2277) [`94ea1ee`](https://github.com/OpenSaasAU/stack/commit/94ea1ee342effcecb0b639ab0b2e1d686514b402) Thanks [@borisno2](https://github.com/borisno2)! - Refresh templates for the latest stack release.

- [#2198](https://github.com/OpenSaasAU/stack/pull/2198) [`1a6333f`](https://github.com/OpenSaasAU/stack/commit/1a6333f188b51d240048c7255fd28321d8a429f9) Thanks [@borisno2](https://github.com/borisno2)! - Refresh templates for the latest stack release.

- [#2264](https://github.com/OpenSaasAU/stack/pull/2264) [`00ffa44`](https://github.com/OpenSaasAU/stack/commit/00ffa44bc8143783cb073ecb807f710028ae553d) Thanks [@borisno2](https://github.com/borisno2)! - Refresh templates for the new Filter builder bar.

- [#2326](https://github.com/OpenSaasAU/stack/pull/2326) [`239591d`](https://github.com/OpenSaasAU/stack/commit/239591db67089c6681c9786e9c5af55b3cd08812) Thanks [@dependabot](https://github.com/apps/dependabot)! - Bump `@modelcontextprotocol/sdk` to ^1.32.2

- [#2269](https://github.com/OpenSaasAU/stack/pull/2269) [`3b25a56`](https://github.com/OpenSaasAU/stack/commit/3b25a567086b032cad28c50bd6eb1713d445c63d) Thanks [@borisno2](https://github.com/borisno2)! - Refresh templates for the latest stack release.

- [#2260](https://github.com/OpenSaasAU/stack/pull/2260) [`93fd6c9`](https://github.com/OpenSaasAU/stack/commit/93fd6c9f4fe136b0a987ffdf436566de9f50b1ba) Thanks [@borisno2](https://github.com/borisno2)! - Refresh templates for the latest stack release.

- [#2259](https://github.com/OpenSaasAU/stack/pull/2259) [`f2af7cb`](https://github.com/OpenSaasAU/stack/commit/f2af7cb048f4c0000c44bbae209d4cc987037834) Thanks [@borisno2](https://github.com/borisno2)! - Refresh templates for the latest stack release.

- [#2268](https://github.com/OpenSaasAU/stack/pull/2268) [`4bf2987`](https://github.com/OpenSaasAU/stack/commit/4bf2987f8cf6ffcf3626a41c5953bbadfbc256c4) Thanks [@borisno2](https://github.com/borisno2)! - Refresh templates for the latest stack release.

- [#2267](https://github.com/OpenSaasAU/stack/pull/2267) [`202f957`](https://github.com/OpenSaasAU/stack/commit/202f95732d7a639ef1e9a4b77c222720b3c0a158) Thanks [@borisno2](https://github.com/borisno2)! - Refresh templates for the latest stack release.

## 0.4.0-alpha.3

### Patch Changes

- [#2139](https://github.com/OpenSaasAU/stack/pull/2139) [`e165820`](https://github.com/OpenSaasAU/stack/commit/e165820f6e3cd01bd7fd23aba046b7bf8321bd0c) Thanks [@borisno2](https://github.com/borisno2)! - Refresh templates for the latest stack release.

- [#2136](https://github.com/OpenSaasAU/stack/pull/2136) [`d4ae4d3`](https://github.com/OpenSaasAU/stack/commit/d4ae4d39411da1ffc7e4463a1d3246f73bef5dc2) Thanks [@borisno2](https://github.com/borisno2)! - Refresh templates for the latest stack release.

## 0.4.0-alpha.2

### Patch Changes

- [#2131](https://github.com/OpenSaasAU/stack/pull/2131) [`3658488`](https://github.com/OpenSaasAU/stack/commit/36584881fa1e2aad5697bd3aa699876c9799f5cb) Thanks [@borisno2](https://github.com/borisno2)! - Refresh templates for the latest stack release.

- [#2132](https://github.com/OpenSaasAU/stack/pull/2132) [`d0a0bbf`](https://github.com/OpenSaasAU/stack/commit/d0a0bbf360512e8b4670eb51a0d95c5bdc378fe4) Thanks [@borisno2](https://github.com/borisno2)! - Refresh templates for the latest stack release.

- [#2133](https://github.com/OpenSaasAU/stack/pull/2133) [`79c7d2b`](https://github.com/OpenSaasAU/stack/commit/79c7d2b4698d54bde92c69353da8d22f1678d8ee) Thanks [@borisno2](https://github.com/borisno2)! - Refresh templates for the latest stack release.

## 0.4.0-alpha.1

### Patch Changes

- [#2121](https://github.com/OpenSaasAU/stack/pull/2121) [`aaa3c4d`](https://github.com/OpenSaasAU/stack/commit/aaa3c4d151c2865ea9d8f6e46ea859392564a864) Thanks [@borisno2](https://github.com/borisno2)! - Scaffolded with-auth template no longer logs password reset URLs in production; the placeholder sender throws instead until a real email transport is configured.

- [#2116](https://github.com/OpenSaasAU/stack/pull/2116) [`b2fcdea`](https://github.com/OpenSaasAU/stack/commit/b2fcdea15201fccab0f50f7fa3d6f0ef66dcb8e8) Thanks [@borisno2](https://github.com/borisno2)! - Republish the scaffolder so its templates stamp the current stack version.

## 0.4.0-alpha.0

### Minor Changes

- [#1420](https://github.com/OpenSaasAU/stack/pull/1420) [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03) Thanks [@borisno2](https://github.com/borisno2)! - Delete the Node build; the Generated bundle loads under plain Node from the committed contract

  The `.opensaas/` bundle is erasable TypeScript by contract and loads natively under Node 22.18+, so the compiled twin that existed to serve bundler-less consumers is gone (ADR-0054, withdrawing ADR-0011). Removed:

  - `output.buildTarget` from the config surface. A config that sets it is now a compile error; delete the `output` block (or the key) — nothing replaces it, because `.opensaas/context.ts` is the one specifier both a bundler and plain Node load.

    ```typescript
    // Before
    export default config({
      output: { buildTarget: 'node' },
      // ...
    })

    // After
    export default config({
      // ...
    })
    ```

    A plain-Node consumer imports the bundle entry directly:

    ```typescript
    const { rawOpensaasContext } = await import('./.opensaas/context.ts')
    ```

  - The CLI's Node build step, its `.opensaas/dist/` layout, and `@typescript/native` as a runtime dependency of `@opensaas/stack-cli` (it stays a devDependency, the compiler the package builds and type-checks its own tests with).

  The CLI's tests now run the real `node` binary over a generated bundle with no flags and no loader, and type-check generator output under `erasableSyntaxOnly` and `verbatimModuleSyntax` so a non-erasable construct fails a CLI test before it fails a user's Node.

  `create-opensaas-app` no longer accepts `--db`, and its SQLite-to-PostgreSQL transform is deleted. The scaffolded project uses the database its template declares; change it by editing `db` in the generated `opensaas.config.ts`. The scaffolded `tsconfig.json` now carries `erasableSyntaxOnly` and `verbatimModuleSyntax`, so the type-checker reports a non-erasable config before Node does.

- [#1420](https://github.com/OpenSaasAU/stack/pull/1420) [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03) Thanks [@borisno2](https://github.com/borisno2)! - Scaffolding needs no database

  The post-scaffold step is now `install` → `generate`. There is no schema-apply
  step, and the `.env` the scaffolder writes sets no `DATABASE_URL` — the first
  `pnpm dev` starts the Dev database for the project and reconciles it.

  ```bash
  npm create opensaas-app@latest my-app
  cd my-app
  pnpm dev   # starts the Dev database, generates, reconciles, runs the app
  ```

  Set `DATABASE_URL` (the commented line in the generated `.env`) to develop
  against a Postgres of your own; no Dev database starts when it is set.

- [#1420](https://github.com/OpenSaasAU/stack/pull/1420) [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03) Thanks [@borisno2](https://github.com/borisno2)! - Rewrite each package README against the Prisma 8 surface

  The READMEs now document the API the packages actually ship, replacing the
  Prisma 7 spellings that no longer resolve.

  Reads compose on `context.db` keyed by the list's PascalCase config key and end
  in a terminal, rather than calling a Prisma delegate:

  ```ts
  const posts = await context.db.Post.where({ status: { equals: 'published' } })
    .orderBy({ createdAt: 'desc' })
    .limit(20)
    .all()

  const post = await context.db.Post.where({ id }).first()
  if (!post) return null
  ```

  `findMany`, `findUnique`, `findFirst` and `count()` are gone; the terminals are
  `all()`, `first()`, `aggregate()` and `nearest()`. A denied read is silent, so
  every `first()` result is a null check.

  Writes take an args object with an identity-only `where`, and a relationship is
  set with `connect` or cleared with `null`:

  ```ts
  const updated = await context.db.Post.update({
    where: { id },
    data: { title, author: { connect: { id: authorId } } },
  })
  ```

  The database config documented in each README is the one `DatabaseConfig`
  carries — `provider: 'postgresql'`, `idField`, `timestamps`, `schemas`,
  `extensions` and `client`. `prismaClientConstructor`, `db.url` and
  `extendPrismaSchema` are gone, and the connection is resolved from the
  environment rather than named in the config.

  Review round two swept each README against the built `.d.ts` rather than against
  another doc, and corrected what the grep-shaped sweep had missed:

  - The UI README's theming block documented bare `--background`/`--primary` HSL
    triplets under a `.dark` class. The shipped contract is `--color-*` tokens in
    `oklch()`, resolved through `light-dark()` and switched by `data-theme` — the
    stylesheet's own header says the design exists "without a duplicated `.dark`
    block". Its primitives list also omitted eight real exports (`Textarea`,
    `Popover`, `Calendar`, `TimePicker`, `DateTimePicker`, `Combobox`, `Badge`,
    `Avatar`), and two samples read `config.lists` without awaiting `config`.
  - The tiptap README reused a filter-returning `AccessControl` rule as
    **field-level** `access.update`. `FieldAccess` types those slots as
    boolean-returning, so that is a type error and a runtime
    `InvalidFieldAccessResultError`, not a scoped update.
  - The storage README's upload route was the last copy still casting
    `formData.get(...) as string` / `as 'file' | 'image'` off a
    `FormDataEntryValue | null`.
  - The auth README's Account shape named `providerId: 'credentials'`; better-auth
    1.7 uses `'credential'` for email/password, and the model carries `issuer`.
  - The Vercel Blob README passed `cacheControl` to `vercelBlobStorage()`. The
    provider option is `cacheControlMaxAge` (a number of seconds);
    `VercelBlobStorageConfig` carries an index signature, so the wrong spelling
    type-checked and was silently ignored.

  Round three corrected what round two's sweeps could not see, each having keyed
  on where a construct sat rather than on what it was:

  - The Vercel Blob README's **options listing** still named `cacheControl` 112
    lines above the call site round two fixed, so the page contradicted itself and
    the half a reader consults first was the wrong half.
  - Sixteen hook samples across the docs and the core, cli and example READMEs
    destructured a member the `delete` branch of its args union does not carry, so
    the destructure failed before any in-body `operation` guard could narrow. Three
    more named an argument on no branch at all: `value` and `inputValue` on
    `resolveInput`/`afterOperation`, and `session` on `ResolveInputHookArgs`.
  - The core README carried a third instance of the field-access class — a bare
    `text({ access: … })` excerpt with no enclosing `fields: {` — plus
    `query: true` where `OperationAccess.query` takes a function, a
    `ValidationError` built from a string where the constructor takes `string[]`,
    and a stale claim that `password()` is excluded from reads.
  - The cli README's "What it does" block under `opensaas db update` described
    `opensaas dev`, and called `migrate` a command group when it has no
    subcommands.

- [#1420](https://github.com/OpenSaasAU/stack/pull/1420) [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03) Thanks [@borisno2](https://github.com/borisno2)! - Scaffolded apps no longer read another user's drafts as an anonymous caller

  `lib/actions/posts.ts` in both templates built its context as
  `getContext({ userId })` from a `getPost(postId, userId?)` whose id is optional.
  `getContext` stores what it is handed as `session ?? null`, so `{ userId: undefined }`
  is a _signed-in_ session with no user: `Post`'s query rule took its `return true`
  branch instead of the published-only filter, and an anonymous caller read drafts.

  The session is now derived from the optional id in one place, so the shape cannot
  be written wrongly at a call site:

  ```typescript
  function sessionFor(userId?: string) {
    return userId ? { userId } : undefined
  }

  export async function getPost(postId: string, userId?: string) {
    const context = await getContext(sessionFor(userId))

    return context.db.Post.where({ id: { equals: postId } }).first()
  }
  ```

  The templates are copied from `examples/starter` and `examples/starter-auth` at
  build time, which is where the fix lives.

- [#1672](https://github.com/OpenSaasAU/stack/pull/1672) [`00c3760`](https://github.com/OpenSaasAU/stack/commit/00c3760449f890f5d365798f5b3b3e1367333762) Thanks [@borisno2](https://github.com/borisno2)! - The `with-auth` template (generated from `examples/starter-auth`) now denies self-update of `User.email` via `authPlugin({ fieldAccess })`, matching `@opensaas/stack-auth`'s new write-deny behavior (issue [#1618](https://github.com/OpenSaasAU/stack/issues/1618)): the template's whole-row owner-update rule on `User` no longer implies every column is writable. Changing an email address must go through better-auth's own verified change-email flow, never a direct `context.db` write.

- [#1420](https://github.com/OpenSaasAU/stack/pull/1420) [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03) Thanks [@borisno2](https://github.com/borisno2)! - Templates are the Prisma 8 starters: Postgres under `opensaas dev`, PascalCase `context.db` keys, and no generated artifacts in the copy

  The scaffolder copies `examples/starter` and `examples/starter-auth`, both now on `db: { provider: 'postgresql' }` with every `context.db` call on the query-value surface. The template copy strips `prisma.config.ts`, `prisma/contract.*` and `migrations/` (ADR-0067): the post-scaffold `generate` recreates the first three and the first `pnpm dev` writes `migrations/` for the new project's own database.

  What a template leaves out is decided per whole path segment, against each entry's path relative to the example — so a checkout under a directory named after one of those patterns (`…/prisma-8/…`) no longer excludes the entire tree, and a source file such as `lib/prisma-helpers.ts` is kept. A copy that produces no files, or no `package.json`, now fails the build instead of publishing an empty template.

  ```bash
  npm create opensaas-app@latest my-app
  cd my-app
  pnpm dev   # starts the Dev database, reconciles it, serves the app and /admin
  ```

### Patch Changes

- [#1862](https://github.com/OpenSaasAU/stack/pull/1862) [`8e0168d`](https://github.com/OpenSaasAU/stack/commit/8e0168d4e8ed01e2b7bde369746f882318326629) Thanks [@borisno2](https://github.com/borisno2)! - The `with-auth` template pins `Post.author` and `Note.owner` to the signed-in user, so a user can no longer create, reassign or plant content under another user's name.

- [#1838](https://github.com/OpenSaasAU/stack/pull/1838) [`d8763ee`](https://github.com/OpenSaasAU/stack/commit/d8763eefb30c868b544c9b9d667bfaf2255df081) Thanks [@borisno2](https://github.com/borisno2)! - Scaffolded apps pin `@electric-sql/pglite` and `pglite-socket` to the versions stack-core expects, so `createTestContext` connects.

- [#1777](https://github.com/OpenSaasAU/stack/pull/1777) [`e27eb08`](https://github.com/OpenSaasAU/stack/commit/e27eb08524c84ce18725893d4446f8140823cc4c) Thanks [@borisno2](https://github.com/borisno2)! - `opensaas db update` takes `--plan <id>` instead of `--confirm`: the loop prints a destructive plan with its id and applies it only if the plan it re-computes still has that id.

- [#1687](https://github.com/OpenSaasAU/stack/pull/1687) [`604a1dd`](https://github.com/OpenSaasAU/stack/commit/604a1dd9b1229321b8ed85a2eabbb7b1fdb86fbb) Thanks [@borisno2](https://github.com/borisno2)! - Scaffolded server actions derive the session on the server instead of taking a caller-supplied `userId`, which any client could forge.

  Examples without an auth provider (`starter`, `blog`, `custom-field`, `composable-dashboard`) use a demo session that acts as the first user; it is a stand-in for a real auth session, not an access boundary.

- [#1522](https://github.com/OpenSaasAU/stack/pull/1522) [`c322241`](https://github.com/OpenSaasAU/stack/commit/c322241a7a8a293ce6824df13dcb9765cd9479a2) Thanks [@borisno2](https://github.com/borisno2)! - Add a `typecheck` script to every package, covering `tests/**/*` alongside `src/**/*` (not just what `build` compiles), and fix the type errors it surfaced in existing test files.

- [#1420](https://github.com/OpenSaasAU/stack/pull/1420) [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03) Thanks [@borisno2](https://github.com/borisno2)! - Declare the Node >=22.18.0 floor in `engines`.

- [#1837](https://github.com/OpenSaasAU/stack/pull/1837) [`eb1ed04`](https://github.com/OpenSaasAU/stack/commit/eb1ed04cf257d12c5ed24875469d38a5b6be845a) Thanks [@borisno2](https://github.com/borisno2)! - Exit non-zero when a prompt is cancelled, and fail fast naming the missing flags when stdin is not a TTY.

- [#2008](https://github.com/OpenSaasAU/stack/pull/2008) [`ecff0a5`](https://github.com/OpenSaasAU/stack/commit/ecff0a528f0706b0dc08f3d040111b928655280c) Thanks [@borisno2](https://github.com/borisno2)! - Stop the template build copying untracked `.env*` files, `*.db` files and `test-results`/`coverage` from the examples into the published package.

- [#1847](https://github.com/OpenSaasAU/stack/pull/1847) [`ab4499d`](https://github.com/OpenSaasAU/stack/commit/ab4499d0ecc01f27a2aafc50b41536a5d03379a2) Thanks [@borisno2](https://github.com/borisno2)! - Scaffolded projects now ship a `.gitignore` (packed as `gitignore` and renamed on scaffold), and the auth template's `.env` gets a random `BETTER_AUTH_SECRET` with `DISABLE_RATE_LIMITING` unset.

- [#1934](https://github.com/OpenSaasAU/stack/pull/1934) [`5e6cee2`](https://github.com/OpenSaasAU/stack/commit/5e6cee2a279438528809eeca56e1ab36113e9cd6) Thanks [@borisno2](https://github.com/borisno2)! - The basic template enforces its access rules instead of allowing everything: anonymous visitors see published posts only, and only a post's author edits, deletes or reads its `internalNotes`.

- [#1783](https://github.com/OpenSaasAU/stack/pull/1783) [`94ca8b0`](https://github.com/OpenSaasAU/stack/commit/94ca8b0d8a66a23e7ec26924bfc7b66fb24ac98d) Thanks [@dependabot](https://github.com/apps/dependabot)! - Bump `fs-extra` to ^11.4.1

## 0.3.5

### Patch Changes

- [#1041](https://github.com/OpenSaasAU/stack/pull/1041) [`182153c`](https://github.com/OpenSaasAU/stack/commit/182153cb976b14ef67673d0eeef7925d950bfa10) Thanks [@borisno2](https://github.com/borisno2)! - Upgrade Prisma packages to `^7.9.1`, keeping the CLI, client, and driver adapters on the same release. Scaffolded PostgreSQL projects now pin `@prisma/adapter-pg` to `^7.9.1`.

## 0.3.4

### Patch Changes

- [#973](https://github.com/OpenSaasAU/stack/pull/973) [`8f76533`](https://github.com/OpenSaasAU/stack/commit/8f765333e3067c741c69f535927cc82115c60ed1) Thanks [@borisno2](https://github.com/borisno2)! - Comment cleanup only, no behavior change: removed restating/narration comments, kept TSDoc on public config options and field builders, and kept external API/behavior constraint notes (Prisma, S3, Vercel Blob, Keystone parity, Next.js SSR, Zod).

## 0.3.3

### Patch Changes

- [#741](https://github.com/OpenSaasAU/stack/pull/741) [`afa865f`](https://github.com/OpenSaasAU/stack/commit/afa865f62ed7968b494a87e0621cf71bacd36f39) Thanks [@borisno2](https://github.com/borisno2)! - Update documentation links to the restructured docs site URLs (Diátaxis layout)

## 0.3.2

### Patch Changes

- [#664](https://github.com/OpenSaasAU/stack/pull/664) [`37838ef`](https://github.com/OpenSaasAU/stack/commit/37838efbf726b27baa5e1da448d44223c6953e3f) Thanks [@borisno2](https://github.com/borisno2)! - Upgrade TypeScript to v7. `typescript` now resolves to the `@typescript/typescript6` compatibility shim (keeping the classic compiler API available for `typescript-eslint` and Next.js's build-time type-checking, neither of which support TS 7's restructured package yet), while `@typescript-eslint/eslint-plugin` is bumped to 8.63.0 to match. The CLI's Node-build compiler step (ADR-0011) now shells out to `tsc` instead of the removed synchronous `Program` API, using its own pinned native TS 7 binary via a new `@typescript/native` dependency.

## 0.3.1

### Patch Changes

- [#508](https://github.com/OpenSaasAU/stack/pull/508) [`559cb28`](https://github.com/OpenSaasAU/stack/commit/559cb282e304619f24d8549c8f81df03b49c019c) Thanks [@borisno2](https://github.com/borisno2)! - Include `templates/**` in the turbo `build` outputs so a cached build restores the generated templates instead of only `dist/`, fixing the e2e scaffold guard's "Template basic not found" failure on a cache hit.

## 0.3.0

### Minor Changes

- [#433](https://github.com/OpenSaasAU/stack/pull/433) [`3e6c8f5`](https://github.com/OpenSaasAU/stack/commit/3e6c8f5e51c2f2d73b4c17e7d47eed46e4ac93c0) Thanks [@borisno2](https://github.com/borisno2)! - Scaffolded projects are now Claude-Code-ready out of the box. Every template ships an AI bundle — a concise, project-oriented `CLAUDE.md` (the framework's hard rules plus example "ask Claude to build X" prompts) and a `.claude/settings.json` that registers the OpenSaaS MCP server for the project — so your third step is simply to describe a feature to Claude Code.

  The bundle is included when AI tooling is enabled (the default / `--with-ai`). Opting out (declining the prompt) removes the bundle from the generated project via `removeAiTooling`.

- [#429](https://github.com/OpenSaasAU/stack/pull/429) [`e4a1cd5`](https://github.com/OpenSaasAU/stack/commit/e4a1cd5d0255c5114039a85b7c95cd0ee58350a6) Thanks [@borisno2](https://github.com/borisno2)! - Scaffolding now runs setup for you, so the flow is just **scaffold → `pnpm dev` → build with Claude**.

  After copying the template, the CLI runs `install` → `generate` → `db:push` itself, so a new project is ready to run with no further commands. If a step fails it stops and prints a recoverable message naming the failed step and its retry command, instead of leaving a raw stack trace. The final "next steps" now shows the three-step flow and points you at building features with Claude Code.

  Pass `--no-install` (or `--skip-install`) to skip the auto-run and get the full manual command list instead.

- [#463](https://github.com/OpenSaasAU/stack/pull/463) [`09a16db`](https://github.com/OpenSaasAU/stack/commit/09a16db4c375109235c3a1c2d244ebca72231de4) Thanks [@borisno2](https://github.com/borisno2)! - Add an optional `--db postgres` flag (and matching database prompt) to scaffold a PostgreSQL-ready project instead of the SQLite default.

  ```bash
  # PostgreSQL-ready: pg driver adapter, Postgres .env, migrate scripts
  npm create opensaas-app my-app --db postgres

  # Force SQLite and skip the database prompt (unchanged default behaviour)
  npm create opensaas-app my-app --db sqlite
  ```

  With `--db postgres` the generated `opensaas.config.ts` uses the `PrismaPg` driver adapter (`new pg.Pool({ connectionString: process.env.DATABASE_URL })`), the `.env` / `.env.example` carry `DATABASE_URL` (pooled) and `DIRECT_DATABASE_URL` (direct) placeholders, and the `@prisma/adapter-pg` + `pg` dependencies replace the SQLite ones. The `migrate` / `migrate:deploy` scripts are kept so you can apply migrations to your database. Without the flag, SQLite remains the zero-setup default and the interactive prompt offers SQLite (default) or PostgreSQL.

- [#426](https://github.com/OpenSaasAU/stack/pull/426) [`7c8f628`](https://github.com/OpenSaasAU/stack/commit/7c8f628aac038a86f303f9a34f00ff1abe387503) Thanks [@borisno2](https://github.com/borisno2)! - Scaffolded projects now start with a runnable environment file, so `pnpm generate` and `pnpm db:push` work immediately with no manual `.env` setup.

  Previously the basic template shipped an empty `.env` and a PostgreSQL-defaulted `.env.example` even though its config uses SQLite, so the very first documented command failed with `PrismaConfigEnvError: Cannot resolve environment variable: DATABASE_URL`. Now the basic (SQLite) template writes a canonical `.env` (`DATABASE_URL="file:./dev.db"`) plus a matching `.env.example`, and the `--with-auth` template seeds `.env` from its own `.env.example` so the Better-auth variables are preserved.

  The scaffolder's project-name validation, `package.json` version rewriting, and env generation are now pure, unit-tested helpers in `src/lib/`. The unimplemented `--template` flag has been removed so advertised flags match real behaviour.

### Patch Changes

- [#431](https://github.com/OpenSaasAU/stack/pull/431) [`521d91d`](https://github.com/OpenSaasAU/stack/commit/521d91da9480aec626cd4765081fb71f0ca3bc05) Thanks [@borisno2](https://github.com/borisno2)! - Fix the with-auth starter template: align all auth URLs to port 3000 (`.env.example` and the `auth-client` default no longer point at 3003), and make the sign-in / sign-up / forgot-password pages legible in light and dark mode by replacing the dark `bg-gray-500/600` card backgrounds with semantic theme tokens (`bg-card`, `text-card-foreground`, `text-muted-foreground`, `text-primary`).

- [#458](https://github.com/OpenSaasAU/stack/pull/458) [`c7cc2fc`](https://github.com/OpenSaasAU/stack/commit/c7cc2fc9562fb50a9302925978feace14b934511) Thanks [@borisno2](https://github.com/borisno2)! - Replace the in-place scaffold smoke test with an isolated first-run guard that scaffolds the real CLI into an OS temp dir and runs generate + db:push against the workspace toolchain (no network install), and add `--no-auth`/`--no-ai` flags so the CLI can run fully non-interactively.

## 0.2.0

### Minor Changes

- [#107](https://github.com/OpenSaasAU/stack/pull/107) [`f4f3966`](https://github.com/OpenSaasAU/stack/commit/f4f3966faedba07d2cf412fab826d81e30c63a6c) Thanks [@borisno2](https://github.com/borisno2)! - # Add MCP Server for AI-Assisted Development

  ## New Features

  ### CLI Package (@opensaas/stack-cli)
  - **New `opensaas mcp` command group** for AI-assisted development:
    - `opensaas mcp install` - Install MCP server in Claude Code
    - `opensaas mcp uninstall` - Remove MCP server from Claude Code
    - `opensaas mcp start` - Start MCP server directly (for debugging)
  - **Feature-driven development tools**:
    - Interactive feature implementation wizards (authentication, blog, comments, file-upload, semantic-search)
    - Live documentation search from stack.opensaas.au
    - Code generation following OpenSaaS best practices
    - Smart feature suggestions based on your current app
    - Config validation
  - **MCP tools available in Claude Code**:
    - `opensaas_implement_feature` - Start feature wizard
    - `opensaas_feature_docs` - Search documentation
    - `opensaas_list_features` - Browse available features
    - `opensaas_suggest_features` - Get personalized recommendations
    - `opensaas_validate_feature` - Validate implementations

  ### create-opensaas-app
  - **Interactive MCP setup prompt** during project creation
  - Option to enable AI development tools automatically
  - Automatic installation of MCP server if user opts in
  - Helpful instructions if MCP installation is declined or fails

  ## Installation

  Enable AI development tools for an existing project:

  ```bash
  npx @opensaas/stack-cli mcp install
  ```

  Or during project creation:

  ```bash
  npm create opensaas-app@latest my-app
  # When prompted: Enable AI development tools? → yes
  ```

  ## Benefits
  - **Build apps faster**: Describe what you want to build, get complete implementations
  - **Feature-driven development**: Work with high-level features instead of low-level config
  - **Best practices baked in**: Generated code follows OpenSaaS Stack patterns
  - **Live documentation**: Always up-to-date docs from the official site
  - **Single toolkit**: All developer commands in one CLI

  ## Example Usage

  With Claude Code installed and the MCP server enabled, you can:

  ```
  You: "I want to build a food tracking app"

  Claude Code uses MCP tools to:
  1. Ask clarifying questions about requirements
  2. Implement authentication feature (wizard)
  3. Create custom Food and FoodLog lists
  4. Generate complete code with UI and access control
  5. Provide testing and deployment guidance
  ```

## 0.1.7

## 0.1.6

## 0.1.5

## 0.1.4

### Patch Changes

- d2d1720: fix package templates

## 0.1.3

### Patch Changes

- efe2357: Fix dependencies
- efe2357: fix getting started package imports

## 0.1.2

### Patch Changes

- 63197c6: Fix package versions
