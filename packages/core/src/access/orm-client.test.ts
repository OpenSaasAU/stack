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
  it('resolves a list name verbatim off the client', () => {
    const AuthUser = makeDelegate()
    const ormHandle: OrmClient = { AuthUser }

    expect(ormModel(ormHandle, 'AuthUser')).toBe(AuthUser)
  })

  it('does not read a camelCase key for a PascalCase list name', () => {
    const ormHandle: OrmClient = { authUser: makeDelegate() }

    expect(() => ormModel(ormHandle, 'AuthUser')).toThrow(OrmModelMissingError)
  })

  it('accepts a partial delegate, since a test double implements only what it reaches', () => {
    const countOnly = { count: async () => 0 }
    const ormHandle: OrmClient = { Post: countOnly }

    expect(ormModel(ormHandle, 'Post')).toBe(countOnly)
  })

  it('resolves through a client that also carries $transaction', () => {
    const Post = makeDelegate()
    const ormHandle: OrmClient = { $transaction: async () => [], Post }

    expect(ormModel(ormHandle, 'Post')).toBe(Post)
  })

  it('throws OrmModelMissingError naming the list it looked for', () => {
    const ormHandle: OrmClient = { Post: makeDelegate() }

    expect(() => ormModel(ormHandle, 'BlogPost')).toThrow(OrmModelMissingError)

    try {
      ormModel(ormHandle, 'BlogPost')
      expect.unreachable('ormModel should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(OrmModelMissingError)
      if (!(error instanceof OrmModelMissingError)) return
      expect(error.listName).toBe('BlogPost')
      expect(error.name).toBe('OrmModelMissingError')
      expect(error.message).toContain('"BlogPost"')
      expect(error.message).toContain('opensaas generate')
    }
  })

  it('reports the missing model itself rather than surfacing later as a TypeError', () => {
    const ormHandle: OrmClient = {}

    let thrown: unknown
    try {
      ormModel(ormHandle, 'Post')
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
    ['a string', 'Post'],
    ['a number', 0],
    ['a function', () => undefined],
  ])('rejects a key holding %s', (_label, value) => {
    const ormHandle: OrmClient = { Post: value }

    expect(() => ormModel(ormHandle, 'Post')).toThrow(OrmModelMissingError)
  })
})
