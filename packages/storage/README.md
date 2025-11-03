# @opensaas/stack-storage

File and image upload field types with pluggable storage providers for OpenSaas Stack.

## Features

- 📁 **File Upload Field** - Generic file uploads with metadata storage
- 🖼️ **Image Upload Field** - Image uploads with automatic transformations
- 🔌 **Pluggable Storage** - Multiple named storage providers (local, S3, Vercel Blob)
- 🎨 **Image Transformations** - Automatic thumbnail/variant generation with sharp
- ✅ **Validation** - File size, MIME type, and extension validation
- 📦 **JSON Storage** - Metadata stored as JSON in your database
- 🎯 **Type-Safe** - Full TypeScript support

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

## Basic Usage

### 1. Configure Storage Providers

```typescript
// opensaas.config.ts
import { config, list } from '@opensaas/stack-core'
import { localStorage } from '@opensaas/stack-storage'
import { s3Storage } from '@opensaas/stack-storage-s3'
import { file, image } from '@opensaas/stack-storage/fields'

export default config({
  storage: {
    // Local filesystem storage
    documents: localStorage({
      uploadDir: './public/uploads/documents',
      serveUrl: '/uploads/documents',
    }),

    // S3 storage for images
    avatars: s3Storage({
      bucket: 'my-avatars',
      region: 'us-east-1',
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    }),
  },

  lists: {
    User: list({
      fields: {
        // Image field with transformations
        avatar: image({
          storage: 'avatars',
          transformations: {
            thumbnail: { width: 100, height: 100, fit: 'cover' },
            profile: { width: 400, height: 400, fit: 'cover' },
          },
          validation: {
            maxFileSize: 5 * 1024 * 1024, // 5MB
            acceptedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
          },
        }),

        // File field
        resume: file({
          storage: 'documents',
          validation: {
            maxFileSize: 10 * 1024 * 1024, // 10MB
            acceptedMimeTypes: ['application/pdf'],
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

    // Parse file from FormData
    const fileData = await parseFileFromFormData(formData, 'file')
    if (!fileData) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    // Upload based on field type
    if (fieldType === 'image') {
      // Get transformations from config if needed
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

The file and image fields work automatically in the admin UI. For custom forms, provide an `onUpload` handler:

```typescript
import { FileField, ImageField } from '@opensaas/stack-ui/fields'

function CustomForm() {
  const [avatar, setAvatar] = useState<ImageMetadata | null>(null)

  const handleUpload = async (file: File) => {
    const formData = new FormData()
    formData.append('file', file)
    formData.append('storage', 'avatars')
    formData.append('fieldType', 'image')

    const response = await fetch('/api/upload', {
      method: 'POST',
      body: formData,
    })

    if (!response.ok) {
      throw new Error('Upload failed')
    }

    return await response.json()
  }

  return (
    <ImageField
      name="avatar"
      value={avatar}
      onChange={setAvatar}
      label="Avatar"
      onUpload={handleUpload}
    />
  )
}
```

## Storage Providers

### Local Filesystem

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

### AWS S3

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

### S3-Compatible Services (MinIO, Backblaze, etc.)

```typescript
storage: {
  files: s3Storage({
    bucket: 'my-bucket',
    region: 'us-east-1',
    endpoint: 'https://s3.backblazeb2.com',
    forcePathStyle: true,
    accessKeyId: process.env.B2_KEY_ID,
    secretAccessKey: process.env.B2_APPLICATION_KEY,
  }),
}
```

### Vercel Blob

```typescript
import { vercelBlobStorage } from '@opensaas/stack-storage-vercel'

storage: {
  images: vercelBlobStorage({
    token: process.env.BLOB_READ_WRITE_TOKEN,
    pathPrefix: 'images',
    public: true, // default
  }),
}
```

## Image Transformations

Generate multiple image variants automatically:

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

Available fit modes:

- `cover` - Crop to fill dimensions
- `contain` - Scale to fit within dimensions (letterbox)
- `fill` - Stretch to fill dimensions
- `inside` - Scale down to fit within dimensions
- `outside` - Scale up to cover dimensions

## Validation

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

Files and images store metadata as JSON in your database:

```typescript
// FileMetadata
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

// ImageMetadata (extends FileMetadata)
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
```

## Custom Storage Providers

Implement the `StorageProvider` interface:

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

## License

MIT
