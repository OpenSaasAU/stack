# Doc-block checker self-test fixture

Read by `node scripts/check-doc-typescript-blocks.mjs --self-test`. Every fence
is preceded by a marker saying what the checker must report for it:

- `<!-- expect: fail -->` — reported FAIL.
- `<!-- expect: pass -->` — clean, and redeclares no shipped name.
- `<!-- expect: pass compared -->` — clean, and every shipped name it
  redeclares was compared against the package (a bail is a mismatch).
- `<!-- expect: pass not-compared -->` — clean, with at least one comparison
  reported NOT COMPARED.
- `<!-- expect: excused -->` — every compile diagnostic is excused by the
  fragment entry on the marker, and every redeclared name was compared.

A marker carries its fragment entry as `excuses="a, b"` (the diagnostics it
names) or `whole="reason"` (a whole-block fragment). Nothing here is
documentation: the bad blocks are wrong on purpose.

## A block that does not compile

<!-- expect: fail -->

```ts
const count: number = 'one'
export { count }
```

<!-- expect: pass -->

```ts
const count: number = 1
export { count }
```

## A subpath the package does not export

<!-- expect: fail -->

```ts
import { chunkText } from '@opensaas/stack-rag/does-not-exist'

export const chunks = chunkText(document)
```

<!-- expect: pass -->

```ts
import { createAuth } from '@opensaas/stack-auth/server'

export const make = createAuth
```

## A wrong-cased `context.db` key

<!-- expect: fail -->

```ts
const article = await context.db.article.where({ id: { equals: documentId } }).first()
export { article }
```

<!-- expect: pass -->

```ts
const article = await context.db.Article.where({ id: { equals: documentId } }).first()
export { article }
```

## A list nothing declares

<!-- expect: fail -->

```ts
const rows = await context.db.NoSuchList.where({ published: { equals: true } }).all()
export { rows }
```

<!-- expect: pass -->

```ts
const rows = await context.db.DocumentChunk.where({ documentId: { equals: documentId } }).all()
export { rows }
```

## A null the read surface returns, dereferenced unchecked

<!-- expect: fail -->

```ts
const article = await context.db.Article.where({ id: { equals: documentId } }).first()
export const title = article.title
```

<!-- expect: pass -->

```ts
const article = await context.db.Article.where({ id: { equals: documentId } }).first()
if (!article) throw new Error('not found, or not visible to this session')
export const title = article.title
```

## A misspelt vector column

<!-- expect: fail -->

```ts
const matches = await context.db.Article.nearest('contentEmbeddings', queryVector, { limit: 5 })
export { matches }
```

<!-- expect: pass -->

```ts
const matches = await context.db.Article.nearest('contentEmbedding', queryVector, { limit: 5 })
export { matches }
```

## `select()` keeps the transaction's `forUpdate()` and narrows the row

<!-- expect: fail -->

```ts
export const locked = await context.transaction(async (tx) => {
  const row = await tx.db.Article.select('id').forUpdate().first()
  return row ? row.title : null
})
```

<!-- expect: pass -->

```ts
export const locked = await context.transaction(async (tx) => {
  const row = await tx.db.Article.select('id').forUpdate().first()
  return row ? row.id : null
})
```

## A self-contained block that leans on the prelude for an import

<!-- expect: fail -->

```ts
import { getContext } from '@/.opensaas/context'

const context = await getContext()
export const chunks = chunkText(document, { chunkSize: 500 })
export { context }
```

<!-- expect: pass -->

```ts
import { getContext } from '@/.opensaas/context'
import { chunkText } from '@opensaas/stack-rag/runtime'

const context = await getContext()
export const chunks = chunkText(document, { chunkSize: 500 })
export { context }
```

## A fragment entry excuses only the diagnostics it names

<!-- expect: fail excuses="provider" -->

```ts
export const vector = provider.embed(document)
export const count: number = 'one'
```

<!-- expect: excused excuses="provider" -->

```ts
export const vector = provider.embed(document)
```

<!-- expect: fail excuses="TS2307 'cohere-ai'" -->

```ts
import { chunkText } from '@opensaas/stack-rag/does-not-exist'

export const chunks = chunkText(document)
```

<!-- expect: excused excuses="TS2307 'cohere-ai'" -->

```ts
import { CohereClient } from 'cohere-ai'

export const client = CohereClient
```

## Shape (a): a phantom type parameter that carries a constraint

The package's `ChunkingConfig` has no type parameter. Declaring one is a
difference on its own, and does not hide an invented member beside it.

<!-- expect: fail -->

```ts
import type { ChunkingStrategy } from '@opensaas/stack-rag'

export type ChunkingConfig<X extends string = string> = {
  strategy?: ChunkingStrategy
  maxTokens?: number
  overlap?: number
  minTokens?: number
}
```

<!-- expect: fail -->

```ts
import type { ChunkingStrategy } from '@opensaas/stack-rag'

export type ChunkingConfig<X extends string = string> = {
  strategy?: ChunkingStrategy
  maxTokens?: number
  overlap?: number
}
```

<!-- expect: pass compared -->

```ts
import type { ChunkingStrategy } from '@opensaas/stack-rag'

export type ChunkingConfig = {
  strategy?: ChunkingStrategy
  maxTokens?: number
  overlap?: number
}
```

## A constrained parameter the block does not use, within the package's arity

<!-- expect: fail -->

```ts
export type SearchResult<T extends string = string> = {
  item: unknown
  score: number
  bogus?: number
}
```

## A type-parameter default that differs from the package's

<!-- expect: fail -->

```ts
export type SearchResult<T = string> = {
  item: T
  score: number
}
```

<!-- expect: fail -->

```ts
export type SearchResult<T> = {
  item: T
  score: number
}
```

The package declares `SearchResult<T = unknown>`; a block declaring the
default instantiation, with no parameter at all, is not a difference.

<!-- expect: pass compared -->

```ts
export type SearchResult = {
  item: unknown
  score: number
}
```

## A used, constrained type parameter the probe cannot fill

<!-- expect: pass not-compared -->

```ts
import type { ListId } from '@opensaas/stack-core'

export type ListIdentityWhere<C, K extends string> = { id: ListId<C, K> }
```

## Shape (b): a `declare module` augmentation of a shipped specifier

<!-- expect: fail -->

```ts
import { chunkText } from '@opensaas/stack-rag/runtime'

declare module '@opensaas/stack-rag/runtime' {
  interface ChunkingOptions {
    minTokens?: number
  }
}

export const chunks = chunkText(document, { minTokens: 10 })
```

<!-- expect: pass -->

```ts
import { chunkText } from '@opensaas/stack-rag/runtime'

export const chunks = chunkText(document, { chunkSize: 500, chunkOverlap: 50 })
```

## Shape (c): a foreign shape re-exported under a shipped name through an import alias

<!-- expect: fail -->

```ts
import type { SearchResult as X } from '@opensaas/stack-rag'

export type { X as ChunkingConfig }
```

<!-- expect: pass compared -->

```ts
import type { ChunkingConfig as X } from '@opensaas/stack-rag'

export type { X as ChunkingConfig }
```

## Shape (d): a fragment entry, an unresolved member, and an invented sibling

<!-- expect: fail excuses="NotReal" -->

```ts
export type ChunkingConfig = {
  strategy?: NotReal
  maxTokens?: number
  overlap?: number
  minTokens?: number
}
```

<!-- expect: excused excuses="NotReal" -->

```ts
export type ChunkingConfig = {
  strategy?: NotReal
  maxTokens?: number
  overlap?: number
}
```

## A `...` elision inside a redeclared shipped name

A whole-block entry excuses the parse failure; it does not excuse the invented
member beside the elision, because the members the parser recovers are still
held against the package's.

<!-- expect: fail whole="a `...` elision inside the interface body" -->

```ts
export interface TextChunk {
  text: string
  ...
  bogus?: number
}
```

<!-- expect: excused whole="a `...` elision inside the interface body" -->

```ts
export interface TextChunk {
  text: string
  ...
  index: number
}
```

## `export { Wrong as Shipped }`

<!-- expect: fail -->

```ts
type Wrong = { item: unknown; score: string }

export { type Wrong as SearchResult }
```

<!-- expect: pass compared -->

```ts
type Right<T = unknown> = { item: T; score: number }

export type { Right as SearchResult }
```

## An unexported module-scope redeclaration of a shipped name

<!-- expect: fail -->

```ts
type SearchResult = { totallyWrong: boolean }

export const empty: SearchResult[] = []
```

<!-- expect: pass compared -->

```ts
type SearchResult<T = unknown> = { item: T; score: number }

export const empty: SearchResult[] = []
```

## A `readonly` member the package does not have

<!-- expect: fail -->

```ts
export interface TextChunk {
  readonly text: string
  start: number
  end: number
  index: number
  metadata?: Record<string, unknown>
}
```

<!-- expect: fail -->

```ts
export type TextChunk = Readonly<{
  text: string
  start: number
  end: number
  index: number
  metadata?: Record<string, unknown>
}>
```

<!-- expect: pass compared -->

```ts
export interface TextChunk {
  text: string
  start: number
  end: number
  index: number
  metadata?: Record<string, unknown>
}
```

The package's `ListReduction` declares both members `readonly`.

<!-- expect: pass compared -->

```ts
export interface ListReduction<V> {
  readonly reduction: 'relation'
  readonly reduced: V
}
```

## An `any` member where the package has something narrower

<!-- expect: fail -->

```ts
export interface TextChunk {
  text: any
  start: number
  end: number
  index: number
  metadata?: Record<string, unknown>
}
```

<!-- expect: pass compared -->

```ts
export type SearchResult<T = unknown> = {
  item: T
  score: number
}
```

## An invented member inside an optional object member

Under `strict` an optional member's type is `T | undefined`; the comparison
enters `T` all the same.

<!-- expect: fail -->

```ts
export interface TextChunk {
  text: string
  start: number
  end: number
  index: number
  metadata?: Record<string, unknown> & { bogus?: number }
}
```

The shipped `EmbeddingField<TTypeInfo extends TypeInfo = TypeInfo>` is
`BaseFieldConfig<TTypeInfo> & { … }`. Spelling its default instantiation flat is
not a difference; an invented member under its optional `db` is.

<!-- expect: fail -->

```ts
import type {
  ContractFieldDescriptor,
  FieldAccess,
  FilterSpec,
  OpenSaasConfig,
  VectorColumnDescriptor,
  VectorDistanceFunction,
} from '@opensaas/stack-core'
import type { BaseFieldConfig, TypeDescriptor, TypeInfo } from '@opensaas/stack-core/extend'
import type {
  ChunkingConfig,
  EmbeddingIndexConfig,
  ResolvedEmbeddingIndex,
} from '@opensaas/stack-rag'

export type EmbeddingField = {
  type: 'embedding'
  access?: FieldAccess<TypeInfo['item'], TypeInfo['inputs']['create'], TypeInfo['inputs']['update']>
  defaultValue?: unknown
  hooks?: BaseFieldConfig<TypeInfo>['hooks']
  virtual?: boolean
  db?: { map?: string; isNullable?: boolean; nativeType?: string; bogus?: number }
  ui?: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    component?: any
    fieldType?: string
    description?: string
    listView?: { defaultColumn?: boolean }
    valueForClientSerialization?: (args: { value: unknown }) => unknown
    [key: string]: unknown
    showVector?: boolean
    showMetadata?: boolean
  }
  getZodSchema?: BaseFieldConfig<TypeInfo>['getZodSchema']
  getFilterSpec?: (
    fieldName: string,
    listKey: string,
    config: OpenSaasConfig,
  ) => FilterSpec | undefined
  getColumnNames?: (fieldName: string) => string[]
  assembleColumns?: (fieldName: string, row: Record<string, unknown>) => unknown
  splitColumns?: (fieldName: string, value: unknown) => Record<string, unknown>
  getContractField?: (
    fieldName: string,
    listKey: string,
    config: OpenSaasConfig,
  ) => ContractFieldDescriptor
  getVectorColumn?: (fieldName: string) => VectorColumnDescriptor
  outputType?: TypeDescriptor
  inputType?: TypeDescriptor
  needs?: string[]
  sourceField?: string
  provider?: string
  dimensions?: number
  distanceFunction?: VectorDistanceFunction
  index?: EmbeddingIndexConfig
  allowManualWrites?: boolean
  chunking?: ChunkingConfig
  autoGenerate?: boolean
  getMetadataColumn?: (fieldName: string) => string
  getVectorIndex?: (fieldName: string, listKey?: string) => ResolvedEmbeddingIndex | undefined
}
```

<!-- expect: pass compared -->

```ts
import type {
  ContractFieldDescriptor,
  FieldAccess,
  FilterSpec,
  OpenSaasConfig,
  VectorColumnDescriptor,
  VectorDistanceFunction,
} from '@opensaas/stack-core'
import type { BaseFieldConfig, TypeDescriptor, TypeInfo } from '@opensaas/stack-core/extend'
import type {
  ChunkingConfig,
  EmbeddingIndexConfig,
  ResolvedEmbeddingIndex,
} from '@opensaas/stack-rag'

export type EmbeddingField = {
  type: 'embedding'
  access?: FieldAccess<TypeInfo['item'], TypeInfo['inputs']['create'], TypeInfo['inputs']['update']>
  defaultValue?: unknown
  hooks?: BaseFieldConfig<TypeInfo>['hooks']
  virtual?: boolean
  db?: { map?: string; isNullable?: boolean; nativeType?: string }
  ui?: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    component?: any
    fieldType?: string
    description?: string
    listView?: { defaultColumn?: boolean }
    valueForClientSerialization?: (args: { value: unknown }) => unknown
    [key: string]: unknown
    showVector?: boolean
    showMetadata?: boolean
  }
  getZodSchema?: BaseFieldConfig<TypeInfo>['getZodSchema']
  getFilterSpec?: (
    fieldName: string,
    listKey: string,
    config: OpenSaasConfig,
  ) => FilterSpec | undefined
  getColumnNames?: (fieldName: string) => string[]
  assembleColumns?: (fieldName: string, row: Record<string, unknown>) => unknown
  splitColumns?: (fieldName: string, value: unknown) => Record<string, unknown>
  getContractField?: (
    fieldName: string,
    listKey: string,
    config: OpenSaasConfig,
  ) => ContractFieldDescriptor
  getVectorColumn?: (fieldName: string) => VectorColumnDescriptor
  outputType?: TypeDescriptor
  inputType?: TypeDescriptor
  needs?: string[]
  sourceField?: string
  provider?: string
  dimensions?: number
  distanceFunction?: VectorDistanceFunction
  index?: EmbeddingIndexConfig
  allowManualWrites?: boolean
  chunking?: ChunkingConfig
  autoGenerate?: boolean
  getMetadataColumn?: (fieldName: string) => string
  getVectorIndex?: (fieldName: string, listKey?: string) => ResolvedEmbeddingIndex | undefined
}
```

## An optional member the package does not have, hidden behind an intersection

The shipped `ChunkingOptions` is one flat interface. Spelling it as an
intersection is not a difference; an invented member inside one operand is.

<!-- expect: fail -->

```ts
import type { ChunkingStrategy } from '@opensaas/stack-rag/runtime'

export type ChunkingOptions = { chunkSize?: number; chunkOverlap?: number } & {
  strategy?: ChunkingStrategy
  separators?: string[]
  tokenLimit?: number
  minTokens?: number
}
```

<!-- expect: pass compared -->

```ts
import type { ChunkingStrategy } from '@opensaas/stack-rag/runtime'

export type ChunkingOptions = { chunkSize?: number; chunkOverlap?: number } & {
  strategy?: ChunkingStrategy
  separators?: string[]
  tokenLimit?: number
}
```

## A name two specifiers export as different types

`ChunkingStrategy` is one union from `@opensaas/stack-rag` and another from
`@opensaas/stack-rag/runtime`. A block is compared against the specifier it
imports from, or against both when it imports from neither.

<!-- expect: fail -->

```ts
export type ChunkingStrategy = 'recursive' | 'bogus'
```

<!-- expect: fail -->

```ts
import { chunkText } from '@opensaas/stack-rag/runtime'

export type ChunkingStrategy = 'none' | 'recursive' | 'sentence' | 'sliding-window'
export const chunks = chunkText(document)
```

<!-- expect: pass compared -->

```ts
import { chunkText } from '@opensaas/stack-rag/runtime'

export type ChunkingStrategy = 'recursive' | 'sentence' | 'sliding-window' | 'token-aware'
export const chunks = chunkText(document)
```

<!-- expect: pass compared -->

```ts
export type ChunkingStrategy = 'none' | 'recursive' | 'sentence' | 'sliding-window'
```
