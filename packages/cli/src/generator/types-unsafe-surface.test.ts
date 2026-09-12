import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { OpenSaasConfig } from '@opensaas/stack-core'
import { text } from '@opensaas/stack-core/fields'
import {
  CONSUMER_PRELUDE,
  emitTypeFixture,
  type TypeFixture,
} from '../../tests/emit-type-fixture.js'

/**
 * `context.unsafe.sql`/`.raw` typed through the app's own emitted contract
 * (#1206), against a real emitted contract.
 *
 * Before this fix, `Context`'s `unsafe` field was `UnsafeSurface` at its
 * generic default — `UnsafeCapableClient`, whose `sql`/`raw`/`orm` lanes are
 * declared `object` — so `context.unsafe.sql.public.User` was a compile
 * error ("Property 'public' does not exist on type 'object'") rather than
 * Prisma's own typed builder. `Context` now names the app's own
 * `PostgresClient<Contract>` as `StackContext`'s `TClient`, so the lanes
 * carry the real contract-keyed types with no cast and no `any`.
 *
 * The `@ts-expect-error` marker makes a zero-diagnostic compile the proof:
 * it must catch an error, and every other line must type-check.
 */

const config: OpenSaasConfig = {
  db: { provider: 'postgresql' },
  lists: {
    User: {
      fields: {
        name: text({ validation: { isRequired: true } }),
      },
    },
  },
}

describe('the Unsafe surface keyed to the emitted contract', () => {
  let fixture: TypeFixture

  beforeAll(async () => {
    fixture = await emitTypeFixture('unsafe-surface', config)
  }, 300_000)

  afterAll(() => {
    fixture?.cleanup()
  })

  it(
    'types `unsafe.sql`/`.raw` off the app’s own contract, on every context face',
    { timeout: 300_000 },
    () => {
      const output = fixture.check(`${CONSUMER_PRELUDE}
import type { BaseContext, Context, TransactionContext } from './.opensaas/types.ts'

declare const context: Context
declare const base: BaseContext
declare const tx: TransactionContext

async function run() {
  // Prisma's typed SQL builder, keyed to this app's contract: \`object\` (the
  // generic default) exposes no properties at all, so this compiles only
  // because \`Context\` names the app's own \`PostgresClient<Contract>\`.
  context.unsafe.sql.public.User.select('id').build()
  base.unsafe.sql.public.User.select('id').build()
  tx.unsafe.sql.public.User.select('id').build()

  // Prisma's raw tag, likewise untyped as \`object\` before this fix — calling
  // it as a tagged template would not have compiled.
  context.unsafe.raw.sql\`UPDATE "public"."User" SET "name" = "name"\`.affectedCount().build()

  // @ts-expect-error the contract has no "NotAList" table
  context.unsafe.sql.public.NotAList
}
`)

      expect(output).toBe('')
    },
  )
})
