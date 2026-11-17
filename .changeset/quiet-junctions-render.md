---
'@opensaas/stack-ui': patch
---

Rendering an item view over a config `opensaas generate` refuses treats each to-many as no junction edge, leaving it read-only instead of failing the render.
