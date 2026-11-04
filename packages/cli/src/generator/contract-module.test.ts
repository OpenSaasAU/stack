import { describe, it, expect } from 'vitest'
import type { ContractData } from '@opensaas/stack-core'
import { renderContractModule } from './contract-module.js'

describe('renderContractModule', () => {
  it("escapes a quote in an extension's from", () => {
    const data: ContractData = {
      models: [],
      namespaces: [],
      enums: [],
      extensions: [{ name: 'pack', from: "@acme/it's" }],
    }

    expect(renderContractModule(data)).toContain("import pack from '@acme/it\\'s/pack'")
  })
})

describe('renderContractModule partial indexes', () => {
  const model = (where: string): ContractData => ({
    models: [
      {
        name: 'A',
        singleton: false,
        id: { strategy: 'uuid7', type: { pack: 'pg', type: 'uuid' } },
        timestamps: { createdAt: false, updatedAt: false },
        columns: [
          {
            name: 'name',
            type: { pack: 'pg', type: 'text' },
            nullable: false,
            unique: false,
            index: false,
          },
        ],
        indexes: [{ columns: ['name'], unique: true, name: 'A_name_idx', where }],
        foreignKeys: [],
        relations: [],
      },
    ],
    namespaces: [],
    enums: [],
    extensions: [],
  })

  it('emits a unique where as a sql index, not a unique constraint', () => {
    const out = renderContractModule(model(`"name" <> ''`))
    expect(out).toContain('unique: true')
    expect(out).toContain('where: sql(')
    expect(out).toContain('import { defineContract, sql } from')
    expect(out).toMatch(/uniques: \[\],/)
  })

  it('emits a unique flagged asIndex as a unique index, not a constraint', () => {
    const data = model(`"name" <> ''`)
    const [first] = data.models
    if (first === undefined) throw new Error('fixture has no model')
    first.indexes = [{ columns: ['name'], unique: true, name: 'A_name_key', asIndex: true }]
    const out = renderContractModule(data)
    expect(out).toContain("map: 'A_name_key'")
    expect(out).toContain('unique: true')
    expect(out).toMatch(/uniques: \[\],/)
  })

  it('keeps quotes, backticks and template syntax inside a string literal', () => {
    const where = "kind = 'X' AND note <> `a${b}\\`"
    const out = renderContractModule(model(where))
    expect(out).toContain('Object.assign([')
    expect(out).toContain('${b}')
    expect(out).not.toContain('sql`')
  })
})

describe('renderContractModule updatedAt', () => {
  const withTimestamps = (timestampType?: ContractData['models'][number]['timestampType']) => {
    const data: ContractData = {
      models: [
        {
          name: 'A',
          singleton: false,
          id: { strategy: 'uuid7', type: { pack: 'pg', type: 'uuid' } },
          timestamps: { createdAt: true, updatedAt: true },
          ...(timestampType ? { timestampType } : {}),
          columns: [],
          indexes: [],
          foreignKeys: [],
          relations: [],
        },
      ],
      namespaces: [],
      enums: [],
      extensions: [],
    }
    return renderContractModule(data)
  }

  it('keeps timestamptz when no default is set', () => {
    expect(withTimestamps()).toContain(
      'updatedAt: field.column(type.TimestamptzString()).onCreate(gen.now()).onUpdate(gen.now()),',
    )
  })

  it('follows the timestamp default and keeps no database default', () => {
    const out = withTimestamps({ pack: 'pg', type: 'timestamp', args: [3] })
    const line = out.split('\n').find((l) => l.includes('updatedAt:'))
    expect(line).toContain('timestampStringColumn')
    expect(line).toContain('.onCreate(gen.now()).onUpdate(gen.now())')
    expect(line).not.toContain('defaultSql')
    expect(line).not.toContain('TimestamptzString')
  })
})
