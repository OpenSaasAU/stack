import type { OpenSaaSConfig, Session } from "@opensaas/core";

/**
 * Database context with access-controlled operations
 *
 * Each list in your config becomes a lowercase property on context.db
 * For example: config.lists.User becomes context.db.user
 */
export interface DatabaseContext {
  /**
   * Database operations for each list
   * Keys are lowercase versions of your config list names
   *
   * @example
   * ```ts
   * // If config has lists: { User: {...}, Post: {...} }
   * // Then context.db has: { user: {...}, post: {...} }
   * const user = await context.db.user.findUnique({ where: { id } })
   * const posts = await context.db.post.findMany()
   * ```
   */
  [listKey: string]: {
    findUnique: (args: {
      where: { id: string };
      include?: any;
    }) => Promise<any | null>;
    findMany: (args?: {
      where?: any;
      take?: number;
      skip?: number;
      include?: any;
    }) => Promise<any[]>;
    create: (args: { data: any }) => Promise<any | null>;
    update: (args: { where: { id: string }; data: any }) => Promise<any | null>;
    delete: (args: { where: { id: string } }) => Promise<any | null>;
    count: (args?: { where?: any }) => Promise<number>;
  };
}

/**
 * Input for the generic server action
 */
export interface ServerActionInput {
  listKey: string;
  action: "create" | "update" | "delete";
  data?: Record<string, any>;
  id?: string;
}

/**
 * Access-controlled context returned by getContext()
 */
export interface AccessControlledContext {
  /**
   * Database operations with access control enforced
   * List keys are lowercase (e.g., "user", "post")
   */
  db: DatabaseContext;

  /**
   * Current user session
   */
  session: Session | null;

  /**
   * Direct Prisma client access
   */
  prisma: any;

  /**
   * Generic server action handler
   * Handles create, update, and delete operations for any list
   */
  serverAction: (input: ServerActionInput) => Promise<any | null>;
}

/**
 * Admin context provided to UI components
 * Contains access-controlled database context, config, and session
 */
export interface AdminContext {
  /**
   * Access-controlled database context
   * Use this for all database operations - it enforces access control
   *
   * @remarks
   * List keys are lowercase in context.db but capitalized in config.lists
   * For example: config.lists.User corresponds to context.db.user
   */
  context: AccessControlledContext;

  /**
   * OpenSaaS configuration
   * Contains list definitions, field configs, access control rules, etc.
   */
  config: OpenSaaSConfig;

  /**
   * Current user session
   * null if no user is authenticated
   */
  session: Session | null;

  /**
   * Direct Prisma client access
   * Use sparingly - bypasses access control
   * Prefer using context for database operations
   */
  prisma: any;
}

/**
 * Result of a server action
 */
export interface ActionResult<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  fieldErrors?: Record<string, string>;
}
