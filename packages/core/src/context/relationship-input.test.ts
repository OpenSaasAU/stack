import { describe, expect, it } from 'vitest'
import type { OpenSaasConfig } from '../config/types.js'
import { relationship, text } from '../fields/index.js'
import {
  NestedRelationInputError,
  RelationInputNotLoweredError,
  refuseNestedRelationInput,
} from './relationship-input.js'

/**
 * The payload-shape refusal on its own (ADR-0050, #1152). What reaches the
 * database with it is covered over a real collection in `secured-write.test.ts`;
 * this pins which keys it inspects and which spellings it recognises on them.
 */

const config: OpenSaasConfig = {
  db: { provider: 'postgresql', timestamps: true },
  lists: {
    Category: { fields: { name: text() } },
    Post: {
      fields: {
        title: text(),
        // A list-only ref, so `Category` carries the synthetic back-relation
        // `from_Post_category` rather than a declared field.
        category: relationship({ ref: 'Category' }),
      },
    },
  },
}

const post = config.lists.Post
const category = config.lists.Category

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

    expect(thrown).toBeInstanceOf(RelationInputNotLoweredError)
    const message = (thrown as Error).message
    expect(message).not.toContain('`create`')
    expect(message).not.toContain('`connect`')
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

  it('refuses a synthetic key carrying relation input the engine cannot lower', () => {
    expect(() =>
      refuseNestedRelationInput('Category', category, config, {
        from_Post_category: { connect: { id: 'p1' } },
      }),
    ).toThrow(RelationInputNotLoweredError)
  })

  it('names the list, the field and the ticket when relation input is not lowered yet', () => {
    let thrown: unknown
    try {
      refuseNestedRelationInput('Post', post, config, {
        title: 't',
        category: { connect: { id: 'c1' } },
      })
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(RelationInputNotLoweredError)
    const message = (thrown as Error).message
    expect(message).toContain('"Post"')
    expect(message).toContain('"category"')
    expect(message).toContain('`connect`')
    expect(message).toContain('#1153')
    // The caller's own payload is never echoed back into the message.
    expect(message).not.toContain('c1')
  })

  it('refuses disconnect permanently, pointing at the null assignment that replaces it', () => {
    // ADR-0050 removes `disconnect` rather than deferring it: clearing an edge
    // is `null` on the same field. A message promising #1153 would name a
    // spelling that is not coming back.
    let thrown: unknown
    try {
      refuseNestedRelationInput('Post', post, config, { category: { disconnect: true } })
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(NestedRelationInputError)
    const message = (thrown as Error).message
    expect(message).toContain('`disconnect`')
    expect(message).toContain('`null`')
    expect(message).toContain('"category"')
    expect(message).not.toContain('#1153')
  })

  it('refuses a relation object that carries no spelling at all', () => {
    // `{ connect: cond ? { id } : undefined }` names nothing once the
    // conditional resolves, but a relationship key carries a foreign key or
    // `null` — never an object. Left alone it reaches the driver as `{}`.
    let thrown: unknown
    try {
      refuseNestedRelationInput('Post', post, config, { title: 't', category: {} })
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(RelationInputNotLoweredError)
    expect((thrown as Error).message).toContain('"category"')
  })

  it('leaves null on a relation key alone', () => {
    // `null` is what ADR-0050 makes the replacement for `disconnect`; the shape
    // refusal must not swallow it.
    expect(() => refuseNestedRelationInput('Post', post, config, { category: null })).not.toThrow()
  })

  it('reports the permanent refusal ahead of the temporary one', () => {
    // A payload spelling both gets the message that stays true after #1153.
    expect(() =>
      refuseNestedRelationInput('Post', post, config, {
        category: { connect: { id: 'c1' }, create: { name: 'c' } },
      }),
    ).toThrow(NestedRelationInputError)
  })
})
