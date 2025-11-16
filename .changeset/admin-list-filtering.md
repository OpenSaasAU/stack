---
"@opensaas/stack-ui": minor
---

Add comprehensive filtering system for admin UI list pages with URL state management

This adds a complete filtering system for admin list views with all filter state persisted in URL query parameters. Developers can use the built-in FilterBar component or build custom filter UIs using the exposed primitives.

**Features:**
- URL-based filter state (`filters[field][operator]=value` format)
- Field type-specific filters (text, integer, checkbox, timestamp, select, relationship)
- Operator support per field type (contains, equals, gt, gte, lt, lte, in, etc.)
- FilterBar component with add/remove/clear functionality
- Primitive filter input components for custom implementations
- Server-side Prisma where clause generation
- Client-side URL navigation and state updates
- Full TypeScript type safety

**New Components:**
- `FilterBar` - Main filter UI with field/operator selection
- `TextFilterInput`, `NumberFilterInput`, `BooleanFilterInput` - Text, number, and boolean filters
- `DateFilterInput` - Timestamp field filtering
- `SelectFilterInput` - Enum/select field filtering with multi-select
- `RelationshipFilterInput` - Related item filtering with multi-select

**New Utilities:**
- `parseFiltersFromURL()` - Parse filter state from URL search params
- `serializeFiltersToURL()` - Serialize filters to URL string
- `filtersToPrismaWhere()` - Convert filters to Prisma where clauses
- `addFilter()`, `removeFilter()`, `clearFilters()` - Filter state management

**Integration:**
All primitives and utilities are exported from `@opensaas/stack-ui` for developer customization. The FilterBar is automatically included in all admin list pages.
