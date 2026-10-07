import { describe, it, expect, vi, afterEach } from 'vitest'
import { betterAuth } from 'better-auth'
import { jwt } from 'better-auth/plugins'
import { mcp } from '@better-auth/mcp'
import {
  createOAuthDiscoveryHandler,
  createOAuthProtectedResourceHandler,
} from '../src/mcp/better-auth.js'

const resource = 'http://localhost:3000/api/mcp'
const issuer = 'http://localhost:3000/api/auth'

const auth = betterAuth({
  baseURL: 'http://localhost:3000',
  secret: 'x'.repeat(40),
  plugins: [jwt(), mcp({ loginPage: '/sign-in', consentPage: '/consent', resource })],
})

const discovery = createOAuthDiscoveryHandler(auth)
const protectedResource = createOAuthProtectedResourceHandler(auth)

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('OAuth discovery handlers', () => {
  it('serves the authorization server metadata at the root path', async () => {
    const response = await discovery(
      new Request('http://localhost:3000/.well-known/oauth-authorization-server'),
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ issuer })
  })

  it('serves the protected resource metadata at the root path', async () => {
    const response = await protectedResource(
      new Request('http://localhost:3000/.well-known/oauth-protected-resource'),
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ resource, authorization_servers: [issuer] })
  })

  it('serves the resource-path variant', async () => {
    const response = await protectedResource(
      new Request('http://localhost:3000/.well-known/oauth-protected-resource/api/mcp'),
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ resource })
  })

  it.each([
    ['discovery', discovery, '/.well-known/oauth-authorization-server'],
    ['protected resource', protectedResource, '/.well-known/oauth-protected-resource'],
  ])(
    '%s ignores the request host, cookies and authorization, and never fetches',
    async (_, handler, path) => {
      const fetchSpy = vi.fn(() => {
        throw new Error('outbound fetch')
      })
      vi.stubGlobal('fetch', fetchSpy)
      const hostile = await handler(
        new Request(`http://evil.example${path}`, {
          headers: {
            Cookie: 'session=abc',
            Authorization: 'Bearer secret',
            'X-Forwarded-Host': 'evil.example',
          },
        }),
      )
      const plain = await handler(new Request(`http://localhost:3000${path}`))
      expect(hostile.status).toBe(200)
      expect(await hostile.json()).toEqual(await plain.json())
      expect(fetchSpy).not.toHaveBeenCalled()
    },
  )

  it.each([
    ['discovery', discovery, '/.well-known/oauth-authorization-server'],
    ['protected resource', protectedResource, '/.well-known/oauth-protected-resource'],
  ])('%s answers POST with 405', async (_, handler, path) => {
    const response = await handler(new Request(`http://localhost:3000${path}`, { method: 'POST' }))
    expect(response.status).toBe(405)
  })

  it.each([
    ['discovery', discovery],
    ['protected resource', protectedResource],
  ])('%s does not reach other auth routes', async (_, handler) => {
    for (const path of [
      '/api/auth/ok',
      '/ok',
      '/.well-known/openid-configuration',
      '/.well-known/oauth-protected-resource/../../api/auth/ok',
    ]) {
      const response = await handler(new Request(`http://localhost:3000${path}`))
      expect(response.status).toBe(404)
    }
  })
})
