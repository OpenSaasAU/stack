---
'create-opensaas-app': patch
---

Template `build` script runs `opensaas generate` instead of `pnpm generate`, so `npm run build` works without pnpm; the `starter` example (basic template) now sets a new post's author to the signed-in user.
