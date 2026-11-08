import { describe, it, expectTypeOf } from 'vitest'
import type { AccessContext, AccessControlledDB } from '../access/types.js'
import type { PresetView } from './types.js'

interface GeneratedDB {
  Post: { where: (args: unknown) => unknown }
  Team: { where: (args: unknown) => unknown }
}

type GeneratedTypeInfo = {
  key: 'Post'
  fields: { title: unknown }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- item's shape is irrelevant to the preset's context
  item: any
  inputs: { create: unknown; update: unknown }
  db: GeneratedDB
}

type SearchContext<T extends PresetView<GeneratedTypeInfo> | PresetView> =
  Exclude<T['search'], string> extends (args: infer TArgs) => unknown
    ? TArgs extends { context: infer TContext }
      ? TContext
      : never
    : never

type GateContext<T extends PresetView<GeneratedTypeInfo> | PresetView> =
  NonNullable<T['hasAccess']> extends (args: infer TArgs) => unknown
    ? TArgs extends { context: infer TContext }
      ? TContext
      : never
    : never

describe('PresetView<TTypeInfo>', () => {
  it('types search and hasAccess context by the list TypeInfo', () => {
    expectTypeOf<SearchContext<PresetView<GeneratedTypeInfo>>>().toEqualTypeOf<
      AccessContext<GeneratedDB>
    >()
    expectTypeOf<GateContext<PresetView<GeneratedTypeInfo>>>().toEqualTypeOf<
      AccessContext<GeneratedDB>
    >()
  })

  it('falls back to AccessControlledDB without a TypeInfo', () => {
    expectTypeOf<SearchContext<PresetView>>().toEqualTypeOf<AccessContext<AccessControlledDB>>()
    expectTypeOf<GateContext<PresetView>>().toEqualTypeOf<AccessContext<AccessControlledDB>>()
  })
})
