import { describe, it, expect } from 'vitest'
import ts from 'typescript'
import { deriveDependencyTable, type OpenSaasConfig } from '@opensaas/stack-core'
import { select, text } from '@opensaas/stack-core/fields'
import { generateTypes } from './types.js'
import { generateListsNamespace } from './lists.js'

const syntaxErrors = (source: string): number =>
  ts.transpileModule(source, { reportDiagnostics: true, fileName: 'x.ts' }).diagnostics?.length ?? 0

const configWith = (fields: OpenSaasConfig['lists'][string]['fields']): OpenSaasConfig => ({
  db: { provider: 'postgresql' },
  lists: { Post: { fields } },
})

describe('generated bundle source text', () => {
  it('parses and round-trips a quote and newline in a select option value', () => {
    const config = configWith({
      mood: select({
        options: [
          { value: "won't", label: "Won't" },
          { value: 'a\nb', label: 'A B' },
        ],
      }),
    })
    const types = generateTypes(config, deriveDependencyTable(config))
    const lists = generateListsNamespace(config, deriveDependencyTable(config))
    expect(types).toContain("'won\\'t' | 'a\\nb'")
    expect(syntaxErrors(types)).toBe(0)
    expect(syntaxErrors(lists)).toBe(0)
  })

  it('refuses a field key that is not an identifier, naming list and field', () => {
    const config = configWith({ 'first-name': text() })
    const dependencies = deriveDependencyTable(config)
    const message = /List "Post", field "first-name"/
    expect(() => generateTypes(config, dependencies)).toThrow(message)
    expect(() => generateListsNamespace(config, dependencies)).toThrow(message)
  })
})
