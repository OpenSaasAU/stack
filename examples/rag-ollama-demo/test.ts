/**
 * RAG with Ollama, end to end against the running database.
 *
 * Reseeds both lists, waits for the embeddings ragPlugin generates after each
 * write commits, then ranks through `nearest()` — the engine terminal, which
 * puts the ordering and the Access Filter in one query. Re-runs from empty.
 */

import { getContext } from './.opensaas/context.js'
import { createEmbeddingProvider } from '@opensaas/stack-rag/providers'

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434'
const DIMENSIONS = Number(process.env.OLLAMA_EMBEDDING_DIMENSIONS || '768')

function heading(title: string) {
  console.log(`\n${'='.repeat(78)}\n${title}\n${'='.repeat(78)}`)
}

const documents = [
  {
    title: 'Introduction to Machine Learning',
    content:
      'Machine learning is a subset of artificial intelligence that enables computers to learn from data without being explicitly programmed. It uses algorithms to identify patterns and make predictions.',
    summary: 'Overview of ML concepts',
    published: true,
  },
  {
    title: 'Deep Learning Fundamentals',
    content:
      'Deep learning is a specialized branch of machine learning that uses neural networks with multiple layers. These networks can learn complex patterns in large amounts of data, making them ideal for tasks like image recognition and natural language processing.',
    summary: 'Introduction to deep neural networks',
    published: true,
  },
  {
    title: 'Natural Language Processing',
    content:
      'Natural Language Processing (NLP) is a field of AI focused on enabling computers to understand, interpret, and generate human language. NLP powers applications like chatbots, translation services, and sentiment analysis.',
    summary: 'Understanding NLP',
    published: true,
  },
  {
    title: 'Computer Vision Applications',
    content:
      'Computer vision is an AI technology that enables computers to derive meaningful information from images and videos. It powers facial recognition, autonomous vehicles, medical imaging analysis, and quality control in manufacturing.',
    summary: 'How computers see',
    published: true,
  },
  {
    title: 'JavaScript Basics',
    content:
      'JavaScript is a versatile programming language primarily used for web development. It runs in browsers and on servers via Node.js, enabling developers to create interactive websites and full-stack applications.',
    summary: 'Intro to JavaScript',
    published: true,
  },
  {
    // Unpublished on purpose: this is the row the two-session check below
    // expects an anonymous reader's ranking not to contain.
    title: 'Reinforcement Learning Draft',
    content:
      'Reinforcement learning trains an agent to act by rewarding the outcomes we want. The agent explores a state space, receives a scalar reward, and updates a policy that maximises the return it expects over time.',
    summary: 'Unpublished draft on RL',
    published: false,
  },
]

const articles = [
  {
    title: 'Building Scalable Web Applications',
    body: 'Learn how to architect web applications that can handle millions of users. This guide covers load balancing, caching strategies, database optimization, and microservices architecture.',
    category: 'Engineering',
    published: true,
  },
  {
    title: 'The Future of AI in Healthcare',
    body: 'Artificial intelligence is revolutionizing healthcare through improved diagnostics, personalized treatment plans, drug discovery, and predictive analytics. AI models can detect diseases earlier and more accurately than traditional methods.',
    category: 'Technology',
    published: true,
  },
  {
    title: 'Cloud Computing Best Practices',
    body: 'Moving to the cloud requires careful planning. Learn about choosing the right cloud provider, implementing security measures, cost optimization, and ensuring high availability for your applications.',
    category: 'Engineering',
    published: true,
  },
]

/**
 * ragPlugin embeds after the write's own transaction commits, so a row read
 * back immediately can still carry a null column (ADR-0045). Poll until every
 * row has one rather than sleeping for a guessed interval.
 */
async function waitForEmbeddings(
  label: string,
  expected: number,
  countEmbedded: () => Promise<number>,
) {
  const deadline = Date.now() + 120_000
  let embedded = await countEmbedded()
  while (embedded < expected && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 500))
    embedded = await countEmbedded()
  }
  console.log(`✓ ${label}: ${embedded}/${expected} embedded`)
  if (embedded < expected) {
    throw new Error(`Only ${embedded}/${expected} ${label} were embedded before the timeout.`)
  }
}

async function main() {
  console.log('🚀 RAG demo: Ollama embeddings over a native pgvector column\n')

  // Two sessions over one database. The config scopes `query` to published
  // rows for an anonymous reader, so the same search run through each is what
  // shows `nearest()` ranking inside the scoped set.
  const anonymous = await getContext()
  const signedIn = await getContext({ userId: 'demo-editor' })

  const provider = createEmbeddingProvider({
    type: 'ollama',
    baseURL: OLLAMA_BASE_URL,
    model: 'nomic-embed-text',
    dimensions: DIMENSIONS,
  })

  console.log(`✓ Provider: ${provider.type} (${provider.model}, ${provider.dimensions}d)`)

  heading('Reseeding')

  // Deleting through the signed-in context: the anonymous scope cannot see an
  // unpublished row, and a reseed that leaves one behind is not a reseed.
  for (const doc of await signedIn.db.Document.all()) {
    await signedIn.db.Document.delete({ where: { id: doc.id } })
  }
  for (const article of await signedIn.db.Article.all()) {
    await signedIn.db.Article.delete({ where: { id: article.id } })
  }
  console.log('✓ Cleared both lists')

  for (const doc of documents) {
    const created = await signedIn.db.Document.create({ data: doc })
    console.log(`✓ Document ${created?.id}: ${doc.title}`)
  }
  for (const article of articles) {
    const created = await signedIn.db.Article.create({ data: article })
    console.log(`✓ Article ${created?.id}: ${article.title}`)
  }

  heading('Embedding generation')

  await waitForEmbeddings('documents', documents.length, async () => {
    const rows = await signedIn.db.Document.all()
    return rows.filter((row) => row.contentEmbedding !== null).length
  })
  await waitForEmbeddings('articles', articles.length, async () => {
    const rows = await signedIn.db.Article.all()
    return rows.filter((row) => row.bodyEmbedding !== null).length
  })

  const [sample] = await signedIn.db.Document.all()
  if (sample?.contentEmbedding) {
    const { metadata, vector } = sample.contentEmbedding
    console.log(
      `\n📊 ${metadata.provider}/${metadata.model}, ${metadata.dimensions}d, ` +
        `vector length ${vector.length}, sourceHash ${metadata.sourceHash ?? 'none'}`,
    )
  }

  heading('Semantic search through nearest()')

  const aiQuery = await provider.embed('artificial intelligence and neural networks')
  const aiMatches = await signedIn.db.Document.nearest('contentEmbedding', aiQuery, { limit: 3 })
  console.log('\n📍 "artificial intelligence and neural networks"')
  for (const match of aiMatches) {
    console.log(`   ${match.score.toFixed(4)}  ${match.item.title}`)
  }

  const webQuery = await provider.embed('web development and programming')
  const webMatches = await signedIn.db.Document.nearest('contentEmbedding', webQuery, { limit: 3 })
  console.log('\n📍 "web development and programming"')
  for (const match of webMatches) {
    console.log(`   ${match.score.toFixed(4)}  ${match.item.title}`)
  }

  const healthQuery = await provider.embed('AI in medicine and diagnosis')
  const healthMatches = await signedIn.db.Article.nearest('bodyEmbedding', healthQuery, {
    limit: 3,
  })
  console.log('\n📍 "AI in medicine and diagnosis" (Article)')
  for (const match of healthMatches) {
    console.log(`   ${match.score.toFixed(4)}  ${match.item.title} [${match.item.category}]`)
  }

  heading('The ranking is scoped by access control')

  const rlQuery = await provider.embed('an agent learning a policy from rewards')
  const asEditor = await signedIn.db.Document.nearest('contentEmbedding', rlQuery, { limit: 5 })
  const asAnonymous = await anonymous.db.Document.nearest('contentEmbedding', rlQuery, { limit: 5 })

  console.log('\nSigned in:')
  for (const match of asEditor) {
    console.log(`   ${match.score.toFixed(4)}  ${match.item.title}`)
  }
  console.log('\nAnonymous:')
  for (const match of asAnonymous) {
    console.log(`   ${match.score.toFixed(4)}  ${match.item.title}`)
  }

  const draft = 'Reinforcement Learning Draft'
  const editorSawDraft = asEditor.some((match) => match.item.title === draft)
  const anonymousSawDraft = asAnonymous.some((match) => match.item.title === draft)
  console.log(`\n   signed-in sees the unpublished draft: ${editorSawDraft}`)
  console.log(`   anonymous sees the unpublished draft:  ${anonymousSawDraft}`)
  if (!editorSawDraft || anonymousSawDraft) {
    throw new Error('The Access Filter did not scope the ranking as the config declares.')
  }

  heading('Re-embedding on a source change')

  const target = await signedIn.db.Document.where({
    title: { equals: 'JavaScript Basics' },
  }).first()
  if (target?.contentEmbedding) {
    const before = target.contentEmbedding.metadata.sourceHash
    await signedIn.db.Document.update({
      where: { id: target.id },
      data: {
        content:
          'JavaScript is a powerful programming language used for both frontend and backend development. With frameworks like React and Next.js, it enables building modern, interactive web applications.',
      },
    })

    const deadline = Date.now() + 120_000
    let after = before
    while (after === before && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 500))
      const reread = await signedIn.db.Document.where({ id: { equals: target.id } }).first()
      after = reread?.contentEmbedding?.metadata.sourceHash
    }
    console.log(`   sourceHash before: ${before}`)
    console.log(`   sourceHash after:  ${after}`)
    console.log(`   regenerated: ${after !== before}`)
    if (after === before) {
      throw new Error('The embedding was not regenerated after its source field changed.')
    }
  }

  heading('Finding similar documents')

  const reference = await signedIn.db.Document.where({
    title: { equals: 'Introduction to Machine Learning' },
  }).first()

  if (reference?.contentEmbedding) {
    const similar = await signedIn.db.Document.where({ id: { not: reference.id } }).nearest(
      'contentEmbedding',
      reference.contentEmbedding.vector,
      { limit: 5 },
    )
    console.log(`\nClosest to "${reference.title}":`)
    for (const match of similar) {
      console.log(`   ${match.score.toFixed(4)}  ${match.item.title}`)
    }
  }

  const total = await signedIn.db.Document.aggregate((aggregate) => ({
    documents: aggregate.count(),
  }))
  console.log(`\n✅ Demo complete — ${total.documents} documents in the scoped set.`)
  console.log('   Visit /admin on the port `pnpm dev` reported to browse, create or delete.')
  console.log('   Editing a row there fails: the form resubmits the write-denied embedding.')
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error('❌ Error:', error)
    process.exit(1)
  })
