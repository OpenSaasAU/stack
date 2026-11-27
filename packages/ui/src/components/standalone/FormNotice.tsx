'use client'

import { cn } from '../../lib/utils.js'

export function FormNotice({ message, className }: { message: string | null; className?: string }) {
  if (message === null) return null
  return (
    <p
      role="status"
      data-slot="form-notice"
      className={cn('self-center text-sm text-muted-foreground', className)}
    >
      {message}
    </p>
  )
}
