/**
 * Type definitions for RAG plugin runtime services
 * These types are used for type-safe access to context.plugins.rag
 */

/**
 * Runtime services provided by the RAG plugin
 * Available via context.plugins.rag
 */
export interface RAGRuntimeServices {
  /**
   * Generate embedding for a given text
   * Uses the configured embedding provider
   *
   * @param text - The text to generate an embedding for
   * @param providerName - Optional provider name if multiple providers are configured
   * @returns Vector embedding as array of numbers
   */
  generateEmbedding: (text: string, providerName?: string) => Promise<number[]>

  /**
   * Generate embeddings for multiple texts (batch)
   * More efficient than calling generateEmbedding multiple times
   *
   * @param texts - Array of texts to generate embeddings for
   * @param providerName - Optional provider name if multiple providers are configured
   * @returns Array of vector embeddings
   */
  generateEmbeddings: (texts: string[], providerName?: string) => Promise<number[][]>
}
