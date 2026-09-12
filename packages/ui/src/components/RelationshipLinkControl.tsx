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
import { readLinkOutcome } from '../lib/applyEdgeWrites.js'

/**
 * How the picked edge is written, and which list's access decides it — see
 * `LinkEdgeData` on the server half.
 */
export type LinkEdgeMode =
  | { mode: 'junction'; junctionListKey: string; targetField: string }
  | { mode: 'foreignKey'; relatedListKey: string; backReferenceField: string }

export interface RelationshipLinkControlProps {
  /** The list being edited — the list the `addRelated` action resolves the edge from. */
  parentListKey: string
  /** The to-many field on that list whose edges this control adds. */
  fieldName: string
  /** The parent record id — one end of every edge this control creates. */
  parentId: string
  /** How this edge is stored, and therefore which write links it. */
  edge: LinkEdgeMode
  /** Display name of the far endpoint's list, used in the trigger's label. */
  targetListTitle: string
  /** The server-rendered initial window of far-endpoint options. */
  options: Array<{ id: string; label: string }>
  /** Server action that runs the edge write through the secured context. */
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
 * "Link existing" — the to-many section's add-an-edge control.
 *
 * Picking a far endpoint writes the edge under the access of the list that
 * actually holds it (ADR-0050): `addRelated` creates a junction row under the
 * junction list's create access (#1329), and `linkRelated` sets the related
 * row's own back-reference under that list's update access. The payload names
 * the list the write lands on — and, for `foreignKey`, the column — and the
 * server takes neither on trust: it evaluates the write under the access of
 * the list named, so substituting one only redirects the write somewhere the
 * session must already be allowed to write. A denial comes back as the same
 * generic reason an endpoint the session cannot read gets, so the two stay
 * indistinguishable.
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
  edge,
  targetListTitle,
  options,
  serverAction,
}: RelationshipLinkControlProps) {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  // A junction edge searches the junction's own far-endpoint field; a foreign
  // key edge searches the parent's to-many, which resolves to the same related
  // list. Either way the options come back access-scoped.
  const { searchQuery, setSearchQuery, searchResults, isSearching } = useRelationshipSearch({
    initialItems: options,
    listKey: edge.mode === 'junction' ? edge.junctionListKey : parentListKey,
    fieldName: edge.mode === 'junction' ? edge.targetField : fieldName,
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
      const outcome =
        edge.mode === 'junction'
          ? readAddOutcome(
              await serverAction({
                listKey: parentListKey,
                action: 'addRelated',
                field: fieldName,
                parentId,
                targetId,
              }),
            )
          : readLinkOutcome(
              await serverAction({
                listKey: edge.relatedListKey,
                action: 'linkRelated',
                id: targetId,
                field: edge.backReferenceField,
                parentId,
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
