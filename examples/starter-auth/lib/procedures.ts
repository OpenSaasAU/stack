import * as z from 'zod'
import type { ProcedureRegistry } from '@opensaas/stack-core/procedures'
import { procedure } from '@/.opensaas/procedures'
import type { Context } from '@/.opensaas/types'

const postOutput = z.object({
  id: z.string(),
  title: z.string(),
  slug: z.string(),
  status: z.enum(['draft', 'published']),
})

const notFound = { NOT_FOUND: 'Post not found, or you cannot change it' } as const

export const createPost = procedure({
  description: 'Create a draft post authored by the signed-in person',
  input: z.object({
    title: z.string().trim().min(1),
    slug: z.string().trim().min(1),
    content: z.string().optional(),
  }),
  output: postOutput,
  failures: { NOT_CREATED: 'The post was not created' },
  access: ({ session }) => session?.actor?.kind === 'human',
  expose: ['web'],
  run: async ({ input, context, fail }) => {
    const post = await context.db.Post.create({ data: input })
    if (post === null) throw fail('NOT_CREATED')
    return post
  },
})

export const updatePost = procedure({
  description: "Change a post's title, slug or content. Only its author can.",
  input: z.object({
    id: z.string(),
    title: z.string().trim().min(1).optional(),
    slug: z.string().trim().min(1).optional(),
    content: z.string().optional(),
  }),
  output: postOutput,
  failures: notFound,
  access: ({ session }) => session?.actor?.kind === 'human',
  expose: ['web'],
  run: async ({ input: { id, ...data }, context, fail }) => {
    const post = await context.db.Post.update({ where: { id }, data })
    if (post === null) throw fail('NOT_FOUND')
    return post
  },
})

export const publishPost = procedure({
  description: 'Publish a post. Only its author can.',
  input: z.object({ id: z.string() }),
  output: postOutput,
  failures: notFound,
  access: ({ session }) => session?.actor?.kind === 'human',
  expose: ['web'],
  run: async ({ input, context, fail }) => {
    const post = await context.db.Post.update({
      where: { id: input.id },
      data: { status: 'published' },
    })
    if (post === null) throw fail('NOT_FOUND')
    return post
  },
})

export const deletePost = procedure({
  description: 'Delete a post. Only its author can.',
  input: z.object({ id: z.string() }),
  output: z.object({ id: z.string() }),
  failures: notFound,
  access: ({ session }) => session?.actor?.kind === 'human',
  expose: ['web'],
  run: async ({ input, context, fail }) => {
    const post = await context.db.Post.delete({ where: { id: input.id } })
    if (post === null) throw fail('NOT_FOUND')
    return { id: post.id }
  },
})

export const procedures = {
  createPost,
  updatePost,
  publishPost,
  deletePost,
} satisfies ProcedureRegistry<Context>
