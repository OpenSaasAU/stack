import { cookies } from 'next/headers.js'
import { unstable_rethrow } from 'next/navigation.js'
import { TIME_ZONE_COOKIE } from './viewerTimeZone.js'
import { isTimeZone } from './zonedDays.js'

export async function readViewerTimeZone(): Promise<string | undefined> {
  try {
    const value = (await cookies()).get(TIME_ZONE_COOKIE)?.value
    return value !== undefined && isTimeZone(value) ? value : undefined
  } catch (error) {
    unstable_rethrow(error)
    return undefined
  }
}
