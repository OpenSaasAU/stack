# @opensaas/stack-storage-s3

AWS S3 storage provider for OpenSaas Stack file uploads.

## Installation

```bash
pnpm add @opensaas/stack-storage @opensaas/stack-storage-s3
```

## Usage

```typescript
// opensaas.config.ts
import { config, list } from '@opensaas/stack-core'
import { s3Storage } from '@opensaas/stack-storage-s3'
import { image } from '@opensaas/stack-storage/fields'

export default config({
  storage: {
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
        avatar: image({ storage: 'avatars' }),
      },
    }),
  },
})
```

## Configuration Options

```typescript
s3Storage({
  // Required
  bucket: string                    // S3 bucket name
  region: string                    // AWS region (e.g., 'us-east-1')

  // Optional - Authentication
  accessKeyId?: string              // AWS access key (or use IAM role)
  secretAccessKey?: string          // AWS secret key (or use IAM role)

  // Optional - S3-compatible services
  endpoint?: string                 // Custom endpoint (e.g., 'https://s3.backblazeb2.com')
  forcePathStyle?: boolean          // Force path-style URLs (required for some services)

  // Optional - Storage options
  pathPrefix?: string               // Prefix for all files (e.g., 'uploads/')
  generateUniqueFilenames?: boolean // Generate unique filenames (default: true)
  acl?: string                      // ACL for uploaded files (default: 'private')

  // Optional - Public URLs
  customDomain?: string             // Custom domain for public URLs (e.g., 'https://cdn.example.com')
})
```

## Examples

### Standard AWS S3

```typescript
avatars: s3Storage({
  bucket: 'my-bucket',
  region: 'us-east-1',
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  acl: 'public-read',
})
```

### With IAM Role (No Keys)

```typescript
avatars: s3Storage({
  bucket: 'my-bucket',
  region: 'us-east-1',
  // No accessKeyId/secretAccessKey - uses IAM role
})
```

### With CloudFront CDN

```typescript
avatars: s3Storage({
  bucket: 'my-bucket',
  region: 'us-east-1',
  customDomain: 'https://d123456789.cloudfront.net',
})
```

### Backblaze B2

```typescript
files: s3Storage({
  bucket: 'my-bucket',
  region: 'us-west-000',
  endpoint: 'https://s3.us-west-000.backblazeb2.com',
  forcePathStyle: true,
  accessKeyId: process.env.B2_KEY_ID,
  secretAccessKey: process.env.B2_APPLICATION_KEY,
})
```

### MinIO (Self-Hosted)

```typescript
files: s3Storage({
  bucket: 'my-bucket',
  region: 'us-east-1',
  endpoint: 'http://localhost:9000',
  forcePathStyle: true,
  accessKeyId: 'minioadmin',
  secretAccessKey: 'minioadmin',
})
```

### DigitalOcean Spaces

```typescript
files: s3Storage({
  bucket: 'my-space',
  region: 'nyc3',
  endpoint: 'https://nyc3.digitaloceanspaces.com',
  forcePathStyle: false,
  accessKeyId: process.env.DO_SPACES_KEY,
  secretAccessKey: process.env.DO_SPACES_SECRET,
  customDomain: 'https://my-space.nyc3.cdn.digitaloceanspaces.com',
})
```

## ACL Options

- `'private'` - Only bucket owner has access (default)
- `'public-read'` - Public read access
- `'public-read-write'` - Public read/write access
- `'authenticated-read'` - Authenticated AWS users have read access

## Signed URLs

The S3 provider supports signed URLs for private files:

```typescript
import { createStorageProvider } from '@opensaas/stack-storage/runtime'

const provider = createStorageProvider(config, 'avatars')

// Get signed URL valid for 1 hour
const signedUrl = await provider.getSignedUrl('filename.jpg', 3600)
```

## Environment Variables

Recommended setup:

```env
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key
AWS_REGION=us-east-1
AWS_BUCKET=your-bucket
```

## License

MIT
