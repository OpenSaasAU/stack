---
'@opensaas/stack-core': patch
---

Writes of values a column cannot hold (out-of-range integers and bigints, overflowing or non-numeric decimals, impossible calendar days, NUL bytes, null into NOT NULL columns) now throw `ValidationError` instead of an opaque `DatabaseError`.
