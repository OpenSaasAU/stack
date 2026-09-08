'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation.js'
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxItem,
  ComboboxList,
  ComboboxSearch,
  ComboboxTrigger,
} from '../primitives/combobox.js'
import { useRelationshipSearch } from '../lib/useRelationshipSearch.js'
import type { ServerActionInput } from '../server/types.js'

export interface RelationshipLinkControlProps {
  /** The list being edited — the list the `addRelated` action resolves the edge from. */
  parentListKey: string
  /** The to-many field on that list whose edges this control adds. */
  fieldName: string
  /** The parent record id — one end of every edge this control creates. */
  parentId: string
  /** The junction list, used to scope the far endpoint's live search to its own field. */
  junctionListKey: string
  /** The junction field naming the far endpoint. */
  targetField: string
  /** Display name of the far endpoint's list, used in the trigger's label. */
  targetListTitle: string
  /** The server-rendered initial window of far-endpoint options. */
  options: Array<{ id: string; label: string }>
  /** Server action that runs the edge create through the secured context. */
  serverAction: (input: ServerActionInput) => Promise<unknown>
}

/** Read the `{ added, error? }` outcome the edge-create server action returns. */
export function readAddOutcome(result: unknown): { ok: boolean; error?: string } {
  if (typeof result === 'object' && result !== null && 'added' in result) {
    const record = result as { added?: unknown; error?: unknown }
    return {
      ok: record.added === true,
      error: typeof record.error === 'string' ? record.error : undefined,
    }
  }
  // An unrecognised shape is a failure, so an edge is never reported as added
  // on an odd result.
  return { ok: false }
}

/**
 * "Link existing" — the to-many section's add-an-edge control (#1329).
 *
 * Picking a far endpoint creates the junction row through the `addRelated`
 * server action, which resolves the junction list from the config and runs the
 * create under **that list's** own create access (ADR-0050). The control sends
 * two ids and nothing else: it cannot name a junction list, and it cannot set a
 * column of the edge row. A denial comes back as the same generic reason an
 * endpoint the session cannot read gets, so the two stay indistinguishable.
 *
 * Known limits: the offered options are not filtered by what is already linked.
 * The table's rows are a bounded window (`ui.itemView.take`), so "already
 * linked" is not answerable from them, and filtering by the window alone would
 * hide an option in one record and offer it in another. A junction that forbids
 * duplicate edges declares a unique pair index, and the violation surfaces here
 * as the create's own error.
 */
export function RelationshipLinkControl({
  parentListKey,
  fieldName,
  parentId,
  junctionListKey,
  targetField,
  targetListTitle,
  options,
  serverAction,
}: RelationshipLinkControlProps) {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const { searchQuery, setSearchQuery, searchResults, isSearching } = useRelationshipSearch({
    initialItems: options,
    listKey: junctionListKey,
    fieldName: targetField,
    serverAction,
  })

  // The popover stays open until the create succeeds, so its items keep taking
  // clicks while one is in flight. `pending` is state and does not settle
  // before the next click's handler runs, so the guard reads a ref: without it
  // a second click sends a second create, and a junction with no unique pair
  // index stores the edge twice.
  const inFlight = React.useRef(false)

  const link = async (targetId: string) => {
    if (inFlight.current) return
    inFlight.current = true
    setPending(true)
    setError(null)
    try {
      const outcome = readAddOutcome(
        await serverAction({
          listKey: parentListKey,
          action: 'addRelated',
          field: fieldName,
          parentId,
          targetId,
        }),
      )
      if (outcome.ok) {
        setOpen(false)
        setSearchQuery('')
        router.refresh()
      } else {
        setError(outcome.error ?? 'Access denied or link failed')
      }
    } catch {
      setError('Link failed')
    } finally {
      inFlight.current = false
      setPending(false)
    }
  }

  return (
    <div data-slot="relationship-table-link" className="flex items-center gap-2">
      {error && (
        <span role="alert" className="text-xs text-destructive">
          {error}
        </span>
      )}
      <Combobox open={open} onOpenChange={setOpen}>
        <ComboboxTrigger disabled={pending} className="h-9 px-3">
          <span>{pending ? 'Linking…' : `Link ${targetListTitle}`}</span>
        </ComboboxTrigger>
        <ComboboxContent>
          <ComboboxSearch
            placeholder="Search..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.preventDefault()
            }}
          />
          <ComboboxList>
            {isSearching ? (
              <ComboboxEmpty>Searching...</ComboboxEmpty>
            ) : searchResults.length === 0 ? (
              <ComboboxEmpty>No results found</ComboboxEmpty>
            ) : (
              searchResults.map((item) => (
                <ComboboxItem
                  key={item.id}
                  data-disabled={pending ? '' : undefined}
                  onClick={() => void link(item.id)}
                >
                  {item.label}
                </ComboboxItem>
              ))
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
    </div>
  )
}
