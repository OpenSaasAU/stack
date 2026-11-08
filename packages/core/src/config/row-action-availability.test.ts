import { afterEach, describe, expect, test, vi } from 'vitest'
import { isRowActionAvailable } from './row-action-availability.js'
import type { RowAction } from './types.js'

describe('isRowActionAvailable', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('an action with no isAvailable is available', () => {
    expect(isRowActionAvailable({ key: 'a' }, 'Post', {}, null)).toBe(true)
  })

  test('a boolean result is used as is', () => {
    const item = { status: 'draft' }
    const draftOnly = {
      key: 'a',
      isAvailable: ({ item: row }: { item: Record<string, unknown> }) => row.status === 'draft',
    }
    expect(isRowActionAvailable(draftOnly, 'Post', item, null)).toBe(true)
    expect(isRowActionAvailable({ key: 'a', isAvailable: () => false }, 'Post', item, null)).toBe(
      false,
    )
  })

  test('a throw is logged and treated as unavailable', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    const thrown = new Error('bad row')
    const action = {
      key: 'a',
      isAvailable: (): boolean => {
        throw thrown
      },
    }
    expect(isRowActionAvailable(action, 'Post', {}, null)).toBe(false)
    expect(logged).toHaveBeenCalledWith(expect.stringContaining('isAvailable threw'), thrown)
  })

  test('a thenable is logged and treated as unavailable', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    const action: Pick<RowAction, 'key' | 'isAvailable'> = { key: 'a' }
    Object.assign(action, { isAvailable: async () => true })
    expect(isRowActionAvailable(action, 'Post', {}, null)).toBe(false)
    expect(logged).toHaveBeenCalledWith(expect.stringContaining('non-boolean'))
  })
})
