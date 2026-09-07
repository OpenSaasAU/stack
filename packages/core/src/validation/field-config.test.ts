import { describe, it, expect } from 'vitest'
import { validateFieldConfig, validateConfigFields } from './field-config.js'
import {
  text,
  integer,
  checkbox,
  timestamp,
  password,
  select,
  json,
  relationship,
  virtual,
} from '../fields/index.js'
import type { FieldConfig, OpenSaasConfig } from '../config/types.js'

describe('validateFieldConfig', () => {
  describe('well-formed fields pass', () => {
    it.each([
      ['text', text()],
      ['integer', integer()],
      ['checkbox', checkbox()],
      ['timestamp', timestamp()],
      ['password', password()],
      ['select', select({ options: [{ label: 'A', value: 'a' }] })],
      ['json', json()],
    ])('a built-in %s field is self-contained', (_name, field) => {
      expect(validateFieldConfig(field as FieldConfig, 'myField', 'MyList')).toEqual([])
    })

    it('a relationship field is self-contained via getContractField alone', () => {
      const field = relationship({ ref: 'User.posts' })
      expect(validateFieldConfig(field as FieldConfig, 'author', 'Post')).toEqual([])
    })

    it('a virtual field is self-contained without a column', () => {
      const field = virtual({
        type: 'string',
        hooks: { resolveOutput: () => 'x' },
      })
      expect(validateFieldConfig(field as FieldConfig, 'fullName', 'User')).toEqual([])
    })
  })

  describe('missing stored-field contract members fail', () => {
    it('reports a missing getContractField naming the list, field, and member', () => {
      const field = text()
      delete field.getContractField

      const errors = validateFieldConfig(field as FieldConfig, 'title', 'Post')

      expect(errors).toHaveLength(1)
      expect(errors[0]).toMatchObject({
        listKey: 'Post',
        fieldKey: 'title',
        fieldType: 'text',
        missingMember: 'getContractField',
      })
      expect(errors[0].message).toContain('Post.title')
      expect(errors[0].message).toContain('getContractField()')
      expect(errors[0].message).toContain('not self-contained')
    })

    it('reports a missing getZodSchema naming the member', () => {
      const field = text()
      delete field.getZodSchema

      const errors = validateFieldConfig(field as FieldConfig, 'title', 'Post')

      expect(errors).toHaveLength(1)
      expect(errors[0].missingMember).toBe('getZodSchema')
      expect(errors[0].message).toContain('getZodSchema')
    })

    it('reports every missing member when a field declares none', () => {
      const field: FieldConfig = { type: 'custom' }

      const errors = validateFieldConfig(field, 'mystery', 'Widget')

      expect(errors.map((e) => e.missingMember).sort()).toEqual([
        'getContractField',
        'getZodSchema',
      ])
      for (const error of errors) {
        expect(error.message).toContain('Widget.mystery')
        expect(error.message).toContain('custom')
      }
    })

    it('works without a listKey (bare field validation)', () => {
      const field: FieldConfig = { type: 'custom' }
      const errors = validateFieldConfig(field, 'mystery')
      expect(errors).toHaveLength(2)
      expect(errors[0].listKey).toBeUndefined()
      expect(errors[0].message).toContain('Field "mystery"')
    })
  })

  describe('relationship and virtual variants', () => {
    it('reports a relationship missing getContractField', () => {
      const field: FieldConfig = { type: 'relationship' }

      const errors = validateFieldConfig(field, 'author', 'Post')

      expect(errors).toHaveLength(1)
      expect(errors[0].missingMember).toBe('getContractField')
      expect(errors[0].message).toContain('Post.author')
    })

    it('reports a virtual field missing outputType and getZodSchema', () => {
      const field: FieldConfig = { type: 'virtual', virtual: true }

      const errors = validateFieldConfig(field, 'fullName', 'User')

      expect(errors.map((e) => e.missingMember).sort()).toEqual(['getZodSchema', 'outputType'])
    })

    it('does not require getContractField for virtual fields', () => {
      const field: FieldConfig = { type: 'virtual', virtual: true }
      const errors = validateFieldConfig(field, 'fullName', 'User')
      expect(errors.some((e) => e.missingMember === 'getContractField')).toBe(false)
    })

    /**
     * A virtual field with no `outputType` has no column for the contract to
     * type it from, so the remainder's `computed` entry would be missing and
     * every consumer would see the field as `unknown` (#1292). The gate names
     * it instead.
     */
    it('names outputType, not the type it would have been inferred from', () => {
      const field: FieldConfig = {
        type: 'virtual',
        virtual: true,
        getZodSchema: () => json().getZodSchema!('x', 'create'),
      }

      const errors = validateFieldConfig(field, 'fullName', 'User')

      expect(errors).toHaveLength(1)
      expect(errors[0].missingMember).toBe('outputType')
      expect(errors[0].message).toContain('outputType.')
      expect(errors[0].message).not.toContain('outputType()')
    })
  })

  describe('contract-era fields', () => {
    /** Two columns of different types, which no single column type describes. */
    const twoColumns: FieldConfig = {
      type: 'embedding',
      outputType: "import('@opensaas/stack-rag').StoredEmbedding | null",
      getZodSchema: () => json().getZodSchema!('embedding', 'create'),
      getColumnNames: () => ['embedding', 'embeddingMetadata'],
      getContractField: () => ({
        kind: 'columns',
        columns: [
          {
            name: 'embedding',
            type: { pack: 'pgvector', type: 'Vector', args: [3] },
            nullable: true,
          },
          { name: 'embeddingMetadata', type: { pack: 'pg', type: 'jsonb' }, nullable: true },
        ],
      }),
    }

    it('accepts a multi-column field that declares its own TypeScript face', () => {
      expect(validateFieldConfig(twoColumns, 'embedding', 'Article')).toEqual([])
    })

    it('still requires getZodSchema, which no contract supplies', () => {
      const field: FieldConfig = { ...twoColumns }
      delete field.getZodSchema

      const errors = validateFieldConfig(field, 'embedding', 'Article')

      expect(errors.map((e) => e.missingMember)).toEqual(['getZodSchema'])
    })

    /**
     * A field spanning several columns has no single column to be typed from,
     * so an absent `outputType` leaves it `unknown` everywhere (#1292).
     */
    it('requires outputType from a multi-column field', () => {
      const field: FieldConfig = { ...twoColumns }
      delete field.outputType

      expect(
        validateFieldConfig(field, 'embedding', 'Article').map((e) => e.missingMember),
      ).toEqual(['outputType'])
    })

    it('does not require outputType from a single-column field, whose codec types it', () => {
      expect(text().outputType).toBeUndefined()
      expect(validateFieldConfig(text() as FieldConfig, 'title', 'Post')).toEqual([])
    })
  })
})

describe('validateConfigFields', () => {
  it('returns no errors for a fully compliant config', () => {
    const config: OpenSaasConfig = {
      db: {
        provider: 'postgresql',
      },
      lists: {
        User: {
          fields: {
            name: text({ validation: { isRequired: true } }),
            posts: relationship({ ref: 'Post.author', many: true }),
          },
        },
        Post: {
          fields: {
            title: text(),
            author: relationship({ ref: 'User.posts' }),
          },
        },
      },
    }

    expect(validateConfigFields(config)).toEqual([])
  })

  it('collects per-field errors across every list and names each location', () => {
    const brokenTitle = text()
    delete brokenTitle.getContractField

    const brokenName = text()
    delete brokenName.getZodSchema

    const config: OpenSaasConfig = {
      db: {
        provider: 'postgresql',
      },
      lists: {
        User: {
          fields: {
            name: brokenName,
          },
        },
        Post: {
          fields: {
            title: brokenTitle,
          },
        },
      },
    }

    const errors = validateConfigFields(config)

    expect(errors).toHaveLength(2)
    const byField = Object.fromEntries(errors.map((e) => [`${e.listKey}.${e.fieldKey}`, e]))
    expect(byField['User.name'].missingMember).toBe('getZodSchema')
    expect(byField['Post.title'].missingMember).toBe('getContractField')
  })
})
