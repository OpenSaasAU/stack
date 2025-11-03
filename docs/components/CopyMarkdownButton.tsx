'use client'

import { useState } from 'react'
import copy from 'clipboard-copy'
import { Check, Copy } from 'lucide-react'

interface CopyMarkdownButtonProps {
  slug: string[]
}

export function CopyMarkdownButton({ slug }: CopyMarkdownButtonProps) {
  const [copied, setCopied] = useState(false)
  const [loading, setLoading] = useState(false)

  const handleCopy = async () => {
    setLoading(true)
    try {
      // Fetch raw markdown from API
      const response = await fetch(`/api/markdown?slug=${slug.join('/')}`)
      if (!response.ok) throw new Error('Failed to fetch markdown')

      const data = await response.json()
      await copy(data.content)

      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (error) {
      console.error('Failed to copy markdown:', error)
    } finally {
      setLoading(false)
    }
  }

  return (
    <button
      onClick={handleCopy}
      disabled={loading || copied}
      className="flex items-center gap-2 px-4 py-2 border rounded-lg hover:bg-muted transition-colors disabled:opacity-50"
      title="Copy page contents in markdown format"
    >
      {copied ? (
        <>
          <Check className="h-4 w-4 text-green-600" />
          <span className="text-sm">Copied!</span>
        </>
      ) : (
        <>
          <Copy className="h-4 w-4" />
          <span className="text-sm">Copy Markdown</span>
        </>
      )}
    </button>
  )
}
