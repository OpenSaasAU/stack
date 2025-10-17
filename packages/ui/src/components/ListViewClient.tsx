"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatFieldName, getFieldDisplayValue, cn } from "../lib/utils.js";

export interface ListViewClientProps {
  items: any[];
  fieldTypes: Record<string, string>;
  columns?: string[];
  listKey: string;
  basePath: string;
  page: number;
  pageSize: number;
  total: number;
}

/**
 * Client component for interactive list table
 * Handles sorting, pagination, and row interactions
 */
export function ListViewClient({
  items,
  fieldTypes,
  columns,
  listKey,
  basePath,
  page,
  pageSize,
  total,
}: ListViewClientProps) {
  const router = useRouter();
  const [sortBy, setSortBy] = useState<string | null>(null);
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");

  // Determine which columns to show
  const displayColumns =
    columns ||
    Object.keys(fieldTypes).filter(
      (key) => !["password", "createdAt", "updatedAt"].includes(key),
    );

  // Sort items if needed
  const sortedItems = [...items];
  if (sortBy) {
    sortedItems.sort((a, b) => {
      const aVal = a[sortBy];
      const bVal = b[sortBy];
      if (aVal === bVal) return 0;
      const comparison = aVal > bVal ? 1 : -1;
      return sortOrder === "asc" ? comparison : -comparison;
    });
  }

  const totalPages = Math.ceil(total / pageSize);
  const hasNextPage = page < totalPages;
  const hasPrevPage = page > 1;

  const handleSort = (column: string) => {
    if (sortBy === column) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    } else {
      setSortBy(column);
      setSortOrder("asc");
    }
  };

  return (
    <div className="space-y-4">
      {/* Table */}
      <div className="bg-card border border-border rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-muted/50 border-b border-border">
              <tr>
                {displayColumns.map((column) => (
                  <th
                    key={column}
                    className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider cursor-pointer hover:bg-muted/70 transition-colors"
                    onClick={() => handleSort(column)}
                  >
                    <div className="flex items-center space-x-1">
                      <span>{formatFieldName(column)}</span>
                      {sortBy === column && (
                        <span className="text-primary">
                          {sortOrder === "asc" ? "↑" : "↓"}
                        </span>
                      )}
                    </div>
                  </th>
                ))}
                <th className="px-6 py-3 text-right text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {sortedItems.length === 0 ? (
                <tr>
                  <td
                    colSpan={displayColumns.length + 1}
                    className="px-6 py-12 text-center text-muted-foreground"
                  >
                    No items found
                  </td>
                </tr>
              ) : (
                sortedItems.map((item) => (
                  <tr
                    key={item.id}
                    className="hover:bg-muted/30 transition-colors"
                  >
                    {displayColumns.map((column) => (
                      <td
                        key={column}
                        className="px-6 py-4 text-sm text-foreground"
                      >
                        {getFieldDisplayValue(item[column], fieldTypes[column])}
                      </td>
                    ))}
                    <td className="px-6 py-4 text-sm text-right">
                      <Link
                        href={`${basePath}/${listKey}/${item.id}`}
                        className="text-primary hover:underline"
                      >
                        Edit
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Showing {(page - 1) * pageSize + 1} to{" "}
            {Math.min(page * pageSize, total)} of {total} results
          </p>
          <div className="flex items-center space-x-2">
            <button
              onClick={() =>
                router.push(`${basePath}/${listKey}?page=${page - 1}`)
              }
              disabled={!hasPrevPage}
              className={cn(
                "px-4 py-2 text-sm font-medium rounded-md border border-border",
                hasPrevPage
                  ? "bg-background hover:bg-accent text-foreground"
                  : "bg-muted text-muted-foreground cursor-not-allowed",
              )}
            >
              Previous
            </button>
            <span className="text-sm text-muted-foreground">
              Page {page} of {totalPages}
            </span>
            <button
              onClick={() =>
                router.push(`${basePath}/${listKey}?page=${page + 1}`)
              }
              disabled={!hasNextPage}
              className={cn(
                "px-4 py-2 text-sm font-medium rounded-md border border-border",
                hasNextPage
                  ? "bg-background hover:bg-accent text-foreground"
                  : "bg-muted text-muted-foreground cursor-not-allowed",
              )}
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
