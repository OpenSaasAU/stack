"use client";

import * as React from "react";
import { useState } from "react";
import { Input } from "../../primitives/input.js";
import { Button } from "../../primitives/button.js";
import { Card } from "../../primitives/card.js";

export interface SearchBarProps {
  onSearch: (query: string) => void;
  onClear?: () => void;
  placeholder?: string;
  defaultValue?: string;
  searchLabel?: string;
  className?: string;
}

/**
 * Standalone search bar component
 * Can be embedded in any custom page
 *
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
  placeholder = "Search...",
  defaultValue = "",
  searchLabel = "Search",
  className,
}: SearchBarProps) {
  const [searchInput, setSearchInput] = useState(defaultValue);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSearch(searchInput.trim());
  };

  const handleClear = () => {
    setSearchInput("");
    onClear?.();
  };

  return (
    <Card className={`p-4 ${className || ""}`}>
      <form onSubmit={handleSubmit} className="flex gap-2">
        <div className="flex-1 relative">
          <Input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder={placeholder}
            className="pr-10"
          />
          {searchInput && (
            <button
              type="button"
              onClick={handleClear}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              ✕
            </button>
          )}
        </div>
        <Button type="submit">{searchLabel}</Button>
      </form>
    </Card>
  );
}
