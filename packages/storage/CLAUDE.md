# @opensaas/stack-storage

File and image upload field types with pluggable storage providers.

## Purpose

Provides file and image upload capabilities for OpenSaas Stack with:

- Self-contained field types (`file()` and `image()`)
- Pluggable storage providers (local, S3, Vercel Blob)
- Automatic image transformations with sharp
- JSON-backed metadata storage
- Developer-controlled upload routes

## Package Structure

```
packages/storage/
├── src/
│   ├── config/           # Storage config types and builders
│   ├── fields/           # file() and image() field builders
│   ├── providers/        # LocalStorageProvider
│   ├── runtime/          # Upload/delete utilities for developers
│   └── utils/            # Image processing, validation utilities
└── package.json

packages/storage-s3/      # Separate S3 provider package
packages/storage-vercel/  # Separate Vercel Blob provider package
```

## Key Exports

### Config (`src/config/`)

- `localStorage(config)` - Creates local filesystem storage config
- Types: `StorageProvider`, `StorageConfig`, `FileMetadata`, `ImageMetadata`

### Fields (`src/fields/`)

- `file(options)` - File upload field builder
- `image(options)` - Image upload field builder with transformations

### Providers (`src/providers/`)

- `LocalStorageProvider` - Built-in filesystem storage

### Runtime (`src/runtime/`)

- `uploadFile(config, provider, data, options)` - Upload file and return metadata
- `uploadImage(config, provider, data, options)` - Upload image with transformations
- `deleteFile(config, provider, filename)` - Delete file
- `deleteImage(config, metadata)` - Delete image and all transformations
- `createStorageProvider(config, providerName)` - Create provider instance

### Utils (`src/utils/`)

- `validateFile(file, options)` - Validate file size, MIME type, extensions
- `formatFileSize(bytes)` - Human-readable file sizes
- `getMimeType(filename)` - Get MIME type from filename
- `parseFileFromFormData(formData, fieldName)` - Extract file from FormData
- `getImageDimensions(buffer)` - Get image width/height
- `transformImage(buffer, config)` - Apply single transformation
- `processImageTransformations(buffer, filename, transformations, provider, contentType)` - Process all transformations

## Architecture Patterns

### Field Self-Containment

File and image fields follow the self-contained field pattern:

```typescript
export function file(options): FileFieldConfig {
  return {
    type: 'file',
    ...options,
    getZodSchema: () => z.object({ filename: z.string(), url: z.string().url(), ... }).nullable(),
    getPrismaType: () => ({ type: 'Json', modifiers: '?' }),
    getTypeScriptType: () => ({ type: 'import("@opensaas/stack-storage").FileMetadata | null', optional: true }),
  }
}
```

No changes to core generators - fields define their own Prisma/TS types.

### Storage Provider Interface

All storage backends implement `StorageProvider`:

```typescript
interface StorageProvider {
  upload(file: Buffer | Uint8Array, filename: string, options?: UploadOptions): Promise<UploadResult>
  download(filename: string): Promise<Buffer>
  delete(filename: string): Promise<void>
  getUrl(filename: string): string
  getSignedUrl?(filename: string, expiresIn?: number): Promise<string> // Optional
}
```

### Config-Level Storage

Storage config is added to `OpenSaasConfig` (similar to auth pattern):

```typescript
export type OpenSaasConfig = {
  db: DatabaseConfig
  lists: Record<string, ListConfig>
  storage?: StorageConfig  // Maps names to provider configs
  // ...
}
```

### Named Storage Providers

Multiple storage providers can be configured:

```typescript
storage: {
  avatars: s3Storage({ bucket: 'avatars', region: 'us-east-1' }),
  documents: localStorage({ uploadDir: './uploads', serveUrl: '/api/files' }),
  videos: vercelBlobStorage({ token: process.env.BLOB_TOKEN }),
}
```

Fields reference providers by name:

```typescript
avatar: image({ storage: 'avatars' }),
resume: file({ storage: 'documents' }),
```

### JSON Metadata Storage

Files and images store metadata as JSON (leveraging existing `json` field type):

**Prisma schema:**
```prisma
model User {
  avatar Json?  // ImageMetadata
  resume Json?  // FileMetadata
}
```

**Runtime types:**
```typescript
user.avatar // ImageMetadata | null
user.resume // FileMetadata | null
```

### Developer-Controlled Upload Routes

Unlike some frameworks, OpenSaas Stack doesn't provide built-in upload routes. This gives developers:

1. **Full control** over upload logic
2. **Custom validation** per route
3. **Access control** integration
4. **Custom processing** (virus scanning, etc.)

**Pattern:**

```typescript
// app/api/upload/route.ts
export async function POST(request: NextRequest) {
  const formData = await request.formData()
  const fileData = await parseFileFromFormData(formData)

  // Custom validation/auth
  const session = await getSession()
  if (!session) return unauthorized()

  // Upload with runtime utilities
  const metadata = await uploadImage(config, 'avatars', fileData, {
    validation: { maxFileSize: 5 * 1024 * 1024 },
    transformations: { thumbnail: { width: 100, height: 100 } },
  })

  return NextResponse.json(metadata)
}
```

### Image Transformation Pipeline

1. Validate file (size, MIME type)
2. Upload original image to storage
3. For each transformation:
   - Apply transformation with sharp
   - Upload transformed image
   - Return transformation metadata
4. Return ImageMetadata with all URLs

**Transformations stored with original:**

```typescript
{
  url: "https://bucket.s3.amazonaws.com/original.jpg",
  transformations: {
    thumbnail: { url: "https://bucket.s3.amazonaws.com/original-thumbnail.jpg", width: 100, height: 100 },
    large: { url: "https://bucket.s3.amazonaws.com/original-large.jpg", width: 1200, height: 1200 }
  }
}
```

### UI Component Integration

File/image fields work in admin UI via component registry:

```typescript
// packages/ui/src/components/fields/registry.ts
export const fieldComponentRegistry = {
  file: FileField,
  image: ImageField,
  // ...
}
```

Components receive `onUpload` prop from parent forms. Forms must provide upload handler that calls developer's API route.

## Integration Points

### With @opensaas/stack-core

- `StorageConfig` added to `OpenSaasConfig` type
- Field builders use `BaseFieldConfig` interface
- Generators delegate to field methods (no core changes)

### With @opensaas/stack-ui

- `FileField` component with drag-and-drop
- `ImageField` component with preview
- Registered in field component registry
- Components require `onUpload` prop (developer implements)

### With @opensaas/stack-storage-s3

- S3StorageProvider implements `StorageProvider`
- Supports AWS S3 and S3-compatible services (MinIO, Backblaze, etc.)
- Optional signed URLs for private files

### With @opensaas/stack-storage-vercel

- VercelBlobStorageProvider implements `StorageProvider`
- Uses `@vercel/blob` package
- Optimized for Vercel deployments

## Common Patterns

### Basic Config

```typescript
import { config, list } from '@opensaas/stack-core'
import { localStorage } from '@opensaas/stack-storage'
import { file, image } from '@opensaas/stack-storage/fields'

export default config({
  storage: {
    files: localStorage({
      uploadDir: './public/uploads',
      serveUrl: '/uploads',
    }),
  },
  lists: {
    Post: list({
      fields: {
        coverImage: image({
          storage: 'files',
          transformations: {
            thumbnail: { width: 300, height: 200, fit: 'cover' },
          },
        }),
      },
    }),
  },
})
```

### Multiple Storage Providers

```typescript
storage: {
  avatars: s3Storage({
    bucket: 'user-avatars',
    region: 'us-east-1',
    acl: 'public-read',
  }),
  documents: localStorage({
    uploadDir: './private/documents',
    serveUrl: '/api/files', // Served through auth-protected route
  }),
}
```

### Upload Route with Access Control

```typescript
// app/api/upload/route.ts
import { uploadImage } from '@opensaas/stack-storage/runtime'
import { getContext } from '@/.opensaas/context'
import config from '@/opensaas.config'

export async function POST(request: NextRequest) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const formData = await request.formData()
  const fileData = await parseFileFromFormData(formData)

  if (!fileData) {
    return NextResponse.json({ error: 'No file' }, { status: 400 })
  }

  // Access control: users can only upload avatars for themselves
  const listKey = formData.get('listKey') as string
  const itemId = formData.get('itemId') as string

  if (listKey === 'User' && itemId !== session.userId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const metadata = await uploadImage(config, 'avatars', fileData, {
    validation: { maxFileSize: 5 * 1024 * 1024 },
  })

  return NextResponse.json(metadata)
}
```

### Serving Private Files

```typescript
// app/api/files/[filename]/route.ts
import { createStorageProvider } from '@opensaas/stack-storage/runtime'
import config from '@/opensaas.config'

export async function GET(
  request: NextRequest,
  { params }: { params: { filename: string } }
) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Get storage provider
  const provider = createStorageProvider(config, 'documents')

  // Download file
  const buffer = await provider.download(params.filename)

  // Return file
  return new NextResponse(buffer, {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${params.filename}"`,
    },
  })
}
```

### Image Transformations

```typescript
avatar: image({
  storage: 'avatars',
  transformations: {
    thumbnail: { width: 100, height: 100, fit: 'cover', format: 'webp', quality: 80 },
    small: { width: 200, height: 200, fit: 'cover', format: 'webp' },
    medium: { width: 400, height: 400, fit: 'cover', format: 'webp' },
    large: { width: 800, height: 800, fit: 'inside', format: 'jpeg', quality: 90 },
  },
  validation: {
    maxFileSize: 10 * 1024 * 1024,
    acceptedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
  },
})
```

### Deleting Files with Hooks

```typescript
User: list({
  fields: {
    avatar: image({ storage: 'avatars' }),
  },
  hooks: {
    afterOperation: async ({ operation, item, context }) => {
      // Delete old avatar when user is deleted
      if (operation === 'delete' && item.avatar) {
        await deleteImage(config, item.avatar)
      }
    },
  },
})
```

### Custom Storage Provider

```typescript
// lib/cloudflare-r2-storage.ts
import type { StorageProvider } from '@opensaas/stack-storage'

export class CloudflareR2StorageProvider implements StorageProvider {
  async upload(file: Buffer, filename: string, options?) {
    // Upload to Cloudflare R2
    // ...
    return { filename, url, size, contentType }
  }

  async download(filename: string) {
    // Download from R2
    // ...
  }

  async delete(filename: string) {
    // Delete from R2
    // ...
  }

  getUrl(filename: string) {
    return `https://r2.example.com/${filename}`
  }
}

// Register in runtime
import { createStorageProvider } from '@opensaas/stack-storage/runtime'

// Extend createStorageProvider to support 'cloudflare-r2' type
```

## Type Safety

All types are strongly typed:

- `FileMetadata` and `ImageMetadata` for database storage
- `StorageProvider` interface for custom providers
- Field configs fully typed with TypeScript
- Validation options typed with Zod

Avoid `any` - all internal utilities use proper types.

## Performance Considerations

- **Image transformations** happen during upload (one-time cost)
- **Sharp** is fast but CPU-intensive (consider background jobs for large images)
- **Separate provider packages** reduce bundle size (only install what you use)
- **JSON storage** is efficient for metadata (no additional tables)
- **CDN integration** via custom domains or CloudFront

## Security

- **Developer-controlled routes** allow custom auth/validation
- **MIME type validation** prevents file type spoofing
- **File size limits** prevent DoS attacks
- **Access control** enforced in upload routes
- **Signed URLs** for private S3 files (optional)
- **No direct file access** unless served through developer routes

## Future Enhancements

Potential additions:

- Background job support for large image processing
- Video/audio field types
- CDN invalidation hooks
- Image optimization (compression, format conversion)
- Cloud provider integrations (Azure Blob, Google Cloud Storage)
- File virus scanning integration
