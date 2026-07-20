---
'@opensaas/stack-storage-vercel': minor
---

Honour `public: false` with real private-blob support. Uploads now map `public: false` to `access: 'private'` (previously ignored); `download()` reads both public and private blobs through `@vercel/blob`'s authorized `get()` path instead of a plain `fetch(url)`, and rejects with a descriptive "File not found" error for a missing blob instead of an unrelated failure; a new `getSignedUrl(filename, expiresIn?)` returns a time-limited signed URL for serving private files through developer-controlled routes.

```typescript
storage: {
  documents: vercelBlobStorage({
    token: process.env.BLOB_READ_WRITE_TOKEN,
    public: false,
  }),
}

const provider = createStorageProvider(config, 'documents')
const signedUrl = await provider.getSignedUrl('report.pdf', 3600)
```

This also bumps the `@vercel/blob` dependency from `^2.3.1` to `^2.6.1`, which adds the `issueSignedToken`/`presignUrl` APIs `getSignedUrl()` relies on.
