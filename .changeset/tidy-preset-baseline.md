---
'@opensaas/stack-ui': patch
---

Derive the stylesheet's `modern` color defaults from `presetThemes.modern` via a `generate:css` codegen step (wired into build), so the preset and `globals.css` can no longer drift. No visual or behavioral change — the emitted CSS is byte-identical to the previous values.
