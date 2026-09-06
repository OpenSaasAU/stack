import { existsSync, readFileSync, readdirSync } from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, test, vi } from 'vitest'
import type { OpenSaasConfig } from '../config/types.js'
import { text } from '../fields/index.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const DIST = path.join(HERE, '..', '..', 'dist', 'testing')

/**
 * Every package this subpath may reach only through a dynamic `import()`:
 * the optional peers, plus the dev database module that pulls them in. A
 * static import of any of them makes `@opensaas/stack-core` unloadable for a
 * production install that carries none of them.
 */
const LAZY_ONLY = [
  '@electric-sql/pglite',
  '@electric-sql/pglite-socket',
  '@electric-sql/pglite-pgvector',
  '@prisma/orm-toolchain',
  'pg',
] as const

function isLazyOnly(specifier: string): boolean {
  if (specifier.endsWith('db/dev-database.js')) return true
  return LAZY_ONLY.some((name) => specifier === name || specifier.startsWith(`${name}/`))
}

function sourcesUnder(dir: string, extension: string, skip: (entry: string) => boolean): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) found.push(...sourcesUnder(full, extension, skip))
    else if (entry.name.endsWith(extension) && !skip(entry.name)) found.push(full)
  }
  return found
}

function eachModuleSpecifier(
  source: string,
  file: string,
  take: (specifier: string, typeOnly: boolean) => void,
): void {
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.ESNext, true)
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      take(node.moduleSpecifier.text, node.importClause?.isTypeOnly === true)
    } else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      take(node.moduleSpecifier.text, node.isTypeOnly)
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      const literal = node.argument.literal
      if (ts.isStringLiteral(literal)) take(literal.text, true)
    }
    ts.forEachChild(node, visit)
  }
  visit(parsed)
}

/**
 * The specifiers a file imports at runtime: every static `import`/`export …
 * from`, in every form the parser accepts, minus the `import type` ones the
 * emit erases. A dynamic `import()` is a call expression, not a declaration,
 * so it never appears here — which is the whole point.
 */
function runtimeSpecifiers(source: string, file: string): string[] {
  const found: string[] = []
  eachModuleSpecifier(source, file, (specifier, typeOnly) => {
    if (!typeOnly) found.push(specifier)
  })
  return found
}

/** Every specifier a declaration file names, type positions included. */
function declaredSpecifiers(source: string, file: string): string[] {
  const found: string[] = []
  eachModuleSpecifier(source, file, (specifier) => found.push(specifier))
  return found
}

const config: OpenSaasConfig = {
  db: { provider: 'postgresql' },
  lists: { Note: { fields: { body: text() } } },
}

describe('the optional peers are reached only lazily', () => {
  test('the scan sees every static import form, and no dynamic one', () => {
    const forms: Record<string, string[]> = {
      'single-line named': [`import { PGlite } from '@electric-sql/pglite'`],
      'multi-line named': [`import {\n  PGlite,\n  type Options,\n} from '@electric-sql/pglite'`],
      'side-effect': [`import '@electric-sql/pglite'`],
      'double-quoted': [`import { PGlite } from "@electric-sql/pglite"`],
      'export … from': [`export { PGlite } from '@electric-sql/pglite'`],
      default: [`import PGlite from '@electric-sql/pglite'`],
      namespace: [`import * as pglite from '@electric-sql/pglite'`],
      subpath: [`import { x } from '@electric-sql/pglite/worker'`],
    }
    for (const [form, [source]] of Object.entries(forms)) {
      expect({ form, caught: runtimeSpecifiers(source, 'sample.ts').some(isLazyOnly) }).toEqual({
        form,
        caught: true,
      })
    }

    const lazy = [
      `const { PGlite } = await import('@electric-sql/pglite')`,
      `import type { Pool } from 'pg'`,
      `export type { Pool } from 'pg'`,
    ].join('\n')
    expect(runtimeSpecifiers(lazy, 'sample.ts').filter(isLazyOnly)).toEqual([])
  })

  test('no module on the subpath statically imports one at runtime', () => {
    const offenders: string[] = []
    for (const file of sourcesUnder(HERE, '.ts', (entry) => entry.endsWith('.test.ts'))) {
      for (const specifier of runtimeSpecifiers(readFileSync(file, 'utf8'), file)) {
        if (isLazyOnly(specifier)) offenders.push(`${path.relative(HERE, file)} -> ${specifier}`)
      }
    }
    expect(offenders).toEqual([])
  })

  const built = existsSync(DIST)
  test.skipIf(!built)(
    built
      ? 'no emitted declaration names one, so a consumer without them still typechecks'
      : 'no emitted declaration names one [skipped: run `pnpm build` first]',
    () => {
      const offenders: string[] = []
      for (const file of sourcesUnder(DIST, '.d.ts', () => false)) {
        for (const specifier of declaredSpecifiers(readFileSync(file, 'utf8'), file)) {
          if (isLazyOnly(specifier)) offenders.push(`${path.relative(DIST, file)} -> ${specifier}`)
        }
      }
      expect(offenders).toEqual([])
    },
  )

  test('a missing PGlite install is reported by name, with both remedies', async () => {
    const escape = process.env.DATABASE_URL
    delete process.env.DATABASE_URL
    vi.doMock('@electric-sql/pglite', () => {
      const error = new Error("Cannot find package '@electric-sql/pglite'")
      Object.assign(error, { code: 'ERR_MODULE_NOT_FOUND' })
      throw error
    })
    vi.resetModules()

    try {
      const { createTestDatabase, DevDatabaseUnavailableError } = await import('./context.js')
      await expect(createTestDatabase(config)).rejects.toThrow(DevDatabaseUnavailableError)
    } finally {
      vi.doUnmock('@electric-sql/pglite')
      vi.resetModules()
      if (escape !== undefined) process.env.DATABASE_URL = escape
    }
  })
})
