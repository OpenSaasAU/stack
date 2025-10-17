import { Navigation } from "./Navigation.js";
import { Dashboard } from "./Dashboard.js";
import { ListView } from "./ListView.js";
import { ItemForm } from "./ItemForm.js";
import type { AdminContext, ServerActionInput } from "../server/types.js";

export interface AdminUIProps {
  context: AdminContext;
  params?: string[];
  basePath?: string;
  // Generic server action
  serverAction: (input: ServerActionInput) => Promise<any>;
}

/**
 * Main AdminUI component - complete admin interface with routing
 * Server Component
 *
 * Handles routing based on params array:
 * - [] → Dashboard
 * - [list] → ListView
 * - [list, 'create'] → ItemForm (create)
 * - [list, id] → ItemForm (edit)
 */
export function AdminUI({
  context,
  params = [],
  basePath = "/admin",
  serverAction,
}: AdminUIProps) {
  // Parse route from params
  const [listKey, action] = params;

  // Determine current path for navigation highlighting
  const currentPath = params.length > 0 ? `/${params.join("/")}` : "";

  // Route to appropriate component
  let content: React.ReactNode;

  if (!listKey) {
    // Dashboard
    content = <Dashboard context={context} basePath={basePath} />;
  } else if (action === "create") {
    // Create form
    content = (
      <ItemForm
        context={context}
        listKey={listKey}
        mode="create"
        basePath={basePath}
        serverAction={serverAction}
      />
    );
  } else if (action && action !== "create") {
    // Edit form (action is the item ID)
    content = (
      <ItemForm
        context={context}
        listKey={listKey}
        mode="edit"
        itemId={action}
        basePath={basePath}
        serverAction={serverAction}
      />
    );
  } else {
    // List view
    content = (
      <ListView context={context} listKey={listKey} basePath={basePath} />
    );
  }

  return (
    <div className="flex min-h-screen bg-background">
      <Navigation
        context={context}
        basePath={basePath}
        currentPath={currentPath}
      />
      <main className="flex-1 overflow-y-auto">{content}</main>
    </div>
  );
}
