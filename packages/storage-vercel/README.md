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
  // Optional - Authentication (see "Authentication" below)
  token?: string                    // Static read-write token (or use BLOB_READ_WRITE_TOKEN env var)
  storeId?: string                  // Blob store id for Vercel OIDC auth (or use BLOB_STORE_ID env var)
  oidcToken?: string                // Explicit OIDC token (or use VERCEL_OIDC_TOKEN env var)

  // Optional - Storage options
  pathPrefix?: string               // Prefix for all files (e.g., 'avatars/')
  generateUniqueFilenames?: boolean // Generate unique filenames (default: true)
  public?: boolean                  // Make files publicly accessible (default: true)
  cacheControl?: string             // Cache control header (default: 'public, max-age=31536000, immutable')
})
```

## Authentication

Credentials are resolved by the `@vercel/blob` SDK on every call, in this order:

1. An explicit `token` (static read-write token)
2. Vercel OIDC: an OIDC token (`oidcToken` or `VERCEL_OIDC_TOKEN`) plus a store
   id (`storeId` or `BLOB_STORE_ID`)
3. The `BLOB_READ_WRITE_TOKEN` environment variable

If none are available, the SDK throws a descriptive error on the first storage
operation. OIDC auth requires `@vercel/blob` 2.4.1 or later.

## Setup

### Option A: Static read-write token

1. Create a Vercel Blob store in your Vercel project dashboard

2. Get your Blob token from the Vercel dashboard

3. Add to environment variables:

```env
BLOB_READ_WRITE_TOKEN=vercel_blob_rw_...
```

### Option B: Vercel OIDC (no static token)

1. Create a Vercel Blob store in your Vercel project dashboard

2. Enable OIDC federation for your Vercel project

3. Provide the blob store id — either set the environment variable:

```env
BLOB_STORE_ID=store_...
```

or pass it in config:

```typescript
avatars: vercelBlobStorage({
  storeId: process.env.BLOB_STORE_ID,
  pathPrefix: 'avatars',
})
```

On Vercel, the deployment's `VERCEL_OIDC_TOKEN` is exchanged for blob
credentials automatically — no long-lived token to manage. For local
development, `vercel env pull` provides a short-lived OIDC token.

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

### Vercel OIDC (No Static Token)

```typescript
avatars: vercelBlobStorage({
  storeId: process.env.BLOB_STORE_ID,
  pathPrefix: 'avatars',
})
```

### Private Files

```typescript
documents: vercelBlobStorage({
  pathPrefix: 'documents',
  public: false, // Files are not publicly accessible
})
```

Private blobs aren't fetchable via their plain URL — `provider.download(filename)` and `provider.getSignedUrl(filename, expiresIn)` read them through `@vercel/blob`'s authorized read path instead, so serve them through a developer-controlled route (or a signed URL) rather than linking `url`/`metadata.downloadUrl` directly. See the [storage docs](https://stack.opensaas.au/how-to/storage#private-file-access) for the serving pattern.

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

One of the following authentication setups is required:

```env
# Static token auth
BLOB_READ_WRITE_TOKEN=vercel_blob_rw_...

# OR OIDC auth (VERCEL_OIDC_TOKEN is provided by Vercel automatically)
BLOB_STORE_ID=store_...
```

## Deployment

When deploying to Vercel:

1. The `BLOB_READ_WRITE_TOKEN` (static token auth) or `VERCEL_OIDC_TOKEN` (OIDC auth) is automatically available in the Vercel environment
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
const storage =
  process.env.NODE_ENV === 'production'
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
