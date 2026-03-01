---
name: migrate-image-fields
description: Migrate Keystone image and file fields to OpenSaaS Stack. Handles config changes and generates the database migration SQL. Invoke as a forked subagent, passing the project details.
context: fork
agent: general-purpose
---

Migrate the image and file fields described below from Keystone format to OpenSaaS Stack. This involves updating the config AND running a database migration to consolidate the multi-column Keystone format into a single JSON column.

$ARGUMENTS

## The Schema Change

**Keystone** stores images across 7 separate columns per field:

```prisma
model Teacher {
  image_url                String?
  image_width              Int?
  image_height             Int?
  image_filesize           Int?
  image_contentType        String?
  image_contentDisposition String?
  image_pathname           String?
}
```

**OpenSaaS Stack** uses a single JSON column:

```prisma
model Teacher {
  image Json?
}
```

The JSON structure:

```typescript
interface ImageMetadata {
  filename: string
  originalFilename: string
  url: string
  mimeType: string
  size: number
  width: number
  height: number
  uploadedAt: string
  storageProvider: string
}
```

## Step 1: Update the Config

Replace `image()` and `file()` fields with `json()`:

```typescript
// Before
import { image, file } from '@keystone-6/core/fields'

avatar: image({ storage: 'my_local_images' })
resume: file({ storage: 'my_local_files' })

// After
import { json } from '@opensaas/stack-core/fields'

avatar: json()
resume: json()
```

If the project uses `@opensaas/stack-storage`, the field can use the storage field type instead — but `json()` is the safe default that always works.

## Step 2: Generate the Database Migration SQL

**CRITICAL: This SQL must be run BEFORE `prisma db push`.** Running `prisma db push` first will drop all the Keystone image columns and lose the data.

Generate the appropriate SQL for each model that has image/file fields, substituting the actual model name and field name.

### PostgreSQL

```sql
BEGIN;

-- For each image field (replace "Teacher" and "image" with actual values):
ALTER TABLE "Teacher" ADD COLUMN IF NOT EXISTS "image_new" JSONB;

UPDATE "Teacher"
SET "image_new" = jsonb_build_object(
  'filename',          COALESCE(image_pathname, image_url),
  'originalFilename',  COALESCE(image_pathname, image_url),
  'url',               image_url,
  'mimeType',          COALESCE(image_contentType, 'image/jpeg'),
  'size',              COALESCE(image_filesize, 0),
  'width',             COALESCE(image_width, 0),
  'height',            COALESCE(image_height, 0),
  'uploadedAt',        NOW()::text,
  'storageProvider',   'images'
)
WHERE image_url IS NOT NULL;

ALTER TABLE "Teacher"
  DROP COLUMN IF EXISTS image_url,
  DROP COLUMN IF EXISTS image_width,
  DROP COLUMN IF EXISTS image_height,
  DROP COLUMN IF EXISTS image_filesize,
  DROP COLUMN IF EXISTS image_contentType,
  DROP COLUMN IF EXISTS image_contentDisposition,
  DROP COLUMN IF EXISTS image_pathname;

ALTER TABLE "Teacher" RENAME COLUMN "image_new" TO "image";

COMMIT;
```

### SQLite

```sql
BEGIN TRANSACTION;

-- SQLite doesn't support DROP COLUMN directly, use temp table approach
-- (Replace "Teacher", field columns, and non-image columns with actual values)

CREATE TABLE "Teacher_new" AS
SELECT
  id,
  name,
  json_object(
    'filename',         COALESCE(image_pathname, image_url),
    'originalFilename', COALESCE(image_pathname, image_url),
    'url',              image_url,
    'mimeType',         COALESCE(image_contentType, 'image/jpeg'),
    'size',             COALESCE(image_filesize, 0),
    'width',            COALESCE(image_width, 0),
    'height',           COALESCE(image_height, 0),
    'uploadedAt',       datetime('now'),
    'storageProvider',  'images'
  ) AS image
  -- add other non-image columns here
FROM "Teacher";

DROP TABLE "Teacher";
ALTER TABLE "Teacher_new" RENAME TO "Teacher";

COMMIT;
```

### MySQL

```sql
START TRANSACTION;

ALTER TABLE `Teacher` ADD COLUMN `image_new` JSON;

UPDATE `Teacher`
SET `image_new` = JSON_OBJECT(
  'filename',         COALESCE(image_pathname, image_url),
  'originalFilename', COALESCE(image_pathname, image_url),
  'url',              image_url,
  'mimeType',         COALESCE(image_contentType, 'image/jpeg'),
  'size',             COALESCE(image_filesize, 0),
  'width',            COALESCE(image_width, 0),
  'height',           COALESCE(image_height, 0),
  'uploadedAt',       NOW(),
  'storageProvider',  'images'
)
WHERE image_url IS NOT NULL;

ALTER TABLE `Teacher`
  DROP COLUMN image_url,
  DROP COLUMN image_width,
  DROP COLUMN image_height,
  DROP COLUMN image_filesize,
  DROP COLUMN image_contentType,
  DROP COLUMN image_contentDisposition,
  DROP COLUMN image_pathname;

ALTER TABLE `Teacher` CHANGE COLUMN `image_new` `image` JSON;

COMMIT;
```

## File Fields

File fields follow the same pattern. Keystone stores `file_filename`, `file_filesize`, `file_url`. Map to JSON:

```sql
-- PostgreSQL
ALTER TABLE "Model" ADD COLUMN IF NOT EXISTS "attachment_new" JSONB;
UPDATE "Model"
SET "attachment_new" = jsonb_build_object(
  'filename',         file_filename,
  'originalFilename', file_filename,
  'url',              file_url,
  'size',             COALESCE(file_filesize, 0),
  'uploadedAt',       NOW()::text,
  'storageProvider',  'files'
)
WHERE file_filename IS NOT NULL;
-- ... drop old columns, rename
```

## Steps

1. Read the config file to identify all `image()` and `file()` fields and which models they belong to
2. Update the config: replace `image()` and `file()` with `json()`, update imports
3. Write a migration SQL file (`scripts/migrate-images.sql` or similar) with the appropriate SQL for the database provider, customised for each model and field name
4. Write a clear warning to the user:
   - **Backup the database first** (`pg_dump ...` / `cp dev.db dev.db.bak` etc.)
   - **Run the SQL script BEFORE `prisma db push`**
   - The SQL script path
5. Report what was changed in the config and the SQL file location
