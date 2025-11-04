import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Button } from '@opensaas/stack-ui/primitives'
import { getContext } from '@/.opensaas/context'
import type { Post } from '@/.opensaas/types'
import { PostEditor } from './PostEditor'
import config from '@/opensaas.config'

export default async function PostDetailPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  const context = await getContext()
  const fields = (await config).lists.Post.fields

  const post = (await context.db.post.findUnique({
    where: { id: params.id },
    include: { author: true },
  })) as Post

  if (!post) {
    notFound()
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card">
        <div className="container mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-bold">Composable Dashboard</h1>
            <nav className="flex gap-4">
              <Link href="/">
                <Button variant="ghost">Dashboard</Button>
              </Link>
              <Link href="/posts">
                <Button variant="ghost">Posts</Button>
              </Link>
              <Link href="/users">
                <Button variant="ghost">Users</Button>
              </Link>
            </nav>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-6 py-8 max-w-4xl">
        <div className="mb-6">
          <Link href="/posts">
            <Button variant="ghost" className="mb-4">
              ← Back to Posts
            </Button>
          </Link>
        </div>

        <PostEditor post={post} fields={fields} />
      </main>
    </div>
  )
}
