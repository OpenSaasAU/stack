---
'@opensaas/stack-cli': minor
---

Wait for the dev loop's promotion to finish before the staged-reconcile test stamps the root config

`packages/cli/tests/staged-reconcile.test.ts` treated the app answering with the new
contract as proof that the promotion behind it had finished. It is not: promotion moves
a set of files and the filesystem offers no multi-file commit. `prisma/contract.ts` is
swapped first, then `prisma/contract.json` — the first of them the app reads, and so the
first that can change its answer — then `contract.d.ts`, then `.opensaas/`, and the
project-root `prisma.config.ts` last. Between the app's answer changing and that final
swap the test could append its "held back until promotion" stamp to a root config the
loop was about to overwrite, and the next assertion then read a regenerated file with no
stamp in it.

The test now waits for the loop's own end-of-promotion line before stamping. That line
is printed after `promoteStagedGeneration` returns, so it is the one signal emitted once
the whole set is in place, and the wait is anchored to the output the config edit
produced so an earlier promotion's line cannot satisfy it.

No change to the reconciler: the invariant under test — a parked generation must not
reach the live root config — holds, and the test still guards it.
