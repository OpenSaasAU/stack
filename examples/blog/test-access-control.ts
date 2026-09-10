/**
 * The blog's access-control suite: anonymous, author and non-author reads and
 * writes over every rule `opensaas.config.ts` declares, including the
 * field-level rules on `internalNotes`.
 *
 * Run with `pnpm test`, which is `opensaas dev -- tsx test-access-control.ts`:
 * the Dev database is up, generated and reconciled before the script starts,
 * and is stopped again when it exits. `DATABASE_URL` set points the whole
 * thing at a Postgres of your own instead, which is how CI runs it.
 *
 * The suite reads and writes through the same `getContext` a server action
 * uses — nothing here is a double. It clears the tables it owns before and
 * after a run, so it re-runs against a database a previous run left behind.
 */

import assert from 'node:assert/strict'
import { ValidationError } from '@opensaas/stack-core'
import { getContext } from './.opensaas/context.ts'

let checks = 0

async function check(label: string, assertion: () => void | Promise<void>): Promise<void> {
  await assertion()
  checks += 1
  console.log(`  ✓ ${label}`)
}

/**
 * Empty the tables this suite writes to, under `sudo()` — the rows belong to
 * users the suite invented, and no session it holds may delete another's.
 * Junction rows first: `PostTag` holds the foreign keys.
 *
 * `Settings` is a singleton and the engine refuses to delete one, so it is
 * restored to its declared defaults rather than removed.
 */
async function reset(): Promise<void> {
  const context = (await getContext()).sudo()

  for (const edge of await context.db.PostTag.all()) {
    await context.db.PostTag.delete({ where: { id: edge.id } })
  }
  for (const post of await context.db.Post.all()) {
    await context.db.Post.delete({ where: { id: post.id } })
  }
  for (const tag of await context.db.Tag.all()) {
    await context.db.Tag.delete({ where: { id: tag.id } })
  }
  for (const user of await context.db.User.all()) {
    await context.db.User.delete({ where: { id: user.id } })
  }

  const settings = await context.db.Settings.get()
  if (settings !== null) {
    await context.db.Settings.update({
      where: { id: settings.id },
      data: { siteName: 'My Blog', maintenanceMode: false, maxUploadSize: 10 },
    })
  }
}

async function run(): Promise<void> {
  const anonymous = await getContext()

  console.log('\nUsers — anyone may sign up')
  const alice = await anonymous.db.User.create({
    data: { name: 'Alice', email: 'alice@example.com', password: 'alice-secret' },
  })
  const bob = await anonymous.db.User.create({
    data: { name: 'Bob', email: 'bob@example.com', password: 'bob-secret' },
  })
  assert(alice !== null && bob !== null, 'User.create is open to anonymous callers')

  await check('a virtual field is computed on the row the write returns', () => {
    assert.equal(alice.displayName, 'Alice (alice@example.com)')
  })
  await check('the stored password is a hash that compares', async () => {
    assert.notEqual(String(alice.password), 'alice-secret')
    assert.equal(await alice.password.compare('alice-secret'), true)
    assert.equal(await alice.password.compare('not-alice-secret'), false)
  })

  const asAlice = await getContext({ userId: alice.id })
  const asBob = await getContext({ userId: bob.id })

  console.log('\nPost — the author writes')
  const draft = await asAlice.db.Post.create({
    data: {
      title: 'Notes on access control',
      slug: 'notes-on-access-control',
      content: 'Draft body.',
      internalNotes: 'TODO: add the diagram',
      author: { connect: { id: alice.id } },
    },
  })
  assert(draft !== null, 'the author may create a post')
  await check('the author reads back the internalNotes they wrote', () => {
    assert.equal(draft.internalNotes, 'TODO: add the diagram')
  })
  await check('the create left the draft unpublished', () => {
    assert.equal(draft.status, 'draft')
    assert.equal(draft.publishedAt, null)
  })

  console.log('\nPost — anonymous cannot write at all')
  await check('an anonymous create is denied silently', async () => {
    assert.equal(
      await anonymous.db.Post.create({ data: { title: 'Anonymous', slug: 'anonymous' } }),
      null,
    )
  })
  await check('an anonymous update is denied silently', async () => {
    assert.equal(
      await anonymous.db.Post.update({ where: { id: draft.id }, data: { title: 'Hijacked' } }),
      null,
    )
  })
  await check('an anonymous delete is denied silently', async () => {
    assert.equal(await anonymous.db.Post.delete({ where: { id: draft.id } }), null)
  })

  console.log('\nPost — a signed-in non-author')
  const bobsView = await asBob.db.Post.where({ id: { equals: draft.id } }).first()
  assert(bobsView !== null, 'a signed-in reader sees drafts')
  await check('the non-author reads the post’s public fields', () => {
    assert.equal(bobsView.title, 'Notes on access control')
    assert.equal(bobsView.content, 'Draft body.')
  })
  await check('internalNotes is stripped from the non-author’s row', () => {
    assert.equal(bobsView.internalNotes, undefined)
  })
  await check('the non-author’s update is denied silently', async () => {
    assert.equal(
      await asBob.db.Post.update({ where: { id: draft.id }, data: { title: 'Bob was here' } }),
      null,
    )
  })
  await check('the non-author’s write to internalNotes is denied silently', async () => {
    assert.equal(
      await asBob.db.Post.update({
        where: { id: draft.id },
        data: { internalNotes: 'Bob was here' },
      }),
      null,
    )
  })
  await check('the non-author’s delete is denied silently', async () => {
    assert.equal(await asBob.db.Post.delete({ where: { id: draft.id } }), null)
  })
  await check('none of those denials changed the row', async () => {
    const row = await asAlice.db.Post.where({ id: { equals: draft.id } }).first()
    assert.equal(row?.title, 'Notes on access control')
    assert.equal(row?.internalNotes, 'TODO: add the diagram')
  })

  console.log('\nPost — anonymous reads are scoped to published')
  await check('a draft is invisible to an anonymous reader', async () => {
    assert.equal(await anonymous.db.Post.where({ id: { equals: draft.id } }).first(), null)
    assert.deepEqual(await anonymous.db.Post.all(), [])
  })

  const published = await asAlice.db.Post.update({
    where: { id: draft.id },
    data: { status: 'published' },
  })
  assert(published !== null, 'the author may publish')
  await check('the resolveInput hook stamped publishedAt on the transition', () => {
    assert.notEqual(published.publishedAt, null)
  })

  const anonymousView = await anonymous.db.Post.where({ id: { equals: draft.id } }).first()
  assert(anonymousView !== null, 'a published post is visible to an anonymous reader')
  await check('the anonymous reader gets the public fields', () => {
    assert.equal(anonymousView.title, 'Notes on access control')
  })
  await check('internalNotes is stripped from the anonymous row too', () => {
    assert.equal(anonymousView.internalNotes, undefined)
  })

  console.log('\nPost — the author writes internalNotes')
  await check('the author’s write to internalNotes lands and reads back', async () => {
    const noted = await asAlice.db.Post.update({
      where: { id: draft.id },
      data: { internalNotes: 'Diagram added' },
    })
    assert.equal(noted?.internalNotes, 'Diagram added')
  })

  console.log('\nHooks — the validate hook refuses a title')
  await check('a spam title is a ValidationError, not a silent null', async () => {
    await assert.rejects(
      asAlice.db.Post.create({
        data: {
          title: 'Buy spam here',
          slug: 'buy-spam-here',
          author: { connect: { id: alice.id } },
        },
      }),
      (error: unknown) => error instanceof ValidationError,
    )
  })

  console.log('\nRelations — a to-one read is nullable and must be checked')
  await check('the included author carries its own virtual field', async () => {
    const withAuthor = await asAlice.db.Post.where({ id: { equals: draft.id } })
      .include('author')
      .first()
    assert.equal(withAuthor?.author?.displayName, 'Alice (alice@example.com)')
  })
  await check('a to-one cleared with null reads back as null', async () => {
    const cleared = await asAlice.db.Post.update({
      where: { id: draft.id },
      data: { author: null },
    })
    assert(cleared !== null)
    const orphan = await anonymous.db.Post.where({ id: { equals: draft.id } })
      .include('author')
      .first()
    assert.equal(orphan?.author, null)
    await asAlice.db.Post.update({
      where: { id: draft.id },
      data: { author: { connect: { id: alice.id } } },
    })
  })

  console.log('\nEdges — a many-to-many is a row of its own list')
  const tag = await asAlice.db.Tag.create({ data: { name: 'access-control' } })
  assert(tag !== null, 'a signed-in caller may create a tag')
  await check('an anonymous caller may not create a tag', async () => {
    assert.equal(await anonymous.db.Tag.create({ data: { name: 'anonymous' } }), null)
  })
  await check('the post reaches its tags through the junction rows', async () => {
    const edge = await asAlice.db.PostTag.create({
      data: { post: { connect: { id: draft.id } }, tag: { connect: { id: tag.id } } },
    })
    assert(edge !== null)
    const tagged = await asAlice.db.Post.where({ id: { equals: draft.id } })
      .include('tags')
      .first()
    assert.equal(tagged?.tags.length, 1)
  })

  console.log('\nProjection and aggregation')
  await check('a projected read returns the named fields and nothing else', async () => {
    const projected = await asAlice.db.Post.where({ id: { equals: draft.id } })
      .select('title', 'status')
      .first()
    assert.equal(projected?.title, 'Notes on access control')
    assert.equal(projected?.status, 'published')
    assert.equal('content' in (projected ?? {}), false)
  })
  await check('an aggregate counts only the rows the session may see', async () => {
    const { total } = await anonymous.db.Post.aggregate((aggregate) => ({
      total: aggregate.count(),
    }))
    assert.equal(total, 1)
  })

  console.log('\nSingleton — Settings')
  const settings = await asAlice.db.Settings.get()
  assert(settings !== null, 'get() auto-creates the singleton when there is none')
  await check('the singleton reads back its declared defaults', () => {
    assert.equal(settings.siteName, 'My Blog')
    assert.equal(settings.maintenanceMode, false)
    assert.equal(settings.maxUploadSize, 10)
  })
  await check('the singleton updates in place and get() returns the update', async () => {
    const updated = await asAlice.db.Settings.update({
      where: { id: settings.id },
      data: { siteName: 'Access Control Weekly', maintenanceMode: true },
    })
    assert.equal(updated?.siteName, 'Access Control Weekly')
    assert.equal(updated?.maintenanceMode, true)
    const again = await asAlice.db.Settings.get()
    assert.equal(again?.siteName, 'Access Control Weekly')
  })
}

async function main(): Promise<void> {
  await reset()
  try {
    await run()
    console.log(`\n✅ ${checks} checks passed`)
  } finally {
    await reset()
  }
}

main().catch((error: unknown) => {
  console.error('\n❌ Suite failed:', error)
  process.exitCode = 1
})
