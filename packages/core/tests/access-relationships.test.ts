import { describe, it, expect } from 'vitest'
import { filterReadableFields, getRelatedListConfig } from '../src/access/index.js'
import type { OpenSaasConfig, AccessContext } from '../src/index.js'

describe('Relationship Access Control', () => {
  const mockContext: AccessContext = {
    session: null,
    ormHandle: {},
    db: {},
    storage: {
      uploadFile: async () => {
        throw new Error('Not implemented')
      },
      uploadImage: async () => {
        throw new Error('Not implemented')
      },
      deleteFile: async () => {
        throw new Error('Not implemented')
      },
      deleteImage: async () => {
        throw new Error('Not implemented')
      },
    },
    plugins: {},
    _isSudo: false,
    _resolveOutputChain: [],
  }

  describe('getRelatedListConfig', () => {
    const config: OpenSaasConfig = {
      db: {
        provider: 'postgresql',
        url: 'postgresql://localhost:5432/test',
      },
      lists: {
        User: {
          fields: {
            name: { type: 'text' },
          },
        },
        Post: {
          fields: {
            title: { type: 'text' },
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
  })

  describe('filterReadableFields with relationships', () => {
    describe('single relationships', () => {
      it('should apply access control to single relationship', async () => {
        const config: OpenSaasConfig = {
          db: {
            provider: 'postgresql',
            url: 'postgresql://localhost:5432/test',
          },
          lists: {
            User: {
              fields: {
                name: { type: 'text' },
              },
              access: {
                operation: {
                  query: () => true, // Allow reading users
                },
              },
            },
            Post: {
              fields: {
                title: { type: 'text' },
                author: {
                  type: 'relationship',
                  ref: 'User.posts',
                },
              },
            },
          },
        }

        const post = {
          id: '1',
          title: 'Test Post',
          author: {
            id: '1',
            name: 'John Doe',
          },
        }

        const result = await filterReadableFields(
          post,
          config.lists.Post.fields,
          {
            session: null,
            context: mockContext,
          },
          config,
        )

        expect(result.title).toBe('Test Post')
        expect(result.author).toBeDefined()
        expect(result.author?.name).toBe('John Doe')
      })

      it('should filter out single relationship when access denied (via buildAccessScopedInclude)', async () => {
        const config: OpenSaasConfig = {
          db: {
            provider: 'postgresql',
            url: 'postgresql://localhost:5432/test',
          },
          lists: {
            User: {
              fields: {
                name: { type: 'text' },
              },
              access: {
                operation: {
                  query: () => false, // Deny reading users
                },
              },
            },
            Post: {
              fields: {
                title: { type: 'text' },
                author: {
                  type: 'relationship',
                  ref: 'User.posts',
                },
              },
            },
          },
        }

        // Test that buildAccessScopedInclude excludes the denied relationship
        const { buildAccessScopedInclude } = await import('../src/access/index.js')

        const { include } = await buildAccessScopedInclude(
          { author: true },
          config.lists.Post.fields,
          {
            session: null,
            context: mockContext,
          },
          config,
          'Post',
        )

        // When access is denied, the relationship should not be included
        expect(include).toBeDefined()
        expect(include?.author).toBeUndefined()
      })

      it('should apply field-level access to single relationship', async () => {
        const config: OpenSaasConfig = {
          db: {
            provider: 'postgresql',
            url: 'postgresql://localhost:5432/test',
          },
          lists: {
            User: {
              fields: {
                name: { type: 'text' },
                email: {
                  type: 'text',
                  access: {
                    read: () => false, // Hide email
                  },
                },
              },
              access: {
                operation: {
                  query: () => true,
                },
              },
            },
            Post: {
              fields: {
                title: { type: 'text' },
                author: {
                  type: 'relationship',
                  ref: 'User.posts',
                },
              },
            },
          },
        }

        const post = {
          id: '1',
          title: 'Test Post',
          author: {
            id: '1',
            name: 'John Doe',
            email: 'john@example.com',
          },
        }

        const result = await filterReadableFields(
          post,
          config.lists.Post.fields,
          {
            session: null,
            context: mockContext,
          },
          config,
        )

        expect(result.author).toBeDefined()
        expect(result.author?.name).toBe('John Doe')
        expect(result.author?.email).toBeUndefined()
      })
    })

    describe('many relationships (arrays)', () => {
      it('should apply access control to many relationships', async () => {
        const config: OpenSaasConfig = {
          db: {
            provider: 'postgresql',
            url: 'postgresql://localhost:5432/test',
          },
          lists: {
            User: {
              fields: {
                name: { type: 'text' },
                posts: {
                  type: 'relationship',
                  ref: 'Post.author',
                  many: true,
                },
              },
            },
            Post: {
              fields: {
                title: { type: 'text' },
                status: { type: 'select', options: [] },
              },
              access: {
                operation: {
                  query: () => true, // Allow all posts
                },
              },
            },
          },
        }

        const user = {
          id: '1',
          name: 'John Doe',
          posts: [
            { id: '1', title: 'Post 1', status: 'published' },
            { id: '2', title: 'Post 2', status: 'draft' },
          ],
        }

        const result = await filterReadableFields(
          user,
          config.lists.User.fields,
          {
            session: null,
            context: mockContext,
          },
          config,
        )

        expect(result.posts).toHaveLength(2)
        expect(result.posts?.[0].title).toBe('Post 1')
        expect(result.posts?.[1].title).toBe('Post 2')
      })

      it('should filter items in many relationships based on query access (via buildAccessScopedInclude)', async () => {
        const config: OpenSaasConfig = {
          db: {
            provider: 'postgresql',
            url: 'postgresql://localhost:5432/test',
          },
          lists: {
            User: {
              fields: {
                name: { type: 'text' },
                posts: {
                  type: 'relationship',
                  ref: 'Post.author',
                  many: true,
                },
              },
            },
            Post: {
              fields: {
                title: { type: 'text' },
                status: { type: 'select', options: [] },
              },
              access: {
                operation: {
                  // Only show published posts
                  query: () => ({ status: { equals: 'published' } }),
                },
              },
            },
          },
        }

        // Test that buildAccessScopedInclude creates the right where clause
        const { buildAccessScopedInclude } = await import('../src/access/index.js')

        const { include } = await buildAccessScopedInclude(
          { posts: true },
          config.lists.User.fields,
          {
            session: null,
            context: mockContext,
          },
          config,
          'User',
        )

        // Should include posts with a where filter
        expect(include).toBeDefined()
        expect(include?.posts).toBeDefined()
        // @ts-expect-error the test
        expect(include?.posts.where).toEqual({ status: { equals: 'published' } })
      })

      it('should apply field-level access to items in many relationships', async () => {
        const config: OpenSaasConfig = {
          db: {
            provider: 'postgresql',
            url: 'postgresql://localhost:5432/test',
          },
          lists: {
            User: {
              fields: {
                name: { type: 'text' },
                posts: {
                  type: 'relationship',
                  ref: 'Post.author',
                  many: true,
                },
              },
            },
            Post: {
              fields: {
                title: { type: 'text' },
                internalNotes: {
                  type: 'text',
                  access: {
                    read: () => false, // Hide internal notes
                  },
                },
              },
              access: {
                operation: {
                  query: () => true,
                },
              },
            },
          },
        }

        const user = {
          id: '1',
          name: 'John Doe',
          posts: [
            { id: '1', title: 'Post 1', internalNotes: 'Secret notes' },
            { id: '2', title: 'Post 2', internalNotes: 'More secrets' },
          ],
        }

        const result = await filterReadableFields(
          user,
          config.lists.User.fields,
          {
            session: null,
            context: mockContext,
          },
          config,
        )

        expect(result.posts).toHaveLength(2)
        expect(result.posts?.[0].title).toBe('Post 1')
        expect(result.posts?.[0].internalNotes).toBeUndefined()
        expect(result.posts?.[1].title).toBe('Post 2')
        expect(result.posts?.[1].internalNotes).toBeUndefined()
      })

      it('should handle empty arrays', async () => {
        const config: OpenSaasConfig = {
          db: {
            provider: 'postgresql',
            url: 'postgresql://localhost:5432/test',
          },
          lists: {
            User: {
              fields: {
                name: { type: 'text' },
                posts: {
                  type: 'relationship',
                  ref: 'Post.author',
                  many: true,
                },
              },
            },
            Post: {
              fields: {
                title: { type: 'text' },
              },
              access: {
                operation: {
                  query: () => true,
                },
              },
            },
          },
        }

        const user = {
          id: '1',
          name: 'John Doe',
          posts: [],
        }

        const result = await filterReadableFields(
          user,
          config.lists.User.fields,
          {
            session: null,
            context: mockContext,
          },
          config,
        )

        expect(result.posts).toEqual([])
      })
    })

    describe('session-based access for relationships', () => {
      it('should apply session-based access to relationships (via buildAccessScopedInclude)', async () => {
        const config: OpenSaasConfig = {
          db: {
            provider: 'postgresql',
            url: 'postgresql://localhost:5432/test',
          },
          lists: {
            User: {
              fields: {
                name: { type: 'text' },
                posts: {
                  type: 'relationship',
                  ref: 'Post.author',
                  many: true,
                },
              },
            },
            Post: {
              fields: {
                title: { type: 'text' },
                authorId: { type: 'text' },
              },
              access: {
                operation: {
                  // Only show posts owned by current user
                  query: ({ session }) => {
                    if (!session) return false
                    return { authorId: { equals: session.userId } }
                  },
                },
              },
            },
          },
        }

        // Test that buildAccessScopedInclude creates session-based where clause
        const { buildAccessScopedInclude } = await import('../src/access/index.js')

        const { include } = await buildAccessScopedInclude(
          { posts: true },
          config.lists.User.fields,
          {
            session: { userId: '1' },
            context: mockContext,
          },
          config,
          'User',
        )

        // Should include posts with session-based where filter
        expect(include).toBeDefined()
        expect(include?.posts).toBeDefined()
        // @ts-expect-error the test
        expect(include?.posts.where).toEqual({ authorId: { equals: '1' } })
      })
    })

    describe('no depth cap on an acyclic chain (issue #830)', () => {
      /**
       * `filterReadableFields` used to stop recursing into relationships past
       * `MAX_DEPTH` (5), so a nested row past that depth was returned with its
       * field-level `read` access never evaluated and its `resolveOutput` hooks
       * never run — even though the row-scoping half of the pipeline
       * (`buildIncludeWithAccessControl`) may have correctly scoped it. The fix
       * removes this cap: by the time a result reaches this function it is
       * already a finite, ACYCLIC tree bounded by whatever the (now fail-closed)
       * pre-query phase permitted, so there is no infinite-recursion risk left
       * to guard against. This test builds an 8-level-deep chain — deeper than
       * the old cap — with a read-denied field and a resolveOutput hook on the
       * deepest list, and asserts both are applied at every level.
       */
      it('applies field-level read access and resolveOutput at depth 6+', async () => {
        const allowQuery = () => true
        const chainLength = 8
        const lists: OpenSaasConfig['lists'] = {}
        for (let i = 0; i < chainLength; i++) {
          const isLast = i === chainLength - 1
          lists[`L${i}`] = {
            fields: {
              name: { type: 'text' },
              ...(isLast
                ? {
                    secret: {
                      type: 'text',
                      access: { read: () => false },
                    },
                    label: {
                      type: 'text',
                      hooks: {
                        resolveOutput: ({ value }: { value: unknown }) => `resolved:${value}`,
                      },
                    },
                  }
                : {}),
              ...(i < chainLength - 1
                ? { next: { type: 'relationship', ref: `L${i + 1}.prev` } }
                : {}),
              ...(i > 0 ? { prev: { type: 'relationship', ref: `L${i - 1}.next` } } : {}),
            },
            access: { operation: { query: allowQuery } },
          }
        }
        const config: OpenSaasConfig = {
          db: { provider: 'postgresql', url: 'postgresql://localhost:5432/test' },
          lists,
        }

        // Build a genuinely acyclic, materialized nested object — exactly what
        // Prisma would return for this include shape (a fresh object per level,
        // no shared/back references).
        let deepest: Record<string, unknown> = {
          id: `${chainLength - 1}`,
          name: `L${chainLength - 1}`,
          secret: 'TOP-SECRET',
          label: 'raw-value',
        }
        for (let i = chainLength - 2; i >= 0; i--) {
          deepest = { id: `${i}`, name: `L${i}`, next: deepest }
        }

        const result = await filterReadableFields(
          deepest,
          config.lists.L0.fields,
          { session: null, context: mockContext },
          config,
        )

        // Walk down to the deepest level in the filtered result.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let current: any = result
        for (let i = 0; i < chainLength - 1; i++) {
          current = current.next
        }

        expect(current.secret).toBeUndefined() // read-denied field stripped
        expect(current.label).toBe('resolved:raw-value') // resolveOutput ran
      })
    })

    describe('null and undefined relationships', () => {
      it('should handle null single relationships', async () => {
        const config: OpenSaasConfig = {
          db: {
            provider: 'postgresql',
            url: 'postgresql://localhost:5432/test',
          },
          lists: {
            User: {
              fields: {
                name: { type: 'text' },
              },
              access: {
                operation: {
                  query: () => true,
                },
              },
            },
            Post: {
              fields: {
                title: { type: 'text' },
                author: {
                  type: 'relationship',
                  ref: 'User.posts',
                },
              },
            },
          },
        }

        const post = {
          id: '1',
          title: 'Test Post',
          author: null,
        }

        const result = await filterReadableFields(
          post,
          config.lists.Post.fields,
          {
            session: null,
            context: mockContext,
          },
          config,
        )

        expect(result.author).toBeNull()
      })
    })
  })
})
