import { describe, it, expectTypeOf } from 'vitest'
import { list } from './index.js'
import { text, timestamp, virtual } from '../fields/index.js'
import type {
  BaseFieldConfig,
  GetFieldValueType,
  TextField,
  TimestampField,
  TypeInfo,
  VirtualField,
} from './types.js'

/**
 * What a field-level hook is handed for a field's value.
 *
 * These assertions are checked by `tsc` over `src/**` (the package build),
 * not at runtime.
 */

/** The stored row `lists.ts` emits as `Item`: columns only (ADR-0027). */
type PostStoredRow = {
  id: string
  title: string
  publishedAt: Date | null
  badge: string
}

/**
 * A `TypeInfo` shaped exactly as `packages/cli/src/generator/lists.ts` emits
 * one: every `fields` entry is the field *interface*, on which `outputType` is
 * optional, and a field type core does not know is `BaseFieldConfig`. No entry
 * here declares an `outputType` statically, whatever the builder set at
 * runtime — which is why every stored field below resolves through `item`.
 */
type GeneratedTypeInfo = {
  key: 'Post'
  fields: {
    title: TextField<GeneratedTypeInfo>
    publishedAt: TimestampField<GeneratedTypeInfo>
    badge: BaseFieldConfig<GeneratedTypeInfo>
    wordCount: VirtualField<GeneratedTypeInfo>
  }
  item: PostStoredRow
  inputs: { create: unknown; update: unknown }
}

/** A field package's own type, which declares its face rather than inheriting it. */
type BadgeField<TTypeInfo extends TypeInfo> = BaseFieldConfig<TTypeInfo> & {
  type: 'badge'
  outputType: 'string'
}

/**
 * A hand-authored `TypeInfo` mixing a field whose static type declares
 * `outputType` with fields that do not — the record shape that made a
 * distributing resolution leak its marker type into the public hook signature.
 */
type MixedTypeInfo = {
  key: 'Post'
  fields: {
    title: TextField<MixedTypeInfo>
    publishedAt: TimestampField<MixedTypeInfo>
    badge: BadgeField<MixedTypeInfo>
  }
  item: PostStoredRow
  inputs: { create: unknown; update: unknown }
}

/** A hand-authored TypeInfo: no generated `item` facts to read a field from. */
type BareTypeInfo = {
  key: 'Post'
  fields: { title: TextField<BareTypeInfo> }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- what a hand-authored TypeInfo leaves `item` as
  item: any
  inputs: { create: unknown; update: unknown }
}

describe('GetFieldValueType', () => {
  it('types a stored field from the generated item', () => {
    expectTypeOf<GetFieldValueType<GeneratedTypeInfo, 'title'>>().toEqualTypeOf<string>()
    expectTypeOf<GetFieldValueType<GeneratedTypeInfo, 'publishedAt'>>().toEqualTypeOf<Date | null>()
    expectTypeOf<GetFieldValueType<GeneratedTypeInfo, 'badge'>>().toEqualTypeOf<string>()
  })

  /**
   * `lists.ts` emits `Fields` as the field interfaces, whose `outputType` is
   * optional, so a declared face never survives into a generated `TypeInfo`
   * and a computed field — absent from the stored row — has nothing left to
   * be typed from.
   */
  it('leaves a virtual field unknown through a generated TypeInfo', () => {
    expectTypeOf<GetFieldValueType<GeneratedTypeInfo, 'wordCount'>>().toEqualTypeOf<unknown>()
  })

  it('lets a statically declared outputType win over the stored column', () => {
    expectTypeOf<GetFieldValueType<MixedTypeInfo, 'badge'>>().toEqualTypeOf<string>()
  })

  /**
   * The sibling of a field that declares a face keeps its own type: the
   * resolution must not distribute across the record.
   */
  it('keeps a sibling of a declaring field on its own column type', () => {
    expectTypeOf<GetFieldValueType<MixedTypeInfo, 'publishedAt'>>().toEqualTypeOf<Date | null>()
  })

  /**
   * `BaseFieldConfig.hooks` cannot pin a field key, so `FieldHooks<TTypeInfo>`
   * instantiates this with every key on the list. Resolving that union would
   * type each field's hook by the whole row.
   */
  it('is unknown when the key names several fields', () => {
    expectTypeOf<
      GetFieldValueType<GeneratedTypeInfo, 'title' | 'publishedAt'>
    >().toEqualTypeOf<unknown>()
    expectTypeOf<GetFieldValueType<MixedTypeInfo, 'title' | 'badge'>>().toEqualTypeOf<unknown>()
  })

  it('falls back to unknown when the TypeInfo carries no item facts', () => {
    expectTypeOf<GetFieldValueType<BareTypeInfo, 'title'>>().toEqualTypeOf<unknown>()
  })
})

/**
 * The instantiation the config surface actually produces. A field builder's
 * `hooks` reach `FieldHooks<TTypeInfo>` with no key pinned, so this is the
 * only shape that exercises the union — and the one that regressed when the
 * resolution distributed over it.
 */
export const GeneratedPost = list<GeneratedTypeInfo>({
  fields: {
    title: text({
      hooks: { resolveOutput: ({ value }) => ({ formatted: String(value) }) },
    }),
    publishedAt: timestamp(),
    wordCount: virtual({ type: 'number', hooks: { resolveOutput: () => 1 } }),
  },
})

/** The same, over a record mixing in a field whose static type declares a face. */
export const MixedPost = list<MixedTypeInfo>({
  fields: {
    title: text({
      hooks: { resolveOutput: ({ value }) => ({ formatted: String(value) }) },
    }),
    publishedAt: timestamp({ hooks: { resolveOutput: () => new Date() } }),
  },
})
