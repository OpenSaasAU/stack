// Package exports for scripts/check-doc-typescript-blocks.mjs.
//
// A nested excerpt — `content: searchable(text(), { ... })` — has no room for an
// import statement, so the check supplies the names it uses. Every binding here
// is `typeof import(...)` of the real export, so the shipped signature still
// applies in full: a block passing a bad `chunkSize` still fails.
//
// What this file must never do is let a self-contained example get away with a
// missing import. The check compiles each block twice, with and without this
// file, and a block that has imports of its own yet still needs a name from
// here is reported as using that name without importing it.

declare const config: typeof import('@opensaas/stack-core').config
declare const list: typeof import('@opensaas/stack-core').list
declare const text: typeof import('@opensaas/stack-core/fields').text
declare const integer: typeof import('@opensaas/stack-core/fields').integer
declare const checkbox: typeof import('@opensaas/stack-core/fields').checkbox
declare const timestamp: typeof import('@opensaas/stack-core/fields').timestamp
declare const select: typeof import('@opensaas/stack-core/fields').select
declare const json: typeof import('@opensaas/stack-core/fields').json
declare const relationship: typeof import('@opensaas/stack-core/fields').relationship
declare const virtual: typeof import('@opensaas/stack-core/fields').virtual

declare const ragPlugin: typeof import('@opensaas/stack-rag').ragPlugin
declare const openaiEmbeddings: typeof import('@opensaas/stack-rag').openaiEmbeddings
declare const ollamaEmbeddings: typeof import('@opensaas/stack-rag').ollamaEmbeddings
declare const searchable: typeof import('@opensaas/stack-rag/fields').searchable
declare const embedding: typeof import('@opensaas/stack-rag/fields').embedding

declare const chunkText: typeof import('@opensaas/stack-rag/runtime').chunkText
declare const hashText: typeof import('@opensaas/stack-rag/runtime').hashText
declare const generateEmbedding: typeof import('@opensaas/stack-rag/runtime').generateEmbedding
declare const batchProcess: typeof import('@opensaas/stack-rag/runtime').batchProcess
declare const semanticSearch: typeof import('@opensaas/stack-rag/runtime').semanticSearch
declare const findSimilar: typeof import('@opensaas/stack-rag/runtime').findSimilar

declare const createEmbeddingProvider: typeof import('@opensaas/stack-rag/providers').createEmbeddingProvider
declare const registerEmbeddingProvider: typeof import('@opensaas/stack-rag/providers').registerEmbeddingProvider

type ChunkingConfig = import('@opensaas/stack-rag').ChunkingConfig
type ChunkingOptions = import('@opensaas/stack-rag/runtime').ChunkingOptions
type SearchResult = import('@opensaas/stack-rag').SearchResult
type StoredEmbedding = import('@opensaas/stack-rag').StoredEmbedding
type EmbeddingProvider = import('@opensaas/stack-rag/providers').EmbeddingProvider
type EmbeddingProviderConfig = import('@opensaas/stack-rag').EmbeddingProviderConfig
