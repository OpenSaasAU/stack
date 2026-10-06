import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { generateKeyPairSync, sign } from 'node:crypto'
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import {
  createBetterAuthMcpAdapter,
  withMcpAuth,
  mcpSessionToContextSession,
  hasScopes,
  isSessionExpired,
  createOAuthDiscoveryHandler,
  createOAuthProtectedResourceHandler,
} from '../src/mcp/better-auth.js'
import type { BetterAuthInstance, BetterAuthMcpOptions } from '../src/mcp/better-auth.js'
import type { McpSession } from '@opensaas/stack-core/mcp'

describe('Better Auth MCP Adapter', () => {
  describe('token verification', () => {
    const resource = 'http://localhost:3000/api/mcp'
    const baseURL = 'http://localhost:3000/api/auth'
    const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
    const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'ES256', use: 'sig' }
    let server: Server
    let options: BetterAuthMcpOptions

    beforeAll(async () => {
      server = createServer((_, res) => {
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify({ keys: [jwk] }))
      })
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
      const { port } = server.address() as AddressInfo
      options = { resource, baseURL, jwksUrl: `http://127.0.0.1:${port}/jwks` }
    })

    afterAll(() => {
      server.close()
    })

    const b64 = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url')

    function mint(claims: Record<string, unknown>): string {
      const now = Math.floor(Date.now() / 1000)
      const body = { iss: baseURL, aud: resource, iat: now, exp: now + 300, ...claims }
      const signingInput = `${b64({ alg: 'ES256', typ: 'JWT', kid: 'k1' })}.${b64(body)}`
      const signature = sign('sha256', Buffer.from(signingInput), {
        key: privateKey,
        dsaEncoding: 'ieee-p1363',
      })
      return `${signingInput}.${signature.toString('base64url')}`
    }

    const bearer = (token: string) => new Headers({ Authorization: `Bearer ${token}` })

    it('maps a valid token to a session', async () => {
      const token = mint({ sub: 'user-123', scope: 'read write' })
      const session = await createBetterAuthMcpAdapter(options)(bearer(token))

      expect(session).toMatchObject({
        userId: 'user-123',
        scopes: ['read', 'write'],
        accessToken: token,
      })
      expect(session?.expiresAt).toBeInstanceOf(Date)
    })

    it('forwards signed custom claims into the session', async () => {
      const token = mint({ sub: 'user-123', role: 'admin', email: 'a@b.co' })
      const session = await createBetterAuthMcpAdapter(options)(bearer(token))

      expect(session).toMatchObject({ userId: 'user-123', role: 'admin', email: 'a@b.co' })
    })

    it('drops registered JWT claims but keeps custom ones', async () => {
      const token = mint({
        sub: 'user-123',
        jti: 'j1',
        azp: 'client',
        client_id: 'client',
        sid: 's1',
        nbf: 1,
        role: 'admin',
      })
      const session = await createBetterAuthMcpAdapter(options)(bearer(token))

      expect(session).toMatchObject({ userId: 'user-123', role: 'admin' })
      for (const claim of ['iss', 'aud', 'iat', 'nbf', 'jti', 'azp', 'client_id', 'sid']) {
        expect(session).not.toHaveProperty(claim)
      }
    })

    it('does not let a claim override the userId', async () => {
      const token = mint({ sub: 'user-123', userId: 'someone-else' })
      const session = await createBetterAuthMcpAdapter(options)(bearer(token))

      expect(session?.userId).toBe('user-123')
    })

    it('returns null without a token', async () => {
      expect(await createBetterAuthMcpAdapter(options)(new Headers())).toBeNull()
    })

    it('rejects a token for another audience', async () => {
      const token = mint({ sub: 'user-123', aud: 'http://localhost:3000/api/other' })
      expect(await createBetterAuthMcpAdapter(options)(bearer(token))).toBeNull()
    })

    it('rejects an expired token', async () => {
      const past = Math.floor(Date.now() / 1000) - 3600
      const token = mint({ sub: 'user-123', iat: past - 60, exp: past })
      expect(await createBetterAuthMcpAdapter(options)(bearer(token))).toBeNull()
    })

    it('rejects a token from another issuer', async () => {
      const token = mint({ sub: 'user-123', iss: 'http://evil.example/api/auth' })
      expect(await createBetterAuthMcpAdapter(options)(bearer(token))).toBeNull()
    })

    it('rejects a token signed by another key', async () => {
      const other = generateKeyPairSync('ec', { namedCurve: 'P-256' })
      const signingInput = `${b64({ alg: 'ES256', typ: 'JWT', kid: 'k1' })}.${b64({
        iss: baseURL,
        aud: resource,
        sub: 'user-123',
        exp: Math.floor(Date.now() / 1000) + 300,
      })}`
      const signature = sign('sha256', Buffer.from(signingInput), {
        key: other.privateKey,
        dsaEncoding: 'ieee-p1363',
      })
      const token = `${signingInput}.${signature.toString('base64url')}`
      expect(await createBetterAuthMcpAdapter(options)(bearer(token))).toBeNull()
    })

    it('withMcpAuth challenges a verified token that has no subject', async () => {
      const handler = vi.fn(async () => new Response('OK'))
      const response = await withMcpAuth(
        options,
        handler,
      )(new Request(resource, { headers: bearer(mint({})) }))

      expect(response.status).toBe(401)
      expect(response.headers.get('WWW-Authenticate')).toContain('Bearer')
      expect(handler).not.toHaveBeenCalled()
    })

    it('withMcpAuth calls the handler with the session', async () => {
      const handler = vi.fn(async () => new Response('OK'))
      const response = await withMcpAuth(
        options,
        handler,
      )(new Request(resource, { headers: bearer(mint({ sub: 'user-123' })) }))

      expect(response.status).toBe(200)
      expect(handler).toHaveBeenCalledWith(
        expect.any(Request),
        expect.objectContaining({
          userId: 'user-123',
          accessToken: expect.any(String),
          expiresAt: expect.any(Date),
        }),
      )
    })

    it('withMcpAuth answers 401 with a challenge and skips the handler', async () => {
      const handler = vi.fn(async () => new Response('OK'))
      const response = await withMcpAuth(options, handler)(new Request(resource))

      expect(response.status).toBe(401)
      expect(response.headers.get('WWW-Authenticate')).toContain('Bearer')
      expect(handler).not.toHaveBeenCalled()
    })
  })

  describe('mcpSessionToContextSession', () => {
    it('should extract userId from MCP session', () => {
      const mcpSession: McpSession = {
        userId: 'user-456',
        scopes: ['admin'],
        accessToken: 'token-abc',
      }

      const contextSession = mcpSessionToContextSession(mcpSession)

      expect(contextSession).toEqual({ userId: 'user-456' })
    })

    it('should work with minimal session', () => {
      const mcpSession: McpSession = {
        userId: 'user-789',
      }

      const contextSession = mcpSessionToContextSession(mcpSession)

      expect(contextSession).toEqual({ userId: 'user-789' })
    })
  })

  describe('hasScopes', () => {
    it('should return true when all required scopes are present', () => {
      const session: McpSession = {
        userId: 'user-123',
        scopes: ['read', 'write', 'delete'],
      }

      expect(hasScopes(session, ['read'])).toBe(true)
      expect(hasScopes(session, ['read', 'write'])).toBe(true)
      expect(hasScopes(session, ['write', 'delete'])).toBe(true)
    })

    it('should return false when some required scopes are missing', () => {
      const session: McpSession = {
        userId: 'user-123',
        scopes: ['read'],
      }

      expect(hasScopes(session, ['write'])).toBe(false)
      expect(hasScopes(session, ['read', 'write'])).toBe(false)
    })

    it('should return false when session has no scopes', () => {
      const session: McpSession = {
        userId: 'user-123',
      }

      expect(hasScopes(session, ['read'])).toBe(false)
    })

    it('should return false when scopes array is empty', () => {
      const session: McpSession = {
        userId: 'user-123',
        scopes: [],
      }

      expect(hasScopes(session, ['read'])).toBe(false)
    })

    it('should return true when no scopes are required', () => {
      const session: McpSession = {
        userId: 'user-123',
        scopes: ['read'],
      }

      expect(hasScopes(session, [])).toBe(true)
    })
  })

  describe('isSessionExpired', () => {
    it('should return true when session is expired', () => {
      const pastDate = new Date()
      pastDate.setHours(pastDate.getHours() - 1) // 1 hour ago

      const session: McpSession = {
        userId: 'user-123',
        expiresAt: pastDate,
      }

      expect(isSessionExpired(session)).toBe(true)
    })

    it('should return false when session is not expired', () => {
      const futureDate = new Date()
      futureDate.setHours(futureDate.getHours() + 1) // 1 hour from now

      const session: McpSession = {
        userId: 'user-123',
        expiresAt: futureDate,
      }

      expect(isSessionExpired(session)).toBe(false)
    })

    it('should return false when no expiresAt is set', () => {
      const session: McpSession = {
        userId: 'user-123',
      }

      expect(isSessionExpired(session)).toBe(false)
    })
  })

  describe('createOAuthDiscoveryHandler', () => {
    it('should create a handler that proxies to Better Auth', async () => {
      const mockAuth: BetterAuthInstance = {
        api: {},
      }

      const handler = createOAuthDiscoveryHandler(mockAuth)

      // Mock fetch to capture the proxy call
      const originalFetch = global.fetch
      const mockFetch = vi.fn(async () => new Response('{"issuer":"http://localhost"}'))
      global.fetch = mockFetch as typeof fetch

      const request = new Request('http://localhost/.well-known/oauth-authorization-server')
      await handler(request)

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost/api/auth/.well-known/oauth-authorization-server',
        expect.any(Object),
      )

      // Restore original fetch
      global.fetch = originalFetch
    })
  })

  describe('createOAuthProtectedResourceHandler', () => {
    it('should create a handler that proxies to Better Auth', async () => {
      const mockAuth: BetterAuthInstance = {
        api: {},
      }

      const handler = createOAuthProtectedResourceHandler(mockAuth)

      // Mock fetch to capture the proxy call
      const originalFetch = global.fetch
      const mockFetch = vi.fn(async () => new Response('{"resource":"http://localhost"}'))
      global.fetch = mockFetch as typeof fetch

      const request = new Request('http://localhost/.well-known/oauth-protected-resource')
      await handler(request)

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost/api/auth/.well-known/oauth-protected-resource',
        expect.any(Object),
      )

      // Restore original fetch
      global.fetch = originalFetch
    })
  })
})
