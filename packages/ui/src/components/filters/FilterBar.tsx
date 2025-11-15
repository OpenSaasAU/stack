/**
 * FilterBar component - Main UI for managing list filters
 * Provides interface for adding, editing, and removing filters
 */
'use client'

import * as React from 'react'
import { useState } from 'react'
import { useRouter } from 'next/navigation.js'
import { Button } from '../../primitives/button.js'
import { Card } from '../../primitives/card.js'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../primitives/select.js'
import { Popover } from '../../primitives/popover.js'
import {
  TextFilterInput,
  NumberFilterInput,
  BooleanFilterInput,
  DateFilterInput,
  SelectFilterInput,
  RelationshipFilterInput,
} from './FilterInput.js'
import {
  parseFiltersFromURL,
  serializeFiltersToURL,
  addFilter,
  removeFilter,
  clearFilters,
} from '../../lib/filter-utils.js'
import { FIELD_TYPE_OPERATORS, OPERATOR_LABELS } from '../../lib/filter-types.js'
import type { ListFilters, FilterOperator } from '../../lib/filter-types.js'
import { formatFieldName } from '../../lib/utils.js'

/**
 * Serializable field metadata for filtering
 */
export interface FilterableField {
  name: string
  type: string
  options?: Array<{ label: string; value: string }> // For select fields
}

export interface FilterBarProps {
  listKey: string
  fields: FilterableField[]
  basePath: string
  urlKey: string
  currentFilters: ListFilters
  searchParams?: Record<string, string | string[] | undefined>
  className?: string
}

/**
 * FilterBar component for list views
 * Manages filter state in URL and provides UI for adding/removing filters
 *
 * @example
 * ```tsx
 * <FilterBar
 *   listKey="Post"
 *   fields={[
 *     { name: 'title', type: 'text' },
 *     { name: 'status', type: 'select', options: [
 *       { value: 'draft', label: 'Draft' },
 *       { value: 'published', label: 'Published' }
 *     ]},
 *     { name: 'views', type: 'integer' }
 *   ]}
 *   basePath="/admin"
 *   urlKey="post"
 *   currentFilters={filters}
 *   searchParams={searchParams}
 * />
 * ```
 */
export function FilterBar({
  listKey,
  fields,
  basePath,
  urlKey,
  currentFilters,
  searchParams = {},
  className,
}: FilterBarProps) {
  const router = useRouter()
  const [isAddingFilter, setIsAddingFilter] = useState(false)
  const [selectedField, setSelectedField] = useState<string>('')
  const [selectedOperator, setSelectedOperator] = useState<FilterOperator | ''>('')

  // Create a lookup map for field metadata
  const fieldMap = new Map(fields.map((f) => [f.name, f]))

  const handleUpdateFilters = (newFilters: ListFilters) => {
    const params = new URLSearchParams()

    // Preserve existing search param
    const search = searchParams.search
    if (typeof search === 'string' && search) {
      params.set('search', search)
    }

    // Add filter params
    const filterString = serializeFiltersToURL(newFilters)
    if (filterString) {
      // Parse and add each filter param
      const filterParams = new URLSearchParams(filterString)
      filterParams.forEach((value, key) => {
        params.set(key, value)
      })
    }

    // Reset to page 1 when filters change
    params.set('page', '1')

    // Navigate with new params
    const url = `${basePath}/${urlKey}?${params.toString()}`
    router.push(url)
  }

  const handleAddFilter = (field: string, operator: FilterOperator, value: unknown) => {
    const newFilters = addFilter(
      currentFilters,
      field,
      operator,
      value as string | string[] | boolean | number,
    )
    handleUpdateFilters(newFilters)
    setIsAddingFilter(false)
    setSelectedField('')
    setSelectedOperator('')
  }

  const handleRemoveFilter = (field: string, operator: FilterOperator) => {
    const newFilters = removeFilter(currentFilters, field, operator)
    handleUpdateFilters(newFilters)
  }

  const handleClearAll = () => {
    handleUpdateFilters(clearFilters())
  }

  const getDefaultValue = (fieldType: string, operator: FilterOperator) => {
    if (operator === 'is') return true
    if (operator === 'in' || operator === 'notIn') return []
    if (fieldType === 'integer') return 0
    if (fieldType === 'timestamp') return new Date().toISOString()
    return ''
  }

  const renderFilterInput = (filter: (typeof currentFilters)[0]) => {
    const field = fieldMap.get(filter.field)
    if (!field) return null

    const fieldType = field.type
    const label = formatFieldName(filter.field)

    const baseProps = {
      field: filter.field,
      value: filter.value,
      onChange: (value: string | string[] | boolean | number) => {
        const newFilters = addFilter(currentFilters, filter.field, filter.operator, value)
        handleUpdateFilters(newFilters)
      },
      onRemove: () => handleRemoveFilter(filter.field, filter.operator),
      label,
    }

    switch (fieldType) {
      case 'text':
        return (
          <TextFilterInput
            key={`${filter.field}-${filter.operator}`}
            {...baseProps}
            operator={filter.operator as 'contains' | 'equals' | 'startsWith' | 'endsWith' | 'not'}
          />
        )

      case 'integer':
        return (
          <NumberFilterInput
            key={`${filter.field}-${filter.operator}`}
            {...baseProps}
            operator={filter.operator as 'equals' | 'gt' | 'gte' | 'lt' | 'lte' | 'not'}
          />
        )

      case 'checkbox':
        return (
          <BooleanFilterInput
            key={`${filter.field}-${filter.operator}`}
            {...baseProps}
            operator="is"
            value={Boolean(filter.value)}
            onChange={(value: boolean) => {
              const newFilters = addFilter(currentFilters, filter.field, filter.operator, value)
              handleUpdateFilters(newFilters)
            }}
          />
        )

      case 'timestamp':
        return (
          <DateFilterInput
            key={`${filter.field}-${filter.operator}`}
            {...baseProps}
            operator={filter.operator as 'equals' | 'gt' | 'gte' | 'lt' | 'lte'}
          />
        )

      case 'select':
        if (field.options) {
          return (
            <SelectFilterInput
              key={`${filter.field}-${filter.operator}`}
              {...baseProps}
              operator={filter.operator as 'equals' | 'in' | 'not' | 'notIn'}
              options={field.options}
              multiple={filter.operator === 'in' || filter.operator === 'notIn'}
            />
          )
        }
        return null

      case 'relationship':
        // For relationship filters, we would need to fetch related items
        // This is a simplified version - in production, you'd fetch the related items
        return (
          <RelationshipFilterInput
            key={`${filter.field}-${filter.operator}`}
            {...baseProps}
            operator={filter.operator as 'equals' | 'in'}
            relatedItems={[]}
            multiple={filter.operator === 'in'}
          />
        )

      default:
        return null
    }
  }

  return (
    <Card className={className}>
      <div className="p-4 space-y-4">
        {/* Active Filters */}
        {currentFilters.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Active Filters</h3>
              <Button variant="ghost" size="sm" onClick={handleClearAll}>
                Clear All
              </Button>
            </div>
            <div className="space-y-2">
              {currentFilters.map((filter) => renderFilterInput(filter))}
            </div>
          </div>
        )}

        {/* Add Filter Button */}
        {!isAddingFilter ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsAddingFilter(true)}
            className="w-full"
          >
            + Add Filter
          </Button>
        ) : (
          <div className="p-3 bg-muted/50 rounded-md space-y-3">
            <div className="flex gap-2">
              {/* Field Selector */}
              <div className="flex-1">
                <Select
                  value={selectedField}
                  onValueChange={(value) => {
                    setSelectedField(value)
                    setSelectedOperator('')
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select field..." />
                  </SelectTrigger>
                  <SelectContent>
                    {fields.map((field) => (
                      <SelectItem key={field.name} value={field.name}>
                        {formatFieldName(field.name)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Operator Selector */}
              {selectedField && (
                <div className="flex-1">
                  <Select
                    value={selectedOperator}
                    onValueChange={(value) => setSelectedOperator(value as FilterOperator)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select operator..." />
                    </SelectTrigger>
                    <SelectContent>
                      {(() => {
                        const field = fieldMap.get(selectedField)
                        if (!field) return null
                        const operators = FIELD_TYPE_OPERATORS[field.type] || []
                        return operators.map((op) => (
                          <SelectItem key={op} value={op}>
                            {OPERATOR_LABELS[op]}
                          </SelectItem>
                        ))
                      })()}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Add/Cancel Buttons */}
              {selectedField && selectedOperator && (
                <Button
                  size="sm"
                  onClick={() => {
                    const field = fieldMap.get(selectedField)
                    if (field) {
                      const defaultValue = getDefaultValue(field.type, selectedOperator)
                      handleAddFilter(selectedField, selectedOperator, defaultValue)
                    }
                  }}
                >
                  Add
                </Button>
              )}

              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setIsAddingFilter(false)
                  setSelectedField('')
                  setSelectedOperator('')
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
      </div>
    </Card>
  )
}
