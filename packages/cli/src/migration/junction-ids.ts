import type { ContractLiteral, ContractModel } from '@opensaas/stack-core'
import type { LiveSchema } from './fk-renames.js'

export interface JunctionIdAddition {
  schema: string
  table: string
  strategy: ContractModel['id']['strategy']
  type: string
  args?: ContractLiteral[]
  replacesKey?: { name: string; columns: string[] }
  pairUnique?: { name: string; columns: string[]; asIndex: boolean }
}

export interface PrimaryKey {
  schema: string
  table: string
  name: string
  columns: string[]
}

const UUID7_EXPRESSION =
  `encode(set_bit(set_bit(overlay(uuid_send(gen_random_uuid()) placing ` +
  `substring(int8send(floor(extract(epoch from clock_timestamp()) * 1000)::bigint) from 3) ` +
  `from 1 for 6), 52, 1), 53, 1), 'hex')::uuid`

const quote = (identifier: string) => `"${identifier.replaceAll('"', '""')}"`

const sameColumns = (a: string[], b: string[]) =>
  a.length === b.length && a.every((c) => b.includes(c))

export function planJunctionIds(
  models: ContractModel[],
  live: LiveSchema,
  defaultSchema = 'public',
  primaryKeys: PrimaryKey[] = [],
): JunctionIdAddition[] {
  const additions: JunctionIdAddition[] = []
  for (const model of models) {
    if (model.id.strategy === 'singleton') continue
    const schema = model.namespace ?? defaultSchema
    const table = model.table ?? model.name
    const columns = live.columns.filter((c) => c.schema === schema && c.table === table)
    if (columns.length === 0 || columns.some((c) => c.column === 'id')) continue
    const key = primaryKeys.find((k) => k.schema === schema && k.table === table)
    const base = {
      schema,
      table,
      strategy: model.id.strategy,
      type: model.id.type.type,
      args: model.id.type.args,
    }
    if (key === undefined) {
      additions.push(base)
      continue
    }
    const pair = model.foreignKeys.map((fk) => fk.column)
    if (pair.length !== 2 || !sameColumns(key.columns, pair)) continue
    const declared = model.indexes.find((i) => i.unique && sameColumns(i.columns, pair))
    additions.push({
      ...base,
      replacesKey: { name: key.name, columns: key.columns },
      pairUnique: {
        name: declared?.name ?? `${table}_${pair.join('_')}_key`,
        columns: declared?.columns ?? pair,
        asIndex: declared?.asIndex ?? false,
      },
    })
  }
  return additions
}

function backfill(addition: JunctionIdAddition): string[] {
  const steps = backfillId(addition)
  const qualified = `${quote(addition.schema)}.${quote(addition.table)}`
  const { replacesKey, pairUnique } = addition
  if (replacesKey === undefined || pairUnique === undefined) return steps
  const columns = pairUnique.columns.map(quote).join(', ')
  const unique = pairUnique.asIndex
    ? `CREATE UNIQUE INDEX ${quote(pairUnique.name)} ON ${qualified} (${columns});`
    : `ALTER TABLE ${qualified} ADD CONSTRAINT ${quote(pairUnique.name)} UNIQUE (${columns});`
  return [`ALTER TABLE ${qualified} DROP CONSTRAINT ${quote(replacesKey.name)};`, ...steps, unique]
}

function backfillId(addition: JunctionIdAddition): string[] {
  const qualified = `${quote(addition.schema)}.${quote(addition.table)}`
  const add = (type: string) => `ALTER TABLE ${qualified} ADD COLUMN "id" ${type};`
  const fill = (expression: string) => `UPDATE ${qualified} SET "id" = ${expression};`
  const notNull = `ALTER TABLE ${qualified} ALTER COLUMN "id" SET NOT NULL;`
  const primaryKey = `ALTER TABLE ${qualified} ADD PRIMARY KEY ("id");`
  const columnType = addition.args ? `${addition.type}(${addition.args.join(', ')})` : addition.type

  switch (addition.strategy) {
    case 'uuid7':
      return [add(columnType), fill(UUID7_EXPRESSION), notNull, primaryKey]
    case 'cuid2':
      return [
        add(columnType),
        fill(`'c' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 23)`),
        notNull,
        primaryKey,
      ]
    case 'cuid':
      return [
        add(columnType),
        fill(`'c' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 24)`),
        notNull,
        primaryKey,
      ]
    default:
      return [add(addition.type === 'bigint' ? 'bigserial' : 'serial'), primaryKey]
  }
}

export function renderJunctionIdSql(additions: JunctionIdAddition[]): string {
  return ['BEGIN;', ...additions.flatMap(backfill), 'COMMIT;'].join('\n')
}
