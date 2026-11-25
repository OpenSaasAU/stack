'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

type Destination = { kind: 'href'; href: string } | { kind: 'back' }

export interface UnsavedChangesGuard {
  /** Leave for `href` now when clean, or ask first when dirty. */
  requestLeave: (href: string) => void
  /** Stop guarding; call just before navigating away after a successful save. */
  release: () => void
  prompt: { isOpen: boolean; onConfirm: () => void; onCancel: () => void }
}

function internalHref(event: MouseEvent): string | null {
  if (event.defaultPrevented || event.button !== 0) return null
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return null
  if (!(event.target instanceof Element)) return null
  const anchor = event.target.closest('a')
  if (!anchor || (anchor.target && anchor.target !== '_self') || anchor.hasAttribute('download')) {
    return null
  }
  const url = new URL(anchor.href, window.location.href)
  if (url.origin !== window.location.origin) return null
  if (url.pathname === window.location.pathname && url.search === window.location.search) {
    return null
  }
  return `${url.pathname}${url.search}${url.hash}`
}

/**
 * Warns before unsaved edits are dropped by reload, tab close, Back, or a click on
 * any in-app link. The App Router has no navigation-blocking API, so clicks are
 * intercepted in the capture phase and Back is caught through a sentinel history entry.
 */
export function useUnsavedChangesGuard(
  dirty: boolean,
  navigate: (href: string) => void,
): UnsavedChangesGuard {
  const [pending, setPending] = useState<Destination | null>(null)
  const [released, setReleased] = useState(false)
  const releasedRef = useRef(false)
  const navigateRef = useRef(navigate)
  useEffect(() => {
    navigateRef.current = navigate
  })

  const guarding = dirty && !released

  useEffect(() => {
    if (!guarding) return

    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (releasedRef.current) return
      event.preventDefault()
      event.returnValue = ''
    }
    const onClick = (event: MouseEvent) => {
      if (releasedRef.current) return
      const href = internalHref(event)
      if (href === null) return
      event.preventDefault()
      event.stopPropagation()
      setPending({ kind: 'href', href })
    }
    const onPopState = () => {
      if (releasedRef.current) return
      window.history.pushState(window.history.state, '', window.location.href)
      setPending({ kind: 'back' })
    }

    window.history.pushState(window.history.state, '', window.location.href)
    window.addEventListener('beforeunload', onBeforeUnload)
    window.addEventListener('popstate', onPopState)
    document.addEventListener('click', onClick, true)
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload)
      window.removeEventListener('popstate', onPopState)
      document.removeEventListener('click', onClick, true)
    }
  }, [guarding])

  const requestLeave = useCallback(
    (href: string) => {
      if (guarding) setPending({ kind: 'href', href })
      else navigateRef.current(href)
    },
    [guarding],
  )

  const release = useCallback(() => {
    releasedRef.current = true
    setReleased(true)
  }, [])

  const onConfirm = () => {
    const destination = pending
    setPending(null)
    release()
    if (destination?.kind === 'href') navigateRef.current(destination.href)
    else if (destination?.kind === 'back') window.history.go(-2)
  }

  return {
    requestLeave,
    release,
    prompt: { isOpen: pending !== null, onConfirm, onCancel: () => setPending(null) },
  }
}
