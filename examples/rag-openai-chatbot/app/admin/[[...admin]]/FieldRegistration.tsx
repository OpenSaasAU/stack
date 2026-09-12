'use client'

import '@opensaas/stack-rag/components/register'

/**
 * Registers the RAG field components on the client. The admin UI's registry
 * lives in the browser bundle, so the import has to happen from a client
 * component — a server component importing it registers nothing.
 */
export function FieldRegistration() {
  return null
}
