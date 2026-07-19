---
name: migrate-image-fields
description: Migrate Keystone image and file fields to OpenSaaS Stack. Leads with the non-destructive multi-column path (map onto the existing Keystone columns in place — no data migration, no re-upload). Invoke as a forked subagent, passing the project details.
context: fork
agent: general-purpose
---

Migrate the image and file fields described below from Keystone format to OpenSaaS Stack.

**Lead with the non-destructive multi-column path.** OpenSaaS Stack's `image()` / `file()` fields can map directly onto the existing Keystone per-part columns (`db.columns: 'keystone'`), assembling them into an `ImageMetadata` / `FileMetadata` on read and splitting back on write. A migrating project reaches a clean schema diff and a fully functional field with **no data migration, no dropped columns, and no re-upload of existing assets**. This is the default recommendation and respects the **Schema parity** guardrail (see ADR-0006).

JSON consolidation (collapsing the Keystone columns into a single `Json?` column) is offered only as an explicitly-flagged, **destructive** opt-in further below. It drops columns and requires a verified backup — only do it if the user explicitly asks for it.

$ARGUMENTS

## The Two Schemas

**Keystone** stores an image across 7 per-part columns and a file across 3:

```prisma
model Teacher {
  // image field "avatar"
  avatar_url                String?
  avatar_width              Int?
  avatar_height             Int?
  avatar_filesize           Int?
  avatar_contentType        String?
  avatar_contentDisposition String?
  avatar_pathname           String?
  // file field "resume"
  resume_filename String?
  resume_filesize Int?
  resume_url      String?
}
```

**OpenSaaS Stack** (greenfield default) uses a single `Json?` column per field:

```prisma
model Teacher {
  avatar Json? // ImageMetadata
  resume Json? // FileMetadata
}
```

`image()` / `file()` return these metadata shapes to your app and the admin UI in BOTH modes:

```typescript
// from @opensaas/stack-storage
interface FileMetadata {
  filename: string // storage key / generated filename
  originalFilename: string // original upload filename
  url: string // public URL
  mimeType: string // e.g. 'image/jpeg'
  size: number // bytes
  uploadedAt: string // ISO 8601 timestamp
  storageProvider: string // storage provider name, e.g. 'images'
  metadata?: Record<string, unknown> // provider-specific extras
}

interface ImageMetadata extends FileMetadata {
  width: number
  height: number
  transformations?: Record<string, { url: string; width: number; height: number; size: number }>
}
```

The multi-column mode bridges the gap: it presents the same `ImageMetadata` / `FileMetadata` to your app while leaving the physical Keystone columns untouched on disk.

---

## Recommended path: non-destructive multi-column mode

This is the path to use for almost every Keystone migration. **No SQL migration, no data loss, no re-upload.**

### Step 1: Set the field to multi-column mode

Replace the Keystone `image()` / `file()` field with the OpenSaaS Stack equivalent and add `db: { columns: 'keystone' }`:

```typescript
// Before (Keystone)
import { image, file } from '@keystone-6/core/fields'

avatar: image({ storage: 'my_local_images' })
resume: file({ storage: 'my_local_files' })

// After (OpenSaaS Stack — maps onto the existing columns in place)
import { image, file } from '@opensaas/stack-storage/fields'

avatar: image({ storage: 'images', db: { columns: 'keystone' } })
resume: file({ storage: 'files', db: { columns: 'keystone' } })
```

`db.columns: 'keystone'` uses Keystone's default `<field>_<part>` column names. If the live columns use different names, override per part — you only need to specify the parts that differ:

```typescript
avatar: image({
  storage: 'images',
  db: {
    columns: {
      mode: 'keystone',
      map: {
        url: 'avatar_image_url', // physical column for the URL part
        pathname: 'avatar_image_key',
      },
    },
  },
})
```

Image parts: `url`, `width`, `height`, `filesize`, `contentType`, `contentDisposition`, `pathname`.
File parts: `filename`, `filesize`, `url`.

### Step 2: Configure storage

The field's `storage` key references a provider in `config.storage`. The provider does NOT need to host the existing assets to read them — the stored URLs are read straight out of the columns, so existing images/files display without any re-upload. The provider is only used when a NEW file is uploaded. See the **Storage providers** section for local, S3, and Vercel Blob options.

### Step 3: Generate and verify a clean diff

```bash
# Generate the Prisma schema from the OpenSaaS config
pnpm opensaas generate

# Generate the Prisma Client
npx prisma generate

# Verify there are NO destructive changes — the multi-column field maps
# onto the existing columns, so the diff against the live DB should be empty
# (or additive only). Compare the generated schema to your live database:
npx prisma migrate diff \
  --from-url "$DATABASE_URL" \
  --to-schema-datamodel prisma/schema.prisma \
  --script

# Or, for a SQLite dev loop:
npx prisma db push
```

The generated schema emits the per-part columns with `@map` onto the live Keystone columns, so Prisma sees no drift:

```prisma
model Teacher {
  avatar_url                String? @map("avatar_url")
  avatar_width              Int?    @map("avatar_width")
  avatar_height             Int?    @map("avatar_height")
  avatar_filesize           Int?    @map("avatar_filesize")
  avatar_contentType        String? @map("avatar_contentType")
  avatar_contentDisposition String? @map("avatar_contentDisposition")
  avatar_pathname           String? @map("avatar_pathname")
}
```

### What you get

- Existing rows assemble into `ImageMetadata` / `FileMetadata` on read. Partially-populated legacy rows (e.g. only `avatar_url` set) still produce a valid object — missing scalar parts default to `0`, and an absent `contentType` becomes `application/octet-stream`.
- New uploads split the metadata back into the same per-part columns on write.
- An existing metadata value (or populated columns) is authoritative and is **never** re-uploaded — only a `File`-like input triggers a storage upload. This is locked by a test (see ADR-0006).

### Steps to run

1. Read the config to find all `image()` and `file()` fields and the models they belong to.
2. For each, update the import to `@opensaas/stack-storage/fields` and add `db: { columns: 'keystone' }` (with per-part `map` overrides only if the live column names differ from Keystone defaults).
3. Confirm the `storage` provider exists in `config.storage` (add one if needed — see below).
4. Run `pnpm opensaas generate` and a `prisma migrate diff` to confirm the diff is clean / non-destructive.
5. Report the config changes and confirm: no SQL run, no data migration, no re-upload.

---

## Storage providers

The `storage` key on each field points to a named provider in `config.storage`. All of these implement the same provider interface and work with both single-Json? and multi-column modes. Pick whichever the project already uses for assets — **it is not S3-only.**

### Local filesystem

```typescript
import { localStorage } from '@opensaas/stack-storage'

storage: {
  images: localStorage({ uploadDir: './public/uploads', serveUrl: '/uploads' }),
}
```

### S3 / S3-compatible

```typescript
import { s3Storage } from '@opensaas/stack-storage-s3'

storage: {
  images: s3Storage({ bucket: 'my-bucket', region: 'us-east-1' }),
}
```

### Vercel Blob (first-class)

`@opensaas/stack-storage-vercel` ships a fully supported Vercel Blob provider — a great fit for projects deployed on Vercel.

```bash
pnpm add @opensaas/stack-storage @opensaas/stack-storage-vercel
```

```typescript
import { vercelBlobStorage } from '@opensaas/stack-storage-vercel'

storage: {
  images: vercelBlobStorage({
    // Token defaults to the BLOB_READ_WRITE_TOKEN env var.
    token: process.env.BLOB_READ_WRITE_TOKEN,
    pathPrefix: 'images',
  }),
}
```

Because the multi-column mode reads existing stored URLs in place, you can adopt any of these providers without re-uploading the assets already referenced by the live columns. The provider only handles new uploads.

**Provider registration (S3 / Vercel Blob)**: only the `'local'` provider is built in. For new uploads to work with S3 or Vercel Blob, register the provider at startup via `registerStorageProvider(...)` from `@opensaas/stack-storage/runtime` (an unregistered type throws `Unknown storage provider type` on upload). Reads of existing assets need no provider.

---

## Destructive alternative (opt-in): consolidate to a single JSON column

> **DESTRUCTIVE — requires a verified backup. Do NOT do this unless the user explicitly asks to consolidate.**
>
> This path **drops the Keystone per-part columns** and replaces them with a single `Json?` column. If the SQL is not run correctly before `prisma db push`, **all existing image/file data is lost.** The non-destructive multi-column path above achieves the same functional field with none of this risk and is the recommended default.

Only choose this if the user has a specific reason to consolidate (e.g. they want the greenfield single-column layout) AND has confirmed a backup.

### Step A: Back up the database

```bash
# PostgreSQL
pg_dump -U username -d dbname -F c -b -v -f backup_$(date +%Y%m%d_%H%M%S).dump
# MySQL
mysqldump -u username -p dbname > backup_$(date +%Y%m%d_%H%M%S).sql
# SQLite
cp dev.db dev.db.backup_$(date +%Y%m%d_%H%M%S)
```

### Step B: Set the field to the single-Json? default

Drop the `db.columns` option (or omit it entirely) so the field emits a single `Json?` column:

```typescript
import { image, file } from '@opensaas/stack-storage/fields'

avatar: image({ storage: 'images' }) // single Json? column
resume: file({ storage: 'files' }) // single Json? column
```

### Step C: Run the consolidation SQL BEFORE `prisma db push`

**CRITICAL: run this SQL first.** Running `prisma db push` before the SQL drops the Keystone columns and loses the data. Substitute the real model and field names.

#### PostgreSQL

```sql
BEGIN;

ALTER TABLE "Teacher" ADD COLUMN IF NOT EXISTS "avatar_new" JSONB;

UPDATE "Teacher"
SET "avatar_new" = jsonb_build_object(
  'filename',          COALESCE(avatar_pathname, avatar_url),
  'originalFilename',  COALESCE(avatar_pathname, avatar_url),
  'url',               avatar_url,
  'mimeType',          COALESCE(avatar_contentType, 'application/octet-stream'),
  'size',              COALESCE(avatar_filesize, 0),
  'width',             COALESCE(avatar_width, 0),
  'height',            COALESCE(avatar_height, 0),
  'uploadedAt',        NOW()::text,
  'storageProvider',   'images'
)
WHERE avatar_url IS NOT NULL;

ALTER TABLE "Teacher"
  DROP COLUMN IF EXISTS avatar_url,
  DROP COLUMN IF EXISTS avatar_width,
  DROP COLUMN IF EXISTS avatar_height,
  DROP COLUMN IF EXISTS avatar_filesize,
  DROP COLUMN IF EXISTS avatar_contentType,
  DROP COLUMN IF EXISTS avatar_contentDisposition,
  DROP COLUMN IF EXISTS avatar_pathname;

ALTER TABLE "Teacher" RENAME COLUMN "avatar_new" TO "avatar";

COMMIT;
```

#### SQLite

```sql
BEGIN TRANSACTION;

-- SQLite cannot DROP COLUMN cleanly; rebuild the table.
-- (Replace "Teacher", the field columns, and the non-image columns with real values.)
CREATE TABLE "Teacher_new" AS
SELECT
  id,
  name,
  json_object(
    'filename',         COALESCE(avatar_pathname, avatar_url),
    'originalFilename', COALESCE(avatar_pathname, avatar_url),
    'url',              avatar_url,
    'mimeType',         COALESCE(avatar_contentType, 'application/octet-stream'),
    'size',             COALESCE(avatar_filesize, 0),
    'width',            COALESCE(avatar_width, 0),
    'height',           COALESCE(avatar_height, 0),
    'uploadedAt',       datetime('now'),
    'storageProvider',  'images'
  ) AS avatar
FROM "Teacher";

DROP TABLE "Teacher";
ALTER TABLE "Teacher_new" RENAME TO "Teacher";

COMMIT;
```

#### MySQL

```sql
START TRANSACTION;

ALTER TABLE `Teacher` ADD COLUMN `avatar_new` JSON;

UPDATE `Teacher`
SET `avatar_new` = JSON_OBJECT(
  'filename',         COALESCE(avatar_pathname, avatar_url),
  'originalFilename', COALESCE(avatar_pathname, avatar_url),
  'url',              avatar_url,
  'mimeType',         COALESCE(avatar_contentType, 'application/octet-stream'),
  'size',             COALESCE(avatar_filesize, 0),
  'width',            COALESCE(avatar_width, 0),
  'height',           COALESCE(avatar_height, 0),
  'uploadedAt',       NOW(),
  'storageProvider',  'images'
)
WHERE avatar_url IS NOT NULL;

ALTER TABLE `Teacher`
  DROP COLUMN avatar_url,
  DROP COLUMN avatar_width,
  DROP COLUMN avatar_height,
  DROP COLUMN avatar_filesize,
  DROP COLUMN avatar_contentType,
  DROP COLUMN avatar_contentDisposition,
  DROP COLUMN avatar_pathname;

ALTER TABLE `Teacher` CHANGE COLUMN `avatar_new` `avatar` JSON;

COMMIT;
```

File fields consolidate the same way over the 3 file columns (`<field>_filename`, `<field>_filesize`, `<field>_url`):

```sql
-- PostgreSQL example for a file field "resume"
ALTER TABLE "Teacher" ADD COLUMN IF NOT EXISTS "resume_new" JSONB;
UPDATE "Teacher"
SET "resume_new" = jsonb_build_object(
  'filename',         resume_filename,
  'originalFilename', resume_filename,
  'url',              resume_url,
  'mimeType',         'application/octet-stream',
  'size',             COALESCE(resume_filesize, 0),
  'uploadedAt',       NOW()::text,
  'storageProvider',  'files'
)
WHERE resume_filename IS NOT NULL OR resume_url IS NOT NULL;
-- ...then DROP the old columns and RENAME resume_new -> resume.
```

### Step D: Generate and verify

```bash
pnpm opensaas generate
npx prisma generate
npx prisma db push   # the columns were already consolidated by the SQL above
```

If anything goes wrong, restore from the backup taken in Step A.

---

## Decision summary

1. Read the config; identify every `image()` / `file()` field and its model.
2. **Default:** switch each field's import to `@opensaas/stack-storage/fields` and add `db: { columns: 'keystone' }` (with per-part `map` overrides only if needed). Confirm the `storage` provider. Run `opensaas generate` + `prisma migrate diff` to show a clean, non-destructive diff. No SQL, no re-upload.
3. **Only if the user explicitly asks to consolidate to JSON:** back up first, drop the `db.columns` option, run the destructive SQL BEFORE `prisma db push`, then generate and push.
4. Report what changed in the config, which path was taken, and (for the destructive path only) the SQL location and the backup reminder.
