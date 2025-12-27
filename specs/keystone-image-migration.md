# Keystone Image Field Migration Guide

## Overview

This guide addresses the data migration challenge when migrating from KeystoneJS to OpenSaaS Stack, specifically for image fields. Keystone stores image metadata across multiple database columns, while OpenSaaS uses a single JSON column for more efficient storage and flexibility.

## The Problem

### KeystoneJS Image Storage (Multi-Column)

Keystone creates 7 separate columns for each image field:

```prisma
model Teacher {
  id                       String   @id @default(cuid())
  name                     String
  image_url                String?
  image_width              Int?
  image_height             Int?
  image_filesize           Int?
  image_contentType        String?
  image_contentDisposition String?
  image_pathname           String?
}
```

### OpenSaaS Stack Image Storage (JSON Column)

OpenSaaS uses a single JSON column with a well-defined structure:

```prisma
model Teacher {
  id    String  @id @default(cuid())
  name  String
  image Json?
}
```

**JSON Structure:**

```typescript
interface ImageMetadata {
  filename: string // Generated filename in storage
  originalFilename: string // Original filename from upload
  url: string // Public URL to access the image
  mimeType: string // MIME type (e.g., 'image/jpeg')
  size: number // File size in bytes
  width: number // Image width in pixels
  height: number // Image height in pixels
  uploadedAt: string // ISO 8601 timestamp
  storageProvider: string // Storage provider name (e.g., 'images')
  metadata?: Record<string, unknown> // Optional provider-specific metadata
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

## Migration Impact

When running `prisma db push` or `prisma migrate`, Prisma will attempt to:

1. Drop all Keystone image columns (`image_url`, `image_width`, etc.)
2. Add a new `image` JSON column
3. **RESULT:** All existing image data is lost unless manually preserved

## Solution: Pre-Migration Data Transformation

### Step 1: Backup Your Database

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

### Step 2: Run Pre-Migration SQL Script

#### PostgreSQL

```sql
-- Pre-migration script for PostgreSQL
-- Run this BEFORE changing your Prisma schema

BEGIN;

-- Add the new JSON column
ALTER TABLE "Teacher" ADD COLUMN IF NOT EXISTS "image_new" JSONB;

-- Transform existing data to JSON format
UPDATE "Teacher"
SET "image_new" = jsonb_build_object(
  'filename', COALESCE(image_pathname, image_url),
  'originalFilename', COALESCE(image_pathname, image_url),
  'url', image_url,
  'mimeType', COALESCE(image_contentType, 'image/jpeg'),
  'size', COALESCE(image_filesize, 0),
  'width', COALESCE(image_width, 0),
  'height', COALESCE(image_height, 0),
  'uploadedAt', NOW()::text,
  'storageProvider', 'images'
)
WHERE image_url IS NOT NULL;

-- Drop old columns
ALTER TABLE "Teacher"
  DROP COLUMN IF EXISTS image_url,
  DROP COLUMN IF EXISTS image_width,
  DROP COLUMN IF EXISTS image_height,
  DROP COLUMN IF EXISTS image_filesize,
  DROP COLUMN IF EXISTS image_contentType,
  DROP COLUMN IF EXISTS image_contentDisposition,
  DROP COLUMN IF EXISTS image_pathname;

-- Rename the new column to final name
ALTER TABLE "Teacher" RENAME COLUMN "image_new" TO "image";

COMMIT;
```

#### MySQL

```sql
-- Pre-migration script for MySQL
-- Run this BEFORE changing your Prisma schema

START TRANSACTION;

-- Add the new JSON column
ALTER TABLE `Teacher` ADD COLUMN `image_new` JSON;

-- Transform existing data to JSON format
UPDATE `Teacher`
SET `image_new` = JSON_OBJECT(
  'filename', COALESCE(image_pathname, image_url),
  'originalFilename', COALESCE(image_pathname, image_url),
  'url', image_url,
  'mimeType', COALESCE(image_contentType, 'image/jpeg'),
  'size', COALESCE(image_filesize, 0),
  'width', COALESCE(image_width, 0),
  'height', COALESCE(image_height, 0),
  'uploadedAt', NOW(),
  'storageProvider', 'images'
)
WHERE image_url IS NOT NULL;

-- Drop old columns
ALTER TABLE `Teacher`
  DROP COLUMN image_url,
  DROP COLUMN image_width,
  DROP COLUMN image_height,
  DROP COLUMN image_filesize,
  DROP COLUMN image_contentType,
  DROP COLUMN image_contentDisposition,
  DROP COLUMN image_pathname;

-- Rename the new column to final name
ALTER TABLE `Teacher` CHANGE COLUMN `image_new` `image` JSON;

COMMIT;
```

#### SQLite

```sql
-- Pre-migration script for SQLite
-- Run this BEFORE changing your Prisma schema

BEGIN TRANSACTION;

-- SQLite doesn't support ALTER COLUMN, so we use a temporary table approach

-- Create new table with desired structure
CREATE TABLE "Teacher_new" (
  "id" TEXT PRIMARY KEY,
  "name" TEXT NOT NULL,
  "image" TEXT,  -- SQLite uses TEXT for JSON
  "createdAt" DATETIME DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Copy and transform data
INSERT INTO "Teacher_new" ("id", "name", "image", "createdAt", "updatedAt")
SELECT
  "id",
  "name",
  CASE
    WHEN image_url IS NOT NULL THEN
      json_object(
        'filename', COALESCE(image_pathname, image_url),
        'originalFilename', COALESCE(image_pathname, image_url),
        'url', image_url,
        'mimeType', COALESCE(image_contentType, 'image/jpeg'),
        'size', COALESCE(image_filesize, 0),
        'width', COALESCE(image_width, 0),
        'height', COALESCE(image_height, 0),
        'uploadedAt', datetime('now'),
        'storageProvider', 'images'
      )
    ELSE NULL
  END,
  "createdAt",
  "updatedAt"
FROM "Teacher";

-- Drop old table
DROP TABLE "Teacher";

-- Rename new table
ALTER TABLE "Teacher_new" RENAME TO "Teacher";

COMMIT;
```

### Step 3: Update OpenSaaS Config

After running the migration script, update your `opensaas.config.ts`:

```typescript
import { config, list } from '@opensaas/stack-core'
import { text } from '@opensaas/stack-core/fields'
import { image } from '@opensaas/stack-storage/fields'
import { localStorage } from '@opensaas/stack-storage'

export default config({
  storage: {
    images: localStorage({
      uploadDir: './uploads/images',
      serveUrl: '/api/files',
    }),
  },
  lists: {
    Teacher: list({
      fields: {
        name: text({ validation: { isRequired: true } }),
        image: image({
          storage: 'images',
          validation: {
            maxFileSize: 5 * 1024 * 1024, // 5MB
            acceptedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
          },
        }),
      },
    }),
  },
})
```

### Step 4: Generate and Verify

```bash
# Generate new Prisma schema from OpenSaaS config
pnpm opensaas generate

# Generate Prisma Client
npx prisma generate

# Verify the schema (should show no changes since we pre-migrated)
npx prisma db push --preview-only

# If preview looks good, apply
npx prisma db push

# Open Prisma Studio to verify data
npx prisma studio
```

## Automated Migration Script

For convenience, here's a Node.js script to automate the migration:

```typescript
// scripts/migrate-keystone-images.ts
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

interface KeystoneImageData {
  id: string
  image_url: string | null
  image_width: number | null
  image_height: number | null
  image_filesize: number | null
  image_contentType: string | null
  image_pathname: string | null
}

async function migrateImages() {
  console.log('Starting Keystone image migration...')

  try {
    // Get all records with image data
    const teachers = await prisma.$queryRaw<KeystoneImageData[]>`
      SELECT id, image_url, image_width, image_height,
             image_filesize, image_contentType, image_pathname
      FROM "Teacher"
      WHERE image_url IS NOT NULL
    `

    console.log(`Found ${teachers.length} teachers with images`)

    // Transform each record
    for (const teacher of teachers) {
      const imageMetadata = {
        filename: teacher.image_pathname || teacher.image_url || '',
        originalFilename: teacher.image_pathname || teacher.image_url || '',
        url: teacher.image_url || '',
        mimeType: teacher.image_contentType || 'image/jpeg',
        size: teacher.image_filesize || 0,
        width: teacher.image_width || 0,
        height: teacher.image_height || 0,
        uploadedAt: new Date().toISOString(),
        storageProvider: 'images',
      }

      // This assumes you've already added the image_new column
      await prisma.$executeRaw`
        UPDATE "Teacher"
        SET image_new = ${JSON.stringify(imageMetadata)}::jsonb
        WHERE id = ${teacher.id}
      `

      console.log(`Migrated image for teacher ${teacher.id}`)
    }

    console.log('Migration complete!')
  } catch (error) {
    console.error('Migration failed:', error)
    throw error
  } finally {
    await prisma.$disconnect()
  }
}

migrateImages()
```

Run it with:

```bash
npx tsx scripts/migrate-keystone-images.ts
```

## Verification Checklist

After migration, verify:

- [ ] All image URLs are preserved
- [ ] Image dimensions are correct
- [ ] File sizes are accurate
- [ ] MIME types are set
- [ ] No data loss (compare row counts)
- [ ] Images display correctly in the application
- [ ] New uploads work with the JSON format

## Rollback Plan

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

2. **Revert Prisma schema changes**

3. **Revert `opensaas.config.ts` changes**

## Best Practices

1. **Always backup before migration** - This cannot be stressed enough
2. **Test on staging first** - Never run migrations directly on production
3. **Verify data integrity** - Check a sample of records manually
4. **Document the migration** - Keep notes on what was done
5. **Plan for downtime** - Coordinate with your team
6. **Monitor after migration** - Watch for errors in production logs

## Troubleshooting

### Issue: JSON column not accepting data

**Solution:** Ensure you're using `JSONB` for PostgreSQL (not `JSON`). JSONB is binary format and more efficient.

### Issue: Image URLs are broken after migration

**Solution:** Check that the `url` field in the JSON matches your storage configuration. You may need to transform URLs if your storage location changed.

### Issue: Missing metadata fields

**Solution:** Use `COALESCE` to provide default values for nullable columns during transformation.

## Alternative Approach: Dual-Column Migration

If you need zero-downtime migration:

1. Add new JSON column alongside old columns
2. Update application to write to both
3. Run background job to migrate existing data
4. Switch application to read from JSON column
5. Remove old columns once verified

This approach is more complex but allows for gradual migration without downtime.

## Summary

Migrating from Keystone's multi-column image storage to OpenSaaS's JSON format requires careful planning and execution. The key steps are:

1. Backup your database
2. Run pre-migration SQL to transform data
3. Update your OpenSaaS config
4. Generate and verify the new schema
5. Test thoroughly before going live

With proper preparation, this migration can be completed safely and efficiently.
