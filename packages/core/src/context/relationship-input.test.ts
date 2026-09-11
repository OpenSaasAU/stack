import { describe, expect, it } from 'vitest'
import type { OpenSaasConfig } from '../config/types.js'
import { relationship, text } from '../fields/index.js'
import {
  ConflictingRelationInputError,
  MalformedForeignKeyInputError,
  MalformedRelationInputError,
  NestedRelationInputError,
  NonOwningRelationInputError,
  refuseNestedRelationInput,
} from './relationship-input.js'

/**
 * The payload-shape refusal on its own (ADR-0050, #1152, #1153). What reaches
 * the database with it is covered over a real collection in
 * `secured-write.test.ts`; this pins which keys it inspects and which
 * spellings it recognises on them.
 */

const config: OpenSaasConfig = {
  db: { provider: 'postgresql', timestamps: true },
  lists: {
    Category: { fields: { name: text() } },
    Author: { fields: { name: text(), posts: relationship({ ref: 'Post.author', many: true }) } },
    Post: {
      fields: {
        title: text(),
        // A list-only ref, so `Category` carries the synthetic back-relation
        // `from_Post_category` rather than a declared field.
        category: relationship({ ref: 'Category' }),
        author: relationship({ ref: 'Author.posts' }),
      },
    },
  },
}

const post = config.lists.Post
const category = config.lists.Category
const author = config.lists.Author

describe('refuseNestedRelationInput', () => {
  it('refuses a nested write spelling on a declared relationship', () => {
    expect(() =>
      refuseNestedRelationInput('Post', post, config, {
        title: 't',
        category: { create: { name: 'c' } },
      }),
    ).toThrow(NestedRelationInputError)
  })

  it('leaves a non-relation key alone, whatever it carries', () => {
    // A `json` column may legitimately hold a key named `create`.
    expect(() =>
      refuseNestedRelationInput('Post', post, config, { title: { create: { name: 'c' } } }),
    ).not.toThrow()
  })

  it('treats an explicitly-undefined nested key as absent', () => {
    // `{ create: cond ? x : undefined }` requested no nested write, so naming
    // `create` in the refusal would be a lie about what the caller sent. The
    // object is still refused — it is not a column value — just not by a
    // spelling it does not carry.
    let thrown: unknown
    try {
      refuseNestedRelationInput('Post', post, config, {
        title: 't',
        category: { create: undefined, connect: undefined },
      })
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(MalformedRelationInputError)
    const message = (thrown as Error).message
    expect(message).not.toContain('`create`')
  })

  it('refuses a nested write on a synthetic reverse-relation key', () => {
    // `from_Post_category` is undeclared by design — a sudo payload carries it
    // past `filterWritableFields`, so the refusal has to recognise it too.
    expect(() =>
      refuseNestedRelationInput('Category', category, config, {
        name: 'c',
        from_Post_category: { create: { title: 't' } },
      }),
    ).toThrow(NestedRelationInputError)
  })

  it('refuses connect on a synthetic reverse-relation key, which owns no column', () => {
    expect(() =>
      refuseNestedRelationInput('Category', category, config, {
        from_Post_category: { connect: { id: 'p1' } },
      }),
    ).toThrow(NonOwningRelationInputError)
  })

  it('refuses connect through a to-many inverse field', () => {
    // `Author.posts` is keyed by `Post.authorId`, so connecting through it is
    // N updates against `Post` — the hidden second write ADR-0050 removes.
    let thrown: unknown
    try {
      refuseNestedRelationInput('Author', author, config, {
        name: 'a',
        posts: { connect: { id: 'p1' } },
      })
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(NonOwningRelationInputError)
    const message = (thrown as Error).message
    expect(message).toContain('"Author"')
    expect(message).toContain('"posts"')
  })

  it('accepts connect on the foreign-key-owning side', () => {
    expect(() =>
      refuseNestedRelationInput('Post', post, config, {
        title: 't',
        author: { connect: { id: 'a1' } },
      }),
    ).not.toThrow()
  })

  it('refuses disconnect permanently, pointing at the null assignment that replaces it', () => {
    // ADR-0050 removes `disconnect` rather than deferring it: on the side that
    // owns the column, clearing an edge is `null` on the same field.
    let thrown: unknown
    try {
      refuseNestedRelationInput('Post', post, config, { category: { disconnect: true } })
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(NestedRelationInputError)
    const message = (thrown as Error).message
    expect(message).toContain('`disconnect`')
    expect(message).toContain('assigning `null` to "category"')

    // The advice the message just gave has to be a payload the same pass
    // accepts, or the reader's next call throws too (#1439).
    expect(() =>
      refuseNestedRelationInput('Post', post, config, { category: null }),
    ).not.toThrow()
  })

  it('points a to-many disconnect at the target list, not at null on the field', () => {
    // `Author.posts` owns no column, so `null` on it is refused in turn. The
    // reader of this message is by definition migrating a to-many `disconnect`
    // — the caller the `null` advice is wrong for (#1439).
    let thrown: unknown
    try {
      refuseNestedRelationInput('Author', author, config, { posts: { disconnect: [{ id: 'p1' }] } })
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(NestedRelationInputError)
    const message = (thrown as Error).message
    expect(message).toContain('`disconnect`')
    expect(message).toContain('target list')
    expect(message).not.toContain('assigning `null` to "posts"')

    // What the old message advised, proving it was advice this pass rejects.
    expect(() => refuseNestedRelationInput('Author', author, config, { posts: null })).toThrow(
      NonOwningRelationInputError,
    )
  })

  it('points a synthetic back-relation disconnect at the target list too', () => {
    let thrown: unknown
    try {
      refuseNestedRelationInput('Category', category, config, {
        from_Post_category: { disconnect: [{ id: 'p1' }] },
      })
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(NestedRelationInputError)
    const message = (thrown as Error).message
    expect(message).toContain('target list')
    expect(message).not.toContain('assigning `null` to "from_Post_category"')
  })

  it('refuses a relation object that carries no spelling at all', () => {
    let thrown: unknown
    try {
      refuseNestedRelationInput('Post', post, config, { title: 't', category: {} })
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(MalformedRelationInputError)
    expect((thrown as Error).message).toContain('"category"')
  })

  it('refuses a bare column value on a relationship key', () => {
    // A relationship field takes the row to link to, never the foreign key
    // spelled onto the field itself.
    expect(() => refuseNestedRelationInput('Post', post, config, { category: 'c1' })).toThrow(
      MalformedRelationInputError,
    )
  })

  it('refuses a connect carrying anything but an id', () => {
    expect(() =>
      refuseNestedRelationInput('Post', post, config, { category: { connect: { name: 'c' } } }),
    ).toThrow(MalformedRelationInputError)
  })

  it('leaves null on a relation key alone', () => {
    // `null` is what ADR-0050 makes the replacement for `disconnect`; the shape
    // refusal must not swallow it.
    expect(() => refuseNestedRelationInput('Post', post, config, { category: null })).not.toThrow()
  })

  it('reports the nested-write refusal ahead of the shape one', () => {
    // A payload spelling both gets the message naming the spelling that left.
    expect(() =>
      refuseNestedRelationInput('Post', post, config, {
        category: { connect: { id: 'c1' }, create: { name: 'c' } },
      }),
    ).toThrow(NestedRelationInputError)
  })
})

/**
 * The foreign-key column is the second spelling of the edge the relationship
 * field spells (#1331), so the refusal pass owes it the shape check its
 * sibling gets — and owes the pair of them a ruling on being written together.
 */
describe('refuseNestedRelationInput on a foreign-key column', () => {
  it('leaves a row id and a cleared edge alone', () => {
    expect(() =>
      refuseNestedRelationInput('Post', post, config, { title: 't', authorId: 'a1' }),
    ).not.toThrow()
    expect(() => refuseNestedRelationInput('Post', post, config, { authorId: null })).not.toThrow()
  })

  it('refuses a wrapper on the column, naming the field to write instead', () => {
    let thrown: unknown
    try {
      refuseNestedRelationInput('Post', post, config, { authorId: { set: 'a1' } })
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(MalformedForeignKeyInputError)
    const message = (thrown as Error).message
    expect(message).toContain('"authorId"')
    expect(message).toContain('"author"')
  })

  it('refuses a payload spelling one edge both ways, naming both spellings', () => {
    let thrown: unknown
    try {
      refuseNestedRelationInput('Post', post, config, {
        title: 't',
        author: { connect: { id: 'a1' } },
        authorId: 'a2',
      })
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(ConflictingRelationInputError)
    const message = (thrown as Error).message
    expect(message).toContain('"author"')
    expect(message).toContain('"authorId"')
  })

  it('refuses the pair whichever way round the payload writes it', () => {
    expect(() =>
      refuseNestedRelationInput('Post', post, config, {
        authorId: 'a2',
        author: { connect: { id: 'a1' } },
      }),
    ).toThrow(ConflictingRelationInputError)
  })

  it('refuses the pair even where the two spellings agree', () => {
    // Agreement is not the point: one value reaches the row and the other is
    // discarded, so a payload carrying both is answered rather than ranked.
    expect(() =>
      refuseNestedRelationInput('Post', post, config, { author: null, authorId: null }),
    ).toThrow(ConflictingRelationInputError)
  })

  it('refuses the pair ahead of a malformed shape on either half', () => {
    expect(() =>
      refuseNestedRelationInput('Post', post, config, {
        author: {},
        authorId: { set: 'a1' },
      }),
    ).toThrow(ConflictingRelationInputError)
  })

  it('treats an explicitly-undefined counterpart as absent', () => {
    // `{ author: cond ? … : undefined }` spelled the edge once.
    expect(() =>
      refuseNestedRelationInput('Post', post, config, { author: undefined, authorId: 'a1' }),
    ).not.toThrow()
    expect(() =>
      refuseNestedRelationInput('Post', post, config, {
        author: { connect: { id: 'a1' } },
        authorId: undefined,
      }),
    ).not.toThrow()
  })

  it('leaves a column whose name only looks like a foreign key alone', () => {
    // `Author` declares no `name` relationship, so `nameId` is a plain column.
    expect(() =>
      refuseNestedRelationInput('Author', author, config, { nameId: { set: 'x' } }),
    ).not.toThrow()
  })
})
