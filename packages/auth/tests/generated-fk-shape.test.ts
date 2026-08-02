import { describe, it, expect } from 'vitest'
import { config, list } from '@opensaas/stack-core'
import { text, relationship } from '@opensaas/stack-core/fields'
import type { OpenSaasConfig } from '@opensaas/stack-core'
import type { Plugin } from '@opensaas/stack-core/extend'
import { generatePrismaSchema } from '@opensaas/stack-cli/generator/prisma'
import { authPlugin } from '../src/config/plugin.js'

/**
 * Resolve a config through plugin `init` (via `config()`) and each plugin's
 * `beforeGenerate` hook — the same sequence the CLI generate pipeline runs —
 * then hand the result to the Prisma generator. Unlike the config-level
 * assertions in `derive-auth-lists.test.ts` and `plugin-schema-placement.test.ts`,
 * this exercises the *assembled generated schema text* so the auth FK shape is
 * locked end-to-end (issue #753).
 */
async function generateSchema(userConfig: OpenSaasConfig): Promise<string> {
  let current = await config(userConfig)
  const plugins: Plugin[] = current.plugins ?? []
  for (const plugin of plugins) {
    if (plugin.beforeGenerate) {
      current = await plugin.beforeGenerate(current)
    }
  }
  return generatePrismaSchema(current)
}

/** Slice out a single `model X { ... }` block from generated schema text. */
function modelBlock(schema: string, modelName: string): string {
  const start = schema.indexOf(`model ${modelName} {`)
  if (start === -1) throw new Error(`model ${modelName} not found in generated schema`)
  const end = schema.indexOf('\n}', start)
  return schema.slice(start, end === -1 ? undefined : end + 2)
}

describe('generated auth schema — Session/Account user FK mirrors better-auth (issue #679/#753)', () => {
  it('emits onDelete: Cascade and omits @@index on Session.user and Account.user', async () => {
    const schema = await generateSchema({
      db: { provider: 'sqlite' },
      plugins: [authPlugin({ emailAndPassword: { enabled: true } })],
      lists: {},
    })

    for (const model of ['Session', 'Account']) {
      const block = modelBlock(schema, model)

      // (a) The user relation carries the cascade referential action. Match on
      // the whitespace-stable attribute substring rather than the padded line,
      // since raw generator output and prisma-formatted output differ only in
      // column alignment.
      expect(block).toContain('@relation(onDelete: Cascade, fields: [userId], references: [id])')

      // (b) No separate FK index is emitted — parity with better-auth, which
      // ships no @@index([userId]). This is deliberate (ADR-0007), not a
      // regression; catching a re-introduced index here flags drift.
      expect(block).not.toContain('@@index([userId])')
      expect(block).not.toContain('@@index([user])')
    }
  })

  it('still emits the default @@index for a non-auth relationship FK', async () => {
    // Contrast case: the generic FK-index path is untouched. Only the auth
    // user relations opt out (via isIndexed: false); an ordinary app
    // relationship keeps the default Keystone-parity @@index.
    const schema = await generateSchema({
      db: { provider: 'sqlite' },
      plugins: [authPlugin({ emailAndPassword: { enabled: true } })],
      lists: {
        Widget: list({
          fields: {
            title: text({ validation: { isRequired: true } }),
            owner: relationship({ ref: 'User' }),
          },
        }),
      },
    })

    const widget = modelBlock(schema, 'Widget')
    expect(widget).toContain('@@index([ownerId])')
  })
})

describe('generated auth schema — required columns mirror better-auth (issue #863)', () => {
  it('emits a required (non-nullable) userId FK and user relation on Session and Account', async () => {
    const schema = await generateSchema({
      db: { provider: 'sqlite' },
      plugins: [authPlugin({ emailAndPassword: { enabled: true } })],
      lists: {},
    })

    for (const model of ['Session', 'Account']) {
      const block = modelBlock(schema, model)

      expect(block).toMatch(/userId\s+String\s/)
      expect(block).not.toMatch(/userId\s+String\?/)
      expect(block).toMatch(/user\s+User\s+@relation/)
      expect(block).not.toMatch(/user\s+User\?/)
    }
  })

  it('emits a required (non-nullable) expiresAt on Session and Verification', async () => {
    const schema = await generateSchema({
      db: { provider: 'sqlite' },
      plugins: [authPlugin({ emailAndPassword: { enabled: true } })],
      lists: {},
    })

    for (const model of ['Session', 'Verification']) {
      const block = modelBlock(schema, model)

      expect(block).toMatch(/expiresAt\s+DateTime\s/)
      expect(block).not.toMatch(/expiresAt\s+DateTime\?/)
    }
  })
})

describe('generated auth schema — tableName independent of modelName (issue #862)', () => {
  it('emits a prefixed model name with a @@map to a better-auth default lowercase table', async () => {
    const schema = await generateSchema({
      db: { provider: 'postgresql' },
      plugins: [
        authPlugin({
          user: { modelName: 'AuthUser', tableName: 'user' },
          session: { modelName: 'AuthSession', tableName: 'session' },
          account: { modelName: 'AuthAccount', tableName: 'account' },
          verification: { modelName: 'AuthVerification', tableName: 'verification' },
          emailAndPassword: { enabled: true },
        }),
      ],
      lists: {},
    })

    for (const [model, table] of [
      ['AuthUser', 'user'],
      ['AuthSession', 'session'],
      ['AuthAccount', 'account'],
      ['AuthVerification', 'verification'],
    ]) {
      const block = modelBlock(schema, model)
      // The generated model keeps the prefixed name but maps to the live
      // lowercase table — no DROP/CREATE rename against a real better-auth
      // install using its own default table names.
      expect(block).toContain(`@@map("${table}")`)
    }
  })
})
