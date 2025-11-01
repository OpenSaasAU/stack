# @opensaas/stack-storage-vercel

Vercel Blob storage provider for OpenSaas Stack file uploads.

## Installation

```bash
pnpm add @opensaas/stack-storage @opensaas/stack-storage-vercel
```

## Usage

```typescript
// opensaas.config.ts
import { config, list } from '@opensaas/stack-core'
import { vercelBlobStorage } from '@opensaas/stack-storage-vercel'
import { image } from '@opensaas/stack-storage/fields'

export default config({
  storage: {
    avatars: vercelBlobStorage({
      token: process.env.BLOB_READ_WRITE_TOKEN,
      pathPrefix: 'avatars',
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
vercelBlobStorage({
  // Optional - Authentication
  token?: string                    // Vercel Blob token (or use BLOB_READ_WRITE_TOKEN env var)

  // Optional - Storage options
  pathPrefix?: string               // Prefix for all files (e.g., 'avatars/')
  generateUniqueFilenames?: boolean // Generate unique filenames (default: true)
  public?: boolean                  // Make files publicly accessible (default: true)
  cacheControl?: string             // Cache control header (default: 'public, max-age=31536000, immutable')
})
```

## Setup

1. Create a Vercel Blob store in your Vercel project dashboard

2. Get your Blob token from the Vercel dashboard

3. Add to environment variables:

```env
BLOB_READ_WRITE_TOKEN=vercel_blob_rw_...
```

## Examples

### Basic Configuration

```typescript
avatars: vercelBlobStorage({
  pathPrefix: 'avatars',
})
```

The token is automatically read from `BLOB_READ_WRITE_TOKEN` environment variable.

### With Explicit Token

```typescript
avatars: vercelBlobStorage({
  token: process.env.BLOB_READ_WRITE_TOKEN,
  pathPrefix: 'avatars',
  public: true,
})
```

### Private Files

```typescript
documents: vercelBlobStorage({
  pathPrefix: 'documents',
  public: false, // Files are not publicly accessible
})
```

### Custom Cache Control

```typescript
images: vercelBlobStorage({
  pathPrefix: 'images',
  cacheControl: 'public, max-age=86400', // 1 day
})
```

## Features

### Automatic CDN

Vercel Blob automatically distributes files via Vercel's global CDN for fast access worldwide.

### Download URLs

Vercel Blob provides both regular and download URLs:

```typescript
{
  url: "https://blob.vercel-storage.com/...",          // Direct URL
  metadata: {
    downloadUrl: "https://blob.vercel-storage.com/...", // Forces download
    pathname: "avatars/filename.jpg"
  }
}
```

### URL Stability

Vercel Blob URLs are stable and won't change once uploaded, making them safe to store in your database.

## Environment Variables

Required environment variable:

```env
BLOB_READ_WRITE_TOKEN=vercel_blob_rw_...
```

## Deployment

When deploying to Vercel:

1. The `BLOB_READ_WRITE_TOKEN` is automatically available in the Vercel environment
2. No additional configuration needed
3. Files are stored in Vercel's blob storage
4. Global CDN distribution is automatic

## Limits

Vercel Blob has different limits based on your plan:

- **Hobby**: 500 MB total storage
- **Pro**: Starts at 100 GB, pay-as-you-go
- **Enterprise**: Custom limits

Check [Vercel's pricing page](https://vercel.com/docs/storage/vercel-blob/usage-and-pricing) for current limits.

## Local Development

For local development, you can still use Vercel Blob:

1. Install Vercel CLI: `pnpm add -g vercel`
2. Link your project: `vercel link`
3. Pull environment variables: `vercel env pull`
4. Your `BLOB_READ_WRITE_TOKEN` will be available in `.env.local`

Alternatively, use a different storage provider for local development:

```typescript
const storage = process.env.NODE_ENV === 'production'
  ? {
      avatars: vercelBlobStorage({ pathPrefix: 'avatars' }),
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

## License

MIT
