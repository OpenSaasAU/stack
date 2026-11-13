---
'@opensaas/stack-ui': minor
---

An unknown relationship count no longer reads as zero: the list view renders no number for a relation a rule withholds, and the item page says the section can't be shown rather than "No related rows yet".

`RelationshipTableClient` takes an `unavailable` prop for that state.
