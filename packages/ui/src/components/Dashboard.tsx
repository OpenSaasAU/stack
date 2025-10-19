import Link from "next/link";
import { formatListName } from "../lib/utils.js";
import { AccessContext, getDbKey, getUrlKey, OpenSaaSConfig } from "@opensaas/core";
import { Card, CardContent, CardHeader, CardTitle } from "../primitives/card.js";

export interface DashboardProps<TPrisma> {
  context: AccessContext<TPrisma>;
  config: OpenSaaSConfig;
  basePath?: string;
}

/**
 * Dashboard landing page showing all available lists
 * Server Component
 */
export async function Dashboard<TPrisma>({
  context,
  config,
  basePath = "/admin",
}: DashboardProps<TPrisma>) {
  const lists = Object.keys(config.lists || {});

  // Get counts for each list
  const listCounts = await Promise.all(
    lists.map(async (listKey) => {
      try {
        const count = await context.db[getDbKey(listKey)]?.count();
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
        <Card className="p-12 text-center">
          <p className="text-muted-foreground">
            No lists configured. Add lists to your opensaas.config.ts to get started.
          </p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {listCounts.map(({ listKey, count }) => {
            const urlKey = getUrlKey(listKey);
            return (
              <Link key={listKey} href={`${basePath}/${urlKey}`}>
                <Card className="group hover:border-primary transition-colors cursor-pointer h-full">
                  <CardHeader>
                    <div className="flex items-start justify-between">
                      <div>
                        <CardTitle className="text-xl group-hover:text-primary transition-colors">
                          {formatListName(listKey)}
                        </CardTitle>
                        <p className="text-sm text-muted-foreground mt-1">
                          {count} {count === 1 ? "item" : "items"}
                        </p>
                      </div>
                      <div className="text-2xl">📋</div>
                    </div>
                  </CardHeader>
                  <CardContent>
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
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}

      <Card className="mt-12 bg-accent/50">
        <CardHeader>
          <CardTitle className="text-lg">Quick Actions</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {lists.map((listKey) => {
              const urlKey = getUrlKey(listKey);
              return (
                <Link
                  key={listKey}
                  href={`${basePath}/${urlKey}/create`}
                  className="inline-flex items-center text-sm text-primary hover:underline mr-4"
                >
                  <span className="mr-1">+</span>
                  Create {formatListName(listKey)}
                </Link>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
