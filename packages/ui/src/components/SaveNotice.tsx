'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation.js'

export const SAVE_NOTICE_KEY = 'opensaas-save-notice'

export function queueSaveNotice(message: string): void {
  try {
    window.sessionStorage.setItem(SAVE_NOTICE_KEY, message)
  } catch {
    return
  }
}

export function SaveNotice() {
  const pathname = usePathname()
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    try {
      const queued = window.sessionStorage.getItem(SAVE_NOTICE_KEY)
      if (!queued) return
      window.sessionStorage.removeItem(SAVE_NOTICE_KEY)
      setMessage(queued)
    } catch {
      return
    }
  }, [pathname])

  useEffect(() => {
    if (!message) return
    const timer = window.setTimeout(() => setMessage(null), 5000)
    return () => window.clearTimeout(timer)
  }, [message])

  if (!message) return null
  return (
    <div
      role="status"
      data-slot="save-notice"
      className="fixed bottom-4 right-4 z-50 rounded-lg border border-border bg-card px-4 py-3 text-sm shadow-lg"
    >
      {message}
    </div>
  )
}
