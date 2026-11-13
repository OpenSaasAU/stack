---
'@opensaas/stack-core': patch
---

Row and bulk actions now run only when `hasAccess` returns exactly `true`, the same rule as the menu; a truthy non-`true` value or a throwing check is refused.
