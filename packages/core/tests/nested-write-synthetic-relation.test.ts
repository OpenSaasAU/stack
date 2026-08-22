import { describe, it, expect, vi } from 'vitest'
import { getContext } from '../src/context/index.js'
import { config, list } from '../src/config/index.js'
import { text, relationship } from '../src/fields/index.js'
import { ValidationError } from '../src/hooks/index.js'

/**
 * #978: a nested write through a list-only ref's SYNTHETIC reverse relation
 * (`from_<SourceList>_<sourceField>`, generated because Prisma requires an
 * opposite field but the config never declares one) must run the target
 * list's full write pipeline — the same resolveInput/validate/field-rules/
 * beforeOperation/afterOperation a nested write through a DECLARED
 * relationship field gets. Before this fix, the field went unrecognised by
 * `processNestedOperations` and was handed to Prisma completely untransformed
 * — no hooks, no validation, silently committing whatever the caller sent.
 *
 * `Account` declares no relationship field back to `ChargeRequest` — only
 * `ChargeRequest.account: relationship({ ref: 'Account' })` (list-only), so
 * the generator synthesizes `from_ChargeRequest_account` on Account. Reachable
 * only under `sudo()`: the undeclared-key guard refuses it otherwise (pinned
 * below too).
 */

const SYNTHETIC_FIELD = 'from_ChargeRequest_account'

/**
 * A transaction-aware in-memory Prisma mock for Account (one) / ChargeRequest
 * (many), modeling the synthetic back-relation as a real field on the Account
 * model — exactly as Prisma's generated client would, since the field is a
 * genuine schema artefact even though it has no entry in the OpenSaaS config.
 */
function createAccountPrisma() {
  const tables: Record<string, Map<string, Record<string, unknown>>> = {
    account: new Map(),
    chargeRequest: new Map(),
  }
  const chargeToAccount = new Map<string, string>()
  let idCounter = 0
  const nextId = () => `cr-${++idCounter}`

  function linkedChargeRequests(accountId: string): Array<Record<string, unknown>> {
    const rows: Array<Record<string, unknown>> = []
    for (const [crId, owner] of chargeToAccount.entries()) {
      if (owner === accountId) {
        const row = tables.chargeRequest.get(crId)
        if (row) rows.push(row)
      }
    }
    return rows
  }

  function applyChargeRequestOps(accountId: string, ops: Record<string, unknown>) {
    if (ops.create) {
      const creates = Array.isArray(ops.create) ? ops.create : [ops.create]
      for (const data of creates as Array<Record<string, unknown>>) {
        const id = (data.id as string) ?? nextId()
        tables.chargeRequest.set(id, { id, ...data })
        chargeToAccount.set(id, accountId)
      }
    }
    if (ops.update) {
      const updates = Array.isArray(ops.update) ? ops.update : [ops.update]
      for (const u of updates as Array<{ where: { id: string }; data: Record<string, unknown> }>) {
        const existing = tables.chargeRequest.get(u.where.id) ?? { id: u.where.id }
        tables.chargeRequest.set(u.where.id, { ...existing, ...u.data })
      }
    }
    if (ops.delete) {
      const deletes = Array.isArray(ops.delete) ? ops.delete : [ops.delete]
      for (const d of deletes as Array<{ id: string }>) {
        tables.chargeRequest.delete(d.id)
        chargeToAccount.delete(d.id)
      }
    }
  }

  function buildAccountResult(
    accountId: string,
    include?: Record<string, unknown>,
  ): Record<string, unknown> {
    const base = tables.account.get(accountId) ?? { id: accountId }
    if (include?.[SYNTHETIC_FIELD]) {
      return { ...base, [SYNTHETIC_FIELD]: linkedChargeRequests(accountId) }
    }
    return { ...base }
  }

  const accountModel = {
    findUnique: vi.fn(
      async ({ where, include }: { where: { id: string }; include?: Record<string, unknown> }) => {
        if (!tables.account.has(where.id)) return null
        return buildAccountResult(where.id, include)
      },
    ),
    findFirst: vi.fn(async ({ where }: { where?: { id?: string } }) => {
      if (where?.id) return tables.account.get(where.id) ?? null
      return tables.account.values().next().value ?? null
    }),
    findMany: vi.fn(async () => Array.from(tables.account.values())),
    count: vi.fn(async () => tables.account.size),
    create: vi.fn(
      async ({
        data,
        include,
      }: {
        data: Record<string, unknown>
        include?: Record<string, unknown>
      }) => {
        const id = (data.id as string) ?? `a-${++idCounter}`
        const { [SYNTHETIC_FIELD]: nested, ...scalars } = data
        tables.account.set(id, { id, ...scalars })
        if (nested) applyChargeRequestOps(id, nested as Record<string, unknown>)
        return buildAccountResult(id, include)
      },
    ),
    update: vi.fn(
      async ({
        where,
        data,
        include,
      }: {
        where: { id: string }
        data: Record<string, unknown>
        include?: Record<string, unknown>
      }) => {
        const existing = tables.account.get(where.id) ?? { id: where.id }
        const { [SYNTHETIC_FIELD]: nested, ...scalars } = data
        tables.account.set(where.id, { ...existing, ...scalars })
        if (nested) applyChargeRequestOps(where.id, nested as Record<string, unknown>)
        return buildAccountResult(where.id, include)
      },
    ),
    delete: vi.fn(async ({ where }: { where: { id: string } }) => {
      const existing = tables.account.get(where.id) ?? { id: where.id }
      tables.account.delete(where.id)
      return existing
    }),
  }

  function makeChargeRequestModel() {
    return {
      findUnique: vi.fn(
        async ({ where }: { where: { id: string } }) => tables.chargeRequest.get(where.id) ?? null,
      ),
      findFirst: vi.fn(async () => tables.chargeRequest.values().next().value ?? null),
      findMany: vi.fn(async () => Array.from(tables.chargeRequest.values())),
      count: vi.fn(async () => tables.chargeRequest.size),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const id = (data.id as string) ?? nextId()
        const row = { id, ...data }
        tables.chargeRequest.set(id, row)
        return row
      }),
      update: vi.fn(
        async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const existing = tables.chargeRequest.get(where.id) ?? { id: where.id }
          const updated = { ...existing, ...data }
          tables.chargeRequest.set(where.id, updated)
          return updated
        },
      ),
      delete: vi.fn(async ({ where }: { where: { id: string } }) => {
        const existing = tables.chargeRequest.get(where.id) ?? { id: where.id }
        tables.chargeRequest.delete(where.id)
        chargeToAccount.delete(where.id)
        return existing
      }),
    }
  }

  const client: Record<string, unknown> = {
    account: accountModel,
    chargeRequest: makeChargeRequestModel(),
  }

  client.$transaction = async (fn: (tx: unknown) => Promise<unknown>) => {
    const snapshot = {
      account: new Map(tables.account),
      chargeRequest: new Map(tables.chargeRequest),
      links: new Map(chargeToAccount),
    }
    try {
      return await fn(client)
    } catch (err) {
      tables.account = snapshot.account
      tables.chargeRequest = snapshot.chargeRequest
      chargeToAccount.clear()
      for (const [k, v] of snapshot.links) chargeToAccount.set(k, v)
      throw err
    }
  }

  function seedChargeRequest(accountId: string, row: Record<string, unknown>) {
    tables.chargeRequest.set(row.id as string, row)
    chargeToAccount.set(row.id as string, accountId)
  }

  return { client, tables, seedChargeRequest, linkedChargeRequests }
}

function buildConfig(hooks: Parameters<typeof list>[0]['hooks'] = {}) {
  return config({
    db: { provider: 'postgresql', url: 'postgresql://localhost:5432/test' },
    lists: {
      Account: list({
        fields: { name: text() },
        access: {
          operation: {
            query: () => true,
            create: () => true,
            update: () => true,
            delete: () => true,
          },
        },
      }),
      // No `requests`/`chargeRequests` field on Account — this ref is
      // list-only, so the generator synthesizes `from_ChargeRequest_account`.
      ChargeRequest: list({
        fields: {
          kind: text(),
          account: relationship({ ref: 'Account' }),
        },
        access: {
          operation: {
            query: () => true,
            create: () => true,
            update: () => true,
            delete: () => true,
          },
        },
        hooks,
      }),
    },
  })
}

describe('#978 nested writes through a synthetic reverse relation', () => {
  it('a non-sudo write through the synthetic key is still refused — unchanged', async () => {
    const mock = createAccountPrisma()
    mock.tables.account.set('a1', { id: 'a1', name: 'Acme' })
    const context = getContext(await buildConfig(), mock.client, { userId: '1' })

    await expect(
      context.db.account.update({
        where: { id: 'a1' },
        data: { [SYNTHETIC_FIELD]: { create: { kind: 'DEPOSIT' } } },
      }),
    ).rejects.toThrow(/from_ChargeRequest_account/)
  })

  it('sudo nested create through the synthetic key runs the target list validate hook and refuses an invalid row', async () => {
    const mock = createAccountPrisma()
    mock.tables.account.set('a1', { id: 'a1', name: 'Acme' })

    const testConfig = buildConfig({
      validate: ({ resolvedData, addValidationError }) => {
        if (resolvedData.kind === 'INCOHERENT') {
          addValidationError('kind must not be INCOHERENT')
        }
      },
    })
    const context = getContext(await testConfig, mock.client, { userId: '1' }).sudo()

    await expect(
      context.db.account.update({
        where: { id: 'a1' },
        data: { [SYNTHETIC_FIELD]: { create: { kind: 'INCOHERENT' } } },
      }),
    ).rejects.toThrow(ValidationError)

    // Refused before commit — nothing persisted, matching the atomic write
    // pipeline's "throw rolls back the whole transaction" contract.
    expect(mock.tables.chargeRequest.size).toBe(0)
  })

  it('sudo nested create through the synthetic key runs resolveInput, beforeOperation, and afterOperation', async () => {
    const mock = createAccountPrisma()
    mock.tables.account.set('a1', { id: 'a1', name: 'Acme' })

    const events: string[] = []
    const testConfig = buildConfig({
      resolveInput: ({ resolvedData }) => {
        events.push('resolveInput')
        return { ...resolvedData, kind: (resolvedData.kind as string).toUpperCase() }
      },
      beforeOperation: ({ operation }) => {
        events.push(`beforeOperation:${operation}`)
      },
      afterOperation: ({ operation, item }) => {
        events.push(`afterOperation:${operation}`)
        expect(item).toBeDefined()
        expect((item as Record<string, unknown>).id).toBeDefined()
      },
    })
    const context = getContext(await testConfig, mock.client, { userId: '1' }).sudo()

    await context.db.account.update({
      where: { id: 'a1' },
      data: { [SYNTHETIC_FIELD]: { create: { kind: 'deposit' } } },
    })

    expect(events).toEqual(['resolveInput', 'beforeOperation:create', 'afterOperation:create'])
    const created = Array.from(mock.tables.chargeRequest.values())
    expect(created).toHaveLength(1)
    // resolveInput's transform actually landed in the persisted row.
    expect(created[0].kind).toBe('DEPOSIT')
  })

  it('created-row recovery works for a synthetic-relation nested create, like the declared path', async () => {
    const mock = createAccountPrisma()
    mock.tables.account.set('a1', { id: 'a1', name: 'Acme' })
    mock.seedChargeRequest('a1', { id: 'pre-1', kind: 'PRE_EXISTING' })

    const createdItems: Array<Record<string, unknown>> = []
    const testConfig = buildConfig({
      afterOperation: ({ operation, item }) => {
        if (operation === 'create') createdItems.push(item as Record<string, unknown>)
      },
    })
    const context = getContext(await testConfig, mock.client, { userId: '1' }).sudo()

    await context.db.account.update({
      where: { id: 'a1' },
      data: { [SYNTHETIC_FIELD]: { create: [{ kind: 'DEPOSIT' }, { kind: 'WITHDRAW' }] } },
    })

    // Exactly the two NEW rows fired afterOperation, each with its own
    // distinct persisted id — never the pre-existing row, never a shared id.
    expect(createdItems).toHaveLength(2)
    const ids = createdItems.map((c) => c.id)
    expect(new Set(ids).size).toBe(2)
    expect(ids).not.toContain('pre-1')
    expect(createdItems.map((c) => c.kind).sort()).toEqual(['DEPOSIT', 'WITHDRAW'])

    expect(
      mock
        .linkedChargeRequests('a1')
        .map((c) => c.kind)
        .sort(),
    ).toEqual(['DEPOSIT', 'PRE_EXISTING', 'WITHDRAW'])
  })

  it('sudo nested update through the synthetic key fires afterOperation with originalItem and the updated item', async () => {
    const mock = createAccountPrisma()
    mock.tables.account.set('a1', { id: 'a1', name: 'Acme' })
    mock.seedChargeRequest('a1', { id: 'cr-1', kind: 'DEPOSIT' })

    const afterOp = vi.fn()
    const testConfig = buildConfig({ afterOperation: afterOp })
    const context = getContext(await testConfig, mock.client, { userId: '1' }).sudo()

    await context.db.account.update({
      where: { id: 'a1' },
      data: {
        [SYNTHETIC_FIELD]: { update: { where: { id: 'cr-1' }, data: { kind: 'WITHDRAW' } } },
      },
    })

    expect(afterOp).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'update',
        originalItem: expect.objectContaining({ id: 'cr-1', kind: 'DEPOSIT' }),
        item: expect.objectContaining({ id: 'cr-1', kind: 'WITHDRAW' }),
      }),
    )
  })

  it('sudo nested delete through the synthetic key fires before/afterOperation with originalItem', async () => {
    const mock = createAccountPrisma()
    mock.tables.account.set('a1', { id: 'a1', name: 'Acme' })
    mock.seedChargeRequest('a1', { id: 'cr-1', kind: 'DEPOSIT' })

    const listBefore = vi.fn()
    const listAfter = vi.fn()
    const testConfig = buildConfig({ beforeOperation: listBefore, afterOperation: listAfter })
    const context = getContext(await testConfig, mock.client, { userId: '1' }).sudo()

    await context.db.account.update({
      where: { id: 'a1' },
      data: { [SYNTHETIC_FIELD]: { delete: { id: 'cr-1' } } },
    })

    expect(listBefore).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'delete',
        item: expect.objectContaining({ id: 'cr-1', kind: 'DEPOSIT' }),
      }),
    )
    expect(listAfter).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'delete',
        originalItem: expect.objectContaining({ id: 'cr-1', kind: 'DEPOSIT' }),
      }),
    )
    expect(mock.tables.chargeRequest.has('cr-1')).toBe(false)
  })

  it('a throwing nested afterOperation on the synthetic path rolls back the whole write (atomicity)', async () => {
    const mock = createAccountPrisma()
    mock.tables.account.set('a1', { id: 'a1', name: 'Acme' })

    const testConfig = buildConfig({
      afterOperation: ({ operation }) => {
        if (operation === 'create') throw new Error('synthetic afterOperation boom')
      },
    })
    const context = getContext(await testConfig, mock.client, { userId: '1' }).sudo()

    await expect(
      context.db.account.update({
        where: { id: 'a1' },
        data: {
          name: 'Should NOT persist',
          [SYNTHETIC_FIELD]: { create: { kind: 'DEPOSIT' } },
        },
      }),
    ).rejects.toThrow('synthetic afterOperation boom')

    expect(mock.tables.account.get('a1')?.name).toBe('Acme')
    expect(mock.tables.chargeRequest.size).toBe(0)
  })

  it('a genuinely unknown key (not a synthetic reverse relation) is refused even under sudo', async () => {
    const mock = createAccountPrisma()
    mock.tables.account.set('a1', { id: 'a1', name: 'Acme' })
    const context = getContext(await buildConfig(), mock.client, { userId: '1' }).sudo()

    await expect(
      context.db.account.update({
        where: { id: 'a1' },
        data: { totallyBogusKey: { create: { kind: 'DEPOSIT' } } },
      }),
    ).rejects.toThrow(/totallyBogusKey/)

    expect(mock.tables.account.get('a1')?.name).toBe('Acme')
  })
})
