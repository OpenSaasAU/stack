import { describe, it, expect, vi } from 'vitest'
import {
  checkAccess,
  mergeFilters,
  checkFieldAccess,
  filterReadableFields,
  filterWritableFields,
  isBoolean,
  isPrismaFilter,
} from '../src/access/engine.js'
import type { AccessControl, FieldAccess, AccessContext } from '../src/access/types.js'

describe('Access Control', () => {
  const mockContext: AccessContext = {
    session: null,
    prisma: {},
    db: {},
  }

  describe('isBoolean', () => {
    it('should return true for boolean values', () => {
      expect(isBoolean(true)).toBe(true)
      expect(isBoolean(false)).toBe(true)
    })

    it('should return false for non-boolean values', () => {
      expect(isBoolean(1)).toBe(false)
      expect(isBoolean('true')).toBe(false)
      expect(isBoolean({})).toBe(false)
      expect(isBoolean(null)).toBe(false)
    })
  })

  describe('isPrismaFilter', () => {
    it('should return true for object filters', () => {
      expect(isPrismaFilter({ id: '123' })).toBe(true)
      expect(isPrismaFilter({ name: { equals: 'John' } })).toBe(true)
    })

    it('should return false for non-filter values', () => {
      expect(isPrismaFilter(true)).toBe(false)
      expect(isPrismaFilter(false)).toBe(false)
      expect(isPrismaFilter(null)).toBe(false)
      expect(isPrismaFilter([])).toBe(false)
    })
  })

  describe('checkAccess', () => {
    it('should return false when no access control is defined', async () => {
      const result = await checkAccess(undefined, {
        session: null,
        context: mockContext,
      })

      expect(result).toBe(false)
    })

    it('should return true when access control allows', async () => {
      const accessControl: AccessControl = vi.fn(async () => true)

      const result = await checkAccess(accessControl, {
        session: null,
        context: mockContext,
      })

      expect(result).toBe(true)
      expect(accessControl).toHaveBeenCalledWith({
        session: null,
        context: mockContext,
      })
    })

    it('should return false when access control denies', async () => {
      const accessControl: AccessControl = vi.fn(async () => false)

      const result = await checkAccess(accessControl, {
        session: null,
        context: mockContext,
      })

      expect(result).toBe(false)
    })

    it('should return filter when access control returns a filter', async () => {
      const filter = { userId: '123' }
      const accessControl: AccessControl = vi.fn(async () => filter)

      const result = await checkAccess(accessControl, {
        session: { userId: '123' },
        context: mockContext,
      })

      expect(result).toEqual(filter)
    })

    it('should pass item to access control when provided', async () => {
      const item = { id: '1', name: 'Test' }
      const accessControl: AccessControl = vi.fn(async () => true)

      await checkAccess(accessControl, {
        session: null,
        item,
        context: mockContext,
      })

      expect(accessControl).toHaveBeenCalledWith({
        session: null,
        item,
        context: mockContext,
      })
    })
  })

  describe('mergeFilters', () => {
    it('should return null when access is denied', () => {
      const result = mergeFilters({ id: '123' }, false)
      expect(result).toBeNull()
    })

    it('should return user filter when access is fully granted', () => {
      const userFilter = { name: 'John' }
      const result = mergeFilters(userFilter, true)
      expect(result).toEqual(userFilter)
    })

    it('should return empty object when access is granted and no user filter', () => {
      const result = mergeFilters(undefined, true)
      expect(result).toEqual({})
    })

    it('should return access filter when no user filter', () => {
      const accessFilter = { userId: '123' }
      const result = mergeFilters(undefined, accessFilter)
      expect(result).toEqual(accessFilter)
    })

    it('should combine filters with AND when both exist', () => {
      const userFilter = { name: 'John' }
      const accessFilter = { userId: '123' }
      const result = mergeFilters(userFilter, accessFilter)

      expect(result).toEqual({
        AND: [accessFilter, userFilter],
      })
    })
  })

  describe('checkFieldAccess', () => {
    it('should allow access when no field access is defined', async () => {
      const result = await checkFieldAccess(undefined, 'read', {
        session: null,
        context: mockContext,
      })

      expect(result).toBe(true)
    })

    it('should allow access when no specific operation access is defined', async () => {
      const fieldAccess: FieldAccess = {}

      const result = await checkFieldAccess(fieldAccess, 'read', {
        session: null,
        context: mockContext,
      })

      expect(result).toBe(true)
    })

    it('should deny access when operation returns false', async () => {
      const fieldAccess: FieldAccess = {
        read: vi.fn(async () => false),
      }

      const result = await checkFieldAccess(fieldAccess, 'read', {
        session: null,
        context: mockContext,
      })

      expect(result).toBe(false)
    })

    it('should allow access when operation returns true', async () => {
      const fieldAccess: FieldAccess = {
        read: vi.fn(async () => true),
      }

      const result = await checkFieldAccess(fieldAccess, 'read', {
        session: null,
        context: mockContext,
      })

      expect(result).toBe(true)
    })

    it('should receive inputData for create operations', async () => {
      const inputData = { title: 'Test', authorId: '123' }
      const fieldAccess: FieldAccess = {
        create: vi.fn(async ({ inputData: data }) => {
          // Field access can validate inputData
          return data?.authorId === '123'
        }),
      }

      const result = await checkFieldAccess(fieldAccess, 'create', {
        session: null,
        context: mockContext,
        inputData,
      })

      expect(result).toBe(true)
      expect(fieldAccess.create).toHaveBeenCalledWith(expect.objectContaining({ inputData }))
    })

    it('should receive inputData for update operations', async () => {
      const inputData = { title: 'Updated', authorId: '123' }
      const item = { id: '1', authorId: '123' }
      const fieldAccess: FieldAccess = {
        update: vi.fn(async ({ inputData: data, item: existingItem }) => {
          // Field access can validate inputData and check existing item
          return data?.authorId === existingItem?.authorId
        }),
      }

      const result = await checkFieldAccess(fieldAccess, 'update', {
        session: null,
        item,
        context: mockContext,
        inputData,
      })

      expect(result).toBe(true)
      expect(fieldAccess.update).toHaveBeenCalledWith(expect.objectContaining({ inputData, item }))
    })

    it('should not receive inputData for read operations', async () => {
      const fieldAccess: FieldAccess = {
        read: vi.fn(async ({ inputData }) => {
          // inputData should be undefined for read operations
          expect(inputData).toBeUndefined()
          return true
        }),
      }

      const result = await checkFieldAccess(fieldAccess, 'read', {
        session: null,
        context: mockContext,
      })

      expect(result).toBe(true)
    })
  })

  describe('filterReadableFields', () => {
    it('should include all fields when no access control', async () => {
      const item = {
        id: '1',
        name: 'John',
        email: 'john@example.com',
        createdAt: new Date(),
      }

      const fieldConfigs = {
        name: { type: 'text' },
        email: { type: 'text' },
      }

      const result = await filterReadableFields(item, fieldConfigs, {
        session: null,
        context: mockContext,
      })

      expect(result).toEqual(item)
    })

    it('should always include system fields', async () => {
      const item = {
        id: '1',
        createdAt: new Date(),
        updatedAt: new Date(),
        name: 'John',
      }

      const fieldConfigs = {
        name: {
          access: {
            read: async () => false,
          },
        },
      }

      const result = await filterReadableFields(item, fieldConfigs, {
        session: null,
        context: mockContext,
      })

      expect(result.id).toBe('1')
      expect(result.createdAt).toBeDefined()
      expect(result.updatedAt).toBeDefined()
      expect(result.name).toBeUndefined()
    })

    it('should filter out fields with denied read access', async () => {
      const item = {
        id: '1',
        name: 'John',
        email: 'john@example.com',
        password: 'hashed',
      }

      const fieldConfigs = {
        name: { type: 'text' },
        email: { type: 'text' },
        password: {
          type: 'password',
          access: {
            read: async () => false,
          },
        },
      }

      const result = await filterReadableFields(item, fieldConfigs, {
        session: null,
        context: mockContext,
      })

      expect(result.name).toBe('John')
      expect(result.email).toBe('john@example.com')
      expect(result.password).toBeUndefined()
    })

    it('should respect session in field access', async () => {
      const item = {
        id: '1',
        name: 'John',
        salary: 100000,
      }

      const fieldConfigs = {
        name: { type: 'text' },
        salary: {
          type: 'integer',
          access: {
            read: async ({ session }) => session?.role === 'admin',
          },
        },
      }

      // Without admin session
      const resultNoAccess = await filterReadableFields(item, fieldConfigs, {
        session: { role: 'user' },
        context: mockContext,
      })

      expect(resultNoAccess.salary).toBeUndefined()

      // With admin session
      const resultWithAccess = await filterReadableFields(item, fieldConfigs, {
        session: { role: 'admin' },
        context: mockContext,
      })

      expect(resultWithAccess.salary).toBe(100000)
    })
  })

  describe('filterWritableFields', () => {
    it('should include all fields when no access control', async () => {
      const data = {
        name: 'John',
        email: 'john@example.com',
      }

      const fieldConfigs = {
        name: { type: 'text' },
        email: { type: 'text' },
      }

      const result = await filterWritableFields(data, fieldConfigs, 'create', {
        session: null,
        context: mockContext,
      })

      expect(result).toEqual(data)
    })

    it('should skip system fields', async () => {
      const data = {
        id: '1',
        createdAt: new Date(),
        updatedAt: new Date(),
        name: 'John',
      }

      const fieldConfigs = {
        name: { type: 'text' },
      }

      const result = await filterWritableFields(data, fieldConfigs, 'create', {
        session: null,
        context: mockContext,
      })

      expect(result.id).toBeUndefined()
      expect(result.createdAt).toBeUndefined()
      expect(result.updatedAt).toBeUndefined()
      expect(result.name).toBe('John')
    })

    it('should filter out fields with denied write access', async () => {
      const data = {
        name: 'John',
        email: 'john@example.com',
        role: 'admin',
      }

      const fieldConfigs = {
        name: { type: 'text' },
        email: { type: 'text' },
        role: {
          type: 'select',
          access: {
            create: async () => false,
          },
        },
      }

      const result = await filterWritableFields(data, fieldConfigs, 'create', {
        session: null,
        context: mockContext,
      })

      expect(result.name).toBe('John')
      expect(result.email).toBe('john@example.com')
      expect(result.role).toBeUndefined()
    })

    it('should respect different access for create vs update', async () => {
      const data = {
        email: 'john@example.com',
      }

      const fieldConfigs = {
        email: {
          type: 'text',
          access: {
            create: async () => true,
            update: async () => false,
          },
        },
      }

      // Allow on create
      const createResult = await filterWritableFields(data, fieldConfigs, 'create', {
        session: null,
        context: mockContext,
      })

      expect(createResult.email).toBe('john@example.com')

      // Deny on update
      const updateResult = await filterWritableFields(data, fieldConfigs, 'update', {
        session: null,
        context: mockContext,
      })

      expect(updateResult.email).toBeUndefined()
    })

    it('should pass item to field access on update', async () => {
      const data = { name: 'Updated Name' }
      const item = { id: '1', name: 'Original', userId: '123' }
      const accessFn = vi.fn(async () => true)

      const fieldConfigs = {
        name: {
          type: 'text',
          access: {
            update: accessFn,
          },
        },
      }

      await filterWritableFields(data, fieldConfigs, 'update', {
        session: { userId: '123' },
        item,
        context: mockContext,
      })

      expect(accessFn).toHaveBeenCalledWith({
        session: { userId: '123' },
        item,
        context: mockContext,
      })
    })
  })
})
