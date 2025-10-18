import Link from "next/link";
import { Button, Card, CardContent, CardHeader, CardTitle } from "@opensaas/ui/primitives";
import { ListTable, SearchBar } from "@opensaas/ui/standalone";
import { prisma } from "../../lib/context";
import { CreatePostDialog } from "../../components/CreatePostDialog";

export default async function PostsPage({
  searchParams,
}: {
  searchParams: { search?: string };
}) {
  const search = searchParams.search || "";

  // Fetch posts with search
  const posts = await prisma.post.findMany({
    where: search
      ? {
          OR: [
            { title: { contains: search, mode: "insensitive" } },
            { content: { contains: search, mode: "insensitive" } },
          ],
        }
      : undefined,
    include: { author: true },
    orderBy: { createdAt: "desc" },
  });

  // Transform posts to include author name for display
  const postsWithAuthorName = posts.map((post) => ({
    ...post,
    authorName: post.author?.name || "Unknown",
  }));

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
          <form method="GET" action="/posts">
            <SearchBar
              defaultValue={search}
              onSearch={(query) => {
                // Form will handle submission
              }}
              onClear={() => {
                window.location.href = "/posts";
              }}
              placeholder="Search posts by title or content..."
            />
          </form>
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
                title: "text",
                authorName: "text",
                status: "select",
                createdAt: "timestamp",
              }}
              columns={["title", "authorName", "status", "createdAt"]}
              onRowClick={(post) => {
                window.location.href = `/posts/${post.id}`;
              }}
              sortable
              emptyMessage={
                search
                  ? `No posts found matching "${search}"`
                  : "No posts yet. Create one to get started!"
              }
            />
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
