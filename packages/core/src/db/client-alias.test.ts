import { describe, expect, it } from 'vitest'
import * as alias from './client-alias.js'
import * as dbClient from './client.js'

describe('the deprecated client alias', () => {
  it('exports exactly the db-client bindings, by reference', () => {
    expect(Object.keys(alias).sort()).toEqual(Object.keys(dbClient).sort())
    const dbClientBindings = new Map<string, unknown>(Object.entries(dbClient))
    for (const [name, value] of Object.entries(alias)) {
      expect(dbClientBindings.get(name), name).toBe(value)
    }
  })
})
