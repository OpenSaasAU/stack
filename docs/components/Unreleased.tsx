import React from 'react'
import { AlertTriangle } from 'lucide-react'

interface UnreleasedProps {
  publishedVersion: string
  children: React.ReactNode
}

export function Unreleased({ publishedVersion, children }: UnreleasedProps) {
  return (
    <div className="flex gap-3 p-4 my-4 rounded-lg border bg-yellow-50 border-yellow-200 text-yellow-900">
      <AlertTriangle className="h-5 w-5 flex-shrink-0 mt-0.5" />
      <div className="flex-1">
        <p className="font-semibold">
          Unreleased — describes <code>main</code>, not the published package
        </p>
        <p>
          The latest published release is <code>{`@opensaas/stack-core@${publishedVersion}`}</code>,
          which does not include this yet.
        </p>
        {children}
      </div>
    </div>
  )
}
