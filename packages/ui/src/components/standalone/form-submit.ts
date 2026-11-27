import { unstable_rethrow } from 'next/navigation.js'
import { UNREACHABLE_SAVE } from '../../lib/unreachable.js'

export type StandaloneResult = { success: boolean; error?: string }

export async function submitOrUnreachable(
  submit: () => Promise<StandaloneResult>,
  fallback: string,
): Promise<{ success: true } | { success: false; error: string }> {
  try {
    const result = await submit()
    return result.success ? { success: true } : { success: false, error: result.error || fallback }
  } catch (error) {
    unstable_rethrow(error)
    return { success: false, error: UNREACHABLE_SAVE }
  }
}
