'use client'

import * as React from 'react'
import { usePathname, useRouter } from 'next/navigation.js'
import { Check, Search, X } from 'lucide-react'
import type { FilterFieldSuggestion, FilterToken } from '@opensaas/stack-core'
import { Popover, PopoverAnchor, PopoverContent } from '../primitives/popover.js'
import { cn } from '../lib/utils.js'
import {
  chipEditText,
  chipsOf,
  conditionLabel,
  conditionsOf,
  conditionTakesValue,
  draftOptions,
  draftTokens,
  fieldLabel,
  filterQuery,
  hydrateTokens,
  isFieldCondition,
  isRecordLookupField,
  normaliseTokens,
  placeTokens,
  rootOptions,
  splitComparison,
  type FilterBuilderCondition,
  type FilterDraft,
  type FilterOption,
  type FilterRecord,
  type RecordLookup,
  type ResolvedFilterRecord,
} from '../lib/filterBuilderOptions.js'
import { useRelationshipSearch } from '../lib/useRelationshipSearch.js'
import type { ServerActionInput } from '../server/types.js'

const NO_RECORDS: FilterRecord[] = []
const LOOKUP_PAGE_SIZE = 10

/**
 * Per-part `classNames` slots for {@link FilterBuilder}. Each merges onto its
 * `data-slot` part via `cn`, consistent with the other admin components' Slot
 * extension seam (ADR-0016).
 */
export interface FilterBuilderClassNames {
  /** The wrapper (`data-slot="filter-builder"`). */
  root?: string
  /** The bar holding the chips and the input (`data-slot="filter-builder-bar"`). */
  bar?: string
  /** One committed Filter token (`data-slot="filter-builder-chip"`). */
  chip?: string
  /** A chip's remove button (`data-slot="filter-builder-chip-remove"`). */
  chipRemove?: string
  /** The field being built, before its value (`data-slot="filter-builder-draft"`). */
  draft?: string
  /** The combobox input (`data-slot="filter-builder-input"`). */
  input?: string
  /** The Clear button (`data-slot="filter-builder-clear"`). */
  clear?: string
  /** The suggestion menu (`data-slot="filter-builder-menu"`). */
  menu?: string
  /** One suggestion (`data-slot="filter-builder-option"`). */
  option?: string
  /** The in-place explanation of a value that does not fit (`data-slot="filter-builder-hint"`). */
  hint?: string
  /** The date inputs offered for a date field (`data-slot="filter-builder-dates"`). */
  dates?: string
}

export interface FilterBuilderProps {
  /**
   * Serializable per-field filter metadata (field name, supported operators,
   * free-text flag, value source, value format). Produced server-side by the
   * core engine's `collectFilterSuggestions` — it carries no functions, so it
   * crosses the server/client boundary. When empty, only free-text search is offered.
   */
  suggestions: FilterFieldSuggestion[]
  /** The current `?search=` query, shown as chips. A change to it replaces them. */
  defaultValue?: string
  /**
   * Called inside a transition with the serialised `?search=` query each time a
   * Filter token is committed, edited or removed. When omitted, the builder
   * navigates to `?search=<query>` on the current pathname itself.
   */
  onApply?: (query: string) => void
  /** Placeholder for the input while no filter is applied. */
  placeholder?: string
  /** Accessible name of the combobox. */
  label?: string
  /** The number of rows the applied query returns, announced when it changes. */
  resultCount?: number
  /**
   * The list being filtered. With {@link serverAction}, choosing a to-one
   * relationship field browses and searches its records, and picking one
   * writes `field:#id`.
   */
  listKey?: string
  /**
   * The generic server action, asked for a relationship field's records via
   * its `relationshipOptions` operation. Without it, a relationship field takes
   * typed label text, matched as contains.
   */
  serverAction?: (input: ServerActionInput) => Promise<unknown>
  /**
   * The records the `field:#id` tokens in {@link defaultValue} name, keyed by
   * field: each id the related list accepts, with its Item label, or `null`
   * when the session cannot read it and the chip shows the raw id. A `#id`
   * absent here is shown as the free text the server searches for instead.
   */
  recordLabels?: Record<string, ResolvedFilterRecord[]>
  className?: string
  /** Structured per-part class overrides; each merges onto its `data-slot` part. */
  classNames?: FilterBuilderClassNames
}

const GROUP_HEADING = 'px-2 pb-1 pt-2 text-xs font-medium text-muted-foreground'

function groupsOf(options: FilterOption[]): Array<{ group: string; entries: number[] }> {
  const groups: Array<{ group: string; entries: number[] }> = []
  options.forEach((option, index) => {
    const last = groups.at(-1)
    if (last && last.group === option.group) last.entries.push(index)
    else groups.push({ group: option.group, entries: [index] })
  })
  return groups
}

/**
 * The admin list's Filter builder: one bar where the admin types, suggestions
 * build the `?search=` query, and each committed Filter token becomes a chip
 * (ADR-0017, ADR-0083). The query is read and written only through core's
 * `parseFilterQuery` and `serializeFilterQuery`, and flows through the same URL
 * param the secured `context.db` reads server-side, so filtering can only ever
 * narrow what a session may see.
 *
 * Every commit applies at once; partly typed text never does. Fields, their
 * conditions and their values derive entirely from the serializable
 * {@link FilterFieldSuggestion}s, with no `switch` on field type. The bar is a
 * labelled combobox: DOM focus stays on its input and `aria-activedescendant`
 * names the active suggestion. `/` focuses it from anywhere on the page.
 */
export function FilterBuilder({
  suggestions,
  defaultValue = '',
  onApply,
  placeholder = 'Filter or search…',
  label = 'Filter',
  resultCount,
  listKey,
  serverAction,
  recordLabels,
  className,
  classNames,
}: FilterBuilderProps) {
  const router = useRouter()
  const pathname = usePathname()
  const [isPending, startTransition] = React.useTransition()
  const fields = React.useMemo(
    () => new Map(suggestions.map((suggestion) => [suggestion.field, suggestion])),
    [suggestions],
  )

  const [tokens, setTokens] = React.useState(() => hydrateTokens(defaultValue))
  const [seenValue, setSeenValue] = React.useState(defaultValue)
  const [pendingQueries, setPendingQueries] = React.useState<readonly string[]>([])
  const [text, setText] = React.useState('')
  const [draft, setDraft] = React.useState<FilterDraft | null>(null)
  const [editing, setEditing] = React.useState<number | null>(null)
  const [armed, setArmed] = React.useState<number | null>(null)
  const [open, setOpen] = React.useState(false)
  const [activeIndex, setActiveIndex] = React.useState(0)
  const [dates, setDates] = React.useState({ from: '', to: '' })

  if (defaultValue !== seenValue) {
    setSeenValue(defaultValue)
    const landed = pendingQueries.indexOf(defaultValue.trim())
    if (landed >= 0) {
      setPendingQueries(pendingQueries.slice(landed + 1))
    } else if (filterQuery(tokens) !== defaultValue.trim()) {
      setPendingQueries([])
      setTokens(hydrateTokens(defaultValue))
      setEditing(null)
      setArmed(null)
      setDraft(null)
    }
  }

  const inputRef = React.useRef<HTMLInputElement>(null)
  const barRef = React.useRef<HTMLDivElement>(null)
  const dateFromRef = React.useRef<HTMLInputElement>(null)
  const quietFocus = React.useRef(false)
  const baseId = React.useId()
  const listId = `${baseId}-list`
  const optionId = (index: number) => `${baseId}-option-${index}`

  const [picked, setPicked] = React.useState<ReadonlyMap<string, FilterRecord>>(() => new Map())
  const recordOf = React.useCallback(
    (field: string, id: string): ResolvedFilterRecord | undefined =>
      picked.get(JSON.stringify([field, id])) ??
      recordLabels?.[field]?.find((record) => record.id === id),
    [picked, recordLabels],
  )

  const chips = React.useMemo(() => chipsOf(tokens, fields, recordOf), [tokens, fields, recordOf])
  const editingChip = editing === null ? undefined : chips[editing]
  const editingToken = editingChip ? tokens[editingChip.start] : undefined
  const draftField = draft ? fields.get(draft.field) : undefined
  const lookupField =
    draft &&
    (draft.condition === 'eq' || draft.condition === 'not') &&
    isRecordLookupField(draftField)
      ? draft.field
      : undefined
  const search = useRelationshipSearch({
    initialItems: NO_RECORDS,
    listKey,
    fieldName: lookupField,
    serverAction,
    query: text,
    take: LOOKUP_PAGE_SIZE,
    loadOnOpen: lookupField !== undefined,
  })
  const { searchResults, isSearching, searchApplied } = search
  const lookup = React.useMemo(
    (): RecordLookup | null =>
      serverAction && listKey && lookupField !== undefined
        ? { records: searchResults, loading: isSearching, searched: searchApplied }
        : null,
    [serverAction, listKey, lookupField, searchResults, isSearching, searchApplied],
  )
  const { options, hint } = React.useMemo(
    () =>
      draft ? draftOptions(draft, text, fields, editingToken, lookup) : rootOptions(text, fields),
    [draft, text, fields, editingToken, lookup],
  )
  const active = options.length === 0 ? -1 : Math.min(activeIndex, options.length - 1)
  const conditions = React.useMemo(() => (draftField ? conditionsOf(draftField) : []), [draftField])
  const hasDateForm =
    draft !== null && draftField?.datePicker !== undefined && conditionTakesValue(draft.condition)

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== '/' || event.defaultPrevented) return
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable || target.closest('input, textarea, select') !== null)
      ) {
        return
      }
      event.preventDefault()
      inputRef.current?.focus()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  React.useEffect(() => {
    if (open && active >= 0) {
      document.getElementById(`${baseId}-option-${active}`)?.scrollIntoView?.({ block: 'nearest' })
    }
  }, [open, active, baseId])

  const focusInput = () => {
    if (document.activeElement !== inputRef.current) quietFocus.current = true
    inputRef.current?.focus()
    quietFocus.current = false
  }

  const reset = () => {
    setDraft(null)
    setText('')
    setEditing(null)
    setArmed(null)
    setActiveIndex(0)
    setDates({ from: '', to: '' })
  }

  const apply = (next: FilterToken[]) => {
    setTokens(next)
    const query = filterQuery(next)
    setPendingQueries((pending) => (query === seenValue.trim() ? [] : [...pending, query]))
    startTransition(() => {
      if (onApply) onApply(query)
      else router.push(query ? `${pathname}?search=${encodeURIComponent(query)}` : pathname)
    })
  }

  const commit = (added: FilterToken[], replace = true) => {
    apply(placeTokens(tokens, added, editingChip ?? null, fields, replace))
    reset()
    setOpen(false)
    focusInput()
  }

  const stageField = (field: string) => {
    const suggestion = fields.get(field)
    if (!suggestion) return
    setDraft({ field, condition: conditionsOf(suggestion)[0] ?? 'eq' })
    setText('')
    setDates({ from: '', to: '' })
    setArmed(null)
    setActiveIndex(0)
    setOpen(true)
    focusInput()
  }

  const withoutChip = (chip: { start: number; count: number } | undefined) =>
    chip ? tokens.filter((_, i) => i < chip.start || i >= chip.start + chip.count) : tokens

  const toggle = (chosen: FilterToken[]) => {
    const next =
      chosen.length > 0
        ? placeTokens(tokens, chosen, editingChip ?? null, fields, true)
        : withoutChip(editingChip)
    apply(next)
    const at = chosen.length > 0 ? next.indexOf(chosen[0]) : -1
    const chip = chipsOf(next, fields, recordOf).findIndex(({ start }) => start === at)
    setEditing(chip >= 0 ? chip : null)
    setText('')
    setArmed(null)
    focusInput()
  }

  const choose = (option: FilterOption) => {
    if (option.kind === 'field') {
      stageField(option.field)
      return
    }
    if (option.kind === 'toggle') {
      toggle(option.tokens)
      return
    }
    const { record } = option
    if (record) {
      setPicked((previous) =>
        new Map(previous).set(JSON.stringify([record.field, record.id]), {
          id: record.id,
          label: record.label,
        }),
      )
    }
    commit(option.tokens)
  }

  const editChip = (index: number) => {
    const chip = chips[index]
    const token = chip ? tokens[chip.start] : undefined
    if (!chip || !token) return
    setArmed(null)
    setEditing(index)
    setActiveIndex(0)
    setOpen(true)
    setDates({ from: '', to: '' })
    const edit = chipEditText(chip, token, fields)
    setDraft(edit.draft)
    setText(edit.text)
    focusInput()
  }

  const removeChip = (index: number) => {
    const chip = chips[index]
    if (!chip) return
    apply(withoutChip(chip))
    reset()
    focusInput()
  }

  const applyDates = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    event.stopPropagation()
    if (!draft || !draftField) return
    const typed = draft.condition === 'range' ? `${dates.from}..${dates.to}` : dates.from
    const check = draftTokens(draftField, draft.condition, typed)
    if (check.ok) commit(check.tokens)
  }

  const clearAll = () => {
    apply([])
    reset()
    setOpen(false)
    focusInput()
  }

  const cancel = () => {
    reset()
    setOpen(false)
  }

  const setCondition = (condition: FilterBuilderCondition) => {
    if (!draft) return
    setDraft({ ...draft, condition })
    setActiveIndex(0)
    focusInput()
  }

  const stepCondition = (step: number) => {
    if (!draft) return
    const at = conditions.indexOf(draft.condition)
    setCondition(conditions[(at + step + conditions.length) % conditions.length])
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return
    const empty = text === ''
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        setArmed(null)
        if (!open) setOpen(true)
        else if (options.length > 0) setActiveIndex((active + 1) % options.length)
        break
      case 'ArrowUp':
        event.preventDefault()
        setArmed(null)
        if (!open) setOpen(true)
        else if (options.length > 0) {
          setActiveIndex((active < 1 ? options.length : active) - 1)
        }
        break
      case 'Enter':
        event.preventDefault()
        if (armed !== null) editChip(armed)
        else if (open && active >= 0) choose(options[active])
        else setOpen(true)
        break
      case 'Tab':
        if (hasDateForm && open && !event.shiftKey) {
          event.preventDefault()
          dateFromRef.current?.focus()
        } else if (!hasDateForm && draft && conditions.length > 1) {
          event.preventDefault()
          stepCondition(event.shiftKey ? -1 : 1)
        } else {
          setOpen(false)
        }
        break
      case 'Escape':
        event.preventDefault()
        if (draft || editing !== null || !empty) cancel()
        else if (open) setOpen(false)
        else setArmed(null)
        break
      case 'Backspace':
        if (!empty) break
        if (draft || editing !== null) {
          event.preventDefault()
          reset()
        } else if (armed !== null) {
          event.preventDefault()
          removeChip(armed)
        } else if (chips.length > 0) {
          event.preventDefault()
          setArmed(chips.length - 1)
          setOpen(false)
        }
        break
      case 'Delete':
        if (armed !== null) {
          event.preventDefault()
          removeChip(armed)
        }
        break
      case 'ArrowLeft':
        if (event.altKey && draft && conditions.length > 1) {
          event.preventDefault()
          stepCondition(-1)
          break
        }
        if (!empty || draft || chips.length === 0) break
        event.preventDefault()
        setOpen(false)
        setArmed(armed === null ? chips.length - 1 : Math.max(0, armed - 1))
        break
      case 'ArrowRight':
        if (event.altKey && draft && conditions.length > 1) {
          event.preventDefault()
          stepCondition(1)
          break
        }
        if (!empty || armed === null) break
        event.preventDefault()
        setArmed(armed + 1 >= chips.length ? null : armed + 1)
        break
    }
  }

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    let value = event.target.value
    setArmed(null)
    setOpen(true)
    setActiveIndex(0)
    if (draft && draftField && draft.condition !== 'not') {
      const comparison = splitComparison(draftField, value)
      if (comparison) {
        setDraft({ ...draft, condition: comparison.operator })
        value = comparison.rest
      } else if (text === '' && value.startsWith('=')) {
        const widened =
          draft.condition === 'gt' ? 'gte' : draft.condition === 'lt' ? 'lte' : undefined
        if (widened && draftField.operators.includes(widened)) {
          setDraft({ ...draft, condition: widened })
          value = value.slice(1)
        }
      }
    }
    setText(value)
  }

  const handlePaste = (event: React.ClipboardEvent<HTMLInputElement>) => {
    if (draft) return
    const pasted = hydrateTokens(event.clipboardData.getData('text'))
    if (!pasted.some((token) => isFieldCondition(token, fields))) return
    event.preventDefault()
    commit(normaliseTokens(pasted, fields), false)
  }

  const armedSentence = armed === null ? null : chips[armed]?.description.sentence
  const resultMessage =
    resultCount === undefined ? '' : `${resultCount} ${resultCount === 1 ? 'result' : 'results'}`
  const chipPart =
    'inline-flex h-full items-center px-1.5 hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

  return (
    <div data-slot="filter-builder" className={cn('relative', className, classNames?.root)}>
      <Popover
        open={open}
        onOpenChange={(next) => {
          if (next) return
          setOpen(false)
          setDraft(null)
          setEditing(null)
        }}
      >
        <PopoverAnchor asChild>
          <div
            ref={barRef}
            data-slot="filter-builder-bar"
            aria-busy={isPending || undefined}
            onMouseDown={(event) => {
              if (event.target !== event.currentTarget) return
              event.preventDefault()
              inputRef.current?.focus()
              setOpen(true)
            }}
            className={cn(
              'relative flex min-h-10 w-full flex-wrap items-center gap-1.5 overflow-hidden rounded-md border border-input bg-background px-2 py-1 text-sm ring-offset-background focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2',
              classNames?.bar,
            )}
          >
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            {chips.map(({ description }, index) => {
              return (
                <span
                  key={`${index}-${description.sentence}`}
                  role="group"
                  aria-label={description.sentence}
                  data-slot="filter-builder-chip"
                  data-armed={armed === index ? '' : undefined}
                  data-editing={editing === index ? '' : undefined}
                  className={cn(
                    'inline-flex h-7 max-w-full items-center overflow-hidden rounded-md border border-border bg-muted text-xs text-foreground',
                    'data-[armed]:ring-2 data-[armed]:ring-ring data-[editing]:border-primary data-[editing]:bg-accent',
                    classNames?.chip,
                  )}
                >
                  <button
                    type="button"
                    tabIndex={-1}
                    data-slot="filter-builder-chip-field"
                    aria-label={`Edit ${description.sentence}`}
                    onClick={() => editChip(index)}
                    className={cn(chipPart, 'font-medium')}
                  >
                    {description.field}
                  </button>
                  <button
                    type="button"
                    tabIndex={-1}
                    data-slot="filter-builder-chip-condition"
                    aria-label={`Change condition of ${description.sentence}`}
                    onClick={() => editChip(index)}
                    className={cn(chipPart, 'text-muted-foreground')}
                  >
                    {description.condition}
                  </button>
                  {description.value !== '' && (
                    <button
                      type="button"
                      tabIndex={-1}
                      data-slot="filter-builder-chip-value"
                      aria-label={`Change value of ${description.sentence}`}
                      onClick={() => editChip(index)}
                      className={cn(chipPart, 'min-w-0 truncate font-semibold')}
                    >
                      <span className="truncate">{description.value}</span>
                    </button>
                  )}
                  <button
                    type="button"
                    data-slot="filter-builder-chip-remove"
                    aria-label={`Remove ${description.sentence}`}
                    onClick={() => removeChip(index)}
                    className={cn(
                      chipPart,
                      'text-muted-foreground max-md:px-2.5',
                      classNames?.chipRemove,
                    )}
                  >
                    <X className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </span>
              )
            })}
            {draft && (
              <span
                data-slot="filter-builder-draft"
                className={cn(
                  'inline-flex h-7 items-center gap-1 rounded-md border border-dashed border-primary px-1.5 text-xs',
                  classNames?.draft,
                )}
              >
                <span className="font-medium">{fieldLabel(draft.field)}</span>
                {draftField && (
                  <span className="text-muted-foreground">
                    {conditionLabel(draftField, draft.condition)}
                  </span>
                )}
              </span>
            )}
            <input
              ref={inputRef}
              type="text"
              role="combobox"
              aria-label={label}
              aria-expanded={open}
              aria-controls={open ? listId : undefined}
              aria-autocomplete="list"
              aria-activedescendant={open && active >= 0 ? optionId(active) : undefined}
              autoComplete="off"
              spellCheck={false}
              data-slot="filter-builder-input"
              value={text}
              placeholder={
                draft ? 'Type a value…' : tokens.length > 0 ? 'Add a filter…' : placeholder
              }
              onChange={handleChange}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              onFocus={() => {
                if (!quietFocus.current) setOpen(true)
              }}
              onClick={() => setOpen(true)}
              className={cn(
                'h-8 min-w-[8rem] flex-1 bg-transparent outline-none placeholder:text-muted-foreground',
                classNames?.input,
              )}
            />
            {tokens.length > 0 ? (
              <button
                type="button"
                data-slot="filter-builder-clear"
                onClick={clearAll}
                className={cn(
                  'inline-flex h-7 items-center rounded-md px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground',
                  classNames?.clear,
                )}
              >
                Clear
              </button>
            ) : (
              <kbd
                aria-hidden="true"
                className="rounded border border-border px-1.5 text-xs text-muted-foreground max-md:hidden"
              >
                /
              </kbd>
            )}
            {isPending && (
              <span
                role="progressbar"
                aria-label="Updating results"
                data-slot="filter-builder-progress"
                className="absolute inset-x-0 bottom-0 h-0.5 animate-pulse bg-primary"
              />
            )}
          </div>
        </PopoverAnchor>
        <PopoverContent
          align="start"
          data-slot="filter-builder-menu"
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => event.preventDefault()}
          onEscapeKeyDown={(event) => {
            event.preventDefault()
            cancel()
          }}
          onInteractOutside={(event) => {
            const target = event.target
            if (target instanceof Node && barRef.current?.contains(target)) event.preventDefault()
          }}
          className={cn(
            'w-[min(28rem,var(--radix-popover-trigger-width))] min-w-[16rem] p-0',
            classNames?.menu,
          )}
        >
          {draft && hasDateForm && (
            <form
              aria-label={`${fieldLabel(draft.field)} dates`}
              data-slot="filter-builder-dates"
              onSubmit={applyDates}
              className={cn(
                'flex flex-wrap items-end gap-2 border-b border-border p-2 text-xs',
                classNames?.dates,
              )}
            >
              <label className="flex flex-col gap-1">
                <span className="text-muted-foreground">
                  {draft.condition === 'range' ? 'From' : 'Date'}
                </span>
                <input
                  ref={dateFromRef}
                  type="date"
                  required
                  value={dates.from}
                  onKeyDown={(event) => {
                    if (event.key !== 'Tab' || !event.shiftKey) return
                    event.preventDefault()
                    inputRef.current?.focus()
                  }}
                  onChange={(event) => setDates({ ...dates, from: event.target.value })}
                  className="h-8 rounded-md border border-input bg-background px-2"
                />
              </label>
              {draft.condition === 'range' && (
                <label className="flex flex-col gap-1">
                  <span className="text-muted-foreground">To</span>
                  <input
                    type="date"
                    required
                    value={dates.to}
                    onChange={(event) => setDates({ ...dates, to: event.target.value })}
                    className="h-8 rounded-md border border-input bg-background px-2"
                  />
                </label>
              )}
              <button
                type="submit"
                className="h-8 rounded-md border border-border px-3 hover:bg-accent hover:text-accent-foreground"
              >
                Apply dates
              </button>
            </form>
          )}
          {draft && draftField && conditions.length > 1 && (
            <div
              role="group"
              aria-label={`${fieldLabel(draft.field)} condition`}
              data-slot="filter-builder-menu-conditions"
              className="flex flex-wrap items-center gap-1 border-b border-border p-2"
            >
              {conditions.map((condition) => (
                <button
                  key={condition}
                  type="button"
                  tabIndex={-1}
                  aria-pressed={draft.condition === condition}
                  data-slot="filter-builder-menu-condition"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => setCondition(condition)}
                  className="rounded-md border border-border px-2 py-0.5 text-xs aria-pressed:border-primary aria-pressed:bg-primary aria-pressed:text-primary-foreground"
                >
                  {conditionLabel(draftField, condition)}
                </button>
              ))}
            </div>
          )}
          <div
            id={listId}
            role="listbox"
            aria-multiselectable={draft?.condition === 'anyOf' || undefined}
            aria-label={draft ? `${fieldLabel(draft.field)} values` : 'Filter suggestions'}
            className="max-h-[300px] overflow-y-auto p-1"
          >
            {groupsOf(options).map(({ group, entries }) => (
              <div
                key={`${group}-${entries[0]}`}
                role="group"
                aria-labelledby={`${baseId}-group-${entries[0]}`}
              >
                <div id={`${baseId}-group-${entries[0]}`} className={GROUP_HEADING}>
                  {group}
                </div>
                {entries.map((index) => {
                  const option = options[index]
                  return (
                    <div
                      key={index}
                      id={optionId(index)}
                      role="option"
                      aria-selected={option.kind !== 'field' && option.selected === true}
                      data-slot="filter-builder-option"
                      data-active={index === active ? '' : undefined}
                      onMouseDown={(event) => event.preventDefault()}
                      onMouseMove={() => {
                        if (index !== active) setActiveIndex(index)
                      }}
                      onClick={() => choose(option)}
                      className={cn(
                        'flex cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-sm wrap-anywhere',
                        'hover:bg-accent hover:text-accent-foreground data-[active]:bg-accent data-[active]:text-accent-foreground',
                        'aria-selected:font-medium',
                        classNames?.option,
                      )}
                    >
                      {option.kind === 'toggle' && (
                        <Check
                          aria-hidden="true"
                          data-slot="filter-builder-option-check"
                          className={cn(
                            'mr-2 h-3.5 w-3.5 shrink-0',
                            !option.selected && 'invisible',
                          )}
                        />
                      )}
                      {option.kind === 'field' ? fieldLabel(option.field) : option.label}
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
          <div aria-live="polite">
            {hint && (
              <p
                data-slot="filter-builder-hint"
                className={cn(
                  'border-t border-border px-3 py-2 text-sm text-muted-foreground',
                  classNames?.hint,
                )}
              >
                {hint}
              </p>
            )}
            <span className="sr-only">
              {`${options.length} ${options.length === 1 ? 'suggestion' : 'suggestions'}`}
            </span>
          </div>
          <p
            aria-hidden="true"
            className="flex flex-wrap gap-x-3 border-t border-border px-3 py-1.5 text-xs text-muted-foreground"
          >
            <span>↑↓ move</span>
            <span>Enter select</span>
            {hasDateForm && <span>Tab dates</span>}
            {conditions.length > 1 && (
              <span>{hasDateForm ? 'Alt+←→ change condition' : 'Tab change condition'}</span>
            )}
            <span>Esc {draft || editing !== null ? 'cancel' : 'close'}</span>
          </p>
        </PopoverContent>
      </Popover>
      <div aria-live="polite" className="sr-only" data-slot="filter-builder-status">
        {armedSentence
          ? `${armedSentence} selected. Backspace removes it, Enter edits it.`
          : resultMessage}
      </div>
    </div>
  )
}
