---
'@opensaas/stack-ui': patch
---

List-page relationship cells now render their label via the shared label seam (`getItemLabel`), honouring a related list's `ui.labelField` instead of an inline `name → title → label → id` guess that had drifted from the item form.
