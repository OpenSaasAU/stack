# Image/file migration prefers non-destructive multi-column parity over JSON consolidation

Keystone stores an image field across seven columns (`<field>_url`, `<field>_width`, `<field>_height`, `<field>_filesize`, `<field>_contentType`, `<field>_contentDisposition`, `<field>_pathname`) and a file field across three. The stack's `image()`/`file()` fields default to a single `Json?` column. To migrate an existing database without breaking **Schema parity**, `image()`/`file()` gain a multi-column mode that maps onto the existing Keystone columns in place, rather than consolidating them into JSON (which drops columns and is destructive).

## Decisions

- **Multi-column mode is the parity path.** `image()`/`file()` can map to the existing per-part Keystone columns (configurable `@map` names) and assemble/split an `ImageMetadata`/`FileMetadata` value across them. A migrating project reaches a clean diff and a functional field with no data migration and no re-upload of existing assets.
- **JSON consolidation becomes the explicitly-destructive alternative.** The single-`Json?` column remains the default for greenfield projects and is offered to migrators only as an opt-in, clearly-flagged destructive path (drops the old columns; requires a backup). The `migrate-image-fields` skill and `specs/keystone-image-migration.md` are rewritten to lead with the non-destructive multi-column path and demote consolidation.
- **No re-upload of existing assets.** Both modes treat an already-shaped metadata value (or, in multi-column mode, populated columns) as authoritative and never re-upload — only a `File`-like input triggers a storage upload. This guarantee is locked by a test.
- **Vercel Blob is a supported provider.** `@opensaas/stack-storage-vercel` already implements the provider interface; it is documented as a first-class option for migrators (not S3-only).

## Why this is worth recording

The stack's own image-migration guidance previously told migrators to consolidate to a JSON column and drop the originals — a destructive operation that contradicts the no-destructive-migration guardrail the whole migration program is gated on. A future reader will wonder why `image()` has a multi-column mode at all when JSON is simpler; the answer is that schema parity over a live Keystone database requires reading the original columns in place. Reversing this (forcing consolidation) would reintroduce a destructive migration, so the trade-off is worth pinning down.
