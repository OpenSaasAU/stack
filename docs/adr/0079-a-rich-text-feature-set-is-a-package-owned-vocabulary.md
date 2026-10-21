# A rich text feature set is a package-owned vocabulary, not Tiptap extensions

Status: accepted

A `richText()` field declares its **Rich text feature set** as plain data in a vocabulary `@opensaas/stack-tiptap` owns (`features: { bold: true, heading: { levels: [2, 3] }, link: { protocols: [...] } }`), not as Tiptap `Extension` instances. The package maps each feature to its extension on both sides: the server builds a ProseMirror schema from it to refuse non-conforming writes, and the editor builds its extensions and toolbar from it. A declared set replaces the default rather than merging with it.

## Context

Issue #1950: the stored document must contain only what the editor offers. A field's `ui` is the only part of its config that crosses the server→client boundary, and an `Extension` carries functions, so it cannot. Taking extensions in the config would need a second, matching declaration on the client, and two declarations drift apart, which is the gap this closes.

## Considered options

- **Package-owned vocabulary (chosen).** One serialisable declaration drives validation, editor and toolbar. Costs: no custom or third-party extensions, and adding a feature means a package release.
- **Tiptap extension instances.** Rejected: they can't reach the editor, so the editor and the validator can drift.
- **Vocabulary plus an extension escape hatch.** Deferred: it reopens the drift for whatever goes through the hatch.

## Consequences

- Writes are refused, never normalised: a field schema's parse output is discarded, so validation can only accept or reject.
- Attribute values are checked separately (link protocol, heading level, pinned link `target`/`rel`). ProseMirror's schema check covers node and mark types only.
- Enforcement is on writes only. A stored document that predates its field's feature set fails when it is next saved, not when it is read.
