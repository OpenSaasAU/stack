---
'@opensaas/stack-cli': patch
---

Note in the generated Keystone auth migration guide that Auth-injected lists now ship closed by default (ADR-0013) and how to grant them access via `authPlugin({ access: { ... } })`.
