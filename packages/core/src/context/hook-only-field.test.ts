import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { config, list } from '../config/index.js'
import { select, text } from '../fields/index.js'
import { createTestContext, type TestContext } from '../testing/context.js'
import { ValidationError } from '../hooks/index.js'

const BOOT = 120_000

async function hookOnlyConfig() {
  return await config({
    db: { provider: 'postgresql' },
    lists: {
      Order: list({
        fields: {
          title: text(),
          state: select({
            options: [
              { label: 'New', value: 'new' },
              { label: 'Done', value: 'done' },
            ],
            defaultValue: 'new',
            access: { write: 'hooks' },
          }),
          stamp: text({
            access: { write: 'hooks' },
            hooks: {
              resolveInput: ({ resolvedData }) => String(resolvedData.stamp ?? '').toUpperCase(),
            },
          }),
        },
        access: { operation: { query: () => true, create: () => true, update: () => true } },
        hooks: {
          resolveInput: ({ resolvedData, inputData }) =>
            inputData.title === 'finish'
              ? { ...resolvedData, state: 'done', stamp: 'ok' }
              : resolvedData,
        },
      }),
    },
  })
}

describe('hook-only fields (access.write = "hooks")', () => {
  let harness: TestContext

  beforeAll(async () => {
    harness = await createTestContext(await hookOnlyConfig(), { userId: 'u1' })
  }, BOOT)
  afterAll(async () => {
    await harness?.close()
  })
  beforeEach(async () => {
    await harness.truncate()
  })

  test('a caller naming the field is refused', async () => {
    await expect(
      harness.context.db.Order.create({ data: { title: 'a', state: 'done' } }),
    ).rejects.toBeInstanceOf(ValidationError)
  })

  test('sudo is refused too', async () => {
    await expect(
      harness.context.sudo().db.Order.create({ data: { title: 'a', state: 'done' } }),
    ).rejects.toThrow(/state/)
  })

  test('defaultValue applies on create', async () => {
    const row = await harness.context.db.Order.create({ data: { title: 'a' } })
    expect(row?.state).toBe('new')
  })

  test('list and field resolveInput set it, sudo and non-sudo', async () => {
    const created = await harness.context.db.Order.create({ data: { title: 'finish' } })
    expect(created).toMatchObject({ state: 'done', stamp: 'OK' })
    const updated = await harness.context.sudo().db.Order.update({
      where: { id: created!.id },
      data: { title: 'finish' },
    })
    expect(updated).toMatchObject({ state: 'done', stamp: 'OK' })
  })

  test('an update naming the field is refused', async () => {
    const created = await harness.context.db.Order.create({ data: { title: 'a' } })
    await expect(
      harness.context.db.Order.update({ where: { id: created!.id }, data: { state: 'done' } }),
    ).rejects.toThrow(/state/)
  })
})

test('write: "hooks" cannot be combined with an update rule', () => {
  text({
    // @ts-expect-error a hook-only field takes no create/update rule
    access: { write: 'hooks', update: () => true },
  })
})

test('an unknown write marker or a combined rule is refused at config time', () => {
  const build = (access: object) =>
    config({
      db: { provider: 'postgresql' },
      lists: { A: list({ fields: { x: text({ access: access as never }) } }) },
    })
  expect(() => build({ write: 'hook' })).toThrow(/access.write/)
  expect(() => build({ write: 'hooks', update: () => true })).toThrow(/cannot be combined/)
})
