---
'@opensaas/stack-storage': patch
'@opensaas/stack-storage-s3': patch
'@opensaas/stack-storage-vercel': patch
'@opensaas/stack-tiptap': patch
'create-opensaas-app': patch
---

Comment cleanup only, no behavior change: removed restating/narration comments, kept TSDoc on public config options and field builders, and kept external API/behavior constraint notes (Prisma, S3, Vercel Blob, Keystone parity, Next.js SSR, Zod).
