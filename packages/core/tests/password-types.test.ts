import { describe, it, expect } from 'vitest'
import { config, list, getContext } from '../src/index.js'
import { text, password } from '../src/fields/index.js'
import { PrismaClient } from '@prisma/client'
import type { HashedPassword } from '../src/utils/password.js'

/**
 * Type tests for password field transformations
 * These tests verify that TypeScript correctly infers HashedPassword type
 */
describe('Password Field Type Safety', () => {
  // Mock Prisma client for type testing
  const mockPrismaClient = {
    user: {
      findUnique: async () => ({
        id: '1',
        email: 'test@example.com',
        password: '$2a$10$hashedpassword',
      }),
      findMany: async () => [
        {
          id: '1',
          email: 'test@example.com',
          password: '$2a$10$hashedpassword',
        },
      ],
      create: async () => ({
        id: '1',
        email: 'test@example.com',
        password: '$2a$10$hashedpassword',
      }),
      update: async () => ({
        id: '1',
        email: 'test@example.com',
        password: '$2a$10$hashedpassword',
      }),
      delete: async () => ({
        id: '1',
        email: 'test@example.com',
        password: '$2a$10$hashedpassword',
      }),
      count: async () => 1,
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
          email: text({ validation: { isRequired: true } }),
          password: password({ validation: { isRequired: true } }),
        },
      }),
    },
  })

  it('should transform password field to HashedPassword type in findUnique', async () => {
    const context = getContext(await testConfig, mockPrismaClient, null)

    const user = await context.db.user.findUnique({ where: { id: '1' } })

    // Type check: TypeScript should know that user.password is HashedPassword
    if (user) {
      // This should compile - compare method should exist
      const isValid: boolean = await user.password.compare('plaintext')
      expect(typeof isValid).toBe('boolean')

      // Runtime check: verify it's actually a HashedPassword instance
      expect(user.password).toBeDefined()
      expect(typeof user.password.compare).toBe('function')
      expect(typeof user.password.toString).toBe('function')
    }
  })

  it('should transform password field to HashedPassword type in findMany', async () => {
    const context = await getContext(await testConfig, mockPrismaClient, null)

    const users = await context.db.user.findMany()

    // Type check: TypeScript should know that users[0].password is HashedPassword
    if (users.length > 0) {
      const user = users[0]

      // This should compile - compare method should exist
      const isValid: boolean = await user.password.compare('plaintext')
      expect(typeof isValid).toBe('boolean')

      // Runtime check
      expect(user.password).toBeDefined()
      expect(typeof user.password.compare).toBe('function')
    }
  })

  it('should transform password field to HashedPassword type in create', async () => {
    const context = getContext(await testConfig, mockPrismaClient, null)

    const user = await context.db.user.create({
      data: {
        email: 'new@example.com',
        password: 'plaintext',
      },
    })

    // Type check: TypeScript should know that user.password is HashedPassword
    if (user) {
      // This should compile
      const isValid: boolean = await user.password.compare('plaintext')
      expect(typeof isValid).toBe('boolean')
    }
  })

  it('should transform password field to HashedPassword type in update', async () => {
    const context = getContext(await testConfig, mockPrismaClient, null)

    const user = await context.db.user.update({
      where: { id: '1' },
      data: {
        password: 'newpassword',
      },
    })

    // Type check: TypeScript should know that user.password is HashedPassword
    if (user) {
      // This should compile
      const isValid: boolean = await user.password.compare('newpassword')
      expect(typeof isValid).toBe('boolean')
    }
  })

  it('should allow checking the HashedPassword type explicitly', async () => {
    const context = getContext(await testConfig, mockPrismaClient, null)

    const user = await context.db.user.findUnique({ where: { id: '1' } })

    if (user) {
      // Explicit type assertion to verify TypeScript inference
      const passwordField: HashedPassword = user.password

      expect(passwordField).toBeDefined()
      expect(await passwordField.compare('test')).toBe(false)
    }
  })
})
