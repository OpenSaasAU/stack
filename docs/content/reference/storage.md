# Storage Package

File and image upload field types with pluggable storage providers for OpenSaas Stack.

## Overview

The storage package provides:

- **File Upload Fields** - Generic file uploads with metadata storage
- **Image Upload Fields** - Image uploads with automatic transformations
- **Multiple Storage Backends** - Local filesystem, AWS S3, Vercel Blob, and more
- **Automatic Image Optimization** - Server-side image transformations with sharp
- **Type-Safe Metadata** - JSON-backed metadata storage in your database
- **Flexible Validation** - File size, MIME type, and extension validation

## Installation

```bash
pnpm add @opensaas/stack-storage sharp
```

For S3 storage:

```bash
pnpm add @opensaas/stack-storage-s3
```

For Vercel Blob storage:

```bash
pnpm add @opensaas/stack-storage-vercel
```

## Quick Start

### 1. Configure Storage Providers

```typescript
// opensaas.config.ts
import { config, list } from '@opensaas/stack-core'
import { localStorage } from '@opensaas/stack-storage'
import { file, image } from '@opensaas/stack-storage/fields'

export default config({
  storage: {
    documents: localStorage({
      uploadDir: './public/uploads/documents',
      serveUrl: '/uploads/documents',
    }),
  },
  lists: {
    User: list({
      fields: {
        avatar: image({
          storage: 'documents',
          transformations: {
            thumbnail: { width: 100, height: 100, fit: 'cover' },
            profile: { width: 400, height: 400, fit: 'cover' },
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

### 2. Create Upload API Route

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

    const fileData = await parseFileFromFormData(formData, 'file')
    if (!fileData) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    if (fieldType === 'image') {
      const metadata = await uploadImage(config, storageProvider, fileData, {
        validation: {
          maxFileSize: 5 * 1024 * 1024,
          acceptedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
        },
        transformations: {
          thumbnail: { width: 100, height: 100, fit: 'cover' },
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

### 3. Use in Admin UI

File and image fields work automatically in the admin UI. The fields appear in forms with drag-and-drop upload interfaces.

## Field Types

### File Field

Generic file uploads that store metadata as JSON:

```typescript
import { file } from '@opensaas/stack-storage/fields'

fields: {
  resume: file({
    storage: 'documents',
    validation: {
      maxFileSize: 10 * 1024 * 1024, // 10MB
      acceptedMimeTypes: ['application/pdf'],
      acceptedExtensions: ['.pdf'],
    },
  }),
}
```

### Image Field

Image uploads with automatic transformations:

```typescript
import { image } from '@opensaas/stack-storage/fields'

fields: {
  avatar: image({
    storage: 'avatars',
    transformations: {
      thumbnail: {
        width: 100,
        height: 100,
        fit: 'cover',
        format: 'webp',
        quality: 80,
      },
      large: {
        width: 1200,
        height: 1200,
        fit: 'inside',
        format: 'jpeg',
        quality: 90,
      },
    },
    validation: {
      maxFileSize: 5 * 1024 * 1024,
      acceptedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
    },
  }),
}
```

## Storage Providers

### Local Filesystem

Store files on the local filesystem:

```typescript
import { localStorage } from '@opensaas/stack-storage'

storage: {
  documents: localStorage({
    uploadDir: './public/uploads/documents',
    serveUrl: '/uploads/documents',
    generateUniqueFilenames: true, // default
  }),
}
```

**Best for:** Development, small deployments, or when files need to be served from the same server.

### AWS S3

Store files in Amazon S3 or S3-compatible services:

```typescript
import { s3Storage } from '@opensaas/stack-storage-s3'

storage: {
  avatars: s3Storage({
    bucket: 'my-bucket',
    region: 'us-east-1',
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    pathPrefix: 'avatars', // optional
    acl: 'public-read', // default: 'private'
    customDomain: 'https://cdn.example.com', // optional
  }),
}
```

**Best for:** Production deployments, scalable storage, CDN integration.

### Vercel Blob

Store files in Vercel Blob storage:

```typescript
import { vercelBlobStorage } from '@opensaas/stack-storage-vercel'

storage: {
  images: vercelBlobStorage({
    token: process.env.BLOB_READ_WRITE_TOKEN,
    pathPrefix: 'images',
    public: true, // default
    cacheControl: 'public, max-age=31536000, immutable',
  }),
}
```

**Best for:** Vercel deployments, automatic CDN distribution, simplified setup.

## Image Transformations

Automatically generate multiple image variants with different sizes and formats:

```typescript
avatar: image({
  storage: 'avatars',
  transformations: {
    thumbnail: {
      width: 100,
      height: 100,
      fit: 'cover', // crop to fill
      format: 'webp',
      quality: 80,
    },
    medium: {
      width: 400,
      height: 400,
      fit: 'cover',
      format: 'webp',
    },
    large: {
      width: 1200,
      height: 1200,
      fit: 'inside', // scale to fit within bounds
      format: 'jpeg',
      quality: 90,
    },
  },
})
```

### Fit Modes

- **`cover`** - Crop to fill dimensions (default)
- **`contain`** - Scale to fit within dimensions (letterbox)
- **`fill`** - Stretch to fill dimensions
- **`inside`** - Scale down to fit within dimensions
- **`outside`** - Scale up to cover dimensions

### Supported Formats

- `jpeg` / `jpg`
- `png`
- `webp` (recommended for web)
- `avif` (modern, best compression)
- `gif`
- `tiff`

## Validation

Control what files can be uploaded:

```typescript
file({
  storage: 'documents',
  validation: {
    maxFileSize: 10 * 1024 * 1024, // 10MB in bytes
    acceptedMimeTypes: ['application/pdf', 'application/msword'],
    acceptedExtensions: ['.pdf', '.doc', '.docx'],
  },
})
```

## Metadata Storage

Files and images store metadata as JSON in your database. The Prisma schema uses the `Json` type:

```prisma
model User {
  id     String  @id @default(cuid())
  avatar Json?   // ImageMetadata
  resume Json?   // FileMetadata
}
```

### File Metadata

```typescript
{
  filename: "1234567890-abc123.pdf",
  originalFilename: "resume.pdf",
  url: "https://bucket.s3.amazonaws.com/...",
  mimeType: "application/pdf",
  size: 245678,
  uploadedAt: "2025-10-31T12:00:00Z",
  storageProvider: "documents",
  metadata: { /* custom metadata */ }
}
```

### Image Metadata

Extends `FileMetadata` with image-specific fields:

```typescript
{
  filename: "1234567890-abc123.jpg",
  originalFilename: "avatar.jpg",
  url: "https://bucket.s3.amazonaws.com/...",
  mimeType: "image/jpeg",
  size: 123456,
  width: 1200,
  height: 800,
  uploadedAt: "2025-10-31T12:00:00Z",
  storageProvider: "avatars",
  transformations: {
    thumbnail: {
      url: "https://...",
      width: 100,
      height: 100,
      size: 5678
    },
    large: {
      url: "https://...",
      width: 1200,
      height: 1200,
      size: 98765
    }
  }
}
```

## Runtime Utilities

### Upload Helpers

```typescript
import { uploadFile, uploadImage, deleteFile, deleteImage } from '@opensaas/stack-storage/runtime'

// Upload file
const metadata = await uploadFile(
  config,
  'documents',
  { file, buffer },
  {
    validation: { maxFileSize: 10 * 1024 * 1024 },
  },
)

// Upload image with transformations
const imageMetadata = await uploadImage(
  config,
  'avatars',
  { file, buffer },
  {
    validation: { maxFileSize: 5 * 1024 * 1024 },
    transformations: {
      thumbnail: { width: 100, height: 100, fit: 'cover' },
    },
  },
)

// Delete file
await deleteFile(config, 'documents', metadata.filename)

// Delete image (includes all transformations)
await deleteImage(config, imageMetadata)
```

### Validation Utilities

```typescript
import { validateFile, formatFileSize, getMimeType } from '@opensaas/stack-storage/utils'

const validation = validateFile(
  { size: file.size, name: file.name, type: file.type },
  { maxFileSize: 10 * 1024 * 1024, acceptedMimeTypes: ['application/pdf'] },
)

if (!validation.valid) {
  console.error(validation.error)
}

// Format file sizes
formatFileSize(1024) // "1 KB"
formatFileSize(1048576) // "1 MB"

// Get MIME type from filename
getMimeType('document.pdf') // "application/pdf"
```

### Parse FormData

```typescript
import { parseFileFromFormData } from '@opensaas/stack-storage/utils'

const fileData = await parseFileFromFormData(formData, 'file')
if (fileData) {
  const { file, buffer } = fileData
  // Upload file...
}
```

## Custom Storage Providers

Implement the `StorageProvider` interface to create custom storage backends:

```typescript
import type { StorageProvider, UploadOptions, UploadResult } from '@opensaas/stack-storage'

export class CustomStorageProvider implements StorageProvider {
  async upload(
    file: Buffer | Uint8Array,
    filename: string,
    options?: UploadOptions,
  ): Promise<UploadResult> {
    // Your upload logic
    return {
      filename: 'generated-filename.jpg',
      url: 'https://your-cdn.com/file.jpg',
      size: file.length,
      contentType: options?.contentType || 'application/octet-stream',
    }
  }

  async download(filename: string): Promise<Buffer> {
    // Your download logic
  }

  async delete(filename: string): Promise<void> {
    // Your delete logic
  }

  getUrl(filename: string): string {
    return `https://your-cdn.com/${filename}`
  }

  async getSignedUrl(filename: string, expiresIn?: number): Promise<string> {
    // Optional: signed URLs for private files
  }
}
```

## Common Patterns

### Multiple Storage Providers

Use different storage providers for different file types:

```typescript
storage: {
  avatars: s3Storage({
    bucket: 'user-avatars',
    region: 'us-east-1',
    acl: 'public-read',
  }),
  documents: localStorage({
    uploadDir: './private/documents',
    serveUrl: '/api/files',
  }),
  videos: vercelBlobStorage({
    token: process.env.BLOB_TOKEN,
    pathPrefix: 'videos',
  }),
}
```

### Private Files

Serve files through an authenticated route:

```typescript
// app/api/files/[filename]/route.ts
import { createStorageProvider } from '@opensaas/stack-storage/runtime'
import config from '@/opensaas.config'

export async function GET(request: NextRequest, { params }: { params: { filename: string } }) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const provider = createStorageProvider(config, 'documents')
  const buffer = await provider.download(params.filename)

  return new NextResponse(buffer, {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${params.filename}"`,
    },
  })
}
```

### Environment-Specific Storage

Use different storage providers for development and production:

```typescript
const storage =
  process.env.NODE_ENV === 'production'
    ? {
        avatars: s3Storage({
          bucket: process.env.AWS_BUCKET,
          region: process.env.AWS_REGION,
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

## Security

- **Server-side validation** - All validation happens server-side in upload routes
- **MIME type validation** - Prevents file type spoofing
- **File size limits** - Prevents DoS attacks
- **Access control** - Implement in upload routes
- **Signed URLs** - For private S3 files (optional)

## Next Steps

- [Storage Setup Guide](/docs/guides/storage-setup) - Detailed setup instructions for all storage providers
- [Custom Fields Guide](/docs/guides/custom-fields) - Learn about creating custom field types
- [Hooks System](/docs/core-concepts/hooks) - Add custom behavior to file uploads
