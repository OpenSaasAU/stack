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
  /**
   * Fetch the server's empty-query window itself, once, the first time this
   * turns `true` — for a caller whose `initialItems` is deliberately empty
   * because it defers that read to first open (issue #1365) rather than
   * paying for it on every render. The fetch runs immediately, not debounced,
   * so opening still populates promptly. A caller whose `initialItems` is
   * already server-rendered has no reason to set this.
   */
  loadOnOpen?: boolean
  /** The search text, when the caller owns it. `setSearchQuery` then does nothing. */
  query?: string
  /** Bounds each response's window, as the `relationshipOptions` op's `take`. */
  take?: number
}

export interface UseRelationshipSearchResult {
  searchQuery: string
  setSearchQuery: (query: string) => void
  /** Candidate options for the current query — the initial window when empty, the live search response otherwise. */
  searchResults: RelationshipSearchOption[]
  isSearching: boolean
  /** Whether `searchResults` were filtered by the current, non-empty query. */
  searchApplied: boolean
  /** Resolves a label for any id ever seen (initial window or a past search response), so a value stays labelled once fetched. */
  resolveLabel: (id: string) => string | undefined
}

function extractOptions(result: unknown): RelationshipSearchOption[] {
  if (
    result &&
    typeof result === 'object' &&
    Array.isArray((result as { options?: unknown }).options)
  ) {
    return (result as { options: RelationshipSearchOption[] }).options
  }
  return []
}

function reportsSearched(result: unknown): boolean {
  return typeof result === 'object' && result !== null && 'searched' in result
    ? result.searched === true
    : false
}

function mergeFetchedLabels(
  prev: Map<string, string>,
  options: RelationshipSearchOption[],
): Map<string, string> {
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
  loadOnOpen = false,
  query,
  take,
}: UseRelationshipSearchOptions): UseRelationshipSearchResult {
  const [ownQuery, setOwnQuery] = useState('')
  const searchQuery = query ?? ownQuery
  // Only ever written from a resolved server search response — never derived
  // from render inputs — so it's a legitimate piece of state, not a value
  // that belongs in an effect-driven copy of props.
  const [liveResults, setLiveResults] = useState<{
    fieldName: string | undefined
    query: string
    options: RelationshipSearchOption[]
    searched: boolean
  } | null>(null)
  // The deferred empty-query window (#1365), distinct from `liveResults` so
  // clearing the search box falls back to it rather than to `initialItems` —
  // which a `loadOnOpen` caller leaves empty on purpose.
  const [openResults, setOpenResults] = useState<{
    fieldName: string | undefined
    options: RelationshipSearchOption[]
  } | null>(null)
  // A count, not a boolean: the debounced search and the `loadOnOpen` fetch
  // below can be in flight at once (the control opens, then the user types
  // before the open-fetch resolves), and a boolean one of them can clear
  // while the other is still pending flashes "no results" over a search
  // that hasn't actually finished.
  const [pendingRequests, setPendingRequests] = useState(0)
  const [fetchedLabels, setFetchedLabels] = useState<Map<string, string>>(new Map())

  const canSearchServer = Boolean(serverAction && listKey && fieldName)
  const trimmedQuery = searchQuery.trim()
  // Includes the debounce wait, while `liveResults` still answers the previous
  // query: Enter there would otherwise pick a row the new query never matched.
  const awaitingResults =
    canSearchServer &&
    trimmedQuery !== '' &&
    (liveResults?.query !== trimmedQuery || liveResults.fieldName !== fieldName)
  const isSearching = pendingRequests > 0 || awaitingResults
  const currentOpenResults =
    openResults !== null && openResults.fieldName === fieldName ? openResults.options : null
  const searchApplied =
    trimmedQuery !== '' &&
    (!canSearchServer || (!awaitingResults && liveResults?.searched === true))

  // Props that change often (inline callbacks, freshly-derived arrays) are
  // read from a ref inside the debounced callback so the search effect only
  // re-runs when the query itself (or the search mode) changes. Updated in an
  // effect (not during render) per the rules of hooks.
  const latestRef = useRef({ serverAction, listKey, fieldName, selectedIds, take })
  useEffect(() => {
    latestRef.current = { serverAction, listKey, fieldName, selectedIds, take }
  })

  // Derived directly from render inputs — no effect needed for the
  // no-server / empty-query cases.
  const searchResults = !canSearchServer
    ? trimmedQuery
      ? initialItems.filter((item) => item.label.toLowerCase().includes(trimmedQuery.toLowerCase()))
      : initialItems
    : trimmedQuery
      ? awaitingResults
        ? []
        : (liveResults?.options ?? [])
      : (currentOpenResults ?? initialItems)

  // The debounced server search is the one genuine side effect — it
  // synchronizes with an external system (the server action).
  useEffect(() => {
    if (!canSearchServer || !trimmedQuery) {
      return
    }

    let cancelled = false
    const timer = setTimeout(() => {
      setPendingRequests((n) => n + 1)
      const {
        serverAction: action,
        listKey: currentListKey,
        fieldName: currentFieldName,
        selectedIds: currentSelectedIds,
        take: currentTake,
      } = latestRef.current
      void action!({
        listKey: currentListKey!,
        action: 'relationshipOptions',
        field: currentFieldName!,
        search: trimmedQuery,
        selectedIds: currentSelectedIds,
        ...(currentTake === undefined ? {} : { take: currentTake }),
      })
        .then((result) => {
          if (cancelled) return
          const options = extractOptions(result)
          setLiveResults({
            fieldName: currentFieldName,
            query: trimmedQuery,
            options,
            searched: reportsSearched(result),
          })
          setFetchedLabels((prev) => mergeFetchedLabels(prev, options))
        })
        .catch((error: unknown) => {
          if (cancelled) return
          console.error('Failed to search relationship options:', error)
          setLiveResults({
            fieldName: currentFieldName,
            query: trimmedQuery,
            options: [],
            searched: true,
          })
        })
        // Unconditional: a superseded request still leaves the flight it
        // started, and `pendingRequests` counts flights, not results — only
        // `then`/`catch` (which touch `liveResults`) need the `cancelled` guard.
        .finally(() => setPendingRequests((n) => n - 1))
    }, debounceMs)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [trimmedQuery, canSearchServer, debounceMs, fieldName])

  // The deferred empty-query fetch (#1365): runs once per field, the first time
  // `loadOnOpen` turns true, and is never debounced — the control has already
  // opened and is waiting on it. A failure or an abandoned fetch clears the
  // guard so the next open retries, rather than leaving the control
  // permanently empty.
  const loadedOpenForRef = useRef<{ fieldName: string | undefined } | null>(null)
  useEffect(() => {
    if (!loadOnOpen || !canSearchServer) return
    if (loadedOpenForRef.current?.fieldName === fieldName) return
    loadedOpenForRef.current = { fieldName }

    let cancelled = false
    let settled = false
    setPendingRequests((n) => n + 1)
    const {
      serverAction: action,
      listKey: currentListKey,
      fieldName: currentFieldName,
      selectedIds: currentSelectedIds,
      take: currentTake,
    } = latestRef.current
    void action!({
      listKey: currentListKey!,
      action: 'relationshipOptions',
      field: currentFieldName!,
      selectedIds: currentSelectedIds,
      ...(currentTake === undefined ? {} : { take: currentTake }),
    })
      .then((result) => {
        settled = true
        if (cancelled) return
        const options = extractOptions(result)
        setOpenResults({ fieldName: currentFieldName, options })
        setFetchedLabels((prev) => mergeFetchedLabels(prev, options))
      })
      .catch((error: unknown) => {
        settled = true
        if (loadedOpenForRef.current?.fieldName === currentFieldName) {
          loadedOpenForRef.current = null
        }
        if (cancelled) return
        console.error('Failed to load relationship options:', error)
        setOpenResults({ fieldName: currentFieldName, options: [] })
      })
      // Unconditional for the same reason as the debounced search above.
      .finally(() => setPendingRequests((n) => n - 1))

    return () => {
      cancelled = true
      if (!settled && loadedOpenForRef.current?.fieldName === currentFieldName) {
        loadedOpenForRef.current = null
      }
    }
  }, [loadOnOpen, canSearchServer, fieldName])

  const resolveLabel = (id: string) =>
    fetchedLabels.get(id) ?? initialItems.find((item) => item.id === id)?.label

  return {
    searchQuery,
    setSearchQuery: setOwnQuery,
    searchResults,
    isSearching,
    searchApplied,
    resolveLabel,
  }
}
