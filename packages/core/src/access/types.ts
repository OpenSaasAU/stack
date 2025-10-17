/**
 * Session type - can be extended by users
 */
export type Session = {
  userId?: string
  [key: string]: any
} | null

/**
 * Context type (simplified for access control)
 */
export type AccessContext = {
  session: Session
  prisma: any
  [key: string]: any
}

/**
 * Prisma filter type - represents a where clause
 */
export type PrismaFilter<T = any> = Record<string, any>

/**
 * Access control function type
 * Can return:
 * - boolean: true = allow, false = deny
 * - PrismaFilter: Prisma where clause to filter results
 */
export type AccessControl<T = any> = (args: {
  session: Session
  item?: T  // Present for update/delete operations
  context: AccessContext
}) => boolean | PrismaFilter<T> | Promise<boolean | PrismaFilter<T>>

/**
 * Field-level access control
 */
export type FieldAccess = {
  read?: AccessControl
  create?: AccessControl
  update?: AccessControl
}
