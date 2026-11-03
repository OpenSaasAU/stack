import type { ContractLiteral, ContractModel } from '@opensaas/stack-core'
import type { LiveSchema } from './fk-renames.js'

export interface JunctionIdAddition {
  schema: string
  table: string
  strategy: ContractModel['id']['strategy']
  type: string
  args?: ContractLiteral[]
}

const UUID7_EXPRESSION =
  `encode(set_bit(set_bit(overlay(uuid_send(gen_random_uuid()) placing ` +
  `substring(int8send(floor(extract(epoch from clock_timestamp()) * 1000)::bigint) from 3) ` +
  `from 1 for 6), 52, 1), 53, 1), 'hex')::uuid`

const quote = (identifier: string) => `"${identifier.replaceAll('"', '""')}"`

export function planJunctionIds(
  models: ContractModel[],
  live: LiveSchema,
  defaultSchema = 'public',
  primaryKeys: Array<{ schema: string; table: string }> = [],
): JunctionIdAddition[] {
  const additions: JunctionIdAddition[] = []
  for (const model of models) {
    if (model.id.strategy === 'singleton') continue
    const schema = model.namespace ?? defaultSchema
    const table = model.table ?? model.name
    const columns = live.columns.filter((c) => c.schema === schema && c.table === table)
    if (columns.length === 0 || columns.some((c) => c.column === 'id')) continue
    if (primaryKeys.some((k) => k.schema === schema && k.table === table)) continue
    additions.push({
      schema,
      table,
      strategy: model.id.strategy,
      type: model.id.type.type,
      args: model.id.type.args,
    })
  }
  return additions
}

function backfill(addition: JunctionIdAddition): string[] {
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
