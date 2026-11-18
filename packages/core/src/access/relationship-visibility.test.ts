import { describe, it, expect } from 'vitest'
import { getRelatedListConfig } from './index.js'
import { text } from '../fields/index.js'
import type { OpenSaasConfig } from '../index.js'

describe('Relationship Access Control', () => {
  describe('getRelatedListConfig', () => {
    const config: OpenSaasConfig = {
      db: { provider: 'postgresql' },
      lists: {
        User: {
          fields: {
            name: text(),
          },
        },
        Post: {
          fields: {
            title: text(),
          },
        },
      },
    }

    it('should parse relationship ref and return list config', () => {
      const result = getRelatedListConfig('Post.author', config)

      expect(result).toBeDefined()
      expect(result?.listName).toBe('Post')
      expect(result?.listConfig).toBeDefined()
      expect(result?.listConfig.fields.title).toBeDefined()
    })

    it('should return null for invalid ref format', () => {
      const result = getRelatedListConfig('InvalidRef', config)

      expect(result).toBeNull()
    })

    it('should return null for non-existent list', () => {
      const result = getRelatedListConfig('NonExistent.field', config)

      expect(result).toBeNull()
    })

    it('should return null for a ref with more than one dot', () => {
      const result = getRelatedListConfig('Post.author.extra', config)

      expect(result).toBeNull()
    })
  })
})
