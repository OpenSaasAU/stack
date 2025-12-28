/**
 * Session interface - can be augmented by developers to add custom fields
 *
 * By default, Session is a permissive object that can contain any properties.
 * To get type safety and autocomplete, use module augmentation:
 *
 * @example
 * ```typescript
 * // types/session.d.ts
 * import '@opensaas/stack-core'
 *
 * declare module '@opensaas/stack-core' {
 *   interface Session {
 *     userId: string
 *     email: string
 *     role: 'admin' | 'user'
 *   }
 * }
 * ```
 *
 * After augmentation, session will be fully typed everywhere:
 * - Access control functions
 * - Hooks (resolveInput, validateInput, etc.)
 * - Context object
 *
 * @example
 * ```typescript
 * // With augmentation, this is fully typed:
 * const isAdmin: AccessControl = ({ session }) => {
 *   return session?.role === 'admin'  // ✅ Autocomplete works
 * }
 * ```
 */
export interface Session {
  [key: string]: unknown
}

/**
 * Generic Prisma model delegate type
 */
export type PrismaModelDelegate = {
  findUnique: (args: unknown) => Promise<unknown>
  findFirst: (args: unknown) => Promise<unknown>
  findMany: (args: unknown) => Promise<unknown[]>
  create: (args: unknown) => Promise<unknown>
  update: (args: unknown) => Promise<unknown>
  delete: (args: unknown) => Promise<unknown>
  count: (args?: unknown) => Promise<number>
}

/**
 * Generic Prisma client type
 * This is intentionally permissive to allow actual PrismaClient types
 * Uses `any` because Prisma generates highly complex client types that are difficult to constrain
 * This type is used as a generic constraint and the actual type safety comes from TPrisma parameter
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type PrismaClientLike = any

/**
 * Map Prisma client to access-controlled database context
 * Preserves Prisma's type information for each model
 */
export type AccessControlledDB<TPrisma extends PrismaClientLike> = {
  [K in keyof TPrisma]: TPrisma[K] extends {
    // Uses `any` in conditional type checks to verify Prisma model shape
    // This is a standard TypeScript pattern for checking if a property exists with any signature
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    findUnique: any
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    findMany: any
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    create: any
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    update: any
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete: any
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    count: any
  }
    ? {
        findUnique: TPrisma[K]['findUnique']
        findMany: TPrisma[K]['findMany']
        create: TPrisma[K]['create']
        update: TPrisma[K]['update']
        delete: TPrisma[K]['delete']
        count: TPrisma[K]['count']
        // Batch operations - run individual operations in a loop to ensure hooks and access control
        createMany: Parameters<TPrisma[K]['create']>[0] extends { data: infer TData }
          ? (args: { data: TData[] }) => Promise<Awaited<ReturnType<TPrisma[K]['create']>>[]>
          : never
        updateMany: Parameters<TPrisma[K]['update']>[0] extends { data: infer TData }
          ? Parameters<TPrisma[K]['findMany']>[0] extends { where?: infer TWhere }
            ? (args: {
                where?: TWhere
                data: TData
              }) => Promise<Awaited<ReturnType<TPrisma[K]['update']>>[]>
            : never
          : never
      }
    : never
} & {
  // Add index signature for runtime string access (e.g., db[getDbKey(listName)])
  // Uses `any` because models can have any shape from Prisma schema
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any
}

/**
 * Storage utilities for file/image uploads
 */
export type StorageUtils = {
  /**
   * Upload a file to storage
   * @param providerName - Name of storage provider from config
   * @param file - File object
   * @param buffer - File contents as Buffer
   * @param options - Upload options (validation, metadata)
   */
  uploadFile: (
    providerName: string,
    file: File,
    buffer: Buffer,
    options?: unknown,
  ) => Promise<unknown>

  /**
   * Upload an image with transformations
   * @param providerName - Name of storage provider from config
   * @param file - File object
   * @param buffer - File contents as Buffer
   * @param options - Upload options (validation, transformations, metadata)
   */
  uploadImage: (
    providerName: string,
    file: File,
    buffer: Buffer,
    options?: unknown,
  ) => Promise<unknown>

  /**
   * Delete a file from storage
   * @param providerName - Name of storage provider from config
   * @param filename - Name of file to delete
   */
  deleteFile: (providerName: string, filename: string) => Promise<void>

  /**
   * Delete an image and all its transformations
   * @param metadata - Image metadata containing storage provider and filename
   */
  deleteImage: (metadata: unknown) => Promise<void>
}

/**
 * Context type (simplified for access control)
 * Using interface instead of type to allow module augmentation
 */
export interface AccessContext<TPrisma extends PrismaClientLike = PrismaClientLike> {
  session: Session | null
  prisma: TPrisma
  db: AccessControlledDB<TPrisma>
  storage: StorageUtils
  plugins: Record<string, unknown>
  _isSudo: boolean
  /**
   * Internal mutable counter to track resolveOutput hook depth.
   * When depth > 0, we skip auto-including relationships to prevent infinite loops
   * when hooks make database queries that include relationships back to the original entity.
   * We use a mutable object so that spreading the context preserves the reference.
   */
  _resolveOutputCounter: { depth: number }
}

/**
 * Prisma filter type - represents a where clause
 * Uses Partial to allow filtering by any subset of fields
 */
export type PrismaFilter<T = Record<string, unknown>> = Partial<Record<keyof T, unknown>>

/**
 * Access control function type
 * Can return:
 * - boolean: true = allow, false = deny
 * - PrismaFilter: Prisma where clause to filter results
 */
export type AccessControl<T = Record<string, unknown>> = (args: {
  session: Session | null
  item?: T // Present for update/delete operations
  context: AccessContext
}) => boolean | PrismaFilter<T> | Promise<boolean | PrismaFilter<T>>

/**
 * Field-level access control function.
 * For create/update operations, receives inputData to validate incoming values.
 *
 * Note: While this type accepts filters for backward compatibility with AccessControl,
 * filters are ignored in field-level access. Only boolean results are used.
 * If a filter is returned, it defaults to allowing access (true).
 */
export type FieldAccessControl<
  TItem = Record<string, unknown>,
  TCreateInput = Record<string, unknown>,
  TUpdateInput = Record<string, unknown>,
> = (
  args:
    | {
        session: Session | null
        item?: undefined
        context: AccessContext
        inputData?: undefined
        operation: 'read'
      }
    | {
        session: Session | null
        item?: undefined
        context: AccessContext
        inputData: TCreateInput
        operation: 'create'
      }
    | {
        session: Session | null
        item: TItem
        context: AccessContext
        inputData: TUpdateInput
        operation: 'update'
      },
) => boolean | PrismaFilter<TItem> | Promise<boolean | PrismaFilter<TItem>>

/**
 * Field-level access control
 */
export type FieldAccess<
  TItem = Record<string, unknown>,
  TCreateInput = Record<string, unknown>,
  TUpdateInput = Record<string, unknown>,
> = {
  read?: FieldAccessControl<TItem, TCreateInput, TUpdateInput>
  create?: FieldAccessControl<TItem, TCreateInput, TUpdateInput>
  update?: FieldAccessControl<TItem, TCreateInput, TUpdateInput>
}
