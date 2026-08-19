'use client'

import * as React from 'react'
import { useState } from 'react'
import { Input } from '../../primitives/input.js'
import { Button } from '../../primitives/button.js'
import { Card } from '../../primitives/card.js'
import { cn } from '../../lib/utils.js'
import { usePathname, useRouter } from 'next/navigation.js'

/**
 * Per-part `classNames` slots for `SearchBar` (issue #709). Each merges onto its
 * `data-slot` part via `cn`/tailwind-merge.
 */
export interface SearchBarClassNames {
  /** Card wrapper (`data-slot="search-bar"`). */
  root?: string
  /** The `<form>` (`data-slot="search-bar-form"`). */
  form?: string
  /** Wrapper around the input + clear button. */
  inputWrapper?: string
  /** The search `<input>` (`data-slot="input"`). */
  input?: string
  /** The inline clear button (`data-slot="search-bar-clear"`). */
  clearButton?: string
  /** The submit button (`data-slot="button"`). */
  submit?: string
}

export interface SearchBarProps {
  onSearch?: (query: string) => void
  onClear?: () => void
  placeholder?: string
  defaultValue?: string
  searchLabel?: string
  className?: string
  /** Structured per-part class overrides; each merges onto its `data-slot` part. */
  classNames?: SearchBarClassNames
}

/**
 * @example
 * ```tsx
 * <SearchBar
 *   onSearch={(query) => {
 *     setSearchQuery(query);
 *     fetchPosts({ search: query });
 *   }}
 *   onClear={() => {
 *     setSearchQuery('');
 *     fetchPosts({});
 *   }}
 *   placeholder="Search posts..."
 * />
 * ```
 */
export function SearchBar({
  onSearch,
  onClear,
  placeholder = 'Search...',
  defaultValue = '',
  searchLabel = 'Search',
  className,
  classNames,
}: SearchBarProps) {
  const router = useRouter()
  const pathname = usePathname()
  const [searchInput, setSearchInput] = useState(defaultValue)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (onSearch) onSearch(searchInput.trim())
    else router.push(`${pathname}?search=${searchInput.trim()}`)
  }

  const handleClear = () => {
    setSearchInput('')
    onClear?.()
  }

  return (
    <Card data-slot="search-bar" className={cn('p-4', className, classNames?.root)}>
      <form
        data-slot="search-bar-form"
        onSubmit={handleSubmit}
        className={cn('flex gap-2', classNames?.form)}
      >
        <div className={cn('flex-1 relative', classNames?.inputWrapper)}>
          <Input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder={placeholder}
            className={cn('pr-10', classNames?.input)}
          />
          {searchInput && (
            <button
              type="button"
              data-slot="search-bar-clear"
              onClick={handleClear}
              className={cn(
                'absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground',
                classNames?.clearButton,
              )}
            >
              ✕
            </button>
          )}
        </div>
        <Button type="submit" className={classNames?.submit}>
          {searchLabel}
        </Button>
      </form>
    </Card>
  )
}
