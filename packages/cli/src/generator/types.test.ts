import { describe, it, expect } from 'vitest'
import { generateTypes } from './types.js'
import type { OpenSaasConfig } from '@opensaas/stack-core'
import { text, integer, relationship, checkbox, virtual } from '@opensaas/stack-core/fields'

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

    it('should generate Select and GetPayload types with virtual fields', () => {
      const config: OpenSaasConfig = {
        db: {
          provider: 'sqlite',
        },
        lists: {
          User: {
            fields: {
              firstName: text({ validation: { isRequired: true } }),
              lastName: text({ validation: { isRequired: true } }),
              fullName: virtual({
                type: 'string',
                hooks: {
                  resolveOutput: ({ item }: { firstName: string; lastName: string }) =>
                    `${item.firstName} ${item.lastName}`,
                },
              }),
            },
          },
        },
      }

      const types = generateTypes(config)

      // Should generate UserVirtualFields type
      expect(types).toContain('export type UserVirtualFields = {')
      expect(types).toContain('fullName: string')

      // Should generate UserSelect with virtual field
      expect(types).toContain('export type UserSelect = OpensaasUnnarrowed & {')
      expect(types).toContain('fullName?: boolean')

      // Should generate UserGetPayload helper type using StripVirtualFromArgs
      expect(types).toContain(
        'export type UserGetPayload<T extends { select?: any; include?: any } = {}> =',
      )
      expect(types).toContain(
        'OpensaasPayload<UserOutput, StripVirtualFromArgs<T, keyof UserVirtualFields>>',
      )

      expect(types).toMatchSnapshot()
    })

    it('should use StripVirtualFromArgs in GetPayload for lists with virtual + relation fields (regression #383)', () => {
      const config: OpenSaasConfig = {
        db: {
          provider: 'sqlite',
        },
        lists: {
          Account: {
            fields: {
              name: text(),
              bills: relationship({ ref: 'Bill.account', many: true }),
            },
          },
          Bill: {
            fields: {
              name: text(),
              total: virtual({
                type: 'string',
                hooks: {
                  resolveOutput: async () => '100.00',
                },
              }),
              account: relationship({ ref: 'Account.bills' }),
            },
          },
        },
      }

      const types = generateTypes(config)

      // The shared utility type must be emitted once
      expect(types).toContain('type StripVirtualFromArgs<T, VirtualKeys extends string> =')

      // Bill has virtual fields so its GetPayload must use StripVirtualFromArgs
      expect(types).toContain(
        'OpensaasPayload<BillOutput, StripVirtualFromArgs<T, keyof BillVirtualFields>>',
      )

      // Account has no virtual fields so its GetPayload must NOT use StripVirtualFromArgs
      expect(types).not.toContain('OpensaasPayload<AccountOutput, StripVirtualFromArgs')

      expect(types).toMatchSnapshot()
    })

    it('should generate Include type with virtual fields for models with relationships', () => {
      const config: OpenSaasConfig = {
        db: {
          provider: 'sqlite',
        },
        lists: {
          User: {
            fields: {
              name: text(),
              posts: relationship({ ref: 'Post.author', many: true }),
              postCount: virtual({
                type: 'number',
                hooks: {
                  resolveOutput: ({ item }: { posts?: unknown[] }) => item.posts?.length || 0,
                },
              }),
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

      // Should generate UserInclude with virtual field
      expect(types).toContain('export type UserInclude = OpensaasUnnarrowed & {')
      expect(types).toContain('postCount?: boolean')

      expect(types).toMatchSnapshot()
    })
  })

  // #608: the standalone {List}CreateInput / {List}UpdateInput exports and the
  // call-site write-`data` override must agree on how a nullable scalar is
  // represented (both `?: T | null`). A single shared helper
  // (renderScalarInputMember) renders the member for both paths; these tests
  // pin the agreement so the two sources of truth cannot silently drift again.
  describe('create/update input nullability consolidation (#608)', () => {
    const config: OpenSaasConfig = {
      db: { provider: 'sqlite' },
      lists: {
        Post: {
          fields: {
            // Required scalar: stays required, no `?`, no `| null`.
            title: text({ validation: { isRequired: true } }),
            // Nullable scalar: optional + `| null` in every input representation.
            content: text(),
          },
        },
      },
    }

    it('emits `| null` for a nullable scalar in the standalone CreateInput', () => {
      const types = generateTypes(config)
      expect(types).toContain('export type PostCreateInput = {')
      expect(types).toContain('  content?: string | null')
    })

    it('emits `| null` for a nullable scalar in the standalone UpdateInput', () => {
      const types = generateTypes(config)
      expect(types).toContain('export type PostUpdateInput = {')
      // UpdateInput keeps every scalar optional and nullable scalars get `| null`.
      expect(types).toContain('  content?: string | null')
    })

    it('emits the same nullable-scalar shape in the call-site create `data` override', () => {
      const types = generateTypes(config)
      // The CreateArgs `data` override narrows scalars; the nullable `content`
      // member must match the standalone CreateInput member exactly.
      expect(types).toContain("data: Omit<OpensaasUnnarrowed, 'title' | 'content'> & {")
      expect(types).toContain('    content?: string | null')
    })

    it('emits the same nullable-scalar shape in the call-site update `data` override', () => {
      const types = generateTypes(config)
      expect(types).toContain("data: Omit<OpensaasUnnarrowed, 'title' | 'content'> & {")
      expect(types).toContain('    content?: string | null')
    })

    it('keeps a required scalar required (no `?`, no `| null`) in both create paths', () => {
      const types = generateTypes(config)
      // Standalone CreateInput: required scalar has neither `?` nor `| null`.
      expect(types).toContain('  title: string\n')
      // Override create `data`: same required shape.
      expect(types).toContain('    title: string\n')
      // A required scalar must never gain `| null` anywhere (create or update).
      // (`title?: string` IS valid in UpdateInput, where every scalar is
      // optional, but it must never become `title?: string | null`.)
      expect(types).not.toContain('title: string | null')
      expect(types).not.toContain('title?: string | null')
    })

    it('keeps standalone input and `data` override nullability in lock-step', () => {
      const types = generateTypes(config)
      // Both the standalone CreateInput member and the override `data` member
      // render the nullable scalar identically (modulo indentation): `?: T | null`.
      const nullableMemberPattern = /content\?: string \| null/g
      const matches = types.match(nullableMemberPattern) ?? []
      // At minimum: standalone CreateInput, standalone UpdateInput, create
      // override, update override, plus createMany/updateMany overrides.
      expect(matches.length).toBeGreaterThanOrEqual(4)
    })
  })
})
