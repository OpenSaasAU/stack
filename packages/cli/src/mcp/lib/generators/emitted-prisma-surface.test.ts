import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { FeatureGenerator } from './feature-generator.js'
import { getAllFeatures } from '../features/catalog.js'
import type { Feature, FeatureImplementation, FeatureQuestion } from '../types.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const mcpSrc = path.resolve(here, '../..')

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

  it('declares the Postgres-only db block', () => {
    for (const { name, implementation } of CASES) {
      if (!name.startsWith('authentication')) continue
      expect(implementation.configUpdates).toContain("db: {\n    provider: 'postgresql',\n  }")
    }
  })
})

describe('the guidance the MCP server serves', () => {
  // `documentation-provider.ts` is exempt because the "before" half of its
  // Keystone diff is the one legitimate spelling of the old surface in this
  // tree; the emitted-output assertions above carry the weight for it.
  it('names no dead config key or command outside the Keystone before/after diff', () => {
    const offenders = sourceFiles(mcpSrc)
      .filter((file) => !file.endsWith('documentation-provider.ts'))
      .flatMap((file) => {
        const text = readFileSync(file, 'utf8')
        return DEAD_SURFACE.flatMap(({ pattern, fix }) =>
          (text.match(pattern) ?? []).map(
            (hit) => `${path.relative(mcpSrc, file)}: ${hit} — ${fix}`,
          ),
        )
      })

    expect(offenders).toEqual([])
  })
})
