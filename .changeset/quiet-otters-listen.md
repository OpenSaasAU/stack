---
'@opensaas/stack-cli': patch
'@opensaas/stack-core': patch
---

Fix `resolvePrismaBinary`'s script detection to also match a `.mjs`/`.cjs` Prisma CLI entry point, not only `.js`. Test-only fixes: correct a `bundle-typecheck.test.ts` name that overstated its own coverage (`skipLibCheck` means it never checks `contract.d.ts` for errors), cover the `longIdentifierConfig` fixture in the contract structural-equivalence suite, and move a misplaced fixture docblock onto the export it describes.
