import { describe, it, expect } from 'vitest'
import { deriveItemViewLayout, DEFAULT_ITEM_VIEW_TAKE } from '../../src/lib/deriveItemView.js'
import type { FieldConfig, OpenSaasConfig } from '@opensaas/stack-core'
import {
  integer,
  password,
  relationship,
  select,
  text,
  timestamp,
} from '@opensaas/stack-core/fields'

function makeConfig(
  lists: OpenSaasConfig['lists'],
  db: Partial<OpenSaasConfig['db']> = {},
): OpenSaasConfig {
  return { db: { provider: 'postgresql', ...db }, lists }
}

const STATUS_OPTIONS = [{ label: 'Draft', value: 'draft' }]

const userWithPosts = (posts: FieldConfig = relationship({ ref: 'Post.author', many: true })) => ({
  fields: { posts },
})

const postOf = (fields: Record<string, FieldConfig> = { title: text() }) => ({
  fields: { ...fields, author: relationship({ ref: 'User.posts' }) },
})

describe('deriveItemViewLayout', () => {
  it('derives a single centered card when there are no to-many relationships', () => {
    const config = makeConfig({
      Post: {
        fields: {
          title: text(),
          author: relationship({ ref: 'User.posts' }), // to-one → details
        },
      },
      User: { fields: { posts: relationship({ ref: 'Post.author', many: true }) } },
    })

    const layout = deriveItemViewLayout(config, 'Post')

    expect(layout.arrangement).toBe('single')
    expect(layout.sections).toHaveLength(0)
    expect(layout.detailsFields).toEqual(['title', 'author'])
  })

  it('derives a two-column split for exactly one to-many relationship', () => {
    const config = makeConfig({
      User: {
        fields: {
          name: text(),
          posts: relationship({ ref: 'Post.author', many: true }),
        },
      },
      Post: postOf({ title: text(), status: select({ options: STATUS_OPTIONS }) }),
    })

    const layout = deriveItemViewLayout(config, 'User')

    expect(layout.arrangement).toBe('split')
    expect(layout.detailsFields).toEqual(['name'])
    expect(layout.sections).toHaveLength(1)
    const [section] = layout.sections
    expect(section.fieldName).toBe('posts')
    expect(section.relatedListKey).toBe('Post')
    expect(section.backReferenceField).toBe('author')
    // Columns = related list curation minus the back-reference (`author`).
    expect(section.columns).toEqual(['title', 'status'])
    expect(section.sumColumns).toEqual([])
  })

  it('stacks several to-many relationships', () => {
    const config = makeConfig({
      User: {
        fields: {
          name: text(),
          posts: relationship({ ref: 'Post.author', many: true }),
          comments: relationship({ ref: 'Comment.author', many: true }),
        },
      },
      Post: postOf(),
      Comment: {
        fields: { body: text(), author: relationship({ ref: 'User.comments' }) },
      },
    })

    const layout = deriveItemViewLayout(config, 'User')

    expect(layout.arrangement).toBe('stacked')
    expect(layout.sections.map((s) => s.fieldName)).toEqual(['posts', 'comments'])
  })

  it('honours a per-relationship column override', () => {
    const config = makeConfig({
      User: userWithPosts(
        relationship({
          ref: 'Post.author',
          many: true,
          ui: { itemView: { columns: ['title'] } },
        }),
      ),
      Post: postOf({ title: text(), status: select({ options: STATUS_OPTIONS }) }),
    })

    const [section] = deriveItemViewLayout(config, 'User').sections
    expect(section.columns).toEqual(['title'])
  })

  it('bounds the row fetch by the default take when none is configured (issue #752)', () => {
    const config = makeConfig({ User: userWithPosts(), Post: postOf() })

    const [section] = deriveItemViewLayout(config, 'User').sections
    expect(section.take).toBe(DEFAULT_ITEM_VIEW_TAKE)
  })

  it('honours a per-relationship take override', () => {
    const config = makeConfig({
      User: userWithPosts(
        relationship({ ref: 'Post.author', many: true, ui: { itemView: { take: 5 } } }),
      ),
      Post: postOf(),
    })

    const [section] = deriveItemViewLayout(config, 'User').sections
    expect(section.take).toBe(5)
  })

  it('falls back to the default take for a non-positive or non-integer override', () => {
    const makeUser = (take: number): OpenSaasConfig =>
      makeConfig({
        User: userWithPosts(
          relationship({
            ref: 'Post.author',
            many: true,
            // A malformed take (zero, negative, fractional, NaN) must never
            // disable the bound — it falls back to the default.
            ui: { itemView: { take } },
          }),
        ),
        Post: postOf(),
      })

    for (const bad of [0, -3, 2.5, Number.NaN]) {
      const [section] = deriveItemViewLayout(makeUser(bad), 'User').sections
      expect(section.take).toBe(DEFAULT_ITEM_VIEW_TAKE)
    }
  })

  it('reads summed columns from config (footer opt-in)', () => {
    const config = makeConfig({
      Order: {
        fields: {
          lineItems: relationship({
            ref: 'LineItem.order',
            many: true,
            ui: { itemView: { sum: ['amount'] } },
          }),
        },
      },
      LineItem: {
        fields: {
          amount: integer(),
          order: relationship({ ref: 'Order.lineItems' }),
        },
      },
    })

    const [section] = deriveItemViewLayout(config, 'Order').sections
    expect(section.sumColumns).toEqual(['amount'])
    // Default columns still exclude the back-reference.
    expect(section.columns).toEqual(['amount'])
  })

  it('demotes a relationship to the picker (details card) when configured', () => {
    const config = makeConfig({
      User: {
        fields: {
          name: text(),
          posts: relationship({
            ref: 'Post.author',
            many: true,
            ui: { itemView: { displayMode: 'picker' } },
          }),
        },
      },
      Post: postOf(),
    })

    const layout = deriveItemViewLayout(config, 'User')
    expect(layout.arrangement).toBe('single')
    expect(layout.sections).toHaveLength(0)
    // The demoted relationship stays a details-card field.
    expect(layout.detailsFields).toEqual(['name', 'posts'])
  })

  it('reorders sections by list-level ui.itemView.order', () => {
    const config = makeConfig({
      User: {
        fields: {
          posts: relationship({ ref: 'Post.author', many: true }),
          comments: relationship({ ref: 'Comment.author', many: true }),
        },
        ui: { itemView: { order: ['comments', 'posts'] } },
      },
      Post: postOf(),
      Comment: {
        fields: { body: text(), author: relationship({ ref: 'User.comments' }) },
      },
    })

    const layout = deriveItemViewLayout(config, 'User')
    expect(layout.sections.map((s) => s.fieldName)).toEqual(['comments', 'posts'])
  })

  it('defaults row removal to disconnect and marks a nullable back-reference disconnectable', () => {
    const config = makeConfig({
      User: userWithPosts(),
      Post: postOf(), // `author` is a nullable FK
    })

    const [section] = deriveItemViewLayout(config, 'User').sections
    expect(section.removeAction).toBe('disconnect')
    expect(section.disconnectable).toBe(true)
  })

  it('reads a delete removeAction opt-in', () => {
    const config = makeConfig({
      User: {
        fields: {
          notes: relationship({
            ref: 'Note.owner',
            many: true,
            ui: { itemView: { removeAction: 'delete' } },
          }),
        },
      },
      Note: {
        fields: {
          body: text(),
          owner: relationship({ ref: 'User.notes' }),
        },
      },
    })

    const [section] = deriveItemViewLayout(config, 'User').sections
    expect(section.removeAction).toBe('delete')
  })

  it('reads a none removeAction (hides the control)', () => {
    const config = makeConfig({
      User: userWithPosts(
        relationship({
          ref: 'Post.author',
          many: true,
          ui: { itemView: { removeAction: 'none' } },
        }),
      ),
      Post: postOf(),
    })

    const [section] = deriveItemViewLayout(config, 'User').sections
    expect(section.removeAction).toBe('none')
  })

  const junctionLists = (tags: FieldConfig): OpenSaasConfig['lists'] => ({
    User: { fields: { tags } },
    Tag: { fields: { users: relationship({ ref: 'UserTag.tag', many: true }) } },
    UserTag: {
      fields: {
        user: relationship({ ref: 'User.tags' }),
        tag: relationship({ ref: 'Tag.users' }),
      },
    },
  })

  it('defaults row removal to delete for a junction-backed section (#1339)', () => {
    const config = makeConfig(junctionLists(relationship({ ref: 'UserTag.user', many: true })))

    const [section] = deriveItemViewLayout(config, 'User').sections
    expect(section.removeAction).toBe('delete')
  })

  it('lets an explicit disconnect override win over the junction default', () => {
    const config = makeConfig(
      junctionLists(
        relationship({
          ref: 'UserTag.user',
          many: true,
          ui: { itemView: { removeAction: 'disconnect' } },
        }),
      ),
    )

    const [section] = deriveItemViewLayout(config, 'User').sections
    expect(section.removeAction).toBe('disconnect')
  })

  it('marks a required-FK back-reference (db.isNullable:false) as not disconnectable', () => {
    const config = makeConfig({
      Order: {
        fields: {
          lineItems: relationship({ ref: 'LineItem.order', many: true }),
        },
      },
      LineItem: {
        fields: {
          amount: integer(),
          // A required foreign key on the related side — disconnect is
          // statically impossible, so the default disconnect control is hidden.
          order: relationship({ ref: 'Order.lineItems', db: { isNullable: false } }),
        },
      },
    })

    const [section] = deriveItemViewLayout(config, 'Order').sections
    expect(section.removeAction).toBe('disconnect')
    expect(section.disconnectable).toBe(false)
  })

  it('refuses a list-only to-many, which names no back-reference, as generate does', () => {
    const config = makeConfig({
      Team: {
        fields: { members: relationship({ ref: 'Member', many: true }) },
      },
      Member: { fields: { name: text() } },
    })

    expect(() => deriveItemViewLayout(config, 'Team')).toThrow(/implicit many-to-many/)
  })

  const teamWithMembers = (
    memberFields: Record<string, FieldConfig>,
    db: Partial<OpenSaasConfig['db']> = {},
  ): OpenSaasConfig =>
    makeConfig(
      {
        Team: {
          fields: { members: relationship({ ref: 'Member.team', many: true }) },
        },
        Member: { fields: { ...memberFields, team: relationship({ ref: 'Team.members' }) } },
      },
      db,
    )

  it("takes a section's columns from the related list itself, minus the back-reference", () => {
    const [section] = deriveItemViewLayout(teamWithMembers({ name: text() }), 'Team').sections
    expect(section.backReferenceField).toBe('team')
    expect(section.columns).toEqual(['name'])
  })

  it('excludes a real password() field from related-list default columns via its declared flag (#1018)', () => {
    const config = teamWithMembers({ name: text(), secret: password() })

    const [section] = deriveItemViewLayout(config, 'Team').sections
    expect(section.columns).toEqual(['name'])
  })

  it('does not exclude a related-list column merely named or typed password with no declared flag', () => {
    // A hand-rolled 'password'-typed field with no ui.listView declaration
    // is no longer excluded by type alone — curation is flag-based only.
    const handRolledPassword: FieldConfig = { ...text(), type: 'password' }
    const config = teamWithMembers({
      name: text(),
      password: text(),
      secret: handRolledPassword,
    })

    const [section] = deriveItemViewLayout(config, 'Team').sections
    expect(section.columns).toEqual(['name', 'password', 'secret'])
  })

  it('excludes a related-list field declaring ui.listView.defaultColumn: false, whatever its name', () => {
    const config = teamWithMembers({
      name: text(),
      internalScore: integer({ ui: { listView: { defaultColumn: false } } }),
    })

    const [section] = deriveItemViewLayout(config, 'Team').sections
    expect(section.columns).toEqual(['name'])
  })

  it("excludes the related list's structural createdAt/updatedAt columns, identified by its own timestamp config", () => {
    const config = teamWithMembers(
      { name: text(), createdAt: timestamp(), updatedAt: timestamp() },
      { timestamps: true },
    )

    const [section] = deriveItemViewLayout(config, 'Team').sections
    expect(section.columns).toEqual(['name'])
  })

  it("does not exclude a related-list field literally named createdAt when the list's timestamps are off", () => {
    const config = teamWithMembers({ name: text(), createdAt: text() })

    const [section] = deriveItemViewLayout(config, 'Team').sections
    expect(section.columns).toEqual(['name', 'createdAt'])
  })
})
