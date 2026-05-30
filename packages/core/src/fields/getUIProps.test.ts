import { describe, it, expect } from 'vitest'
import {
  text,
  integer,
  checkbox,
  timestamp,
  password,
  select,
  relationship,
  json,
  virtual,
  decimal,
  calendarDay,
} from './index.js'

describe('getUIProps field builder method', () => {
  describe('text field', () => {
    it('returns empty object', () => {
      const field = text()
      expect(field.getUIProps!({})).toEqual({})
    })
  })

  describe('integer field', () => {
    it('returns empty object', () => {
      const field = integer()
      expect(field.getUIProps!({})).toEqual({})
    })
  })

  describe('decimal field', () => {
    it('returns empty object', () => {
      const field = decimal()
      expect(field.getUIProps!({})).toEqual({})
    })
  })

  describe('checkbox field', () => {
    it('returns empty object', () => {
      const field = checkbox()
      expect(field.getUIProps!({})).toEqual({})
    })
  })

  describe('timestamp field', () => {
    it('returns empty object', () => {
      const field = timestamp()
      expect(field.getUIProps!({})).toEqual({})
    })
  })

  describe('calendarDay field', () => {
    it('returns empty object', () => {
      const field = calendarDay()
      expect(field.getUIProps!({})).toEqual({})
    })
  })

  describe('json field', () => {
    it('returns empty object', () => {
      const field = json()
      expect(field.getUIProps!({})).toEqual({})
    })
  })

  describe('virtual field', () => {
    it('returns empty object', () => {
      const field = virtual({
        type: 'string',
        hooks: { resolveOutput: () => 'value' },
      })
      expect(field.getUIProps!({})).toEqual({})
    })
  })

  describe('password field', () => {
    it('returns showConfirm: true when mode is edit', () => {
      const field = password()
      expect(field.getUIProps!({ mode: 'edit' })).toEqual({ showConfirm: true })
    })

    it('returns showConfirm: false when mode is read', () => {
      const field = password()
      expect(field.getUIProps!({ mode: 'read' })).toEqual({ showConfirm: false })
    })

    it('returns showConfirm: false when mode is not provided', () => {
      const field = password()
      expect(field.getUIProps!({})).toEqual({ showConfirm: false })
    })
  })

  describe('select field', () => {
    it('returns mapped options', () => {
      const field = select({
        options: [
          { label: 'Draft', value: 'draft' },
          { label: 'Published', value: 'published' },
        ],
      })
      expect(field.getUIProps!({})).toEqual({
        options: [
          { label: 'Draft', value: 'draft' },
          { label: 'Published', value: 'published' },
        ],
      })
    })

    it('normalises string options to label/value objects', () => {
      // Even though the type system enforces objects, test the normalization path
      const field = select({
        options: [
          { label: 'Active', value: 'active' },
          { label: 'Inactive', value: 'inactive' },
        ],
      })
      const result = field.getUIProps!({})
      expect((result.options as Array<{ label: string; value: string }>)[0]).toEqual({
        label: 'Active',
        value: 'active',
      })
    })
  })

  describe('relationship field', () => {
    it('returns many: false and relatedListKey from simple ref', () => {
      const field = relationship({ ref: 'User' })
      const result = field.getUIProps!({})
      expect(result.many).toBe(false)
      expect(result.relatedListKey).toBe('user')
    })

    it('returns many: true for many relationship', () => {
      const field = relationship({ ref: 'Tag', many: true })
      const result = field.getUIProps!({})
      expect(result.many).toBe(true)
    })

    it('extracts relatedListKey from bidirectional ref', () => {
      const field = relationship({ ref: 'User.posts' })
      const result = field.getUIProps!({})
      expect(result.relatedListKey).toBe('user')
    })

    it('returns relatedListKey in kebab-case for multi-word list', () => {
      const field = relationship({ ref: 'BlogPost.comments' })
      const result = field.getUIProps!({})
      expect(result.relatedListKey).toBe('blog-post')
    })

    it('passes through relationshipItems as items', () => {
      const field = relationship({ ref: 'User' })
      const items = [{ id: '1', label: 'Alice' }]
      const result = field.getUIProps!({ relationshipItems: items })
      expect(result.items).toEqual(items)
    })

    it('passes through relationshipLoading as isLoading', () => {
      const field = relationship({ ref: 'User' })
      const result = field.getUIProps!({ relationshipLoading: true })
      expect(result.isLoading).toBe(true)
    })

    it('passes through basePath', () => {
      const field = relationship({ ref: 'User' })
      const result = field.getUIProps!({ basePath: '/admin' })
      expect(result.basePath).toBe('/admin')
    })

    it('returns undefined items when not provided', () => {
      const field = relationship({ ref: 'User' })
      const result = field.getUIProps!({})
      expect(result.items).toBeUndefined()
    })
  })
})
