import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createJiti } from 'jiti'
import ts from 'typescript'
import { afterAll, describe, expect, it } from 'vitest'
import { FeatureGenerator } from './feature-generator.js'
import { getAllFeatures } from '../features/catalog.js'
import type { Feature, FeatureImplementation, FeatureQuestion } from '../types.js'
// Core is reached through its source, not its package name: `@opensaas/stack-core`
// resolves to `dist`, and this suite must run against the tree it is testing.
import { config as defineConfig, list } from '../../../../../core/src/config/index.js'
import * as coreFields from '../../../../../core/src/fields/index.js'
import { deriveContract } from '../../../../../core/src/contract/index.js'
import { validateConfigFields } from '../../../../../core/src/validation/field-config.js'
import { validateNeedsDeclarations } from '../../../../../core/src/validation/needs-closure.js'
import { validateDatabaseConfig } from '../../../../../core/src/validation/database-config.js'
import { validateRelations } from '../../../../../core/src/validation/relations.js'
import type { ListConfig, OpenSaasConfig } from '../../../../../core/src/config/types.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const mcpSrc = path.resolve(here, '../..')
const packageRoot = path.resolve(here, '../../../..')

/**
 * The Prisma 7 configuration surface the stack no longer accepts, and the
 * commands that went with it. Nothing in this repo type-checks the *strings*
 * these generators emit, so a `provider: 'sqlite'` here reaches the user as a
 * config the stack cannot load, with the framework's own tool named as the
 * author (#1423).
 */
const DEAD_SURFACE: Array<{ pattern: RegExp; fix: string }> = [
  { pattern: /prismaClientConstructor/g, fix: 'the runtime builds its own client' },
  { pattern: /@prisma\/adapter-[a-z0-9-]+/g, fix: 'driver adapters are gone' },
  { pattern: /provider:\s*'(?!postgresql')[a-z0-9]+'/g, fix: "db.provider is 'postgresql' only" },
  { pattern: /\bdb:push\b/g, fix: '`opensaas dev` reconciles; `opensaas db update` promotes' },
  {
    pattern: /\bprisma db push\b/g,
    fix: '`opensaas dev` reconciles; `opensaas db update` promotes',
  },
]

/**
 * Answer sets covering every branch the wizard can take: each `select` option
 * in turn, every `multiselect` option at once, and `true` for each boolean. A
 * generator bug that only appears once a question is answered is still a config
 * the user cannot load.
 */
function answerSets(feature: Feature): Array<Record<string, string | boolean | string[]>> {
  const fixed: Record<string, string | boolean | string[]> = {}
  const selects: FeatureQuestion[] = []

  for (const question of feature.questions) {
    if (question.type === 'select') selects.push(question)
    else if (question.type === 'multiselect') fixed[question.id] = question.options ?? []
    else if (question.type === 'boolean') fixed[question.id] = true
    else fixed[question.id] = 'example'
  }

  return selects.reduce<Array<Record<string, string | boolean | string[]>>>(
    (sets, question) =>
      (question.options ?? []).flatMap((option) =>
        sets.map((set) => ({ ...set, [question.id]: option })),
      ),
    [fixed],
  )
}

function followUps(feature: Feature): Record<string, string | boolean | string[]> {
  return Object.fromEntries(
    feature.questions
      .filter((question) => question.followUp !== undefined)
      .map((question) => [`${question.id}_followup`, 'admin, editor, user']),
  )
}

const CASES = getAllFeatures().flatMap((feature) =>
  answerSets(feature).map((answers, index) => ({
    name: `${feature.id} #${index + 1}`,
    implementation: new FeatureGenerator(feature, answers, followUps(feature)).generate(),
  })),
)

function emittedStrings(implementation: FeatureImplementation): string[] {
  return [
    implementation.configUpdates,
    implementation.devGuideSection,
    ...implementation.files.map((file) => file.content),
    ...implementation.instructions,
    ...implementation.nextSteps,
    ...Object.entries(implementation.envVars ?? {}).map(([key, value]) => `${key}=${value}`),
  ]
}

/**
 * Some features emit a whole `opensaas.config.ts`; the rest emit the entries a
 * user pastes *inside* `config({ lists: { … } })`, which is not a module on its
 * own. Put such a fragment back in the brace it is written for, imports
 * hoisted, so both kinds can be handed to the parser.
 */
function asModule(configUpdates: string): string {
  if (configUpdates.includes('export default config(')) return configUpdates

  const lines = configUpdates.split('\n')
  const imports = lines.filter((line) => line.startsWith('import '))
  const body = lines.filter((line) => !line.startsWith('import '))
  return `${imports.join('\n')}\nconst __lists = {\n${body.join('\n')}\n}`
}

function parseErrors(name: string, source: string): string[] {
  const file = ts.createSourceFile(
    `${name}.tsx`,
    source,
    ts.ScriptTarget.ESNext,
    true,
    ts.ScriptKind.TSX,
  )
  // `parseDiagnostics` is internal but stable, and it is the only way to ask
  // the compiler "did this text parse?" without building a Program.
  const diagnostics = (file as unknown as { parseDiagnostics: ts.Diagnostic[] }).parseDiagnostics
  return diagnostics.map((d) => ts.flattenDiagnosticMessageText(d.messageText, ' '))
}

/**
 * The body of the emitted `lists` block, as source text.
 *
 * Two shapes reach here: a whole `opensaas.config.ts`, whose `lists` property
 * holds them, and a fragment of entries the user pastes *inside*
 * `config({ lists: { … } })`, which is already that text with the imports on
 * top. `null` only when the block holds no entries at all — an entry that is
 * not a list is returned like any other, so that it can fail the check rather
 * than skip it.
 */
function listDeclarations(configUpdates: string): string | null {
  const body = configUpdates.includes('export default config(')
    ? listsProperty(configUpdates)
    : configUpdates
        .split('\n')
        .filter((line) => !line.startsWith('import '))
        .join('\n')

  return body !== null && entryCount(body) > 0 ? body : null
}

function entryCount(body: string): number {
  const file = ts.createSourceFile('lists.tsx', `({${body}})`, ts.ScriptTarget.ESNext, true)
  let count = 0
  const visit = (node: ts.Node): void => {
    if (ts.isObjectLiteralExpression(node) && count === 0) count = node.properties.length
    else ts.forEachChild(node, visit)
  }
  ts.forEachChild(file, visit)
  return count
}

function listsProperty(source: string): string | null {
  const file = ts.createSourceFile('config.tsx', source, ts.ScriptTarget.ESNext, true)
  let found: string | null = null

  const visit = (node: ts.Node): void => {
    if (
      ts.isPropertyAssignment(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'lists' &&
      ts.isObjectLiteralExpression(node.initializer)
    ) {
      const text = node.initializer.getText(file)
      found = text.slice(1, -1)
    }
    ts.forEachChild(node, visit)
  }
  visit(file)

  return found
}

/**
 * `@opensaas/stack-cli`'s own dependency graph, which is what the emitted
 * module can resolve when it is evaluated from inside this package. An import
 * of anything else — `@opensaas/stack-auth`, a storage provider — feeds a
 * top-level `plugins` or `storage` block, not a list field, and is dropped
 * along with the block. A binding that a dropped import did supply fails
 * evaluation, and so fails the case rather than passing quietly.
 */
const cliManifest = JSON.parse(readFileSync(path.join(packageRoot, 'package.json'), 'utf8')) as {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

const RESOLVABLE: ReadonlySet<string> = new Set(
  Object.keys({ ...cliManifest.dependencies, ...cliManifest.devDependencies }),
)

function packageOf(specifier: string): string {
  const segments = specifier.split('/')
  return specifier.startsWith('@') ? segments.slice(0, 2).join('/') : segments[0]
}

function resolvableImports(configUpdates: string): string[] {
  return configUpdates
    .split('\n')
    .filter((line) => line.startsWith('import ') && !line.startsWith('import type '))
    .filter((line) => {
      const specifier = line.match(/from '([^']+)'/)?.[1]
      return specifier !== undefined && RESOLVABLE.has(packageOf(specifier))
    })
}

function boundNames(importLines: string[]): Set<string> {
  return new Set(
    importLines.flatMap((line) =>
      (line.match(/\{([^}]*)\}/)?.[1] ?? '')
        .split(',')
        .map((binding) => binding.split(' as ').pop()?.trim() ?? '')
        .filter(Boolean),
    ),
  )
}

/**
 * A fragment is written to be pasted into a config that already imports `list`
 * and the core field builders, so those bindings are supplied here — minus
 * whatever the fragment imports for itself, which would otherwise redeclare
 * them. Taken from the core modules rather than a hand-written list, so a new
 * field builder needs no edit here.
 */
function hostPrelude(importLines: string[]): string {
  const bound = boundNames(importLines)
  const missing = (names: string[]) => names.filter((name) => !bound.has(name))

  return [
    [missing(['list']), '@opensaas/stack-core'] as const,
    [missing(Object.keys(coreFields)), '@opensaas/stack-core/fields'] as const,
  ]
    .filter(([names]) => names.length > 0)
    .map(([names, specifier]) => `import { ${names.join(', ')} } from '${specifier}'`)
    .join('\n')
}

const scratchRoot = mkdtempSync(path.join(packageRoot, 'tests', 'tmp-emitted-'))

afterAll(() => {
  rmSync(scratchRoot, { recursive: true, force: true })
})

/**
 * Evaluate the emitted list declarations. They import `@opensaas/stack-core`
 * and the field packages by name, so they are written into this package and
 * loaded through jiti — the same loader `loadOpenSaasConfig` runs a real
 * project's config through.
 */
async function evaluateLists(
  name: string,
  configUpdates: string,
): Promise<Record<string, unknown>> {
  const body = listDeclarations(configUpdates)
  if (body === null) return {}

  const dir = path.join(scratchRoot, name.replace(/[^a-z0-9]+/gi, '-'))
  mkdirSync(dir, { recursive: true })
  const file = path.join(dir, 'lists.ts')
  const imports = resolvableImports(configUpdates)
  writeFileSync(
    file,
    `${imports.join('\n')}
${hostPrelude(imports)}

export const lists = {
${body}
}
`,
    'utf8',
  )

  const jiti = createJiti(dir, { interopDefault: true, moduleCache: false })
  const module = await jiti.import<{ lists: Record<string, unknown> }>(file)
  return module.lists
}

/**
 * Wire up the other side of every relationship whose target list the feature
 * does not declare itself — which is what each emitted config tells the user
 * to do in prose ("Add the other side of each relationship", "give the
 * auto-generated User list the other side via extendUserList"). Mechanical, so
 * it cannot paper over a bad shape *between two declared lists*: the Post↔Tag
 * many-to-many that #1424's review caught is exactly that case.
 */
function withOppositeEnds(declared: Record<string, unknown>): Record<string, ListConfig> {
  const lists = { ...declared } as Record<string, ListConfig>
  const added: Record<string, Record<string, unknown>> = {}

  for (const [listKey, listConfig] of Object.entries(declared as Record<string, ListConfig>)) {
    for (const [fieldKey, field] of Object.entries(listConfig.fields ?? {})) {
      if (field?.type !== 'relationship') continue
      const ref = (field as { ref?: string }).ref
      const [targetList, targetField] = (ref ?? '').split('.')
      if (!targetList || targetList in lists) continue

      added[targetList] ??= {}
      if (targetField !== undefined) {
        added[targetList][targetField] = coreFields.relationship({
          ref: `${listKey}.${fieldKey}`,
          many: (field as { many?: boolean }).many !== true,
        })
      }
    }
  }

  for (const [listKey, fields] of Object.entries(added)) {
    lists[listKey] = list({ fields }) as ListConfig
  }
  return lists
}

/** Every refusal the CLI collects before it writes anything, in `generate`'s order. */
function refusals(config: OpenSaasConfig): string[] {
  const messages = [
    ...validateConfigFields(config).map((error) => error.message),
    ...validateNeedsDeclarations(config).map((error) => error.message),
    ...validateDatabaseConfig(config).map((refusal) => refusal.message),
    ...validateRelations(config).map((refusal) => refusal.message),
  ]
  if (messages.length > 0) return messages

  try {
    deriveContract(config)
  } catch (err) {
    return [`deriveContract: ${err instanceof Error ? err.message : String(err)}`]
  }
  return []
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) return sourceFiles(full)
    return full.endsWith('.ts') && !full.endsWith('.test.ts') ? [full] : []
  })
}

describe('the code the feature wizard emits', () => {
  it.each(CASES)('parses as TypeScript for $name', ({ name, implementation }) => {
    const sources = [
      asModule(implementation.configUpdates),
      ...implementation.files
        .filter((file) => file.language === 'typescript' || file.language === 'tsx')
        .map((file) => file.content),
    ]

    expect(sources.flatMap((source, index) => parseErrors(`${name}-${index}`, source))).toEqual([])
  })

  it.each(CASES)('names no dead config key or command for $name', ({ implementation }) => {
    const offenders = emittedStrings(implementation).flatMap((emitted) =>
      DEAD_SURFACE.flatMap(({ pattern, fix }) =>
        (emitted.match(pattern) ?? []).map((hit) => `${hit} — ${fix}`),
      ),
    )

    expect(offenders).toEqual([])
  })

  /**
   * Parsing is not loading: the config that shipped an implicit many-to-many
   * (#1424) parsed cleanly and named no dead token. What actually decides
   * whether a user can use the emitted config is the chain `opensaas generate`
   * runs before it writes anything — `validateConfigFields`,
   * `validateNeedsDeclarations`, `validateDatabaseConfig`, `validateRelations`,
   * then `deriveContract`. That chain runs here, over the *evaluated* list
   * declarations, for every case that declares lists.
   *
   * What is NOT evaluated: a top-level `plugins` or `storage` block, whose
   * packages (`@opensaas/stack-auth`, the storage providers) are not on this
   * package's dependency graph. The `authentication` case declares no lists at
   * all and so contributes only the assertion below that it declares none.
   */
  it.each(CASES)(
    'loads — passes the CLI’s pre-write validation for $name',
    async ({ name, implementation }) => {
      const declared = await evaluateLists(name, implementation.configUpdates)
      if (Object.keys(declared).length === 0) {
        expect(listDeclarations(implementation.configUpdates)).toBeNull()
        return
      }

      // A field builder where a list belongs evaluates fine and then validates
      // clean, because every validator skips a list with no `fields`. Naming it
      // here is what keeps that from passing as coverage.
      expect(
        Object.entries(declared)
          .filter(
            ([, value]) => !(typeof value === 'object' && value !== null && 'fields' in value),
          )
          .map(([key]) => `lists.${key} is not a list({ … })`),
      ).toEqual([])

      const config = (await defineConfig({
        db: { provider: 'postgresql' },
        lists: withOppositeEnds(declared),
      })) as OpenSaasConfig

      expect(refusals(config)).toEqual([])
    },
  )

  it('declares the Postgres-only db block', () => {
    for (const { name, implementation } of CASES) {
      if (!name.startsWith('authentication')) continue
      expect(implementation.configUpdates).toContain("db: {\n    provider: 'postgresql',\n  }")
    }
  })
})

/**
 * The "before" half of the Keystone migration diff is the one legitimate
 * spelling of the old surface in this tree, so it — and only it — is cut out
 * before the sweep. The rest of the file it lives in stays covered.
 */
function withoutKeystoneBeforeHalves(text: string): string {
  return text.replace(/^[ \t]*\/\/ Before\b[\s\S]*?(?=^[ \t]*\/\/ After\b)/gm, '')
}

describe('the guidance the MCP server serves', () => {
  it('names no dead config key or command outside the Keystone before/after diff', () => {
    const offenders = sourceFiles(mcpSrc).flatMap((file) => {
      const text = withoutKeystoneBeforeHalves(readFileSync(file, 'utf8'))
      return DEAD_SURFACE.flatMap(({ pattern, fix }) =>
        (text.match(pattern) ?? []).map((hit) => `${path.relative(mcpSrc, file)}: ${hit} — ${fix}`),
      )
    })

    expect(offenders).toEqual([])
  })
})
