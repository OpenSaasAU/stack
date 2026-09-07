import { readFileSync } from 'fs'
import { join } from 'path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { text } from '../../../core/src/fields/index.js'
import type { OpenSaasConfig } from '../../../core/src/config/types.js'
import {
  CONSUMER_PRELUDE,
  emitTypeFixture,
  type TypeFixture,
} from '../../tests/emit-type-fixture.js'

/**
 * `db.keystoneCompat` on both faces of the same four fields.
 *
 * A column default drops the column from the required half of `CreateInput`
 * (`RequiredCreateColumn`, `core/src/types/inputs.ts`), while the runtime goes
 * on validating through the field's own `getZodSchema`. Asserting the emitted
 * column alone leaves those two free to disagree — a compat default carried
 * where the validator refuses an omission type-checks a `create` that then
 * throws. This file pins the column, the validator and the generated input
 * together.
 */
const keystoneCompatConfig: OpenSaasConfig = {
  db: { provider: 'postgresql', keystoneCompat: true },
  lists: {
    User: {
      fields: {
        // Non-null through validation: its create schema refuses `''`.
        name: text({ validation: { isRequired: true } }),
        // Non-null at the database only: its create schema accepts `''`.
        phone: text({ db: { isNullable: false } }),
        // Non-null with a non-empty minimum: refuses `''` as `name` does.
        code: text({ db: { isNullable: false }, validation: { length: { min: 2 } } }),
        bio: text(),
      },
    },
  },
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** One table's `columns` map out of the emitted contract's storage section. */
function emittedColumns(json: string, table: string): Record<string, unknown> {
  let node: unknown = JSON.parse(json)
  for (const key of ['storage', 'namespaces', 'public', 'entries', 'table', table, 'columns']) {
    if (!isRecord(node)) throw new Error(`the emitted contract has no "${key}" under it`)
    node = node[key]
  }
  if (!isRecord(node)) throw new Error(`the emitted "${table}" carries no columns`)
  return node
}

function columnDefault(columns: Record<string, unknown>, column: string): unknown {
  const entry = columns[column]
  if (!isRecord(entry)) throw new Error(`the emitted table has no column "${column}"`)
  return entry.default
}

/** Whether the field's create validator accepts the `''` the compat default fills. */
function createAcceptsEmptyString(fieldKey: string): boolean {
  const field = keystoneCompatConfig.lists.User?.fields[fieldKey]
  if (field?.getZodSchema === undefined) throw new Error(`"${fieldKey}" declares no getZodSchema`)
  return field.getZodSchema(fieldKey, 'create').safeParse('').success
}

describe('db.keystoneCompat, on the emitted column, the validator and the create input', () => {
  let fixture: TypeFixture
  let columns: Record<string, unknown>

  beforeAll(async () => {
    fixture = await emitTypeFixture('keystone-compat', keystoneCompatConfig)
    columns = emittedColumns(
      readFileSync(join(fixture.projectDir, 'prisma', 'contract.json'), 'utf-8'),
      'User',
    )
  }, 300_000)

  afterAll(() => {
    fixture?.cleanup()
  })

  it('carries the compat default only on the non-null column whose validator accepts ""', () => {
    expect(columnDefault(columns, 'phone')).toEqual({ kind: 'literal', value: '' })
    expect(columnDefault(columns, 'name')).toBeUndefined()
    expect(columnDefault(columns, 'code')).toBeUndefined()
    expect(columnDefault(columns, 'bio')).toBeUndefined()
  })

  it('gives a default only where the validator accepts the value it fills', () => {
    expect(createAcceptsEmptyString('name')).toBe(false)
    expect(createAcceptsEmptyString('code')).toBe(false)
    expect(createAcceptsEmptyString('phone')).toBe(true)
    expect(createAcceptsEmptyString('bio')).toBe(true)
  })

  it(
    'leaves required on create every field whose validator refuses ""',
    { timeout: 300_000 },
    () => {
      const output = fixture.check(`${CONSUMER_PRELUDE}
import type { Context } from './.opensaas/types.ts'

declare const context: Context

async function run() {
  await context.db.User.create({ data: { name: 'Ada', code: 'AB' } })

  await context.db.User.create({
    // @ts-expect-error \`name\`'s validator refuses '', so it carries no default and stays required
    data: { code: 'AB' },
  })

  await context.db.User.create({
    // @ts-expect-error \`code\`'s validator refuses '', so it carries no default and stays required
    data: { name: 'Ada' },
  })

  await context.db.User.create({ data: { name: 'Ada', code: 'AB', phone: '+61', bio: null } })
}
void run
`)
      expect(output).toBe('')
    },
  )
})
