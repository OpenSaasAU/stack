import { describe, it, expect } from 'vitest'
import { config, list, getContext } from '../src/index.js'
import { text, password, relationship } from '../src/fields/index.js'
import { PrismaClient } from '@prisma/client'
import type { HashedPassword } from '../src/utils/password.js'

/**
 * Test to verify that password field transformation doesn't cause union type distribution
 * This was the bug: all fields were becoming `string | HashedPassword` instead of just password field
 */
describe('Password Field Type Distribution Bug Fix', () => {
  const mockPrismaClient = {
    user: {
      findUnique: async () => ({
        id: '1',
        name: 'John Doe',
        email: 'john@example.com',
        password: '$2a$10$hashedpassword',
      }),
      findMany: async () => [
        {
          id: '1',
          name: 'John Doe',
          email: 'john@example.com',
          password: '$2a$10$hashedpassword',
          posts: [
            {
              id: 'post1',
              title: 'Test Post',
              authorId: '1',
            },
          ],
        },
      ],
    },
    post: {
      findMany: async () => [],
    },
  } as unknown as PrismaClient

  const testConfig = config({
    db: {
      provider: 'sqlite',
      url: 'file:./test.db',
    },
    lists: {
      User: list({
        fields: {
          name: text({ validation: { isRequired: true } }),
          email: text({ validation: { isRequired: true } }),
          password: password({ validation: { isRequired: true } }),
          posts: relationship({ ref: 'Post.author', many: true }),
        },
      }),
      Post: list({
        fields: {
          title: text({ validation: { isRequired: true } }),
          author: relationship({ ref: 'User.posts' }),
        },
      }),
    },
  })

  it('should NOT make all fields a union of string | HashedPassword', async () => {
    const context = getContext(await testConfig, mockPrismaClient, null)

    const user = await context.db.user.findUnique({ where: { id: '1' } })

    if (user) {
      // Type assertions that should compile correctly
      // These would fail if the bug exists (type would be string | HashedPassword for all fields)

      // name should be string, not string | HashedPassword
      const name: string = user.name
      expect(typeof name).toBe('string')

      // email should be string, not string | HashedPassword
      const email: string = user.email
      expect(typeof email).toBe('string')

      // id should be string, not string | HashedPassword
      const id: string = user.id
      expect(typeof id).toBe('string')

      // password SHOULD be HashedPassword
      const password: HashedPassword = user.password
      expect(typeof password.compare).toBe('function')

      // If the bug existed, this would be a type error because
      // string | HashedPassword doesn't have .compare()
      const canCompare: boolean = await password.compare('test')
      expect(typeof canCompare).toBe('boolean')
    }
  })

  it('should preserve types with included relationships', async () => {
    const context = getContext(await testConfig, mockPrismaClient, null)

    const users = await context.db.user.findMany({
      include: {
        posts: true,
      },
    })

    if (users.length > 0) {
      const user = users[0]

      // Regular fields should have their original types
      const name: string = user.name
      const email: string = user.email
      const id: string = user.id

      // Password should be HashedPassword
      const password: HashedPassword = user.password

      // Posts should be included and typed
      if (user.posts && user.posts.length > 0) {
        const post = user.posts[0]
        const title: string = post.title
        expect(typeof title).toBe('string')
      }

      expect(typeof name).toBe('string')
      expect(typeof email).toBe('string')
      expect(typeof id).toBe('string')
      expect(typeof password.compare).toBe('function')
    }
  })

  it('should verify TypeScript narrowing works correctly', async () => {
    const context = getContext(await testConfig, mockPrismaClient, null)

    const user = await context.db.user.findUnique({ where: { id: '1' } })

    if (user) {
      // This is the key test: if all fields were string | HashedPassword,
      // we couldn't assign to string without type assertion

      // These should compile without type assertions
      function expectString(val: string): void {
        expect(typeof val).toBe('string')
      }

      function expectHashedPassword(val: HashedPassword): void {
        expect(typeof val.compare).toBe('function')
      }

      // These calls prove the types are correctly narrowed
      expectString(user.name)
      expectString(user.email)
      expectString(user.id)
      expectHashedPassword(user.password)
    }
  })
})
