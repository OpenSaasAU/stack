---
'@opensaas/stack-rag': patch
---

Fix the generation hook's escalated-write lookup throwing past its guard on a missing plugin context, which surfaced as a failure off an already-committed write instead of being logged as a standing defect.
