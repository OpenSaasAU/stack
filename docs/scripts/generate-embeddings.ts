/**
 * Generate embeddings for documentation content
 *
 * This script demonstrates how to use @opensaas/stack-rag utilities
 * to generate embeddings for documentation at build time.
 */

import { writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { getAllDocSlugs, getDocBySlug } from '../lib/content.js'
import type { EmbeddingsIndex } from '@opensaas/stack-rag'
import {
  createProviderFromEnv,
  generateDocumentEmbeddings,
  stripMarkdown,
} from '@opensaas/stack-rag/runtime'

/**
 * Configuration
 */
const CHUNK_SIZE = 500 // characters
const CHUNK_OVERLAP = 50 // characters
const OUTPUT_PATH = '.embeddings/docs.json'

/**
 * Main function
 */
async function main() {
  console.log('🚀 Generating documentation embeddings...\n')

  // Create embedding provider from environment variables
  // Reads EMBEDDING_PROVIDER and OPENAI_API_KEY/OLLAMA_BASE_URL
  const provider = createProviderFromEnv()
  console.log(
    `Using ${provider.type} provider (model: ${provider.model}, dimensions: ${provider.dimensions})\n`,
  )

  // Get all documentation slugs
  const allSlugs = getAllDocSlugs()
  console.log(`Found ${allSlugs.length} documents\n`)

  // Process each document
  const documents: EmbeddingsIndex['documents'] = {}

  for (const slug of allSlugs) {
    try {
      const doc = getDocBySlug(slug)
      if (!doc) {
        console.warn(`⚠️  Skipping ${slug.join('/')}: not found`)
        continue
      }

      const documentId = slug.join('/')
      console.log(`Processing: ${documentId}`)

      // Strip markdown and generate embeddings using stack utilities
      const cleanText = stripMarkdown(doc.content)

      const embeddedDoc = await generateDocumentEmbeddings(documentId, cleanText, provider, {
        title: doc.title,
        chunkSize: CHUNK_SIZE,
        chunkOverlap: CHUNK_OVERLAP,
        metadata: {
          slug: documentId,
          section: doc.title,
        },
      })

      documents[embeddedDoc.id] = embeddedDoc
      console.log(`  ✓ Generated ${embeddedDoc.chunks.length} chunks`)
    } catch (error) {
      console.error(`❌ Error processing ${slug.join('/')}:`, error)
    }
  }

  // Create embeddings index
  const index: EmbeddingsIndex = {
    version: '1.0',
    config: {
      provider: provider.type,
      model: provider.model,
      dimensions: provider.dimensions,
      chunkSize: CHUNK_SIZE,
      chunkOverlap: CHUNK_OVERLAP,
    },
    documents,
    generatedAt: new Date().toISOString(),
  }

  // Write to file
  const outputPath = resolve(process.cwd(), OUTPUT_PATH)
  const outputDir = dirname(outputPath)

  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true })
  }

  writeFileSync(outputPath, JSON.stringify(index, null, 2), 'utf-8')

  console.log(`\n✅ Generated embeddings for ${Object.keys(documents).length} documents`)
  console.log(`📁 Saved to: ${outputPath}`)
  console.log(
    `📊 Total chunks: ${Object.values(documents).reduce((sum, doc) => sum + doc.chunks.length, 0)}`,
  )
}

main().catch((error) => {
  console.error('❌ Error:', error)
  process.exit(1)
})
