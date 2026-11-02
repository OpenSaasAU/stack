import type { ContractModel } from '@opensaas/stack-core'

export interface LiveColumn {
  schema: string
  table: string
  column: string
  type: string
}

export interface LiveSchema {
  columns: LiveColumn[]
  constraints: Array<{ schema: string; table: string; name: string }>
  indexes: Array<{ schema: string; name: string }>
}

export interface FkRename {
  schema: string
  table: string
  from: string
  to: string
  constraints: Array<{ from: string; to: string }>
  indexes: Array<{ from: string; to: string }>
}

export class FkRenameConflictError extends Error {
  constructor(table: string, from: string, to: string) {
    super(
      `${table}.${from} and ${table}.${to} both exist; refusing to rename. ` +
        `Reconcile the two columns by hand, then re-run.`,
    )
    this.name = 'FkRenameConflictError'
  }
}

const MAX_IDENTIFIER_BYTES = 63

function clipIdentifier(name: string): string {
  const bytes = Buffer.from(name, 'utf8')
  if (bytes.length <= MAX_IDENTIFIER_BYTES) return name
  return new TextDecoder('utf-8', { fatal: false })
    .decode(bytes.subarray(0, MAX_IDENTIFIER_BYTES))
    .replace(/\uFFFD+$/, '')
}

export function planFkRenames(
  models: ContractModel[],
  live: LiveSchema,
  defaultSchema = 'public',
): FkRename[] {
  const DEFAULT_SCHEMA = defaultSchema
  const byName = new Map(models.map((model) => [model.name, model]))
  const findColumn = (schema: string, table: string, column: string) =>
    live.columns.find((c) => c.schema === schema && c.table === table && c.column === column)

  const renames: FkRename[] = []
  for (const model of models) {
    const schema = model.namespace ?? DEFAULT_SCHEMA
    const table = model.table ?? model.name

    for (const relation of model.relations) {
      if (relation.kind !== 'belongsTo' || relation.synthetic) continue
      const to = relation.column
      const owned = model.columns.find((column) => column.name === to)
      if (owned === undefined || owned.map !== undefined) continue
      if (to !== `${relation.name}Id`) continue

      const from = relation.name
      const oldColumn = findColumn(schema, table, from)
      if (oldColumn === undefined) continue
      if (findColumn(schema, table, to) !== undefined) {
        throw new FkRenameConflictError(table, from, to)
      }

      const target = byName.get(relation.target)
      if (target === undefined) continue
      const targetId = findColumn(
        target.namespace ?? DEFAULT_SCHEMA,
        target.table ?? target.name,
        'id',
      )
      if (targetId === undefined || targetId.type !== oldColumn.type) continue

      const constraints = live.constraints
        .filter((c) => c.schema === schema && c.table === table)
        .flatMap((c) => renamed(c.name, table, from, to))
      const indexes = live.indexes
        .filter((i) => i.schema === schema)
        .filter((i) => !constraints.some((c) => c.from === i.name))
        .flatMap((i) => renamed(i.name, table, from, to))

      renames.push({ schema, table, from, to, constraints, indexes })
    }
  }
  return renames
}

function renamed(name: string, table: string, from: string, to: string) {
  for (const suffix of ['fkey', 'key', 'idx']) {
    if (name === clipIdentifier(`${table}_${from}_${suffix}`)) {
      return [{ from: name, to: clipIdentifier(`${table}_${to}_${suffix}`) }]
    }
  }
  return []
}

const quote = (identifier: string) => `"${identifier.replaceAll('"', '""')}"`

export function renderFkRenameSql(renames: FkRename[]): string {
  const statements = renames.flatMap((rename) => {
    const qualified = `${quote(rename.schema)}.${quote(rename.table)}`
    return [
      `ALTER TABLE ${qualified} RENAME COLUMN ${quote(rename.from)} TO ${quote(rename.to)};`,
      ...rename.constraints.map(
        (c) => `ALTER TABLE ${qualified} RENAME CONSTRAINT ${quote(c.from)} TO ${quote(c.to)};`,
      ),
      ...rename.indexes.map(
        (i) => `ALTER INDEX ${quote(rename.schema)}.${quote(i.from)} RENAME TO ${quote(i.to)};`,
      ),
    ]
  })
  return statements.join('\n')
}
