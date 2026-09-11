import Link from 'next/link'
import { Button, Card, CardContent, CardHeader, CardTitle } from '@opensaas/stack-ui/primitives'
import { ListTable, SearchBar } from '@opensaas/stack-ui/standalone'
import { config, getContext } from '@/.opensaas/context'
import { demoSession } from '../../lib/demo-session'
import { CreatePostDialog } from '../../components/CreatePostDialog'
import { serializeFieldConfigs } from '@opensaas/stack-ui/server'

export default async function PostsPage(props: { searchParams: Promise<{ search?: string }> }) {
  const searchParams = await props.searchParams
  const search = searchParams.search || ''
  const context = await getContext(await demoSession())

  // Fetch posts with search using context (access control applied). `OR` and
  // `contains` are both in the Where vocabulary, so the predicate is unchanged
  // from Prisma 7; only the call shape moved to the composed read.
  // The included author is projected to the one column the table shows: an
  // unprojected row carries `password`, which reads as a `HashedPassword` and
  // is not something a Client Component may be handed.
  const listing = context.db.Post.orderBy({ createdAt: 'desc' }).include('author', (author) =>
    author.select('name'),
  )
  const posts = await (
    search
      ? listing.where({ OR: [{ title: { contains: search } }, { content: { contains: search } }] })
      : listing
  ).all()

  // Transform posts to include author name for display. The included to-one is
  // `Row | null` whether or not its column is nullable, so it is null-checked.
  const postsWithAuthorName = posts.map((post) => ({
    ...post,
    authorName: post.author?.name ?? 'Unknown',
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
          <CreatePostDialog fields={serializeFieldConfigs((await config).lists.Post.fields)} />
        </div>

        {/* Search Bar — structured classNames slots (issue #709) let us tune a
            single part (widen the input) without forking the component. */}
        <div className="mb-6">
          <SearchBar
            defaultValue={search}
            placeholder="Search posts by title or content..."
            classNames={{ input: 'h-11' }}
          />
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
              // Structured per-part classNames slots (issue #709) — restyle
              // individual table parts without forking the composite.
              classNames={{
                frame: 'shadow-sm',
                headerCell: 'uppercase text-xs tracking-wide',
                row: 'hover:bg-accent/40',
              }}
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
