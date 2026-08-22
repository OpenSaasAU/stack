import { describe, it, expect, vi } from 'vitest'
import { mcp } from 'better-auth/plugins'
import { deriveAuthLists } from '../src/config/derive-auth-lists.js'
import type { NormalizedAuthModels } from '../src/config/types.js'

/**
 * Coverage for the consolidated plugin-table derivation (issue #992):
 * `deriveAuthLists` now covers better-auth plugin tables (e.g. the MCP
 * plugin's OAuth tables) through the same registry and field-derivation pass
 * as the four base models, instead of a separate converter that dropped
 * references to bare columns. See `auth-lists-drift.test.ts` for a
 * field-by-field comparison against better-auth's own table definitions, and
 * `generated-fk-shape.test.ts` for the generated-schema-text assertions.
 */

const defaultModels: NormalizedAuthModels = {
  user: { modelName: 'User', fields: {} },
  session: { modelName: 'Session', fields: {} },
  account: { modelName: 'Account', fields: {} },
  verification: { modelName: 'Verification', fields: {} },
}

describe('deriveAuthLists — better-auth plugin tables (issue #992)', () => {
  it('derives every MCP OAuth table under a PascalCase key, mapped back to its camelCase physical table', () => {
    const { lists } = deriveAuthLists(defaultModels, {}, {}, [mcp({ loginPage: '/sign-in' })])

    expect(Object.keys(lists).sort()).toEqual([
      'Account',
      'OauthAccessToken',
      'OauthApplication',
      'OauthConsent',
      'Session',
      'User',
      'Verification',
    ])
    expect(lists.OauthApplication.db?.map).toBe('oauthApplication')
    expect(lists.OauthAccessToken.db?.map).toBe('oauthAccessToken')
    expect(lists.OauthConsent.db?.map).toBe('oauthConsent')
  })

  it('generates a real relationship (not a bare column) for a PK-targeting reference (userId -> user.id)', () => {
    const { lists } = deriveAuthLists(defaultModels, {}, {}, [mcp({ loginPage: '/sign-in' })])
    const userField = lists.OauthApplication.fields.user

    expect(userField.type).toBe('relationship')
    expect(userField.ref).toBe('User.oauthApplications')
    expect(userField.db?.foreignKey).toEqual({ map: 'userId' })
    // oauthApplication.userId is optional upstream (required: false).
    expect(userField.db?.isNullable).toBe(true)
  })

  it('carries the referential action from `onDelete: cascade` through to the generated relation', () => {
    const { lists } = deriveAuthLists(defaultModels, {}, {}, [mcp({ loginPage: '/sign-in' })])
    const userField = lists.OauthApplication.fields.user
    const extend = userField.db?.extendPrismaSchema
    const relationLine = extend
      ? extend({ relationLine: '@relation(fields: [x], references: [id])' }).relationLine
      : ''

    expect(relationLine).toContain('onDelete: Cascade')
  })

  it('maps every declared referential action, not just cascade', () => {
    const plugin = {
      id: 'test-referential-actions',
      schema: {
        widget: {
          modelName: 'widget',
          fields: {
            ownerId: {
              type: 'string',
              required: true,
              references: { model: 'user', field: 'id', onDelete: 'restrict' as const },
            },
          },
        },
      },
    }
    const { lists } = deriveAuthLists(defaultModels, {}, {}, [plugin])
    const extend = lists.Widget.fields.owner.db?.extendPrismaSchema
    const relationLine = extend
      ? extend({ relationLine: '@relation(fields: [x], references: [id])' }).relationLine
      : ''

    expect(relationLine).toContain('onDelete: Restrict')
  })

  it('leaves a non-PK-targeting reference as a plain scalar column (clientId -> oauthApplication.clientId)', () => {
    const { lists } = deriveAuthLists(defaultModels, {}, {}, [mcp({ loginPage: '/sign-in' })])
    const clientId = lists.OauthAccessToken.fields.clientId

    expect(clientId.type).toBe('text')
    expect(clientId).not.toHaveProperty('ref')
    // Still indexed, since better-auth declares `index: true` on this column.
    expect(clientId.isIndexed).toBe(true)
    expect(clientId.validation?.isRequired).toBe(true)
  })

  it('adds a reverse relation on the target base list for every plugin-table reference to it, with no name collisions', () => {
    const { lists } = deriveAuthLists(defaultModels, {}, {}, [mcp({ loginPage: '/sign-in' })])

    expect(lists.User.fields.oauthApplications).toMatchObject({
      type: 'relationship',
      ref: 'OauthApplication.user',
      many: true,
    })
    expect(lists.User.fields.oauthAccessTokens).toMatchObject({
      type: 'relationship',
      ref: 'OauthAccessToken.user',
      many: true,
    })
    expect(lists.User.fields.oauthConsents).toMatchObject({
      type: 'relationship',
      ref: 'OauthConsent.user',
      many: true,
    })
  })

  it('honours fieldName column maps and index: true on plugin scalar fields', () => {
    const plugin = {
      id: 'test-column-map',
      schema: {
        widget: {
          modelName: 'widget',
          fields: {
            label: { type: 'string', fieldName: 'display_label', index: true },
          },
        },
      },
    }
    const { lists } = deriveAuthLists(defaultModels, {}, {}, [plugin])
    const label = lists.Widget.fields.label

    expect(label.db?.map).toBe('display_label')
    expect(label.isIndexed).toBe(true)
  })

  it('ships plugin-table lists closed — no access control', () => {
    const { lists } = deriveAuthLists(defaultModels, {}, {}, [mcp({ loginPage: '/sign-in' })])

    expect(lists.OauthApplication.access).toBeUndefined()
    expect(lists.OauthAccessToken.access).toBeUndefined()
    expect(lists.OauthConsent.access).toBeUndefined()
  })

  it('sets no db.map when a plugin already declares a PascalCase modelName', () => {
    const plugin = {
      id: 'test-passkey',
      schema: { passkey: { modelName: 'Passkey', fields: { publicKey: { type: 'string' } } } },
    }
    const { lists } = deriveAuthLists(defaultModels, {}, {}, [plugin])

    expect(lists).toHaveProperty('Passkey')
    expect(lists.Passkey.db?.map).toBeUndefined()
  })

  it('PascalCases a snake_case schema key with no modelName override', () => {
    const plugin = {
      id: 'test-snake-case',
      schema: { oauth_widget: { fields: { data: { type: 'string' } } } },
    }
    const { lists } = deriveAuthLists(defaultModels, {}, {}, [plugin])

    expect(lists).toHaveProperty('OauthWidget')
    expect(lists.OauthWidget.db?.map).toBe('oauth_widget')
  })

  it('throws a clear error when a plugin table references a model outside the registry', () => {
    const plugin = {
      id: 'test-bad-reference',
      schema: {
        widget: {
          modelName: 'widget',
          fields: {
            ownerId: {
              type: 'string',
              references: { model: 'nonexistentModel', field: 'id' },
            },
          },
        },
      },
    }

    expect(() => deriveAuthLists(defaultModels, {}, {}, [plugin])).toThrow(
      /widget\.ownerId.*references unknown model "nonexistentModel"/,
    )
  })

  it('throws a clear error instead of silently colliding when two id-references on the same table target the same model', () => {
    const plugin = {
      id: 'test-reverse-collision',
      schema: {
        widget: {
          modelName: 'widget',
          fields: {
            ownerId: { type: 'string', references: { model: 'user', field: 'id' } },
            reviewerId: { type: 'string', references: { model: 'user', field: 'id' } },
          },
        },
      },
    }

    expect(() => deriveAuthLists(defaultModels, {}, {}, [plugin])).toThrow(
      /"widget" has more than one reference to "user".*"widgets"/,
    )
  })

  it('falls back to a text() column with a warning for a better-auth field type this derivation does not model (e.g. json)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const plugin = {
        id: 'test-unsupported-type',
        schema: {
          widget: { modelName: 'widget', fields: { metadata: { type: 'json' } } },
        },
      }

      const { lists } = deriveAuthLists(defaultModels, {}, {}, [plugin])

      expect(lists.Widget.fields.metadata.type).toBe('text')
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('Unknown better-auth field type "json"'),
      )
    } finally {
      warn.mockRestore()
    }
  })

  it('merges a plugin schema extension of a base model directly into that base list, without a separate table', () => {
    const anonymousPlugin = {
      id: 'anonymous',
      schema: { user: { fields: { isAnonymous: { type: 'boolean', required: false } } } },
    }
    const { lists } = deriveAuthLists(defaultModels, {}, {}, [anonymousPlugin])

    expect(Object.keys(lists).sort()).toEqual(['Account', 'Session', 'User', 'Verification'])
    expect(lists.User.fields).toHaveProperty('isAnonymous')
  })

  it('resolves a plugin table reference to a base model through a modelName remap (e.g. AuthUser)', () => {
    const remappedModels: NormalizedAuthModels = {
      user: { modelName: 'AuthUser', fields: {} },
      session: { modelName: 'AuthSession', fields: {} },
      account: { modelName: 'AuthAccount', fields: {} },
      verification: { modelName: 'AuthVerification', fields: {} },
    }
    const { lists } = deriveAuthLists(remappedModels, {}, {}, [mcp({ loginPage: '/sign-in' })])

    expect(lists.OauthApplication.fields.user.ref).toBe('AuthUser.oauthApplications')
    expect(lists.AuthUser.fields.oauthApplications).toBeDefined()
  })
})
