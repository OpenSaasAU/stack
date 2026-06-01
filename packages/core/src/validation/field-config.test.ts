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

    it('a relationship field is self-contained via getPrismaRelation', () => {
      const field = relationship({ ref: 'User.posts' })
      expect(validateFieldConfig(field as FieldConfig, 'author', 'Post')).toEqual([])
    })

    it('a virtual field is self-contained without getPrismaType', () => {
      const field = virtual({
        type: 'string',
        hooks: { resolveOutput: () => 'x' },
      })
      expect(validateFieldConfig(field as FieldConfig, 'fullName', 'User')).toEqual([])
    })
  })

  describe('missing scalar contract methods fail', () => {
    it('reports a missing getPrismaType naming the list, field, and method', () => {
      const field = text()
      delete field.getPrismaType

      const errors = validateFieldConfig(field as FieldConfig, 'title', 'Post')

      expect(errors).toHaveLength(1)
      expect(errors[0]).toMatchObject({
        listKey: 'Post',
        fieldKey: 'title',
        fieldType: 'text',
        missingMethod: 'getPrismaType',
      })
      expect(errors[0].message).toContain('Post.title')
      expect(errors[0].message).toContain('getPrismaType')
      expect(errors[0].message).toContain('not self-contained')
    })

    it('reports a missing getTypeScriptType naming the method', () => {
      const field = text()
      delete field.getTypeScriptType

      const errors = validateFieldConfig(field as FieldConfig, 'title', 'Post')

      expect(errors).toHaveLength(1)
      expect(errors[0].missingMethod).toBe('getTypeScriptType')
      expect(errors[0].message).toContain('getTypeScriptType')
    })

    it('reports a missing getZodSchema naming the method', () => {
      const field = text()
      delete field.getZodSchema

      const errors = validateFieldConfig(field as FieldConfig, 'title', 'Post')

      expect(errors).toHaveLength(1)
      expect(errors[0].missingMethod).toBe('getZodSchema')
      expect(errors[0].message).toContain('getZodSchema')
    })

    it('reports every missing method when a field implements none', () => {
      const field: FieldConfig = { type: 'custom' }

      const errors = validateFieldConfig(field, 'mystery', 'Widget')

      expect(errors.map((e) => e.missingMethod).sort()).toEqual([
        'getPrismaType',
        'getTypeScriptType',
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
      expect(errors).toHaveLength(3)
      expect(errors[0].listKey).toBeUndefined()
      expect(errors[0].message).toContain('Field "mystery"')
    })
  })

  describe('relationship and virtual variants', () => {
    it('reports a relationship missing getPrismaRelation', () => {
      const field: FieldConfig = { type: 'relationship' }

      const errors = validateFieldConfig(field, 'author', 'Post')

      expect(errors).toHaveLength(1)
      expect(errors[0].missingMethod).toBe('getPrismaRelation')
      expect(errors[0].message).toContain('Post.author')
    })

    it('reports a virtual field missing getTypeScriptType and getZodSchema', () => {
      const field: FieldConfig = { type: 'virtual', virtual: true }

      const errors = validateFieldConfig(field, 'fullName', 'User')

      expect(errors.map((e) => e.missingMethod).sort()).toEqual([
        'getTypeScriptType',
        'getZodSchema',
      ])
    })

    it('does not require getPrismaType for virtual fields', () => {
      const field: FieldConfig = { type: 'virtual', virtual: true }
      const errors = validateFieldConfig(field, 'fullName', 'User')
      expect(errors.some((e) => e.missingMethod === 'getPrismaType')).toBe(false)
    })
  })
})

describe('validateConfigFields', () => {
  it('returns no errors for a fully compliant config', () => {
    const config: OpenSaasConfig = {
      db: {
        provider: 'sqlite',
        prismaClientConstructor: () => null as never,
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
    delete brokenTitle.getPrismaType

    const brokenName = text()
    delete brokenName.getZodSchema

    const config: OpenSaasConfig = {
      db: {
        provider: 'sqlite',
        prismaClientConstructor: () => null as never,
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
    expect(byField['User.name'].missingMethod).toBe('getZodSchema')
    expect(byField['Post.title'].missingMethod).toBe('getPrismaType')
  })
})
