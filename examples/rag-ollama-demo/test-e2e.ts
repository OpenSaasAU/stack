/**
 * CI-only proof that the pgvector dev-loop path works end to end with no
 * hand step and no live embedding server (issue #1395): register a
 * deterministic fake 'ollama' provider before ragPlugin ever calls one, then
 * exercise the acceptance path `test.ts` demonstrates against a real Ollama —
 * seed, generation, and `nearest()` ranking scoped by access control across
 * two sessions — plus a check that no vector index exists yet (#1265), so a
 * CI signal appears the day that changes.
 *
 * Run via `opensaas dev -- tsx test-e2e.ts` (see `test:e2e` below), so it
 * exercises the same generate → reconcile → engine-terminal chain the app
 * itself runs on, against whichever database `opensaas dev` reconciled: the
 * Dev database, or a real Postgres named by `DATABASE_URL`.
 */

import pg from 'pg'
import { resolveDatabaseUrl } from '@opensaas/stack-core'
import { registerEmbeddingProvider } from '@opensaas/stack-rag/providers'
import type { EmbeddingProvider } from '@opensaas/stack-rag/providers'
import { getContext } from './.opensaas/context.js'

const DIMENSIONS = 768

/** A vector along a fixed axis, padded to the column's own width with zeros. */
function axis(...head: number[]): number[] {
  return [...head, ...Array(DIMENSIONS - head.length).fill(0)]
}

/**
 * A provider whose output is a pure function of its text, along one axis —
 * the same shape `packages/rag`'s own `search-fake` provider uses — so the
 * cosine below is exact rather than approximate.
 */
const VECTORS: Record<string, number[]> = {
  red: axis(1, 0, 0),
  reddish: axis(0.8, 0.6, 0),
  blue: axis(0, 1, 0),
}

const fakeProvider: EmbeddingProvider = {
  type: 'ollama',
  model: 'e2e-fake',
  dimensions: DIMENSIONS,
  embed: async (input: string) => {
    const vector = VECTORS[input]
    if (vector === undefined) throw new Error(`the fake provider has no vector for "${input}"`)
    return vector
  },
  embedBatch: async (inputs: string[]) =>
    Promise.all(inputs.map((input) => fakeProvider.embed(input))),
}

// Overrides the factory `createEmbeddingProvider` resolves 'ollama' through,
// so ragPlugin's own generation hook never dials localhost:11434 — CI runs no
// Ollama server, and this guard proves the pgvector path, not the provider's
// HTTP client.
registerEmbeddingProvider('ollama', () => fakeProvider)

function heading(title: string): void {
  console.log(`\n${'='.repeat(78)}\n${title}\n${'='.repeat(78)}`)
}

const documents = [
  { title: 'Red', content: 'red', summary: 'red', published: true },
  { title: 'Blue', content: 'blue', summary: 'blue', published: true },
  // Unpublished, and by cosine the second-closest match to "red" — the row
  // the two-session check below expects an anonymous reader's ranking not to
  // contain even though it outranks "Blue".
  { title: 'Reddish draft', content: 'reddish', summary: 'reddish', published: false },
]

/**
 * ragPlugin embeds after the write's own transaction commits, so a row read
 * back immediately can still carry a null column. Poll rather than sleep for
 * a guessed interval.
 */
async function waitForEmbeddings(expected: number, countEmbedded: () => Promise<number>) {
  const deadline = Date.now() + 60_000
  let embedded = await countEmbedded()
  while (embedded < expected && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 250))
    embedded = await countEmbedded()
  }
  if (embedded < expected) {
    throw new Error(`Only ${embedded}/${expected} documents were embedded before the timeout.`)
  }
}

/**
 * Known limit (#1265): `@prisma/orm-extension-pgvector@8.0.0-rc.8` registers
 * no index types, so `Document.contentEmbedding`'s declared `index` never
 * reaches a `CREATE INDEX` and every search is an exact scan. Falsify that
 * claim directly against `pg_indexes` rather than asserting silence: this
 * fails loudly, not silently, the day the pack starts building one — which is
 * the CI signal #1265's own re-check has nowhere else to appear.
 */
async function assertNoVectorIndexYet(): Promise<void> {
  const { url } = resolveDatabaseUrl()
  const client = new pg.Client({ connectionString: url })
  await client.connect()
  try {
    const result = await client.query<{ indexname: string; indexdef: string }>(
      `select indexname, indexdef from pg_indexes where tablename = 'Document' and indexdef ilike '%contentEmbedding%'`,
    )
    const vectorIndexes = result.rows.filter((row) => /using (hnsw|ivfflat)/i.test(row.indexdef))
    if (vectorIndexes.length > 0) {
      throw new Error(
        `Expected no HNSW/IVFFlat index on Document.contentEmbedding yet (#1265); found: ` +
          vectorIndexes.map((row) => row.indexname).join(', '),
      )
    }
  } finally {
    await client.end()
  }
}

async function main() {
  console.log('🚀 RAG e2e guard: pgvector dev-loop path with a fake provider (issue #1395)\n')

  const anonymous = await getContext()
  const signedIn = await getContext({ userId: 'e2e-editor' })

  heading('Reseeding')
  for (const doc of await signedIn.db.Document.all()) {
    await signedIn.db.Document.delete({ where: { id: doc.id } })
  }
  for (const doc of documents) {
    const created = await signedIn.db.Document.create({ data: doc })
    if (created === null) throw new Error(`seed create was denied for "${doc.title}"`)
  }
  console.log(`✓ Seeded ${documents.length} documents`)

  heading('Embedding generation')
  await waitForEmbeddings(documents.length, async () => {
    const rows = await signedIn.db.Document.all()
    return rows.filter((row) => row.contentEmbedding !== null).length
  })
  console.log(`✓ All ${documents.length} documents embedded`)

  heading('nearest() scoped by access control, across two sessions')
  const query = await fakeProvider.embed('red')
  const asEditor = await signedIn.db.Document.nearest('contentEmbedding', query, { limit: 5 })
  const asAnonymous = await anonymous.db.Document.nearest('contentEmbedding', query, { limit: 5 })

  const editorTitles = asEditor.map((match) => match.item.title)
  const anonymousTitles = asAnonymous.map((match) => match.item.title)
  console.log(`   signed-in:  ${editorTitles.join(', ')}`)
  console.log(`   anonymous:  ${anonymousTitles.join(', ')}`)

  if (editorTitles[0] !== 'Red' || editorTitles[1] !== 'Reddish draft') {
    throw new Error(`Unexpected signed-in ranking: ${editorTitles.join(', ')}`)
  }
  if (anonymousTitles.includes('Reddish draft')) {
    throw new Error(
      'The Access Filter did not scope the ranking: an anonymous reader saw the unpublished draft.',
    )
  }
  if (anonymousTitles[0] !== 'Red') {
    throw new Error(`Unexpected anonymous ranking: ${anonymousTitles.join(', ')}`)
  }
  console.log('✓ nearest() ranks inside the access-scoped set, not around it')

  heading('Query plan (#1265)')
  await assertNoVectorIndexYet()
  console.log('✓ No HNSW/IVFFlat index yet — every search above was an exact scan')

  console.log('\n✅ RAG e2e guard passed.')
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error('❌ Error:', error)
    process.exit(1)
  })
