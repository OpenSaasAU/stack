"use client";

import * as React from "react";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatFieldName, getFieldDisplayValue } from "../lib/utils.js";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../primitives/table.js";
import { Input } from "../primitives/input.js";
import { Button } from "../primitives/button.js";
import { Card } from "../primitives/card.js";

export interface ListViewClientProps {
  items: any[];
  fieldTypes: Record<string, string>;
  columns?: string[];
  listKey: string;
  urlKey: string;
  basePath: string;
  page: number;
  pageSize: number;
  total: number;
  search?: string;
}

/**
 * Client component for interactive list table
 * Handles sorting, pagination, and row interactions
 */
export function ListViewClient({
  items,
  fieldTypes,
  columns,
  urlKey,
  basePath,
  page,
  pageSize,
  total,
  search: initialSearch,
}: ListViewClientProps) {
  const router = useRouter();
  const [sortBy, setSortBy] = useState<string | null>(null);
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");
  const [searchInput, setSearchInput] = useState(initialSearch || "");

  // Determine which columns to show
  const displayColumns =
    columns ||
    Object.keys(fieldTypes).filter((key) => !["password", "createdAt", "updatedAt"].includes(key));

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

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const params = new URLSearchParams();
    if (searchInput.trim()) {
      params.set("search", searchInput.trim());
    }
    params.set("page", "1"); // Reset to page 1 on new search
    router.push(`${basePath}/${urlKey}?${params.toString()}`);
  };

  const handleClearSearch = () => {
    setSearchInput("");
    router.push(`${basePath}/${urlKey}`);
  };

  const buildPaginationUrl = (newPage: number) => {
    const params = new URLSearchParams();
    if (initialSearch) {
      params.set("search", initialSearch);
    }
    params.set("page", newPage.toString());
    return `${basePath}/${urlKey}?${params.toString()}`;
  };

  return (
    <div className="space-y-4">
      {/* Search Bar */}
      <Card className="p-4">
        <form onSubmit={handleSearch} className="flex gap-2">
          <div className="flex-1 relative">
            <Input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search..."
              className="pr-10"
            />
            {searchInput && (
              <button
                type="button"
                onClick={handleClearSearch}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                ✕
              </button>
            )}
          </div>
          <Button type="submit">Search</Button>
        </form>
      </Card>

      {/* Table */}
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              {displayColumns.map((column) => (
                <TableHead
                  key={column}
                  className="cursor-pointer hover:bg-muted/70 transition-colors"
                  onClick={() => handleSort(column)}
                >
                  <div className="flex items-center space-x-1">
                    <span>{formatFieldName(column)}</span>
                    {sortBy === column && (
                      <span className="text-primary">{sortOrder === "asc" ? "↑" : "↓"}</span>
                    )}
                  </div>
                </TableHead>
              ))}
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedItems.length === 0 ? (
              <TableRow>
                <TableCell colSpan={displayColumns.length + 1} className="h-24 text-center">
                  No items found
                </TableCell>
              </TableRow>
            ) : (
              sortedItems.map((item) => (
                <TableRow key={item.id}>
                  {displayColumns.map((column) => (
                    <TableCell key={column}>
                      {getFieldDisplayValue(item[column], fieldTypes[column])}
                    </TableCell>
                  ))}
                  <TableCell className="text-right">
                    <Link
                      href={`${basePath}/${urlKey}/${item.id}`}
                      className="text-primary hover:underline"
                    >
                      Edit
                    </Link>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Showing {(page - 1) * pageSize + 1} to {Math.min(page * pageSize, total)} of {total}{" "}
            results
          </p>
          <div className="flex items-center space-x-2">
            <Button
              variant="outline"
              onClick={() => router.push(buildPaginationUrl(page - 1))}
              disabled={!hasPrevPage}
            >
              Previous
            </Button>
            <span className="text-sm text-muted-foreground">
              Page {page} of {totalPages}
            </span>
            <Button
              variant="outline"
              onClick={() => router.push(buildPaginationUrl(page + 1))}
              disabled={!hasNextPage}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
