# Doc-block checker self-test fixture

Read by `node scripts/check-doc-typescript-blocks.mjs --self-test`. Every fence
is preceded by an `<!-- expect: FAIL -->` or `<!-- expect: PASS -->` marker; a
shape that needs a fragment entry carries it on the marker as `fragment="…"`.
The self-test exits non-zero unless every FAIL block is reported FAIL and every
PASS block is clean or excused. Nothing here is documentation: the bad blocks
are wrong on purpose.

## A block that does not compile

<!-- expect: FAIL -->

```ts
const count: number = 'one'
export { count }
```

<!-- expect: PASS -->

```ts
const count: number = 1
export { count }
```

## A subpath the package does not export

<!-- expect: FAIL -->

```ts
import { chunkText } from '@opensaas/stack-rag/does-not-exist'

export const chunks = chunkText(document)
```

<!-- expect: PASS -->

```ts
import { createAuth } from '@opensaas/stack-auth/server'

export const make = createAuth
```

## A wrong-cased `context.db` key

<!-- expect: FAIL -->

```ts
const article = await context.db.article.where({ id: { equals: documentId } }).first()
export { article }
```

<!-- expect: PASS -->

```ts
const article = await context.db.Article.where({ id: { equals: documentId } }).first()
export { article }
```

## A list nothing declares

<!-- expect: FAIL -->

```ts
const rows = await context.db.NoSuchList.where({ published: { equals: true } }).all()
export { rows }
```

<!-- expect: PASS -->

```ts
const rows = await context.db.DocumentChunk.where({ documentId: { equals: documentId } }).all()
export { rows }
```

## A null the read surface returns, dereferenced unchecked

<!-- expect: FAIL -->

```ts
const article = await context.db.Article.where({ id: { equals: documentId } }).first()
export const title = article.title
```

<!-- expect: PASS -->

```ts
const article = await context.db.Article.where({ id: { equals: documentId } }).first()
if (!article) throw new Error('not found, or not visible to this session')
export const title = article.title
```

## A misspelt vector column

<!-- expect: FAIL -->

```ts
const matches = await context.db.Article.nearest('contentEmbeddings', queryVector, { limit: 5 })
export { matches }
```

<!-- expect: PASS -->

```ts
const matches = await context.db.Article.nearest('contentEmbedding', queryVector, { limit: 5 })
export { matches }
```

## A self-contained block that leans on the prelude for an import

<!-- expect: FAIL -->

```ts
import { getContext } from '@/.opensaas/context'

const context = await getContext()
export const chunks = chunkText(document, { chunkSize: 500 })
export { context }
```

<!-- expect: PASS -->

```ts
import { getContext } from '@/.opensaas/context'
import { chunkText } from '@opensaas/stack-rag/runtime'

const context = await getContext()
export const chunks = chunkText(document, { chunkSize: 500 })
export { context }
```

## Shape (a): a phantom type parameter that carries a constraint

<!-- expect: FAIL -->

```ts
import type { ChunkingStrategy } from '@opensaas/stack-rag'

export type ChunkingConfig<X extends string = string> = {
  strategy?: ChunkingStrategy
  maxTokens?: number
  overlap?: number
  minTokens?: number
}
```

<!-- expect: PASS -->

```ts
import type { ChunkingStrategy } from '@opensaas/stack-rag'

export type ChunkingConfig<X extends string = string> = {
  strategy?: ChunkingStrategy
  maxTokens?: number
  overlap?: number
}
```

## Shape (b): a `declare module` augmentation of a shipped specifier

<!-- expect: FAIL -->

```ts
import { chunkText } from '@opensaas/stack-rag/runtime'

declare module '@opensaas/stack-rag/runtime' {
  interface ChunkingOptions {
    minTokens?: number
  }
}

export const chunks = chunkText(document, { minTokens: 10 })
```

<!-- expect: PASS -->

```ts
import { chunkText } from '@opensaas/stack-rag/runtime'

export const chunks = chunkText(document, { chunkSize: 500, chunkOverlap: 50 })
```

## Shape (c): a foreign shape re-exported under a shipped name through an import alias

<!-- expect: FAIL -->

```ts
import type { SearchResult as X } from '@opensaas/stack-rag'

export type { X as ChunkingConfig }
```

<!-- expect: PASS -->

```ts
import type { ChunkingConfig as X } from '@opensaas/stack-rag'

export type { X as ChunkingConfig }
```

## Shape (d): a fragment entry, an unresolved member, and an invented sibling

<!-- expect: FAIL fragment="`NotReal` is a bare name the prose supplies." -->

```ts
export type ChunkingConfig = {
  strategy?: NotReal
  maxTokens?: number
  overlap?: number
  minTokens?: number
}
```

<!-- expect: PASS fragment="`NotReal` is a bare name the prose supplies." -->

```ts
export type ChunkingConfig = {
  strategy?: NotReal
  maxTokens?: number
  overlap?: number
}
```

## `export { Wrong as Shipped }`

<!-- expect: FAIL -->

```ts
type Wrong = { item: unknown; score: string }

export { type Wrong as SearchResult }
```

<!-- expect: PASS -->

```ts
type Right<T = unknown> = { item: T; score: number }

export type { Right as SearchResult }
```

## An unexported module-scope redeclaration of a shipped name

<!-- expect: FAIL -->

```ts
type SearchResult = { totallyWrong: boolean }

export const empty: SearchResult[] = []
```

<!-- expect: PASS -->

```ts
type SearchResult<T = unknown> = { item: T; score: number }

export const empty: SearchResult[] = []
```

## A `readonly` member the package does not have

<!-- expect: FAIL -->

```ts
export interface TextChunk {
  readonly text: string
  start: number
  end: number
  index: number
  metadata?: Record<string, unknown>
}
```

<!-- expect: PASS -->

```ts
export interface TextChunk {
  text: string
  start: number
  end: number
  index: number
  metadata?: Record<string, unknown>
}
```

## An `any` member where the package has something narrower

<!-- expect: FAIL -->

```ts
export interface TextChunk {
  text: any
  start: number
  end: number
  index: number
  metadata?: Record<string, unknown>
}
```

<!-- expect: PASS -->

```ts
export type SearchResult<T = unknown> = {
  item: T
  score: number
}
```

## An optional member the package does not have, hidden behind an intersection

The shipped `ChunkingOptions` is one flat interface. Spelling it as an
intersection is not a difference; an invented member inside one operand is.

<!-- expect: FAIL -->

```ts
import type { ChunkingStrategy } from '@opensaas/stack-rag/runtime'

export type ChunkingOptions = { chunkSize?: number; chunkOverlap?: number } & {
  strategy?: ChunkingStrategy
  separators?: string[]
  tokenLimit?: number
  minTokens?: number
}
```

<!-- expect: PASS -->

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

<!-- expect: FAIL -->

```ts
export type ChunkingStrategy = 'recursive' | 'bogus'
```

<!-- expect: FAIL -->

```ts
import { chunkText } from '@opensaas/stack-rag/runtime'

export type ChunkingStrategy = 'none' | 'recursive' | 'sentence' | 'sliding-window'
export const chunks = chunkText(document)
```

<!-- expect: PASS -->

```ts
import { chunkText } from '@opensaas/stack-rag/runtime'

export type ChunkingStrategy = 'recursive' | 'sentence' | 'sliding-window' | 'token-aware'
export const chunks = chunkText(document)
```

<!-- expect: PASS -->

```ts
export type ChunkingStrategy = 'none' | 'recursive' | 'sentence' | 'sliding-window'
```
