export const REQUIRED_NODE = '22.18.0'

export function nodeVersionError(version, required = REQUIRED_NODE) {
  const parse = (v) => v.split('.').map((part) => Number.parseInt(part, 10) || 0)
  const have = parse(version)
  const need = parse(required)
  for (let i = 0; i < 3; i++) {
    if ((have[i] ?? 0) > need[i]) return null
    if ((have[i] ?? 0) < need[i]) {
      return `opensaas requires Node.js ${required} or newer; this is Node.js ${version}.`
    }
  }
  return null
}
