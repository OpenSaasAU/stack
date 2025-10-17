import type {
  AccessControl,
  Session,
  AccessContext,
  PrismaFilter,
} from "./types.js";
import type { FieldAccess } from "./types.js";
import type { OpenSaaSConfig, ListConfig, FieldConfig } from "../config/types.js";

/**
 * Check if access control result is a boolean
 */
export function isBoolean(value: any): value is boolean {
  return typeof value === "boolean";
}

/**
 * Check if access control result is a Prisma filter
 */
export function isPrismaFilter(value: any): value is PrismaFilter {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Parse a relationship ref and get the related list configuration
 * Relationship refs are in the format "ListName.fieldName"
 *
 * @param relationshipRef - The ref string (e.g., "Post.author")
 * @param config - The OpenSaaS configuration
 * @returns The related list name and config, or null if not found
 */
export function getRelatedListConfig(
  relationshipRef: string,
  config: OpenSaaSConfig,
): { listName: string; listConfig: ListConfig } | null {
  // Parse ref format: "ListName.fieldName"
  const parts = relationshipRef.split(".");
  if (parts.length !== 2) {
    return null;
  }

  const listName = parts[0];
  const listConfig = config.lists[listName];

  if (!listConfig) {
    return null;
  }

  return { listName, listConfig };
}

/**
 * Execute an access control function
 */
export async function checkAccess<T = any>(
  accessControl: AccessControl<T> | undefined,
  args: {
    session: Session;
    item?: T;
    context: AccessContext;
  },
): Promise<boolean | PrismaFilter<T>> {
  // No access control means deny by default
  if (!accessControl) {
    return false;
  }

  // Execute the access control function
  const result = await accessControl(args);

  return result;
}

/**
 * Merge user filter with access control filter
 */
export function mergeFilters(
  userFilter: PrismaFilter | undefined,
  accessFilter: boolean | PrismaFilter,
): PrismaFilter | null {
  // If access is denied, return null
  if (accessFilter === false) {
    return null;
  }

  // If access is fully granted, use user filter
  if (accessFilter === true) {
    return userFilter || {};
  }

  // Merge access filter with user filter
  if (!userFilter) {
    return accessFilter;
  }

  // Combine filters with AND
  return {
    AND: [accessFilter, userFilter],
  };
}

/**
 * Check field-level access for a specific operation
 */
export async function checkFieldAccess(
  fieldAccess: FieldAccess | undefined,
  operation: "read" | "create" | "update",
  args: {
    session: Session;
    item?: any;
    context: AccessContext;
  },
): Promise<boolean> {
  if (!fieldAccess) {
    return true; // No field access means allow
  }

  const accessControl = fieldAccess[operation];
  if (!accessControl) {
    return true; // No specific access control means allow
  }

  const result = await accessControl(args);

  // If result is false, deny access
  if (result === false) {
    return false;
  }

  // If result is true, allow access
  if (result === true) {
    return true;
  }

  // If result is a filter object, check if the item matches
  // For field-level access, we need to evaluate the filter against the item
  if (typeof result === "object" && args.item) {
    return matchesFilter(args.item, result);
  }

  // Default to allowing access if we can't determine
  return true;
}

/**
 * Simple filter matching for field-level access
 * Checks if an item matches a Prisma-like filter object
 */
function matchesFilter(item: any, filter: Record<string, any>): boolean {
  for (const [key, condition] of Object.entries(filter)) {
    if (typeof condition === "object" && condition !== null) {
      // Handle nested conditions like { equals: value }
      if ("equals" in condition) {
        if (item[key] !== condition.equals) {
          return false;
        }
      } else if ("not" in condition) {
        if (item[key] === condition.not) {
          return false;
        }
      }
      // Add more condition types as needed
    } else {
      // Direct equality check
      if (item[key] !== condition) {
        return false;
      }
    }
  }
  return true;
}

/**
 * Filter fields from an object based on read access
 * Recursively applies access control to nested relationships
 */
export async function filterReadableFields<T extends Record<string, any>>(
  item: T,
  fieldConfigs: Record<string, FieldConfig>,
  args: {
    session: Session;
    context: AccessContext;
  },
  config?: OpenSaaSConfig,
  depth: number = 0,
): Promise<Partial<T>> {
  const filtered: Record<string, any> = {};
  const MAX_DEPTH = 5; // Prevent infinite recursion

  for (const [fieldName, value] of Object.entries(item)) {
    const fieldConfig = fieldConfigs[fieldName];

    // Always include id, createdAt, updatedAt
    if (["id", "createdAt", "updatedAt"].includes(fieldName)) {
      filtered[fieldName] = value;
      continue;
    }

    // Check field access
    const canRead = await checkFieldAccess(fieldConfig?.access, "read", {
      ...args,
      item,
    });

    if (!canRead) {
      continue;
    }

    // Handle relationship fields with nested access control
    if (
      config &&
      fieldConfig?.type === "relationship" &&
      value !== null &&
      value !== undefined &&
      depth < MAX_DEPTH
    ) {
      const relatedConfig = getRelatedListConfig(fieldConfig.ref, config);

      if (relatedConfig) {
        // For many relationships (arrays)
        if (Array.isArray(value)) {
          const filteredArray = await Promise.all(
            value.map(async (relatedItem) => {
              // Check query access for the related list
              const queryAccess = relatedConfig.listConfig.access?.operation?.query;
              const accessResult = await checkAccess(queryAccess, {
                session: args.session,
                item: relatedItem,
                context: args.context,
              });

              // If access denied, filter out this item
              if (accessResult === false) {
                return null;
              }

              // If access returns a filter, check if item matches
              if (typeof accessResult === "object") {
                if (!matchesFilter(relatedItem, accessResult)) {
                  return null;
                }
              }

              // Recursively filter readable fields on the related item
              return await filterReadableFields(
                relatedItem,
                relatedConfig.listConfig.fields,
                args,
                config,
                depth + 1,
              );
            }),
          );

          // Remove null entries (items that were filtered out)
          filtered[fieldName] = filteredArray.filter((item) => item !== null);
        }
        // For single relationships (objects)
        else if (typeof value === "object") {
          // Check query access for the related list
          const queryAccess = relatedConfig.listConfig.access?.operation?.query;
          const accessResult = await checkAccess(queryAccess, {
            session: args.session,
            item: value,
            context: args.context,
          });

          // If access denied, set to null
          if (accessResult === false) {
            filtered[fieldName] = null;
          }
          // If access returns a filter, check if item matches
          else if (typeof accessResult === "object") {
            if (!matchesFilter(value, accessResult)) {
              filtered[fieldName] = null;
            } else {
              // Recursively filter readable fields on the related item
              filtered[fieldName] = await filterReadableFields(
                value,
                relatedConfig.listConfig.fields,
                args,
                config,
                depth + 1,
              );
            }
          }
          // Access granted (true)
          else {
            // Recursively filter readable fields on the related item
            filtered[fieldName] = await filterReadableFields(
              value,
              relatedConfig.listConfig.fields,
              args,
              config,
              depth + 1,
            );
          }
        }
      } else {
        // Related config not found, include the value as-is
        filtered[fieldName] = value;
      }
    } else {
      // Non-relationship field or no config provided
      filtered[fieldName] = value;
    }
  }

  return filtered as Partial<T>;
}

/**
 * Filter fields from input data based on write access (create/update)
 */
export async function filterWritableFields<T extends Record<string, any>>(
  data: T,
  fieldConfigs: Record<string, { access?: FieldAccess }>,
  operation: "create" | "update",
  args: {
    session: Session;
    item?: any;
    context: AccessContext;
  },
): Promise<Partial<T>> {
  const filtered: Record<string, any> = {};

  for (const [fieldName, value] of Object.entries(data)) {
    const fieldConfig = fieldConfigs[fieldName];

    // Skip system fields
    if (["id", "createdAt", "updatedAt"].includes(fieldName)) {
      continue;
    }

    // Check field access
    const canWrite = await checkFieldAccess(fieldConfig?.access, operation, {
      ...args,
    });

    if (canWrite) {
      filtered[fieldName] = value;
    }
  }

  return filtered as Partial<T>;
}
