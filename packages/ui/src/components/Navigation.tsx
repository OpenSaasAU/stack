import Link from "next/link";
import { formatListName } from "../lib/utils.js";
import type { AdminContext } from "../server/types.js";
import { getUrlKey } from "@opensaas/core";

export interface NavigationProps {
  context: AdminContext;
  basePath?: string;
  currentPath?: string;
}

/**
 * Navigation sidebar showing all lists
 * Server Component
 */
export function Navigation({
  context,
  basePath = "/admin",
  currentPath = "",
}: NavigationProps) {
  const lists = Object.keys(context.config.lists || {});

  return (
    <nav className="w-64 border-r border-border bg-card h-screen sticky top-0 flex flex-col">
      {/* Header */}
      <div className="p-6 border-b border-border">
        <Link href={basePath} className="block">
          <h1 className="text-xl font-bold">OpenSaaS Admin</h1>
        </Link>
      </div>

      {/* Navigation Links */}
      <div className="flex-1 overflow-y-auto p-4">
        <div className="space-y-1">
          <Link
            href={basePath}
            className={`block px-3 py-2 rounded-md text-sm font-medium transition-colors ${
              currentPath === ""
                ? "bg-primary text-primary-foreground"
                : "text-foreground hover:bg-accent hover:text-accent-foreground"
            }`}
          >
            Dashboard
          </Link>

          {lists.length > 0 && (
            <>
              <div className="pt-4 pb-2 px-3">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Lists
                </p>
              </div>
              {lists.map((listKey) => {
                const urlKey = getUrlKey(listKey);
                const isActive = currentPath.startsWith(`/${urlKey}`);
                return (
                  <Link
                    key={listKey}
                    href={`${basePath}/${urlKey}`}
                    className={`block px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                      isActive
                        ? "bg-primary text-primary-foreground"
                        : "text-foreground hover:bg-accent hover:text-accent-foreground"
                    }`}
                  >
                    {formatListName(listKey)}
                  </Link>
                );
              })}
            </>
          )}
        </div>
      </div>

      {/* Footer */}
      {context.session && (
        <div className="p-4 border-t border-border">
          <div className="flex items-center space-x-3">
            <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
              <span className="text-sm font-medium">
                {context.session.data?.name?.[0]?.toUpperCase() || "?"}
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">
                {context.session.data?.name || "User"}
              </p>
              <p className="text-xs text-muted-foreground truncate">
                {context.session.data?.email || ""}
              </p>
            </div>
          </div>
        </div>
      )}
    </nav>
  );
}
