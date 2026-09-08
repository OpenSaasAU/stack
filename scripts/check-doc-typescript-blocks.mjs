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
//      resolved against. The comparison needs a type-argument arity both sides
//      accept; when there is none the name is reported as NOT compared rather
//      than counted as checked (see Known limits).
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
//   - Shadowing compares the two declarations at one type-argument arity, with
//     fresh unconstrained parameters. A name whose package declaration needs
//     required type parameters the block's does not supply — 41 of the 242
//     exported names are generics with at least one required parameter — or
//     whose parameters carry constraints the probe cannot satisfy, is reported
//     as `NOT COMPARED` and is excluded from the "checked against it" tally.
//     Such a block is not failed: a documented `type Row = { … }` alongside an
//     unrelated exported `Row<C, R, K>` is a name collision, not a contradiction.
//   - A `tsx` fence is extracted but not type-checked — no `jsx` option is set
//     and React is not resolvable from the scratch project. It is reported as
//     unchecked, and cannot be excused by a fragment entry, rather than being
//     dropped or given a misleading diagnostic.
//   - A listed path that cannot be read fails by name. The one exception is
//     `.changeset/*`, which release consumes; that path is skipped and its
//     fixture keys are exempted from the orphan report along with it.
//   - A doc block whose code puts a diagnostic in a prelude — `declare global`
//     colliding with a prelude binding, say — aborts the run with exit 2. The
//     message names the block, but the blocks after it do not run.
//   - Block extraction is textual. The closing fence must match the opening
//     indent exactly; a block fenced with four backticks, or one whose fence
//     carries trailing whitespace, is extracted wrongly or not at all.
//   - A block compiles in isolation with the preludes in scope. It is not run,
//     so nothing here says the documented call does what the prose claims —
//     only that it type-checks against the shipped declarations.
//   - CI runs this on PRs into prisma-8 only. The fixtures are keyed to that
//     branch's documents, so PRs into main skip it and say so in the job log.
//     Flipping that is part of landing prisma-8 — see .github/workflows/
//     test.yml and #1301.

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import ts from 'typescript'

const repoRoot = path.resolve(fileURLToPath(import.meta.url), '../..')
const blocksDir = path.join(repoRoot, 'scripts', 'doc-blocks')
const scratchDir = path.join(repoRoot, 'packages', 'rag', '.doc-blocks-check')

const listedPaths = readFileSync(path.join(blocksDir, 'files.txt'), 'utf8')
  .split('\n')
  .map((line) => line.replace(/#.*$/, '').trim())
  .filter(Boolean)

const sources = new Map()
const unreadable = []
for (const relativePath of listedPaths) {
  try {
    sources.set(relativePath, readFileSync(path.join(repoRoot, relativePath), 'utf8'))
  } catch {
    unreadable.push(relativePath)
  }
}

// Release consumes a changeset, so its disappearance is expected and its
// fixture keys go with it. Any other listed path that cannot be read is a
// rename or a deletion, and skipping it would retire its blocks and its
// classifications together, in silence, on a green run.
const isChangeset = (relativePath) => relativePath.startsWith('.changeset/')
const consumed = new Set(unreadable.filter(isChangeset))
const missingFiles = unreadable.filter((relativePath) => !isChangeset(relativePath))
const files = listedPaths.filter((relativePath) => sources.has(relativePath))

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
  const lines = sources.get(relativePath).split('\n')
  const blocks = []
  for (let i = 0; i < lines.length; i++) {
    const fence = lines[i].match(/^(\s*)```(typescript|ts|tsx)\s*$/)
    if (!fence) continue
    const indent = fence[1]
    let j = i + 1
    while (j < lines.length && lines[j] !== `${indent}\`\`\``) j++
    const body = lines.slice(i + 1, j).map((line) => line.slice(indent.length))
    blocks.push({
      file: relativePath,
      line: i + 2,
      language: fence[2],
      code: body.join('\n'),
    })
    i = j
  }
  return blocks
}

function describeTypeParameters(declarations) {
  const declared = declarations.find((d) => d.typeParameters?.length)?.typeParameters ?? []
  return declared.map((p) => ({
    optional: Boolean(p.default),
    constrained: Boolean(p.constraint),
  }))
}

// Every barrel in this repo re-exports with `export type { X } from './y.js'`,
// and those symbols carry only SymbolFlags.Alias — so filtering the module's
// exports by Interface|TypeAlias|Class sees just the handful a barrel happens
// to declare itself, and the shadowing check above silently covers nothing.
function collectExportedTypes() {
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
      if (!isType || names.has(symbol.getName())) continue
      names.set(symbol.getName(), {
        specifier,
        typeParameters: describeTypeParameters(target.declarations ?? []),
      })
    }
  }
  return names
}

// The alias branch's type-parameter list must tolerate a `=` inside the angle
// brackets: `type SearchResult<T = unknown>` is a default, not the start of the
// alias body. An earlier `<[^=]*>` could not cross it, so every generic with a
// defaulted parameter escaped the shadowing check entirely.
const DECLARATION =
  /^\s*(export\s+)?(?:declare\s+)?(?:abstract\s+)?(?:interface|class|enum)\s+([A-Za-z_$][\w$]*)|^\s*(export\s+)?type\s+([A-Za-z_$][\w$]*)\s*(?:<[^<>]*(?:<[^<>]*>[^<>]*)*>)?\s*=/gm

function findShadowedNames(code, exportedTypes) {
  const found = new Map()
  for (const match of code.matchAll(DECLARATION)) {
    const name = match[2] ?? match[4]
    if (!exportedTypes.has(name)) continue
    found.set(name, {
      specifier: exportedTypes.get(name).specifier,
      shipped: exportedTypes.get(name).typeParameters,
      exported: Boolean(match[1] ?? match[3]),
    })
  }
  return found
}

function documentedTypeParameters(code, name) {
  const source = ts.createSourceFile('arity.ts', code, ts.ScriptTarget.ES2022, true)
  let found = null
  const visit = (node) => {
    if (found) return
    const declares =
      ts.isTypeAliasDeclaration(node) ||
      ts.isInterfaceDeclaration(node) ||
      ts.isClassDeclaration(node) ||
      ts.isEnumDeclaration(node)
    if (declares && node.name?.text === name) {
      found = describeTypeParameters([node])
      return
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return found
}

const requiredCount = (params) => params.filter((p) => !p.optional).length

// The probe supplies the same type arguments to both declarations, so it needs
// an arity each side accepts and parameters it can fill with fresh opaque
// types. Where no such arity exists the two names are unrelated as far as this
// tool can tell, and saying so is the only honest result.
function planComparison(documented, shipped) {
  if (!documented) return { compared: false, reason: 'its declaration in the block did not parse' }
  // The most type arguments both sides accept, so the comparison is between
  // the two type constructors rather than between one instantiation of each.
  const arity = Math.min(documented.length, shipped.length)
  if (arity < Math.max(requiredCount(documented), requiredCount(shipped))) {
    return {
      compared: false,
      reason:
        `the package declares ${shipped.length} type parameter(s), ${requiredCount(shipped)} ` +
        `required, and the block declares ${documented.length}`,
    }
  }
  const filled = [...documented.slice(0, arity), ...shipped.slice(0, arity)]
  if (filled.some((p) => p.constrained)) {
    return {
      compared: false,
      reason: 'its type parameters carry constraints the probe cannot fill',
    }
  }
  return { compared: true, arity }
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

let checking = null

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
    console.error(
      `\nRaised while checking ${checking ?? 'the preludes'} — either the build is broken or ` +
        `that block's own code reaches into a prelude. Blocks after it did not run.`,
    )
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
function compileShadowProbe(code, name, specifier, alreadyExported, arity) {
  const subject = path.join(scratchDir, 'shadowed.ts')
  const probe = path.join(scratchDir, 'probe.ts')
  const reExportOffset = code.length + 1
  writeFileSync(subject, alreadyExported ? `${code}\n` : `${code}\nexport type { ${name} }\n`)
  const args = [...Array(arity).keys()].map((index) => `P${index}`)
  const list = arity > 0 ? `<${args.join(', ')}>` : ''
  writeFileSync(
    probe,
    [
      `import type { ${name} as Documented } from './shadowed.js'`,
      `import type { ${name} as Shipped } from '${specifier}'`,
      `export function probe${list}(documented: Documented${list}, shipped: Shipped${list}) {`,
      `  const a: Shipped${list} = documented`,
      `  const b: Documented${list} = shipped`,
      `  return [a, b]`,
      `}`,
      ``,
    ].join('\n'),
  )
  const probeName = toPosix(probe)
  const subjectName = toPosix(subject)
  const errors = []
  let ran = true
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
      ran = false
    }
  }
  return { errors, ran }
}

const exportedTypes = collectExportedTypes()
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
      const key = `${block.file}:${block.line}`
      checking = key
      const shadowed = findShadowedNames(block.code, exportedTypes)
      const shadowErrors = []
      const compared = []
      const uncompared = []
      for (const [name, { specifier, shipped, exported }] of shadowed) {
        const plan = planComparison(documentedTypeParameters(block.code, name), shipped)
        if (!plan.compared) {
          uncompared.push(`${name} from ${specifier} — ${plan.reason}`)
          continue
        }
        const probe = compileShadowProbe(block.code, name, specifier, exported, plan.arity)
        if (probe.ran) compared.push(name)
        for (const error of probe.errors) {
          shadowErrors.push(`shadows ${name} from ${specifier} — ${error}`)
        }
      }
      results.push({
        key,
        file: block.file,
        line: block.line,
        language: block.language,
        errors: compileBlock(block.code),
        unimported: findUnimportedExports(block.code),
        unchecked:
          block.language === 'tsx'
            ? ['a tsx fence carries JSX, which this check sets no `jsx` option for']
            : [],
        shadowed: [...shadowed.keys()],
        compared,
        uncompared,
        shadowErrors,
        fragment: fragments[key] ?? null,
      })
    }
  }
} finally {
  checking = null
  rmSync(scratchDir, { recursive: true, force: true })
}

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(results, null, 2))
  process.exit(0)
}

const isClean = (r) =>
  r.errors.length === 0 &&
  r.shadowErrors.length === 0 &&
  r.unimported.length === 0 &&
  r.unchecked.length === 0

// A listed path that vanished takes its blocks and its classifications with
// it. Reported by name so the run cannot go green on a rename.
for (const relativePath of missingFiles) {
  console.error(`MISSING ${relativePath} — listed in files.txt but could not be read`)
}

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
  // excuses a block from agreeing with the type it redeclares, from importing
  // what it uses, or from being checked at all.
  const unexcused = [
    ...result.shadowErrors,
    ...result.unimported.map((name) => `uses ${name} without importing it`),
    ...result.unchecked,
  ]
  if (result.fragment && unexcused.length === 0) continue
  failures++
  const tag = result.shadowed.length > 0 ? ` (redeclares ${result.shadowed.join(', ')})` : ''
  console.error(`FAIL   ${result.key}${tag}`)
  for (const error of [...(result.fragment ? [] : result.errors), ...unexcused]) {
    console.error(`         ${error}`)
  }
}

// A redeclared name the probe cannot instantiate is not a failure — the block
// and the package simply share a name. It is printed because the alternative
// is counting it as checked, which is the over-claim this check exists to stop.
for (const result of results) {
  for (const note of result.uncompared) {
    console.log(`NOT COMPARED ${result.key} — ${note}`)
  }
}

// A key that matches no extracted block excuses nothing, and says so about a
// block that has moved or gone. Without this the file only ever grows, and an
// edit above a block silently retires its classification. A key naming a file
// that is not listed at all is orphaned too — a typo or a leftover rename —
// and so is one with no `file:line` shape. The single exemption is a changeset
// that release has consumed, which takes its keys with it legitimately.
const extracted = new Set(results.map((r) => r.key))
const orphans = Object.keys(fragments).filter((key) => {
  if (extracted.has(key)) return false
  const separator = key.lastIndexOf(':')
  return !(separator > 0 && consumed.has(key.slice(0, separator)))
})
for (const key of orphans) {
  console.error(`ORPHAN ${key} — fragments.json classifies no block at that line:`)
  console.error(`         "${fragments[key]}"`)
}

const compiling = results.filter(isClean).length
const classified = results.filter((r) => r.fragment).length
const shadowing = results.filter((r) => r.compared.length > 0).length
const notCompared = results.reduce((total, r) => total + r.uncompared.length, 0)
console.log(
  `${results.length} blocks: ${compiling} compile, ${classified} classified fragments, ` +
    `${shadowing} redeclare an exported type (checked against it), ` +
    `${notCompared} redeclared name(s) not compared.`,
)

if (failures > 0 || stale > 0 || orphans.length > 0 || missingFiles.length > 0) {
  console.error(
    `\n${failures} failing, ${stale} stale and ${orphans.length} orphaned classification(s), ` +
      `${missingFiles.length} listed file(s) missing.`,
  )
  process.exit(1)
}
