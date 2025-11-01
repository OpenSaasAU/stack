# File Upload Demo

This example demonstrates the file and image upload capabilities of OpenSaas Stack.

## Features Demonstrated

- **Image uploads** with automatic transformations (thumbnail, profile sizes)
- **File uploads** (PDF, Word documents)
- **Multiple named storage providers** (avatars, documents)
- **Validation** (file size, MIME types)
- **Drag-and-drop** upload UI
- **Client-side preview** for images
- **Custom upload forms** with full control
- **Admin UI** integration

## Storage Configuration

This example uses local filesystem storage for simplicity. The config includes commented examples for AWS S3 and Vercel Blob.

### Local Storage (Default)

Files are stored in:
- `public/uploads/avatars/` - Profile pictures
- `public/uploads/documents/` - Document attachments

### Production Storage

For production, uncomment the S3 or Vercel Blob configuration in `opensaas.config.ts` and set environment variables:

**AWS S3:**
```env
AWS_BUCKET=your-bucket-name
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key
```

**Vercel Blob:**
```env
BLOB_READ_WRITE_TOKEN=vercel_blob_rw_...
```

## Setup

1. Install dependencies:
```bash
pnpm install
```

2. Generate Prisma schema and types:
```bash
pnpm generate
```

3. Create the database:
```bash
pnpm db:push
```

4. Start the development server:
```bash
pnpm dev
```

5. Open [http://localhost:3000](http://localhost:3000)

## Pages

### Home Page (`/`)
Introduction with links to admin and custom form demos.

### Admin Dashboard (`/admin`)
Full admin UI with file upload fields integrated into forms:
- Create/edit users with avatar uploads
- Create/edit posts with cover images and attachments

### Custom Form (`/custom-form`)
Custom implementation showing:
- How to use `FileField` and `ImageField` components
- Custom upload handlers
- Form submission with file metadata

## API Routes

### Upload Endpoint (`/api/upload`)

Handles file uploads with:
- File validation (size, MIME type)
- Storage provider selection
- Image transformation (for image uploads)

**Usage:**
```typescript
const formData = new FormData()
formData.append('file', file)
formData.append('storage', 'avatars') // or 'documents'
formData.append('fieldType', 'image') // or 'file'

const response = await fetch('/api/upload', {
  method: 'POST',
  body: formData,
})

const metadata = await response.json()
```

## Data Model

### User
- `name` - Text
- `email` - Text
- `avatar` - Image with transformations (thumbnail: 100x100, profile: 400x400)

### Post
- `title` - Text
- `content` - Text
- `coverImage` - Image with transformations (thumbnail: 300x200, large: 1200x800)
- `attachment` - File (PDF/Word)
- `author` - Relationship to User

## Image Transformations

Images are automatically transformed on upload:

**User Avatar:**
- Thumbnail: 100x100px (WebP, cover fit)
- Profile: 400x400px (WebP, cover fit)

**Post Cover Image:**
- Thumbnail: 300x200px (WebP, cover fit)
- Large: 1200x800px (JPEG quality 90, cover fit)

All transformations are stored in the database as URLs, accessible via:
```typescript
user.avatar.transformations.thumbnail.url
user.avatar.transformations.profile.url
```

## File Metadata

Files and images store metadata as JSON in the database:

**File Metadata:**
```json
{
  "filename": "1234567890-abc123.pdf",
  "originalFilename": "resume.pdf",
  "url": "/uploads/documents/1234567890-abc123.pdf",
  "mimeType": "application/pdf",
  "size": 245678,
  "uploadedAt": "2025-10-31T12:00:00Z",
  "storageProvider": "documents"
}
```

**Image Metadata:**
```json
{
  "filename": "1234567890-abc123.jpg",
  "originalFilename": "avatar.jpg",
  "url": "/uploads/avatars/1234567890-abc123.jpg",
  "mimeType": "image/jpeg",
  "size": 123456,
  "width": 1200,
  "height": 800,
  "uploadedAt": "2025-10-31T12:00:00Z",
  "storageProvider": "avatars",
  "transformations": {
    "thumbnail": {
      "url": "/uploads/avatars/1234567890-abc123-thumbnail.webp",
      "width": 100,
      "height": 100,
      "size": 5678
    },
    "profile": {
      "url": "/uploads/avatars/1234567890-abc123-profile.webp",
      "width": 400,
      "height": 400,
      "size": 23456
    }
  }
}
```

## Customization

### Adding More Storage Providers

Edit `opensaas.config.ts`:

```typescript
import { s3Storage } from '@opensaas/stack-storage-s3'

storage: {
  videos: s3Storage({
    bucket: 'my-videos',
    region: 'us-west-2',
    // ...
  }),
}
```

### Custom Transformations

Modify transformation configs in field definitions:

```typescript
avatar: image({
  storage: 'avatars',
  transformations: {
    small: { width: 50, height: 50, fit: 'cover' },
    medium: { width: 200, height: 200, fit: 'cover' },
    large: { width: 800, height: 800, fit: 'inside' },
  },
})
```

### Custom Validation

Add custom validation in the upload API route:

```typescript
// Scan for viruses
if (needsVirusCheck) {
  await scanFile(fileData.buffer)
}

// Check user quota
if (userStorageUsed > userStorageLimit) {
  throw new Error('Storage quota exceeded')
}
```

## Learn More

- [Storage Package Documentation](../../packages/storage/README.md)
- [S3 Storage Provider](../../packages/storage-s3/README.md)
- [Vercel Blob Storage Provider](../../packages/storage-vercel/README.md)
