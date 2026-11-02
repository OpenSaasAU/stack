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

  it('keeps quotes, backticks and template syntax inside a string literal', () => {
    const where = "kind = 'X' AND note <> `a${b}\\`"
    const out = renderContractModule(model(where))
    expect(out).toContain('Object.assign([')
    expect(out).toContain('${b}')
    expect(out).not.toContain('sql`')
  })
})
