import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestContext, type TestContext } from '@opensaas/stack-core/testing'
import config from '../opensaas.config.js'
import type { Context } from '../.opensaas/types.js'

const BOOT = 120_000

function present<T>(value: T | null, what: string): T {
  if (value === null) throw new Error(`${what} returned null — denied, or not found`)
  return value
}

describe('Post.author is pinned to the session', () => {
  let harness: TestContext<Context>
  let aliceId: string
  let bobId: string

  beforeAll(async () => {
    harness = await createTestContext<Context>(await config, null)
    const admin = harness.context.sudo()
    const alice = present(
      await admin.db.User.create({
        data: { name: 'Alice', email: 'alice@example.com', emailVerified: false },
      }),
      'create alice',
    )
    const bob = present(
      await admin.db.User.create({
        data: { name: 'Bob', email: 'bob@example.com', emailVerified: false },
      }),
      'create bob',
    )
    aliceId = alice.id
    bobId = bob.id
  }, BOOT)

  afterAll(async () => {
    await harness?.close()
  })

  it('sets the author from the session on create', async () => {
    const alice = harness.context.withSession({ userId: aliceId })
    const post = present(
      await alice.db.Post.create({ data: { title: 'Mine', slug: 'mine' } }),
      'Post.create',
    )
    expect(post.authorId).toBe(aliceId)
  })

  it('refuses a caller-supplied author on create', async () => {
    const alice = harness.context.withSession({ userId: aliceId })
    await expect(
      alice.db.Post.create({
        data: { title: 'Spoof', slug: 'spoof', author: { connect: { id: bobId } } },
      }),
    ).rejects.toThrow(/field-level access denied/)
    const spoofed = await harness.context
      .sudo()
      .db.Post.where({ authorId: { equals: bobId } })
      .all()
    expect(spoofed).toEqual([])
  })

  it('does not let an author reassign a post on update', async () => {
    const alice = harness.context.withSession({ userId: aliceId })
    const post = present(
      await alice.db.Post.create({ data: { title: 'Stay', slug: 'stay' } }),
      'Post.create',
    )
    await expect(
      alice.db.Post.update({
        where: { id: post.id },
        data: { author: { connect: { id: bobId } } },
      }),
    ).rejects.toThrow(/field-level access denied/)
    const after = present(
      await harness.context
        .sudo()
        .db.Post.where({ id: { equals: post.id } })
        .first(),
      'Post read',
    )
    expect(after.authorId).toBe(aliceId)
  })
})
