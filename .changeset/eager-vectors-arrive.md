---
'@opensaas/stack-rag': minor
'@opensaas/stack-core': minor
---

Automatic embedding generation runs, and the package no longer says otherwise

`@opensaas/stack-rag` was built and documented while the secured write surface could not
execute on the Prisma 8 collection, so the plugin's escalated write threw on every
invocation. That surface now executes, and generation with it:
`context.db.Article.create({ data: { content } })` commits the row, and once that
transaction settles the plugin embeds the **persisted** source text and writes the vector
and its metadata under sudo. Writing the source text again regenerates it; a write that
leaves the source text alone does not, because the `sourceHash` on the stored metadata
short-circuits.

Everything written for the inert surface is gone with it:

- `generation-failure.ts` no longer classifies "the secured write surface has not been
  ported" as a standing defect. The predicate matched
  `findUnique is not a function` / `Unknown column "data"`, neither of which the write
  pipeline can now raise, and the branch logged
  `EMBEDDING GENERATION IS NOT RUNNING … No config change works around it` — a false
  statement to a user. A provider `type` no factory answers to is still reported as
  standing; everything else is still reported per occurrence as transient.
- The write denial and the search helpers are tested through `context.db` rather than
  through `hookPipeline`, and every vector under assertion is one the generation hook
  produced from source text written through the same surface. `allowManualWrites` is
  asserted by reading the columns back rather than by inspecting resolved data.

`hookPipeline` is no longer exported from `@opensaas/stack-core/internal`. It was added
there so `@opensaas/stack-rag` could prove its write denial one layer below
`context.db`, which was the deepest seam that then existed; nothing depends on it now.
That path carries no semver guarantee and the export was never released.

`allowManualWrites` remains the deliberate opt-out for an application that maintains its
own vectors — it is not a workaround for anything:

```typescript
manualVector: embedding({ dimensions: 1536, allowManualWrites: true })
```

Core's multi-column write-access gate is now also proven through `context.db`: a denied
create or update throws naming the field and leaves the per-part columns untouched, a
granted one writes both, `sudo()` bypasses the gate, and clearing the field with `null`
clears both columns.
