import { describe, it, expectTypeOf } from 'vitest'
import { text } from '../fields/index.js'
import type { GetFieldValueType } from './types.js'

/**
 * What a field-level hook is handed for a field's value.
 *
 * A field declaring `outputType` is typed by it. Every other stored field is
 * typed by its contract column (ADR-0052), which reaches this type as the
 * generated `Lists.<List>.Item`'s property — not as `unknown`, which would
 * put an open type on `FieldHooks`' public surface.
 *
 * These assertions are checked by `tsc` over `src/**` (the package build),
 * not at runtime.
 */
type Item = {
  id: string
  title: string
  publishedAt: Date | null
  archivedAt: string
}

type PostTypeInfo = {
  key: 'Post'
  fields: {
    title: ReturnType<typeof text>
    publishedAt: ReturnType<typeof text>
    archivedAt: { type: 'timestamp'; outputType: 'Date' }
    wordCount: { type: 'virtual'; outputType: 'number' }
  }
  item: Item
  inputs: { create: unknown; update: unknown }
}

/** A hand-authored TypeInfo: no generated `item` facts to read a field from. */
type BareTypeInfo = {
  key: 'Post'
  fields: { title: ReturnType<typeof text> }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- what a hand-authored TypeInfo leaves `item` as
  item: any
  inputs: { create: unknown; update: unknown }
}

describe('GetFieldValueType', () => {
  it('types a stored field from the generated item', () => {
    expectTypeOf<GetFieldValueType<PostTypeInfo, 'title'>>().toEqualTypeOf<string>()
    expectTypeOf<GetFieldValueType<PostTypeInfo, 'publishedAt'>>().toEqualTypeOf<Date | null>()
  })

  it('lets a declared outputType win over the stored column', () => {
    expectTypeOf<GetFieldValueType<PostTypeInfo, 'archivedAt'>>().toEqualTypeOf<Date>()
  })

  it('types a computed field, which the item does not carry, from its outputType', () => {
    expectTypeOf<GetFieldValueType<PostTypeInfo, 'wordCount'>>().toEqualTypeOf<number>()
  })

  it('falls back to unknown when the TypeInfo carries no item facts', () => {
    expectTypeOf<GetFieldValueType<BareTypeInfo, 'title'>>().toEqualTypeOf<unknown>()
  })
})
