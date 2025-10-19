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
 * Map Prisma client to access-controlled database context
 * Preserves Prisma's type information for each model
 */
export type AccessControlledDB<TPrisma extends PrismaClientLike> = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [K in keyof TPrisma]: TPrisma[K] extends {
    findUnique: any;
    findMany: any;
    create: any;
    update: any;
    delete: any;
    count: any;
  }
    ? {
        findUnique: TPrisma[K]["findUnique"];
        findMany: TPrisma[K]["findMany"];
        create: TPrisma[K]["create"];
        update: TPrisma[K]["update"];
        delete: TPrisma[K]["delete"];
        count: TPrisma[K]["count"];
      }
    : never;
} & {
  // Add index signature for runtime string access
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
};

/**
 * Context type (simplified for access control)
 */
export type AccessContext<TPrisma extends PrismaClientLike = PrismaClientLike> = {
  session: Session;
  prisma: TPrisma;
  db: AccessControlledDB<TPrisma>;
  [key: string]: unknown;
};

/**
 * Prisma filter type - represents a where clause
 * Uses Partial to allow filtering by any subset of fields
 */
export type PrismaFilter<T = Record<string, unknown>> = Partial<Record<keyof T, unknown>>;

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
