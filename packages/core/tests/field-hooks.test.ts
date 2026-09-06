import { describe, it, expect, vi } from 'vitest'
import {
  ValidationError,
  executeFieldResolveInputHooks,
  executeFieldValidateHooks,
  executeFieldBeforeOperationHooks,
  executeFieldAfterOperationHooks,
} from '../src/hooks/index.js'
import { text } from '../src/fields/index.js'
import type { AccessContext } from '../src/access/types.js'

const mockContext = {
  session: null,
  ormHandle: {},
  db: {},
} as unknown as AccessContext

describe('Field-level hook helpers', () => {
  describe('executeFieldResolveInputHooks', () => {
    it('should return data unchanged when no field hook is defined', async () => {
      const fields = { name: text() }
      const resolvedData = { name: 'john' }

      const result = await executeFieldResolveInputHooks(
        { name: 'john' },
        resolvedData,
        fields,
        'create',
        mockContext,
        'User',
      )

      expect(result).toEqual({ name: 'john' })
      // Should not mutate the passed reference
      expect(result).not.toBe(resolvedData)
    })

    it('should transform field values via the field resolveInput hook', async () => {
      const fields = {
        name: text({
          hooks: {
            resolveInput: ({ resolvedData, fieldKey }) =>
              (resolvedData[fieldKey] as string).toUpperCase(),
          },
        }),
      }

      const result = await executeFieldResolveInputHooks(
        { name: 'john' },
        { name: 'john' },
        fields,
        'create',
        mockContext,
        'User',
      )

      expect(result).toEqual({ name: 'JOHN' })
    })

    it('should pass the correct arguments to the field hook', async () => {
      const resolveInput = vi.fn(({ resolvedData, fieldKey }) => resolvedData[fieldKey])
      const fields = { name: text({ hooks: { resolveInput } }) }
      const item = { id: '1', name: 'old' }

      await executeFieldResolveInputHooks(
        { name: 'john' },
        { name: 'john' },
        fields,
        'update',
        mockContext,
        'User',
        item,
      )

      expect(resolveInput).toHaveBeenCalledTimes(1)
      expect(resolveInput).toHaveBeenCalledWith(
        expect.objectContaining({
          listKey: 'User',
          fieldKey: 'name',
          operation: 'update',
          inputData: { name: 'john' },
          item,
          resolvedData: { name: 'john' },
          context: mockContext,
        }),
      )
    })

    it('should skip fields that are not present in the data', async () => {
      const resolveInput = vi.fn(({ resolvedData, fieldKey }) => resolvedData[fieldKey])
      const fields = { name: text({ hooks: { resolveInput } }) }

      const result = await executeFieldResolveInputHooks(
        { other: 'value' },
        { other: 'value' },
        fields,
        'create',
        mockContext,
        'User',
      )

      expect(resolveInput).not.toHaveBeenCalled()
      expect(result).toEqual({ other: 'value' })
    })
  })

  describe('executeFieldValidateHooks', () => {
    it('should not throw when no field hook is defined', async () => {
      const fields = { name: text() }

      await expect(
        executeFieldValidateHooks(
          { name: 'john' },
          { name: 'john' },
          fields,
          'create',
          mockContext,
          'User',
        ),
      ).resolves.toBeUndefined()
    })

    it('should accumulate errors from multiple fields and throw a ValidationError', async () => {
      const fields = {
        name: text({
          hooks: {
            validate: ({ addValidationError }) => {
              addValidationError('name is invalid')
            },
          },
        }),
        email: text({
          hooks: {
            validate: ({ addValidationError }) => {
              addValidationError('email is invalid')
            },
          },
        }),
      }

      let caught: unknown
      try {
        await executeFieldValidateHooks(
          { name: 'x', email: 'y' },
          { name: 'x', email: 'y' },
          fields,
          'create',
          mockContext,
          'User',
        )
      } catch (error) {
        caught = error
      }

      expect(caught).toBeInstanceOf(ValidationError)
      const validationError = caught as ValidationError
      expect(validationError.errors).toEqual(['name is invalid', 'email is invalid'])
      expect(validationError.fieldErrors).toEqual({
        name: 'name is invalid',
        email: 'email is invalid',
      })
    })

    it('should not throw when no validation errors are added', async () => {
      const validate = vi.fn()
      const fields = { name: text({ hooks: { validate } }) }

      await expect(
        executeFieldValidateHooks(
          { name: 'john' },
          { name: 'john' },
          fields,
          'create',
          mockContext,
          'User',
        ),
      ).resolves.toBeUndefined()
      expect(validate).toHaveBeenCalledTimes(1)
    })

    it('should pass delete-shaped arguments for delete operations', async () => {
      const validate = vi.fn()
      const fields = { name: text({ hooks: { validate } }) }
      const item = { id: '1', name: 'john' }

      await executeFieldValidateHooks(
        undefined,
        undefined,
        fields,
        'delete',
        mockContext,
        'User',
        item,
      )

      expect(validate).toHaveBeenCalledWith(
        expect.objectContaining({
          listKey: 'User',
          fieldKey: 'name',
          operation: 'delete',
          item,
          context: mockContext,
        }),
      )
    })

    it('should support the deprecated validateInput hook', async () => {
      const fields = {
        name: text({
          hooks: {
            validateInput: ({ addValidationError }) => {
              addValidationError('legacy error')
            },
          },
        }),
      }

      await expect(
        executeFieldValidateHooks(
          { name: 'x' },
          { name: 'x' },
          fields,
          'create',
          mockContext,
          'User',
        ),
      ).rejects.toBeInstanceOf(ValidationError)
    })
  })

  describe('executeFieldBeforeOperationHooks', () => {
    it('should do nothing when no field hook is defined', async () => {
      const fields = { name: text() }

      await expect(
        executeFieldBeforeOperationHooks(
          { name: 'john' },
          { name: 'john' },
          fields,
          'create',
          mockContext,
          'User',
        ),
      ).resolves.toBeUndefined()
    })

    it('should call the hook with create-shaped arguments', async () => {
      const beforeOperation = vi.fn()
      const fields = { name: text({ hooks: { beforeOperation } }) }

      await executeFieldBeforeOperationHooks(
        { name: 'john' },
        { name: 'john' },
        fields,
        'create',
        mockContext,
        'User',
      )

      expect(beforeOperation).toHaveBeenCalledWith(
        expect.objectContaining({
          listKey: 'User',
          fieldKey: 'name',
          operation: 'create',
          inputData: { name: 'john' },
          resolvedData: { name: 'john' },
          context: mockContext,
        }),
      )
    })

    it('should skip fields not present in resolvedData for create/update', async () => {
      const beforeOperation = vi.fn()
      const fields = { name: text({ hooks: { beforeOperation } }) }

      await executeFieldBeforeOperationHooks(
        { other: 'value' },
        { other: 'value' },
        fields,
        'update',
        mockContext,
        'User',
      )

      expect(beforeOperation).not.toHaveBeenCalled()
    })

    it('should run the hook for delete even when the field is not in resolvedData', async () => {
      const beforeOperation = vi.fn()
      const fields = { name: text({ hooks: { beforeOperation } }) }
      const item = { id: '1', name: 'john' }

      await executeFieldBeforeOperationHooks({}, {}, fields, 'delete', mockContext, 'User', item)

      expect(beforeOperation).toHaveBeenCalledWith(
        expect.objectContaining({
          listKey: 'User',
          fieldKey: 'name',
          operation: 'delete',
          item,
          context: mockContext,
        }),
      )
    })
  })

  describe('executeFieldAfterOperationHooks', () => {
    it('should do nothing when no field hook is defined', async () => {
      const fields = { name: text() }

      await expect(
        executeFieldAfterOperationHooks(
          { id: '1', name: 'john' },
          { name: 'john' },
          { name: 'john' },
          fields,
          'create',
          mockContext,
          'User',
        ),
      ).resolves.toBeUndefined()
    })

    it('should call the hook with create-shaped arguments', async () => {
      const afterOperation = vi.fn()
      const fields = { name: text({ hooks: { afterOperation } }) }
      const item = { id: '1', name: 'john' }

      await executeFieldAfterOperationHooks(
        item,
        { name: 'john' },
        { name: 'john' },
        fields,
        'create',
        mockContext,
        'User',
      )

      expect(afterOperation).toHaveBeenCalledWith(
        expect.objectContaining({
          listKey: 'User',
          fieldKey: 'name',
          operation: 'create',
          inputData: { name: 'john' },
          item,
          resolvedData: { name: 'john' },
          context: mockContext,
        }),
      )
    })

    it('should pass originalItem for update operations', async () => {
      const afterOperation = vi.fn()
      const fields = { name: text({ hooks: { afterOperation } }) }
      const updated = { id: '1', name: 'new' }
      const originalItem = { id: '1', name: 'old' }

      await executeFieldAfterOperationHooks(
        updated,
        { name: 'new' },
        { name: 'new' },
        fields,
        'update',
        mockContext,
        'User',
        originalItem,
      )

      expect(afterOperation).toHaveBeenCalledWith(
        expect.objectContaining({
          listKey: 'User',
          fieldKey: 'name',
          operation: 'update',
          inputData: { name: 'new' },
          originalItem,
          item: updated,
          resolvedData: { name: 'new' },
          context: mockContext,
        }),
      )
    })

    it('should pass delete-shaped arguments for delete operations', async () => {
      const afterOperation = vi.fn()
      const fields = { name: text({ hooks: { afterOperation } }) }
      const originalItem = { id: '1', name: 'john' }

      await executeFieldAfterOperationHooks(
        originalItem,
        undefined,
        undefined,
        fields,
        'delete',
        mockContext,
        'User',
        originalItem,
      )

      expect(afterOperation).toHaveBeenCalledWith(
        expect.objectContaining({
          listKey: 'User',
          fieldKey: 'name',
          operation: 'delete',
          originalItem,
          context: mockContext,
        }),
      )
    })
  })
})
