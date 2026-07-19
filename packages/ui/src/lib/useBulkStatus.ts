'use client'

import * as React from 'react'

/**
 * The persisted "N of M deleted" report for a list's Bulk actions (issue #733).
 *
 * The report must outlive the table refresh a bulk delete triggers:
 * `router.refresh()` re-runs the async `ListView` Server Component behind the
 * admin `<Suspense>` boundary, which remounts `ListViewClient` and would discard
 * plain React state. Persisting the message in `sessionStorage` (read back via
 * `useSyncExternalStore`, the same store pattern as row selection) means the
 * report survives that remount and is shown against the refreshed table.
 */
export interface BulkStatus {
  /** The current report text, or `null` when there is none. */
  status: string | null
  /** Set (and persist) the report. */
  setStatus: (status: string) => void
  /** Clear the report (e.g. when the user starts a new selection). */
  clearStatus: () => void
}

function storageKeyFor(listKey: string): string {
  return `opensaas:bulk-status:${listKey}`
}

// Same-document change listeners per storage key (the `storage` event does not
// fire for same-document `sessionStorage` writes).
const listeners = new Map<string, Set<() => void>>()

function readValue(storageKey: string): string | null {
  try {
    const raw = window.sessionStorage.getItem(storageKey)
    return raw && raw.length > 0 ? raw : null
  } catch {
    return null
  }
}

function writeValue(storageKey: string, value: string | null): void {
  try {
    if (value === null) window.sessionStorage.removeItem(storageKey)
    else window.sessionStorage.setItem(storageKey, value)
  } catch {
    // Storage may be unavailable (private mode/quota) — notify anyway.
  }
  const set = listeners.get(storageKey)
  if (set) for (const listener of set) listener()
}

/**
 * Manage the persisted bulk-action report for one list. The value is a plain
 * string, so `getSnapshot` is stable by value (no reference caching needed).
 */
export function useBulkStatus(listKey: string): BulkStatus {
  const storageKey = storageKeyFor(listKey)

  const subscribe = React.useCallback(
    (onChange: () => void) => {
      let set = listeners.get(storageKey)
      if (!set) {
        set = new Set()
        listeners.set(storageKey, set)
      }
      set.add(onChange)
      const onStorage = (event: StorageEvent) => {
        if (event.key === storageKey) onChange()
      }
      window.addEventListener('storage', onStorage)
      return () => {
        set?.delete(onChange)
        window.removeEventListener('storage', onStorage)
      }
    },
    [storageKey],
  )

  const getSnapshot = React.useCallback(() => readValue(storageKey), [storageKey])
  const getServerSnapshot = React.useCallback(() => null, [])

  const status = React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)

  const setStatus = React.useCallback(
    (value: string) => writeValue(storageKey, value),
    [storageKey],
  )
  const clearStatus = React.useCallback(() => writeValue(storageKey, null), [storageKey])

  return { status, setStatus, clearStatus }
}
