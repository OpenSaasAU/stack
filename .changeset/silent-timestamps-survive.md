---
'@opensaas/stack-cli': patch
'@opensaas/stack-core': patch
---

Fix two spots that assumed every list carries `createdAt`/`updatedAt` (timestamps are opt-in, ADR-0004): the migration generator no longer drops a source model's timestamp columns — it opts the list into `db.timestamps` when they match the auto-managed shape, or declares them as ordinary fields otherwise — and the MCP fields projection no longer advertises or accepts `createdAt`/`updatedAt` on a list that doesn't have them.
