---
'@opensaas/stack-ui': minor
---

Admin chrome polish pass: consistent page headers, designed empty states, skeleton coverage, nav active states, and table density (issue #710).

The prebuilt admin now shares a restrained, token-driven chrome across every screen. Two new composable components are exported and used throughout:

- `PageHeader` — the consistent title/description/back-link/actions pattern used by the dashboard, list, item, and singleton screens. Exposes `data-slot` parts (`page-header`, `page-header-title`, `page-header-description`, `page-header-actions`, `page-header-back`, `page-header-icon`) and a structured `classNames` contract. An opt-in `gradient` prop frames the dashboard — the design system's single signature gradient moment.
- `EmptyState` — a designed empty surface (icon + title + description + actions) now shown on every list and relationship surface. Also exposes `data-slot` parts and a `classNames` contract.

```tsx
import { PageHeader, EmptyState } from '@opensaas/stack-ui'

<PageHeader title="Posts" description="12 items" actions={<CreateButton />} />

<EmptyState
  icon={<Inbox />}
  title="No items yet"
  description="Create your first record to see it listed here."
  actions={<CreateButton />}
/>
```

Also included:

- Full-screen skeleton fallbacks (`DashboardSkeleton`, `ListViewSkeleton`, `ItemFormSkeleton`, `PageHeaderSkeleton`) wired through a `Suspense` boundary in `AdminUI`, so every data-loading screen streams behind a placeholder of the same shape.
- Navigation active states now use `aria-current="page"` and a flat solid brand fill (no gradient/pulse); nav and dashboard icons use `lucide-react` instead of emoji.
- Tables right-align numeric columns and use tabular numerals; a new `isNumericField(fieldType)` helper is exported.
- Gradient usage is limited to the dashboard header accent and avatar fallbacks per the spec; the brand wordmark and active nav are now solid tokens.

No new capabilities and no information-architecture changes — this is a visual/chrome polish pass consuming existing tokens.
