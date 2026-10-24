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
