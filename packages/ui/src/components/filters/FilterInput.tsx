/**
 * Base filter input components for building custom filters
 * These are primitives that can be composed into field-specific filters
 */
'use client'

import * as React from 'react'
import { Input } from '../../primitives/input.js'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../primitives/select.js'
import { Checkbox } from '../../primitives/checkbox.js'
import { DateTimePicker } from '../../primitives/datetime-picker.js'
import { Button } from '../../primitives/button.js'
import type { FilterOperator } from '../../lib/filter-types.js'
import { OPERATOR_LABELS } from '../../lib/filter-types.js'

export interface FilterInputBaseProps {
  field: string
  operator: FilterOperator
  value: string | string[] | boolean | number
  onChange: (value: string | string[] | boolean | number) => void
  onRemove: () => void
  label?: string
}

/**
 * Text filter input
 * Supports: contains, equals, startsWith, endsWith, not
 */
export interface TextFilterInputProps extends Omit<FilterInputBaseProps, 'operator'> {
  operator: 'contains' | 'equals' | 'startsWith' | 'endsWith' | 'not'
}

export function TextFilterInput({
  field,
  operator,
  value,
  onChange,
  onRemove,
  label,
}: TextFilterInputProps) {
  return (
    <div className="flex items-center gap-2 p-3 bg-muted/50 rounded-md">
      <div className="flex-1 flex items-center gap-2">
        <span className="text-sm font-medium min-w-[100px]">{label || field}</span>
        <span className="text-sm text-muted-foreground">{OPERATOR_LABELS[operator]}</span>
        <Input
          type="text"
          value={String(value)}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Enter value..."
          className="flex-1"
        />
      </div>
      <Button variant="ghost" size="sm" onClick={onRemove} className="h-8 w-8 p-0">
        ✕
      </Button>
    </div>
  )
}

/**
 * Number filter input
 * Supports: equals, gt, gte, lt, lte, not
 */
export interface NumberFilterInputProps extends Omit<FilterInputBaseProps, 'operator'> {
  operator: 'equals' | 'gt' | 'gte' | 'lt' | 'lte' | 'not'
}

export function NumberFilterInput({
  field,
  operator,
  value,
  onChange,
  onRemove,
  label,
}: NumberFilterInputProps) {
  return (
    <div className="flex items-center gap-2 p-3 bg-muted/50 rounded-md">
      <div className="flex-1 flex items-center gap-2">
        <span className="text-sm font-medium min-w-[100px]">{label || field}</span>
        <span className="text-sm text-muted-foreground">{OPERATOR_LABELS[operator]}</span>
        <Input
          type="number"
          value={String(value)}
          onChange={(e) => onChange(Number(e.target.value))}
          placeholder="Enter number..."
          className="flex-1"
        />
      </div>
      <Button variant="ghost" size="sm" onClick={onRemove} className="h-8 w-8 p-0">
        ✕
      </Button>
    </div>
  )
}

/**
 * Boolean filter input
 * Supports: is
 */
export interface BooleanFilterInputProps {
  field: string
  operator: 'is'
  value: boolean
  onChange: (value: boolean) => void
  onRemove: () => void
  label?: string
}

export function BooleanFilterInput({
  field,
  value,
  onChange,
  onRemove,
  label,
}: BooleanFilterInputProps) {
  return (
    <div className="flex items-center gap-2 p-3 bg-muted/50 rounded-md">
      <div className="flex-1 flex items-center gap-2">
        <span className="text-sm font-medium min-w-[100px]">{label || field}</span>
        <span className="text-sm text-muted-foreground">is</span>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              checked={value === true}
              onChange={() => onChange(true)}
              className="cursor-pointer"
            />
            <span className="text-sm">True</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              checked={value === false}
              onChange={() => onChange(false)}
              className="cursor-pointer"
            />
            <span className="text-sm">False</span>
          </label>
        </div>
      </div>
      <Button variant="ghost" size="sm" onClick={onRemove} className="h-8 w-8 p-0">
        ✕
      </Button>
    </div>
  )
}

/**
 * Date/Timestamp filter input
 * Supports: equals, gt, gte, lt, lte
 */
export interface DateFilterInputProps extends Omit<FilterInputBaseProps, 'operator'> {
  operator: 'equals' | 'gt' | 'gte' | 'lt' | 'lte'
}

export function DateFilterInput({
  field,
  operator,
  value,
  onChange,
  onRemove,
  label,
}: DateFilterInputProps) {
  const dateValue = typeof value === 'string' ? new Date(value) : new Date()

  return (
    <div className="flex items-center gap-2 p-3 bg-muted/50 rounded-md">
      <div className="flex-1 flex items-center gap-2">
        <span className="text-sm font-medium min-w-[100px]">{label || field}</span>
        <span className="text-sm text-muted-foreground">{OPERATOR_LABELS[operator]}</span>
        <DateTimePicker
          value={dateValue}
          onChange={(date: Date | null) => {
            if (date) {
              onChange(date.toISOString())
            }
          }}
        />
      </div>
      <Button variant="ghost" size="sm" onClick={onRemove} className="h-8 w-8 p-0">
        ✕
      </Button>
    </div>
  )
}

/**
 * Select filter input (for enum fields)
 * Supports: equals, in, not, notIn
 */
export interface SelectFilterInputProps extends Omit<FilterInputBaseProps, 'operator'> {
  operator: 'equals' | 'in' | 'not' | 'notIn'
  options: Array<{ value: string; label: string }>
  multiple?: boolean
}

export function SelectFilterInput({
  field,
  operator,
  value,
  onChange,
  onRemove,
  label,
  options,
  multiple = false,
}: SelectFilterInputProps) {
  const isMultiple = operator === 'in' || operator === 'notIn' || multiple

  return (
    <div className="flex items-center gap-2 p-3 bg-muted/50 rounded-md">
      <div className="flex-1 flex items-center gap-2">
        <span className="text-sm font-medium min-w-[100px]">{label || field}</span>
        <span className="text-sm text-muted-foreground">{OPERATOR_LABELS[operator]}</span>
        {isMultiple ? (
          <div className="flex-1 flex flex-wrap gap-2">
            {options.map((option) => {
              const values = Array.isArray(value) ? value : [value]
              const isSelected = values.includes(option.value)
              return (
                <label
                  key={option.value}
                  className="flex items-center gap-1 px-2 py-1 bg-background rounded border cursor-pointer hover:bg-muted/30"
                >
                  <Checkbox
                    checked={isSelected}
                    onCheckedChange={(checked) => {
                      const currentValues = Array.isArray(value) ? value : []
                      if (checked) {
                        onChange([...currentValues, option.value])
                      } else {
                        onChange(currentValues.filter((v) => v !== option.value))
                      }
                    }}
                  />
                  <span className="text-sm">{option.label}</span>
                </label>
              )
            })}
          </div>
        ) : (
          <div className="flex-1">
            <Select value={String(value)} onValueChange={(val) => onChange(val)}>
              <SelectTrigger>
                <SelectValue placeholder="Select..." />
              </SelectTrigger>
              <SelectContent>
                {options.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>
      <Button variant="ghost" size="sm" onClick={onRemove} className="h-8 w-8 p-0">
        ✕
      </Button>
    </div>
  )
}

/**
 * Relationship filter input (filter by related item)
 * Supports: equals, in
 */
export interface RelationshipFilterInputProps extends Omit<FilterInputBaseProps, 'operator'> {
  operator: 'equals' | 'in'
  relatedItems: Array<{ id: string; displayValue: string }>
  multiple?: boolean
}

export function RelationshipFilterInput({
  field,
  operator,
  value,
  onChange,
  onRemove,
  label,
  relatedItems,
  multiple = false,
}: RelationshipFilterInputProps) {
  const isMultiple = operator === 'in' || multiple

  return (
    <div className="flex items-center gap-2 p-3 bg-muted/50 rounded-md">
      <div className="flex-1 flex items-center gap-2">
        <span className="text-sm font-medium min-w-[100px]">{label || field}</span>
        <span className="text-sm text-muted-foreground">{OPERATOR_LABELS[operator]}</span>
        {isMultiple ? (
          <div className="flex-1 flex flex-wrap gap-2">
            {relatedItems.map((item) => {
              const values = Array.isArray(value) ? value : [value]
              const isSelected = values.includes(item.id)
              return (
                <label
                  key={item.id}
                  className="flex items-center gap-1 px-2 py-1 bg-background rounded border cursor-pointer hover:bg-muted/30"
                >
                  <Checkbox
                    checked={isSelected}
                    onCheckedChange={(checked) => {
                      const currentValues = Array.isArray(value) ? value : []
                      if (checked) {
                        onChange([...currentValues, item.id])
                      } else {
                        onChange(currentValues.filter((v) => v !== item.id))
                      }
                    }}
                  />
                  <span className="text-sm">{item.displayValue}</span>
                </label>
              )
            })}
          </div>
        ) : (
          <div className="flex-1">
            <Select value={String(value)} onValueChange={(val) => onChange(val)}>
              <SelectTrigger>
                <SelectValue placeholder="Select..." />
              </SelectTrigger>
              <SelectContent>
                {relatedItems.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.displayValue}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>
      <Button variant="ghost" size="sm" onClick={onRemove} className="h-8 w-8 p-0">
        ✕
      </Button>
    </div>
  )
}
