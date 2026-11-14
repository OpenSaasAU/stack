---
'@opensaas/stack-ui': patch
---

Stop Markdown in `packages/ui` from adding classes to the prebuilt stylesheet, and guard against it losing classes that examples and packages use.
