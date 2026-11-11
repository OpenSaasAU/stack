---
'@opensaas/stack-cli': patch
---

`opensaas migrate --type` rejects unknown types, `db:update` says so when there is nothing to apply, the dev loop's config-error message no longer claims the app keeps serving, and the starter README drops the Home link that 404s.
