import * as fs from 'fs'
import * as path from 'path'

/**
 * Result of translating a project's `tsconfig.json` `compilerOptions.paths`
 * into `jiti`'s `alias` option (issue #905).
 */
export interface TsconfigAliasResult {
  /**
   * Flat alias map for `createJiti`'s `alias` option, or `undefined` when
   * there is nothing to alias (no `tsconfig.json`, no `paths`, or every
   * `paths` entry was unrepresentable). Passing `undefined` through to
   * `createJiti` is identical to omitting the option entirely.
   */
  alias: Record<string, string> | undefined
  /**
   * One message per `paths` entry that could not be translated, naming the
   * pattern so the project owner knows which alias will not resolve.
   */
  warnings: string[]
}

/**
 * `jiti` delegates alias resolution to `pathe`'s `resolveAlias`, which does
 * plain prefix matching (`id.startsWith(key)` with a path-boundary check) —
 * unlike `tsconfig` `paths`, which is a glob form allowing multiple candidate
 * targets per pattern. This translation is therefore partial by design: it
 * faithfully handles the common single-trailing-star, single-target case
 * (`"@/*": ["./src/*"]`) by stripping the trailing `*` from both the pattern
 * and its target and resolving the target against `baseUrl`. Any entry with
 * more than one candidate target, or a pattern/target shape the alias model
 * cannot represent (no star, a star that isn't the last character, multiple
 * stars), is skipped and reported as a warning rather than silently dropped
 * or faithfully reimplemented — full fidelity with TypeScript's resolver
 * (`extends` chains, project references, conditional exports) is out of
 * scope.
 *
 * A bare `"*"` pattern (`{ "*": ["./src/*"] }`, a common catch-all for
 * unprefixed imports like `lib/utils`) is a single-trailing-star pattern too,
 * but stripping its trailing `*` leaves an EMPTY alias key. `pathe`'s
 * `resolveAlias` matches keys by prefix (`id.startsWith(key)`), and every
 * string starts with `''` — so an empty key aliases every module specifier
 * jiti resolves, including `opensaas.config.ts`'s own absolute path and every
 * relative import in its closure, not just the bare imports it was meant for.
 * This is therefore skipped and reported as a warning like any other
 * unrepresentable entry, rather than corrupting unrelated resolution.
 *
 * A project with no `tsconfig.json`, or one with no `paths`, returns
 * `{ alias: undefined, warnings: [] }` so callers behave exactly as they did
 * before this translation existed.
 */
export function resolveTsconfigAlias(cwd: string): TsconfigAliasResult {
  const tsconfigPath = path.join(cwd, 'tsconfig.json')
  if (!fs.existsSync(tsconfigPath)) {
    return { alias: undefined, warnings: [] }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(stripJsonComments(fs.readFileSync(tsconfigPath, 'utf-8')))
  } catch {
    return {
      alias: undefined,
      warnings: [
        'tsconfig.json could not be parsed; path aliases in opensaas.config.ts will not be resolved.',
      ],
    }
  }

  const compilerOptions = getRecord(parsed, 'compilerOptions')
  const paths = compilerOptions && getRecord(compilerOptions, 'paths')
  if (!paths) {
    return { alias: undefined, warnings: [] }
  }

  const baseUrl =
    compilerOptions && typeof compilerOptions.baseUrl === 'string' ? compilerOptions.baseUrl : '.'
  const baseDir = path.resolve(path.dirname(tsconfigPath), baseUrl)

  const alias: Record<string, string> = {}
  const warnings: string[] = []

  for (const [pattern, targets] of Object.entries(paths)) {
    if (!Array.isArray(targets) || targets.length !== 1 || typeof targets[0] !== 'string') {
      warnings.push(
        `tsconfig.json path "${pattern}" has ${Array.isArray(targets) ? targets.length : 0} candidate target(s); jiti's alias resolution only supports a single target, so this alias will not be resolved.`,
      )
      continue
    }

    const target = targets[0]
    if (!isSingleTrailingStar(pattern) || !isSingleTrailingStar(target)) {
      warnings.push(
        `tsconfig.json path "${pattern}" -> "${target}" is not a single-trailing-"*" alias, which is the only form jiti's alias resolution can represent; this alias will not be resolved.`,
      )
      continue
    }

    const aliasKey = pattern.slice(0, -1)
    if (aliasKey === '') {
      warnings.push(
        `tsconfig.json path "${pattern}" -> "${target}" is a catch-all alias (empty prefix); jiti's prefix-based alias resolution would apply it to every module specifier, not just unprefixed imports, so this alias will not be resolved.`,
      )
      continue
    }

    const aliasTarget = path.resolve(baseDir, target.slice(0, -1))
    alias[aliasKey] = aliasTarget
  }

  return { alias: Object.keys(alias).length > 0 ? alias : undefined, warnings }
}

/** True when `value` has exactly one `*`, and it is the final character. */
function isSingleTrailingStar(value: string): boolean {
  return value.length > 0 && value.indexOf('*') === value.length - 1
}

/** Read `obj[key]` as a plain record, or `undefined` if it isn't one. */
function getRecord(obj: unknown, key: string): Record<string, unknown> | undefined {
  if (typeof obj !== 'object' || obj === null || !(key in obj)) return undefined
  const value = (obj as Record<string, unknown>)[key]
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

/**
 * Strip `//` and `/* *‍/` comments and trailing commas from a JSONC string
 * (tsconfig.json commonly contains both, which `JSON.parse` rejects).
 * Comment-like sequences inside string literals are left untouched.
 */
function stripJsonComments(input: string): string {
  let result = ''
  let inString = false
  let stringChar = ''

  for (let i = 0; i < input.length; i++) {
    const ch = input[i]

    if (inString) {
      result += ch
      if (ch === '\\') {
        result += input[i + 1] ?? ''
        i++
        continue
      }
      if (ch === stringChar) inString = false
      continue
    }

    if (ch === '"' || ch === "'") {
      inString = true
      stringChar = ch
      result += ch
      continue
    }

    if (ch === '/' && input[i + 1] === '/') {
      while (i < input.length && input[i] !== '\n') i++
      result += '\n'
      continue
    }

    if (ch === '/' && input[i + 1] === '*') {
      i += 2
      while (i < input.length && !(input[i] === '*' && input[i + 1] === '/')) i++
      i++ // land on the closing '/'
      continue
    }

    result += ch
  }

  return result.replace(/,(\s*[}\]])/g, '$1')
}
