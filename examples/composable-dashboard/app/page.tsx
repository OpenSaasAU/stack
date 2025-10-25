import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@opensaas/stack-ui/primitives'
import { Button } from '@opensaas/stack-ui/primitives'
import { getContext } from '@/.opensaas/context'
import { CreatePostDialog } from '../components/CreatePostDialog'
import { connection } from 'next/server'

export default async function HomePage() {
  await connection()
  // Use context for access-controlled queries
  const context = getContext()

  // Get stats (using Prisma directly for counts is fine)
  const [totalPosts, publishedPosts, draftPosts, totalUsers] = await Promise.all([
    context.db.post.count(),
    context.db.post.count({ where: { status: 'published' } }),
    context.db.post.count({ where: { status: 'draft' } }),
    context.db.user.count(),
  ])

  // Get recent posts using context (access control applied)
  const recentPosts = await context.db.post.findMany({
    take: 5,
    orderBy: { createdAt: 'desc' },
    include: { author: true },
  })

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
      <main className="container mx-auto px-6 py-8">
        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Total Posts
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold">{totalPosts}</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Published</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold text-green-600">{publishedPosts}</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Drafts</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold text-yellow-600">{draftPosts}</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Users</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold">{totalUsers}</p>
            </CardContent>
          </Card>
        </div>

        {/* Quick Actions & Recent Posts */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Quick Actions */}
          <Card>
            <CardHeader>
              <CardTitle>Quick Actions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <CreatePostDialog />
              <Link href="/posts" className="block">
                <Button variant="outline" className="w-full">
                  View All Posts
                </Button>
              </Link>
              <Link href="/users" className="block">
                <Button variant="outline" className="w-full">
                  Manage Users
                </Button>
              </Link>
            </CardContent>
          </Card>

          {/* Recent Posts */}
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Recent Posts</CardTitle>
            </CardHeader>
            <CardContent>
              {recentPosts.length === 0 ? (
                <p className="text-muted-foreground text-center py-8">
                  No posts yet. Create one to get started!
                </p>
              ) : (
                <div className="space-y-4">
                  {recentPosts.map((post) => (
                    <Link
                      key={post.id}
                      href={`/posts/${post.id}`}
                      className="block border border-border rounded-lg p-4 hover:bg-accent transition-colors"
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <h3 className="font-semibold">{post.title}</h3>
                          <p className="text-sm text-muted-foreground mt-1">
                            by {post.author?.name || 'Unknown'} •{' '}
                            {new Date(post.createdAt).toLocaleDateString()}
                          </p>
                        </div>
                        <span
                          className={`px-2 py-1 text-xs font-medium rounded ${
                            post.status === 'published'
                              ? 'bg-green-100 text-green-800'
                              : 'bg-yellow-100 text-yellow-800'
                          }`}
                        >
                          {post.status}
                        </span>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  )
}
