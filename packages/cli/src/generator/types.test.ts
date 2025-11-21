import { describe, it, expect } from 'vitest'
import { generateTypes } from './types.js'
import type { OpenSaasConfig } from '@opensaas/stack-core'
import { text, integer, relationship, checkbox } from '@opensaas/stack-core/fields'

describe('Types Generator', () => {
  describe('generateTypes', () => {
    it('should generate type definitions for basic model', () => {
      const config: OpenSaasConfig = {
        db: {
          provider: 'sqlite',
        },
        lists: {
          User: {
            fields: {
              name: text({ validation: { isRequired: true } }),
              email: text({ validation: { isRequired: true } }),
            },
          },
        },
      }

      const types = generateTypes(config)

      expect(types).toMatchSnapshot()
    })

    it('should generate CreateInput type', () => {
      const config: OpenSaasConfig = {
        db: {
          provider: 'sqlite',
        },
        lists: {
          Post: {
            fields: {
              title: text({ validation: { isRequired: true } }),
              content: text(),
            },
          },
        },
      }

      const types = generateTypes(config)

      expect(types).toMatchSnapshot()
    })

    it('should generate UpdateInput type', () => {
      const config: OpenSaasConfig = {
        db: {
          provider: 'sqlite',
        },
        lists: {
          Post: {
            fields: {
              title: text({ validation: { isRequired: true } }),
              content: text(),
            },
          },
        },
      }

      const types = generateTypes(config)

      expect(types).toMatchSnapshot()
    })

    it('should generate WhereInput type', () => {
      const config: OpenSaasConfig = {
        db: {
          provider: 'sqlite',
        },
        lists: {
          User: {
            fields: {
              name: text(),
            },
          },
        },
      }

      const types = generateTypes(config)

      expect(types).toMatchSnapshot()
    })

    it('should generate Context type with all operations', () => {
      const config: OpenSaasConfig = {
        db: {
          provider: 'sqlite',
        },
        lists: {
          User: {
            fields: {
              name: text(),
            },
          },
        },
      }

      const types = generateTypes(config)

      expect(types).toMatchSnapshot()
    })

    it('should handle relationship fields in types', () => {
      const config: OpenSaasConfig = {
        db: {
          provider: 'sqlite',
        },
        lists: {
          User: {
            fields: {
              name: text(),
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

      const types = generateTypes(config)

      expect(types).toMatchSnapshot()
    })

    it('should handle relationship fields in CreateInput', () => {
      const config: OpenSaasConfig = {
        db: {
          provider: 'sqlite',
        },
        lists: {
          Post: {
            fields: {
              title: text(),
              author: relationship({ ref: 'User.posts' }),
            },
          },
          User: {
            fields: {
              name: text(),
            },
          },
        },
      }

      const types = generateTypes(config)

      expect(types).toMatchSnapshot()
    })

    it('should handle relationship fields in UpdateInput', () => {
      const config: OpenSaasConfig = {
        db: {
          provider: 'sqlite',
        },
        lists: {
          Post: {
            fields: {
              title: text(),
              author: relationship({ ref: 'User.posts' }),
            },
          },
          User: {
            fields: {
              name: text(),
            },
          },
        },
      }

      const types = generateTypes(config)

      expect(types).toMatchSnapshot()
    })

    it('should generate types for multiple lists', () => {
      const config: OpenSaasConfig = {
        db: {
          provider: 'sqlite',
        },
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
          Comment: {
            fields: {
              content: text(),
            },
          },
        },
      }

      const types = generateTypes(config)

      expect(types).toMatchSnapshot()
    })

    it('should handle integer fields correctly', () => {
      const config: OpenSaasConfig = {
        db: {
          provider: 'sqlite',
        },
        lists: {
          Product: {
            fields: {
              name: text(),
              price: integer(),
            },
          },
        },
      }

      const types = generateTypes(config)

      expect(types).toContain('price:')
      expect(types).toContain('number')
    })

    it('should handle checkbox fields correctly', () => {
      const config: OpenSaasConfig = {
        db: {
          provider: 'sqlite',
        },
        lists: {
          Post: {
            fields: {
              title: text(),
              isPublished: checkbox(),
            },
          },
        },
      }

      const types = generateTypes(config)

      expect(types).toContain('isPublished:')
      expect(types).toContain('boolean')
    })

    it('should include header comment', () => {
      const config: OpenSaasConfig = {
        db: {
          provider: 'sqlite',
        },
        lists: {},
      }

      const types = generateTypes(config)

      expect(types).toContain('/**')
      expect(types).toContain('Generated types from OpenSaas configuration')
      expect(types).toContain('DO NOT EDIT')
    })
  })
})
