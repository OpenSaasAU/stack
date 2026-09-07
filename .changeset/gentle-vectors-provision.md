---
'@opensaas/stack-rag': minor
---

Search helpers take the list they search, the MCP tool embeds with the field's own provider, and the pgvector docs describe provisioning

`semanticSearch()` and `findSimilar()` no longer take a `listKey` or a
`context`. They take the list itself, off the secured `db` surface, which is
where the scoping already lives — nothing in a search path names a list by
string any more:

```typescript
const context = await getContext()

const results = await semanticSearch({
  list: context.db.Article,
  fieldName: 'contentEmbedding',
  query: 'articles about machine learning',
  provider: createEmbeddingProvider({ type: 'openai', apiKey: process.env.OPENAI_API_KEY! }),
  limit: 10,
  minScore: 0.25,
})

const similar = await findSimilar({
  list: context.db.Article,
  fieldName: 'contentEmbedding',
  itemId: 'article-123',
})
```

The generated `semantic_search_<list>` MCP tool now resolves its embedding
provider from the **searched field's** own `provider`, the way the generation
hook does, instead of always using the plugin's default. `nearest()` validates
the query vector against the column's declared dimension, so on a config whose
field named a provider of a different width the tool raised a validation error
on every call.

The same tool's `minScore` default drops from `0.5` to `0`, and its description
now states the real range. A score is read on the column's own distance
function, not a normalised 0–1: `cosine` scores the raw cosine on `[-1, 1]`,
`l2` scores `1 / (1 + distance)` on `(0, 1]`, and `inner_product` scores the dot
product, which is unbounded. The unchanged `0.5` had silently tightened from
"raw cosine at or above 0" to "at or above 0.5" when scoring moved into
`nearest()`, so an assistant calling the tool with no `minScore` got far fewer
results, or none, on a corpus that used to answer.

The README and agent guidance describe pgvector **provisioning** rather than
installation: `ragPlugin` declares the extension pack, `pnpm generate` writes
its migration and `pnpm db:update` enables it. What the deployment owns is
making the extension available and either granting the migrating role the
privilege to create it — pgvector is not trusted, so that means superuser or a
provider grant — or pre-creating it, which the migration prechecks for and
skips. The stale `ivfflat` recipe over a JSON column is gone; an index is
declared on the field.
