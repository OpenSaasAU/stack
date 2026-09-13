import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useRelationshipSearch } from '../../src/lib/useRelationshipSearch.js'
import type { ServerActionInput } from '../../src/server/types.js'

/** A promise plus its own settle functions, for controlling resolution order in a test. */
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('useRelationshipSearch — loadOnOpen (#1365)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('stays "searching" until BOTH the open-fetch and an overlapping debounced search settle', async () => {
    // The control opens (starts the deferred #1365 fetch) and the user
    // types before that fetch resolves — a second, debounced fetch starts
    // while the first is still in flight. If they shared a plain boolean,
    // whichever settles first would flip it off while the other is still
    // pending, flashing "no results" over a search that hasn't finished.
    const openFetch = deferred<unknown>()
    const searchFetch = deferred<unknown>()
    // The mock only cares about `search`; the hook's real actions always
    // carry `action: 'relationshipOptions'` plus `listKey`/`field`, which this
    // test does not need to assert on.
    const serverAction = vi.fn((input: { search?: string }) =>
      input.search ? searchFetch.promise : openFetch.promise,
    ) as unknown as (input: ServerActionInput) => Promise<unknown>

    const { result, rerender } = renderHook(
      (props: { loadOnOpen: boolean }) =>
        useRelationshipSearch({
          initialItems: [],
          listKey: 'Post',
          fieldName: 'author',
          serverAction,
          loadOnOpen: props.loadOnOpen,
        }),
      { initialProps: { loadOnOpen: false } },
    )

    rerender({ loadOnOpen: true })
    expect(result.current.isSearching).toBe(true)

    act(() => result.current.setSearchQuery('be'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300)
    })
    expect(serverAction).toHaveBeenCalledTimes(2)
    expect(result.current.isSearching).toBe(true)

    // The open-fetch settles first; the debounced search is still pending.
    await act(async () => {
      openFetch.resolve({ success: true, data: [{ id: 'p1', label: 'Owned' }] })
    })
    expect(result.current.isSearching).toBe(true)

    await act(async () => {
      searchFetch.resolve({ success: true, data: [{ id: 'p2', label: 'Beta' }] })
    })
    expect(result.current.isSearching).toBe(false)
    expect(result.current.searchResults).toEqual([{ id: 'p2', label: 'Beta' }])
  })

  it('retries the open-fetch on the next open after a failure, rather than staying empty forever', async () => {
    const serverAction = vi
      .fn()
      .mockRejectedValueOnce(new Error('network error'))
      .mockResolvedValueOnce({ success: true, data: [{ id: 'p1', label: 'Owned' }] })
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    const { result, rerender } = renderHook(
      (props: { loadOnOpen: boolean }) =>
        useRelationshipSearch({
          initialItems: [],
          listKey: 'Post',
          fieldName: 'author',
          serverAction,
          loadOnOpen: props.loadOnOpen,
        }),
      { initialProps: { loadOnOpen: false } },
    )

    rerender({ loadOnOpen: true })
    await act(async () => {})
    expect(serverAction).toHaveBeenCalledTimes(1)
    expect(result.current.searchResults).toEqual([])

    // Close and reopen the control — a real retry, not a fetch already stuck
    // behind a guard that only ever fires once.
    rerender({ loadOnOpen: false })
    rerender({ loadOnOpen: true })
    await act(async () => {})

    expect(serverAction).toHaveBeenCalledTimes(2)
    expect(result.current.searchResults).toEqual([{ id: 'p1', label: 'Owned' }])

    consoleError.mockRestore()
  })
})
