/**
 * Query builder for database operations
 */
import type {
  DatabaseAdapter,
  QueryArgs,
  WhereFilter,
  DatabaseRow,
  TableDefinition,
  RelationshipMap,
  IncludeArgs,
} from '../types/index.js'
import { filterToSQL } from '../utils/filter.js'

export class QueryBuilder {
  private relationships: RelationshipMap = {}
  private static queryBuilders: Map<string, QueryBuilder> = new Map()

  constructor(
    private adapter: DatabaseAdapter,
    private tableName: string,
    private schema: TableDefinition,
    relationships?: RelationshipMap,
  ) {
    if (relationships) {
      this.relationships = relationships
    }
    // Register this query builder for relationship lookups
    QueryBuilder.queryBuilders.set(tableName, this)
  }

  /**
   * Get a registered query builder by table name
   */
  private getQueryBuilder(tableName: string): QueryBuilder | undefined {
    return QueryBuilder.queryBuilders.get(tableName)
  }

  /**
   * Load relationships for a single record
   */
  private async loadRelationshipsForRecord(
    record: DatabaseRow,
    include?: Record<string, IncludeArgs>,
  ): Promise<DatabaseRow> {
    if (!include) return record

    const result = { ...record }

    for (const [fieldName, includeArg] of Object.entries(include)) {
      const relationship = this.relationships[fieldName]
      if (!relationship) {
        console.warn(`Relationship "${fieldName}" not found on ${this.tableName}`)
        continue
      }

      const targetBuilder = this.getQueryBuilder(relationship.targetTable)
      if (!targetBuilder) {
        console.warn(`Query builder for "${relationship.targetTable}" not found`)
        continue
      }

      const whereFilter = typeof includeArg === 'object' ? includeArg.where : undefined

      if (relationship.type === 'many-to-one') {
        // e.g., Post.author - foreign key is on current table
        const foreignKeyValue = record[relationship.foreignKey]
        if (foreignKeyValue) {
          const relatedRecord = await targetBuilder.findUnique({
            where: { id: foreignKeyValue as string },
          })
          // Apply where filter if provided
          if (relatedRecord && whereFilter) {
            const filterResult = this.matchesFilter(relatedRecord, whereFilter)
            result[fieldName] = filterResult ? relatedRecord : null
          } else {
            result[fieldName] = relatedRecord
          }
        } else {
          result[fieldName] = null
        }
      } else {
        // e.g., User.posts - foreign key is on target table
        const filter: WhereFilter = {
          [relationship.foreignKey]: { equals: record.id },
        }
        // Merge with user-provided where filter
        const finalFilter = whereFilter ? { AND: [filter, whereFilter] } : filter

        const relatedRecords = await targetBuilder.findMany({
          where: finalFilter,
        })
        result[fieldName] = relatedRecords
      }
    }

    return result
  }

  /**
   * Load relationships for multiple records
   */
  private async loadRelationshipsForRecords(
    records: DatabaseRow[],
    include?: Record<string, IncludeArgs>,
  ): Promise<DatabaseRow[]> {
    if (!include || records.length === 0) return records

    // For efficiency, we could batch load relationships
    // For now, keep it simple and load per record
    return Promise.all(records.map((record) => this.loadRelationshipsForRecord(record, include)))
  }

  /**
   * Check if a record matches a filter (for in-memory filtering)
   */
  private matchesFilter(record: DatabaseRow, filter: WhereFilter): boolean {
    // Simple implementation - checks direct equality and basic operators
    for (const [key, value] of Object.entries(filter)) {
      if (key === 'AND') {
        const conditions = value as WhereFilter[]
        if (!conditions.every((f) => this.matchesFilter(record, f))) {
          return false
        }
      } else if (key === 'OR') {
        const conditions = value as WhereFilter[]
        if (!conditions.some((f) => this.matchesFilter(record, f))) {
          return false
        }
      } else if (key === 'NOT') {
        if (this.matchesFilter(record, value as WhereFilter)) {
          return false
        }
      } else {
        // Field filter
        const fieldValue = record[key]
        if (typeof value === 'object' && value !== null) {
          const operator = value as Record<string, unknown>
          if ('equals' in operator && fieldValue !== operator.equals) return false
          if ('not' in operator && fieldValue === operator.not) return false
          if ('in' in operator && !(operator.in as unknown[]).includes(fieldValue)) return false
          if ('notIn' in operator && (operator.notIn as unknown[]).includes(fieldValue))
            return false
          if ('gt' in operator && !(fieldValue > operator.gt)) return false
          if ('gte' in operator && !(fieldValue >= operator.gte)) return false
          if ('lt' in operator && !(fieldValue < operator.lt)) return false
          if ('lte' in operator && !(fieldValue <= operator.lte)) return false
          if (
            'contains' in operator &&
            !(typeof fieldValue === 'string' && fieldValue.includes(operator.contains as string))
          )
            return false
          if (
            'startsWith' in operator &&
            !(
              typeof fieldValue === 'string' && fieldValue.startsWith(operator.startsWith as string)
            )
          )
            return false
          if (
            'endsWith' in operator &&
            !(typeof fieldValue === 'string' && fieldValue.endsWith(operator.endsWith as string))
          )
            return false
        } else {
          // Direct equality
          if (fieldValue !== value) return false
        }
      }
    }
    return true
  }

  /**
   * Find a single record by ID
   */
  async findUnique(args: {
    where: { id: string }
    include?: Record<string, IncludeArgs>
  }): Promise<DatabaseRow | null> {
    const dialect = this.adapter.getDialect()
    const sql = `SELECT * FROM ${dialect.quoteIdentifier(this.tableName)} WHERE ${dialect.quoteIdentifier('id')} = ${dialect.getPlaceholder(0)} LIMIT 1`

    const record = await this.adapter.queryOne(sql, [args.where.id])
    if (!record) return null

    // Load relationships if requested
    if (args.include) {
      return this.loadRelationshipsForRecord(record, args.include)
    }

    return record
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
        ([field, direction]) => `${dialect.quoteIdentifier(field)} ${direction.toUpperCase()}`,
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
    const records = await this.adapter.query(sql, params)

    // Load relationships if requested
    if (args?.include) {
      return this.loadRelationshipsForRecords(records, args.include)
    }

    return records
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
    const setClauses = columns.map(
      (c, i) => `${dialect.quoteIdentifier(c)} = ${dialect.getPlaceholder(i)}`,
    )
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
    const parts: string[] = [
      `SELECT COUNT(*) as count FROM ${dialect.quoteIdentifier(this.tableName)}`,
    ]
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
