---
'@opensaas/stack-storage-vercel': minor
---

Add Vercel OIDC authentication support to the Vercel Blob storage provider

The provider no longer requires a static read-write token. New `storeId` and `oidcToken` config options enable Vercel OIDC auth — the `@vercel/blob` SDK exchanges the deployment's `VERCEL_OIDC_TOKEN` for blob credentials automatically:

```typescript
storage: {
  uploads: vercelBlobStorage({
    storeId: process.env.BLOB_STORE_ID, // or omit and just set BLOB_STORE_ID
    pathPrefix: 'uploads',
  }),
}
```

Credential precedence (resolved by the SDK on every call): explicit `token` → OIDC token (`oidcToken` or `VERCEL_OIDC_TOKEN`) plus store id (`storeId` or `BLOB_STORE_ID`) → `BLOB_READ_WRITE_TOKEN` environment variable.

The constructor no longer throws when no static token is configured — previously this blocked OIDC-authenticated deployments before the SDK's credential resolution could run. When no credentials are available at all, the SDK now throws a descriptive error on the first storage operation instead. Requires `@vercel/blob` 2.4.1+ (dependency floor bumped from 2.3.1).
