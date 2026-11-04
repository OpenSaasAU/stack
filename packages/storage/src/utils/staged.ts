import type { StorageProvider } from '../config/types.js'

const STAGING_PREFIX = /^staging-[0-9a-f]{32}-/

interface StagedUpload {
  promote: () => Promise<void>
  discard: () => Promise<void>
}

const staged = new WeakMap<object, StagedUpload>()

export function stagingName(token: string, stableName: string): string {
  return `staging-${token}-${stableName}`
}

export function stableNameOf(stagedName: string): string {
  return stagedName.replace(STAGING_PREFIX, '')
}

export function registerStaged(
  metadata: object,
  provider: StorageProvider,
  stagedToStable: Array<[string, string]>,
): void {
  staged.set(metadata, {
    promote: async () => {
      const failures: unknown[] = []
      for (const [from, to] of stagedToStable) {
        try {
          await provider.move?.(from, to)
        } catch (error) {
          failures.push(error)
        }
      }
      if (failures.length > 0) throw new AggregateError(failures, 'Failed to promote staged upload')
    },
    discard: async () => {
      for (const [from] of stagedToStable) await provider.delete(from)
    },
  })
}

export function takeStaged(metadata: object): StagedUpload | undefined {
  const entry = staged.get(metadata)
  staged.delete(metadata)
  return entry
}
