import { describe, test, expect } from 'vitest'
import { virtual } from './index.js'

// Mock Decimal class for testing
class Decimal {
  value: number

  constructor(value: number | string) {
    this.value = typeof value === 'string' ? parseFloat(value) : value
  }

  times(other: Decimal | number): Decimal {
    const otherValue = other instanceof Decimal ? other.value : other
    return new Decimal(this.value * otherValue)
  }

  plus(other: Decimal | number): Decimal {
    const otherValue = other instanceof Decimal ? other.value : other
    return new Decimal(this.value + otherValue)
  }

  toString(): string {
    return this.value.toString()
  }

  static get name() {
    return 'Decimal'
  }
}

// Mock custom class for testing
class CustomType {
  data: string

  constructor(data: string) {
    this.data = data
  }

  static get name() {
    return 'CustomType'
  }
}

describe('Virtual Fields with TypeDescriptor', () => {
  describe('primitive type strings', () => {
    test('accepts string type', () => {
      const field = virtual({
        type: 'string',
        hooks: {
          resolveOutput: ({ item }) => `${item.firstName} ${item.lastName}`,
        },
      })

      expect(field.type).toBe('virtual')
      expect(field.virtual).toBe(true)
      expect(field.outputType).toBe('string')
    })

    test('accepts number type', () => {
      const field = virtual({
        type: 'number',
        hooks: {
          resolveOutput: ({ item }) => item.count * 2,
        },
      })

      expect(field.outputType).toBe('number')
    })

    test('accepts boolean type', () => {
      const field = virtual({
        type: 'boolean',
        hooks: {
          resolveOutput: ({ item }) => item.isActive,
        },
      })

      expect(field.outputType).toBe('boolean')
    })

    test('accepts Date type', () => {
      const field = virtual({
        type: 'Date',
        hooks: {
          resolveOutput: ({ item }) => new Date(item.createdAt),
        },
      })

      expect(field.outputType).toBe('Date')
    })

    test('accepts array types', () => {
      const field = virtual({
        type: 'string[]',
        hooks: {
          resolveOutput: ({ item }) => item.tags.split(','),
        },
      })

      expect(field.outputType).toBe('string[]')
    })
  })

  describe('import string types', () => {
    test('accepts import string format', () => {
      const field = virtual({
        type: "import('decimal.js').Decimal",
        hooks: {
          resolveOutput: ({ item }) => new Decimal(item.price),
        },
      })

      expect(field.outputType).toBe("import('decimal.js').Decimal")
    })

    test('handles complex import paths', () => {
      const field = virtual({
        type: "import('@myorg/custom-types').MyCustomType",
        hooks: {
          resolveOutput: ({ item }) => item.customData,
        },
      })

      expect(field.outputType).toBe("import('@myorg/custom-types').MyCustomType")
    })
  })

  describe('type descriptor objects', () => {
    test('accepts type descriptor with class constructor', () => {
      const field = virtual({
        type: { value: Decimal, from: 'decimal.js' },
        hooks: {
          resolveOutput: ({ item }) => new Decimal(item.price).times(item.quantity),
        },
      })

      expect(field.outputType).toBe("import('decimal.js').Decimal")
    })

    test('uses custom name when provided', () => {
      const field = virtual({
        type: { value: Decimal, from: 'decimal.js', name: 'CustomDecimal' },
        hooks: {
          resolveOutput: ({ item }) => new Decimal(item.value),
        },
      })

      expect(field.outputType).toBe("import('decimal.js').CustomDecimal")
    })

    test('works with custom classes', () => {
      const field = virtual({
        type: { value: CustomType, from: './types' },
        hooks: {
          resolveOutput: ({ item }) => new CustomType(item.data),
        },
      })

      expect(field.outputType).toBe("import('./types').CustomType")
    })
  })

  describe('validation', () => {
    test('throws error when resolveOutput hook is missing', () => {
      expect(() => {
        virtual({
          type: 'string',
          hooks: {},
        })
      }).toThrow('Virtual fields must provide a resolveOutput hook')
    })

    test('throws error when hooks are completely missing', () => {
      expect(() => {
        virtual({
          type: 'string',
        })
      }).toThrow('Virtual fields must provide a resolveOutput hook')
    })
  })

  describe('getContractField', () => {
    test('contributes nothing storable — no column is emitted for it', () => {
      const field = virtual({
        type: 'string',
        hooks: {
          resolveOutput: ({ item }) => item.computed,
        },
      })

      expect(
        field.getContractField!('computed', 'Post', { db: { provider: 'postgresql' }, lists: {} }),
      ).toEqual({
        kind: 'computed',
      })
    })
  })

  describe('getZodSchema', () => {
    test('returns z.never() to prevent input validation', () => {
      const field = virtual({
        type: 'string',
        hooks: {
          resolveOutput: ({ item }) => item.computed,
        },
      })

      const schema = field.getZodSchema!('computed', 'create')
      expect(() => schema.parse('anything')).toThrow()
    })
  })

  describe('real-world use cases', () => {
    test('Decimal type for financial calculations', () => {
      const field = virtual({
        type: { value: Decimal, from: 'decimal.js' },
        hooks: {
          resolveOutput: ({ item }) => {
            // Calculate total from price and quantity with decimal precision
            return new Decimal(item.price).times(item.quantity)
          },
        },
      })

      expect(field.type).toBe('virtual')
      expect(field.outputType).toBe("import('decimal.js').Decimal")
    })

    test('Complex computed field with multiple operations', () => {
      const field = virtual({
        type: { value: Decimal, from: 'decimal.js' },
        hooks: {
          resolveOutput: ({ item }) => {
            // Calculate tax amount
            const subtotal = new Decimal(item.subtotal)
            const taxRate = new Decimal(item.taxRate)
            return subtotal.times(taxRate)
          },
        },
      })

      expect(field.outputType).toBe("import('decimal.js').Decimal")
    })

    test('Full name concatenation (primitive type)', () => {
      const field = virtual({
        type: 'string',
        hooks: {
          resolveOutput: ({ item }) => `${item.firstName} ${item.lastName}`,
        },
      })

      expect(field.outputType).toBe('string')
    })

    test('Array transformation', () => {
      const field = virtual({
        type: 'string[]',
        hooks: {
          resolveOutput: ({ item }) => {
            // Split comma-separated tags into array
            return item.tags ? item.tags.split(',').map((t: string) => t.trim()) : []
          },
        },
      })

      expect(field.outputType).toBe('string[]')
    })
  })

  describe('backwards compatibility', () => {
    test('existing primitive type strings still work', () => {
      const field = virtual({
        type: 'string',
        hooks: {
          resolveOutput: ({ item }) => item.value,
        },
      })

      expect(field.type).toBe('virtual')
      expect(field.outputType).toBe('string')
    })

    test('existing field configuration is preserved', () => {
      const field = virtual({
        type: 'number',
        hooks: {
          resolveOutput: ({ item }) => item.count,
          resolveInput: async ({ resolvedData, fieldKey }) => resolvedData[fieldKey],
        },
        access: {
          read: () => true,
        },
        ui: {
          displayMode: 'readonly',
        },
      })

      expect(field.hooks?.resolveOutput).toBeDefined()
      expect(field.hooks?.resolveInput).toBeDefined()
      expect(field.access).toBeDefined()
      expect(field.ui).toBeDefined()
    })
  })
})
