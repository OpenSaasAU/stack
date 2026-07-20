'use client'

import * as React from 'react'
import { usePathname, useRouter } from 'next/navigation.js'
import { Plus, X } from 'lucide-react'
import type { FilterFieldSuggestion, FilterOperator, FilterValueSource } from '@opensaas/stack-core'
import { Card } from '../primitives/card.js'
import { Input } from '../primitives/input.js'
import { Button } from '../primitives/button.js'
import { cn, formatFieldName } from '../lib/utils.js'
import { type FilterRow, queryToState, stateToQuery } from '../lib/filterBuilderState.js'

/**
 * Human-readable labels for the grammar's operators. `eq` reads as "is" because
 * every field's `eq` mapping is an equality/contains match; the comparisons only
 * ever appear on numeric/date fields.
 */
const OPERATOR_LABELS: Record<FilterOperator, string> = {
  eq: 'is',
  gt: 'greater than',
  gte: 'greater or equal',
  lt: 'less than',
  lte: 'less or equal',
}

/**
 * Native `<select>`/`<option>` controls (rather than a Radix popover) keep the
 * builder's field/operator/value pickers robust across jsdom unit tests and real
 * browsers, and serialisation-free. Styled to match the `Input` primitive using
 * theme tokens only.
 */
const NATIVE_CONTROL_CLASS =
  'h-10 rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50'

/**
 * Per-part `classNames` slots for {@link FilterBuilder}. Each merges onto its
 * `data-slot` part via `cn`, consistent with the other admin components' Slot
 * extension seam (#709/#729/#733).
 */
export interface FilterBuilderClassNames {
  /** Card wrapper (`data-slot="filter-builder"`). */
  root?: string
  /** Wrapper around the structured condition rows. */
  conditions?: string
  /** A single condition row (`data-slot="filter-builder-condition"`). */
  condition?: string
  /** The field `<select>` in a row (`data-slot="filter-builder-field"`). */
  field?: string
  /** The operator `<select>` in a row (`data-slot="filter-builder-operator"`). */
  operator?: string
  /** The value input/select in a row (`data-slot="filter-builder-value"`). */
  value?: string
  /** The per-row remove button (`data-slot="filter-builder-remove"`). */
  remove?: string
  /** The free-text form row (`data-slot="filter-builder-form"`). */
  form?: string
  /** The free-text search input (`data-slot="filter-builder-search"`). */
  search?: string
  /** The "Add filter" button (`data-slot="filter-builder-add"`). */
  add?: string
  /** The Apply button (`data-slot="filter-builder-apply"`). */
  apply?: string
  /** The Clear button (`data-slot="filter-builder-clear"`). */
  clear?: string
}

export interface FilterBuilderProps {
  /**
   * Serializable per-field filter metadata (field name, supported operators,
   * free-text flag, value source). Produced server-side by the core engine's
   * `collectFilterSuggestions` — it carries no functions, so it crosses the
   * server/client boundary. When empty, only the free-text box is shown.
   */
  suggestions: FilterFieldSuggestion[]
  /** The current `?search=` query, used to hydrate the builder on mount. */
  defaultValue?: string
  /**
   * Called with the serialised `?search=` query when the user applies filters.
   * When omitted, the builder navigates to `?search=<query>` on the current
   * pathname itself (standalone use).
   */
  onApply?: (query: string) => void
  /** Placeholder for the free-text search box. */
  placeholder?: string
  className?: string
  /** Structured per-part class overrides; each merges onto its `data-slot` part. */
  classNames?: FilterBuilderClassNames
}

/**
 * The default value a fresh row gets for a given value source: enums start
 * unset (the user picks from the dropdown), everything else starts empty.
 */
function initialValueForSource(_source: FilterValueSource): string {
  return ''
}

/**
 * Filter builder input UI (issue #731, part of #728; layered on the #730 filter
 * engine / ADR-0017).
 *
 * Constructs the admin list's `?search=` filter query from a friendly UI —
 * structured field/operator/value rows plus a free-text box — and produces the
 * exact grammar the engine already consumes (`serializeFilterQuery`). It never
 * invents a parallel filter path: the applied query flows through the same URL
 * param the secured `context.db` reads server-side, so filtering can only ever
 * narrow, never widen, what a session may see.
 *
 * Available fields, operators and value suggestions are derived entirely from
 * the serializable {@link FilterFieldSuggestion}s (each field's self-contained
 * `getFilterSpec`) — there is no `switch` on field type here, mirroring the
 * cell/field-component registry pattern.
 */
export function FilterBuilder({
  suggestions,
  defaultValue = '',
  onApply,
  placeholder = 'Search…',
  className,
  classNames,
}: FilterBuilderProps) {
  const router = useRouter()
  const pathname = usePathname()

  // Hydrate once from the incoming query. The parent remounts this component
  // (via a `key` on the applied query) when the URL changes, so the builder
  // always reflects the active filter without an effect-driven prop copy.
  const [state, setState] = React.useState(() => queryToState(defaultValue, suggestions))

  const suggestionByField = React.useMemo(
    () => new Map(suggestions.map((s) => [s.field, s])),
    [suggestions],
  )

  const applyQuery = (query: string) => {
    if (onApply) {
      onApply(query)
      return
    }
    router.push(query ? `${pathname}?search=${encodeURIComponent(query)}` : pathname)
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    applyQuery(stateToQuery(state))
  }

  const handleClear = () => {
    setState({ rows: [], freeText: '' })
    applyQuery('')
  }

  const addRow = () => {
    const first = suggestions[0]
    if (!first) return
    const newRow: FilterRow = {
      id: `row-${Date.now()}-${state.rows.length}`,
      field: first.field,
      operator: first.operators[0] ?? 'eq',
      value: initialValueForSource(first.valueSource),
    }
    setState((prev) => ({ ...prev, rows: [...prev.rows, newRow] }))
  }

  const removeRow = (id: string) => {
    setState((prev) => ({ ...prev, rows: prev.rows.filter((row) => row.id !== id) }))
  }

  const updateRow = (id: string, patch: Partial<Omit<FilterRow, 'id'>>) => {
    setState((prev) => ({
      ...prev,
      rows: prev.rows.map((row) => {
        if (row.id !== id) return row
        // Changing the field resets the operator to one the new field supports
        // and clears the value (its meaning/source differs per field).
        if (patch.field !== undefined && patch.field !== row.field) {
          const suggestion = suggestionByField.get(patch.field)
          return {
            ...row,
            field: patch.field,
            operator: suggestion?.operators[0] ?? 'eq',
            value: suggestion ? initialValueForSource(suggestion.valueSource) : '',
          }
        }
        return { ...row, ...patch }
      }),
    }))
  }

  const renderValueControl = (row: FilterRow) => {
    const suggestion = suggestionByField.get(row.field)
    const source = suggestion?.valueSource ?? { kind: 'none' as const }
    const valueClass = cn(NATIVE_CONTROL_CLASS, 'min-w-[10rem]', classNames?.value)

    if (source.kind === 'enum') {
      return (
        <select
          data-slot="filter-builder-value"
          aria-label="Filter value"
          className={valueClass}
          value={row.value}
          onChange={(e) => updateRow(row.id, { value: e.target.value })}
        >
          <option value="">Select…</option>
          {source.options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      )
    }

    const relationshipPlaceholder =
      source.kind === 'relationship' ? `Search ${formatFieldName(source.listKey)}…` : 'Value'

    return (
      <Input
        data-slot="filter-builder-value"
        aria-label="Filter value"
        className={cn('h-10 min-w-[10rem] flex-1', classNames?.value)}
        value={row.value}
        placeholder={relationshipPlaceholder}
        onChange={(e) => updateRow(row.id, { value: e.target.value })}
      />
    )
  }

  return (
    <Card data-slot="filter-builder" className={cn('space-y-3 p-4', className, classNames?.root)}>
      {state.rows.length > 0 && (
        <div
          data-slot="filter-builder-conditions"
          className={cn('space-y-2', classNames?.conditions)}
        >
          {state.rows.map((row) => {
            const suggestion = suggestionByField.get(row.field)
            const operators = suggestion?.operators ?? ['eq']
            return (
              <div
                key={row.id}
                data-slot="filter-builder-condition"
                className={cn('flex flex-wrap items-center gap-2', classNames?.condition)}
              >
                <select
                  data-slot="filter-builder-field"
                  aria-label="Filter field"
                  className={cn(NATIVE_CONTROL_CLASS, classNames?.field)}
                  value={row.field}
                  onChange={(e) => updateRow(row.id, { field: e.target.value })}
                >
                  {suggestions.map((s) => (
                    <option key={s.field} value={s.field}>
                      {formatFieldName(s.field)}
                    </option>
                  ))}
                </select>

                {operators.length > 1 && (
                  <select
                    data-slot="filter-builder-operator"
                    aria-label="Filter operator"
                    className={cn(NATIVE_CONTROL_CLASS, classNames?.operator)}
                    value={row.operator}
                    onChange={(e) =>
                      updateRow(row.id, { operator: e.target.value as FilterOperator })
                    }
                  >
                    {operators.map((op) => (
                      <option key={op} value={op}>
                        {OPERATOR_LABELS[op]}
                      </option>
                    ))}
                  </select>
                )}

                {renderValueControl(row)}

                <button
                  type="button"
                  data-slot="filter-builder-remove"
                  aria-label="Remove filter"
                  onClick={() => removeRow(row.id)}
                  className={cn(
                    'inline-flex h-10 w-10 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
                    classNames?.remove,
                  )}
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            )
          })}
        </div>
      )}

      <form
        data-slot="filter-builder-form"
        onSubmit={handleSubmit}
        className={cn('flex flex-wrap items-center gap-2', classNames?.form)}
      >
        <div className="relative min-w-[12rem] flex-1">
          <Input
            data-slot="filter-builder-search"
            aria-label="Search"
            type="text"
            value={state.freeText}
            placeholder={placeholder}
            className={cn('pr-10', classNames?.search)}
            onChange={(e) => setState((prev) => ({ ...prev, freeText: e.target.value }))}
          />
          {state.freeText && (
            <button
              type="button"
              data-slot="filter-builder-search-clear"
              aria-label="Clear filter text"
              onClick={() => setState((prev) => ({ ...prev, freeText: '' }))}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
        </div>

        {suggestions.length > 0 && (
          <Button
            type="button"
            variant="outline"
            data-slot="filter-builder-add"
            onClick={addRow}
            className={classNames?.add}
          >
            <Plus aria-hidden="true" />
            Add filter
          </Button>
        )}

        <Button type="submit" data-slot="filter-builder-apply" className={classNames?.apply}>
          Apply
        </Button>

        {(state.rows.length > 0 || state.freeText) && (
          <Button
            type="button"
            variant="ghost"
            data-slot="filter-builder-clear"
            onClick={handleClear}
            className={classNames?.clear}
          >
            Clear
          </Button>
        )}
      </form>
    </Card>
  )
}
