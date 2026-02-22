---
'@opensaas/stack-cli': minor
---

Improve KeystoneJS migration agent with side-by-side examples and targeted update guidance

The Keystone migration wizard and agent now produce a targeted migration guide instead of
regenerating the entire config. Since Keystone and OpenSaaS Stack share the same
`list()`/field/hook/access API, only imports, the database adapter config, and auth setup
need to change.

Key improvements:

- The migration agent prompt now includes side-by-side Keystone vs OpenSaaS examples for
  config structure, imports, access control, hooks, auth, and many-to-many join tables
- The wizard uses a minimal fast-path for Keystone projects (just 3 questions: db provider,
  auth, auth methods) instead of the full question flow
- The generator produces a diff-style migration guide for Keystone showing exactly what to
  change, rather than regenerating list definitions the user already has
- Many-to-many join table naming is now surfaced automatically when M2M relations are
  detected, with `joinTableNaming: 'keystone'` guidance to preserve existing data
