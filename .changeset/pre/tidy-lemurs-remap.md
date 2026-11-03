---
'@opensaas/stack-auth': patch
---

Refuse (at `pnpm generate` time) an `authPlugin({ user/session/account/verification/rateLimit: { fields } })` remap whose target column string equals another field's own default key on the same model, naming both fields. Left unrefused, better-auth's direct-hit-first `getDefaultFieldName` resolution would silently misattribute a field's attributes to the colliding field — for example skipping the `BigInt` widening a remapped `int8` column needs — with no error raised (#1545).
