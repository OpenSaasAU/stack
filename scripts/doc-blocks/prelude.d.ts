// Prose prelude for scripts/check-doc-typescript-blocks.mjs.
//
// A documentation block is an excerpt: it names things the surrounding prose
// established and does not re-declare them. This file supplies exactly those
// names — the ones the prose invents ("your long document", "your Sentry
// wrapper") and the module generated per-application, which no repo-wide check
// can resolve.
//
// Package exports live in prelude-exports.d.ts instead, and the check uses the
// split to tell a block's own imports apart from what the prelude handed it.
//
// No `any`, and no re-declaration of a shipped type. This file is a global
// script, not a module: a top-level import would turn the `declare module`
// below into an augmentation of a module that does not exist.

// The request-scoped context the prose established earlier on the page. A block
// declaring its own `const context` shadows this rather than colliding, because
// the check compiles each block as a module.
declare const context: import('@opensaas/stack-core').StackContext

// Sample inputs the prose names but does not construct.
declare const document: string
declare const longDocument: string
declare const veryLongDocument: string
declare const documentId: string
declare const largeArrayOfTexts: string[]
declare const queryVector: number[]
declare const oneMonthAgo: Date

// Application-side helpers the prose invents.
declare function logToSentry(message: string, fields: Record<string, unknown>): void
declare function logMetric(name: string, fields: Record<string, unknown>): void
declare function saveToCache(
  entries: ReadonlyArray<{ query: string; embedding: number[] }>,
): Promise<void>
declare function saveChunkEmbedding(
  chunk: import('@opensaas/stack-rag/runtime').TextChunk,
  embedding: import('@opensaas/stack-rag').StoredEmbedding,
): Promise<void>

// Generated per application by `pnpm generate`, so it exists in a reader's
// project and never in this repo.
declare module '@/.opensaas/context' {
  export function getContext(session?: {
    userId: string
  }): Promise<import('@opensaas/stack-core').StackContext>
}
