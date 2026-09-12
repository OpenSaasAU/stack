import { describe, it, expect, vi } from 'vitest'
import {
  ValidationError,
  executeResolveInput,
  executeValidateInput,
  executeBeforeOperation,
  executeAfterOperation,
  validateFieldRules,
} from './index.js'
import type { Hooks } from '../config/types.js'
import type { AccessContext } from '../access/types.js'
import { text, integer, relationship } from '../fields/index.js'

describe('Hooks', () => {
  const mockContext: AccessContext = {
    session: null,
    ormHandle: {},
    db: {},
    storage: {
      uploadFile: async () => ({ filename: '', filesize: 0, url: '' }),
      uploadImage: async () => ({
        id: '',
        extension: '',
        width: 0,
        height: 0,
        filesize: 0,
        url: '',
      }),
      deleteFile: async () => {},
      deleteImage: async () => {},
    },
    plugins: {},
    _isSudo: false,
    _resolveOutputChain: [],
  }

  describe('ValidationError', () => {
    it('should create validation error with errors array', () => {
      const errors = ['Field is required', 'Invalid email']
      const error = new ValidationError(errors)

      expect(error).toBeInstanceOf(Error)
      expect(error.name).toBe('ValidationError')
      expect(error.errors).toEqual(errors)
      expect(error.message).toBe('Validation failed: Field is required, Invalid email')
    })
  })

  describe('executeResolveInput', () => {
    it('should return data unchanged when no hook is defined', async () => {
      const data = { name: 'John' }

      const result = await executeResolveInput(undefined, {
        listKey: 'User',
        operation: 'create',
        inputData: data,
        resolvedData: data,
        item: undefined,
        context: mockContext,
      })

      expect(result).toEqual(data)
    })

    it('should call resolveInput hook and return modified data', async () => {
      const data = { name: 'john' }
      const hooks: Hooks<Record<string, unknown>, { name: string }, { name: string }> = {
        resolveInput: vi.fn(async ({ resolvedData }) => ({
          ...resolvedData,
          name: resolvedData.name?.toUpperCase(),
        })),
      }

      const result = await executeResolveInput(hooks, {
        listKey: 'User',
        operation: 'create',
        inputData: data,
        resolvedData: data,
        item: undefined,
        context: mockContext,
      })

      expect(result).toEqual({ name: 'JOHN' })
      expect(hooks.resolveInput).toHaveBeenCalled()
    })

    it('should pass operation and context to hook', async () => {
      const hooks: Hooks = {
        resolveInput: vi.fn(async ({ resolvedData }) => resolvedData),
      }

      await executeResolveInput(hooks, {
        listKey: 'User',
        operation: 'update',
        inputData: { name: 'John' },
        resolvedData: { name: 'John' },
        item: { id: '1' },
        context: mockContext,
      })

      expect(hooks.resolveInput).toHaveBeenCalledWith({
        listKey: 'User',
        operation: 'update',
        inputData: { name: 'John' },
        resolvedData: { name: 'John' },
        item: { id: '1' },
        context: mockContext,
      })
    })

    it('should pass item to hook on update', async () => {
      const item = { id: '1', name: 'Original' }
      const hooks: Hooks = {
        resolveInput: vi.fn(async ({ resolvedData }) => resolvedData),
      }

      await executeResolveInput(hooks, {
        listKey: 'User',
        operation: 'update',
        inputData: { name: 'Updated' },
        resolvedData: { name: 'Updated' },
        item,
        context: mockContext,
      })

      expect(hooks.resolveInput).toHaveBeenCalledWith({
        listKey: 'User',
        operation: 'update',
        inputData: { name: 'Updated' },
        resolvedData: { name: 'Updated' },
        item,
        context: mockContext,
      })
    })
  })

  describe('executeValidateInput', () => {
    it('should not throw when no hook is defined', async () => {
      await expect(
        executeValidateInput(undefined, {
          listKey: 'User',
          operation: 'create',
          inputData: { name: 'John' },
          resolvedData: { name: 'John' },
          item: undefined,
          context: mockContext,
        }),
      ).resolves.not.toThrow()
    })

    it('should not throw when hook does not add errors', async () => {
      const hooks: Hooks = {
        validateInput: vi.fn(async () => {}),
      }

      await expect(
        executeValidateInput(hooks, {
          listKey: 'User',
          operation: 'create',
          inputData: { name: 'John' },
          resolvedData: { name: 'John' },
          item: undefined,
          context: mockContext,
        }),
      ).resolves.not.toThrow()
    })

    it('should throw ValidationError when hook adds errors', async () => {
      const hooks: Hooks = {
        validateInput: vi.fn(async ({ addValidationError }) => {
          addValidationError('Name is too short')
          addValidationError('Name contains invalid characters')
        }),
      }

      await expect(
        executeValidateInput(hooks, {
          listKey: 'User',
          operation: 'create',
          inputData: { name: 'J' },
          resolvedData: { name: 'J' },
          item: undefined,
          context: mockContext,
        }),
      ).rejects.toThrow(ValidationError)

      await expect(
        executeValidateInput(hooks, {
          listKey: 'User',
          operation: 'create',
          inputData: { name: 'J' },
          resolvedData: { name: 'J' },
          item: undefined,
          context: mockContext,
        }),
      ).rejects.toThrow('Name is too short')
    })

    it('should pass addValidationError function to hook', async () => {
      let addErrorFn: ((message: string) => void) | undefined

      const hooks: Hooks = {
        validateInput: vi.fn(async ({ addValidationError }) => {
          addErrorFn = addValidationError
        }),
      }

      await executeValidateInput(hooks, {
        listKey: 'User',
        operation: 'create',
        inputData: { name: 'John' },
        resolvedData: { name: 'John' },
        item: undefined,
        context: mockContext,
      })

      expect(typeof addErrorFn).toBe('function')
    })
  })

  describe('executeBeforeOperation', () => {
    it('should do nothing when no hook is defined', async () => {
      await expect(
        executeBeforeOperation(undefined, {
          listKey: 'User',
          operation: 'create',
          inputData: { name: 'John' },
          resolvedData: { name: 'John' },
          context: mockContext,
        }),
      ).resolves.not.toThrow()
    })

    it('should call beforeOperation hook', async () => {
      const hooks: Hooks = {
        beforeOperation: vi.fn(async () => {}),
      }

      await executeBeforeOperation(hooks, {
        listKey: 'User',
        operation: 'create',
        inputData: { name: 'John' },
        resolvedData: { name: 'John' },
        context: mockContext,
      })

      expect(hooks.beforeOperation).toHaveBeenCalledWith({
        listKey: 'User',
        operation: 'create',
        inputData: { name: 'John' },
        resolvedData: { name: 'John' },
        context: mockContext,
      })
    })

    it('should support all operations', async () => {
      const hooks: Hooks = {
        beforeOperation: vi.fn(async () => {}),
      }

      await executeBeforeOperation(hooks, {
        listKey: 'User',
        operation: 'create',
        inputData: { name: 'John' },
        resolvedData: { name: 'John' },
        context: mockContext,
      })

      await executeBeforeOperation(hooks, {
        listKey: 'User',
        operation: 'update',
        inputData: { name: 'John' },
        resolvedData: { name: 'John' },
        item: { id: '1' },
        context: mockContext,
      })

      await executeBeforeOperation(hooks, {
        listKey: 'User',
        operation: 'delete',
        item: { id: '1' },
        context: mockContext,
      })

      expect(hooks.beforeOperation).toHaveBeenCalledTimes(3)
    })
  })

  describe('executeAfterOperation', () => {
    it('should do nothing when no hook is defined', async () => {
      await expect(
        executeAfterOperation(undefined, {
          listKey: 'User',
          operation: 'create',
          inputData: { name: 'John' },
          resolvedData: { name: 'John' },
          item: { id: '1' },
          context: mockContext,
        }),
      ).resolves.not.toThrow()
    })

    it('should call afterOperation hook', async () => {
      const item = { id: '1', name: 'John' }
      const hooks: Hooks = {
        afterOperation: vi.fn(async () => {}),
      }

      await executeAfterOperation(hooks, {
        listKey: 'User',
        operation: 'create',
        inputData: { name: 'John' },
        resolvedData: { name: 'John' },
        item,
        context: mockContext,
      })

      expect(hooks.afterOperation).toHaveBeenCalledWith({
        listKey: 'User',
        operation: 'create',
        inputData: { name: 'John' },
        resolvedData: { name: 'John' },
        item,
        context: mockContext,
      })
    })

    it('should pass originalItem to afterOperation hook for update operation', async () => {
      const originalItem = { id: '1', name: 'John' }
      const updatedItem = { id: '1', name: 'Jane' }
      const hooks: Hooks = {
        afterOperation: vi.fn(async () => {}),
      }

      await executeAfterOperation(hooks, {
        listKey: 'User',
        operation: 'update',
        inputData: { name: 'Jane' },
        resolvedData: { name: 'Jane' },
        item: updatedItem,
        originalItem,
        context: mockContext,
      })

      expect(hooks.afterOperation).toHaveBeenCalledWith({
        listKey: 'User',
        operation: 'update',
        inputData: { name: 'Jane' },
        resolvedData: { name: 'Jane' },
        item: updatedItem,
        originalItem,
        context: mockContext,
      })
    })

    it('should pass originalItem to afterOperation hook for delete operation', async () => {
      const item = { id: '1', name: 'John' }
      const hooks: Hooks = {
        afterOperation: vi.fn(async () => {}),
      }

      await executeAfterOperation(hooks, {
        listKey: 'User',
        operation: 'delete',
        originalItem: item,
        context: mockContext,
      })

      expect(hooks.afterOperation).toHaveBeenCalledWith({
        listKey: 'User',
        operation: 'delete',
        originalItem: item,
        context: mockContext,
      })
    })

    it('should pass undefined originalItem for create operation', async () => {
      const item = { id: '1', name: 'John' }
      const hooks: Hooks = {
        afterOperation: vi.fn(async () => {}),
      }

      await executeAfterOperation(hooks, {
        listKey: 'User',
        operation: 'create',
        inputData: { name: 'John' },
        resolvedData: { name: 'John' },
        item,
        context: mockContext,
      })

      expect(hooks.afterOperation).toHaveBeenCalledWith({
        listKey: 'User',
        operation: 'create',
        inputData: { name: 'John' },
        resolvedData: { name: 'John' },
        item,
        originalItem: undefined,
        context: mockContext,
      })
    })
  })

  describe('validateFieldRules', () => {
    describe('required validation', () => {
      it('should add error when required field is missing on create', () => {
        const fieldConfigs = {
          name: text({ validation: { isRequired: true } }),
        }

        const result = validateFieldRules({}, fieldConfigs, 'create')

        expect(result.errors[0]).toContain('Name must be text')
      })

      it('should not add error when required field is present', () => {
        const fieldConfigs = {
          name: text({ validation: { isRequired: true } }),
        }

        const result = validateFieldRules({ name: 'John' }, fieldConfigs, 'create')

        expect(result.errors).toHaveLength(0)
      })

      it('should add error for empty string', () => {
        const fieldConfigs = {
          name: text({ validation: { isRequired: true } }),
        }

        const result = validateFieldRules({ name: '' }, fieldConfigs, 'create')

        expect(result.errors).toContain('Name is required')
      })

      it('should only validate updated fields on update', () => {
        const fieldConfigs = {
          name: text({ validation: { isRequired: true } }),
          email: text({ validation: { isRequired: true } }),
        }

        // Only updating name, not email
        const result = validateFieldRules({ name: 'John' }, fieldConfigs, 'update')

        expect(result.errors).toHaveLength(0)
      })

      it('should validate empty value on update if field is being updated', () => {
        const fieldConfigs = {
          name: text({ validation: { isRequired: true } }),
        }

        const result = validateFieldRules({ name: '' }, fieldConfigs, 'update')

        expect(result.errors).toContain('Name is required')
      })
    })

    describe('text length validation', () => {
      it('should add error when text is too short', () => {
        const fieldConfigs = {
          name: text({ validation: { length: { min: 3 } } }),
        }

        const result = validateFieldRules({ name: 'Jo' }, fieldConfigs)

        expect(result.errors).toContain('Name must be at least 3 characters')
      })

      it('should add error when text is too long', () => {
        const fieldConfigs = {
          name: text({ validation: { length: { max: 10 } } }),
        }

        const result = validateFieldRules({ name: 'This is a very long name' }, fieldConfigs)

        expect(result.errors).toContain('Name must be at most 10 characters')
      })

      it('should pass when text length is within range', () => {
        const fieldConfigs = {
          name: text({ validation: { length: { min: 3, max: 10 } } }),
        }

        const result = validateFieldRules({ name: 'John' }, fieldConfigs)

        expect(result.errors).toHaveLength(0)
      })
    })

    describe('integer validation', () => {
      it('should add error when integer is too small', () => {
        const fieldConfigs = {
          age: integer({ validation: { min: 18 } }),
        }

        const result = validateFieldRules({ age: 15 }, fieldConfigs)

        expect(result.errors).toContain('Age must be at least 18')
      })

      it('should add error when integer is too large', () => {
        const fieldConfigs = {
          age: integer({ validation: { max: 100 } }),
        }

        const result = validateFieldRules({ age: 150 }, fieldConfigs)

        expect(result.errors).toContain('Age must be at most 100')
      })

      it('should pass when integer is within range', () => {
        const fieldConfigs = {
          age: integer({ validation: { min: 18, max: 100 } }),
        }

        const result = validateFieldRules({ age: 25 }, fieldConfigs)

        expect(result.errors).toHaveLength(0)
      })
    })

    describe('skip validation', () => {
      it('should skip system fields', () => {
        const fieldConfigs = {
          id: text(),
          createdAt: text(),
          updatedAt: text(),
        }

        const result = validateFieldRules({}, fieldConfigs, 'create')

        expect(result.errors).toHaveLength(0)
      })

      it('should skip relationship fields', () => {
        const fieldConfigs = {
          author: relationship({ ref: 'User.posts' }),
        }

        const result = validateFieldRules({}, fieldConfigs, 'create')

        expect(result.errors).toHaveLength(0)
      })
    })

    describe('multiple errors', () => {
      it('should collect all validation errors', () => {
        const fieldConfigs = {
          name: text({
            validation: { isRequired: true, length: { min: 3 } },
          }),
          age: integer({ validation: { isRequired: true, min: 18 } }),
        }

        const result = validateFieldRules({ name: 'Jo', age: 15 }, fieldConfigs, 'create')

        expect(result.errors).toHaveLength(2)
        expect(result.errors).toContain('Name must be at least 3 characters')
        expect(result.errors).toContain('Age must be at least 18')
      })
    })
  })
})
