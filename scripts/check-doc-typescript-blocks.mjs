#!/usr/bin/env node
// Compiles every fenced TypeScript block in the markdown files listed in
// scripts/doc-blocks/files.txt, and reports the ones that fail.
//
// Three checks run per block.
//
//   1. Compile. The block is written into a scratch project under packages/rag
//      (so vitest and @types/node resolve as they do anywhere in this repo),
//      alongside both preludes, and type-checked with the repo's own tsc under
//      `strict` with @opensaas/* mapped to the built declarations.
//
//   2. Imports. Every prelude binding is `typeof import(...)` of the real
//      export, so a nested excerpt with no room for an import statement still
//      gets the shipped signature. That convenience must not cover a
//      self-contained example that simply forgot an import, so each block is
//      compiled twice — with and without prelude-exports.d.ts — and a block
//      that carries imports of its own yet still needs a name from the exports
//      prelude is reported as using that name without importing it.
//
//   3. Shadowing. A block that declares a type, interface, class or enum whose
//      name is also exported by @opensaas/stack-core or @opensaas/stack-rag is
//      additionally checked for structural equivalence with the real export,
//      both directions. Without this a block can document the opposite of what
//      the package declares — `embedBatch?` against a required `embedBatch` —
//      and compile cleanly forever, because its own copy is what the compiler
//      resolved against.
//
// Blocks that cannot compile on their own carry an entry in
// scripts/doc-blocks/fragments.json giving the reason. A reason is a claim
// about the block, so the check treats it as one: an entry whose block now
// compiles is reported as STALE rather than silently honoured, and a
// shadowing failure is never excused by a fragment entry.
//
// Usage: pnpm build && pnpm check:doc-ts-blocks   (add --json for raw results)
//
// The build is a precondition, not a convenience: the check resolves
// @opensaas/* to packages/*/dist, so it measures the branch's own shipped
// declarations rather than whatever is published.

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import ts from 'typescript'

const repoRoot = path.resolve(fileURLToPath(import.meta.url), '../..')
const blocksDir = path.join(repoRoot, 'scripts', 'doc-blocks')
const scratchDir = path.join(repoRoot, 'packages', 'rag', '.doc-blocks-check')

const files = readFileSync(path.join(blocksDir, 'files.txt'), 'utf8')
  .split('\n')
  .map((line) => line.replace(/#.*$/, '').trim())
  .filter(Boolean)
  // A changeset is consumed at release; the check must survive its removal.
  .filter((relativePath) => existsSync(path.join(repoRoot, relativePath)))

const fragments = JSON.parse(readFileSync(path.join(blocksDir, 'fragments.json'), 'utf8'))

const packageEntries = {
  '@opensaas/stack-core': 'packages/core/dist/index.d.ts',
  '@opensaas/stack-core/fields': 'packages/core/dist/fields/index.d.ts',
  '@opensaas/stack-core/extend': 'packages/core/dist/extend.d.ts',
  '@opensaas/stack-rag': 'packages/rag/dist/index.d.ts',
  '@opensaas/stack-rag/fields': 'packages/rag/dist/fields/index.d.ts',
  '@opensaas/stack-rag/providers': 'packages/rag/dist/providers/index.d.ts',
  '@opensaas/stack-rag/runtime': 'packages/rag/dist/runtime/index.d.ts',
  '@opensaas/stack-rag/mcp': 'packages/rag/dist/mcp/index.d.ts',
  '@opensaas/stack-auth': 'packages/auth/dist/index.d.ts',
}

function extractBlocks(relativePath) {
  const lines = readFileSync(path.join(repoRoot, relativePath), 'utf8').split('\n')
  const blocks = []
  for (let i = 0; i < lines.length; i++) {
    if (!/^\s*```(typescript|ts|tsx)\s*$/.test(lines[i])) continue
    const indent = lines[i].match(/^\s*/)[0]
    let j = i + 1
    while (j < lines.length && lines[j] !== `${indent}\`\`\``) j++
    const body = lines.slice(i + 1, j).map((line) => line.slice(indent.length))
    blocks.push({ file: relativePath, line: i + 2, code: body.join('\n') })
    i = j
  }
  return blocks
}

function collectExportedTypeNames() {
  const entries = Object.entries(packageEntries).filter(([, p]) =>
    existsSync(path.join(repoRoot, p)),
  )
  const program = ts.createProgram(
    entries.map(([, p]) => path.join(repoRoot, p)),
    { strict: true, skipLibCheck: true, noEmit: true },
  )
  const checker = program.getTypeChecker()
  const names = new Map()
  for (const [specifier, relativePath] of entries) {
    const source = program.getSourceFile(path.join(repoRoot, relativePath))
    const moduleSymbol = source && checker.getSymbolAtLocation(source)
    if (!moduleSymbol) continue
    for (const symbol of checker.getExportsOfModule(moduleSymbol)) {
      const isType =
        symbol.getFlags() &
        (ts.SymbolFlags.Interface | ts.SymbolFlags.TypeAlias | ts.SymbolFlags.Class)
      if (isType && !names.has(symbol.getName())) names.set(symbol.getName(), specifier)
    }
  }
  return names
}

const DECLARATION =
  /^\s*(?:export\s+)?(?:declare\s+)?(?:abstract\s+)?(?:interface|class|enum)\s+([A-Za-z_$][\w$]*)|^\s*(?:export\s+)?type\s+([A-Za-z_$][\w$]*)\s*(?:<[^=]*>)?\s*=/gm

function findShadowedNames(code, exportedTypeNames) {
  const found = new Map()
  for (const match of code.matchAll(DECLARATION)) {
    const name = match[1] ?? match[2]
    if (exportedTypeNames.has(name)) found.set(name, exportedTypeNames.get(name))
  }
  return found
}

const compilerOptions = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  lib: ['lib.es2022.d.ts'],
  strict: true,
  noEmit: true,
  skipLibCheck: true,
  esModuleInterop: true,
  resolveJsonModule: true,
  types: ['node'],
  baseUrl: repoRoot,
  paths: Object.fromEntries(Object.entries(packageEntries).map(([k, v]) => [k, [v]])),
}

// Copied in as `.ts`, not `.d.ts`: `skipLibCheck` is on — it has to be, for
// Prisma's generated client — and it would skip a declaration file entirely,
// including a prelude whose imports no longer resolve.
const preludePaths = ['prelude.ts', 'prelude-exports.ts'].map((f) => path.join(scratchDir, f))

function diagnose(entryFiles, { withExports = true } = {}) {
  const preludes = withExports ? preludePaths : preludePaths.slice(0, 1)
  const program = ts.createProgram([...entryFiles, ...preludes], compilerOptions)
  const all = [...program.getSyntacticDiagnostics(), ...program.getSemanticDiagnostics()]
  // A prelude that fails to resolve a package degrades every binding it
  // declares to `any`, and then every block "passes". That must be loud.
  const inPrelude = all.filter((d) => d.file && preludes.includes(d.file.fileName))
  if (inPrelude.length > 0) {
    for (const d of inPrelude) {
      console.error(
        `prelude ${path.basename(d.file.fileName)}: TS${d.code}: ` +
          ts.flattenDiagnosticMessageText(d.messageText, ' '),
      )
    }
    rmSync(scratchDir, { recursive: true, force: true })
    process.exit(2)
  }
  const owned = new Set(entryFiles.map((f) => f.replace(/\\/g, '/')))
  return all
    .filter((d) => d.file && owned.has(d.file.fileName))
    .map((d) => `TS${d.code}: ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`)
}

// `export {}` makes the block a module, so top-level `await` is legal and a
// local `const context` shadows the prelude's rather than colliding with it.
// Both are artifacts of compiling an excerpt in isolation, not defects in it.
function compileBlock(code, options) {
  const entry = path.join(scratchDir, 'block.ts')
  writeFileSync(entry, `${code}\nexport {}\n`)
  return diagnose([entry], options)
}

const UNRESOLVED_NAME = /^TS(?:2304|2552|2593): Cannot find name '([^']+)'/

// Names the exports prelude supplied that the block did not import itself.
function findUnimportedExports(code) {
  if (!/^\s*import\s/m.test(code)) return []
  const withPrelude = new Set(
    compileBlock(code)
      .map((d) => d.match(UNRESOLVED_NAME)?.[1])
      .filter(Boolean),
  )
  return [
    ...new Set(
      compileBlock(code, { withExports: false })
        .map((d) => d.match(UNRESOLVED_NAME)?.[1])
        .filter((name) => name && !withPrelude.has(name)),
    ),
  ]
}

// Structural equivalence, both directions, between the block's own declaration
// and the package's. Assignability alone in one direction would let the block
// drop or widen a member unnoticed.
function compileShadowProbe(code, name, specifier) {
  const subject = path.join(scratchDir, 'shadowed.ts')
  const probe = path.join(scratchDir, 'probe.ts')
  writeFileSync(subject, `${code}\nexport type { ${name} }\n`)
  writeFileSync(
    probe,
    [
      `import type { ${name} as Documented } from './shadowed.js'`,
      `import type { ${name} as Shipped } from '${specifier}'`,
      `declare const documented: Documented`,
      `declare const shipped: Shipped`,
      `export const a: Shipped = documented`,
      `export const b: Documented = shipped`,
      ``,
    ].join('\n'),
  )
  return diagnose([probe])
}

const exportedTypeNames = collectExportedTypeNames()
rmSync(scratchDir, { recursive: true, force: true })
mkdirSync(scratchDir, { recursive: true })
for (const prelude of ['prelude', 'prelude-exports']) {
  writeFileSync(
    path.join(scratchDir, `${prelude}.ts`),
    readFileSync(path.join(blocksDir, `${prelude}.d.ts`), 'utf8'),
  )
}

const results = []
try {
  for (const file of files) {
    for (const block of extractBlocks(file)) {
      const shadowed = findShadowedNames(block.code, exportedTypeNames)
      const shadowErrors = []
      for (const [name, specifier] of shadowed) {
        for (const error of compileShadowProbe(block.code, name, specifier)) {
          shadowErrors.push(`shadows ${name} from ${specifier} — ${error}`)
        }
      }
      results.push({
        key: `${block.file}:${block.line}`,
        file: block.file,
        line: block.line,
        errors: compileBlock(block.code),
        unimported: findUnimportedExports(block.code),
        shadowed: [...shadowed.keys()],
        shadowErrors,
        fragment: fragments[`${block.file}:${block.line}`] ?? null,
      })
    }
  }
} finally {
  rmSync(scratchDir, { recursive: true, force: true })
}

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(results, null, 2))
  process.exit(0)
}

const isClean = (r) =>
  r.errors.length === 0 && r.shadowErrors.length === 0 && r.unimported.length === 0

let failures = 0
let stale = 0
for (const result of results) {
  if (isClean(result)) {
    if (result.fragment) {
      stale++
      console.error(`STALE  ${result.key} — compiles, but fragments.json classifies it:`)
      console.error(`         "${result.fragment}"`)
    }
    continue
  }
  // A fragment entry excuses a block from compiling standalone. It never
  // excuses a block from agreeing with the type it redeclares, nor a
  // self-contained example from importing what it uses.
  const unexcused = [
    ...result.shadowErrors,
    ...result.unimported.map((name) => `uses ${name} without importing it`),
  ]
  if (result.fragment && unexcused.length === 0) continue
  failures++
  const tag = result.shadowed.length > 0 ? ` (redeclares ${result.shadowed.join(', ')})` : ''
  console.error(`FAIL   ${result.key}${tag}`)
  for (const error of [...(result.fragment ? [] : result.errors), ...unexcused]) {
    console.error(`         ${error}`)
  }
}

const compiling = results.filter(isClean).length
const shadowing = results.filter((r) => r.shadowed.length > 0).length
console.log(
  `${results.length} blocks: ${compiling} compile, ${results.length - compiling} ` +
    `classified fragments, ${shadowing} redeclare an exported type (checked against it).`,
)

if (failures > 0 || stale > 0) {
  console.error(`\n${failures} failing, ${stale} stale classification(s).`)
  process.exit(1)
}
