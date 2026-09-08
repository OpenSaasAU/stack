import { afterAll, beforeAll, describe, it, expect } from 'vitest'
import { text, integer, checkbox, select } from '../fields/index.js'
import { hookPipeline } from './hook-pipeline.js'
import { ValidationError } from '../hooks/index.js'
import type { ListConfig, OpenSaasConfig } from '../config/types.js'
import type { AccessContext } from '../access/types.js'
import { createTestContext, type TestContext } from '../testing/context.js'

/**
 * #615: a field's `defaultValue` is applied to an omitted input BEFORE
 * validation on create (resolve-then-validate, Keystone parity). The Prisma
 * `@default(...)` is realised at write time, which is after validation — so
 * without this a required-with-default field failed `isRequired` on an
 * omitted input.
 */

/**
 * Minimal AccessContext for driving the Hook Pipeline directly.
 */
function makeContext(): AccessContext {
  return {
    session: { userId: 'u1' },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ormHandle: {} as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    db: {} as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    storage: {} as any,
    plugins: {},
    _isSudo: false,
    _resolveOutputChain: [],
  }
}

/**
 * A list whose every required field also declares a `defaultValue`, spanning the
 * field types the issue calls out (`select` plus other defaultValue-supporting
 * types).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeListConfig(): ListConfig<any> {
  return {
    fields: {
      kind: select({
        validation: { isRequired: true },
        options: [
          { label: 'Standard', value: 'STANDARD' },
          { label: 'Trial', value: 'TRIAL' },
        ],
        defaultValue: 'STANDARD',
      }),
      label: text({ validation: { isRequired: true }, defaultValue: 'PLACEHOLDER' }),
      count: integer({ validation: { isRequired: true }, defaultValue: 7 }),
      active: checkbox({ defaultValue: true }),
      // A required field WITHOUT a default — to prove validation still fails when
      // there is genuinely nothing to resolve to.
      name: text({ validation: { isRequired: true } }),
    },
    access: { operation: { query: () => true, create: () => true, update: () => true } },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as ListConfig<any>
}

describe('#615 Hook Pipeline — defaultValue applied before validation (create)', () => {
  it('fills omitted required-with-default fields (select/text/integer/checkbox) and passes validation', async () => {
    const { resolvedData } = await hookPipeline.run({
      operation: 'create',
      listName: 'Thing',
      listConfig: makeListConfig(),
      // `name` is provided (required, no default); everything else omitted.
      inputData: { name: 'given' },
      item: undefined,
      context: makeContext(),
    })

    expect(resolvedData).toEqual({
      name: 'given',
      kind: 'STANDARD',
      label: 'PLACEHOLDER',
      count: 7,
      active: true,
    })
  })

  it('preserves an explicitly-provided value over the default', async () => {
    const { resolvedData } = await hookPipeline.run({
      operation: 'create',
      listName: 'Thing',
      listConfig: makeListConfig(),
      inputData: { name: 'given', kind: 'TRIAL', count: 99, active: false },
      item: undefined,
      context: makeContext(),
    })

    expect(resolvedData.kind).toBe('TRIAL')
    expect(resolvedData.count).toBe(99)
    expect(resolvedData.active).toBe(false)
  })

  it('preserves an explicit null and does not overwrite it with the default', async () => {
    // A nullable field with a default: explicit null must survive resolve.
    const listConfig = {
      fields: {
        note: text({ defaultValue: 'DEFAULT_NOTE' }),
      },
      access: { operation: { query: () => true, create: () => true } },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as ListConfig<any>

    const { resolvedData } = await hookPipeline.run({
      operation: 'create',
      listName: 'Thing',
      listConfig,
      inputData: { note: null },
      item: undefined,
      context: makeContext(),
    })

    expect(resolvedData.note).toBeNull()
  })

  it('does NOT inject defaults on update (omitted field stays omitted)', async () => {
    const { resolvedData } = await hookPipeline.run({
      operation: 'update',
      listName: 'Thing',
      listConfig: makeListConfig(),
      inputData: { name: 'changed' },
      item: { id: '1', name: 'old', kind: 'TRIAL', label: 'x', count: 1, active: false },
      context: makeContext(),
    })

    // Only the provided field is present; no default was injected on update.
    expect(resolvedData).toEqual({ name: 'changed' })
  })

  it('still throws when a required field WITHOUT a default is omitted', async () => {
    await expect(
      hookPipeline.run({
        operation: 'create',
        listName: 'Thing',
        listConfig: makeListConfig(),
        inputData: {}, // `name` is required and has no default
        item: undefined,
        context: makeContext(),
      }),
    ).rejects.toBeInstanceOf(ValidationError)
  })
})

describe('#615 the same defaults through a create on a real database', () => {
  let harness: TestContext

  const schemaConfig = (): OpenSaasConfig => ({
    db: { provider: 'postgresql', timestamps: true },
    lists: {
      Account: {
        fields: {
          name: text({ validation: { isRequired: true } }),
          kind: select({
            validation: { isRequired: true },
            options: [
              { label: 'Standard', value: 'STANDARD' },
              { label: 'Trial', value: 'TRIAL' },
            ],
            defaultValue: 'STANDARD',
          }),
          count: integer({ validation: { isRequired: true }, defaultValue: 7 }),
        },
        access: { operation: { query: () => true, create: () => true } },
      },
    },
  })

  beforeAll(async () => {
    harness = await createTestContext(schemaConfig(), null)
  }, 120_000)

  afterAll(async () => {
    await harness?.close()
  })

  it('a create omitting the required-with-default fields stores the defaults', async () => {
    const created = await harness.context.db.Account.create({ data: { name: 'Acme' } })

    expect(created).toMatchObject({ name: 'Acme', kind: 'STANDARD', count: 7 })
    expect(await harness.context.db.Account.all()).toMatchObject([
      { name: 'Acme', kind: 'STANDARD', count: 7 },
    ])
  }, 120_000)
})
