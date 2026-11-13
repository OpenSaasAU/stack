import { describe, it, expect, vi } from 'vitest'
import { postAuthEndpoint, type AuthHandlerTarget } from './post-auth-endpoint.js'

function target(respond: (request: Request) => Response): AuthHandlerTarget {
  return {
    handler: async (request) => respond(request),
    $context: Promise.resolve({ baseURL: 'http://app.test/api/auth' }),
  }
}

describe('postAuthEndpoint', () => {
  it('posts JSON to the handler and forwards the caller headers', async () => {
    let seen: Request | undefined
    const auth = target((request) => {
      seen = request
      return new Response('{}', { status: 200 })
    })
    const result = await postAuthEndpoint(auth, {
      path: '/sign-in/email',
      body: { email: 'a@b.c' },
      headers: new Headers({ 'x-forwarded-for': '1.2.3.4' }),
    })
    expect(result).toEqual({ success: true })
    expect(seen?.url).toBe('http://app.test/api/auth/sign-in/email')
    expect(seen?.headers.get('x-forwarded-for')).toBe('1.2.3.4')
    expect(await seen?.json()).toEqual({ email: 'a@b.c' })
  })

  it('returns a rate-limited failure on 429', async () => {
    const auth = target(() => new Response('Too many requests', { status: 429 }))
    const result = await postAuthEndpoint(auth, { path: '/x', body: {}, headers: new Headers() })
    expect(result).toEqual({ success: false, error: expect.stringContaining('Too many') })
  })

  it('surfaces the better-auth message on failure', async () => {
    const auth = target(() =>
      Response.json({ message: 'Invalid email or password' }, { status: 401 }),
    )
    const result = await postAuthEndpoint(auth, { path: '/x', body: {}, headers: new Headers() })
    expect(result).toEqual({ success: false, error: 'Invalid email or password' })
  })

  it('hands Set-Cookie values to setCookie', async () => {
    const auth = target(
      () =>
        new Response('{}', {
          headers: { 'set-cookie': 'sid=abc; Path=/; HttpOnly; Max-Age=60; SameSite=Lax' },
        }),
    )
    const setCookie = vi.fn()
    await postAuthEndpoint(auth, { path: '/x', body: {}, headers: new Headers(), setCookie })
    expect(setCookie).toHaveBeenCalledWith(
      'sid',
      'abc',
      expect.objectContaining({ path: '/', httpOnly: true, maxAge: 60, sameSite: 'lax' }),
    )
  })

  it('returns a failure instead of throwing when the handler throws', async () => {
    const auth: AuthHandlerTarget = {
      handler: async () => {
        throw new Error('boom')
      },
      $context: Promise.resolve({ baseURL: 'http://app.test/api/auth' }),
    }
    expect(await postAuthEndpoint(auth, { path: '/x', body: {}, headers: new Headers() })).toEqual({
      success: false,
      error: 'boom',
    })
  })

  it('never takes the host from request headers', async () => {
    const handler = vi.fn(async (_request: Request) => new Response('{}'))
    const auth: AuthHandlerTarget = {
      handler,
      $context: Promise.resolve({ baseURL: 'http://app.test/api/auth' }),
    }
    await postAuthEndpoint(auth, {
      path: '/request-password-reset',
      body: {},
      headers: new Headers({ 'x-forwarded-host': 'evil.example.test', host: 'evil.example.test' }),
    })
    const request: Request = handler.mock.calls[0][0]
    expect(request.url).toBe('http://app.test/api/auth/request-password-reset')
    expect(request.headers.get('origin')).toBe('http://app.test')
  })

  it('fails without calling the handler when no base URL is configured', async () => {
    const handler = vi.fn(async (_request: Request) => new Response('{}'))
    const auth: AuthHandlerTarget = { handler, $context: Promise.resolve({}) }
    const result = await postAuthEndpoint(auth, {
      path: '/x',
      body: {},
      headers: new Headers({ 'x-forwarded-host': 'evil.example.test' }),
    })
    expect(result).toEqual({ success: false, error: expect.stringContaining('BETTER_AUTH_URL') })
    expect(handler).not.toHaveBeenCalled()
  })

  it('resolves the context through a lazy callable accessor like createAuth()', async () => {
    const handler = vi.fn(async (_request: Request) => new Response('{}'))
    const auth: AuthHandlerTarget = {
      handler,
      $context: async () => ({ baseURL: 'http://app.test/api/auth' }),
    }
    await postAuthEndpoint(auth, {
      path: '/x',
      body: {},
      headers: new Headers({ host: 'evil.example.test', 'x-forwarded-proto': 'https' }),
    })
    const request: Request = handler.mock.calls[0][0]
    expect(request.url).toBe('http://app.test/api/auth/x')
    expect(request.headers.get('host')).toBeNull()
    expect(request.headers.get('x-forwarded-proto')).toBeNull()
  })
})
