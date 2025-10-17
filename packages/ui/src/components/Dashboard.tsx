import Link from "next/link";
import { formatListName } from "../lib/utils.js";
import type { AdminContext } from "../server/types.js";

export interface DashboardProps {
  context: AdminContext;
  basePath?: string;
}

/**
 * Dashboard landing page showing all available lists
 * Server Component
 */
export async function Dashboard({
  context,
  basePath = "/admin",
}: DashboardProps) {
  const lists = Object.keys(context.config.lists || {});

  // Get counts for each list
  const listCounts = await Promise.all(
    lists.map(async (listKey) => {
      try {
        const dbContext = context.context as any;
        const count = await dbContext.db[listKey.toLowerCase()]?.count();
        return { listKey, count: count || 0 };
      } catch (error) {
        console.error(`Failed to get count for ${listKey}:`, error);
        return { listKey, count: 0 };
      }
    }),
  );

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">Dashboard</h1>
        <p className="text-muted-foreground">Manage your application data</p>
      </div>

      {lists.length === 0 ? (
        <div className="bg-card border border-border rounded-lg p-12 text-center">
          <p className="text-muted-foreground">
            No lists configured. Add lists to your opensaas.config.ts to get
            started.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {listCounts.map(({ listKey, count }) => (
            <Link
              key={listKey}
              href={`${basePath}/${listKey}`}
              className="group bg-card border border-border rounded-lg p-6 hover:border-primary transition-colors"
            >
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h3 className="text-xl font-semibold mb-1 group-hover:text-primary transition-colors">
                    {formatListName(listKey)}
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    {count} {count === 1 ? "item" : "items"}
                  </p>
                </div>
                <div className="text-2xl">📋</div>
              </div>
              <div className="flex items-center text-sm text-primary">
                <span>View all</span>
                <svg
                  className="ml-1 w-4 h-4 group-hover:translate-x-1 transition-transform"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 5l7 7-7 7"
                  />
                </svg>
              </div>
            </Link>
          ))}
        </div>
      )}

      <div className="mt-12 bg-accent/50 border border-border rounded-lg p-6">
        <h2 className="text-lg font-semibold mb-2">Quick Actions</h2>
        <div className="space-y-2">
          {lists.map((listKey) => (
            <Link
              key={listKey}
              href={`${basePath}/${listKey}/create`}
              className="inline-flex items-center text-sm text-primary hover:underline mr-4"
            >
              <span className="mr-1">+</span>
              Create {formatListName(listKey)}
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
