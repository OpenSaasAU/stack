/**
 * MCP tool generation for RAG lists is automatic via ragPlugin; see
 * packages/rag/src/config/plugin.ts. This module re-exports types useful for
 * custom MCP tool development.
 */

export type { SearchResult } from '../config/types.js'
export type { SemanticSearchOptions } from '../runtime/search.js'
