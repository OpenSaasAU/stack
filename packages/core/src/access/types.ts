/**
 * Session type - can be extended by users
 */
export type Session = {
  userId?: string;
  [key: string]: unknown;
} | null;

/**
 * Generic Prisma model delegate type
 */
export type PrismaModelDelegate = {
  findUnique: (args: unknown) => Promise<unknown>;
  findFirst: (args: unknown) => Promise<unknown>;
  findMany: (args: unknown) => Promise<unknown[]>;
  create: (args: unknown) => Promise<unknown>;
  update: (args: unknown) => Promise<unknown>;
  delete: (args: unknown) => Promise<unknown>;
  count: (args?: unknown) => Promise<number>;
};

/**
 * Generic Prisma client type
 * This is intentionally permissive to allow actual PrismaClient types
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type PrismaClientLike = any;

/**
 * Context type (simplified for access control)
 */
export type AccessContext<TPrisma extends PrismaClientLike = PrismaClientLike> = {
  session: Session;
  prisma: TPrisma;
  [key: string]: unknown;
};

/**
 * Prisma filter type - represents a where clause
 */
export type PrismaFilter<T = Record<string, unknown>> = Record<keyof T, unknown>;

/**
 * Access control function type
 * Can return:
 * - boolean: true = allow, false = deny
 * - PrismaFilter: Prisma where clause to filter results
 */
export type AccessControl<T = Record<string, unknown>> = (args: {
  session: Session;
  item?: T; // Present for update/delete operations
  context: AccessContext;
}) => boolean | PrismaFilter<T> | Promise<boolean | PrismaFilter<T>>;

/**
 * Field-level access control
 */
export type FieldAccess = {
  read?: AccessControl;
  create?: AccessControl;
  update?: AccessControl;
};
