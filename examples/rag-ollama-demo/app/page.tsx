import Link from 'next/link'

export default function HomePage() {
  return (
    <div style={{ padding: '2rem', maxWidth: '800px', margin: '0 auto' }}>
      <h1>OpenSaas RAG Demo</h1>
      <p>This example demonstrates RAG (Retrieval-Augmented Generation) integration with:</p>
      <ul>
        <li>
          <strong>Ollama</strong> - Local embedding generation using nomic-embed-text model
        </li>
        <li>
          <strong>SQLite VSS</strong> - Vector similarity search in SQLite
        </li>
        <li>
          <strong>Automatic embeddings</strong> - Auto-generated when content changes
        </li>
      </ul>

      <h2>Getting Started</h2>
      <ol>
        <li>
          Install Ollama: <code>https://ollama.ai</code>
        </li>
        <li>
          Pull the embedding model: <code>ollama pull nomic-embed-text</code>
        </li>
        <li>
          Visit the <Link href="/admin">Admin UI</Link> to create documents and articles
        </li>
        <li>
          Run the test script: <code>pnpm test</code> to see semantic search in action
        </li>
      </ol>

      <h2>Features</h2>
      <ul>
        <li>
          <strong>Document List</strong> - General documents with semantic search on content
        </li>
        <li>
          <strong>Article List</strong> - Blog-style articles with semantic search on body
        </li>
        <li>
          <strong>Automatic Embedding Generation</strong> - Embeddings auto-update when source text
          changes
        </li>
        <li>
          <strong>Local Development</strong> - No API keys needed, everything runs locally
        </li>
      </ul>

      <div style={{ marginTop: '2rem' }}>
        <Link
          href="/admin"
          style={{
            padding: '0.5rem 1rem',
            background: '#0070f3',
            color: 'white',
            borderRadius: '5px',
            textDecoration: 'none',
          }}
        >
          Open Admin UI
        </Link>
      </div>
    </div>
  )
}
