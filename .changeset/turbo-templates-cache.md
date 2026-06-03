---
'create-opensaas-app': patch
---

Include `templates/**` in the turbo `build` outputs so a cached build restores the generated templates instead of only `dist/`, fixing the e2e scaffold guard's "Template basic not found" failure on a cache hit.
