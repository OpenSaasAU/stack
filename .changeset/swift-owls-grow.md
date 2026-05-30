---
'@opensaas/stack-ui': patch
---

Refactor `FieldRenderer` to use data-presence checks instead of `fieldConfig.type` comparisons

`FieldRenderer` no longer checks `fieldConfig.type` to decide which props to pass to field
components. Field-specific UI props (select options, relationship items/key/many) are now derived
from the serialised field config using data-presence checks (`fieldConfig.options`, `fieldConfig.ref`)
— the same self-contained pattern used for Prisma and TypeScript generation.

**For users:** no changes required. Field rendering behaviour is unchanged.
