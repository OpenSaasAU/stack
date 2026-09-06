import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Pool } from 'pg'
import { createPostgresControlClient } from '@prisma/orm-postgres/control'
import postgres from '@prisma/orm-postgres/runtime'
import type { PostgresClient } from '@prisma/orm-postgres/runtime'
import type { SqlMiddleware } from '@prisma/orm-postgres/family-runtime'
import type { AccessControlledDB, Session } from '../access/index.js'
import type { OrmClient } from '../access/types.js'
import type { OpenSaasConfig } from '../config/types.js'
import { buildPrismaContract, toEmittedContract, type PrismaContract } from '../contract/prisma.js'
import { deriveContract } from '../contract/derive.js'
import type { ContractData } from '../contract/types.js'
import { getContext } from '../context/index.js'
import { getDbKey } from '../lib/case-utils.js'
import { originTripwire } from '../origin.js'
import type { StackContext } from '../types/context.js'
import { ESCAPE_VARIABLE, requireUsableDatabaseEscape } from './escape.js'
import {
  contractPacks,
  loadExtensionPacks,
  type ExtensionControlDescriptor,
  type ExtensionRuntimeDescriptor,
  type LoadedExtensionPacks,
} from './extensions.js'

/**
 * Every pack this harness knows how to make available on the in-process
 * database, keyed by the binding name `db.extensions` spells. PGlite loads its
 * extensions at construction, so a pack the map does not name reaches
 * `CREATE EXTENSION` with nothing to install.
 */
const DEV_DATABASE_EXTENSIONS: Record<string, 'vector'> = { pgvector: 'vector' }

/** Options for {@link createTestDatabase} and {@link createTestContext}. */
export interface TestDatabaseOptions {
  /**
   * Already-loaded extension packs, by binding name. Pass these when a
   * declared pack is not resolvable from `@opensaas/stack-core` itself; any
   * pack not named here is imported from its own package.
   */
  packs?: LoadedExtensionPacks
  /**
   * Extra middleware registered after the tripwire — a
   * {@link createPlanRecorder} recorder, typically. The tripwire is always
   * first and is never omitted.
   */
  middleware?: readonly SqlMiddleware[]
}

/** A stood-up database, its client, and the contexts built over it. */
export interface TestDatabase {
  /** The connection string this instance is bound to. */
  readonly url: string
  /** `'pglite'` for the in-process dev database, `'escape'` for `DATABASE_URL`. */
  readonly provenance: 'pglite' | 'escape'
  /** The built contract the schema was applied from. */
  readonly contract: PrismaContract
  /** The derived contract data, for a test that needs the models it declares. */
  readonly data: ContractData
  /**
   * The Prisma 8 client the contexts are built over — the construction option
   * itself, not a seam on the secured wrapper. Its queries run under the
   * tripwire like every other, so a call must enter an origin
   * (`withOrigin('unsafe', …)`) or be refused.
   */
  readonly client: PostgresClient<PrismaContract>
  /** A real, fully secured context over this database, at `session`. */
  context(session?: Session | null): StackContext<AccessControlledDB>
  /** Empty every table the contract declares, restarting identity sequences. */
  truncate(): Promise<void>
  /** Close the client, drop the instance, and remove its temporary files. */
  close(): Promise<void>
}

/** What {@link createTestContext} returns: a {@link TestDatabase} and one context. */
export interface TestContext extends Omit<TestDatabase, 'context'> {
  /** The secured context at the session `createTestContext` was called with. */
  readonly context: StackContext<AccessControlledDB>
}

function isCollection(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function reach(container: unknown, key: string): unknown {
  return isCollection(container) && key in container ? Reflect.get(container, key) : undefined
}

/**
 * The client's collections, keyed the way {@link ormModel} looks them up.
 *
 * A Prisma 8 client exposes its collections at `orm.<namespace>.<Model>` while
 * the engine reaches a model by db key; this is the same reconciliation the
 * generated context performs, in one place, until the runtime spec makes it
 * unnecessary.
 */
function ormClientFor(data: ContractData, client: PostgresClient<PrismaContract>): OrmClient {
  const models: Record<string, unknown> = {}
  for (const model of data.models) {
    const namespace = reach(client.orm, model.namespace ?? 'public')
    models[getDbKey(model.name)] = reach(namespace, model.name)
  }
  return models
}

function qualified(data: ContractData): string[] {
  return data.models.map((model) => {
    const namespace = model.namespace ?? 'public'
    return `"${namespace}"."${model.table ?? model.name}"`
  })
}

async function pgModule(): Promise<Pick<typeof import('pg'), 'Client' | 'Pool'>> {
  return (await import('pg')).default
}

async function onClient(url: string, statement: string): Promise<void> {
  const pg = await pgModule()
  const client = new pg.Client({ connectionString: url })
  await client.connect()
  try {
    await client.query(statement)
  } finally {
    await client.end()
  }
}

function withDatabase(url: string, name: string): string {
  const parsed = new URL(url)
  parsed.pathname = `/${name}`
  return parsed.href
}

async function seedContractSpaces(
  migrationsDir: string,
  extensions: readonly ExtensionControlDescriptor[],
): Promise<void> {
  if (extensions.length === 0) return
  const { runContractSpaceSeedPhase } = await import('@prisma/orm-toolchain/cli/control-api')
  await runContractSpaceSeedPhase({ migrationsDir, extensions })
}

/**
 * Thrown when the control client refuses to apply the schema — a server
 * missing a declared extension is the common case, and ADR-0065 leaves that
 * report to Prisma. `assertOk()` would say only "Expected Ok result but got
 * NotOk", so the failure's own payload is carried through here.
 */
export class SchemaApplyError extends Error {
  constructor(
    readonly url: string,
    readonly failure: unknown,
  ) {
    super(
      `The test harness could not apply the schema to ${url}: ${JSON.stringify(failure, null, 2)}`,
    )
    this.name = 'SchemaApplyError'
  }
}

async function applySchema(
  url: string,
  migrationsDir: string,
  contract: PrismaContract,
  extensions: readonly ExtensionControlDescriptor[],
): Promise<void> {
  const control = createPostgresControlClient({ connection: url, extensions })
  try {
    const result = await control.dbUpdate({
      contract: toEmittedContract(contract),
      mode: 'apply',
      migrationsDir,
    })
    if (!result.ok) throw new SchemaApplyError(url, result.failure)
  } finally {
    await control.close()
  }
}

/** The optional peers the in-process database needs, in the order it needs them. */
const DEV_DATABASE_PEERS = [
  '@electric-sql/pglite',
  '@electric-sql/pglite-socket',
  '@electric-sql/pglite-pgvector',
] as const

/**
 * Thrown when the harness falls to the in-process database and one of PGlite's
 * packages is not installed. They are optional peers of core, so a production
 * install carries no WASM Postgres — and a test run without them needs to say
 * which install is missing rather than report a bare module-resolution failure
 * from inside the dev database.
 */
export class DevDatabaseUnavailableError extends Error {
  constructor(readonly cause: unknown) {
    super(
      `The in-process test database could not start: ${cause instanceof Error ? cause.message : String(cause)}. ` +
        `PGlite is an optional peer of @opensaas/stack-core, so install ${DEV_DATABASE_PEERS.join(', ')} ` +
        `as dev dependencies of this package, or set ${ESCAPE_VARIABLE} to a Postgres server and run the ` +
        `suite against that instead.`,
    )
    this.name = 'DevDatabaseUnavailableError'
  }
}

/**
 * A module-resolution failure, wherever it sits in the chain: a loader — and
 * Vitest's module mocker — reports the original as the `cause` of its own
 * error rather than re-throwing it.
 */
function isModuleNotFound(error: unknown): boolean {
  for (let step: unknown = error; step instanceof Error; step = step.cause) {
    if (
      'code' in step &&
      (step.code === 'ERR_MODULE_NOT_FOUND' || step.code === 'MODULE_NOT_FOUND')
    ) {
      return true
    }
  }
  return false
}

interface Instance {
  readonly url: string
  readonly provenance: 'pglite' | 'escape'
  release(): Promise<void>
}

async function startInstance(
  escape: string | undefined,
  extensions: readonly string[],
): Promise<Instance> {
  if (escape !== undefined) {
    const name = `opensaas_test_${randomUUID().replaceAll('-', '')}`
    await onClient(escape, `create database "${name}"`)
    return {
      url: withDatabase(escape, name),
      provenance: 'escape',
      release: async () => {
        await onClient(escape, `drop database if exists "${name}" with (force)`)
      },
    }
  }

  const stateDir = mkdtempSync(path.join(tmpdir(), 'opensaas-test-db-'))
  const loaded = extensions.filter((name): name is 'vector' => name === 'vector')
  let database: Awaited<ReturnType<typeof import('../db/dev-database.js').startDevDatabase>>
  try {
    const { startDevDatabase } = await import('../db/dev-database.js')
    database = await startDevDatabase({
      stateFile: path.join(stateDir, 'dev-db.json'),
      extensions: loaded,
    })
  } catch (error) {
    rmSync(stateDir, { recursive: true, force: true })
    throw isModuleNotFound(error) ? new DevDatabaseUnavailableError(error) : error
  }
  return {
    url: database.url,
    provenance: 'pglite',
    release: async () => {
      await database.stop()
      rmSync(stateDir, { recursive: true, force: true })
    },
  }
}

/**
 * Stand up one database for a test file: derive the contract from `config`,
 * seed every declared pack's Extension contract space, apply the schema once
 * through the control client's `dbUpdate`, and bind a Prisma 8 client to it
 * with the stack's own tripwire installed (ADR-0057, ADR-0063, ADR-0065).
 *
 * Call this once per file in `beforeAll`, {@link TestDatabase.truncate} in
 * `beforeEach`, and {@link TestDatabase.close} in `afterAll`. Tests within a
 * file share the schema and nothing else.
 *
 * With `DATABASE_URL` set to a Postgres server the identical suite runs there
 * instead, in a database of its own that is dropped on close; set to anything
 * else the variable is a misconfiguration and this throws rather than dialling
 * it. PGlite and its socket and pgvector packages are optional peers imported
 * only on the unset path, so a production install carries no WASM Postgres.
 *
 * The tripwire is installed unconditionally, from the same `../origin.js` the
 * generator emits — one copy, so a regression in the Engine stamp fails a test
 * rather than a production login. A query the harness itself issues through
 * {@link TestDatabase.client} is refused unless it enters an origin.
 *
 * Known limits:
 * - The secured surface's terminals arrive in a later spec, so a context built
 *   here is the real engine over a real database but `context.db` cannot yet
 *   execute. Rows go in and come back through {@link TestDatabase.client}
 *   under `withOrigin('unsafe', …)` until then.
 * - PGlite serialises every transaction, so nothing contention-shaped is
 *   observable on the default harness. Those guarantees are escape-only.
 * - Only `pgvector` is mapped to a PGlite extension. A pack outside that map
 *   reaches `CREATE EXTENSION` with nothing installed and the apply fails
 *   naming the missing control file; run it under the escape.
 * - Packs are imported by package name from core's own module. A pack the
 *   consuming package depends on but core cannot resolve must be passed as
 *   `options.packs`.
 * - The escape path issues `CREATE DATABASE` and `DROP DATABASE`, so the role
 *   `DATABASE_URL` names needs `CREATEDB`. A superuser — CI's container, a
 *   local install — has it.
 * - `truncate()` empties the tables the contract declares. It does not touch
 *   Prisma's own marker tables, which the schema apply owns.
 *
 * @example
 * ```typescript
 * let db: TestDatabase
 * beforeAll(async () => { db = await createTestDatabase(config) }, 60_000)
 * afterAll(async () => { await db.close() })
 * beforeEach(async () => { await db.truncate() })
 * ```
 */
export async function createTestDatabase(
  config: OpenSaasConfig,
  options: TestDatabaseOptions = {},
): Promise<TestDatabase> {
  const data = deriveContract(config)
  const packs = await loadExtensionPacks(data.extensions, options.packs)
  const contract = buildPrismaContract(data, { packs: contractPacks(packs) })

  const control: ExtensionControlDescriptor[] = []
  const runtimes: ExtensionRuntimeDescriptor[] = []
  const devExtensions: string[] = []
  for (const extension of data.extensions) {
    const loaded = packs[extension.name]
    control.push(loaded.control)
    runtimes.push(loaded.runtime)
    const available = DEV_DATABASE_EXTENSIONS[extension.name]
    if (available !== undefined) devExtensions.push(available)
  }

  const instance = await startInstance(requireUsableDatabaseEscape(), devExtensions)
  const migrationsDir = mkdtempSync(path.join(tmpdir(), 'opensaas-test-migrations-'))
  let pool: Pool | undefined

  try {
    await seedContractSpaces(migrationsDir, control)
    await applySchema(instance.url, migrationsDir, contract, control)

    const pg = await pgModule()
    pool = new pg.Pool({ connectionString: instance.url, max: 1 })
    const client = postgres<PrismaContract>({
      contract,
      pg: pool,
      verifyMarker: false,
      middleware: [originTripwire, ...(options.middleware ?? [])],
      extensions: runtimes,
    })
    const orm = ormClientFor(data, client)
    const tables = qualified(data)

    let closed = false
    return {
      url: instance.url,
      provenance: instance.provenance,
      contract,
      data,
      client,
      context: (session = null) => getContext(config, orm, session),
      truncate: async () => {
        if (tables.length === 0) return
        await onClient(instance.url, `truncate table ${tables.join(', ')} restart identity cascade`)
      },
      close: async () => {
        if (closed) return
        closed = true
        await client.close()
        await instance.release()
        rmSync(migrationsDir, { recursive: true, force: true })
      },
    }
  } catch (error) {
    await pool?.end().catch(() => {})
    await instance.release().catch(() => {})
    rmSync(migrationsDir, { recursive: true, force: true })
    throw error
  }
}

/**
 * A real, fully secured context over an in-process Postgres — the only double
 * the stack offers (ADR-0057). No test fakes the secured surface: the config
 * is derived to a contract, the schema is applied to a database the harness
 * owns, and the context is the same `getContext` an application gets.
 *
 * This is the single-call form of {@link createTestDatabase}, for a file with
 * one session. A file that needs several sessions, or that truncates between
 * tests, should stand the database up once and call
 * {@link TestDatabase.context} per test — every limit documented on
 * `createTestDatabase` applies here unchanged.
 *
 * @example
 * ```typescript
 * import { createTestContext } from '@opensaas/stack-core/testing'
 *
 * const harness = await createTestContext(config, { userId: 'user-1' })
 * try {
 *   const posts = await harness.context.db.post.findMany()
 * } finally {
 *   await harness.close()
 * }
 * ```
 */
export async function createTestContext(
  config: OpenSaasConfig,
  session: Session | null = null,
  options: TestDatabaseOptions = {},
): Promise<TestContext> {
  const database = await createTestDatabase(config, options)
  return { ...database, context: database.context(session) }
}
