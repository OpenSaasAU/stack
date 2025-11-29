/**
 * PostgreSQL database adapter
 * Supports both native pg and Neon serverless
 */
import type {
  DatabaseAdapter,
  DatabaseConfig,
  TableDefinition,
  ColumnDefinition,
  DatabaseDialect,
  DatabaseRow,
} from '../types/index.js'

/**
 * Generic connection interface for pg and Neon
 */
export interface PostgresConnection {
  query(text: string, values?: unknown[]): Promise<{ rows: unknown[] }>
  end?(): Promise<void>
}

export class PostgreSQLDialect implements DatabaseDialect {
  quoteIdentifier(name: string): string {
    return `"${name}"`
  }

  getPlaceholder(index: number): string {
    return `$${index + 1}` // PostgreSQL uses $1, $2, $3, etc.
  }

  getReturningClause(): string | null {
    return 'RETURNING *'
  }

  mapColumnType(type: ColumnDefinition['type']): string {
    switch (type) {
      case 'TEXT':
        return 'TEXT'
      case 'INTEGER':
        return 'INTEGER'
      case 'REAL':
        return 'REAL'
      case 'BOOLEAN':
        return 'BOOLEAN' // PostgreSQL has native BOOLEAN
      case 'TIMESTAMP':
        return 'TIMESTAMP WITH TIME ZONE'
      default:
        return 'TEXT'
    }
  }

  getCurrentTimestamp(): string {
    return 'NOW()'
  }
}

/**
 * PostgreSQL adapter configuration
 */
export interface PostgreSQLConfig extends DatabaseConfig {
  provider: 'postgresql'
  /**
   * Connection type
   * - 'pg': Native PostgreSQL driver (pg.Pool)
   * - 'neon': Neon serverless driver
   */
  connectionType?: 'pg' | 'neon'
  /**
   * Connection string (for both pg and Neon)
   */
  url: string
  /**
   * Optional pg Pool configuration
   */
  poolConfig?: {
    max?: number
    idleTimeoutMillis?: number
    connectionTimeoutMillis?: number
  }
}

export class PostgreSQLAdapter implements DatabaseAdapter {
  private connection: PostgresConnection | null = null
  private dialect = new PostgreSQLDialect()
  private config: PostgreSQLConfig

  constructor(config: PostgreSQLConfig) {
    this.config = config
  }

  async connect(): Promise<void> {
    const connectionType = this.config.connectionType || 'pg'

    if (connectionType === 'pg') {
      // Dynamic import for pg
      const { default: pg } = await import('pg')
      const { Pool } = pg

      const pool = new Pool({
        connectionString: this.config.url,
        ...this.config.poolConfig,
      })

      this.connection = pool
    } else if (connectionType === 'neon') {
      // Dynamic import for Neon
      const { neonConfig, Pool } = await import('@neondatabase/serverless')

      // Configure for Node.js environment (WebSocket)
      if (typeof WebSocket === 'undefined') {
        const { default: ws } = await import('ws')
        neonConfig.webSocketConstructor = ws
      }

      const pool = new Pool({ connectionString: this.config.url })
      this.connection = pool
    } else {
      throw new Error(`Unknown connection type: ${connectionType}`)
    }
  }

  async disconnect(): Promise<void> {
    if (this.connection && 'end' in this.connection && this.connection.end) {
      await this.connection.end()
      this.connection = null
    }
  }

  private getConnection(): PostgresConnection {
    if (!this.connection) {
      throw new Error('Database not connected. Call connect() first.')
    }
    return this.connection
  }

  async query<T = DatabaseRow>(sql: string, params: unknown[] = []): Promise<T[]> {
    const conn = this.getConnection()
    const result = await conn.query(sql, params)
    return result.rows as T[]
  }

  async queryOne<T = DatabaseRow>(sql: string, params: unknown[] = []): Promise<T | null> {
    const conn = this.getConnection()
    const result = await conn.query(sql, params)
    return (result.rows[0] as T) || null
  }

  async execute(sql: string, params: unknown[] = []): Promise<void> {
    const conn = this.getConnection()
    await conn.query(sql, params)
  }

  async createTable(table: TableDefinition): Promise<void> {
    const columns = table.columns
      .map((col) => {
        const parts: string[] = [this.dialect.quoteIdentifier(col.name)]

        // Add type
        parts.push(this.dialect.mapColumnType(col.type))

        // Add constraints
        if (col.primaryKey) {
          parts.push('PRIMARY KEY')
        }

        if (!col.nullable && !col.primaryKey) {
          parts.push('NOT NULL')
        }

        if (col.unique) {
          parts.push('UNIQUE')
        }

        if (col.default !== undefined) {
          if (typeof col.default === 'string') {
            parts.push(`DEFAULT '${col.default}'`)
          } else if (typeof col.default === 'boolean') {
            parts.push(`DEFAULT ${col.default}`)
          } else {
            parts.push(`DEFAULT ${col.default}`)
          }
        }

        return parts.join(' ')
      })
      .join(',\n  ')

    // Add foreign key constraints
    const foreignKeys = table.columns
      .filter((col) => col.references)
      .map((col) => {
        const ref = col.references!
        const onDelete = ref.onDelete ? ` ON DELETE ${ref.onDelete}` : ''
        return `FOREIGN KEY (${this.dialect.quoteIdentifier(col.name)}) REFERENCES ${this.dialect.quoteIdentifier(ref.table)}(${this.dialect.quoteIdentifier(ref.column)})${onDelete}`
      })

    const allConstraints = foreignKeys.length > 0 ? `,\n  ${foreignKeys.join(',\n  ')}` : ''

    const sql = `CREATE TABLE IF NOT EXISTS ${this.dialect.quoteIdentifier(table.name)} (\n  ${columns}${allConstraints}\n)`

    await this.execute(sql)

    // Create indexes
    if (table.indexes) {
      for (const index of table.indexes) {
        const unique = index.unique ? 'UNIQUE ' : ''
        const cols = index.columns.map((c) => this.dialect.quoteIdentifier(c)).join(', ')
        const indexSql = `CREATE ${unique}INDEX IF NOT EXISTS ${this.dialect.quoteIdentifier(index.name)} ON ${this.dialect.quoteIdentifier(table.name)} (${cols})`
        await this.execute(indexSql)
      }
    }
  }

  async dropTable(tableName: string): Promise<void> {
    const sql = `DROP TABLE IF EXISTS ${this.dialect.quoteIdentifier(tableName)} CASCADE`
    await this.execute(sql)
  }

  async tableExists(tableName: string): Promise<boolean> {
    const sql = `SELECT EXISTS (
      SELECT FROM information_schema.tables
      WHERE table_schema = 'public'
      AND table_name = $1
    )`
    const result = await this.queryOne<{ exists: boolean }>(sql, [tableName])
    return result?.exists || false
  }

  async getTableSchema(tableName: string): Promise<ColumnDefinition[]> {
    const sql = `
      SELECT
        column_name,
        data_type,
        is_nullable,
        column_default
      FROM information_schema.columns
      WHERE table_schema = 'public'
      AND table_name = $1
      ORDER BY ordinal_position
    `
    const rows = await this.query<{
      column_name: string
      data_type: string
      is_nullable: string
      column_default: string | null
    }>(sql, [tableName])

    return rows.map((row) => {
      // Map PostgreSQL types back to our column types
      let type: ColumnDefinition['type'] = 'TEXT'
      if (row.data_type.includes('integer')) type = 'INTEGER'
      else if (row.data_type.includes('real') || row.data_type.includes('numeric')) type = 'REAL'
      else if (row.data_type.includes('boolean')) type = 'BOOLEAN'
      else if (row.data_type.includes('timestamp')) type = 'TIMESTAMP'
      else if (row.data_type.includes('text') || row.data_type.includes('character')) type = 'TEXT'

      return {
        name: row.column_name,
        type,
        primaryKey: false, // Would need to query pg_constraint for this
        nullable: row.is_nullable === 'YES',
        default: row.column_default || undefined,
      }
    })
  }

  getDialect(): DatabaseDialect {
    return this.dialect
  }
}
