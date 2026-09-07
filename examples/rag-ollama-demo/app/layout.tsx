import '@opensaas/stack-ui/styles'
import type { Metadata } from 'next'
import React from 'react'

export const metadata: Metadata = {
  title: 'OpenSaas RAG Demo - Ollama + pgvector',
  description: 'Demonstration of RAG integration with Ollama embeddings and a pgvector column',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
