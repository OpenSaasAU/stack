'use client'

import { useState } from 'react'
import copy from 'clipboard-copy'
import { Check, Copy } from 'lucide-react'

interface CodeBlockProps {
  language?: string
  content: string
}

export function CodeBlock({ language = 'typescript', content }: CodeBlockProps) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    await copy(content)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="relative group my-4">
      <div className="absolute right-2 top-2 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={handleCopy}
          className="p-2 bg-muted hover:bg-muted/80 rounded-lg transition-colors"
          title="Copy code"
        >
          {copied ? (
            <Check className="h-4 w-4 text-green-600" />
          ) : (
            <Copy className="h-4 w-4" />
          )}
        </button>
      </div>
      <div className="flex items-center gap-2 px-4 py-2 bg-muted border-b text-xs text-muted-foreground">
        <span className="font-mono">{language}</span>
      </div>
      <pre className="!mt-0 overflow-x-auto">
        <code className="block p-4 text-sm font-mono">{content}</code>
      </pre>
    </div>
  )
}
