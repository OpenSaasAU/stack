/**
 * SQLite database adapter
 */
import Database from 'better-sqlite3'
import type {
  DatabaseAdapter,
  DatabaseConfig,
  TableDefinition,
  ColumnDefinition,
  DatabaseDialect,
  DatabaseRow,
} from '../types/index.js'

export class SQLiteDialect implements DatabaseDialect {
  quoteIdentifier(name: string): string {
    return `"${name}"`
  }

  getPlaceholder(_index: number): string {
    return '?'
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
        return 'INTEGER' // SQLite stores booleans as 0/1
      case 'TIMESTAMP':
        return 'TEXT' // SQLite stores timestamps as ISO strings
      default:
        return 'TEXT'
    }
  }

  getCurrentTimestamp(): string {
    return "datetime('now')"
  }
}

export class SQLiteAdapter implements DatabaseAdapter {
  private db: Database.Database | null = null
  private dialect = new SQLiteDialect()

  constructor(private config: DatabaseConfig) {}

  async connect(): Promise<void> {
    // Extract file path from URL (file:./dev.db -> ./dev.db)
    const filePath = this.config.url.replace(/^file:/, '')
    this.db = new Database(filePath)

    // Enable foreign keys (disabled by default in SQLite)
    this.db.pragma('foreign_keys = ON')
  }

  async disconnect(): Promise<void> {
    if (this.db) {
      this.db.close()
      this.db = null
    }
  }

  private getDb(): Database.Database {
    if (!this.db) {
      throw new Error('Database not connected. Call connect() first.')
    }
    return this.db
  }

  async query<T = DatabaseRow>(sql: string, params: unknown[] = []): Promise<T[]> {
    const db = this.getDb()
    const stmt = db.prepare(sql)
    const rows = stmt.all(...params) as T[]
    return rows
  }

  async queryOne<T = DatabaseRow>(sql: string, params: unknown[] = []): Promise<T | null> {
    const db = this.getDb()
    const stmt = db.prepare(sql)
    const row = stmt.get(...params) as T | undefined
    return row || null
  }

  async execute(sql: string, params: unknown[] = []): Promise<void> {
    const db = this.getDb()
    const stmt = db.prepare(sql)
    stmt.run(...params)
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
    const sql = `DROP TABLE IF EXISTS ${this.dialect.quoteIdentifier(tableName)}`
    await this.execute(sql)
  }

  async tableExists(tableName: string): Promise<boolean> {
    const sql = `SELECT name FROM sqlite_master WHERE type='table' AND name=?`
    const result = await this.queryOne<{ name: string }>(sql, [tableName])
    return result !== null
  }

  async getTableSchema(tableName: string): Promise<ColumnDefinition[]> {
    const sql = `PRAGMA table_info(${this.dialect.quoteIdentifier(tableName)})`
    const rows = await this.query<{
      cid: number
      name: string
      type: string
      notnull: number
      dflt_value: string | null
      pk: number
    }>(sql)

    return rows.map((row) => {
      // Map SQLite types back to our column types
      let type: ColumnDefinition['type'] = 'TEXT'
      if (row.type.includes('INTEGER')) type = 'INTEGER'
      else if (row.type.includes('REAL')) type = 'REAL'
      else if (row.type.includes('TEXT')) type = 'TEXT'

      return {
        name: row.name,
        type,
        primaryKey: row.pk === 1,
        nullable: row.notnull === 0,
        default: row.dflt_value || undefined,
      }
    })
  }

  getDialect(): DatabaseDialect {
    return this.dialect
  }
}
