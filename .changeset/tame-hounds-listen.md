---
'@opensaas/stack-ui': patch
---

Add a standing test pinning the full chain from a genuine PostgreSQL unique-constraint violation to item-form state — `withOrigin` classification, `normalizeDatabaseError`'s constraint-map resolution, `serverAction`'s `{ error, fieldErrors }` envelope, and `ItemFormClient`/`useItemForm` — so a per-field message reaches the right field and no raw driver text leaks into it (#1334). No runtime change.
