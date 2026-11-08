'use client'

import { useEffect, useMemo, useState } from 'react'
import type { ServerActionInput } from '../server/types.js'
import type { FilterRecord, RecordLookup } from './filterBuilderOptions.js'

const LOOKUP_PAGE_SIZE = 10

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isFilterRecord(value: unknown): value is FilterRecord {
  return isRecord(value) && typeof value.id === 'string' && typeof value.label === 'string'
}

function recordsOf(result: unknown): FilterRecord[] {
  if (!isRecord(result) || !Array.isArray(result.options)) return []
  return result.options.filter(isFilterRecord)
}

export interface FilterRecordLookupOptions {
  serverAction?: (input: ServerActionInput) => Promise<unknown>
  listKey?: string
  /** The relationship field being looked up, or `null` while none is. */
  field: string | null
  query: string
  debounceMs?: number
}

/**
 * The first page of a relationship field's records, then those matching what
 * was typed, through the access-scoped `relationshipOptions` server action.
 * `null` when there is nothing to look up or no server action to ask.
 */
export function useFilterRecordLookup({
  serverAction,
  listKey,
  field,
  query,
  debounceMs = 250,
}: FilterRecordLookupOptions): RecordLookup | null {
  const search = query.trim()
  const key = field === null ? null : JSON.stringify([field, search])
  const [settled, setSettled] = useState<{ key: string; records: FilterRecord[] } | null>(null)

  useEffect(() => {
    if (!serverAction || !listKey || field === null || key === null) return
    let cancelled = false
    const timer = setTimeout(
      () => {
        serverAction({
          listKey,
          action: 'relationshipOptions',
          field,
          ...(search === '' ? {} : { search }),
          take: LOOKUP_PAGE_SIZE,
        })
          .then((result) => {
            if (!cancelled) setSettled({ key, records: recordsOf(result) })
          })
          .catch((error: unknown) => {
            if (cancelled) return
            console.error('Failed to look up related records:', error)
            setSettled({ key, records: [] })
          })
      },
      search === '' ? 0 : debounceMs,
    )
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [serverAction, listKey, field, search, key, debounceMs])

  const enabled = Boolean(serverAction && listKey) && key !== null
  const current = settled?.key === key ? settled : null
  return useMemo(() => {
    if (!enabled) return null
    return current ? { records: current.records, loading: false } : { records: [], loading: true }
  }, [enabled, current])
}
