# Keystone Image & File Field Migration Guide

## Overview

This guide covers migrating KeystoneJS `image()` and `file()` fields to OpenSaaS Stack.

Keystone stores image and file metadata across **several physical columns** per field. OpenSaaS Stack's `image()` / `file()` fields default to a single `Json?` column for greenfield projects, but they also ship a **non-destructive multi-column mode** that maps directly onto the existing Keystone columns in place.

**The recommended migration path is the non-destructive multi-column mode.** It reaches a clean schema diff and a fully functional field with **no data migration, no dropped columns, and no re-upload of existing assets** — honouring the **Schema parity** guardrail (see [ADR-0006](../docs/adr/0006-image-file-migration-prefers-multi-column-parity.md)). Consolidating the columns into a single JSON column is still possible, but it is a **destructive** operation that drops the original columns and requires a verified backup, so it is documented here only as an explicitly-flagged opt-in.

## The Two Storage Layouts

### KeystoneJS (multi-column)

Keystone creates **7 columns** for each image field and **3 columns** for each file field:

```prisma
model Teacher {
  id   String @id @default(cuid())
  name String

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

### OpenSaaS Stack (single JSON column — greenfield default)

For new projects, OpenSaaS Stack uses a single JSON column per field:

```prisma
model Teacher {
  id     String @id @default(cuid())
  name   String
  avatar Json?  // ImageMetadata
  resume Json?  // FileMetadata
}
```

In **both** modes the field returns the same metadata shapes to your application and the admin UI:

```typescript
// from @opensaas/stack-storage
interface FileMetadata {
  filename: string // Storage key / generated filename
  originalFilename: string // Original filename from upload
  url: string // Public URL to access the file
  mimeType: string // MIME type (e.g., 'image/jpeg')
  size: number // File size in bytes
  uploadedAt: string // ISO 8601 timestamp
  storageProvider: string // Storage provider name (e.g., 'images')
  metadata?: Record<string, unknown> // Optional provider-specific metadata
}

interface ImageMetadata extends FileMetadata {
  width: number // Image width in pixels
  height: number // Image height in pixels
  transformations?: Record<
    string,
    {
      url: string
      width: number
      height: number
      size: number
    }
  > // Optional image transformations/variants
}
```

---

## Recommended path: non-destructive multi-column mode

The `image()` / `file()` fields can map onto the existing Keystone per-part columns by setting `db.columns: 'keystone'`. The field assembles those columns into an `ImageMetadata` / `FileMetadata` on read and splits a metadata value back into them on write. **Nothing is dropped, no data is rewritten, and existing assets are never re-uploaded.**

### Step 1: Update the OpenSaaS config

```typescript
import { config, list } from '@opensaas/stack-core'
import { text } from '@opensaas/stack-core/fields'
import { image, file } from '@opensaas/stack-storage/fields'
import { localStorage } from '@opensaas/stack-storage'

export default config({
  db: { provider: 'postgresql', url: process.env.DATABASE_URL },
  storage: {
    images: localStorage({ uploadDir: './uploads/images', serveUrl: '/api/files' }),
    files: localStorage({ uploadDir: './uploads/files', serveUrl: '/api/files' }),
  },
  lists: {
    Teacher: list({
      fields: {
        name: text({ validation: { isRequired: true } }),
        // Maps onto avatar_url, avatar_width, ... in place
        avatar: image({ storage: 'images', db: { columns: 'keystone' } }),
        // Maps onto resume_filename, resume_filesize, resume_url in place
        resume: file({ storage: 'files', db: { columns: 'keystone' } }),
      },
    }),
  },
})
```

`db.columns: 'keystone'` uses Keystone's default `<field>_<part>` column naming. The parts are:

- **Image:** `url`, `width`, `height`, `filesize`, `contentType`, `contentDisposition`, `pathname`
- **File:** `filename`, `filesize`, `url`

### Step 2: Override column names if they differ (optional)

If your live database uses non-default column names, override the affected parts. You only need to specify the parts that differ; omitted parts fall back to the Keystone default:

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

### Step 3: Generate and verify a clean diff

```bash
# Generate the Prisma schema from the OpenSaaS config
pnpm opensaas generate

# Generate the Prisma Client
npx prisma generate

# Verify there are NO destructive changes against the live database.
# The multi-column field maps onto the existing columns, so the diff
# should be empty (or additive only):
npx prisma migrate diff \
  --from-url "$DATABASE_URL" \
  --to-schema-datamodel prisma/schema.prisma \
  --script

# For a SQLite dev loop you can simply push:
npx prisma db push
```

The generated schema emits the per-part columns with `@map` onto the live Keystone columns:

```prisma
model Teacher {
  id   String @id @default(cuid())
  name String

  avatar_url                String? @map("avatar_url")
  avatar_width              Int?    @map("avatar_width")
  avatar_height             Int?    @map("avatar_height")
  avatar_filesize           Int?    @map("avatar_filesize")
  avatar_contentType        String? @map("avatar_contentType")
  avatar_contentDisposition String? @map("avatar_contentDisposition")
  avatar_pathname           String? @map("avatar_pathname")

  resume_filename String? @map("resume_filename")
  resume_filesize Int?    @map("resume_filesize")
  resume_url      String? @map("resume_url")
}
```

### What you get

- **Reads:** Existing rows assemble into `ImageMetadata` / `FileMetadata`. Partially-populated legacy rows (e.g. only `avatar_url` set) still produce a valid object — missing scalar parts default to `0`, and an absent `contentType` defaults to `application/octet-stream`. Keystone's `contentDisposition` is preserved under `metadata.contentDisposition` so a round-trip back to columns does not lose it.
- **Writes:** New uploads split the metadata back into the same per-part columns.
- **No re-upload guarantee:** An existing metadata value (or populated columns) is authoritative and is **never** re-uploaded. Only a `File`-like input triggers a storage upload. This behaviour is locked by a test (see ADR-0006), so it cannot silently regress.

### Verification checklist (multi-column path)

- [ ] `prisma migrate diff` against the live DB shows no destructive changes
- [ ] Existing images/files display in the app without re-upload
- [ ] Partially-populated legacy rows render without errors
- [ ] A new upload writes back into the per-part columns
- [ ] No SQL migration was run and no data was rewritten

---

## Storage providers

The `storage` key on each field references a named provider in `config.storage`. Pick whichever the project already uses for its assets — **OpenSaaS Stack is not S3-only.** In multi-column mode the provider does not need to host existing assets to read them (URLs are read straight from the columns); the provider is only used for new uploads.

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

---

## Destructive alternative (opt-in): consolidate to a single JSON column

> **DESTRUCTIVE — requires a verified backup. Only choose this if you specifically want the single-`Json?` greenfield layout and have confirmed a backup.**
>
> This path **drops the Keystone per-part columns** and replaces them with a single `Json?` column. If the SQL is not run correctly before `prisma db push`, **all existing image/file data is lost.** The non-destructive multi-column path above achieves the same functional field with none of this risk and is the recommended default.

### Step A: Back up your database

**PostgreSQL:**

```bash
pg_dump -U username -d dbname -F c -b -v -f backup_$(date +%Y%m%d_%H%M%S).dump
```

**MySQL:**

```bash
mysqldump -u username -p dbname > backup_$(date +%Y%m%d_%H%M%S).sql
```

**SQLite:**

```bash
cp dev.db dev.db.backup_$(date +%Y%m%d_%H%M%S)
```

### Step B: Use the single-`Json?` default in the config

Omit the `db.columns` option so the field emits a single `Json?` column:

```typescript
import { config, list } from '@opensaas/stack-core'
import { text } from '@opensaas/stack-core/fields'
import { image, file } from '@opensaas/stack-storage/fields'
import { localStorage } from '@opensaas/stack-storage'

export default config({
  storage: {
    images: localStorage({ uploadDir: './uploads/images', serveUrl: '/api/files' }),
    files: localStorage({ uploadDir: './uploads/files', serveUrl: '/api/files' }),
  },
  lists: {
    Teacher: list({
      fields: {
        name: text({ validation: { isRequired: true } }),
        avatar: image({ storage: 'images' }), // single Json? column
        resume: file({ storage: 'files' }), // single Json? column
      },
    }),
  },
})
```

### Step C: Run the consolidation SQL BEFORE `prisma db push`

**CRITICAL:** Running `prisma db push` first will drop the Keystone columns and lose the data. Run this SQL first, substituting your real model and field names.

#### PostgreSQL

```sql
BEGIN;

-- Add the new JSON column
ALTER TABLE "Teacher" ADD COLUMN IF NOT EXISTS "avatar_new" JSONB;

-- Transform existing per-part columns into JSON
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

-- Drop old columns
ALTER TABLE "Teacher"
  DROP COLUMN IF EXISTS avatar_url,
  DROP COLUMN IF EXISTS avatar_width,
  DROP COLUMN IF EXISTS avatar_height,
  DROP COLUMN IF EXISTS avatar_filesize,
  DROP COLUMN IF EXISTS avatar_contentType,
  DROP COLUMN IF EXISTS avatar_contentDisposition,
  DROP COLUMN IF EXISTS avatar_pathname;

-- Rename the new column to the final name
ALTER TABLE "Teacher" RENAME COLUMN "avatar_new" TO "avatar";

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

#### SQLite

```sql
BEGIN TRANSACTION;

-- SQLite doesn't support DROP COLUMN cleanly, so rebuild the table.
CREATE TABLE "Teacher_new" (
  "id"        TEXT PRIMARY KEY,
  "name"      TEXT NOT NULL,
  "avatar"    TEXT,  -- SQLite stores JSON as TEXT
  "createdAt" DATETIME DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO "Teacher_new" ("id", "name", "avatar", "createdAt", "updatedAt")
SELECT
  "id",
  "name",
  CASE
    WHEN avatar_url IS NOT NULL THEN
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
      )
    ELSE NULL
  END,
  "createdAt",
  "updatedAt"
FROM "Teacher";

DROP TABLE "Teacher";
ALTER TABLE "Teacher_new" RENAME TO "Teacher";

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
npx prisma db push   # columns were already consolidated by the SQL above
npx prisma studio    # verify data
```

### Rollback Plan (destructive path)

If something goes wrong:

1. **Restore from backup:**

   ```bash
   # PostgreSQL
   pg_restore -U username -d dbname backup.dump
   # MySQL
   mysql -u username -p dbname < backup.sql
   # SQLite
   cp dev.db.backup dev.db
   ```

2. Revert the Prisma schema changes.
3. Revert the `opensaas.config.ts` changes (back to `db.columns: 'keystone'` for the non-destructive path).

### Best Practices (destructive path)

1. **Always back up before migration** — this cannot be stressed enough.
2. **Test on staging first** — never run a destructive migration directly on production.
3. **Verify data integrity** — check a sample of records manually.
4. **Prefer the non-destructive multi-column path** unless you have a concrete reason to consolidate.

---

## Summary

- **Default and recommended:** set `db: { columns: 'keystone' }` on `image()` / `file()` to map onto the existing Keystone columns in place. Clean diff, no data migration, no re-upload. Honours **Schema parity** (ADR-0006).
- **Greenfield default:** new projects use a single `Json?` column with no `db.columns` option.
- **Destructive opt-in:** consolidating the columns into JSON is still possible but drops the originals and requires a verified backup — use it only when you explicitly want the single-column layout.
- **Storage:** local, S3, and Vercel Blob are all first-class providers; the field reads existing URLs without re-uploading.
