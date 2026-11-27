'use client'

import * as React from 'react'
import { TIME_ZONE_COOKIE } from '../lib/viewerTimeZone.js'

const YEAR_IN_SECONDS = 60 * 60 * 24 * 365

export function ViewerTimeZone() {
  React.useEffect(() => {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
    if (!timeZone) return
    const current = document.cookie
      .split('; ')
      .find((entry) => entry.startsWith(`${TIME_ZONE_COOKIE}=`))
      ?.slice(TIME_ZONE_COOKIE.length + 1)
    if (current === encodeURIComponent(timeZone)) return
    document.cookie = `${TIME_ZONE_COOKIE}=${encodeURIComponent(timeZone)}; path=/; max-age=${YEAR_IN_SECONDS}; SameSite=Lax`
  }, [])
  return null
}
