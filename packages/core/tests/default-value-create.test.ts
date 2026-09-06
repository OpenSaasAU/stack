import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getContext } from '../src/context/index.js'
import { config, list } from '../src/config/index.js'
import { text, integer, checkbox, select, relationship } from '../src/fields/index.js'
import { hookPipeline } from '../src/context/hook-pipeline.js'
import { ValidationError } from '../src/hooks/index.js'
import type { ListConfig } from '../src/config/types.js'
import type { AccessContext } from '../src/access/types.js'

/**
 * Regression tests for #615: a field's `defaultValue` must be applied to omitted
 * inputs BEFORE validation on create (resolve-then-validate, Keystone parity).
 *
 * Before the fix, a required-with-default field (`select`, `text`, `integer`,
 * `checkbox`, …) failed `isRequired` validation on an omitted input because the
 * default was only realised as a Prisma `@default(...)` at DB write time — after
 * validation. These tests cover both the Hook-Pipeline unit surface and a full
 * create through `context.db` (top-level + nested), plus the guard rails:
 * explicit values (incl. explicit null) are preserved and update does not inject.
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

/**
 * A tiny in-memory Prisma mock supporting interactive transactions and a single
 * nested to-one `create`, mirroring the harness used by the nested-write tests.
 */
function createTxPrisma() {
  const tables: Record<string, Map<string, Record<string, unknown>>> = {
    Account: new Map(),
    Profile: new Map(),
  }
  let idCounter = 0
  const nextId = () => `id-${++idCounter}`

  function applyNested(
    record: Record<string, unknown>,
    data: Record<string, unknown>,
  ): Record<string, unknown> {
    const result = { ...record }
    for (const [key, value] of Object.entries(data)) {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        const nested = value as Record<string, unknown>
        if (nested.create) {
          const created = doCreate('Profile', nested.create as Record<string, unknown>)
          result[`${key}Link`] = created.id
          result[key] = created
          continue
        }
      }
      result[key] = value
    }
    return result
  }

  function doCreate(table: string, data: Record<string, unknown>): Record<string, unknown> {
    const id = (data.id as string) ?? nextId()
    const record = applyNested({ id }, data)
    tables[table].set(id, record)
    return record
  }

  function makeModel(table: string) {
    return {
      findUnique: vi.fn(
        async ({ where }: { where: { id: string } }) => tables[table].get(where.id) ?? null,
      ),
      findFirst: vi.fn(async () => tables[table].values().next().value ?? null),
      findMany: vi.fn(async () => Array.from(tables[table].values())),
      count: vi.fn(async () => tables[table].size),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => doCreate(table, data)),
      update: vi.fn(),
      delete: vi.fn(),
    }
  }

  const client: Record<string, unknown> = {
    Account: makeModel('Account'),
    Profile: makeModel('Profile'),
  }
  client.$transaction = async (fn: (tx: unknown) => Promise<unknown>) => fn(client)

  return { client, tables }
}

describe('#615 context.db create — defaultValue resolves through the full pipeline', () => {
  let mock: ReturnType<typeof createTxPrisma>

  beforeEach(() => {
    mock = createTxPrisma()
    vi.clearAllMocks()
  })

  it('top-level create omitting a required-with-default select succeeds and stores the default', async () => {
    const testConfig = config({
      db: { provider: 'postgresql', url: 'postgresql://localhost:5432/test' },
      lists: {
        Account: list({
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
        }),
      },
    })

    const context = getContext(await testConfig, mock.client, { userId: '1' })

    const created = await context.db.Account.create({ data: { name: 'Acme' } })

    expect(created).toBeTruthy()
    expect(created?.kind).toBe('STANDARD')
    expect(created?.count).toBe(7)
    // The DB received the resolved default in its `data` payload.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const createMock = (mock.client.Account as any).create as ReturnType<typeof vi.fn>
    expect(createMock.mock.calls[0][0].data).toMatchObject({ kind: 'STANDARD', count: 7 })
  })

  it('nested-relation create omitting a required-with-default select stores the default', async () => {
    const testConfig = config({
      db: { provider: 'postgresql', url: 'postgresql://localhost:5432/test' },
      lists: {
        Account: list({
          fields: {
            name: text({ validation: { isRequired: true } }),
            profile: relationship({ ref: 'Profile.account' }),
          },
          access: { operation: { query: () => true, create: () => true } },
        }),
        Profile: list({
          fields: {
            kind: select({
              validation: { isRequired: true },
              options: [
                { label: 'Standard', value: 'STANDARD' },
                { label: 'Trial', value: 'TRIAL' },
              ],
              defaultValue: 'STANDARD',
            }),
            account: relationship({ ref: 'Account.profile' }),
          },
          access: { operation: { query: () => true, create: () => true } },
        }),
      },
    })

    const context = getContext(await testConfig, mock.client, { userId: '1' })

    const created = await context.db.Account.create({
      data: { name: 'Acme', profile: { create: {} } },
    })

    expect(created).toBeTruthy()
    // The nested Profile was created with its default `kind` despite being omitted.
    const profile = mock.tables.Profile.values().next().value
    expect(profile?.kind).toBe('STANDARD')
  })
})
