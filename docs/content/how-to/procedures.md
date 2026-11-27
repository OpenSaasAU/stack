# Procedures

A **procedure** is a named action, defined once, that the web and agents call through the same pipeline: the same input parsing, access rule, declared failures, result shape and output redaction. Reads stay on `context.db` in server components; procedures are for actions. The `create-opensaas-app` auth template (`examples/starter-auth`) is wired this way, and its four post mutations are procedures. See ADR-0086 for the decisions behind the design.

## Define a procedure

`pnpm generate` writes `.opensaas/procedures.ts`, a builder typed to your own context. Collect your procedures in a registry module:

```typescript
// lib/procedures.ts
import * as z from 'zod'
import type { ProcedureRegistry } from '@opensaas/stack-core/procedures'
import { procedure } from '@/.opensaas/procedures'
import type { Context } from '@/.opensaas/types'

export const publishPost = procedure({
  description: 'Publish a post. Only its author can.',
  input: z.object({ id: z.string() }),
  output: z.object({ id: z.string(), status: z.enum(['draft', 'published']) }),
  failures: { NOT_FOUND: 'Post not found, or you cannot change it' },
  access: ({ session }) => session?.actor?.kind === 'human',
  expose: ['web'],
  run: async ({ input, context, fail }) => {
    const post = await context.db.Post.update({
      where: { id: input.id },
      data: { status: 'published' },
    })
    if (post === null) throw fail('NOT_FOUND')
    return post
  },
})

export const procedures = { publishPost } satisfies ProcedureRegistry<Context>
```

- `description`, `input`, `output`, `access` and `expose` are required. A missing access rule cannot mean public: a procedure open to anonymous callers returns `true` for a `null` session, so it is visible in review.
- `expose` names the surfaces that serve the procedure: `'web'`, `'mcp'` or both. A procedure reaches an agent only when it says `'mcp'`; see [MCP](/docs/how-to/mcp).
- `output` is parsed before the result leaves the host, so the keys it does not declare (here, every column but `id` and `status`) never reach a caller.
- `fail` is typed to the codes in `failures`. Throw it: inside `context.transaction` a throw rolls the transaction back. `run` opens no transaction of its own.
- Use `satisfies`, not an annotation, so each name keeps its own input, output and failure types.
- List access and hooks still run on every `context.db` call inside `run`. Here `update` returns `null` for a post the caller does not author, because the list's own `update` rule scopes it.

## Check the actor positively

Every session a host builds carries an `actor`: `{ kind: 'human', userId, via: 'web' }` from the web hosts, `{ kind: 'agent', clientId, onBehalfOf, via: 'mcp' }` from the MCP handler. Check for the kind you want:

```typescript
import type { AccessControl } from '@opensaas/stack-core'

const humansOnly: AccessControl = ({ session }) => session?.actor?.kind === 'human'
```

`session?.actor?.kind !== 'agent'` is not a test for a person: a session no host built carries no actor, and that rule would admit it. See [Who Is Acting: the Actor](/docs/concepts/access-control) for which callers carry an actor and which do not, the Admin UI included unless it is given the session-resolved context.

## A rule written only in a procedure is not an invariant

The Admin UI and any MCP write tool a list enables can change the same list without calling your procedure. A rule that must always hold, such as "only the author edits a post" or "a title never contains spam", belongs in the list's access control or a `validate` hook, where every path meets it. The procedure's own `access` and `run` decide only what that procedure does. In the starter, the author check is the `Post` list's `update` and `delete` access and the spam check is its `validateInput` hook; the procedures add nothing the list does not already enforce, so the admin and the procedures agree.

## Wire the hosts in one module

One module imports the generated context factory. It creates the hosts and exports what the rest of the app uses:

```typescript
// lib/server.ts
import { createProcedureHandler, createServerCaller } from '@opensaas/stack-core/procedures'
import { config, getContext } from '@/.opensaas/context'
import { getSession, getSessionFromHeaders } from '@/lib/auth'
import { procedures } from '@/lib/procedures'

const resolvedConfig = await config

const server = createServerCaller({
  procedures,
  config: resolvedConfig,
  getContext,
  getSession,
})

export const callProcedure = server.call
export const getServerContext = server.context

export const handleProcedureRequest = createProcedureHandler({
  procedures,
  config: resolvedConfig,
  getContext,
  getSession: (request) => getSessionFromHeaders(request.headers),
  allowedOrigins: [process.env.BETTER_AUTH_URL || 'http://localhost:3000'],
})
```

`getSession` takes no argument: it reads the request's own cookies. Nothing a caller passes can choose the session.

The starter's `lib/server.ts` goes one step further for `allowedOrigins`: an unset or empty `BETTER_AUTH_URL` falls back to `http://localhost:3000` in development, and in production the module throws when it loads, naming the variable, rather than accepting cookie calls from localhost only.

```typescript
// app/api/procedures/[name]/route.ts
import { handleProcedureRequest } from '@/lib/server'

export const POST = handleProcedureRequest
```

The HTTP host refuses a cookie request from an origin not in `allowedOrigins`, and any request carrying an `Authorization` header. With Next's default `trailingSlash: false`, a request to `/api/procedures/<name>/` is redirected with a 308 to the path without the slash before it reaches the host.

## Read in a server component

```typescript
// app/posts/page.tsx
import { getServerContext } from '@/lib/server'

export default async function PostsPage() {
  const context = await getServerContext()
  const posts = await context.db.Post.orderBy({ title: 'asc' }).all()
  return posts.map((post) => post.title).join(', ')
}
```

`getServerContext()` carries the same human actor a procedure call does, so a page and a procedure for the same person get the same answer from a rule that checks for humans. Give the Admin UI this context too, both for its `context` prop and inside its server action.

## Call from a server action

A server action that remains only calls a procedure and then redirects, revalidates or sets cookies:

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

## Call from the browser

The typed client imports the registry's type only, so no server code reaches the bundle:

```tsx
// app/posts/publish-button.tsx
'use client'

import { useRouter } from 'next/navigation'
import { createProcedureClient } from '@opensaas/stack-core/procedures/client'
import type { procedures } from '@/lib/procedures'

const callProcedure = createProcedureClient<typeof procedures>()

export function PublishButton({ id }: { id: string }) {
  const router = useRouter()
  return (
    <button
      onClick={async () => {
        const result = await callProcedure('publishPost', { id })
        if (result.success) router.refresh()
        else alert(result.error.message)
      }}
    >
      Publish
    </button>
  )
}
```

A renamed procedure or input field is a compile error. A failure resolves with `error.code`: a reserved code (`UNAUTHENTICATED`, `DENIED`, `INVALID_INPUT`, `VALIDATION`, `RETRY`, `CONFLICT`, `INTERNAL`), one the procedure declares, or `'transport'` when the request was not answered by the host.

## The lint guardrails

The auth template's `eslint.config.js` adds three rules, run by `pnpm lint` over every TypeScript and JavaScript source file (`.ts`, `.tsx`, `.mts`, `.cts`, `.js`, `.jsx`, `.mjs`, `.cjs`):

- **The context factory.** Only `lib/server.ts` may import `getContext` from `.opensaas/context`, and only `lib/auth.ts` may import `rawOpensaasContext` (for better-auth's adapter). Any other import, or a re-export, is an error. Importing `config` stays allowed.
- **`'use server'`.** The directive is allowed only in `lib/actions/*.ts` and the admin page. Anywhere else, at the top of a file or inside a function, it is an error.
- **No session switching in a server action.** In those same files, a call to `.withSession(` or `.sudo(` is an error. The context `getServerContext()` returns still has both, and a server action is a public endpoint, so `(await getServerContext()).withSession({ userId })` with `userId` taken from an argument would let any caller act as any user. A server action calls a procedure instead.

**These rules are a guardrail, not a security boundary.** They keep the wiring in one place by default, so an arbitrary session is hard to introduce by accident. Code in the same process can still reach the factory another way, for example through a dynamic `import()`, a file the config ignores, by passing a context to a helper module that calls `withSession` for it, or by disabling the rule. What protects data is the access control on each list and each procedure, which runs whichever way the code was reached. Change the file names in `eslint.config.js` when you move the wiring module or add an actions file.
