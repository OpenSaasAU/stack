/**
 * Test context.db operations with nested virtual fields
 * This demonstrates that virtual fields work in actual database operations
 *
 * A bare read (no `include`, no fragment `query`) returns the row's own
 * columns plus its virtual fields — never relations (ADR-0024). `select` is
 * also a documented no-op on `context.db` reads. So fetching `author` here
 * requires an explicit `include`.
 */

import type { Context } from './.opensaas/types'

// Example usage with context.db
async function testNestedVirtualFields(context: Context) {
  // This should type-check correctly with the fix
  const post = await context.db.post.findUnique({
    where: { id: '123' },
    include: {
      author: true,
    },
  })

  // The result type should include the virtual field
  if (post?.author) {
    const authorName: string = post.author.displayName // Type-safe!
    console.log('Author display name:', authorName)
  }

  // Test findMany with nested virtual fields
  const posts = await context.db.post.findMany({
    include: {
      author: true,
    },
  })

  // Type-safe access to nested virtual field
  posts.forEach((p) => {
    if (p.author) {
      const name: string = p.author.displayName
      console.log('Post by:', name)
    }
  })

  // Test create with nested include including virtual field
  const newPost = await context.db.post.create({
    data: {
      title: 'New Post',
      slug: 'new-post',
      content: 'Content here',
    },
    include: {
      author: true,
    },
  })

  if (newPost.author) {
    const authorName: string = newPost.author.displayName
    console.log('Created by:', authorName)
  }

  return { post, posts, newPost }
}

export { testNestedVirtualFields }

console.log('✅ All type checks passed for context.db with nested virtual fields!')
console.log('Virtual fields in nested relationships are now fully type-safe.')
