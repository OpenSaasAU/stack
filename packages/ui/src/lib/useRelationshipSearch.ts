'use client'

import { useEffect, useRef, useState } from 'react'
import type { ServerActionInput } from '../server/types.js'

export interface RelationshipSearchOption {
  id: string
  label: string
}

export interface UseRelationshipSearchOptions {
  /** The server-rendered initial window — shown before any search query, and used as the client-side filter fallback when no server action is wired. */
  initialItems: RelationshipSearchOption[]
  /** Raw list key of the list being edited (e.g. `'Post'`), not the related list. */
  listKey?: string
  /** The relationship field's name on that list (e.g. `'author'`). */
  fieldName?: string
  serverAction?: (input: ServerActionInput) => Promise<unknown>
  /** Currently-selected id(s), unioned server-side so their label always resolves. */
  selectedIds?: string[]
  debounceMs?: number
}

export interface UseRelationshipSearchResult {
  searchQuery: string
  setSearchQuery: (query: string) => void
  /** Candidate options for the current query — the initial window when empty, the live search response otherwise. */
  searchResults: RelationshipSearchOption[]
  isSearching: boolean
  /** Resolves a label for any id ever seen (initial window or a past search response), so a value stays labelled once fetched. */
  resolveLabel: (id: string) => string | undefined
}

function extractOptions(result: unknown): RelationshipSearchOption[] {
  if (
    result &&
    typeof result === 'object' &&
    (result as { success?: unknown }).success === true &&
    Array.isArray((result as { data?: unknown }).data)
  ) {
    return (result as { data: RelationshipSearchOption[] }).data
  }
  return []
}

/**
 * Debounced live search over the `relationshipOptions` serverAction op,
 * seeded with the server-rendered initial window.
 *
 * Falls back to client-side filtering over `initialItems` when no
 * `serverAction`/`listKey`/`fieldName` is supplied.
 */
export function useRelationshipSearch({
  initialItems,
  listKey,
  fieldName,
  serverAction,
  selectedIds = [],
  debounceMs = 300,
}: UseRelationshipSearchOptions): UseRelationshipSearchResult {
  const [searchQuery, setSearchQuery] = useState('')
  // Only ever written from a resolved server search response — never derived
  // from render inputs — so it's a legitimate piece of state, not a value
  // that belongs in an effect-driven copy of props.
  const [liveResults, setLiveResults] = useState<RelationshipSearchOption[] | null>(null)
  const [isSearching, setIsSearching] = useState(false)
  const [fetchedLabels, setFetchedLabels] = useState<Map<string, string>>(new Map())

  const canSearchServer = Boolean(serverAction && listKey && fieldName)
  const trimmedQuery = searchQuery.trim()

  // Props that change often (inline callbacks, freshly-derived arrays) are
  // read from a ref inside the debounced callback so the search effect only
  // re-runs when the query itself (or the search mode) changes. Updated in an
  // effect (not during render) per the rules of hooks.
  const latestRef = useRef({ serverAction, listKey, fieldName, selectedIds })
  useEffect(() => {
    latestRef.current = { serverAction, listKey, fieldName, selectedIds }
  })

  // Derived directly from render inputs — no effect needed for the
  // no-server / empty-query cases.
  const searchResults = !canSearchServer
    ? trimmedQuery
      ? initialItems.filter((item) => item.label.toLowerCase().includes(trimmedQuery.toLowerCase()))
      : initialItems
    : trimmedQuery
      ? (liveResults ?? [])
      : initialItems

  // The debounced server search is the one genuine side effect — it
  // synchronizes with an external system (the server action).
  useEffect(() => {
    if (!canSearchServer || !trimmedQuery) {
      return
    }

    let cancelled = false
    const timer = setTimeout(() => {
      setIsSearching(true)
      const {
        serverAction: action,
        listKey: currentListKey,
        fieldName: currentFieldName,
        selectedIds: currentSelectedIds,
      } = latestRef.current
      void action!({
        listKey: currentListKey!,
        action: 'relationshipOptions',
        field: currentFieldName!,
        search: trimmedQuery,
        selectedIds: currentSelectedIds,
      })
        .then((result) => {
          if (cancelled) return
          const options = extractOptions(result)
          setLiveResults(options)
          setFetchedLabels((prev) => {
            if (options.length === 0) return prev
            let changed = false
            const next = new Map(prev)
            for (const { id, label } of options) {
              if (next.get(id) !== label) {
                next.set(id, label)
                changed = true
              }
            }
            return changed ? next : prev
          })
        })
        .catch((error: unknown) => {
          if (cancelled) return
          console.error('Failed to search relationship options:', error)
          setLiveResults([])
        })
        .finally(() => {
          if (!cancelled) setIsSearching(false)
        })
    }, debounceMs)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [trimmedQuery, canSearchServer, debounceMs])

  const resolveLabel = (id: string) =>
    fetchedLabels.get(id) ?? initialItems.find((item) => item.id === id)?.label

  return { searchQuery, setSearchQuery, searchResults, isSearching, resolveLabel }
}
