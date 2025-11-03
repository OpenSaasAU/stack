'use client'

import { useState } from 'react'
import copy from 'clipboard-copy'
import { Check, Copy } from 'lucide-react'

interface CodeBlockWrapperProps {
  html: string
  code: string
  language: string
}

export function CodeBlockWrapper({ html, code, language }: CodeBlockWrapperProps) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    await copy(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="my-6 relative group">
      {/* Copy button */}
      <div className="absolute right-2 top-2 z-10 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={handleCopy}
          className="p-2 bg-muted hover:bg-muted/80 rounded-lg transition-colors shadow-sm border border-border"
          title="Copy code"
        >
          {copied ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
        </button>
      </div>

      {/* Language label */}
      <div className="absolute left-4 top-2 z-10 opacity-0 group-hover:opacity-100 transition-opacity">
        <span className="text-xs px-2 py-1 bg-muted rounded text-muted-foreground font-mono border border-border">
          {language}
        </span>
      </div>

      {/* Highlighted code */}
      <div
        className="shiki-wrapper [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:p-4 [&_pre]:!bg-transparent"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  )
}
