import type { OpenSaaSConfig, Session, PrismaClientLike } from "@opensaas/core";

/**
 * Map Prisma client to access-controlled database context
 * Preserves Prisma's type information for each model
 */
type AccessControlledDB<TPrisma extends PrismaClientLike> = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [K in keyof TPrisma]: TPrisma[K] extends { findUnique: any; findMany: any; create: any; update: any; delete: any; count: any }
    ? {
        findUnique: TPrisma[K]["findUnique"];
        findMany: TPrisma[K]["findMany"];
        create: TPrisma[K]["create"];
        update: TPrisma[K]["update"];
        delete: TPrisma[K]["delete"];
        count: TPrisma[K]["count"];
      }
    : never;
};

/**
 * Database context with access-controlled operations
 *
 * Each list in your config becomes a lowercase property on context.db
 * For example: config.lists.User becomes context.db.user
 *
 * @deprecated Use AccessControlledDB<TPrisma> for proper type inference
 */
export type DatabaseContext = Record<string, unknown>;

/**
 * Input for the generic server action
 */
export interface ServerActionInput {
  listKey: string;
  action: "create" | "update" | "delete";
  data?: Record<string, unknown>;
  id?: string;
}

/**
 * Access-controlled context returned by getContext()
 */
export interface AccessControlledContext<TPrisma extends PrismaClientLike = PrismaClientLike> {
  /**
   * Database operations with access control enforced
   * List keys are lowercase (e.g., "user", "post")
   * Preserves Prisma's type information for full type safety
   */
  db: AccessControlledDB<TPrisma>;

  /**
   * Current user session
   */
  session: Session | null;

  /**
   * Direct Prisma client access
   */
  prisma: TPrisma;

  /**
   * Generic server action handler
   * Handles create, update, and delete operations for any list
   */
  serverAction: (input: ServerActionInput) => Promise<unknown>;
}

/**
 * Admin context provided to UI components
 * Contains access-controlled database context, config, and session
 */
export interface AdminContext<TPrisma extends PrismaClientLike = PrismaClientLike> {
  /**
   * Access-controlled database context
   * Use this for all database operations - it enforces access control
   *
   * @remarks
   * List keys are lowercase in context.db but capitalized in config.lists
   * For example: config.lists.User corresponds to context.db.user
   */
  context: AccessControlledContext<TPrisma>;

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
  prisma: TPrisma;
}

/**
 * Result of a server action
 */
export interface ActionResult<T = Record<string, unknown>> {
  success: boolean;
  data?: T;
  error?: string;
  fieldErrors?: Record<string, string>;
}
