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

  it("does not overwrite an app's admin-only access when the auth plugin extends the same default key (ADR-0013)", async () => {
    // Regression test for #678: the auth plugin ships permissive defaults
    // (query: () => true, self-only update/delete) for its own User list.
    // Before the ADR-0013 fix, extending an app-declared `User` at the
    // default key forwarded those permissive defaults and silently replaced
    // the app's admin-only access. Now the plugin must not forward `access`
    // at all on its extend path, so the app's access survives untouched.
    const adminOnlyUpdate = vi.fn(() => false)
    const adminOnlyQuery = vi.fn(() => false)

    const result = await config({
      db: { provider: 'sqlite' },
      plugins: [authPlugin({})],
      lists: {
        User: list({
          fields: { bio: text() },
          access: {
            operation: {
              query: adminOnlyQuery,
              update: adminOnlyUpdate,
            },
          },
        }),
      },
    })

    const user = result.lists.User
    expect(user.fields).toHaveProperty('email') // auth fields still merged in
    // The app's admin-only access is intact — not replaced by the plugin's
    // permissive `query: () => true` / self-only `update` defaults.
    expect(user.access?.operation?.query).toBe(adminOnlyQuery)
    expect(user.access?.operation?.update).toBe(adminOnlyUpdate)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- access control parameters are runtime values
    expect(user.access?.operation?.query?.({} as any)).toBe(false)
  })

  it('routes a better-auth plugin schema extension of `user` onto the remapped Auth list, not an unrelated host User', async () => {
    // A better-auth provider plugin (e.g. the `anonymous` plugin) that ships a
    // schema extension for the base `user` model.
    const anonymousBetterAuthPlugin = {
      id: 'anonymous',
      schema: {
        user: {
          fields: {
            isAnonymous: { type: 'boolean', required: false },
          },
        },
      },
    }

    const hostUserUpdate = vi.fn(() => false)
    const result = await config({
      db: { provider: 'sqlite' },
      plugins: [
        authPlugin({
          user: { modelName: 'AuthUser' },
          session: { modelName: 'AuthSession' },
          account: { modelName: 'AuthAccount' },
          verification: { modelName: 'AuthVerification' },
          betterAuthPlugins: [anonymousBetterAuthPlugin],
        }),
      ],
      lists: {
        // An app's own unrelated domain list that happens to share the
        // default (unmapped) auth user key.
        User: list({
          fields: {
            subjectId: text({ validation: { isRequired: true } }),
          },
          access: { operation: { update: hostUserUpdate } },
        }),
      },
    })

    // The plugin's schema extension lands on the adopted Auth list...
    expect(result.lists.AuthUser.fields).toHaveProperty('isAnonymous')
    expect(result.lists.AuthUser.fields).toHaveProperty('email')

    // ...and the unrelated host `User` list is left completely untouched: no
    // injected column, and its own (admin-only-style) access control survives
    // instead of being overwritten by the plugin's permissive defaults.
    const appUser = result.lists.User
    expect(appUser.fields).toHaveProperty('subjectId')
    expect(appUser.fields).not.toHaveProperty('isAnonymous')
    expect(appUser.fields).not.toHaveProperty('email')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- access control parameters are runtime values
    expect(appUser.access?.operation?.update?.({} as any)).toBe(false)
    expect(appUser.access?.operation?.update).toBe(hostUserUpdate)
  })
})

describe('authPlugin - runtime user-key resolution', () => {
  /**
   * Build a minimal AccessContext whose non-sudo `db` always denies (returns
   * null, as an access-controlled `context.db` read does), plus a separate
   * `sudo` factory (passed as `plugin.runtime`'s second argument, NOT a
   * method on `context` itself — see ADR-0013 / the `Plugin['runtime']` doc)
   * whose `.db` records which model key was accessed and returns the real
   * record. Since the User list ships closed by default (ADR-0013),
   * getUser/getCurrentUser only resolve a real user if they go through
   * `sudo()` rather than the plain `context.db`.
   */
  function makeFakeContext(session: { userId?: string } | null) {
    const accessedKeys: string[] = []
    const sudoAccessedKeys: string[] = []

    const db = new Proxy(
      {},
      {
        get(_target, key: string) {
          accessedKeys.push(key)
          return { findUnique: async () => null }
        },
      },
    )
    const sudoDb = new Proxy(
      {},
      {
        get(_target, key: string) {
          sudoAccessedKeys.push(key)
          return {
            findUnique: async ({ where }: { where: { id: string } }) => ({
              id: where.id,
              __model: key,
            }),
          }
        },
      },
    )
    const sudoContext = { session, db: sudoDb, _isSudo: true } as unknown as AccessContext
    const context = { session, db } as unknown as AccessContext
    const sudo = () => sudoContext
    return { context, sudo, accessedKeys, sudoAccessedKeys }
  }

  it('getUser resolves through sudo(), not the plain (closed-by-default) context.db', async () => {
    const plugin = authPlugin({})
    const { context, sudo, accessedKeys, sudoAccessedKeys } = makeFakeContext({ userId: 'u1' })
    const services = plugin.runtime?.(context, sudo) as AuthRuntimeServices

    const user = (await services.getUser('u1')) as { __model: string }
    expect(sudoAccessedKeys).toContain('user')
    expect(accessedKeys).not.toContain('user')
    expect(user.__model).toBe('user')
  })

  it('getUser uses the configured user model db key (AuthUser -> authUser)', async () => {
    const plugin = authPlugin({ user: { modelName: 'AuthUser' } })
    const { context, sudo, sudoAccessedKeys } = makeFakeContext({ userId: 'u1' })
    const services = plugin.runtime?.(context, sudo) as AuthRuntimeServices

    const user = (await services.getUser('u1')) as { __model: string }
    expect(sudoAccessedKeys).toContain('authUser')
    expect(sudoAccessedKeys).not.toContain('user')
    expect(user.__model).toBe('authUser')
  })

  it('getCurrentUser uses the configured user model db key via sudo()', async () => {
    const plugin = authPlugin({ user: { modelName: 'AuthUser' } })
    const { context, sudo, accessedKeys, sudoAccessedKeys } = makeFakeContext({ userId: 'u1' })
    const services = plugin.runtime?.(context, sudo) as AuthRuntimeServices

    const user = (await services.getCurrentUser()) as { __model: string }
    expect(sudoAccessedKeys).toContain('authUser')
    expect(accessedKeys).not.toContain('authUser')
    expect(user.__model).toBe('authUser')
  })

  it('getCurrentUser returns null when there is no session', async () => {
    const plugin = authPlugin({ user: { modelName: 'AuthUser' } })
    const { context, sudo } = makeFakeContext(null)
    const services = plugin.runtime?.(context, sudo) as AuthRuntimeServices

    expect(await services.getCurrentUser()).toBeNull()
  })
})
