import { describe, it, expectTypeOf } from 'vitest'
import type { AccessControlledDB } from '../access/types.js'
import type { HookDb } from './types.js'

/**
 * What a hook's `context.db` resolves to, in the three shapes `TTypeInfo` can
 * take. These assertions are checked by `tsc` over `src/**` (the package
 * build), not at runtime.
 */

/** A hand-authored `TypeInfo`: no `db` member at all (the third-party-field pattern). */
type BareTypeInfo = {
  key: 'Post'
  fields: { title: unknown }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- what a hand-authored TypeInfo leaves `item` as
  item: any
  inputs: { create: unknown; update: unknown }
}

/** The app's own generated `DB` surface, standing in for `Lists.<List>.TypeInfo['db']`. */
interface GeneratedDB {
  Post: { where: (args: unknown) => unknown }
  Comment: { where: (args: unknown) => unknown }
}

/** A `TypeInfo` shaped exactly as `packages/cli/src/generator/lists.ts` emits one. */
type GeneratedTypeInfo = {
  key: 'Post'
  fields: { title: unknown }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- item's shape is irrelevant to HookDb
  item: any
  inputs: { create: unknown; update: unknown }
  db: GeneratedDB
}

describe('HookDb', () => {
  it('falls back to AccessControlledDB when the TypeInfo carries no db member', () => {
    expectTypeOf<HookDb<BareTypeInfo>>().toEqualTypeOf<AccessControlledDB>()
  })

  /**
   * `OpenSaasConfig['lists']` is `Record<string, ListConfig<any>>` — the
   * untyped `list({ ... })` shape most hooks are still written under, where
   * `TTypeInfo` resolves to bare `any`. `HookDb` must not let that poison
   * `context.db` to `any`: a caller reading `context.db.Post` off it would
   * lose `noImplicitAny` protection on anything they do with the result,
   * exactly the silent regression #1213 closed for the typed path.
   */
  it('falls back to AccessControlledDB for the untyped list() shape (TTypeInfo = any)', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- reproducing the untyped list({...}) shape, whose TTypeInfo resolves to bare `any`
    expectTypeOf<HookDb<any>>().toEqualTypeOf<AccessControlledDB>()
  })

  it('reads the generated db surface off a real Lists.<List>.TypeInfo', () => {
    expectTypeOf<HookDb<GeneratedTypeInfo>>().toEqualTypeOf<GeneratedDB>()
  })
})
