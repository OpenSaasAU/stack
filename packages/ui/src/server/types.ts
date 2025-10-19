import type { OpenSaaSConfig, Session, PrismaClientLike, AccessContext } from "@opensaas/core";

/**
 * Database context with access-controlled operations
 *
 * Each list in your config becomes a lowercase property on context.db
 * For example: config.lists.User corresponds to context.db.user
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
  context: AccessContext<TPrisma>;

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
