import { spawnSync } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import { createRequire } from 'module'
import { fileURLToPath } from 'url'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

/**
 * `opensaas db plan` driven as a user drives it, through a baseline and two
 * further changes, then applied with `prisma db migrate` (#2294).
 *
 * Escape-only: it skips visibly unless DATABASE_URL (or DIRECT_DATABASE_URL)
 * names a Postgres, and CI sets that on every job.
 */
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const fixtureConfig = path.join(
  packageRoot,
  'tests',
  'fixtures',
  'db-plan-project',
  'opensaas.config.ts',
)
const cliEntry = path.join(packageRoot, 'bin', 'opensaas.js')

const serverUrl = [process.env.DIRECT_DATABASE_URL, process.env.DATABASE_URL].find(
  (value): value is string => typeof value === 'string' && /^postgres(ql)?:\/\//.test(value),
)

const BOOT = 300_000

const prismaBinary = (() => {
  const require = createRequire(import.meta.url)
  const packageJson = require.resolve('prisma/package.json')
  const manifest: { bin?: string | Record<string, string> } = require(packageJson)
  const entry = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.prisma
  return path.join(path.dirname(packageJson), entry ?? '')
})()

interface Run {
  status: number | null
  output: string
}

describe.skipIf(serverUrl === undefined)(
  serverUrl === undefined
    ? 'opensaas db plan [escape-only: DATABASE_URL/DIRECT_DATABASE_URL names no Postgres]'
    : 'opensaas db plan',
  () => {
    const databaseName = `db_plan_${process.pid}_${Date.now()}`
    let scratchRoot = ''
    let projectDir = ''
    let databaseUrl = ''

    function adminUrl(): string {
      if (serverUrl === undefined) throw new Error('no Postgres named')
      return serverUrl
    }

    function run(args: readonly string[]): Run {
      const env: typeof process.env = {
        ...process.env,
        DATABASE_URL: databaseUrl,
        DIRECT_DATABASE_URL: '',
      }
      const result = spawnSync(process.execPath, [cliEntry, ...args], {
        cwd: projectDir,
        env,
        encoding: 'utf-8',
        timeout: 240_000,
      })
      return { status: result.status, output: `${result.stdout}${result.stderr}` }
    }

    function prisma(args: readonly string[]): Run {
      const result = spawnSync(process.execPath, [prismaBinary, ...args], {
        cwd: projectDir,
        env: { ...process.env, DATABASE_URL: databaseUrl, DIRECT_DATABASE_URL: '' },
        encoding: 'utf-8',
        timeout: 240_000,
      })
      return { status: result.status, output: `${result.stdout}${result.stderr}` }
    }

    function addField(name: string): void {
      const configPath = path.join(projectDir, 'opensaas.config.ts')
      fs.writeFileSync(
        configPath,
        fs
          .readFileSync(configPath, 'utf-8')
          .replace('title: text(),', `title: text(),\n        ${name}: text(),`),
        'utf-8',
      )
    }

    function appPackages(): string[] {
      const appDir = path.join(projectDir, 'migrations', 'app')
      return fs
        .readdirSync(appDir, { withFileTypes: true })
        .filter(
          (entry) =>
            entry.isDirectory() && fs.existsSync(path.join(appDir, entry.name, 'migration.json')),
        )
        .map((entry) => entry.name)
        .sort()
    }

    beforeAll(async () => {
      const admin = new pg.Client({ connectionString: adminUrl() })
      await admin.connect()
      try {
        await admin.query(`create database "${databaseName}"`)
      } finally {
        await admin.end()
      }
      const url = new URL(adminUrl())
      url.pathname = `/${databaseName}`
      databaseUrl = url.toString()

      scratchRoot = fs.mkdtempSync(path.join(packageRoot, 'tests', 'tmp-db-plan-'))
      projectDir = path.join(scratchRoot, 'project')
      fs.mkdirSync(projectDir, { recursive: true })
      fs.copyFileSync(fixtureConfig, path.join(projectDir, 'opensaas.config.ts'))
    }, BOOT)

    afterAll(async () => {
      if (scratchRoot !== '') fs.rmSync(scratchRoot, { recursive: true, force: true })
      if (serverUrl === undefined) return
      const admin = new pg.Client({ connectionString: adminUrl() })
      await admin.connect()
      try {
        await admin.query(`drop database if exists "${databaseName}" with (force)`)
      } finally {
        await admin.end()
      }
    }, BOOT)

    test(
      'plans a baseline and two changes, each from the head the last left, and applies all three',
      () => {
        const generate = (): void => {
          const generated = run(['generate'])
          expect(generated.status, generated.output).toBe(0)
        }

        generate()
        const baseline = run(['db', 'plan', '--name', 'baseline', '--yes'])
        expect(baseline.status, baseline.output).toBe(0)
        expect(appPackages()).toHaveLength(1)

        addField('summary')
        generate()
        const first = run(['db', 'plan', '--name', 'add-summary', '--yes'])
        expect(first.status, first.output).toBe(0)
        expect(appPackages()).toHaveLength(2)

        addField('body')
        generate()
        const second = run(['db', 'plan', '--name', 'add-body', '--yes'])
        expect(second.status, second.output).toBe(0)
        const packages = appPackages()
        expect(packages).toHaveLength(3)

        const manifests = packages.map((dir) => {
          const manifest: unknown = JSON.parse(
            fs.readFileSync(
              path.join(projectDir, 'migrations', 'app', dir, 'migration.json'),
              'utf-8',
            ),
          )
          if (
            typeof manifest !== 'object' ||
            manifest === null ||
            !('to' in manifest) ||
            typeof manifest.to !== 'string'
          ) {
            throw new Error(`${dir} has no "to" hash.`)
          }
          const from = 'from' in manifest && typeof manifest.from === 'string' ? manifest.from : ''
          return { from, to: manifest.to }
        })
        const consumed = new Set<number>()
        const origins = new Set(manifests.map((manifest) => manifest.from))
        const targets = new Set(manifests.map((manifest) => manifest.to))
        const roots = [...origins].filter((from) => !targets.has(from))
        expect(roots, 'the packages share one origin').toHaveLength(1)
        let head = roots[0]
        for (;;) {
          const next = manifests
            .map((manifest, index) => ({ manifest, index }))
            .filter(({ manifest }) => manifest.from === head)
          const step = next[0]
          if (step === undefined) break
          expect(next, `exactly one package leaves ${head}`).toHaveLength(1)
          expect(consumed.has(step.index), 'the chain does not loop').toBe(false)
          consumed.add(step.index)
          head = step.manifest.to
        }
        expect(consumed.size, 'every package is on the chain').toBe(3)

        const migrated = prisma(['db', 'migrate', '--yes'])
        expect(migrated.status, migrated.output).toBe(0)
      },
      BOOT,
    )

    test('the applied schema carries every planned column', async () => {
      const client = new pg.Client({ connectionString: databaseUrl })
      await client.connect()
      try {
        const columns = await client.query(
          `select column_name from information_schema.columns where table_name = 'Note'`,
        )
        const names = columns.rows.map((row: { column_name: string }) => row.column_name)
        expect(names).toEqual(expect.arrayContaining(['title', 'summary', 'body']))
      } finally {
        await client.end()
      }
    })
  },
)
