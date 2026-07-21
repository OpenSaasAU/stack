# Storage Setup Guide

This guide walks you through setting up file and image uploads in your Stack application using various storage providers.

## Prerequisites

- An Stack project (see [Quick Start](/docs/tutorials/quick-start))
- Node.js 18+ installed
- Basic understanding of Next.js App Router

## Installation

Install the base storage package:

```bash
pnpm add @opensaas/stack-storage sharp
```

Then install the storage provider you want to use:

```bash
# For AWS S3
pnpm add @opensaas/stack-storage-s3

# For Vercel Blob
pnpm add @opensaas/stack-storage-vercel

# For local development (no additional package needed)
```

## Provider Registration

The storage runtime uses a **registry** to look up provider implementations. `'local'` is registered automatically — no extra step required. Every other provider (`'s3'`, `'vercel-blob'`, or custom) must be registered by the host with `registerStorageProvider` before the first upload, otherwise you'll see:

```
Unknown storage provider type: s3. Register it with registerStorageProvider('s3', ...)
```

Reads are unaffected — existing metadata only stores the provider name and never constructs a provider.

### Where to register

Register once in a **server-only module** that runs before any upload. For Next.js projects the recommended location is `instrumentation.ts`, which Next.js evaluates on server startup:

```typescript
// instrumentation.ts  (project root — evaluated once on server startup)
export async function register() {
  // Register your storage providers here
}
```

Import this file's side effects in your upload route if you prefer a local import, or rely on `instrumentation.ts` to ensure it always runs first. The examples below use `instrumentation.ts`.

> **Next.js version note:** `instrumentation.ts` is supported natively in Next.js 15+. For Next.js 13/14, add `experimental: { instrumentationHook: true }` to your `next.config.ts`.

> **Local storage:** `'local'` is built in and needs no registration step. Skip ahead to the [Local Storage Setup](#local-storage-setup) section.

---

## Local Storage Setup

Best for development and small deployments.

### 1. Configure Storage

```typescript
// opensaas.config.ts
import { config, list } from '@opensaas/stack-core'
import { localStorage } from '@opensaas/stack-storage'
import { image, file } from '@opensaas/stack-storage/fields'

export default config({
  storage: {
    uploads: localStorage({
      uploadDir: './public/uploads',
      serveUrl: '/uploads',
      generateUniqueFilenames: true,
    }),
  },
  lists: {
    User: list({
      fields: {
        avatar: image({
          storage: 'uploads',
          transformations: {
            thumbnail: { width: 100, height: 100, fit: 'cover' },
            medium: { width: 400, height: 400, fit: 'cover' },
          },
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

### 2. Create Upload Directory

The upload directory will be created automatically when the first file is uploaded, but you can create it manually:

```bash
mkdir -p public/uploads
```

### 3. Add to .gitignore

```gitignore
# Local uploads
/public/uploads/*
!/public/uploads/.gitkeep
```

### 4. Create Upload API Route

```typescript
// app/api/upload/route.ts
import { NextRequest, NextResponse } from 'next/server.js'
import config from '@/opensaas.config'
import { uploadFile, uploadImage, parseFileFromFormData } from '@opensaas/stack-storage/runtime'

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const storageProvider = formData.get('storage') as string
    const fieldType = formData.get('fieldType') as 'file' | 'image'

    // Parse file from FormData
    const fileData = await parseFileFromFormData(formData, 'file')
    if (!fileData) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    // Upload based on field type
    if (fieldType === 'image') {
      const transformations = JSON.parse((formData.get('transformations') as string) || '{}')
      const metadata = await uploadImage(config, storageProvider, fileData, {
        transformations,
        validation: {
          maxFileSize: 5 * 1024 * 1024,
          acceptedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
        },
      })
      return NextResponse.json(metadata)
    } else {
      const metadata = await uploadFile(config, storageProvider, fileData, {
        validation: {
          maxFileSize: 10 * 1024 * 1024,
        },
      })
      return NextResponse.json(metadata)
    }
  } catch (error) {
    console.error('Upload error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Upload failed' },
      { status: 500 },
    )
  }
}
```

### 5. Test Upload

Generate your schema and start the dev server:

```bash
pnpm generate
pnpm dev
```

Navigate to your admin UI and test uploading an avatar. Files will be stored in `public/uploads/`.

## AWS S3 Setup

Best for production deployments with scalable storage.

### 1. Create S3 Bucket

1. Go to [AWS S3 Console](https://console.aws.amazon.com/s3/)
2. Click "Create bucket"
3. Choose a unique bucket name (e.g., `my-app-uploads`)
4. Select your preferred region (e.g., `us-east-1`)
5. Configure public access:
   - For public files: Uncheck "Block all public access"
   - For private files: Keep default settings

### 2. Configure Bucket Policy (Public Files)

If you want files to be publicly accessible, add this bucket policy:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "PublicRead",
      "Effect": "Allow",
      "Principal": "*",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::my-app-uploads/*"
    }
  ]
}
```

### 3. Create IAM User

1. Go to [IAM Console](https://console.aws.amazon.com/iam/)
2. Click "Users" → "Add user"
3. Choose a username (e.g., `my-app-s3-upload`)
4. Select "Programmatic access"
5. Attach policy: `AmazonS3FullAccess` (or create a custom policy)
6. Save the Access Key ID and Secret Access Key

### 4. Environment Variables

Add to `.env.local`:

```env
AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=...
AWS_REGION=us-east-1
AWS_BUCKET=my-app-uploads
```

### 5. Configure Storage

```typescript
// opensaas.config.ts
import { config, list } from '@opensaas/stack-core'
import { s3Storage } from '@opensaas/stack-storage-s3'
import { image } from '@opensaas/stack-storage/fields'

export default config({
  storage: {
    avatars: s3Storage({
      bucket: process.env.AWS_BUCKET!,
      region: process.env.AWS_REGION!,
      accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
      acl: 'public-read', // or 'private' for private files
      pathPrefix: 'avatars/',
    }),
  },
  lists: {
    User: list({
      fields: {
        avatar: image({
          storage: 'avatars',
          transformations: {
            thumbnail: { width: 100, height: 100, fit: 'cover' },
            medium: { width: 400, height: 400, fit: 'cover' },
          },
        }),
      },
    }),
  },
})
```

### 6. Register the S3 Provider

The S3 provider must be registered before it can be used. Add this to your `instrumentation.ts`:

```typescript
// instrumentation.ts
import { registerStorageProvider } from '@opensaas/stack-storage/runtime'
import { S3StorageProvider, type S3StorageConfig } from '@opensaas/stack-storage-s3'

export async function register() {
  registerStorageProvider<S3StorageConfig>('s3', (config) => new S3StorageProvider(config))
}
```

If you don't have an `instrumentation.ts` yet, create it at your project root and ensure `experimental.instrumentationHook` is enabled in `next.config.ts` (Next.js 13/14) or simply rely on Next.js 15+'s built-in support.

### 7. Add Upload Route

Use the same upload route from the Local Storage setup (step 4 above).

### 8. CloudFront CDN (Optional)

For better performance, set up CloudFront:

1. Go to [CloudFront Console](https://console.aws.amazon.com/cloudfront/)
2. Create a new distribution
3. Set origin to your S3 bucket
4. Configure settings and create distribution
5. Update your config:

```typescript
avatars: s3Storage({
  bucket: process.env.AWS_BUCKET!,
  region: process.env.AWS_REGION!,
  accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  customDomain: 'https://d123456789.cloudfront.net',
})
```

## Vercel Blob Setup

Best for Vercel deployments with automatic CDN.

### 1. Create Vercel Blob Store

1. Go to your [Vercel Dashboard](https://vercel.com/dashboard)
2. Select your project
3. Go to "Storage" tab
4. Click "Create Database" → "Blob"
5. Choose a name for your store
6. Copy the `BLOB_READ_WRITE_TOKEN`

### 2. Environment Variables

Vercel automatically adds the token to your environment. For local development, add to `.env.local`:

```env
BLOB_READ_WRITE_TOKEN=vercel_blob_rw_...
```

### 3. Pull Environment Variables (Local Development)

```bash
# Install Vercel CLI if not already installed
pnpm add -g vercel

# Link your project
vercel link

# Pull environment variables
vercel env pull
```

### 4. Configure Storage

```typescript
// opensaas.config.ts
import { config, list } from '@opensaas/stack-core'
import { vercelBlobStorage } from '@opensaas/stack-storage-vercel'
import { image } from '@opensaas/stack-storage/fields'

export default config({
  storage: {
    uploads: vercelBlobStorage({
      token: process.env.BLOB_READ_WRITE_TOKEN,
      pathPrefix: 'uploads',
      public: true,
      cacheControl: 'public, max-age=31536000, immutable',
    }),
  },
  lists: {
    User: list({
      fields: {
        avatar: image({
          storage: 'uploads',
          transformations: {
            thumbnail: { width: 100, height: 100, fit: 'cover' },
            medium: { width: 400, height: 400, fit: 'cover' },
          },
        }),
      },
    }),
  },
})
```

#### Alternative: Vercel OIDC authentication (no static token)

If your Vercel project has OIDC federation enabled, you can skip the static
`BLOB_READ_WRITE_TOKEN` entirely. Pass the blob store id (or set the
`BLOB_STORE_ID` environment variable) and the SDK exchanges the deployment's
`VERCEL_OIDC_TOKEN` for blob credentials automatically:

```typescript
storage: {
  uploads: vercelBlobStorage({
    storeId: process.env.BLOB_STORE_ID, // or omit and just set BLOB_STORE_ID
    pathPrefix: 'uploads',
  }),
}
```

Credential precedence (resolved by the `@vercel/blob` SDK on every call): an
explicit `token` wins; otherwise OIDC (`VERCEL_OIDC_TOKEN` or `oidcToken`, plus
`storeId` or `BLOB_STORE_ID`); otherwise the `BLOB_READ_WRITE_TOKEN`
environment variable. If none are available, the SDK throws a descriptive
error on the first storage operation. Requires `@vercel/blob` 2.4.1 or later.

### 5. Register the Vercel Blob Provider

The Vercel Blob provider must be registered before it can be used. Add this to your `instrumentation.ts`:

```typescript
// instrumentation.ts
import { registerStorageProvider } from '@opensaas/stack-storage/runtime'
import {
  VercelBlobStorageProvider,
  type VercelBlobStorageConfig,
} from '@opensaas/stack-storage-vercel'

export async function register() {
  registerStorageProvider<VercelBlobStorageConfig>(
    'vercel-blob',
    (config) => new VercelBlobStorageProvider(config),
  )
}
```

### 6. Add Upload Route

Use the same upload route from the Local Storage setup.

### 7. Deploy to Vercel

```bash
vercel --prod
```

Files are automatically distributed via Vercel's global CDN.

### 8. Private Files (Optional)

Set `public: false` to upload private blobs instead. Private blobs are not fetchable via their plain URL — every read (`download()`, `getSignedUrl()`) goes through the SDK's authorized read path instead:

```typescript
storage: {
  documents: vercelBlobStorage({
    token: process.env.BLOB_READ_WRITE_TOKEN,
    pathPrefix: 'documents',
    public: false,
  }),
}
```

Serve private files through an authenticated route using the same [Private File Access](#private-file-access) pattern described below, or generate a time-limited signed URL with `getSignedUrl()` — see [Signed URLs for Private Vercel Blob Files](#signed-urls-for-private-vercel-blob-files).

## S3-Compatible Services

The S3 provider works with S3-compatible services like Backblaze B2, MinIO, and DigitalOcean Spaces.

> **Registration required:** S3-compatible services still use the `'s3'` provider type. Register it exactly as shown in the [AWS S3 Setup — step 6](#6-register-the-s3-provider) above before using any S3-compatible configuration.

### Backblaze B2

```typescript
storage: {
  files: s3Storage({
    bucket: 'my-bucket',
    region: 'us-west-000',
    endpoint: 'https://s3.us-west-000.backblazeb2.com',
    forcePathStyle: true,
    accessKeyId: process.env.B2_KEY_ID!,
    secretAccessKey: process.env.B2_APPLICATION_KEY!,
  }),
}
```

### MinIO (Self-Hosted)

```typescript
storage: {
  files: s3Storage({
    bucket: 'my-bucket',
    region: 'us-east-1',
    endpoint: 'http://localhost:9000',
    forcePathStyle: true,
    accessKeyId: 'minioadmin',
    secretAccessKey: 'minioadmin',
  }),
}
```

### DigitalOcean Spaces

```typescript
storage: {
  files: s3Storage({
    bucket: 'my-space',
    region: 'nyc3',
    endpoint: 'https://nyc3.digitaloceanspaces.com',
    forcePathStyle: false,
    accessKeyId: process.env.DO_SPACES_KEY!,
    secretAccessKey: process.env.DO_SPACES_SECRET!,
    customDomain: 'https://my-space.nyc3.cdn.digitaloceanspaces.com',
  }),
}
```

## Advanced Patterns

### Multiple Storage Providers

Use different providers for different file types. Register each non-local provider in `instrumentation.ts`:

```typescript
// instrumentation.ts
import { registerStorageProvider } from '@opensaas/stack-storage/runtime'
import { S3StorageProvider, type S3StorageConfig } from '@opensaas/stack-storage-s3'
import {
  VercelBlobStorageProvider,
  type VercelBlobStorageConfig,
} from '@opensaas/stack-storage-vercel'

export async function register() {
  registerStorageProvider<S3StorageConfig>('s3', (config) => new S3StorageProvider(config))
  registerStorageProvider<VercelBlobStorageConfig>(
    'vercel-blob',
    (config) => new VercelBlobStorageProvider(config),
  )
  // 'local' is built in — no registration needed
}
```

```typescript
export default config({
  storage: {
    // Public avatars on S3 with CloudFront
    avatars: s3Storage({
      bucket: 'public-avatars',
      region: 'us-east-1',
      acl: 'public-read',
      customDomain: 'https://cdn.example.com',
    }),

    // Private documents on local filesystem
    documents: localStorage({
      uploadDir: './private/documents',
      serveUrl: '/api/files', // Served through auth route
    }),

    // Large files on Vercel Blob
    media: vercelBlobStorage({
      pathPrefix: 'media',
      public: true,
    }),
  },
  lists: {
    User: list({
      fields: {
        avatar: image({ storage: 'avatars' }),
        resume: file({ storage: 'documents' }),
      },
    }),
    Post: list({
      fields: {
        coverImage: image({ storage: 'media' }),
      },
    }),
  },
})
```

### Environment-Specific Storage

Use local storage in development, cloud storage in production. Register only the providers you actually use in each environment:

```typescript
// instrumentation.ts
import { registerStorageProvider } from '@opensaas/stack-storage/runtime'

export async function register() {
  if (process.env.NODE_ENV === 'production') {
    const { S3StorageProvider, type S3StorageConfig } = await import('@opensaas/stack-storage-s3')
    registerStorageProvider<S3StorageConfig>('s3', (config) => new S3StorageProvider(config))
  }
  // 'local' is built in — no registration needed for development
}
```

```typescript
// opensaas.config.ts
import { config } from '@opensaas/stack-core'
import { localStorage } from '@opensaas/stack-storage'
import { s3Storage } from '@opensaas/stack-storage-s3'

const storage =
  process.env.NODE_ENV === 'production'
    ? {
        avatars: s3Storage({
          bucket: process.env.AWS_BUCKET!,
          region: process.env.AWS_REGION!,
          accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
        }),
      }
    : {
        avatars: localStorage({
          uploadDir: './public/uploads',
          serveUrl: '/uploads',
        }),
      }

export default config({
  storage,
  // ...
})
```

### Private File Access

For private files, serve them through an authenticated API route:

```typescript
// app/api/files/[filename]/route.ts
import { NextRequest, NextResponse } from 'next/server.js'
import { createStorageProvider } from '@opensaas/stack-storage/runtime'
import config from '@/opensaas.config'
import { getContext } from '@/.opensaas/context'

export async function GET(request: NextRequest, { params }: { params: { filename: string } }) {
  // Check authentication
  const context = await getContext()
  if (!context.session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Optional: Check if user has access to this file
  // e.g., verify file belongs to user or user has permission

  try {
    const provider = createStorageProvider(config, 'documents')
    const buffer = await provider.download(params.filename)

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${params.filename}"`,
      },
    })
  } catch (error) {
    console.error('Download error:', error)
    return NextResponse.json({ error: 'File not found' }, { status: 404 })
  }
}
```

Then configure private storage:

```typescript
storage: {
  documents: s3Storage({
    bucket: 'private-documents',
    region: 'us-east-1',
    acl: 'private', // Files not publicly accessible
  }),
}
```

### Signed URLs for Private S3 Files

Generate temporary signed URLs for private S3 files:

```typescript
import { createStorageProvider } from '@opensaas/stack-storage/runtime'

const provider = createStorageProvider(config, 'documents')

// Generate URL valid for 1 hour
const signedUrl = await provider.getSignedUrl('filename.pdf', 3600)

// Use in your app
return { downloadUrl: signedUrl }
```

### Signed URLs for Private Vercel Blob Files

The Vercel Blob provider supports the same `getSignedUrl()` call for private blobs. It issues a short-lived, pathname-scoped delegation via `@vercel/blob`'s signed-URL API and returns a URL that expires after `expiresIn` seconds (default `3600`):

```typescript
storage: {
  documents: vercelBlobStorage({
    token: process.env.BLOB_READ_WRITE_TOKEN,
    pathPrefix: 'documents',
    public: false,
  }),
}
```

```typescript
import { createStorageProvider } from '@opensaas/stack-storage/runtime'

const provider = createStorageProvider(config, 'documents')

// Generate URL valid for 1 hour
const signedUrl = await provider.getSignedUrl('filename.pdf', 3600)

return { downloadUrl: signedUrl }
```

### Image Transformation Presets

Define reusable transformation presets:

```typescript
// lib/image-presets.ts
export const avatarTransformations = {
  thumbnail: { width: 100, height: 100, fit: 'cover' as const, format: 'webp' as const },
  small: { width: 200, height: 200, fit: 'cover' as const, format: 'webp' as const },
  medium: { width: 400, height: 400, fit: 'cover' as const, format: 'webp' as const },
}

export const coverImageTransformations = {
  thumbnail: { width: 300, height: 200, fit: 'cover' as const, format: 'webp' as const },
  card: { width: 600, height: 400, fit: 'cover' as const, format: 'webp' as const },
  hero: { width: 1920, height: 1080, fit: 'cover' as const, format: 'jpeg' as const, quality: 90 },
}

// Use in config
import { avatarTransformations, coverImageTransformations } from './lib/image-presets'

fields: {
  avatar: image({
    storage: 'avatars',
    transformations: avatarTransformations,
  }),
  coverImage: image({
    storage: 'media',
    transformations: coverImageTransformations,
  }),
}
```

### Custom Validation

Add custom validation logic in your upload route:

```typescript
export async function POST(request: NextRequest) {
  const formData = await request.formData()
  const fileData = await parseFileFromFormData(formData, 'file')

  if (!fileData) {
    return NextResponse.json({ error: 'No file provided' }, { status: 400 })
  }

  // Custom validation
  const { file } = fileData

  // Check file extension
  if (!file.name.match(/\.(jpg|jpeg|png|webp)$/i)) {
    return NextResponse.json({ error: 'Invalid file type' }, { status: 400 })
  }

  // Check image dimensions (for images)
  if (file.type.startsWith('image/')) {
    const dimensions = await getImageDimensions(fileData.buffer)
    if (dimensions.width < 100 || dimensions.height < 100) {
      return NextResponse.json({ error: 'Image too small (min 100x100)' }, { status: 400 })
    }
  }

  // Proceed with upload
  const metadata = await uploadImage(config, 'avatars', fileData, {
    transformations: { thumbnail: { width: 100, height: 100, fit: 'cover' } },
  })

  return NextResponse.json(metadata)
}
```

### Migrating from Keystone (non-destructive multi-column mode)

If you are adopting `image()` / `file()` over an existing KeystoneJS database, you do **not** have to consolidate Keystone's per-part columns into a single JSON column. Set `db: { columns: 'keystone' }` and the field maps onto the existing columns in place — no data migration, no dropped columns, and no re-upload of existing assets:

```typescript
import { image, file } from '@opensaas/stack-storage/fields'

lists: {
  Teacher: list({
    fields: {
      // Maps onto avatar_url, avatar_width, ... in place
      avatar: image({ storage: 'images', db: { columns: 'keystone' } }),
      // Maps onto resume_filename, resume_filesize, resume_url in place
      resume: file({ storage: 'files', db: { columns: 'keystone' } }),
    },
  }),
}
```

Any storage provider works with this mode — local, S3, or **Vercel Blob** (`@opensaas/stack-storage-vercel`) — because existing URLs are read straight from the columns and the provider is only used for new uploads. See the [Keystone image & file migration guide](https://github.com/OpenSaasAU/stack/blob/main/specs/keystone-image-migration.md) for the full walkthrough, per-part `@map` overrides, and the explicitly-flagged destructive JSON-consolidation opt-in.

## Deployment Considerations

### Environment Variables

Make sure to set environment variables in your deployment platform:

**For Vercel:**

```bash
vercel env add BLOB_READ_WRITE_TOKEN
```

**For AWS/Other:**

```bash
# Add to your deployment platform
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
AWS_REGION=us-east-1
AWS_BUCKET=my-bucket
```

### Storage Limits

Be aware of storage limits:

- **Vercel Blob**: 500 MB (Hobby), 100+ GB (Pro)
- **AWS S3**: No practical limit, pay-as-you-go
- **Local**: Limited by server disk space

### Performance

- **Use CDN**: Configure CloudFront (S3) or Vercel Blob for better performance
- **Image optimization**: Always use transformations to serve appropriate sizes
- **Compression**: Use WebP or AVIF formats for better compression
- **Lazy loading**: Implement lazy loading for images in your frontend

### Security

- **Validate server-side**: Always validate files server-side, never trust client
- **Limit file sizes**: Set appropriate `maxFileSize` to prevent abuse
- **Check MIME types**: Validate MIME types to prevent malicious uploads
- **Private files**: Use `acl: 'private'` and signed URLs for sensitive files
- **Rate limiting**: Add rate limiting to upload endpoints
- **Virus scanning**: Consider integrating virus scanning for user uploads

## Troubleshooting

### "Unknown storage provider type" Error

You'll see this error on the first upload when the provider hasn't been registered:

```
Unknown storage provider type: s3. Register it with registerStorageProvider('s3', ...)
```

**Note:** Reads work fine (metadata only stamps the provider name); only writes trigger this error, so the problem may not be visible until your first upload.

**Fix:** Add a `registerStorageProvider` call in `instrumentation.ts` (or any server-only module that runs before the first upload). See the [Provider Registration](#provider-registration) section and the setup steps for your provider. `'local'` is built in and never needs registration.

### "No file provided" Error

Make sure your form sends the file as multipart/form-data:

```typescript
const formData = new FormData()
formData.append('file', file)
formData.append('storage', 'avatars')
formData.append('fieldType', 'image')

await fetch('/api/upload', {
  method: 'POST',
  body: formData,
})
```

### S3 "Access Denied" Error

1. Check your bucket policy allows public access (if needed)
2. Verify IAM user has S3 permissions
3. Check bucket and region are correct
4. Verify access keys are valid

### Images Not Transforming

1. Ensure `sharp` is installed: `pnpm add sharp`
2. Check transformation config is valid
3. Verify image format is supported
4. Check server logs for transformation errors

### Vercel Blob "Invalid Token" Error

1. Verify `BLOB_READ_WRITE_TOKEN` is set
2. Pull environment variables: `vercel env pull`
3. Check token hasn't expired
4. Verify blob store exists in Vercel dashboard

## Next Steps

- [Storage Package Reference](/docs/reference/storage) - Detailed API documentation
- [Custom Fields Guide](/docs/how-to/custom-fields) - Create custom field types
- [Hooks System](/docs/concepts/hooks) - Add custom behavior to uploads
- [Access Control](/docs/concepts/access-control) - Secure file uploads
