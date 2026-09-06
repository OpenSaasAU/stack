import { describe, it, expect } from 'vitest'
import * as core from './index.js'
import * as internal from './internal.js'

/**
 * The fragment API is gone (ADR-0041): a read is narrowed by `.select()` on
 * the secured surface, which the engine honours exactly rather than by
 * projecting a full row down afterwards. Asserted against the entry points
 * the migration guide used to advertise, so a re-export cannot quietly come
 * back.
 */
describe('the fragment API is deleted', () => {
  const names = [
    'defineFragment',
    'runQuery',
    'runQueryOne',
    'buildInclude',
    'pickFields',
    'isFragment',
    'buildFieldSelectionScope',
  ]

  it.each(names)('the root entry point exports no %s', (name) => {
    expect(name in core).toBe(false)
  })

  it.each(names)('the internal entry point exports no %s', (name) => {
    expect(name in internal).toBe(false)
  })

  it('is asserted against entry points that do export things', () => {
    expect('config' in core).toBe(true)
    expect(Object.keys(internal).length).toBeGreaterThan(0)
  })
})
