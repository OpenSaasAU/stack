'use client'

import * as React from 'react'

/**
 * Row selection for the list table (issue #733).
 *
 * Selection is an explicit **id set** — never "everything matching the filter"
 * (that is deliberately out of scope, see the Bulk action glossary entry in
 * `CONTEXT.md`). The set:
 *
 * - accumulates across pages (the header checkbox toggles the *visible page*,
 *   per-row checkboxes add/remove one id), and
 * - clears when the **filter changes** (a new `filterKey`), because a selection
 *   is only meaningful against the result set it was made in.
 *
 * The set is persisted in `sessionStorage` keyed by list, tagged with the
 * `filterKey` it was made under. Reading it back through `useSyncExternalStore`
 * (the same store pattern `ThemeToggle` uses for the persisted theme) means the
 * selection survives the soft navigation a page/sort change triggers — whether
 * or not the client component remounts — without a setState-in-effect or a
 * hydration mismatch. A stored set tagged with a different `filterKey` reads
 * back as empty, so "clear on filter change" falls out of the read itself.
 */
export interface RowSelection {
  /** The currently selected row ids (accumulated across pages). */
  selectedIds: Set<string>
  /** Number of selected rows. */
  selectedCount: number
  /** Whether a single row id is selected. */
  isSelected: (id: string) => boolean
  /** Toggle a single row id. */
  toggle: (id: string) => void
  /**
   * Toggle the visible page: if every id on the page is already selected they
   * are all removed, otherwise every page id is added (accumulating onto ids
   * selected on other pages).
   */
  togglePage: (pageIds: string[]) => void
  /** Clear the whole selection. */
  clear: () => void
}

/**
 * Whether every id on the visible page is in the selection. Empty pages are not
 * "fully selected" (there is nothing to select). Pure so it can be unit-tested
 * and reused by the header-checkbox rendering.
 */
export function isPageFullySelected(selected: Set<string>, pageIds: string[]): boolean {
  return pageIds.length > 0 && pageIds.every((id) => selected.has(id))
}

/**
 * The tri-state a header ("select visible page") checkbox should show for the
 * given page: `true` when all page rows are selected, `'indeterminate'` when
 * some are, `false` when none are.
 */
export function getPageCheckboxState(
  selected: Set<string>,
  pageIds: string[],
): boolean | 'indeterminate' {
  if (isPageFullySelected(selected, pageIds)) return true
  if (pageIds.some((id) => selected.has(id))) return 'indeterminate'
  return false
}

// Stable empty reference: `useSyncExternalStore` requires `getSnapshot` to
// return the same reference when nothing changed.
const EMPTY_IDS: readonly string[] = Object.freeze([])

function storageKeyFor(listKey: string): string {
  return `opensaas:selection:${listKey}`
}

// Same-document change listeners per storage key. The `storage` event does not
// fire for same-document `sessionStorage` writes, so local writes notify here.
const listeners = new Map<string, Set<() => void>>()

// Cache the parsed value per storage key so `getSnapshot` returns a stable ids
// reference until the underlying raw string changes.
type ParsedSelection = { raw: string | null; filterKey: string | null; ids: readonly string[] }
const snapshotCache = new Map<string, ParsedSelection>()

function readRaw(storageKey: string): string | null {
  try {
    return window.sessionStorage.getItem(storageKey)
  } catch {
    return null
  }
}

/** Parse a stored `{ filterKey, ids }` blob, tolerating anything malformed. */
function parseStored(raw: string | null): { filterKey: string; ids: string[] } | null {
  if (!raw) return null
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof value !== 'object' || value === null) return null
  // Internal narrowing of a freshly-parsed JSON blob at the storage boundary.
  const record = value as Record<string, unknown>
  const { filterKey, ids } = record
  if (typeof filterKey !== 'string' || !Array.isArray(ids)) return null
  if (!ids.every((id): id is string => typeof id === 'string')) return null
  return { filterKey, ids }
}

/** The parsed selection for `storageKey`, cached until its raw string changes. */
function getParsed(storageKey: string): ParsedSelection {
  const raw = readRaw(storageKey)
  const cached = snapshotCache.get(storageKey)
  if (cached && cached.raw === raw) return cached
  const parsed = parseStored(raw)
  const next: ParsedSelection = parsed
    ? { raw, filterKey: parsed.filterKey, ids: parsed.ids }
    : { raw, filterKey: null, ids: EMPTY_IDS }
  snapshotCache.set(storageKey, next)
  return next
}

/** The selected ids for `filterKey` (empty when the stored set is another filter's). */
function readIds(storageKey: string, filterKey: string): readonly string[] {
  const parsed = getParsed(storageKey)
  return parsed.filterKey === filterKey ? parsed.ids : EMPTY_IDS
}

function writeIds(storageKey: string, filterKey: string, ids: readonly string[]): void {
  try {
    window.sessionStorage.setItem(storageKey, JSON.stringify({ filterKey, ids }))
  } catch {
    // Storage may be unavailable (private mode/quota); notify anyway so the
    // in-memory subscribers still re-read (they will just read back nothing).
  }
  snapshotCache.delete(storageKey)
  const set = listeners.get(storageKey)
  if (set) for (const listener of set) listener()
}

/**
 * Manage row selection for one list view, persisted per `filterKey`.
 *
 * `filterKey` must NOT change on page/sort changes — only when the filter
 * itself changes — since changing it reads the selection back as empty.
 */
export function useRowSelection(listKey: string, filterKey: string): RowSelection {
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

  const getSnapshot = React.useCallback(
    () => readIds(storageKey, filterKey),
    [storageKey, filterKey],
  )
  const getServerSnapshot = React.useCallback(() => EMPTY_IDS, [])

  const ids = React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
  const selectedIds = React.useMemo(() => new Set(ids), [ids])

  const toggle = React.useCallback(
    (id: string) => {
      const current = readIds(storageKey, filterKey)
      const next = current.includes(id) ? current.filter((x) => x !== id) : [...current, id]
      writeIds(storageKey, filterKey, next)
    },
    [storageKey, filterKey],
  )

  const togglePage = React.useCallback(
    (pageIds: string[]) => {
      const current = readIds(storageKey, filterKey)
      const currentSet = new Set(current)
      if (isPageFullySelected(currentSet, pageIds)) {
        const remove = new Set(pageIds)
        writeIds(
          storageKey,
          filterKey,
          current.filter((id) => !remove.has(id)),
        )
      } else {
        const next = [...current]
        for (const id of pageIds) if (!currentSet.has(id)) next.push(id)
        writeIds(storageKey, filterKey, next)
      }
    },
    [storageKey, filterKey],
  )

  const clear = React.useCallback(
    () => writeIds(storageKey, filterKey, EMPTY_IDS),
    [storageKey, filterKey],
  )

  const isSelected = React.useCallback((id: string) => selectedIds.has(id), [selectedIds])

  return {
    selectedIds,
    selectedCount: selectedIds.size,
    isSelected,
    toggle,
    togglePage,
    clear,
  }
}
