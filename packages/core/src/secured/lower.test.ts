import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * `whereCombinators`/`vectorLowering` cache a module-level promise, so each
 * case needs a fresh module instance to control what the lazy `import()`
 * resolves to — `vi.resetModules()` plus a re-import gets that.
 */
afterEach(() => {
  vi.doUnmock('@prisma/orm-postgres/orm-client')
  vi.doUnmock('@prisma/orm-postgres/relational-core/expression')
  vi.doUnmock('@prisma/orm-postgres/relational-core/ast')
  vi.resetModules()
})

describe('whereCombinators', () => {
  it('does not cache a rejected import — the next call retries', async () => {
    vi.doMock('@prisma/orm-postgres/orm-client', () => {
      throw new Error('transient import failure')
    })
    vi.resetModules()
    const { whereCombinators } = await import('./lower.js')

    await expect(whereCombinators()).rejects.toThrow()

    const and = vi.fn()
    const or = vi.fn()
    const all = vi.fn()
    vi.doUnmock('@prisma/orm-postgres/orm-client')
    vi.doMock('@prisma/orm-postgres/orm-client', () => ({ and, or, all }))

    await expect(whereCombinators()).resolves.toEqual({ and, or, all })
  })

  it('caches a successful import — one import call across repeated callers', async () => {
    const and = vi.fn()
    const or = vi.fn()
    const all = vi.fn()
    const factory = vi.fn(() => ({ and, or, all }))
    vi.doMock('@prisma/orm-postgres/orm-client', factory)
    vi.resetModules()
    const { whereCombinators } = await import('./lower.js')

    const first = await whereCombinators()
    const second = await whereCombinators()

    expect(first).toBe(second)
    expect(factory).toHaveBeenCalledTimes(1)
  })
})

describe('vectorLowering', () => {
  it('does not cache a rejected import — the next call retries', async () => {
    vi.doMock('@prisma/orm-postgres/relational-core/expression', () => {
      throw new Error('transient import failure')
    })
    vi.resetModules()
    const { vectorLowering } = await import('./lower.js')

    await expect(vectorLowering()).rejects.toThrow()

    vi.doUnmock('@prisma/orm-postgres/relational-core/expression')

    await expect(vectorLowering()).resolves.toEqual({
      order: expect.any(Function),
      bound: expect.any(Function),
    })
  })
})
