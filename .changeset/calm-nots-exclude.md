---
'@opensaas/stack-core': patch
---

Fix `NOT: [a, b]` in the Where vocabulary lowering to `NOT (a AND b)`, which widened access filters written the Prisma/Keystone way. It now excludes every branch, and `NOT: []` adds no constraint.
