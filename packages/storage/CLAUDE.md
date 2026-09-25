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
- `createStorageProvider(config, providerName)` - Create provider instance (resolves the provider `type` through the registry)
- `registerStorageProvider(type, factory)` - Register a provider `type` → constructor (host opts in to optional/custom providers)
- `getStorageProviderFactory(type)` / `hasStorageProvider(type)` - Inspect the registry
- `resetStorageProviderRegistry()` - Reset to built-in defaults (mainly for tests)

### Utils (`src/utils/`)

- `validateFile(file, options)` - Validate size, and the EFFECTIVE MIME type against `acceptedMimeTypes` (refusing active content types by default; see Security)
- `resolveEffectiveMimeType(file)` - The declared type, or the type looked up from the filename when none is declared
- `extensionForMimeType(mimeType)` / `withEffectiveExtension(name, mimeType)` - Derive the stored extension from a MIME type, never from the client's own filename
- `ACTIVE_MIME_TYPES` - The set of MIME types refused unless a field's `acceptedMimeTypes` names them explicitly
- `formatFileSize(bytes)` - Human-readable file sizes
- `getMimeType(filename)` - Get MIME type from filename
- `parseFileFromFormData(formData, fieldName)` - Extract file from FormData
- `getImageDimensions(buffer)` - Get image width/height
- `detectImage(buffer)` - Sniff the real format of image bytes (`image()`'s effective type), or `null` if the bytes aren't a readable image
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
    getZodSchema: () => z.object({ filename: z.string(), url: z.string(), ... }).nullable(),
    outputType: 'import("@opensaas/stack-storage").FileMetadata | null',
    inputType: 'File | import("@opensaas/stack-storage").FileMetadata | null',
    getContractField: (fieldName) => ({
      kind: 'column',
      name: fieldName,
      type: { pack: 'pg', type: 'jsonb' },
      nullable: true,
    }),
  }
}
```

No changes to core generators - fields describe their own columns and TypeScript face.

### Storage Provider Interface

All storage backends implement `StorageProvider`:

```typescript
interface StorageProvider {
  upload(
    file: Buffer | Uint8Array,
    filename: string,
    options?: UploadOptions,
  ): Promise<UploadResult>
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
  storage?: StorageConfig // Maps names to provider configs
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

### Automatic Upload via Field Hooks

Files are uploaded automatically during form submission via `resolveInput` hooks. **No custom upload API routes are needed.**

**How it works:**

1. User selects file in UI component
2. File object stored in form state
3. Form submitted with File object
4. Field's `resolveInput` hook uploads file server-side
5. Returns FileMetadata for database storage

**What this actually provides:**

1. **No separate upload endpoint** - the field's own `resolveInput` hook uploads server-side, so there is no unauthenticated upload route to secure on its own; the list's own `create`/`update` operation access still gates the write the upload is part of
2. **Simpler code** - no custom upload routes needed

**Not guaranteed:** the upload is not atomic with the database write. The file is written to storage before the surrounding write's transaction commits — and before a later hook, validation failure, or field-level access denial aborts it — so a failed submission can still leave an orphaned file in storage. Tracked separately (issue #1632); do not rely on "the write failed" to mean "nothing was stored."

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

Components accept `File | FileMetadata | null` as values:

- New uploads: File object stored in form state
- Existing files: FileMetadata from database
- Deleted files: null

## Integration Points

### With @opensaas/stack-core

- `StorageConfig` added to `OpenSaasConfig` type
- Field builders use `BaseFieldConfig` interface
- Generators delegate to field methods (no core changes)

### With @opensaas/stack-ui

- `FileField` component with drag-and-drop
- `ImageField` component with preview
- Registered in field component registry
- No `onUpload` prop: the component stores the raw `File` in form state and the field's own `resolveInput` hook uploads it server-side on submit (see "Automatic Upload via Field Hooks")

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

### Automatic File Cleanup

Enable automatic cleanup of files when records are deleted or files are replaced:

```typescript
User: list({
  fields: {
    avatar: image({
      storage: 'avatars',
      cleanupOnDelete: true,     // Delete avatar when user deleted
      cleanupOnReplace: true,    // Delete old avatar when new one uploaded
      transformations: {
        thumbnail: { width: 100, height: 100 },
      },
    }),
  },
}),
```

### Serving Private Files

The route itself owns the two checks a storage provider does not make for you:
that `params.filename` cannot escape the upload directory (a provider's
`download` takes whatever string it is given), and that a value reflected into
a response header cannot inject one. `path.basename` closes the first —
`../../etc/passwd` and a leading `/` both collapse to a single trailing
segment — and `encodeURIComponent` closes the second.

```typescript
// app/api/files/[filename]/route.ts
import path from 'node:path'
import { createStorageProvider } from '@opensaas/stack-storage/runtime'
import config from '@/opensaas.config'

export async function GET(request: NextRequest, { params }: { params: { filename: string } }) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Reject any segment that isn't the bare filename the provider generated —
  // `basename` alone defeats a `../` traversal attempt.
  const filename = path.basename(params.filename)
  if (filename !== params.filename) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const provider = createStorageProvider(config, 'documents')
  const buffer = await provider.download(filename)

  return new NextResponse(buffer, {
    headers: {
      // `nosniff` stops the browser from re-detecting an active type off the
      // bytes if this route is ever pointed at an accepted active-content
      // upload (issue #1625's "serving guidance").
      'Content-Type': 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`,
    },
  })
}
```

Preferred over a same-origin route entirely: serve uploads from a **separate
origin** (a distinct subdomain, or S3/Vercel Blob's own URL) so an active type
a field explicitly opted into (`acceptedMimeTypes: ['text/html']`, say) cannot
execute with access to the app's own cookies or DOM even if it is ever opened
directly rather than downloaded.

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

### Storage Provider Registry

`createStorageProvider` resolves a provider `type` through a **registry** rather
than a hardcoded `switch`. `'local'` is registered as a built-in default, so it
works with no setup. Every other provider — the optional packages
(`@opensaas/stack-storage-s3`, `@opensaas/stack-storage-vercel`) and your own
custom providers — must be **registered by the host** before
`createStorageProvider` can build them.

`@opensaas/stack-storage` deliberately does **not** depend on `-s3`/`-vercel`:
wiring them into the factory directly would force the AWS/Vercel SDKs onto every
storage user. The host opts in by registering only the provider(s) it uses.

#### Registering an optional provider package

Register once at app startup (e.g. in a server-only module imported by your app
entry, the upload route, or `instrumentation.ts`):

```typescript
// lib/register-storage.ts (server-only)
import { registerStorageProvider } from '@opensaas/stack-storage/runtime'
import { S3StorageProvider, type S3StorageConfig } from '@opensaas/stack-storage-s3'

registerStorageProvider<S3StorageConfig>('s3', (config) => new S3StorageProvider(config))
```

Then reference the provider by `type` in config (via the package's config
builder, which sets `type: 's3'`):

```typescript
import { s3Storage } from '@opensaas/stack-storage-s3'

export default config({
  storage: {
    avatars: s3Storage({ bucket: 'user-avatars', region: 'us-east-1' }),
  },
  // ...
})
```

The Vercel Blob provider follows the same shape:

```typescript
import { registerStorageProvider } from '@opensaas/stack-storage/runtime'
import {
  VercelBlobStorageProvider,
  type VercelBlobStorageConfig,
} from '@opensaas/stack-storage-vercel'

registerStorageProvider<VercelBlobStorageConfig>(
  'vercel-blob',
  (config) => new VercelBlobStorageProvider(config),
)
```

#### Registering a custom provider

Implement `StorageProvider`, give it a `type` discriminator, then register it:

```typescript
// lib/cloudflare-r2-storage.ts
import type {
  StorageProvider,
  UploadOptions,
  UploadResult,
  BaseStorageConfig,
} from '@opensaas/stack-storage'

export interface CloudflareR2Config extends BaseStorageConfig {
  type: 'cloudflare-r2'
  bucket: string
  accountId: string
}

export class CloudflareR2StorageProvider implements StorageProvider {
  constructor(private config: CloudflareR2Config) {}

  async upload(
    file: Buffer | Uint8Array,
    filename: string,
    options?: UploadOptions,
  ): Promise<UploadResult> {
    // Upload to Cloudflare R2 ...
    return {
      filename,
      url: this.getUrl(filename),
      size: file.length,
      contentType: options?.contentType ?? 'application/octet-stream',
    }
  }

  async download(filename: string): Promise<Buffer> {
    // Download from R2 ...
    return Buffer.from('')
  }

  async delete(filename: string): Promise<void> {
    // Delete from R2 ...
  }

  getUrl(filename: string): string {
    return `https://r2.example.com/${this.config.bucket}/${filename}`
  }
}
```

```typescript
// lib/register-storage.ts (server-only)
import { registerStorageProvider } from '@opensaas/stack-storage/runtime'
import { CloudflareR2StorageProvider, type CloudflareR2Config } from './cloudflare-r2-storage'

registerStorageProvider<CloudflareR2Config>(
  'cloudflare-r2',
  (config) => new CloudflareR2StorageProvider(config),
)
```

```typescript
// opensaas.config.ts
export default config({
  storage: {
    media: { type: 'cloudflare-r2', bucket: 'media', accountId: process.env.CF_ACCOUNT_ID! },
  },
  // ...
})
```

If a field references a provider whose `type` has not been registered,
`createStorageProvider` throws a clear error
(`Unknown storage provider type: <type>. Register it with registerStorageProvider(...)`).
Reads are unaffected — assembling existing asset metadata only stamps the
provider **name** and never constructs a provider.

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

What this package actually enforces, and what it leaves to you (issue #1625):

- **Effective-type validation.** `acceptedMimeTypes` is checked against the
  EFFECTIVE type, never the client's raw claim alone: for `file()` that's the
  declared type (or the type looked up from the filename when none is
  declared); for `image()` it's the bytes sharp actually decodes. The stored
  extension and the content type handed to the provider both follow the
  effective type — never the client's original filename — so a mislabeled
  upload cannot be served back under its lying extension.
- **Active content refused by default.** `text/html`, `image/svg+xml`,
  `application/xhtml+xml`, `text/xml`, `application/xml` and the JavaScript
  MIME types are refused unless a field's own `acceptedMimeTypes` names the
  exact type — including a `file()`/`image()` with no `validation` config at
  all.
- **No byte-sniffing for `file()`.** It trusts the declared type once the two
  rules above hold: a false declaration then produces a correctly-typed,
  inert file rather than one served same-origin as active content. `image()`
  sniffs instead, since sharp reads the bytes anyway to get dimensions.
- **File size limits** apply when a field sets `validation.maxFileSize` —
  there is no default limit.
- **Uploads run through the list's own access control, not a separate
  "upload route".** The upload happens inside the field's `resolveInput`
  hook, so it is gated by whatever `create`/`update` operation access the
  list already declares. There is no built-in HTTP upload endpoint to secure
  on its own.
- **A file under a public `uploadDir` (e.g. `./public/uploads`) is served
  exactly like any other static asset** — anyone with the URL can read it,
  with no access control at read time. Put anything that needs read-time
  access control behind a developer-authored route (see "Serving Private
  Files") rather than a public static path, and prefer a separate origin
  for it, or at least `X-Content-Type-Options: nosniff`.
- **Signed URLs** are available where the provider supports them (S3's
  `getSignedUrl`) for private files — optional, and not the default.
- **Path traversal and header injection in a custom serving route are the
  route author's job** — see the `basename` + `encodeURIComponent` pattern
  in "Serving Private Files" above.

## Future Enhancements

Potential additions:

- Background job support for large image processing
- Video/audio field types
- CDN invalidation hooks
- Image optimization (compression, format conversion)
- Cloud provider integrations (Azure Blob, Google Cloud Storage)
- File virus scanning integration
