---
'@opensaas/stack-core': minor
'@opensaas/stack-auth': minor
'create-opensaas-app': patch
---

Every session a host builds carries an actor, so access rules and hooks can tell a person on the web from an agent acting for one

`session.actor` is a reserved key. The procedure HTTP host sets a human actor and the MCP handler sets an agent actor. The host assigns it last, so a token claim, a session provider or a `getSession` result named `actor` has no effect.

```typescript
import type { AccessControl } from '@opensaas/stack-core'

// { kind: 'human', userId, via: 'web' }
const humansOnly: AccessControl = ({ session }) => session?.actor?.kind === 'human'

// { kind: 'agent', clientId, onBehalfOf, via: 'mcp' }
const trustedAgent: AccessControl = ({ session }) =>
  session?.actor?.kind === 'agent' && session.actor.clientId === 'my-first-party-client'
```

An agent's session keeps the user's `userId`, so rules that scope by it still limit the agent to what that user can do. A session no host built (`getContext(session)` in a server component, `withSession`, a test context) has no actor, and an absent actor is never human: check `=== 'human'` or `=== 'agent'`, never `!== 'agent'`. The actor is the same frozen object in access rules, hooks and `context.transaction()`.

**This can break an existing custom MCP session provider.** `McpSession` now requires `clientId`, the OAuth client id the provider verified. A provider that returns a session without one fails to compile, and at runtime every request it authenticates is answered `401`. Return the client the credential was issued to, read from the part the authorization server controls and never from a custom claim:

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

Other changes that can affect an app:

- `createProcedureHandler` fails a call with `INTERNAL` when `getSession` resolves a session whose `userId` is not a non-empty string, because it cannot say who is acting.
- `getSessionFromAuth` throws when `sessionFields` names `actor`.
- `Session` now declares `actor`, so a `Session` augmentation must not redeclare it, and a rule annotated with an inline all-optional session type (`{ session: { role?: string } | null }`) no longer accepts `Session`. Annotate with `Session` or `AccessControl`.
