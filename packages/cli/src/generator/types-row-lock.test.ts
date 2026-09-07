import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { OpenSaasConfig } from '@opensaas/stack-core'
import { checkbox, relationship, text } from '@opensaas/stack-core/fields'
import {
  CONSUMER_PRELUDE,
  emitTypeFixture,
  type TypeFixture,
} from '../../tests/emit-type-fixture.js'

/**
 * The row lock on the surface a generated project actually gets (ADR-0047).
 *
 * `forUpdate()` outside a transaction has to be a compile error rather than a
 * throw — a lock taken outside one is released at the end of the statement
 * that took it, so it would compile, run, return rows and guard nothing. That
 * is a claim about the emitted bundle, not about core's internals, so it is
 * checked here: `.opensaas/types.ts` names two faces per list and the
 * transaction context is the one over the locking face.
 */

const config: OpenSaasConfig = {
  db: { provider: 'postgresql', timestamps: true },
  lists: {
    User: {
      fields: { name: text({ validation: { isRequired: true } }) },
    },
    Post: {
      fields: {
        title: text({ validation: { isRequired: true } }),
        published: checkbox({ defaultValue: false }),
        author: relationship({ ref: 'User' }),
      },
    },
    Settings: {
      isSingleton: true,
      fields: { siteName: text({ validation: { isRequired: true } }) },
    },
  },
}

describe('the row lock over the emitted contract', () => {
  let fixture: TypeFixture

  beforeAll(async () => {
    fixture = await emitTypeFixture('row-lock', config)
  }, 300_000)

  afterAll(() => {
    fixture?.cleanup()
  })

  it('carries forUpdate() inside a transaction and nowhere else', { timeout: 300_000 }, () => {
    const output = fixture.check(`${CONSUMER_PRELUDE}
import type { Context } from './.opensaas/types.ts'

declare const context: Context
declare const slotId: string

async function run() {
  await context.transaction(async (tx) => {
    // The documented gate: lock the contended parent, then count.
    const post = await tx.db.Post.where({ id: { equals: slotId } }).forUpdate().first()
    assertType<Exact<NonNullable<typeof post>['title'], string>>()

    // The modifier composes in any position and keeps the row type.
    const many = await tx.db.Post.forUpdate().where({ published: { equals: true } }).all()
    assertType<Exact<(typeof many)[number]['title'], string>>()

    // It survives a projection, which the row type still honours exactly.
    const projected = await tx.db.Post.select('title').forUpdate().all()
    assertType<Exact<keyof (typeof projected)[number], 'id' | 'createdAt' | 'updatedAt' | 'title'>>()

    await tx.advisoryLock('checkout:' + slotId)
  })

  // @ts-expect-error a lock outside a transaction guards nothing, so it is not on this surface
  await context.db.Post.where({ id: { equals: slotId } }).forUpdate().first()

  // @ts-expect-error nor after any other composition
  await context.db.Post.select('title').forUpdate().all()

  // @ts-expect-error advisoryLock is the transaction context's seat alone
  await context.advisoryLock('checkout')
}

void run
`)

    expect(output).toBe('')
  })

  it('keeps the lock off a singleton and off the reducing terminals', { timeout: 300_000 }, () => {
    const output = fixture.check(`${CONSUMER_PRELUDE}
import type { Context } from './.opensaas/types.ts'

declare const context: Context

async function run() {
  await context.transaction(async (tx) => {
    // @ts-expect-error a singleton carries no composed read, so no lock either
    tx.db.Settings.forUpdate

    // The transaction context is still a full context: sudo and withSession
    // answer in the same face, so a lock survives either.
    await tx.sudo().db.Post.forUpdate().all()
    await tx.withSession({ userId: 'u1' }).db.Post.forUpdate().all()

    // A nested transaction joins this one and hands back the same face.
    await tx.transaction(async (inner) => inner.db.Post.forUpdate().all())
  })
}

void run
`)

    expect(output).toBe('')
  })
})
