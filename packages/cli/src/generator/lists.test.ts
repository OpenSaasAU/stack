import { describe, it, expect } from 'vitest'
import { generateListsNamespace } from './lists.js'
import type { OpenSaasConfig } from '@opensaas/stack-core'
import { text, integer, relationship, checkbox } from '@opensaas/stack-core/fields'

describe('Lists Namespace Generator', () => {
  describe('generateListsNamespace', () => {
    it('should generate Lists namespace for single list', () => {
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

      const lists = generateListsNamespace(config)

      expect(lists).toContain('export declare namespace Lists {')
      expect(lists).toContain('export type Post')
      expect(lists).toContain('namespace Post {')
      expect(lists).toContain("export type Item = import('./types').Post")
      expect(lists).toContain('export type TypeInfo')
      expect(lists).toContain("key: 'Post'")
      expect(lists).toContain('item: Item')
      expect(lists).toContain('inputs: {')
      expect(lists).toContain("create: import('./prisma-client/client').Prisma.PostCreateInput")
      expect(lists).toContain("update: import('./prisma-client/client').Prisma.PostUpdateInput")
    })

    it('should generate Lists namespace for multiple lists', () => {
      const config: OpenSaasConfig = {
        db: {
          provider: 'sqlite',
        },
        lists: {
          User: {
            fields: {
              name: text(),
              email: text(),
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

      const lists = generateListsNamespace(config)

      // Check all three lists are present
      expect(lists).toContain('export type User')
      expect(lists).toContain('export type Post')
      expect(lists).toContain('export type Comment')

      // Check all three namespaces
      expect(lists).toContain('namespace User {')
      expect(lists).toContain('namespace Post {')
      expect(lists).toContain('namespace Comment {')

      // Check TypeInfo for each
      expect(lists).toContain("key: 'User'")
      expect(lists).toContain("key: 'Post'")
      expect(lists).toContain("key: 'Comment'")
    })

    it('should include header comment with usage examples', () => {
      const config: OpenSaasConfig = {
        db: {
          provider: 'sqlite',
        },
        lists: {
          Post: {
            fields: {
              title: text(),
            },
          },
        },
      }

      const lists = generateListsNamespace(config)

      expect(lists).toContain('/**')
      expect(lists).toContain('Generated Lists namespace from OpenSaas configuration')
      expect(lists).toContain('DO NOT EDIT')
      expect(lists).toContain('@example')
      expect(lists).toContain('import type { Lists }')
      expect(lists).toContain('list<Lists.Post.TypeInfo>')
      expect(lists).toContain('const Post: Lists.Post = list')
    })

    it('should reference correct import paths', () => {
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

      const lists = generateListsNamespace(config)

      // Check ListConfig import
      expect(lists).toContain("import('@opensaas/stack-core').ListConfig")

      // Check Item import
      expect(lists).toContain("import('./types').User")

      // Check Prisma imports
      expect(lists).toContain("import('./prisma-client/client').Prisma.UserCreateInput")
      expect(lists).toContain("import('./prisma-client/client').Prisma.UserUpdateInput")
    })

    it('should generate TypeInfo structure correctly', () => {
      const config: OpenSaasConfig = {
        db: {
          provider: 'sqlite',
        },
        lists: {
          Post: {
            fields: {
              title: text(),
            },
          },
        },
      }

      const lists = generateListsNamespace(config)

      // Verify TypeInfo structure
      expect(lists).toContain('export type TypeInfo = {')
      expect(lists).toContain("key: 'Post'")
      expect(lists).toContain('item: Item')
      expect(lists).toContain('inputs: {')
      expect(lists).toContain('create:')
      expect(lists).toContain('update:')
    })

    it('should handle lists with relationships', () => {
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

      const lists = generateListsNamespace(config)

      // Both lists should be generated
      expect(lists).toContain('export type User')
      expect(lists).toContain('export type Post')

      // Prisma input types should still reference correct types
      expect(lists).toContain('Prisma.UserCreateInput')
      expect(lists).toContain('Prisma.PostCreateInput')
      expect(lists).toContain('Prisma.UserUpdateInput')
      expect(lists).toContain('Prisma.PostUpdateInput')
    })

    it('should handle lists with various field types', () => {
      const config: OpenSaasConfig = {
        db: {
          provider: 'sqlite',
        },
        lists: {
          Product: {
            fields: {
              name: text(),
              price: integer(),
              isAvailable: checkbox(),
            },
          },
        },
      }

      const lists = generateListsNamespace(config)

      // TypeInfo should be generated regardless of field types
      expect(lists).toContain('export type Product')
      expect(lists).toContain('namespace Product {')
      expect(lists).toContain('export type TypeInfo')
      expect(lists).toContain('Prisma.ProductCreateInput')
      expect(lists).toContain('Prisma.ProductUpdateInput')
    })

    it('should close namespace properly', () => {
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

      const lists = generateListsNamespace(config)

      // Should have closing brace for namespace
      expect(lists).toMatch(/}\s*$/)
    })

    it('should generate for empty lists object', () => {
      const config: OpenSaasConfig = {
        db: {
          provider: 'sqlite',
        },
        lists: {},
      }

      const lists = generateListsNamespace(config)

      // Should still have namespace declaration
      expect(lists).toContain('export declare namespace Lists {')
      expect(lists).toContain('}')
      expect(lists).toContain('/**')
    })

    it('should maintain consistent formatting', () => {
      const config: OpenSaasConfig = {
        db: {
          provider: 'sqlite',
        },
        lists: {
          Post: {
            fields: {
              title: text(),
            },
          },
        },
      }

      const lists = generateListsNamespace(config)

      // Check indentation consistency
      expect(lists).toContain('  export type Post')
      expect(lists).toContain('  namespace Post {')
      expect(lists).toContain('    export type Item')
      expect(lists).toContain('    export type TypeInfo')
      expect(lists).toContain('      key:')
      expect(lists).toContain('      item:')
      expect(lists).toContain('      inputs: {')
      expect(lists).toContain('        create:')
      expect(lists).toContain('        update:')
    })

    it('should handle list names with special casing', () => {
      const config: OpenSaasConfig = {
        db: {
          provider: 'sqlite',
        },
        lists: {
          BlogPost: {
            fields: {
              title: text(),
            },
          },
          APIKey: {
            fields: {
              key: text(),
            },
          },
        },
      }

      const lists = generateListsNamespace(config)

      // Should preserve exact casing from config
      expect(lists).toContain('export type BlogPost')
      expect(lists).toContain('export type APIKey')
      expect(lists).toContain('namespace BlogPost {')
      expect(lists).toContain('namespace APIKey {')
      expect(lists).toContain("key: 'BlogPost'")
      expect(lists).toContain("key: 'APIKey'")
      expect(lists).toContain('Prisma.BlogPostCreateInput')
      expect(lists).toContain('Prisma.APIKeyCreateInput')
    })

    it('should connect List type to TypeInfo via ListConfig generic', () => {
      const config: OpenSaasConfig = {
        db: {
          provider: 'sqlite',
        },
        lists: {
          Post: {
            fields: {
              title: text(),
            },
          },
        },
      }

      const lists = generateListsNamespace(config)

      // Verify the List type uses ListConfig with TypeInfo
      expect(lists).toContain(
        "export type Post = import('@opensaas/stack-core').ListConfig<Lists.Post.TypeInfo>",
      )
    })
  })
})
