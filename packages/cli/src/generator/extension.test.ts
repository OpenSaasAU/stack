import { describe, it, expect } from 'vitest'
import { withTsExtension } from './extension.js'

describe('withTsExtension', () => {
  it('appends .ts to extensionless relative specifiers', () => {
    expect(withTsExtension('./types')).toBe('./types.ts')
    expect(withTsExtension('../opensaas.config')).toBe('../opensaas.config.ts')
    expect(withTsExtension('./prisma-client/client')).toBe('./prisma-client/client.ts')
  })

  it('is idempotent — never doubles an existing explicit extension', () => {
    expect(withTsExtension('./types.ts')).toBe('./types.ts')
    expect(withTsExtension('../opensaas.config.ts')).toBe('../opensaas.config.ts')
    expect(withTsExtension('./client.js')).toBe('./client.js')
    expect(withTsExtension('./data.json')).toBe('./data.json')
  })

  it('leaves bare package specifiers untouched', () => {
    expect(withTsExtension('@opensaas/stack-core')).toBe('@opensaas/stack-core')
    expect(withTsExtension('@opensaas/stack-core/internal')).toBe('@opensaas/stack-core/internal')
    expect(withTsExtension('decimal.js')).toBe('decimal.js')
  })
})
