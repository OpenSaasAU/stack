import { describe, expect, test } from 'vitest'
import type { OpenSaasConfig } from '../config/types.js'
import { text } from '../fields/index.js'
import { listIdColumn, parseListId } from './id-boundary.js'

const UUID = '019606b0-1f36-7000-8000-0000000000ab'
const CUID = 'p1a2b3c4d5e6f7g8h9i0j1k2'

function config(): OpenSaasConfig {
  return {
    db: { provider: 'postgresql' },
    lists: {
      Post: { fields: { title: text() }, db: { idField: 'int autoincrement' } },
      User: { fields: { name: text() } },
      Tag: { fields: { name: text() }, db: { idField: 'cuid2' } },
      Settings: { fields: { name: text() }, isSingleton: true },
    },
  }
}

describe('the contract-driven id boundary (ADR-0048)', () => {
  test('reads the id column strategy per list, over the config default', () => {
    expect(listIdColumn(config(), 'Post')?.strategy).toBe('int autoincrement')
    expect(listIdColumn(config(), 'User')?.strategy).toBe('uuid7')
    expect(listIdColumn(config(), 'Tag')?.strategy).toBe('cuid2')
    expect(listIdColumn(config(), 'Settings')?.strategy).toBe('singleton')
    expect(listIdColumn(config(), 'Nowhere')).toBeNull()
  })

  test('an integer-keyed list parses to a number and refuses anything else', () => {
    expect(parseListId(config(), 'Post', '12')).toEqual({ ok: true, value: 12 })
    expect(parseListId(config(), 'Post', 12)).toEqual({ ok: true, value: 12 })
    expect(parseListId(config(), 'Post', 'not-an-int')).toEqual({ ok: false })
    expect(parseListId(config(), 'Post', '12.5')).toEqual({ ok: false })
    expect(parseListId(config(), 'Post', '')).toEqual({ ok: false })
    // Past the safe-integer range the value has already lost precision.
    expect(parseListId(config(), 'Post', '9007199254740993')).toEqual({ ok: false })
  })

  test('a singleton is integer-keyed regardless of the config default', () => {
    expect(parseListId(config(), 'Settings', '1')).toEqual({ ok: true, value: 1 })
    expect(parseListId(config(), 'Settings', 'one')).toEqual({ ok: false })
  })

  test('a uuid-keyed list refuses a value its column could not hold', () => {
    expect(parseListId(config(), 'User', UUID)).toEqual({ ok: true, value: UUID })
    expect(parseListId(config(), 'User', 'not-a-uuid')).toEqual({ ok: false })
    expect(parseListId(config(), 'User', 12)).toEqual({ ok: false })
  })

  test('a cuid2-keyed list refuses a value its column could not hold', () => {
    expect(parseListId(config(), 'Tag', CUID)).toEqual({ ok: true, value: CUID })
    expect(parseListId(config(), 'Tag', CUID.slice(0, 23))).toEqual({ ok: false })
    expect(parseListId(config(), 'Tag', UUID)).toEqual({ ok: false })
  })

  test('an id for a list the config does not declare is refused', () => {
    expect(parseListId(config(), 'Nowhere', UUID)).toEqual({ ok: false })
    // `config.lists.constructor` is `Object` on an object literal, so a bare
    // truthiness guard would pass it into the strategy lookup.
    expect(parseListId(config(), 'constructor', '1')).toEqual({ ok: false })
  })
})
