---
'@opensaas/stack-rag': patch
'@opensaas/stack-ui': patch
---

No functional change. The doc-block checker's fragment classifications (issue
#1382) moved off a `file:line`-keyed `scripts/doc-blocks/fragments.json` and
onto an HTML comment directly above each classified block, so `packages/rag/CLAUDE.md`,
`packages/rag/README.md` and `packages/ui/README.md` each gained a few
invisible `<!-- doc-check: ... -->` comments; no visible text changed.
