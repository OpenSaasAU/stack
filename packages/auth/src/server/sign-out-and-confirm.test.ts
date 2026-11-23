import { describe, it, expect, vi } from 'vitest'
import { signOutAndConfirm, type SignOutAuth } from './index.js'

function fakeAuth(signOutResult: unknown, session: unknown): SignOutAuth {
  return {
    api: {
      signOut: async () => signOutResult,
      getSession: async () => session,
    },
  }
}

describe('signOutAndConfirm', () => {
  it('returns null when the session is gone and no provider URL is given', async () => {
    expect(await signOutAndConfirm(fakeAuth({ success: true }, null), new Headers())).toBeNull()
  })

  it('throws when the session survives the sign-out', async () => {
    await expect(
      signOutAndConfirm(fakeAuth({ success: true }, { user: { id: '1' } }), new Headers()),
    ).rejects.toThrow('still active')
  })

  it('returns the provider logout URL', async () => {
    const url = 'https://idp.example/logout'
    expect(await signOutAndConfirm(fakeAuth({ url, redirect: true }, null), new Headers())).toBe(
      url,
    )
  })

  it('restores the session cookies when the session survives', async () => {
    const restored: Array<[string, string]> = []
    const headers = new Headers({
      cookie:
        'theme=dark; better-auth.session_token=abc.def; __Secure-better-auth.session_data=xyz',
    })
    await expect(
      signOutAndConfirm(fakeAuth({ success: true }, { user: { id: '1' } }), headers, (n, v) => {
        restored.push([n, v])
      }),
    ).rejects.toThrow('still active')
    expect(restored).toEqual([
      ['better-auth.session_token', 'abc.def'],
      ['__Secure-better-auth.session_data', 'xyz'],
    ])
  })

  it('leaves cookies alone when the session is gone', async () => {
    const restored: string[] = []
    await signOutAndConfirm(
      fakeAuth({ success: true }, null),
      new Headers({ cookie: 'better-auth.session_token=abc' }),
      (n) => {
        restored.push(n)
      },
    )
    expect(restored).toEqual([])
  })

  it('decodes a percent-encoded value so the store does not encode it twice', async () => {
    const restored: Array<[string, string]> = []
    await expect(
      signOutAndConfirm(
        fakeAuth({ success: true }, { user: { id: '1' } }),
        new Headers({ cookie: 'better-auth.session_token=abc.d%2Bef%3D' }),
        (n, v) => {
          restored.push([n, v])
        },
      ),
    ).rejects.toThrow('still active')
    expect(restored).toEqual([['better-auth.session_token', 'abc.d+ef=']])
  })

  it('still throws the sign-out error when restoring a cookie fails', async () => {
    await expect(
      signOutAndConfirm(
        fakeAuth({ success: true }, { user: { id: '1' } }),
        new Headers({ cookie: 'better-auth.session_token=abc' }),
        () => {
          throw new Error('no request scope')
        },
      ),
    ).rejects.toThrow('still active')
  })

  it('sets the cookie on the Next cookie store by default', async () => {
    const set = vi.fn()
    vi.resetModules()
    vi.doMock('next/headers', () => ({ cookies: async () => ({ set }) }))
    const { signOutAndConfirm: fresh } = await import('./index.js')
    await expect(
      fresh(
        fakeAuth({ success: true }, { user: { id: '1' } }),
        new Headers({ cookie: '__Secure-better-auth.session_token=abc' }),
      ),
    ).rejects.toThrow('still active')
    expect(set).toHaveBeenCalledWith('__Secure-better-auth.session_token', 'abc', {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: true,
    })
    vi.doUnmock('next/headers')
  })
})
