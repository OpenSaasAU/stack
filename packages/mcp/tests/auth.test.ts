import { describe, it, expect, vi } from 'vitest'
import {
  withMcpAuth,
  mcpSessionToContextSession,
  hasScopes,
  isSessionExpired,
} from '../src/auth/better-auth.js'
import type { BetterAuthInstance, McpSession } from '../src/auth/better-auth.js'

describe('MCP Auth utilities', () => {
  describe('withMcpAuth', () => {
    it('should authenticate request and call handler with session', async () => {
      const mockSession: McpSession = {
        userId: 'user-123',
        scopes: ['read', 'write'],
      }

      const mockAuth: BetterAuthInstance = {
        api: {
          getMcpSession: vi.fn(async () => mockSession),
        },
      }

      const mockHandler = vi.fn(async (_req, _session) => new Response('success'))

      const wrappedHandler = withMcpAuth(mockAuth, mockHandler)

      const request = new Request('http://localhost/api/mcp', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer valid-token',
          'Content-Type': 'application/json',
        },
      })

      const response = await wrappedHandler(request)

      expect(mockAuth.api.getMcpSession).toHaveBeenCalledWith({
        headers: request.headers,
      })
      expect(mockHandler).toHaveBeenCalledWith(request, mockSession)
      expect(await response.text()).toBe('success')
    })

    it('should return 401 when no session is found', async () => {
      const mockAuth: BetterAuthInstance = {
        api: {
          getMcpSession: vi.fn(async () => null),
        },
      }

      const mockHandler = vi.fn(async () => new Response('should not be called'))

      const wrappedHandler = withMcpAuth(mockAuth, mockHandler)

      const request = new Request('http://localhost/api/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })

      const response = await wrappedHandler(request)

      expect(response.status).toBe(401)
      expect(response.headers.get('WWW-Authenticate')).toContain('Bearer')
      expect(response.headers.get('WWW-Authenticate')).toContain('invalid_token')
      expect(mockHandler).not.toHaveBeenCalled()
    })

    it('should pass through handler errors', async () => {
      const mockSession: McpSession = {
        userId: 'user-123',
      }

      const mockAuth: BetterAuthInstance = {
        api: {
          getMcpSession: vi.fn(async () => mockSession),
        },
      }

      const mockHandler = vi.fn(async () => {
        throw new Error('Handler error')
      })

      const wrappedHandler = withMcpAuth(mockAuth, mockHandler)

      const request = new Request('http://localhost/api/mcp', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer valid-token',
        },
      })

      await expect(wrappedHandler(request)).rejects.toThrow('Handler error')
    })
  })

  describe('mcpSessionToContextSession', () => {
    it('should convert MCP session to context session', () => {
      const mcpSession: McpSession = {
        userId: 'user-123',
        scopes: ['read', 'write'],
        accessToken: 'token-abc',
        expiresAt: new Date('2025-12-31'),
        customField: 'custom-value',
      }

      const contextSession = mcpSessionToContextSession(mcpSession)

      expect(contextSession).toEqual({
        userId: 'user-123',
      })
    })

    it('should handle minimal MCP session', () => {
      const mcpSession: McpSession = {
        userId: 'user-456',
      }

      const contextSession = mcpSessionToContextSession(mcpSession)

      expect(contextSession).toEqual({
        userId: 'user-456',
      })
    })
  })

  describe('hasScopes', () => {
    it('should return true when session has all required scopes', () => {
      const session: McpSession = {
        userId: 'user-123',
        scopes: ['read', 'write', 'delete'],
      }

      expect(hasScopes(session, ['read'])).toBe(true)
      expect(hasScopes(session, ['read', 'write'])).toBe(true)
      expect(hasScopes(session, ['write', 'read'])).toBe(true)
    })

    it('should return false when session is missing required scopes', () => {
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

    it('should return false when session has undefined scopes', () => {
      const session: McpSession = {
        userId: 'user-123',
        scopes: undefined,
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

    it('should handle empty scopes array', () => {
      const session: McpSession = {
        userId: 'user-123',
        scopes: [],
      }

      expect(hasScopes(session, ['read'])).toBe(false)
      expect(hasScopes(session, [])).toBe(true)
    })
  })

  describe('isSessionExpired', () => {
    it('should return false when session has no expiration', () => {
      const session: McpSession = {
        userId: 'user-123',
      }

      expect(isSessionExpired(session)).toBe(false)
    })

    it('should return false when session has not expired', () => {
      const futureDate = new Date()
      futureDate.setFullYear(futureDate.getFullYear() + 1)

      const session: McpSession = {
        userId: 'user-123',
        expiresAt: futureDate,
      }

      expect(isSessionExpired(session)).toBe(false)
    })

    it('should return true when session has expired', () => {
      const pastDate = new Date()
      pastDate.setFullYear(pastDate.getFullYear() - 1)

      const session: McpSession = {
        userId: 'user-123',
        expiresAt: pastDate,
      }

      expect(isSessionExpired(session)).toBe(true)
    })

    it('should return true when session expires exactly now', () => {
      const pastDate = new Date()
      pastDate.setMilliseconds(pastDate.getMilliseconds() - 1)

      const session: McpSession = {
        userId: 'user-123',
        expiresAt: pastDate,
      }

      const result = isSessionExpired(session)
      expect(result).toBe(true)
    })
  })

  describe('OAuth discovery handlers', () => {
    it('should create OAuth authorization server discovery handler', async () => {
      const { createOAuthDiscoveryHandler } = await import('../src/auth/better-auth.js')

      const mockAuth: BetterAuthInstance = {
        api: {},
      }

      const handler = createOAuthDiscoveryHandler(mockAuth)

      // Mock the global fetch
      const mockFetch = vi.fn(async () =>
        Response.json({
          issuer: 'http://localhost:3000/api/auth',
          authorization_endpoint: 'http://localhost:3000/api/auth/authorize',
        }),
      )
      global.fetch = mockFetch

      const request = new Request('http://localhost/.well-known/oauth-authorization-server', {
        method: 'GET',
        headers: { Accept: 'application/json' },
      })

      const response = await handler(request)

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost/api/auth/.well-known/oauth-authorization-server',
        { headers: request.headers },
      )
      expect(response).toBeDefined()
    })

    it('should create OAuth protected resource discovery handler', async () => {
      const { createOAuthProtectedResourceHandler } = await import('../src/auth/better-auth.js')

      const mockAuth: BetterAuthInstance = {
        api: {},
      }

      const handler = createOAuthProtectedResourceHandler(mockAuth)

      // Mock the global fetch
      const mockFetch = vi.fn(async () =>
        Response.json({
          resource: 'http://localhost:3000/api/mcp',
        }),
      )
      global.fetch = mockFetch

      const request = new Request('http://localhost/.well-known/oauth-protected-resource', {
        method: 'GET',
        headers: { Accept: 'application/json' },
      })

      const response = await handler(request)

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost/api/auth/.well-known/oauth-protected-resource',
        { headers: request.headers },
      )
      expect(response).toBeDefined()
    })
  })

  describe('Session type safety', () => {
    it('should allow custom session properties', () => {
      const session: McpSession = {
        userId: 'user-123',
        scopes: ['read'],
        customField: 'value',
        anotherField: 123,
        nestedField: { deep: 'value' },
      }

      expect(session.userId).toBe('user-123')
      expect(session.customField).toBe('value')
      expect(session.anotherField).toBe(123)
      expect(session.nestedField.deep).toBe('value')
    })
  })
})
