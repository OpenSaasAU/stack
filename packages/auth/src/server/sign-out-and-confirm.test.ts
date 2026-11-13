import { describe, it, expect } from 'vitest'
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
})
