import { describe, it, expect } from 'vitest'
import type { OrmClient, OrmModelDelegate, OrmRow } from './types.js'
import { ormModel, OrmModelMissingError } from './orm-client.js'

function makeDelegate(): OrmModelDelegate {
  const row: OrmRow = { id: '1' }
  return {
    findUnique: async () => row,
    findFirst: async () => row,
    findMany: async () => [row],
    create: async () => row,
    update: async () => row,
    delete: async () => row,
    count: async () => 1,
  }
}

describe('ormModel', () => {
  it('resolves a PascalCase list name through its camelCase client key', () => {
    const authUser = makeDelegate()
    const prisma: OrmClient = { authUser }

    expect(ormModel(prisma, 'AuthUser')).toBe(authUser)
  })

  it('does not read the list name verbatim off the client', () => {
    const prisma: OrmClient = { AuthUser: makeDelegate() }

    expect(() => ormModel(prisma, 'AuthUser')).toThrow(OrmModelMissingError)
  })

  it('accepts a partial delegate, since a test double implements only what it reaches', () => {
    const countOnly = { count: async () => 0 }
    const prisma: OrmClient = { post: countOnly }

    expect(ormModel(prisma, 'Post')).toBe(countOnly)
  })

  it('resolves through a client that also carries $transaction', () => {
    const post = makeDelegate()
    const prisma: OrmClient = { $transaction: async () => [], post }

    expect(ormModel(prisma, 'Post')).toBe(post)
  })

  it('throws OrmModelMissingError naming the list and the key it looked for', () => {
    const prisma: OrmClient = { post: makeDelegate() }

    expect(() => ormModel(prisma, 'BlogPost')).toThrow(OrmModelMissingError)

    try {
      ormModel(prisma, 'BlogPost')
      expect.unreachable('ormModel should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(OrmModelMissingError)
      if (!(error instanceof OrmModelMissingError)) return
      expect(error.listName).toBe('BlogPost')
      expect(error.name).toBe('OrmModelMissingError')
      expect(error.message).toContain('"BlogPost"')
      expect(error.message).toContain('"blogPost"')
      expect(error.message).toContain('opensaas generate')
    }
  })

  it('reports the missing model itself rather than surfacing later as a TypeError', () => {
    const prisma: OrmClient = {}

    let thrown: unknown
    try {
      ormModel(prisma, 'Post')
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(Error)
    expect(thrown).toBeInstanceOf(OrmModelMissingError)
    expect(thrown).not.toBeInstanceOf(TypeError)
  })

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['a string', 'post'],
    ['a number', 0],
    ['a function', () => undefined],
  ])('rejects a key holding %s', (_label, value) => {
    const prisma: OrmClient = { post: value }

    expect(() => ormModel(prisma, 'Post')).toThrow(OrmModelMissingError)
  })
})
