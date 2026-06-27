---
'@opensaas/stack-core': patch
---

Fix false denial of nested `connect` (and `connectOrCreate`'s connect branch): connect now requires read/query access on the target and evaluates filter results via DB reachability (`findFirst({ where: { AND: [connection, accessFilter] } })`), so nested-relation and `AND`/`OR`/`some`/`none`/`not` filters no longer always fail.
