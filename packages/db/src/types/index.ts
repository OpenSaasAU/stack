/**
 * Database adapter types for OpenSaas Stack custom ORM
 */

/**
 * Column definition for schema generation
 */
export interface ColumnDefinition {
  name: string
  type: 'TEXT' | 'INTEGER' | 'REAL' | 'BOOLEAN' | 'TIMESTAMP'
  primaryKey?: boolean
  nullable?: boolean
  unique?: boolean
  default?: string | number | boolean
  references?: {
    table: string
    column: string
    onDelete?: 'CASCADE' | 'SET NULL' | 'RESTRICT'
  }
}

/**
 * Table definition for schema generation
 */
export interface TableDefinition {
  name: string
  columns: ColumnDefinition[]
  indexes?: Array<{
    name: string
    columns: string[]
    unique?: boolean
  }>
}

/**
 * Database configuration
 */
export interface DatabaseConfig {
  provider: 'sqlite' | 'postgresql' | 'mysql'
  url: string
}

/**
 * Filter operators for where clauses
 */
export type FilterOperator =
  | { equals: unknown }
  | { not: unknown }
  | { in: unknown[] }
  | { notIn: unknown[] }
  | { lt: number | Date }
  | { lte: number | Date }
  | { gt: number | Date }
  | { gte: number | Date }
  | { contains: string }
  | { startsWith: string }
  | { endsWith: string }

/**
 * Where clause filter
 */
export type WhereFilter = {
  [key: string]: unknown | FilterOperator
  AND?: WhereFilter[]
  OR?: WhereFilter[]
  NOT?: WhereFilter
}

/**
 * Include arguments for relationships
 */
export type IncludeArgs = boolean | { where?: WhereFilter }

/**
 * Query arguments
 */
export interface QueryArgs {
  where?: WhereFilter
  take?: number
  skip?: number
  include?: Record<string, IncludeArgs>
  orderBy?: Record<string, 'asc' | 'desc'>
}

/**
 * Relationship definition
 */
export interface RelationshipDefinition {
  name: string
  type: 'one-to-many' | 'many-to-one'
  targetTable: string
  foreignKey: string // Column name on the table that holds the FK
  targetField?: string // Field name in the target table (for reverse lookup)
}

/**
 * Relationship map for a table
 */
export interface RelationshipMap {
  [fieldName: string]: RelationshipDefinition
}

/**
 * Database row result
 */
export type DatabaseRow = Record<string, unknown>

/**
 * Database adapter interface
 * Minimal interface that all database adapters must implement
 */
export interface DatabaseAdapter {
  /**
   * Connect to database
   */
  connect(): Promise<void>

  /**
   * Disconnect from database
   */
  disconnect(): Promise<void>

  /**
   * Execute a query that returns rows
   */
  query<T = DatabaseRow>(sql: string, params?: unknown[]): Promise<T[]>

  /**
   * Execute a query that returns a single row
   */
  queryOne<T = DatabaseRow>(sql: string, params?: unknown[]): Promise<T | null>

  /**
   * Execute a query that doesn't return rows (INSERT, UPDATE, DELETE)
   */
  execute(sql: string, params?: unknown[]): Promise<void>

  /**
   * Create a table
   */
  createTable(table: TableDefinition): Promise<void>

  /**
   * Drop a table
   */
  dropTable(tableName: string): Promise<void>

  /**
   * Check if a table exists
   */
  tableExists(tableName: string): Promise<boolean>

  /**
   * Get table schema
   */
  getTableSchema(tableName: string): Promise<ColumnDefinition[]>

  /**
   * Get SQL dialect helpers
   */
  getDialect(): DatabaseDialect
}

/**
 * SQL dialect helpers
 */
export interface DatabaseDialect {
  /**
   * Quote identifier (table/column name)
   */
  quoteIdentifier(name: string): string

  /**
   * Get parameter placeholder (?, $1, etc.)
   */
  getPlaceholder(index: number): string

  /**
   * Get RETURNING clause for INSERT/UPDATE
   */
  getReturningClause(): string | null

  /**
   * Map column type to SQL type
   */
  mapColumnType(type: ColumnDefinition['type']): string

  /**
   * Get current timestamp SQL
   */
  getCurrentTimestamp(): string
}
