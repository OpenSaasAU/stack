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
// compiles is reported as STALE, an entry matching no block at all is reported
// as ORPHAN, and a shadowing failure is never excused by a fragment entry.
//
// Usage: pnpm build && pnpm check:doc-ts-blocks   (add --json for raw results)
//
// The build is a precondition, not a convenience: the check resolves
// @opensaas/* to packages/*/dist, so it measures the branch's own shipped
// declarations rather than whatever is published. A missing dist entry aborts
// the run rather than being reported as a doc block importing a missing module.
//
// Known limits
//
//   - Coverage is the file list, not the tree. A markdown file not named in
//     files.txt is never compiled, and nothing detects that a new one was
//     added. `pnpm check:doc-ts-blocks` says nothing about docs outside it.
//   - Fragment entries are keyed `file:line`. The orphan check catches a key
//     that has drifted off every block, but a key that drifts onto a different
//     block's first line still excuses that block instead.
//   - Shadowing is checked only for names exported from the nine entry points
//     in `packageEntries`, and only for declarations at module scope in the
//     block. A subpath this file does not list is not compared against.
//   - Block extraction is textual. The closing fence must match the opening
//     indent exactly; a block fenced with four backticks, or one whose fence
//     carries trailing whitespace, is extracted wrongly or not at all.
//   - A block compiles in isolation with the preludes in scope. It is not run,
//     so nothing here says the documented call does what the prose claims —
//     only that it type-checks against the shipped declarations.

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

const listedFiles = new Set(files)
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

const missingEntries = Object.entries(packageEntries).filter(
  ([, relativePath]) => !existsSync(path.join(repoRoot, relativePath)),
)
if (missingEntries.length > 0) {
  for (const [specifier, relativePath] of missingEntries) {
    console.error(`missing declarations for ${specifier}: ${relativePath}`)
  }
  console.error('\nRun `pnpm build` first — without it every block fails on an unresolved import.')
  process.exit(2)
}

const toPosix = (p) => p.replace(/\\/g, '/')
const format = (d) => `TS${d.code}: ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`

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

// Every barrel in this repo re-exports with `export type { X } from './y.js'`,
// and those symbols carry only SymbolFlags.Alias — so filtering the module's
// exports by Interface|TypeAlias|Class sees just the handful a barrel happens
// to declare itself, and the shadowing check above silently covers nothing.
function collectExportedTypeNames() {
  const entries = Object.entries(packageEntries)
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
      const target =
        symbol.getFlags() & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol
      const isType =
        target.getFlags() &
        (ts.SymbolFlags.Interface | ts.SymbolFlags.TypeAlias | ts.SymbolFlags.Class)
      if (isType && !names.has(symbol.getName())) names.set(symbol.getName(), specifier)
    }
  }
  return names
}

const DECLARATION =
  /^\s*(export\s+)?(?:declare\s+)?(?:abstract\s+)?(?:interface|class|enum)\s+([A-Za-z_$][\w$]*)|^\s*(export\s+)?type\s+([A-Za-z_$][\w$]*)\s*(?:<[^=]*>)?\s*=/gm

function findShadowedNames(code, exportedTypeNames) {
  const found = new Map()
  for (const match of code.matchAll(DECLARATION)) {
    const name = match[2] ?? match[4]
    if (!exportedTypeNames.has(name)) continue
    found.set(name, {
      specifier: exportedTypeNames.get(name),
      exported: Boolean(match[1] ?? match[3]),
    })
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

function runProgram(entryFiles, { withExports = true } = {}) {
  const preludes = withExports ? preludePaths : preludePaths.slice(0, 1)
  const program = ts.createProgram([...entryFiles, ...preludes], compilerOptions)
  const all = [...program.getSyntacticDiagnostics(), ...program.getSemanticDiagnostics()]
  // A prelude that fails to resolve a package degrades every binding it
  // declares to `any`, and then every block "passes". That must be loud.
  const preludeNames = new Set(preludes.map(toPosix))
  const inPrelude = all.filter((d) => d.file && preludeNames.has(toPosix(d.file.fileName)))
  if (inPrelude.length > 0) {
    for (const d of inPrelude) {
      console.error(`prelude ${path.basename(d.file.fileName)}: ${format(d)}`)
    }
    rmSync(scratchDir, { recursive: true, force: true })
    process.exit(2)
  }
  return all
}

function diagnose(entryFiles, options) {
  const owned = new Set(entryFiles.map(toPosix))
  return runProgram(entryFiles, options)
    .filter((d) => d.file && owned.has(toPosix(d.file.fileName)))
    .map(format)
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
function compileShadowProbe(code, name, specifier, alreadyExported) {
  const subject = path.join(scratchDir, 'shadowed.ts')
  const probe = path.join(scratchDir, 'probe.ts')
  const reExportOffset = code.length + 1
  writeFileSync(subject, alreadyExported ? `${code}\n` : `${code}\nexport type { ${name} }\n`)
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
  const probeName = toPosix(probe)
  const subjectName = toPosix(subject)
  const errors = []
  for (const d of runProgram([probe, subject])) {
    if (!d.file) continue
    const file = toPosix(d.file.fileName)
    if (file === probeName) errors.push(format(d))
    // A diagnostic on the appended re-export means the declaration never
    // reached module scope. Both assignability checks then compared against an
    // error type and passed for no reason, so the block would be counted as
    // agreeing with a type it was never compared to.
    else if (file === subjectName && d.start >= reExportOffset) {
      errors.push(`${format(d)} — not declared at module scope, so it was never compared`)
    }
  }
  return errors
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
      for (const [name, { specifier, exported }] of shadowed) {
        for (const error of compileShadowProbe(block.code, name, specifier, exported)) {
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

// A key that matches no extracted block excuses nothing, and says so about a
// block that has moved or gone. Without this the file only ever grows, and an
// edit above a block silently retires its classification.
const extracted = new Set(results.map((r) => r.key))
const orphans = Object.keys(fragments).filter(
  (key) => !extracted.has(key) && listedFiles.has(key.slice(0, key.lastIndexOf(':'))),
)
for (const key of orphans) {
  console.error(`ORPHAN ${key} — fragments.json classifies no block at that line:`)
  console.error(`         "${fragments[key]}"`)
}

const compiling = results.filter(isClean).length
const classified = results.filter((r) => r.fragment).length
const shadowing = results.filter((r) => r.shadowed.length > 0).length
console.log(
  `${results.length} blocks: ${compiling} compile, ${classified} ` +
    `classified fragments, ${shadowing} redeclare an exported type (checked against it).`,
)

if (failures > 0 || stale > 0 || orphans.length > 0) {
  console.error(
    `\n${failures} failing, ${stale} stale and ${orphans.length} orphaned classification(s).`,
  )
  process.exit(1)
}
