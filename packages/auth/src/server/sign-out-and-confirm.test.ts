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

  it('restores cookies under the resolved names and attributes', async () => {
    const restored: Array<[string, string, unknown]> = []
    const auth = {
      ...fakeAuth({ success: true }, { user: { id: '1' } }),
      $context: Promise.resolve({
        authCookies: {
          sessionToken: {
            name: 'app.sid',
            attributes: { path: '/admin', sameSite: 'Strict', maxAge: 60, httpOnly: true },
          },
          sessionData: { name: 'app.data', attributes: { path: '/admin' } },
          dontRememberToken: { name: 'app.dr', attributes: {} },
          accountData: { name: 'app.acct', attributes: {} },
        },
      }),
    }
    await expect(
      signOutAndConfirm(
        auth,
        new Headers({ cookie: 'other=1; app.sid=tok%3D; better-auth.session_token=ignored' }),
        (n, v, a) => {
          restored.push([n, v, a])
        },
      ),
    ).rejects.toThrow('still active')
    expect(restored).toEqual([
      ['app.sid', 'tok=', { path: '/admin', sameSite: 'strict', maxAge: 60, httpOnly: true }],
    ])
  })

  it('drops the session token lifetime when the dont-remember cookie is present', async () => {
    const restored: Array<[string, unknown]> = []
    const auth = {
      ...fakeAuth({ success: true }, { user: { id: '1' } }),
      $context: Promise.resolve({
        authCookies: {
          sessionToken: { name: 'a.token', attributes: { maxAge: 60 } },
          dontRememberToken: { name: 'a.dr', attributes: {} },
        },
      }),
    }
    await expect(
      signOutAndConfirm(auth, new Headers({ cookie: 'a.token=t; a.dr=true' }), (n, _v, a) => {
        restored.push([n, a])
      }),
    ).rejects.toThrow('still active')
    expect(restored).toEqual([
      ['a.token', {}],
      ['a.dr', {}],
    ])
  })

  it('resolves a callable $context, keeps partitioned and restores numbered chunks', async () => {
    const restored: Array<[string, unknown]> = []
    const auth = {
      ...fakeAuth({ success: true }, { user: { id: '1' } }),
      $context: () =>
        Promise.resolve({
          authCookies: {
            sessionToken: { name: 'app.sid', attributes: { partitioned: true } },
            sessionData: { name: 'app.data', attributes: { path: '/admin' } },
            accountData: { name: 'app.acct', attributes: {} },
          },
        }),
    }
    await expect(
      signOutAndConfirm(
        auth,
        new Headers({ cookie: 'app.sid=t; app.data.0=a; app.data.1=b; app.acct.0=c; app.sid.0=x' }),
        (n, _v, a) => {
          restored.push([n, a])
        },
      ),
    ).rejects.toThrow('still active')
    expect(restored).toEqual([
      ['app.sid', { partitioned: true }],
      ['app.data.0', { path: '/admin' }],
      ['app.data.1', { path: '/admin' }],
      ['app.acct.0', {}],
    ])
  })

  it('matches numbered chunks in the fallback', async () => {
    const restored: string[] = []
    await expect(
      signOutAndConfirm(
        fakeAuth({ success: true }, { user: { id: '1' } }),
        new Headers({ cookie: 'better-auth.session_data.0=a; better-auth.session_data.1=b' }),
        (n) => {
          restored.push(n)
        },
      ),
    ).rejects.toThrow('still active')
    expect(restored).toEqual(['better-auth.session_data.0', 'better-auth.session_data.1'])
  })
})
