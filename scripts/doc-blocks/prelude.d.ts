// Prose prelude for scripts/check-doc-typescript-blocks.mjs: the names the
// listed documents' prose establishes and their blocks use without declaring —
// the request-scoped `context`, sample inputs, application-side helpers, and
// the per-application module `pnpm generate` writes.
//
// Package exports live in prelude-exports.d.ts; the split is how the check
// tells a block's own imports apart from what the prelude handed it.
//
// No `any`, and no re-declaration of a shipped type. This file is a global
// script, not a module: a top-level import would turn the `declare module`
// below into an augmentation of a module that does not exist. Every helper
// type sits inside the namespace so that no bare name a block might write
// resolves to it by accident — only `context` and `getContext` are reachable.

declare namespace DocBlocksPrelude {
  type StoredEmbedding = import('@opensaas/stack-rag').StoredEmbedding
  type Where = import('@opensaas/stack-core').Where
  type OrderBy = import('@opensaas/stack-core').OrderBy
  type NearestOptions = import('@opensaas/stack-core').NearestOptions
  type NearestMatch<TRow> = import('@opensaas/stack-core').NearestMatch<TRow>
  type Aggregations = import('@opensaas/stack-core').Aggregations
  type CountReduction = import('@opensaas/stack-core').CountReduction
  type Session = import('@opensaas/stack-core').Session

  // The lists the prose invents. A generated project derives these rows from
  // the emitted Prisma contract; here they are written by hand, carrying every
  // field a listed block reads or writes.
  type Article = {
    id: string
    title: string
    content: string
    summary: string | null
    published: boolean
    titleEmbedding: StoredEmbedding | null
    summaryEmbedding: StoredEmbedding | null
    contentEmbedding: StoredEmbedding | null
    createdAt: Date
    updatedAt: Date
  }

  type Document = {
    id: string
    title: string
    content: string
    published: boolean
    contentEmbedding: StoredEmbedding | null
    createdAt: Date
    updatedAt: Date
  }

  type DocumentChunk = {
    id: string
    documentId: string
    chunkIndex: number
    content: string
    embedding: StoredEmbedding | null
    startOffset: number
    endOffset: number
    createdAt: Date
    updatedAt: Date
  }

  type SystemFieldKey = 'id' | 'createdAt' | 'updatedAt'
  type VectorKey<TRow> = {
    [F in keyof TRow]: TRow[F] extends StoredEmbedding | null ? F : never
  }[keyof TRow] &
    string

  // The generated `SecuredList` is instantiated from the emitted contract,
  // which no prelude can spell by hand. This is the same surface with the row
  // supplied directly, mirroring `ListQuery`/`ListOps` in
  // packages/core/src/types/secured-list.ts: the composable read and its
  // terminals, `select` narrowing the row to the chosen columns plus the
  // system fields while keeping the transaction's `forUpdate()`, `nearest`
  // accepting only the full row's vector columns and returning the narrowed
  // row, and the three writes. `include`, `distinct`, `distinctOn`, `cursor`,
  // the column-typed `where`/`orderBy`, and `select`/`include` on a write are
  // not modelled — see the script's Known limits.
  type Selected<TRow, F extends keyof TRow & string> = Pick<
    TRow,
    Extract<F | SystemFieldKey, keyof TRow>
  >

  interface Query<TRow, TSelected = TRow> {
    where(predicate: Where): this
    orderBy(order: OrderBy | readonly OrderBy[]): this
    limit(count: number): this
    offset(count: number): this
    select<F extends keyof TRow & string>(...fields: F[]): Query<TRow, Selected<TRow, F>>
    all(): Promise<TSelected[]>
    first(): Promise<TSelected | null>
    nearest(
      field: VectorKey<TRow>,
      vector: readonly number[],
      options?: NearestOptions,
    ): Promise<NearestMatch<TSelected>[]>
    aggregate<S extends Record<string, CountReduction>>(
      build: (aggregations: Aggregations) => S,
    ): Promise<{ [P in keyof S]: number }>
  }

  interface TxQuery<TRow, TSelected = TRow> extends Query<TRow, TSelected> {
    select<F extends keyof TRow & string>(...fields: F[]): TxQuery<TRow, Selected<TRow, F>>
    forUpdate(): this
  }

  // What an owned relation accepts on a write. `connect` is engine-owned sugar
  // for the foreign-key assignment and is legal only on the side holding the
  // column, so the edge has two writable spellings — the relation member and
  // the foreign-key column itself, which stays writable. A nullable column also
  // takes `null` to clear the edge, which is not a `disconnect` (ADR-0050 and
  // packages/core/src/types/inputs.ts).
  type RelationInput = { connect: { id: string } } | null

  type NoRelations = Record<never, never>

  // `CreateInput` requires a member exactly where the contract shows a
  // non-nullable column with no default — `validation: { isRequired: true }`
  // is an application-layer check and leaves the column nullable, which needs
  // `db: { isNullable: false }`. No listed page sets that on any of these
  // three lists, so nothing is required on create here, and `create` is fully
  // partial for the same reason it is in a project generated from these pages.
  interface Writes<TRow, TRelations = NoRelations> {
    create(args: {
      data: Partial<Omit<TRow, SystemFieldKey>> & Partial<TRelations>
    }): Promise<TRow | null>
    update(args: {
      where: { id: string }
      data: Partial<Omit<TRow, SystemFieldKey>> & Partial<TRelations>
    }): Promise<TRow | null>
    delete(args: { where: { id: string } }): Promise<TRow | null>
  }

  interface List<TRow, TRelations = NoRelations> extends Query<TRow>, Writes<TRow, TRelations> {}
  interface TxList<TRow, TRelations = NoRelations>
    extends TxQuery<TRow>,
      Writes<TRow, TRelations> {}

  // `DocumentChunk.documentId` is the only foreign key any listed page writes,
  // so `document` is the only relation member modelled here.
  type DocumentChunkRelations = { document: RelationInput }

  interface DB {
    Article: List<Article>
    Document: List<Document>
    DocumentChunk: List<DocumentChunk, DocumentChunkRelations>
  }

  interface TxDB {
    Article: TxList<Article>
    Document: TxList<Document>
    DocumentChunk: TxList<DocumentChunk, DocumentChunkRelations>
  }

  type Context = import('@opensaas/stack-core').StackContext<
    DB,
    Session,
    Record<string, unknown>,
    TxDB
  >
}

// The request-scoped context the prose established earlier on the page. A block
// declaring its own `const context` shadows this rather than colliding, because
// the check compiles each block as a module.
declare const context: DocBlocksPrelude.Context

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
  export function getContext(session?: { userId: string }): Promise<DocBlocksPrelude.Context>
}
