'use client'

import * as React from 'react'

export interface BulkStatus {
  /** The report to show on this mount, or `null` when there is none. */
  status: string | null
  /** Show the report and hand it to the next mount of this list (the refresh that follows the action). */
  setStatus: (status: string, options?: { handoff?: boolean }) => void
  /** Dismiss the report. */
  clearStatus: () => void
}

const KEY_PREFIX = 'opensaas:bulk-status:'
const pending = new Set<string>()

function storageKeyFor(listKey: string): string {
  return `${KEY_PREFIX}${listKey}`
}

function takeHandoff(storageKey: string): string | null {
  try {
    const raw = window.sessionStorage.getItem(storageKey)
    window.sessionStorage.removeItem(storageKey)
    const live = pending.delete(storageKey)
    if (!raw || !live) return null
    const parsed: unknown = JSON.parse(raw)
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'text' in parsed &&
      'at' in parsed &&
      typeof parsed.text === 'string' &&
      typeof parsed.at === 'number'
    ) {
      return parsed.text
    }
    return null
  } catch {
    return null
  }
}

export function clearAllBulkStatuses(): void {
  pending.clear()
  try {
    const keys: string[] = []
    for (let i = 0; i < window.sessionStorage.length; i++) {
      const key = window.sessionStorage.key(i)
      if (key !== null && key.startsWith(KEY_PREFIX)) keys.push(key)
    }
    for (const key of keys) window.sessionStorage.removeItem(key)
  } catch {
    // Storage unavailable: nothing was persisted.
  }
}

export function useBulkStatus(listKey: string, resetKey?: string): BulkStatus {
  const storageKey = storageKeyFor(listKey)
  const [status, setLocal] = React.useState<string | null>(null)

  React.useEffect(() => {
    const handed = takeHandoff(storageKey)
    // Reading sessionStorage must wait for the client to avoid a hydration mismatch.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLocal(handed)
  }, [storageKey])

  const lastResetKey = React.useRef(resetKey)
  React.useEffect(() => {
    if (lastResetKey.current === resetKey) return
    lastResetKey.current = resetKey
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLocal(null)
    pending.delete(storageKey)
    try {
      window.sessionStorage.removeItem(storageKey)
    } catch {
      // Storage unavailable: nothing to remove.
    }
  }, [resetKey, storageKey])

  React.useEffect(
    () => () => {
      // A remount takes the entry in the same commit, before this runs.
      setTimeout(() => {
        pending.delete(storageKey)
        try {
          window.sessionStorage.removeItem(storageKey)
        } catch {
          // Storage unavailable: nothing to remove.
        }
      }, 0)
    },
    [storageKey],
  )

  const setStatus = React.useCallback(
    (value: string, options?: { handoff?: boolean }) => {
      setLocal(value)
      if (options?.handoff !== true) return
      pending.add(storageKey)
      try {
        window.sessionStorage.setItem(storageKey, JSON.stringify({ text: value, at: Date.now() }))
      } catch {
        // Storage unavailable: the report shows without surviving a remount.
      }
    },
    [storageKey],
  )

  const clearStatus = React.useCallback(() => {
    setLocal(null)
    pending.delete(storageKey)
    try {
      window.sessionStorage.removeItem(storageKey)
    } catch {
      // Storage unavailable: nothing to remove.
    }
  }, [storageKey])

  return { status, setStatus, clearStatus }
}
