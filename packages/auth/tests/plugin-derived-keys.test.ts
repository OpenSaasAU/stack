import { describe, it, expect, vi } from 'vitest'
import { config, list } from '@opensaas/stack-core'
import { text } from '@opensaas/stack-core/fields'
import type { AccessContext } from '@opensaas/stack-core'
import { authPlugin } from '../src/config/plugin.js'
import type { AuthRuntimeServices } from '../src/runtime/types.js'

describe('authPlugin - add-vs-extend with derived keys', () => {
  it("does NOT extend or overwrite an app's own User when keys are customised", async () => {
    // The app declares its own domain `User` (a different model from the
    // better-auth user). The plugin renames its user model to `AuthUser`.
    const appUserHook = vi.fn()
    const result = await config({
      db: { provider: 'sqlite' },
      plugins: [
        authPlugin({
          user: { modelName: 'AuthUser' },
          session: { modelName: 'AuthSession' },
          account: { modelName: 'AuthAccount' },
          verification: { modelName: 'AuthVerification' },
        }),
      ],
      lists: {
        User: list({
          fields: {
            subjectId: text({ validation: { isRequired: true } }),
          },
          hooks: { beforeOperation: appUserHook },
        }),
      },
    })

    // The plugin adds its own AuthUser/AuthSession/... lists
    expect(result.lists).toHaveProperty('AuthUser')
    expect(result.lists).toHaveProperty('AuthSession')
    expect(result.lists).toHaveProperty('AuthAccount')
    expect(result.lists).toHaveProperty('AuthVerification')

    // The app's own `User` is left completely untouched: its field shape is
    // preserved and NOT merged with auth fields (no email/name/sessions).
    const appUser = result.lists.User
    expect(appUser.fields).toHaveProperty('subjectId')
    expect(appUser.fields).not.toHaveProperty('email')
    expect(appUser.fields).not.toHaveProperty('emailVerified')
    expect(appUser.fields).not.toHaveProperty('sessions')
    // Its hooks are preserved (not replaced by the auth user's hooks)
    expect(appUser.hooks?.beforeOperation).toBe(appUserHook)

    // And the auth user list (AuthUser) is the one carrying auth fields
    expect(result.lists.AuthUser.fields).toHaveProperty('email')
    expect(result.lists.AuthUser.fields).toHaveProperty('sessions')
  })

  it('still merges auth fields into an existing list that shares the default key', async () => {
    // Default keys: the plugin's user key is `User`, so an existing `User`
    // is intentionally extended with auth fields (the historical behaviour).
    const result = await config({
      db: { provider: 'sqlite' },
      plugins: [authPlugin({})],
      lists: {
        User: list({
          fields: {
            bio: text(),
          },
        }),
      },
    })

    const user = result.lists.User
    expect(user.fields).toHaveProperty('bio') // app field preserved
    expect(user.fields).toHaveProperty('email') // auth field merged in
    expect(user.fields).toHaveProperty('sessions')
  })
})

describe('authPlugin - runtime user-key resolution', () => {
  /**
   * Build a minimal AccessContext whose `db` records which model key was
   * accessed, so we can assert the runtime resolves the configured user model.
   */
  function makeFakeContext(session: { userId?: string } | null) {
    const accessedKeys: string[] = []
    const db = new Proxy(
      {},
      {
        get(_target, key: string) {
          accessedKeys.push(key)
          return {
            findUnique: async ({ where }: { where: { id: string } }) => ({
              id: where.id,
              __model: key,
            }),
          }
        },
      },
    )
    const context = { session, db } as unknown as AccessContext
    return { context, accessedKeys }
  }

  it('getUser uses the default `user` db key when no modelName override', () => {
    const plugin = authPlugin({})
    const { context, accessedKeys } = makeFakeContext({ userId: 'u1' })
    const services = plugin.runtime?.(context) as AuthRuntimeServices

    void services.getUser('u1')
    expect(accessedKeys).toContain('user')
  })

  it('getUser uses the configured user model db key (AuthUser -> authUser)', async () => {
    const plugin = authPlugin({ user: { modelName: 'AuthUser' } })
    const { context, accessedKeys } = makeFakeContext({ userId: 'u1' })
    const services = plugin.runtime?.(context) as AuthRuntimeServices

    const user = (await services.getUser('u1')) as { __model: string }
    expect(accessedKeys).toContain('authUser')
    expect(accessedKeys).not.toContain('user')
    expect(user.__model).toBe('authUser')
  })

  it('getCurrentUser uses the configured user model db key', async () => {
    const plugin = authPlugin({ user: { modelName: 'AuthUser' } })
    const { context, accessedKeys } = makeFakeContext({ userId: 'u1' })
    const services = plugin.runtime?.(context) as AuthRuntimeServices

    const user = (await services.getCurrentUser()) as { __model: string }
    expect(accessedKeys).toContain('authUser')
    expect(user.__model).toBe('authUser')
  })

  it('getCurrentUser returns null when there is no session', async () => {
    const plugin = authPlugin({ user: { modelName: 'AuthUser' } })
    const { context } = makeFakeContext(null)
    const services = plugin.runtime?.(context) as AuthRuntimeServices

    expect(await services.getCurrentUser()).toBeNull()
  })
})
