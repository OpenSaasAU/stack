/**
 * Seed the dashboard with a demo author and a few posts.
 *
 * Run with `pnpm seed`, which is `opensaas dev -- tsx seed.ts`: the Dev
 * database is up and reconciled before this starts and stopped again when it
 * exits. `DATABASE_URL` set points it at a Postgres of your own instead.
 *
 * Re-runnable: it clears what it owns first, so a second run produces the same
 * three posts under fresh ids rather than duplicating them.
 */

import { getContext } from './.opensaas/context.ts'
import type { PostCreateInput } from './.opensaas/types.ts'

const AUTHOR = { name: 'Demo Author', email: 'demo@example.com', password: 'demo-password' }

const POSTS: Omit<PostCreateInput, 'author' | 'authorId'>[] = [
  {
    title: 'Composing an admin out of standalone components',
    slug: 'composing-an-admin',
    content: 'ItemCreateForm, ItemEditForm, ListTable and SearchBar, assembled by hand.',
    internalNotes: 'Link the design-system parity section from here.',
    status: 'published',
  },
  {
    title: 'Search runs inside the Where vocabulary',
    slug: 'search-inside-the-where-vocabulary',
    content: 'OR over two contains predicates, scoped by the same access rules as any read.',
    internalNotes: 'Mention that contains is case-insensitive.',
    status: 'published',
  },
  {
    title: 'A draft nobody has published yet',
    slug: 'a-draft-nobody-has-published-yet',
    content: 'Anonymous readers do not see this one.',
    internalNotes: 'Only the author reads this line.',
    status: 'draft',
  },
]

async function main(): Promise<void> {
  // The rows belong to a user this script invented, and no session it holds
  // may delete another's, so the teardown runs elevated.
  const elevated = (await getContext()).sudo()
  for (const post of await elevated.db.Post.all()) {
    await elevated.db.Post.delete({ where: { id: post.id } })
  }
  for (const user of await elevated.db.User.all()) {
    await elevated.db.User.delete({ where: { id: user.id } })
  }

  const anonymous = await getContext()
  const author = await anonymous.db.User.create({ data: AUTHOR })
  if (author === null) throw new Error('Could not create the demo author')

  const asAuthor = await getContext({ userId: author.id })
  for (const post of POSTS) {
    const created = await asAuthor.db.Post.create({
      data: { ...post, author: { connect: { id: author.id } } },
    })
    if (created === null) throw new Error(`Could not create "${post.title}"`)
    console.log(`  ✓ ${created.title}`)
  }

  console.log(`\nSeeded ${POSTS.length} posts for ${author.email}`)
}

main().catch((error: unknown) => {
  console.error('\n❌ Seed failed:', error)
  process.exitCode = 1
})
