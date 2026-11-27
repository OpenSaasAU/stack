---
'@opensaas/stack-core': minor
'@opensaas/stack-auth': minor
---

Every session a host builds carries an actor, so access rules and hooks can tell a person on the web from an agent acting for one

`session.actor` is a reserved key. The procedure HTTP host sets a human actor and the MCP handler sets an agent actor. Only a host can set it: an `actor` no host created, whether from a token claim, a session provider, a `getSession` result or an object application code passes to `getContext` or `withSession`, is removed before the session reaches an access rule or a hook, and reads as absent.

```typescript
import type { AccessControl } from '@opensaas/stack-core'

// { kind: 'human', userId, via: 'web' }
const humansOnly: AccessControl = ({ session }) => session?.actor?.kind === 'human'

// { kind: 'agent', clientId, onBehalfOf, via: 'mcp' }
const trustedAgent: AccessControl = ({ session }) =>
  session?.actor?.kind === 'agent' && session.actor.clientId === 'my-first-party-client'
```

An agent's session keeps the user's `userId`, so rules that scope by it still limit the agent to what that user can do. A session no host built (`getContext(session)` in a server component, `withSession`, a test context) has no actor, and an absent actor is never human: check `=== 'human'` or `=== 'agent'`, never `!== 'agent'`. The actor is the same frozen object in access rules, hooks, `sudo()` and `context.transaction()`.

`context.session` is now a frozen shallow copy of the session you pass, so assigning to it (`context.session.role = …`) throws. The object you passed is not frozen or changed. Rebinding it (`context.session = …`) throws `TypeError` on every context, including the ones hooks, access rules and `context.transaction()` callbacks receive.

A session must therefore be plain data, or an instance of a class with no private (`#`) fields and no methods that write to it. The copy keeps the prototype but never runs the constructor, so a `Map`, `Date` or array session, or a class reading private state, no longer works.

**This can break an existing custom MCP session provider.** `McpSession` now requires `clientId`, the OAuth client id the provider verified. A provider that returns a session without one fails to compile, and at runtime every request it authenticates is answered `500`, with the missing field named in the server log (`401` stays the answer for no session). Return the client the credential was issued to, read from the part the authorization server controls and never from a custom claim:

```typescript
import type { McpSessionProvider } from '@opensaas/stack-core/mcp'

declare function verifyToken(
  request: Request,
): Promise<{ subject: string; clientId: string; scopes: string[] } | null>

export const getSession: McpSessionProvider = async (request) => {
  const verified = await verifyToken(request)
  if (verified === null) return null
  return { userId: verified.subject, clientId: verified.clientId, scopes: verified.scopes }
}
```

`createBetterAuthMcpAdapter` needs no change in your app: it now carries the verified token's `azp` as `clientId` and refuses a token without one. `clientId` and `actor` are no longer usable as custom claim names or flat session fields over MCP.

A context built under `withMcpAuth` carries the agent actor too: `mcpSessionToContextSession` now returns `{ userId, actor }`. For a custom provider, `mcpContextSession` from `@opensaas/stack-core/mcp` builds the session the MCP handler builds.

Other changes that can affect an app:

- `createProcedureHandler` fails a call with `INTERNAL` when `getSession` resolves a session with no usable `userId`, because it cannot say who is acting. `userId` must be an own property holding a non-empty string or a finite number. With `@opensaas/stack-auth`, `authPlugin({ sessionFields })` must include `userId` for an app that serves procedures; nothing refuses a config without it at startup, and the reported error names the fix.
- `sessionFields` naming `actor` is refused when the auth instance is created, and by `getSessionFromAuth`.
- `Session` now declares `actor`, so a `Session` augmentation must not redeclare it, and a rule annotated with an inline all-optional session type (`{ session: { role?: string } | null }`) no longer accepts `Session`. Annotate with `Session` or `AccessControl`.
