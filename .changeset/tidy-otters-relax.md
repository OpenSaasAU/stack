---
'@opensaas/stack-cli': patch
---

Remove the generated `prisma-extensions.ts` module and its unreachable `$extends` branch in the generated context factory — the guard deciding whether to apply it was always true, so the extension never actually ran (`context.db` already applies `resolveOutput` correctly). This also fixes `TS2589: Type instantiation is excessively deep` on larger schemas, since the removed branch's inferred type was the cause. No runtime behavior changes; regenerating cleans up a stale `prisma-extensions.ts` left by prior versions.
