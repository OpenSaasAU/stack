import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createJiti } from 'jiti'
import ts from 'typescript'
import { afterAll, describe, expect, it } from 'vitest'
import { MigrationGenerator } from './migration-generator.js'
import type { MigrationSession } from '../types.js'
// Core is reached through its source, not its package name (see
// `emitted-migration-surface.test.ts` for why): `@opensaas/stack-core`
// resolves to `dist`, and this suite must run against the tree it is testing.
import { config as defineConfig } from '../../../../core/src/config/index.js'
import { deriveContract } from '../../../../core/src/contract/index.js'
import type { OpenSaasConfig } from '../../../../core/src/config/types.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const packageRoot = path.resolve(here, '../../..')

const scratchRoot = mkdtempSync(path.join(packageRoot, 'tests', 'tmp-migration-timestamps-'))

afterAll(() => {
  rmSync(scratchRoot, { recursive: true, force: true })
})

function projectDir(name: string): string {
  const dir = path.join(scratchRoot, name)
  mkdirSync(path.join(dir, 'prisma'), { recursive: true })
  return dir
}

function prismaSession(cwd: string): MigrationSession {
  return {
    id: 'test',
    projectType: 'prisma',
    analysis: { projectTypes: ['prisma'], cwd },
    currentQuestionIndex: 0,
    answers: { db_provider: 'postgresql', enable_auth: false },
    isComplete: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  }
}

/** The body of the emitted `lists: { ... }` block, as source text. */
function listsBody(source: string): string {
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

  if (found === null) throw new Error('no `lists` block in the emitted config')
  return found
}

let evalCounter = 0

/** Load the emitted `lists` block as a real config, and derive its contract. */
async function deriveEmittedContract(configContent: string): Promise<OpenSaasConfig> {
  const dir = path.join(scratchRoot, `eval-${++evalCounter}`)
  mkdirSync(dir, { recursive: true })
  const file = path.join(dir, 'lists.ts')
  writeFileSync(
    file,
    `import { list } from '@opensaas/stack-core'
import { text, timestamp } from '@opensaas/stack-core/fields'

export const lists = {
${listsBody(configContent)}
}
`,
    'utf8',
  )

  const jiti = createJiti(dir, { interopDefault: true, moduleCache: false })
  const module = await jiti.import<{ lists: Record<string, unknown> }>(file)

  const config = (await defineConfig({
    db: { provider: 'postgresql' },
    lists: module.lists as OpenSaasConfig['lists'],
  })) as OpenSaasConfig

  deriveContract(config) // throws on refusal — the same pre-write check `opensaas generate` runs
  return config
}

const generator = new MigrationGenerator()

const AUTO_SHAPE_SCHEMA = `datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model Post {
  id        String   @id @default(cuid())
  title     String
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
`

const CREATED_AT_ONLY_SCHEMA = `datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model Post {
  id        String   @id @default(cuid())
  title     String
  createdAt DateTime @default(now())
}
`

const UPDATED_AT_WITHOUT_ATTRIBUTE_SCHEMA = `datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model Post {
  id        String    @id @default(cuid())
  title     String
  createdAt DateTime  @default(now())
  updatedAt DateTime?
}
`

describe('the migration generator and auto-managed timestamp columns (#1316)', () => {
  it('opts the list into db.timestamps, rather than dropping the columns, when createdAt/updatedAt match the auto shape', async () => {
    const dir = projectDir('auto-shape')
    writeFileSync(path.join(dir, 'prisma', 'schema.prisma'), AUTO_SHAPE_SCHEMA, 'utf8')

    const output = await generator.generate(prismaSession(dir))
    expect(output.configContent).toContain('db: { timestamps: true },')
    expect(output.configContent).not.toMatch(/createdAt:\s*timestamp/)
    expect(output.configContent).not.toMatch(/updatedAt:\s*timestamp/)

    const config = await deriveEmittedContract(output.configContent)
    const timestamps = config.lists.Post.db?.timestamps
    expect(timestamps).toBe(true)
  })

  it('declares createdAt explicitly, rather than dropping it, when the model has no matching updatedAt', async () => {
    const dir = projectDir('createdAt-only')
    writeFileSync(path.join(dir, 'prisma', 'schema.prisma'), CREATED_AT_ONLY_SCHEMA, 'utf8')

    const output = await generator.generate(prismaSession(dir))
    expect(output.configContent).not.toContain('db: { timestamps: true },')
    expect(output.configContent).toMatch(/createdAt:\s*timestamp\(/)

    const config = await deriveEmittedContract(output.configContent)
    expect(Object.prototype.hasOwnProperty.call(config.lists.Post.fields, 'createdAt')).toBe(true)
  })

  it("declares updatedAt explicitly, rather than dropping it, when it doesn't carry @updatedAt", async () => {
    const dir = projectDir('updatedAt-not-auto')
    writeFileSync(
      path.join(dir, 'prisma', 'schema.prisma'),
      UPDATED_AT_WITHOUT_ATTRIBUTE_SCHEMA,
      'utf8',
    )

    const output = await generator.generate(prismaSession(dir))
    expect(output.configContent).not.toContain('db: { timestamps: true },')
    expect(output.configContent).toMatch(/updatedAt:\s*timestamp\(/)

    const config = await deriveEmittedContract(output.configContent)
    expect(Object.prototype.hasOwnProperty.call(config.lists.Post.fields, 'updatedAt')).toBe(true)
  })
})
