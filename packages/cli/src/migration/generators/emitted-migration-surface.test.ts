import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createJiti } from 'jiti'
import ts from 'typescript'
import { afterAll, describe, expect, it } from 'vitest'
import { MigrationGenerator } from './migration-generator.js'
import type { MigrationOutput, MigrationSession } from '../types.js'
// Core is reached through its source, not its package name: `@opensaas/stack-core`
// resolves to `dist`, and this suite must run against the tree it is testing.
import { config as defineConfig, list } from '../../../../core/src/config/index.js'
import * as coreFields from '../../../../core/src/fields/index.js'
import { deriveContract } from '../../../../core/src/contract/index.js'
import { validateConfigFields } from '../../../../core/src/validation/field-config.js'
import { validateNeedsDeclarations } from '../../../../core/src/validation/needs-closure.js'
import { validateDatabaseConfig } from '../../../../core/src/validation/database-config.js'
import { validateRelations } from '../../../../core/src/validation/relations.js'
import type { ListConfig, OpenSaasConfig } from '../../../../core/src/config/types.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const packageRoot = path.resolve(here, '../../..')

/**
 * The Prisma 7 configuration surface the stack no longer accepts, and the
 * commands that went with it — the same classes `emitted-prisma-surface.test.ts`
 * sweeps for the feature wizard (#1423), reached here through the migration
 * assistant instead (#1425).
 */
const DEAD_SURFACE: Array<{ pattern: RegExp; fix: string }> = [
  { pattern: /prismaClientConstructor/g, fix: 'the runtime builds its own client' },
  { pattern: /@prisma\/adapter-[a-z0-9-]+/g, fix: 'driver adapters are gone' },
  { pattern: /provider:\s*'(?!postgresql')[a-z0-9]+'/g, fix: "db.provider is 'postgresql' only" },
  { pattern: /joinTableNaming/g, fix: 'db.joinTableNaming does not exist' },
  { pattern: /\bdb:push\b/g, fix: '`opensaas dev` reconciles; `opensaas db update` promotes' },
  {
    pattern: /\bprisma db push\b/g,
    fix: '`opensaas dev` reconciles; `opensaas db update` promotes',
  },
]

function emittedStrings(output: MigrationOutput): string[] {
  return [
    output.configContent,
    ...output.files.map((file) => file.content),
    ...output.steps,
    ...output.warnings,
    ...output.dependencies,
  ]
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

/** The body of the emitted `lists: { ... }` block, as source text, or `null` if it declares none. */
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
      found = node.initializer.getText(file).slice(1, -1)
    }
    ts.forEachChild(node, visit)
  }
  visit(file)

  return found
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

/**
 * `@opensaas/stack-cli`'s own dependency graph, which is what the emitted
 * module can resolve when evaluated from inside this package. An import of
 * anything else (`@opensaas/stack-auth`, say, for the auth-enabled cases) feeds
 * the top-level `plugins` block, not a list field, and is dropped along with it.
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

function resolvableImports(configContent: string): string[] {
  return configContent
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
 * A name the emitted lists reference but no import supplies — `list` and the
 * field builders, which the module always imports for itself, so this exists
 * only for parity with the feature suite's evaluation strategy rather than
 * assuming the emitted shape forever.
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

/**
 * Everything the emitted module declares before `export default config(` —
 * its imports and the `isOwner` access helper, when `models_with_owner`
 * triggers one. The `lists` block references `isOwner` by name, so it must be
 * in scope for evaluation exactly as it is in the real config file.
 */
function prelude(configContent: string): string[] {
  const cutoff = configContent.indexOf('export default config(')
  const text = cutoff >= 0 ? configContent.slice(0, cutoff) : configContent
  return text.split('\n')
}

// Scratch files live inside the package (not os.tmpdir()) so jiti's module
// resolution for `@opensaas/stack-core` walks up to this package's own
// node_modules, exactly as it does for a real project's config.
const scratchRoot = mkdtempSync(path.join(packageRoot, 'tests', 'tmp-migration-surface-'))

afterAll(() => {
  rmSync(scratchRoot, { recursive: true, force: true })
})

async function evaluateLists(
  name: string,
  configContent: string,
): Promise<Record<string, unknown>> {
  const body = listsProperty(configContent)
  if (body === null || entryCount(body) === 0) return {}

  const dir = path.join(scratchRoot, name.replace(/[^a-z0-9]+/gi, '-'))
  mkdirSync(dir, { recursive: true })
  const file = path.join(dir, 'lists.ts')
  const preludeLines = prelude(configContent)
  const importLines = preludeLines.filter((line) => line.startsWith('import '))
  const nonImportLines = preludeLines.filter((line) => !line.startsWith('import '))
  const imports = resolvableImports(importLines.join('\n'))
  writeFileSync(
    file,
    `${imports.join('\n')}
${hostPrelude(imports)}

${nonImportLines.join('\n')}

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
 * A relationship's target list is not always declared in this output: when
 * `enable_auth` + `skip_auth_models` drop the introspected `User` list, the
 * auth plugin injects its own `User` list at real generate-time (CLAUDE.md's
 * documented pattern) — this evaluation never runs plugins, so a minimal
 * stand-in closes the same gap here. It carries no fields of its own; the
 * framework's synthetic back-relation is enough to make a list-only ref
 * resolve.
 */
function withStandInTargets(declared: Record<string, unknown>): Record<string, ListConfig> {
  const lists = { ...declared } as Record<string, ListConfig>
  const missing = new Set<string>()

  for (const listConfig of Object.values(lists)) {
    for (const field of Object.values(listConfig.fields ?? {})) {
      if (field?.type !== 'relationship') continue
      const targetList = (field as { ref?: string }).ref?.split('.')[0]
      if (targetList !== undefined && !(targetList in lists)) missing.add(targetList)
    }
  }

  for (const listKey of missing) {
    lists[listKey] = list({ fields: {} }) as ListConfig
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

function projectDir(name: string): string {
  const dir = path.join(scratchRoot, name)
  mkdirSync(path.join(dir, 'prisma'), { recursive: true })
  return dir
}

/**
 * A representative schema, not an exhaustive one: an enum (→ `select()`), a
 * required/optional/unique scalar, a `Decimal` carrying `@db.Decimal(p, s)`, a
 * `Float` (→ the decimal.js warning), and a many-to-one relationship declared
 * the way Prisma's own generator writes it. `author` deliberately has no
 * matching `posts Post[]` back-reference on `User` and no `authorId` scalar
 * line: the regex introspector's back-reference matching and its handling of
 * a bare `Model[]` field with no `@relation` of its own are pre-existing,
 * unrelated defects (see the Prisma back-reference limits noted in
 * `PrismaIntrospector`), not the dead Prisma 7 surface this suite exists to
 * catch — exercising them here would make failures here ambiguous.
 */
const FULL_SCHEMA = `datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum Role {
  ADMIN
  USER
}

model User {
  id    String @id @default(cuid())
  email String @unique
  name  String?
  role  Role   @default(USER)
}

model Post {
  id        String  @id @default(cuid())
  title     String
  content   String?
  published Boolean @default(false)
  views     Int     @default(0)
  price     Decimal @db.Decimal(10, 2)
  weight    Float
  author    User    @relation(fields: [authorId], references: [id])
}
`

const fullSchemaDir = projectDir('full-schema')
writeFileSync(path.join(fullSchemaDir, 'prisma', 'schema.prisma'), FULL_SCHEMA, 'utf8')

const noSchemaDir = projectDir('no-schema')

function prismaSession(
  name: string,
  cwd: string,
  answers: Record<string, string | boolean | string[]>,
): { name: string; session: MigrationSession } {
  return {
    name,
    session: {
      id: name,
      projectType: 'prisma',
      analysis: { projectTypes: ['prisma'], cwd },
      currentQuestionIndex: 0,
      answers,
      isComplete: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  }
}

const CASES = [
  prismaSession('public-read-auth-write', fullSchemaDir, {
    db_provider: 'postgresql',
    enable_auth: false,
    default_access: 'public-read-auth-write',
  }),
  prismaSession('authenticated-only', fullSchemaDir, {
    db_provider: 'postgresql',
    enable_auth: false,
    default_access: 'authenticated-only',
  }),
  prismaSession('owner-only', fullSchemaDir, {
    db_provider: 'postgresql',
    enable_auth: false,
    default_access: 'owner-only',
  }),
  prismaSession('admin-only', fullSchemaDir, {
    db_provider: 'postgresql',
    enable_auth: false,
    default_access: 'admin-only',
  }),
  prismaSession('owner-model-access', fullSchemaDir, {
    db_provider: 'postgresql',
    enable_auth: false,
    default_access: 'public-read-auth-write',
    models_with_owner: ['Post'],
  }),
  // `skip_auth_models` drops the introspected User/Account/Session/Verification
  // lists so they don't collide with the auth plugin's own — the wizard's
  // documented answer for this combination, not something this suite invents.
  prismaSession('auth-email-password', fullSchemaDir, {
    db_provider: 'postgresql',
    enable_auth: true,
    auth_methods: ['email-password'],
    skip_auth_models: true,
  }),
  prismaSession('auth-all-methods', fullSchemaDir, {
    db_provider: 'postgresql',
    enable_auth: true,
    auth_methods: ['email-password', 'magic-link', 'google', 'github'],
    skip_auth_models: true,
  }),
  prismaSession('custom-admin-path', fullSchemaDir, {
    db_provider: 'postgresql',
    enable_auth: false,
    admin_base_path: '/dashboard',
  }),
  // A stale `db_provider` answer from before the wizard narrowed its options
  // to Postgres-only must not resurrect a dead provider in the output.
  prismaSession('stale-non-postgres-answer', fullSchemaDir, {
    db_provider: 'sqlite',
    enable_auth: false,
  }),
  prismaSession('missing-schema-file', noSchemaDir, {
    db_provider: 'postgresql',
    enable_auth: false,
  }),
  {
    name: 'nextjs-no-schema',
    session: {
      id: 'nextjs-no-schema',
      projectType: 'nextjs',
      analysis: { projectTypes: ['nextjs'], cwd: noSchemaDir },
      currentQuestionIndex: 0,
      answers: { db_provider: 'postgresql', enable_auth: false },
      isComplete: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    } satisfies MigrationSession,
  },
] as const

const generator = new MigrationGenerator()
const OUTPUTS = new Map<string, Promise<MigrationOutput>>(
  CASES.map(({ name, session }) => [name, generator.generate(session)]),
)

describe('the config the migration assistant emits', () => {
  it.each(CASES)('parses as TypeScript for $name', async ({ name }) => {
    const output = await OUTPUTS.get(name)!
    expect(parseErrors(name, output.configContent)).toEqual([])
  })

  it.each(CASES)('names no dead config key or command for $name', async ({ name }) => {
    const output = await OUTPUTS.get(name)!
    const offenders = emittedStrings(output).flatMap((emitted) =>
      DEAD_SURFACE.flatMap(({ pattern, fix }) =>
        (emitted.match(pattern) ?? []).map((hit) => `${hit} — ${fix}`),
      ),
    )
    expect(offenders).toEqual([])
  })

  it.each(CASES)('declares the Postgres-only db block for $name', async ({ name }) => {
    const output = await OUTPUTS.get(name)!
    expect(output.configContent).toContain(`db: {
      provider: 'postgresql',
    },`)
  })

  /**
   * Parsing is not loading: a config naming a removed field or an unloadable
   * relation still parses cleanly. What decides whether a user can use the
   * emitted config is the chain `opensaas generate` runs before it writes
   * anything — the same chain `emitted-prisma-surface.test.ts` runs for the
   * feature wizard. It runs here, over the evaluated list declarations, for
   * every case that declares lists; the two schema-less cases contribute only
   * the assertion that they declare none.
   */
  it.each(CASES)('loads — passes the CLI’s pre-write validation for $name', async ({ name }) => {
    const output = await OUTPUTS.get(name)!
    const declared = await evaluateLists(name, output.configContent)

    if (Object.keys(declared).length === 0) {
      const body = listsProperty(output.configContent)
      expect(body === null || entryCount(body) === 0).toBe(true)
      return
    }

    const config = (await defineConfig({
      db: { provider: 'postgresql' },
      lists: withStandInTargets(declared) as OpenSaasConfig['lists'],
    })) as OpenSaasConfig

    expect(refusals(config)).toEqual([])
  })

  it('names Post and User for the schema-driven cases', async () => {
    const output = await OUTPUTS.get('public-read-auth-write')!
    const declared = await evaluateLists('names-post-and-user', output.configContent)
    expect(Object.keys(declared).sort()).toEqual(['Post', 'User'])
  })
})

/**
 * The Keystone path emits a targeted migration guide (prose plus diffs), not a
 * config module — there is no `lists` block to evaluate, so this side of the
 * suite is the dead-surface sweep plus the specific strings the guide must and
 * must not carry, mirroring the second describe block in
 * `emitted-prisma-surface.test.ts` for the MCP server's own static guidance.
 */
const keystoneNoSchemaDir = projectDir('keystone-no-schema')

function keystoneSession(
  name: string,
  cwd: string,
  answers: Record<string, string | boolean | string[]>,
): { name: string; session: MigrationSession } {
  return {
    name,
    session: {
      id: name,
      projectType: 'keystone',
      analysis: { projectTypes: ['keystone'], cwd },
      currentQuestionIndex: 0,
      answers,
      isComplete: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  }
}

const keystoneBasicDir = projectDir('keystone-basic')
writeFileSync(
  path.join(keystoneBasicDir, 'keystone.config.ts'),
  `export default {
  db: { provider: 'postgresql' },
  lists: {
    Post: {
      fields: {
        title: { type: 'text' },
      },
    },
  },
}
`,
  'utf8',
)

const keystoneFullDir = projectDir('keystone-full')
writeFileSync(
  path.join(keystoneFullDir, 'keystone.config.ts'),
  `export default {
  db: { provider: 'sqlite' },
  lists: {
    Post: {
      fields: {
        title: { type: 'text' },
        tags: { type: 'relationship', many: true, ref: 'Tag.posts' },
        fullName: { type: 'virtual' },
      },
    },
    Tag: {
      fields: {
        name: { type: 'text' },
        posts: { type: 'relationship', many: true, ref: 'Post.tags' },
      },
    },
  },
}
`,
  'utf8',
)

const KEYSTONE_CASES = [
  keystoneSession('keystone-basic', keystoneBasicDir, {
    db_provider: 'postgresql',
    enable_auth: false,
  }),
  keystoneSession('keystone-full', keystoneFullDir, {
    db_provider: 'postgresql',
    enable_auth: true,
    auth_methods: ['email-password', 'magic-link', 'google', 'github'],
  }),
  keystoneSession('keystone-no-config-found', keystoneNoSchemaDir, {
    db_provider: 'postgresql',
    enable_auth: false,
  }),
] as const

const KEYSTONE_OUTPUTS = new Map<string, Promise<MigrationOutput>>(
  KEYSTONE_CASES.map(({ name, session }) => [name, generator.generate(session)]),
)

describe('the guide the migration assistant emits for a Keystone project', () => {
  it.each(KEYSTONE_CASES)('names no dead config key or command for $name', async ({ name }) => {
    const output = await KEYSTONE_OUTPUTS.get(name)!
    const offenders = emittedStrings(output).flatMap((emitted) =>
      DEAD_SURFACE.flatMap(({ pattern, fix }) =>
        (emitted.match(pattern) ?? []).map((hit) => `${hit} — ${fix}`),
      ),
    )
    expect(offenders).toEqual([])
  })

  it('shows the Postgres-only db block with no adapter or client constructor', async () => {
    const output = await KEYSTONE_OUTPUTS.get('keystone-basic')!
    expect(output.configContent).toContain(`db: {
  provider: 'postgresql',
},`)
    expect(output.configContent).not.toContain('prismaClientConstructor')
  })

  it('replaces the many-to-many guidance with a junction-list example that evaluates', async () => {
    const output = await KEYSTONE_OUTPUTS.get('keystone-full')!
    expect(output.configContent).toContain('### Many-to-Many Relationships')
    expect(output.configContent).not.toContain('joinTableNaming')

    // The fenced block is exactly one `PostTag: list({ ... }),` property
    // assignment — embed it in an object literal alongside the Post/Tag
    // lists it references, and load the whole thing exactly as the CLI's
    // own pre-write validation would.
    const match = output.configContent.match(/```typescript\n(PostTag:[\s\S]*?)\n```/)
    expect(match).not.toBeNull()

    const dir = path.join(scratchRoot, 'keystone-full-junction')
    mkdirSync(dir, { recursive: true })
    const file = path.join(dir, 'lists.ts')
    writeFileSync(
      file,
      `import { list } from '@opensaas/stack-core'
import { relationship } from '@opensaas/stack-core/fields'

export const lists = {
  Post: list({ fields: { tags: relationship({ ref: 'PostTag.post', many: true }) } }),
  Tag: list({ fields: { posts: relationship({ ref: 'PostTag.tag', many: true }) } }),
  ${match![1]}
}
`,
      'utf8',
    )

    const jiti = createJiti(dir, { interopDefault: true, moduleCache: false })
    const module = await jiti.import<{ lists: Record<string, unknown> }>(file)
    expect(Object.keys(module.lists).sort()).toEqual(['Post', 'PostTag', 'Tag'])

    const config = (await defineConfig({
      db: { provider: 'postgresql' },
      lists: module.lists as OpenSaasConfig['lists'],
    })) as OpenSaasConfig
    expect(refusals(config)).toEqual([])
  })

  it('warns when the introspected provider is not Postgres, and the guide still targets Postgres', async () => {
    const output = await KEYSTONE_OUTPUTS.get('keystone-full')!
    expect(output.warnings.some((w) => w.includes('sqlite') && w.includes('Postgres'))).toBe(true)
    expect(output.configContent).toContain("provider: 'postgresql'")
  })

  it('still returns a guide when no Keystone config is found', async () => {
    const output = await KEYSTONE_OUTPUTS.get('keystone-no-config-found')!
    expect(output.configContent).toContain('# KeystoneJS → OpenSaaS Stack: What to Change')
  })
})
