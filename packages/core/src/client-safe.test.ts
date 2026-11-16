import { describe, expect, it } from 'vitest'
import * as clientSafe from './client-safe.js'
import * as root from './index.js'

describe('the client-safe entry', () => {
  it('re-exports the same bindings the root entry does', () => {
    const rootBindings = new Map<string, unknown>(Object.entries(root))
    for (const [name, value] of Object.entries(clientSafe)) {
      expect(rootBindings.get(name), name).toBe(value)
    }
  })

  it('carries the naming and filter helpers a client module imports', () => {
    expect(Object.keys(clientSafe).sort()).toEqual(
      [
        'FILTER_COMPARISON_PREFIXES',
        'FILTER_GROUP_KEYWORD',
        'FILTER_OPERATOR_PREFIXES',
        'buildFilterWhere',
        'effectiveFilterToken',
        'filterQueryTokens',
        'filterTermTokens',
        'filterTokenFreeTextWord',
        'filterTokenOperators',
        'filterTokenRecordId',
        'filterValueRecordId',
        'getListKeyFromUrl',
        'getUrlKey',
        'isEmptyFilterToken',
        'isFieldConditionToken',
        'parseFilterQuery',
        'quoteFilterValue',
        'recordIdFilterToken',
        'resolveListKeyFromUrl',
        'serializeFilterQuery',
        'supportsFilterRange',
      ].sort(),
    )
  })
})
