# Storage Package

File upload and storage integration.

## Installation

```bash
pnpm add @opensaas/stack-storage
```

## Features

- Image and file upload fields
- Multiple storage backends (S3, Vercel Blob, etc.)
- Automatic image optimization
- CDN integration

## Usage

```typescript
import { image, file } from '@opensaas/stack-storage/fields'

fields: {
  avatar: image({
    storage: 's3',
    validation: { isRequired: true },
  }),
}
```

Coming soon - currently in development.
