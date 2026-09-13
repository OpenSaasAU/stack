import { describe, it, expectTypeOf } from 'vitest'
import { list } from './index.js'
import { text, timestamp, virtual } from '../fields/index.js'
import type {
  BaseFieldConfig,
  FieldKeys,
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
 * one: every `fields` entry is the field *interface*, pinned to its own key
 * (issue #1306) — the second type argument `lists.ts` now emits alongside
 * `Lists.<List>.TypeInfo`. No entry here declares an `outputType` statically,
 * whatever the builder set at runtime — which is why every stored field below
 * resolves through `item`.
 */
type GeneratedTypeInfo = {
  key: 'Post'
  fields: {
    title: TextField<GeneratedTypeInfo, 'title'>
    publishedAt: TimestampField<GeneratedTypeInfo, 'publishedAt'>
    badge: BaseFieldConfig<GeneratedTypeInfo, 'badge'>
    wordCount: VirtualField<GeneratedTypeInfo, 'wordCount'>
  }
  item: PostStoredRow
  inputs: { create: unknown; update: unknown }
}

/**
 * The same, with no computed field. A virtual key contributes `unknown` to any
 * union it appears in, which would mask a resolution that distributed over the
 * rest — so the surface assertions below run over a list whose every field has
 * a column.
 */
type GeneratedStoredTypeInfo = {
  key: 'Post'
  fields: {
    title: TextField<GeneratedStoredTypeInfo, 'title'>
    publishedAt: TimestampField<GeneratedStoredTypeInfo, 'publishedAt'>
    badge: BaseFieldConfig<GeneratedStoredTypeInfo, 'badge'>
  }
  item: PostStoredRow
  inputs: { create: unknown; update: unknown }
}

/** A field package's own type, which declares its face rather than inheriting it. */
type BadgeField<
  TTypeInfo extends TypeInfo,
  TKey extends FieldKeys<TTypeInfo['fields']> = FieldKeys<TTypeInfo['fields']>,
> = BaseFieldConfig<TTypeInfo, TKey> & {
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
    title: TextField<MixedTypeInfo, 'title'>
    publishedAt: TimestampField<MixedTypeInfo, 'publishedAt'>
    badge: BadgeField<MixedTypeInfo, 'badge'>
  }
  item: PostStoredRow
  inputs: { create: unknown; update: unknown }
}

/** A hand-authored TypeInfo: no generated `item` facts to read a field from. */
type BareTypeInfo = {
  key: 'Post'
  fields: { title: TextField<BareTypeInfo, 'title'> }
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
   * A field named with several keys at once has no single field to be
   * precise about — the fallback `FieldHooks<TTypeInfo>` (no key of its own)
   * still needs, e.g. a third-party field that hasn't threaded
   * {@link BaseFieldConfig}'s `TKey` through.
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
 * The instantiation the config surface actually produces:
 * `list<Lists.Post.TypeInfo>({ fields: { title: text({ hooks: {...} }) } })`.
 * `FieldsWithTypeInfo` (issue #1306) pins each field's own key before a
 * builder's `hooks` ever reach `FieldHooks`, so a field-level `resolveOutput`
 * sees the real column type rather than the whole row.
 */
describe("a field builder's hooks through the config surface", () => {
  it('types a stored field precisely, and rejects the wrong return type', () => {
    void list<GeneratedStoredTypeInfo>({
      fields: {
        title: text({
          hooks: {
            resolveOutput: ({ value }) => {
              expectTypeOf(value).toEqualTypeOf<string>()
              return value.toUpperCase()
            },
          },
        }),
        publishedAt: timestamp({
          hooks: {
            resolveOutput: ({ value }) => {
              expectTypeOf(value).toEqualTypeOf<Date | null>()
              return value
            },
          },
        }),
        badge: text({
          hooks: {
            // @ts-expect-error -- a Date is not this field's stored `string`
            resolveOutput: () => new Date(),
          },
        }),
      },
    })
  })

  it('leaves a virtual field unknown, since a generated TypeInfo carries no static face for it', () => {
    void list<GeneratedTypeInfo>({
      fields: {
        title: text(),
        publishedAt: timestamp(),
        badge: text(),
        wordCount: virtual({
          type: 'number',
          hooks: {
            resolveOutput: ({ value }) => {
              expectTypeOf(value).toEqualTypeOf<unknown>()
              return 1
            },
          },
        }),
      },
    })
  })

  it('lets a statically declared outputType win over the stored column', () => {
    void list<MixedTypeInfo>({
      fields: {
        title: text(),
        publishedAt: timestamp({
          hooks: {
            resolveOutput: ({ value }) => {
              expectTypeOf(value).toEqualTypeOf<Date | null>()
              return value
            },
          },
        }),
        badge: {
          type: 'badge',
          outputType: 'string',
          hooks: {
            resolveOutput: ({ value }) => {
              expectTypeOf(value).toEqualTypeOf<string>()
              return value.toUpperCase()
            },
          },
        },
      },
    })
  })
})
