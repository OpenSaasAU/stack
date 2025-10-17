import Link from "next/link";
import { ListViewClient } from "./ListViewClient.js";
import { formatListName } from "../lib/utils.js";
import type { AdminContext } from "../server/types.js";
import { getDbKey, getUrlKey } from "@opensaas/core";

export interface ListViewProps {
  context: AdminContext;
  listKey: string;
  basePath?: string;
  columns?: string[];
  page?: number;
  pageSize?: number;
  search?: string;
}

/**
 * List view component - displays items in a table
 * Server Component that fetches data and renders client table
 */
export async function ListView({
  context,
  listKey,
  basePath = "/admin",
  columns,
  page = 1,
  pageSize = 50,
  search,
}: ListViewProps) {
  const key = getDbKey(listKey);
  const urlKey = getUrlKey(listKey);
  const listConfig = context.config.lists[listKey];

  if (!listConfig) {
    return (
      <div className="p-8">
        <div className="bg-destructive/10 border border-destructive text-destructive rounded-lg p-6">
          <h2 className="text-lg font-semibold mb-2">List not found</h2>
          <p>The list "{listKey}" does not exist in your configuration.</p>
        </div>
      </div>
    );
  }

  // Fetch items using access-controlled context
  const skip = (page - 1) * pageSize;
  let items: any[] = [];
  let total = 0;

  try {
    const dbContext = context.context.db;
    if (!dbContext || !dbContext[key]) {
      throw new Error(`Context for ${listKey} not found`);
    }

    // Build search filter if search term provided
    let where: any = undefined;
    if (search && search.trim()) {
      // Find all text fields to search across
      const searchableFields = Object.entries(listConfig.fields)
        .filter(([_, field]) => (field as any).type === 'text')
        .map(([fieldName]) => fieldName);

      if (searchableFields.length > 0) {
        where = {
          OR: searchableFields.map(fieldName => ({
            [fieldName]: {
              contains: search.trim(),
            },
          })),
        };
      }
    }

    [items, total] = await Promise.all([
      dbContext[key].findMany({
        where,
        skip,
        take: pageSize,
      }),
      dbContext[key].count({ where }),
    ]);
  } catch (error) {
    console.error(`Failed to fetch ${listKey}:`, error);
  }

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold mb-2">{formatListName(listKey)}</h1>
          <p className="text-muted-foreground">
            {total} {total === 1 ? "item" : "items"}
          </p>
        </div>
        <Link
          href={`${basePath}/${urlKey}/create`}
          className="inline-flex items-center px-4 py-2 bg-primary text-primary-foreground rounded-md font-medium hover:bg-primary/90 transition-colors"
        >
          <span className="mr-2">+</span>
          Create {formatListName(listKey)}
        </Link>
      </div>

      {/* Client Table */}
      <ListViewClient
        items={items || []}
        fieldTypes={Object.fromEntries(
          Object.entries(listConfig.fields).map(([key, field]) => [
            key,
            (field as any).type,
          ]),
        )}
        columns={columns}
        listKey={listKey}
        urlKey={urlKey}
        basePath={basePath}
        page={page}
        pageSize={pageSize}
        total={total || 0}
        search={search}
      />
    </div>
  );
}
