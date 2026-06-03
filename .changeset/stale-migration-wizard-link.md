---
'@opensaas/stack-cli': patch
---

Fix stale migration guide link in the MCP migration wizard's config-generation failure message; it now reuses the canonical `MIGRATION_GUIDE_URL` (`https://stack.opensaas.au/docs/guides/migrating-from-keystone`) instead of the old 404 path.
