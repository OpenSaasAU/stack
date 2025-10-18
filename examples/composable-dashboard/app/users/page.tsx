import Link from "next/link";
import { Button, Card, CardContent, CardHeader, CardTitle } from "@opensaas/ui/primitives";
import { ListTable } from "@opensaas/ui/standalone";
import { getContext } from "../../lib/context";
import { connection } from "next/server";

export default async function UsersPage() {
  await connection();
  const context = await getContext();

  const users = await context.db.user.findMany({
    include: {
      posts: true,
    },
    orderBy: { createdAt: "desc" },
  });

  const usersWithPostCount = users.map((user) => ({
    ...user,
    postCount: user.posts?.length || 0,
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
        <div className="mb-6">
          <h2 className="text-3xl font-bold">Users</h2>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>All Users ({users.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <ListTable
              items={usersWithPostCount}
              fieldTypes={{
                name: "text",
                email: "text",
                postCount: "integer",
                createdAt: "timestamp",
              }}
              columns={["name", "email", "postCount", "createdAt"]}
              sortable
              emptyMessage="No users yet."
            />
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
