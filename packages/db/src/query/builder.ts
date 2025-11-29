/**
 * Query builder for database operations
 */
import type {
  DatabaseAdapter,
  QueryArgs,
  WhereFilter,
  DatabaseRow,
  TableDefinition,
} from '../types/index.js'
import { filterToSQL, mergeFilters } from '../utils/filter.js'

export class QueryBuilder {
  constructor(
    private adapter: DatabaseAdapter,
    private tableName: string,
    private schema: TableDefinition,
  ) {}

  /**
   * Find a single record by ID
   */
  async findUnique(args: { where: { id: string } }): Promise<DatabaseRow | null> {
    const dialect = this.adapter.getDialect()
    const sql = `SELECT * FROM ${dialect.quoteIdentifier(this.tableName)} WHERE ${dialect.quoteIdentifier('id')} = ${dialect.getPlaceholder(0)} LIMIT 1`

    return this.adapter.queryOne(sql, [args.where.id])
  }

  /**
   * Find multiple records
   */
  async findMany(args?: QueryArgs): Promise<DatabaseRow[]> {
    const dialect = this.adapter.getDialect()
    const parts: string[] = [`SELECT * FROM ${dialect.quoteIdentifier(this.tableName)}`]
    const params: unknown[] = []

    // WHERE clause
    if (args?.where) {
      const filterResult = filterToSQL(args.where, dialect, 0)
      if (filterResult.sql) {
        parts.push(`WHERE ${filterResult.sql}`)
        params.push(...filterResult.params)
      }
    }

    // ORDER BY clause
    if (args?.orderBy) {
      const orderClauses = Object.entries(args.orderBy).map(
        ([field, direction]) =>
          `${dialect.quoteIdentifier(field)} ${direction.toUpperCase()}`,
      )
      parts.push(`ORDER BY ${orderClauses.join(', ')}`)
    }

    // LIMIT clause
    if (args?.take !== undefined) {
      parts.push(`LIMIT ${args.take}`)
    }

    // OFFSET clause
    if (args?.skip !== undefined) {
      parts.push(`OFFSET ${args.skip}`)
    }

    const sql = parts.join(' ')
    return this.adapter.query(sql, params)
  }

  /**
   * Normalize value for database
   * SQLite needs booleans converted to 0/1
   */
  private normalizeValue(value: unknown): unknown {
    if (typeof value === 'boolean') {
      return value ? 1 : 0
    }
    return value
  }

  /**
   * Create a new record
   */
  async create(args: { data: DatabaseRow }): Promise<DatabaseRow> {
    const dialect = this.adapter.getDialect()
    const data = args.data

    // Ensure ID is set
    if (!data.id) {
      data.id = this.generateId()
    }

    // Set timestamps
    const now = new Date().toISOString()
    data.createdAt = now
    data.updatedAt = now

    const columns = Object.keys(data)
    const columnNames = columns.map((c) => dialect.quoteIdentifier(c)).join(', ')
    const placeholders = columns.map((_, i) => dialect.getPlaceholder(i)).join(', ')
    const values = columns.map((c) => this.normalizeValue(data[c]))

    const returningClause = dialect.getReturningClause()

    let sql = `INSERT INTO ${dialect.quoteIdentifier(this.tableName)} (${columnNames}) VALUES (${placeholders})`

    if (returningClause) {
      sql += ` ${returningClause}`
      const result = await this.adapter.queryOne(sql, values)
      return result!
    } else {
      // For databases that don't support RETURNING, execute then fetch
      await this.adapter.execute(sql, values)
      return this.findUnique({ where: { id: data.id as string } }).then((r) => r!)
    }
  }

  /**
   * Update a record
   */
  async update(args: { where: { id: string }; data: DatabaseRow }): Promise<DatabaseRow | null> {
    const dialect = this.adapter.getDialect()
    const data = { ...args.data }

    // Update timestamp
    data.updatedAt = new Date().toISOString()

    // Remove id from update data
    delete data.id
    delete data.createdAt

    const columns = Object.keys(data)
    const setClauses = columns.map((c, i) => `${dialect.quoteIdentifier(c)} = ${dialect.getPlaceholder(i)}`)
    const values = columns.map((c) => this.normalizeValue(data[c]))

    const returningClause = dialect.getReturningClause()

    let sql = `UPDATE ${dialect.quoteIdentifier(this.tableName)} SET ${setClauses.join(', ')} WHERE ${dialect.quoteIdentifier('id')} = ${dialect.getPlaceholder(columns.length)}`
    values.push(args.where.id)

    if (returningClause) {
      sql += ` ${returningClause}`
      const result = await this.adapter.queryOne(sql, values)
      return result
    } else {
      await this.adapter.execute(sql, values)
      return this.findUnique({ where: { id: args.where.id } })
    }
  }

  /**
   * Delete a record
   */
  async delete(args: { where: { id: string } }): Promise<DatabaseRow | null> {
    const dialect = this.adapter.getDialect()

    // Fetch the record first (to return it after deletion)
    const record = await this.findUnique(args)
    if (!record) {
      return null
    }

    const sql = `DELETE FROM ${dialect.quoteIdentifier(this.tableName)} WHERE ${dialect.quoteIdentifier('id')} = ${dialect.getPlaceholder(0)}`
    await this.adapter.execute(sql, [args.where.id])

    return record
  }

  /**
   * Count records
   */
  async count(args?: { where?: WhereFilter }): Promise<number> {
    const dialect = this.adapter.getDialect()
    const parts: string[] = [`SELECT COUNT(*) as count FROM ${dialect.quoteIdentifier(this.tableName)}`]
    const params: unknown[] = []

    // WHERE clause
    if (args?.where) {
      const filterResult = filterToSQL(args.where, dialect, 0)
      if (filterResult.sql) {
        parts.push(`WHERE ${filterResult.sql}`)
        params.push(...filterResult.params)
      }
    }

    const sql = parts.join(' ')
    const result = await this.adapter.queryOne<{ count: number }>(sql, params)
    return result?.count || 0
  }

  /**
   * Generate a CUID-like ID
   * Simple implementation for prototype - use proper CUID library in production
   */
  private generateId(): string {
    const timestamp = Date.now().toString(36)
    const random = Math.random().toString(36).substring(2, 15)
    return `${timestamp}${random}`
  }
}
