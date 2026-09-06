import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { deriveContract } from '../../core/src/contract/index.js'
import type { EmittedContract } from '../../core/src/contract/index.js'
import type { OpenSaasConfig } from '../../core/src/config/types.js'
import { blogConfig, ragConfig } from '../../core/tests/fixtures/contract-configs.js'
import { writeContractModule } from '../src/generator/contract-module.js'
import { emitContract } from '../src/generator/contract-emit.js'
import { writePrismaConfig } from '../src/generator/prisma-config.js'

/**
 * The real `prisma contract emit`, over a project on disk. This is the test
 * that would catch a rendered module the toolchain rejects — a purity
 * violation, a validation failure, a builder call spelled for the wrong
 * release. The equivalence test evaluates the module in-process; only this one
 * proves the CLI can read it.
 *
 * The project lives inside this package so node resolution reaches its
 * `node_modules` for `prisma`, `@prisma/orm-postgres` and each declared pack.
 */
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const scratchRoot = fs.mkdtempSync(path.join(packageRoot, 'tests', 'tmp-emit-'))

afterAll(() => {
  fs.rmSync(scratchRoot, { recursive: true, force: true })
})

async function emit(name: string, config: OpenSaasConfig): Promise<EmittedContract> {
  const cwd = path.join(scratchRoot, name)
  fs.mkdirSync(path.join(cwd, 'prisma'), { recursive: true })

  const data = deriveContract(config)
  writeContractModule(data, path.join(cwd, 'prisma', 'contract.ts'))
  writePrismaConfig(data, path.join(cwd, 'prisma.config.ts'), {
    contractModule: './prisma/contract.ts',
    outputDir: './prisma',
  })

  await emitContract(cwd, path.join(cwd, 'prisma'))

  expect(fs.existsSync(path.join(cwd, 'prisma', 'contract.d.ts'))).toBe(true)
  return JSON.parse(fs.readFileSync(path.join(cwd, 'prisma', 'contract.json'), 'utf-8'))
}

describe('prisma contract emit — the blog fixture', () => {
  let emitted: EmittedContract

  beforeAll(async () => {
    emitted = await emit('blog', blogConfig)
  }, 180_000)

  test('emits every model the config declares', () => {
    expect(Object.keys(emitted.domain.namespaces.public.models).sort()).toEqual([
      'Category',
      'Post',
      'Settings',
      'User',
    ])
  })

  test('emits the one-to-many with its cardinality and key columns on both sides', () => {
    expect(emitted.domain.namespaces.public.models.Post.relations.author).toMatchObject({
      to: { namespace: 'public', model: 'User' },
      cardinality: 'N:1',
      on: { localFields: ['authorId'], targetFields: ['id'] },
    })
    expect(emitted.domain.namespaces.public.models.User.relations.posts).toMatchObject({
      to: { namespace: 'public', model: 'Post' },
      cardinality: '1:N',
    })
  })

  test('emits the synthetic back-relation a list-only ref creates', () => {
    expect(
      emitted.domain.namespaces.public.models.Category.relations.from_Post_category,
    ).toMatchObject({ to: { model: 'Post' }, cardinality: '1:N' })
  })

  test('emits the unique constraints the config declares', () => {
    const uniques = emitted.storage.namespaces.public.entries.table.User.uniques
    expect(uniques.map((unique) => unique.columns)).toContainEqual(['email'])
  })

  test('adopts the db.indexes name verbatim', () => {
    const table = emitted.storage.namespaces.public.entries.table.Post
    const indexes = (table as unknown as { indexes: { name?: string; columns: string[] }[] })
      .indexes
    // The declared name is the exact physical name, with no content-hash
    // suffix and no `prefix` — unlike the derived per-column indexes beside it.
    expect(indexes).toContainEqual({
      name: 'post_author_status',
      columns: ['author', 'status'],
      unique: false,
    })
  })

  test('declares no extension packs', () => {
    expect((emitted as unknown as { extensions?: unknown }).extensions).toEqual(expect.anything())
    const extensions = (emitted as unknown as { extensions: Record<string, unknown> }).extensions
    expect(Object.keys(extensions)).toEqual([])
  })
})

describe('prisma contract emit — the pgvector fixture', () => {
  let emitted: EmittedContract

  beforeAll(async () => {
    emitted = await emit('rag', ragConfig)
  }, 180_000)

  test('emits the model and its extension-typed column', () => {
    expect(Object.keys(emitted.domain.namespaces.public.models)).toEqual(['Document'])
    const columns = (
      emitted.storage.namespaces.public.entries.table.Document as unknown as {
        columns: Record<string, { nativeType: string }>
      }
    ).columns
    expect(columns.embedding.nativeType).toContain('vector')
  })

  test('declares the pgvector pack', () => {
    const extensions = (emitted as unknown as { extensions: Record<string, unknown> }).extensions
    expect(Object.keys(extensions)).toContain('pgvector')
  })
})
