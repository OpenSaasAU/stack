import { describe, expect, it } from 'vitest'
import type { OpenSaasConfig } from '@opensaas/stack-core'
import { deriveContract, deriveGeneratedTables } from '@opensaas/stack-core'
import { relationship, text, virtual } from '@opensaas/stack-core/fields'
import { generateTables } from './tables.js'

const blogConfig: OpenSaasConfig = {
  db: { provider: 'postgresql', timestamps: true },
  lists: {
    User: {
      fields: {
        name: text(),
        email: text({ isIndexed: 'unique' }),
        posts: relationship({ ref: 'Post.author', many: true }),
      },
    },
    Post: {
      fields: {
        title: text(),
        content: text(),
        author: relationship({ ref: 'User.posts' }),
        byline: virtual({
          type: 'string',
          needs: ['author'],
          hooks: { resolveOutput: () => '' },
        }),
        excerpt: virtual({
          type: 'string',
          needs: ['content'],
          hooks: { resolveOutput: () => '' },
        }),
      },
    },
    Tag: {
      fields: { label: text({ isIndexed: 'unique' }) },
      db: { timestamps: false },
    },
  },
}

const rendered = generateTables(deriveGeneratedTables(blogConfig, deriveContract(blogConfig)))

describe('generateTables', () => {
  it('emits each computed field’s one-hop set', () => {
    expect(rendered).toContain(`"byline": { columns: ["authorId"], relations: ["author"] },`)
    expect(rendered).toContain(`"excerpt": { columns: ["content"], relations: [] },`)
  })

  it('emits what an object-form needs names beneath each relation', () => {
    const config: OpenSaasConfig = {
      db: { provider: 'postgresql' },
      lists: {
        Post: {
          fields: {
            author: relationship({ ref: 'User' }),
            label: virtual({
              type: 'string',
              needs: { author: ['name', 'from_Post_author'] },
              hooks: { resolveOutput: () => '' },
            }),
          },
        },
        User: { fields: { name: text() } },
      },
    }
    expect(generateTables(deriveGeneratedTables(config, deriveContract(config)))).toContain(
      '"label": { columns: ["authorId"], relations: ["author"], ' +
        'nested: { "author": { columns: ["name"], relations: ["from_Post_author"] } } },',
    )
  })

  it('emits each list’s actual system fields', () => {
    expect(rendered).toContain(`systemFields: ["id", "createdAt", "updatedAt"],`)
    // `Tag` opts out of timestamps, so it has only `id`.
    expect(rendered).toMatch(/"Tag": \{\n\s+systemFields: \["id"\],/)
  })

  it('emits the constraint map keyed by physical constraint name', () => {
    expect(rendered).toContain(`"User_email_key": { list: "User", fields: ["email"] },`)
    expect(rendered).toContain(`"Tag_label_key": { list: "Tag", fields: ["label"] },`)
    expect(rendered).toContain(`"Post_pkey": { list: "Post", fields: ["id"] },`)
  })

  it('types both tables from core rather than restating their shape', () => {
    expect(rendered).toContain(
      `import type { ConstraintMap, DependencyTable } from '@opensaas/stack-core'`,
    )
    expect(rendered).toContain('export const dependencyTable: DependencyTable = {')
    expect(rendered).toContain('export const constraintMap: ConstraintMap = {')
  })

  it('is deterministic — a second render over the same config is byte-identical', () => {
    expect(generateTables(deriveGeneratedTables(blogConfig, deriveContract(blogConfig)))).toBe(
      rendered,
    )
  })

  it('sorts every key so a reordered config produces the same bytes', () => {
    const reordered: OpenSaasConfig = {
      ...blogConfig,
      lists: {
        Tag: blogConfig.lists.Tag,
        Post: blogConfig.lists.Post,
        User: blogConfig.lists.User,
      },
    }
    expect(generateTables(deriveGeneratedTables(reordered, deriveContract(reordered)))).toBe(
      rendered,
    )
  })
})
