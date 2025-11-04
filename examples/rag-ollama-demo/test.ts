/**
 * Test script demonstrating RAG integration with Ollama and SQLite VSS
 *
 * This script:
 * 1. Creates sample documents and articles
 * 2. Verifies embeddings are auto-generated
 * 3. Performs semantic search queries
 * 4. Demonstrates similarity scoring
 */

import { getContext } from './.opensaas/context.js'
import { createEmbeddingProvider } from '@opensaas/stack-rag/providers'

// Helper to display results
function logResults(title: string, results: unknown[]) {
  console.log(`\n${'='.repeat(80)}`)
  console.log(`${title}`)
  console.log('='.repeat(80))
  console.log(JSON.stringify(results, null, 2))
}

// Calculate cosine similarity between two vectors
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error('Vectors must have same dimensions')
  }

  let dotProduct = 0
  let normA = 0
  let normB = 0

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB)
  if (denominator === 0) return 0

  return dotProduct / denominator
}

async function main() {
  console.log('🚀 RAG Demo with Ollama + SQLite VSS\n')

  // Step 1: Initialize context and provider
  console.log('📝 Initializing...')
  const context = await getContext()

  const provider = createEmbeddingProvider({
    type: 'ollama',
    baseURL: process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
    model: 'nomic-embed-text',
  })

  console.log(`✓ Provider: ${provider.type}`)
  console.log(`✓ Model: ${provider.model}`)
  console.log(`✓ Dimensions: ${provider.dimensions}\n`)

  // Step 2: Clear existing data
  console.log('🗑️  Cleaning up existing data...')
  const existingDocs = await context.db.document.findMany()
  const existingArticles = await context.db.article.findMany()

  for (const doc of existingDocs) {
    await context.db.document.delete({ where: { id: doc.id } })
  }
  for (const article of existingArticles) {
    await context.db.article.delete({ where: { id: article.id } })
  }
  console.log('✓ Cleanup complete\n')

  // Step 3: Create sample documents
  console.log('📚 Creating sample documents...')

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
  ]

  for (const doc of documents) {
    const created = await context.db.document.create({ data: doc })
    console.log(`✓ Created: ${created.title}`)
  }

  // Step 4: Create sample articles
  console.log('\n📰 Creating sample articles...')

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

  for (const article of articles) {
    const created = await context.db.article.create({ data: article })
    console.log(`✓ Created: ${created.title}`)
  }

  // Step 5: Verify embeddings were generated
  console.log('\n🔍 Verifying auto-generated embeddings...')

  const allDocs = await context.db.document.findMany()
  const docsWithEmbeddings = allDocs.filter((doc) => doc.contentEmbedding !== null)

  const allArticlesCheck = await context.db.article.findMany()
  const articlesWithEmbeddings = allArticlesCheck.filter(
    (article) => article.bodyEmbedding !== null,
  )

  console.log(`✓ Documents with embeddings: ${docsWithEmbeddings.length}/${documents.length}`)
  console.log(`✓ Articles with embeddings: ${articlesWithEmbeddings.length}/${articles.length}`)

  if (docsWithEmbeddings.length > 0) {
    const firstDoc = docsWithEmbeddings[0]
    const embedding = firstDoc.contentEmbedding as {
      vector: number[]
      metadata: { provider: string; model: string; dimensions: number }
    }
    console.log(`\n📊 Sample embedding metadata:`)
    console.log(`   Provider: ${embedding.metadata.provider}`)
    console.log(`   Model: ${embedding.metadata.model}`)
    console.log(`   Dimensions: ${embedding.metadata.dimensions}`)
    console.log(`   Vector length: ${embedding.vector.length}`)
  }

  // Step 6: Perform semantic search
  console.log('\n\n🔎 Performing semantic searches...')

  // Query 1: Search for AI-related content
  console.log('\n📍 Query 1: "artificial intelligence and neural networks"')
  const query1 = 'artificial intelligence and neural networks'
  const query1Vector = await provider.embed(query1)

  const results1 = allDocs
    .map((doc) => {
      const embedding = doc.contentEmbedding as { vector: number[] } | null
      if (!embedding || !embedding.vector) return null

      const score = cosineSimilarity(query1Vector, embedding.vector)
      return { doc, score }
    })
    .filter((r) => r !== null)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)

  logResults(
    'Top 3 Results',
    results1.map((r) => ({
      title: r.doc.title,
      similarity: r.score.toFixed(4),
      summary: r.doc.summary,
    })),
  )

  // Query 2: Search for web development content
  console.log('\n📍 Query 2: "web development and programming"')
  const query2 = 'web development and programming'
  const query2Vector = await provider.embed(query2)

  const results2 = allDocs
    .map((doc) => {
      const embedding = doc.contentEmbedding as { vector: number[] } | null
      if (!embedding || !embedding.vector) return null

      const score = cosineSimilarity(query2Vector, embedding.vector)
      return { doc, score }
    })
    .filter((r) => r !== null)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)

  logResults(
    'Top 3 Results',
    results2.map((r) => ({
      title: r.doc.title,
      similarity: r.score.toFixed(4),
      summary: r.doc.summary,
    })),
  )

  // Query 3: Search articles for healthcare AI
  console.log('\n📍 Query 3: "AI in medicine and diagnosis" (searching Articles)')
  const query3 = 'AI in medicine and diagnosis'
  const query3Vector = await provider.embed(query3)

  const allArticles = await context.db.article.findMany()
  const results3 = allArticles
    .map((article) => {
      const embedding = article.bodyEmbedding as { vector: number[] } | null
      if (!embedding || !embedding.vector) return null

      const score = cosineSimilarity(query3Vector, embedding.vector)
      return { article, score }
    })
    .filter((r) => r !== null)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)

  logResults(
    'Top 3 Results',
    results3.map((r) => ({
      title: r.article.title,
      similarity: r.score.toFixed(4),
      category: r.article.category,
    })),
  )

  // Step 7: Test embedding update on content change
  console.log('\n\n🔄 Testing automatic embedding updates...')

  const [docToUpdate] = await context.db.document.findMany({
    where: { title: 'JavaScript Basics' },
  })

  if (docToUpdate) {
    const oldEmbedding = docToUpdate.contentEmbedding as { metadata: { sourceHash: string } }
    console.log(`\n📝 Original source hash: ${oldEmbedding.metadata.sourceHash}`)

    // Update content
    await context.db.document.update({
      where: { id: docToUpdate.id },
      data: {
        content:
          'JavaScript is a powerful programming language used for both frontend and backend development. With frameworks like React and Next.js, it enables building modern, interactive web applications.',
      },
    })

    console.log('✓ Updated document content')

    // Fetch again to see new embedding
    const _afterUpdate = await context.db.document.findUnique({
      where: { id: docToUpdate.id },
    })

    const newEmbedding = _afterUpdate!.contentEmbedding as { metadata: { sourceHash: string } }
    console.log(`📝 New source hash: ${newEmbedding.metadata.sourceHash}`)
    console.log(
      `✓ Embedding ${oldEmbedding.metadata.sourceHash !== newEmbedding.metadata.sourceHash ? 'was regenerated' : 'remained the same'}`,
    )
  }

  // Step 8: Demonstrate similarity between related documents
  console.log('\n\n🔗 Document Similarity Matrix')
  console.log('Finding similar documents using "Find Similar" pattern...\n')

  const [mlDoc] = await context.db.document.findMany({
    where: { title: 'Introduction to Machine Learning' },
  })

  if (mlDoc && mlDoc.contentEmbedding) {
    const mlEmbedding = mlDoc.contentEmbedding as { vector: number[] }
    console.log(`Reference document: "${mlDoc.title}"`)

    const similarities = allDocs
      .filter((doc) => doc.id !== mlDoc.id) // Exclude self
      .map((doc) => {
        const embedding = doc.contentEmbedding as { vector: number[] } | null
        if (!embedding || !embedding.vector) return null

        const score = cosineSimilarity(mlEmbedding.vector, embedding.vector)
        return { title: doc.title, score }
      })
      .filter((r) => r !== null)
      .sort((a, b) => b.score - a.score)

    logResults(
      'Similar Documents (sorted by similarity)',
      similarities.map((s) => ({
        title: s.title,
        similarity: s.score.toFixed(4),
      })),
    )
  }

  console.log('\n\n✅ Demo complete!')
  console.log('\n💡 Next steps:')
  console.log('   - Visit http://localhost:3000/admin to manage content')
  console.log('   - Try modifying documents and see embeddings auto-update')
  console.log('   - Experiment with different search queries')
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('❌ Error:', error)
    process.exit(1)
  })
