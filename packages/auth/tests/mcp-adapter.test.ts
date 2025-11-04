import { describe, it, expect, vi } from 'vitest'
import {
  createBetterAuthMcpAdapter,
  withMcpAuth,
  mcpSessionToContextSession,
  hasScopes,
  isSessionExpired,
  createOAuthDiscoveryHandler,
  createOAuthProtectedResourceHandler,
} from '../src/mcp/better-auth.js'
import type { BetterAuthInstance } from '../src/mcp/better-auth.js'
import type { McpSession } from '@opensaas/stack-core/mcp'

describe('Better Auth MCP Adapter', () => {
  describe('createBetterAuthMcpAdapter', () => {
    it('should create a session provider from Better Auth instance', async () => {
      const mockSession: McpSession = {
        userId: 'user-123',
        scopes: ['read', 'write'],
      }

      const mockAuth: BetterAuthInstance = {
        api: {
          getMcpSession: vi.fn(async () => mockSession),
        },
      }

      const adapter = createBetterAuthMcpAdapter(mockAuth)
      expect(typeof adapter).toBe('function')

      const headers = new Headers({ Authorization: 'Bearer token123' })
      const session = await adapter(headers)

      expect(session).toEqual(mockSession)
      expect(mockAuth.api.getMcpSession).toHaveBeenCalledWith({ headers })
    })

    it('should return null when no session exists', async () => {
      const mockAuth: BetterAuthInstance = {
        api: {
          getMcpSession: vi.fn(async () => null),
        },
      }

      const adapter = createBetterAuthMcpAdapter(mockAuth)
      const headers = new Headers()
      const session = await adapter(headers)

      expect(session).toBeNull()
    })
  })

  describe('withMcpAuth', () => {
    it('should wrap handler with authentication', async () => {
      const mockSession: McpSession = {
        userId: 'user-123',
        scopes: ['read'],
      }

      const mockAuth: BetterAuthInstance = {
        api: {
          getMcpSession: vi.fn(async () => mockSession),
        },
      }

      const mockHandler = vi.fn(async () => new Response('OK'))
      const wrappedHandler = withMcpAuth(mockAuth, mockHandler)

      const request = new Request('http://localhost/api', {
        headers: { Authorization: 'Bearer token123' },
      })

      const response = await wrappedHandler(request)

      expect(mockHandler).toHaveBeenCalledWith(request, mockSession)
      expect(response.status).not.toBe(401)
    })

    it('should return 401 when no session exists', async () => {
      const mockAuth: BetterAuthInstance = {
        api: {
          getMcpSession: vi.fn(async () => null),
        },
      }

      const mockHandler = vi.fn(async () => new Response('OK'))
      const wrappedHandler = withMcpAuth(mockAuth, mockHandler)

      const request = new Request('http://localhost/api')
      const response = await wrappedHandler(request)

      expect(response.status).toBe(401)
      expect(response.headers.get('WWW-Authenticate')).toContain('Bearer')
      expect(mockHandler).not.toHaveBeenCalled()
    })

    it('should pass through handler response', async () => {
      const mockSession: McpSession = {
        userId: 'user-123',
        scopes: [],
      }

      const mockAuth: BetterAuthInstance = {
        api: {
          getMcpSession: vi.fn(async () => mockSession),
        },
      }

      const mockResponse = new Response('Custom Response', { status: 200 })
      const mockHandler = vi.fn(async () => mockResponse)
      const wrappedHandler = withMcpAuth(mockAuth, mockHandler)

      const request = new Request('http://localhost/api', {
        headers: { Authorization: 'Bearer token123' },
      })

      const response = await wrappedHandler(request)

      expect(response).toBe(mockResponse)
      expect(await response.text()).toBe('Custom Response')
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

  describe('Integration scenarios', () => {
    it('should support full auth flow with scopes and expiration', async () => {
      const futureDate = new Date()
      futureDate.setHours(futureDate.getHours() + 1)

      const mockSession: McpSession = {
        userId: 'user-123',
        scopes: ['read:posts', 'write:posts', 'admin'],
        accessToken: 'token-abc-123',
        expiresAt: futureDate,
      }

      const mockAuth: BetterAuthInstance = {
        api: {
          getMcpSession: vi.fn(async () => mockSession),
        },
      }

      const adapter = createBetterAuthMcpAdapter(mockAuth)
      const headers = new Headers({ Authorization: 'Bearer token-abc-123' })
      const session = await adapter(headers)

      // Verify session was retrieved
      expect(session).toBeTruthy()
      expect(session?.userId).toBe('user-123')

      // Verify scopes
      expect(hasScopes(session!, ['read:posts'])).toBe(true)
      expect(hasScopes(session!, ['read:posts', 'write:posts'])).toBe(true)
      expect(hasScopes(session!, ['read:posts', 'write:posts', 'delete:posts'])).toBe(false)

      // Verify expiration
      expect(isSessionExpired(session!)).toBe(false)

      // Verify context session conversion
      const contextSession = mcpSessionToContextSession(session!)
      expect(contextSession.userId).toBe('user-123')
    })

    it('should handle expired session with valid scopes', async () => {
      const pastDate = new Date()
      pastDate.setHours(pastDate.getHours() - 1)

      const mockSession: McpSession = {
        userId: 'user-123',
        scopes: ['read', 'write'],
        expiresAt: pastDate,
      }

      const mockAuth: BetterAuthInstance = {
        api: {
          getMcpSession: vi.fn(async () => mockSession),
        },
      }

      const adapter = createBetterAuthMcpAdapter(mockAuth)
      const headers = new Headers({ Authorization: 'Bearer expired-token' })
      const session = await adapter(headers)

      // Session is returned (Better Auth handles validity)
      expect(session).toBeTruthy()

      // But application can check expiration
      expect(isSessionExpired(session!)).toBe(true)

      // Scopes are still valid
      expect(hasScopes(session!, ['read'])).toBe(true)
    })
  })
})
