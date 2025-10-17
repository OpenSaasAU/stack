import Link from "next/link";
import { ItemFormClient } from "./ItemFormClient.js";
import { formatListName } from "../lib/utils.js";
import type { AdminContext, ServerActionInput } from "../server/types.js";

export interface ItemFormProps {
  context: AdminContext;
  listKey: string;
  mode: "create" | "edit";
  itemId?: string;
  basePath?: string;
  // Generic server action
  serverAction: (input: ServerActionInput) => Promise<any>;
}

/**
 * Item form component - create or edit an item
 * Server Component that fetches data and sets up actions
 */
export async function ItemForm({
  context,
  listKey,
  mode,
  itemId,
  basePath = "/admin",
  serverAction,
}: ItemFormProps) {
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

  // Fetch item data if in edit mode
  let itemData: any = {};
  if (mode === "edit" && itemId) {
    try {
      const dbContext = context.context as any;
      itemData = await dbContext.db[listKey.toLowerCase()].findUnique({
        where: { id: itemId },
      });

      if (!itemData) {
        return (
          <div className="p-8">
            <div className="bg-destructive/10 border border-destructive text-destructive rounded-lg p-6">
              <h2 className="text-lg font-semibold mb-2">Item not found</h2>
              <p>
                The item you're trying to edit doesn't exist or you don't have
                access to it.
              </p>
              <Link
                href={`${basePath}/${listKey}`}
                className="inline-block mt-4 text-primary hover:underline"
              >
                ← Back to {formatListName(listKey)}
              </Link>
            </div>
          </div>
        );
      }
    } catch (error) {
      console.error(`Failed to fetch item ${itemId}:`, error);
      return (
        <div className="p-8">
          <div className="bg-destructive/10 border border-destructive text-destructive rounded-lg p-6">
            <h2 className="text-lg font-semibold mb-2">Error loading item</h2>
            <p>Failed to load the item. Please try again.</p>
          </div>
        </div>
      );
    }
  }

  // Fetch relationship options for all relationship fields
  const relationshipData: Record<string, Array<{ id: string; label: string }>> = {};
  for (const [fieldName, fieldConfig] of Object.entries(listConfig.fields)) {
    if ((fieldConfig as any).type === "relationship") {
      const ref = (fieldConfig as any).ref;
      if (ref) {
        // Parse ref format: "ListName.fieldName"
        const relatedListName = ref.split(".")[0];
        const relatedListConfig = context.config.lists[relatedListName];

        if (relatedListConfig) {
          try {
            const dbContext = context.context as any;
            const relatedItems = await dbContext.db[relatedListName.toLowerCase()].findMany({});

            // Use 'name' field as label if it exists, otherwise use 'id'
            relationshipData[fieldName] = relatedItems.map((item: any) => ({
              id: item.id,
              label: item.name || item.title || item.id,
            }));
          } catch (error) {
            console.error(`Failed to fetch relationship items for ${fieldName}:`, error);
            relationshipData[fieldName] = [];
          }
        }
      }
    }
  }

  return (
    <div className="p-8 max-w-4xl">
      {/* Header */}
      <div className="mb-8">
        <Link
          href={`${basePath}/${listKey}`}
          className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground mb-4"
        >
          <svg
            className="w-4 h-4 mr-1"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 19l-7-7 7-7"
            />
          </svg>
          Back to {formatListName(listKey)}
        </Link>
        <h1 className="text-3xl font-bold">
          {mode === "create" ? "Create" : "Edit"} {formatListName(listKey)}
        </h1>
      </div>

      {/* Form */}
      <div className="bg-card border border-border rounded-lg p-6">
        <ItemFormClient
          listKey={listKey}
          mode={mode}
          fields={Object.fromEntries(
            Object.entries(listConfig.fields).map(([key, field]) => [
              key,
              {
                type: (field as any).type,
                label: (field as any).label,
                options: (field as any).options,
                validation: (field as any).validation,
                defaultValue: (field as any).defaultValue,
                ref: (field as any).ref,
                many: (field as any).many,
              },
            ]),
          )}
          initialData={JSON.parse(JSON.stringify(itemData))}
          itemId={itemId}
          basePath={basePath}
          serverAction={serverAction}
          relationshipData={relationshipData}
        />
      </div>
    </div>
  );
}
