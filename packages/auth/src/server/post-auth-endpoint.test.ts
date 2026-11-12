import { describe, it, expect, vi } from 'vitest'
import { postAuthEndpoint, type AuthHandlerTarget } from './post-auth-endpoint.js'

function target(respond: (request: Request) => Response): AuthHandlerTarget {
  return { handler: async (request) => respond(request), options: { baseURL: 'http://app.test' } }
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
      () => new Response('{}', { headers: { 'set-cookie': 'sid=abc; Path=/; HttpOnly' } }),
    )
    const setCookie = vi.fn()
    await postAuthEndpoint(auth, { path: '/x', body: {}, headers: new Headers(), setCookie })
    expect(setCookie).toHaveBeenCalledWith('sid', 'abc', expect.objectContaining({ path: '/' }))
  })
})
