import Link from 'next/link'
import { Button, Card, CardContent, CardHeader, CardTitle } from '@opensaas/stack-ui/primitives'
import { ListTable, SearchBar } from '@opensaas/stack-ui/standalone'
import { getContext } from '@/.opensaas/context'
import { CreatePostDialog } from '../../components/CreatePostDialog'

export default async function PostsPage(props: { searchParams: Promise<{ search?: string }> }) {
  const searchParams = await props.searchParams
  const search = searchParams.search || ''
  const context = getContext()

  // Fetch posts with search using context (access control applied)
  const posts = await context.db.post.findMany({
    where: search
      ? {
          OR: [{ title: { contains: search } }, { content: { contains: search } }],
        }
      : undefined,
    include: { author: true },
    orderBy: { createdAt: 'desc' },
  })

  // Transform posts to include author name for display
  const postsWithAuthorName = posts.map((post) => ({
    ...post,
    authorName: post.author?.name || 'Unknown',
  }))

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
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-3xl font-bold">Posts</h2>
          <CreatePostDialog />
        </div>

        {/* Search Bar */}
        <div className="mb-6">
          <SearchBar defaultValue={search} placeholder="Search posts by title or content..." />
        </div>

        {/* Posts Table */}
        <Card>
          <CardHeader>
            <CardTitle>All Posts ({posts.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <ListTable
              items={postsWithAuthorName}
              fieldTypes={{
                title: 'text',
                authorName: 'text',
                status: 'select',
                createdAt: 'timestamp',
              }}
              columns={['title', 'authorName', 'status', 'createdAt']}
              sortable
              emptyMessage={
                search
                  ? `No posts found matching "${search}"`
                  : 'No posts yet. Create one to get started!'
              }
            />
          </CardContent>
        </Card>
      </main>
    </div>
  )
}
