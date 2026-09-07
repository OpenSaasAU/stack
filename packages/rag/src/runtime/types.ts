/**
 * Runtime services provided by the RAG plugin, available via context.plugins.rag.
 */
export interface RAGRuntimeServices {
  /**
   * Uses the configured embedding provider.
   *
   * @param providerName - Provider to use if multiple providers are configured
   */
  generateEmbedding: (text: string, providerName?: string) => Promise<number[]>

  /**
   * Batch form of `generateEmbedding` — more efficient than calling it per text.
   *
   * @param providerName - Provider to use if multiple providers are configured
   */
  generateEmbeddings: (texts: string[], providerName?: string) => Promise<number[][]>
}
