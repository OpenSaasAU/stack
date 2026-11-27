import Link from 'next/link'
import { getServerContext } from '@/lib/server'
import { NewPostForm } from './new-post-form'
import { PostControls } from './post-controls'

export const dynamic = 'force-dynamic'

export default async function PostsPage() {
  const context = await getServerContext()
  const posts = await context.db.Post.orderBy({ title: 'asc' }).all()
  const signedIn = context.session !== null

  return (
    <div className="mx-auto max-w-2xl space-y-8 p-8">
      <div className="flex items-baseline justify-between">
        <h1 className="text-3xl font-bold">Posts</h1>
        <Link href={signedIn ? '/admin' : '/sign-in'} className="text-sm text-blue-600">
          {signedIn ? 'Admin' : 'Sign in'}
        </Link>
      </div>

      {signedIn ? <NewPostForm /> : null}

      <ul className="space-y-4">
        {posts.map((post) => (
          <li
            key={post.id}
            className="rounded-lg border border-gray-200 p-4"
            data-post-slug={post.slug}
          >
            <PostControls id={post.id} title={post.title} status={post.status} />
          </li>
        ))}
      </ul>
      {posts.length === 0 ? <p className="text-gray-600">No posts yet.</p> : null}
    </div>
  )
}
