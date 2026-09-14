import { describe, expect, test } from 'vitest'
import type { OpenSaasConfig } from '../config/types.js'
import { relationship, text } from '../fields/index.js'
import { coerceWhereIds, idBoundaryRefusal } from './where-id-boundary.js'

/** A minimal config: an int-keyed list, a string-keyed list relating to it both ways. */
function config(): OpenSaasConfig {
  return {
    db: { provider: 'postgresql' },
    lists: {
      Counter: {
        fields: { label: text() },
        db: { idField: 'int autoincrement' },
        access: { operation: {} },
      },
      Tally: {
        fields: { label: text(), counter: relationship({ ref: 'Counter' }) },
        access: { operation: {} },
      },
    },
  }
}

describe('coerceWhereIds', () => {
  test('coerces a bare id, and in/notIn, at the top level', () => {
    expect(coerceWhereIds({ id: '3' }, config(), 'Counter')).toEqual({ id: 3 })
    expect(coerceWhereIds({ id: { in: ['3', '4'] } }, config(), 'Counter')).toEqual({
      id: { in: [3, 4] },
    })
    expect(coerceWhereIds({ id: { notIn: ['3'] } }, config(), 'Counter')).toEqual({
      id: { notIn: [3] },
    })
  })

  test('refuses (returns null) a malformed id at the top level', () => {
    expect(coerceWhereIds({ id: 'not-an-int' }, config(), 'Counter')).toBeNull()
    expect(coerceWhereIds({ id: { in: ['not-an-int'] } }, config(), 'Counter')).toBeNull()
  })

  test('a string-keyed list is unaffected: contains and a non-numeric id pass through', () => {
    expect(coerceWhereIds({ id: 'anything', label: { contains: 'x' } }, config(), 'Tally')).toEqual(
      { id: 'anything', label: { contains: 'x' } },
    )
  })

  test('walks AND/OR/NOT at any depth, coercing every id it finds', () => {
    expect(coerceWhereIds({ AND: [{ id: '3' }] }, config(), 'Counter')).toEqual({
      AND: [{ id: 3 }],
    })
    expect(coerceWhereIds({ OR: [{ id: '3' }, { id: '4' }] }, config(), 'Counter')).toEqual({
      OR: [{ id: 3 }, { id: 4 }],
    })
    // NOT's value is a single predicate object, not an array.
    expect(coerceWhereIds({ NOT: { id: '3' } }, config(), 'Counter')).toEqual({ NOT: { id: 3 } })
    expect(coerceWhereIds({ AND: [{ OR: [{ NOT: { id: '3' } }] }] }, config(), 'Counter')).toEqual({
      AND: [{ OR: [{ NOT: { id: 3 } }] }],
    })
  })

  test('refuses the whole predicate on a malformed id in any AND/OR/NOT branch, at any depth', () => {
    expect(coerceWhereIds({ AND: [{ id: 'bad' }] }, config(), 'Counter')).toBeNull()
    expect(
      coerceWhereIds({ OR: [{ label: { equals: 'x' } }, { id: 'bad' }] }, config(), 'Counter'),
    ).toBeNull()
    expect(coerceWhereIds({ NOT: { id: 'bad' } }, config(), 'Counter')).toBeNull()
    expect(
      coerceWhereIds({ AND: [{ OR: [{ NOT: { id: 'bad' } }] }] }, config(), 'Counter'),
    ).toBeNull()
  })

  test("a relation quantifier's nested predicate is coerced against the RELATED list's id strategy", () => {
    // Tally itself is string-keyed, but its `counter` relation targets the
    // int-keyed Counter — the nested predicate filters Counter's own rows.
    expect(coerceWhereIds({ counter: { some: { id: '3' } } }, config(), 'Tally')).toEqual({
      counter: { some: { id: 3 } },
    })
    expect(coerceWhereIds({ counter: { some: { id: 'bad' } } }, config(), 'Tally')).toBeNull()
    expect(coerceWhereIds({ counter: { every: { id: 'bad' } } }, config(), 'Tally')).toBeNull()
    expect(coerceWhereIds({ counter: { none: { id: 'bad' } } }, config(), 'Tally')).toBeNull()
  })

  test('a non-relationship field is left untouched even if its value looks like a relation condition', () => {
    expect(coerceWhereIds({ label: { some: { id: 'bad' } } }, config(), 'Tally')).toEqual({
      label: { some: { id: 'bad' } },
    })
  })

  test('an unknown list is passed through unchanged for downstream validation to refuse', () => {
    expect(coerceWhereIds({ id: 'anything' }, config(), 'Nope')).toEqual({ id: 'anything' })
  })
})

describe('idBoundaryRefusal', () => {
  test('reads the same way for every operation label', () => {
    expect(idBoundaryRefusal('query records')).toBe(
      'Failed to query records. Access denied or record not found.',
    )
    expect(idBoundaryRefusal('update record')).toBe(
      'Failed to update record. Access denied or record not found.',
    )
    expect(idBoundaryRefusal('delete record')).toBe(
      'Failed to delete record. Access denied or record not found.',
    )
  })
})
