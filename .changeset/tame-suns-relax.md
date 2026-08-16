---
'@opensaas/stack-cli': patch
---

Fix `resolveTsconfigAlias` corrupting resolution of `opensaas.config.ts` and its whole import closure when `tsconfig.json` has a bare `"*"` path pattern (e.g. `{ "*": ["./src/*"] }`, a common catch-all for unprefixed imports like `lib/utils`). The bare pattern now produces an empty alias key, which jiti's prefix-based resolution would otherwise match against every specifier; it is now skipped and reported as a warning like other unrepresentable path entries.
