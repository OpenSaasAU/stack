export const REQUIRED_NODE = '22.18.0'

export function nodeVersionError(version: string, required: string = REQUIRED_NODE): string | null {
  const parse = (v: string): number[] => v.split('.').map((part) => Number.parseInt(part, 10) || 0)
  const have = parse(version)
  const need = parse(required)
  for (let i = 0; i < 3; i++) {
    const h = have[i] ?? 0
    const n = need[i] ?? 0
    if (h > n) return null
    if (h < n) {
      return `create-opensaas-app requires Node.js ${required} or newer; this is Node.js ${version}.`
    }
  }
  return null
}
