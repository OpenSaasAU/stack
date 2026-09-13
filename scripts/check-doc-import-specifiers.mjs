#!/usr/bin/env node
// Resolves every `@opensaas/*` import specifier and named import inside a
// fenced TypeScript/TSX block in the repository's documentation against each
// package's real `exports` map and its actual exported names, read straight
// from source — no `pnpm build` required. A subpath the package does not
// export, or a name it does not export from that subpath, fails exactly as
// it would for a reader who copies the sample. See issue #1301.
//
// This is deliberately weaker than scripts/check-doc-typescript-blocks.mjs:
// it never compiles a block, so it carries no prelude to maintain and no
// per-file allowlist, and it runs over every markdown file the roots below
// find rather than a curated list. It catches an import compiling would also
// catch, and reaches the many files compiling does not yet cover.
//
// Usage: pnpm check:doc-import-specifiers   (--json for the raw findings,
//        --self-test to run the fixtures in
//        scripts/doc-import-specifiers/self-test instead of the repository)
//
// Known limits
//
//   - Only `@opensaas/*` specifiers are checked. A third-party or app-local
//     import (`next`, `@/lib/auth`, `../opensaas.config`) is never resolved,
//     because unlike a package in this workspace it has no `exports` map this
//     script can read without installing the reader's own project.
//   - A subpath is checked against the package's own `exports` map; a named
//     import from a subpath that exists is checked against that subpath's
//     real exports, read from its TypeScript source (`src/`, not `dist/`) by
//     following the same `rootDir`/`outDir` convention every package's
//     `tsconfig.json` uses. A subpath whose export has no `.d.ts` entry (a
//     stylesheet, say) is resolved but not checked further: a bare or default
//     import from it passes, a named import always fails.
//   - A default import is checked for a default export; a namespace import
//     (`import * as X`) and a bare side-effect import are never wrong once
//     the subpath itself resolves.
//   - Extraction is per fenced block (`ts`, `typescript`, `tsx`, `jsx`), and
//     only import/export declarations and dynamic `import()` calls inside it
//     are read — the block is parsed, never compiled, so a name that would
//     fail to resolve for an unrelated reason (it is never used, say) is not
//     this checker's concern.
//   - Value and type exports are not distinguished: a name exported only as a
//     type satisfies a plain `import { X }` here exactly as it would once the
//     block actually compiled and TypeScript's own elision caught the misuse.
//   - Roots are docs/content, every `CLAUDE.md`, and every `README.md` /
//     `QUICKSTART.md` under packages/* and examples/*. A markdown file
//     outside those roots is not scanned.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import ts from 'typescript'

const repoRoot = path.resolve(fileURLToPath(import.meta.url), '../..')

const flags = new Set(process.argv.slice(2))
const jsonMode = flags.has('--json')
const selfTestMode = flags.has('--self-test')

// ---------------------------------------------------------------------------
// Packages: every `@opensaas/*` subpath, and its real exported names.

function typesFile(value) {
  if (typeof value === 'string') return value.endsWith('.d.ts') ? value : null
  if (!value || typeof value !== 'object') return null
  if ('types' in value) return typesFile(value.types)
  for (const key of ['import', 'default', 'require']) {
    if (key in value) {
      const found = typesFile(value[key])
      if (found) return found
    }
  }
  return null
}

// Every package here builds with plain `tsc`, `rootDir: "./src"` and
// `outDir: "./dist"` (verified across all nine on issue #1301) — so a
// declaration's dist-relative path names its source without needing a build.
function sourceEntry(packageDir, distRelativeTypes) {
  const normalized = distRelativeTypes.replace(/^\.\//, '')
  if (!normalized.startsWith('dist/') || !normalized.endsWith('.d.ts')) return null
  const withoutExt = normalized.slice('dist/'.length, -'.d.ts'.length)
  for (const ext of ['.ts', '.tsx']) {
    const candidate = path.join(packageDir, 'src', `${withoutExt}${ext}`)
    if (existsSync(candidate)) return candidate
  }
  return null
}

function discoverSubpaths() {
  const subpaths = new Map() // specifier -> { entry: absolute source path | null }
  for (const dir of readdirSync(path.join(repoRoot, 'packages'))) {
    const packageDir = path.join(repoRoot, 'packages', dir)
    const manifestPath = path.join(packageDir, 'package.json')
    if (!existsSync(manifestPath)) continue
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    if (!manifest.name?.startsWith('@opensaas/') || !manifest.exports) continue
    for (const [subpath, value] of Object.entries(manifest.exports)) {
      if (subpath.includes('*')) continue
      const specifier = subpath === '.' ? manifest.name : `${manifest.name}${subpath.slice(1)}`
      const distRelative = typesFile(value)
      const entry = distRelative ? sourceEntry(packageDir, distRelative) : null
      subpaths.set(specifier, { entry })
    }
  }
  return subpaths
}

const subpaths = discoverSubpaths()

const compilerOptions = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  jsx: ts.JsxEmit.ReactJSX,
  esModuleInterop: true,
  resolveJsonModule: true,
  skipLibCheck: true,
  noEmit: true,
  types: [],
}

// One program over every subpath's entry lets `getExportsOfModule` resolve
// re-exports (`export * from './x.js'`) transitively, the same way a real
// import would see them.
function collectExportedNames() {
  const entries = [...subpaths.values()].map((v) => v.entry).filter(Boolean)
  const program = ts.createProgram(entries, compilerOptions)
  const checker = program.getTypeChecker()
  const names = new Map() // specifier -> { names: Set<string>, hasDefault: boolean }
  for (const [specifier, { entry }] of subpaths) {
    if (!entry) {
      names.set(specifier, null) // opaque: no source to enumerate (e.g. a stylesheet)
      continue
    }
    const source = program.getSourceFile(entry)
    const moduleSymbol = source && checker.getSymbolAtLocation(source)
    if (!moduleSymbol) {
      names.set(specifier, null)
      continue
    }
    const exported = new Set()
    let hasDefault = false
    for (const symbol of checker.getExportsOfModule(moduleSymbol)) {
      if (symbol.getName() === 'default') hasDefault = true
      else exported.add(symbol.getName())
    }
    names.set(specifier, { names: exported, hasDefault })
  }
  return names
}

const exportedNames = collectExportedNames()

// ---------------------------------------------------------------------------
// Markdown roots and fenced-block extraction.

const ROOTS = ['docs/content']
const EXTRA_FILES = () => {
  const files = ['CLAUDE.md']
  for (const base of ['packages', 'examples']) {
    for (const dir of readdirSync(path.join(repoRoot, base))) {
      const dirPath = path.join(base, dir)
      if (!statSync(path.join(repoRoot, dirPath)).isDirectory()) continue
      for (const name of ['CLAUDE.md', 'README.md', 'QUICKSTART.md']) {
        if (existsSync(path.join(repoRoot, dirPath, name))) files.push(path.join(dirPath, name))
      }
    }
  }
  return files
}

function collectMarkdownFiles(roots) {
  const found = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.name.endsWith('.md')) found.push(full)
    }
  }
  for (const root of roots) {
    const abs = path.join(repoRoot, root)
    if (existsSync(abs)) walk(abs)
  }
  return found.map((f) => path.relative(repoRoot, f))
}

const FENCE = /^(\s*)```(typescript|ts|tsx|jsx)(?:\s+\S.*)?\s*$/

function extractBlocks(text) {
  const lines = text.split('\n')
  const blocks = []
  for (let i = 0; i < lines.length; i++) {
    const fence = lines[i].match(FENCE)
    if (!fence) continue
    const indent = fence[1]
    let j = i + 1
    while (j < lines.length && lines[j] !== `${indent}\`\`\``) j++
    const body = lines.slice(i + 1, j).map((line) => line.slice(indent.length))
    blocks.push({ line: i + 2, language: fence[2], code: body.join('\n') })
    i = j
  }
  return blocks
}

// ---------------------------------------------------------------------------
// One block: every `@opensaas/*` specifier it names, and every binding it
// imports from it.

function parseSpecifiers(code, language) {
  const scriptKind = language === 'tsx' || language === 'jsx' ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  const source = ts.createSourceFile('block.ts', code, ts.ScriptTarget.ES2022, true, scriptKind)
  const findings = []

  const recordImport = (specifier, node, bindings) => {
    if (!specifier.startsWith('@opensaas/')) return
    findings.push({ specifier, offset: node.getStart(source), bindings })
  }

  const bindingsOf = (clause) => {
    if (!clause) return { hasDefault: false, hasNamespace: false, named: [] }
    const named = []
    let hasDefault = false
    let hasNamespace = false
    if (clause.name) hasDefault = true
    const namedBindings = clause.namedBindings
    if (namedBindings) {
      if (ts.isNamespaceImport(namedBindings)) hasNamespace = true
      else if (ts.isNamedImports(namedBindings)) {
        for (const element of namedBindings.elements) {
          named.push((element.propertyName ?? element.name).text)
        }
      }
    }
    return { hasDefault, hasNamespace, named }
  }

  const visit = (node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const { hasDefault, hasNamespace, named } = bindingsOf(node.importClause)
      recordImport(node.moduleSpecifier.text, node, { hasDefault, hasNamespace, named })
    } else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const named =
        node.exportClause && ts.isNamedExports(node.exportClause)
          ? node.exportClause.elements.map((e) => (e.propertyName ?? e.name).text)
          : []
      const hasNamespace = !node.exportClause
      recordImport(node.moduleSpecifier.text, node, { hasDefault: false, hasNamespace, named })
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length > 0 &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      recordImport(node.arguments[0].text, node, {
        hasDefault: false,
        hasNamespace: true,
        named: [],
      })
    }
    ts.forEachChild(node, visit)
  }
  visit(source)

  const lineOf = (offset) => code.slice(0, offset).split('\n').length
  return findings.map((f) => ({ ...f, line: lineOf(f.offset) }))
}

function checkBlock(file, block) {
  const problems = []
  for (const { specifier, line, bindings } of parseSpecifiers(block.code, block.language)) {
    const blockLine = block.line + line - 1
    if (!subpaths.has(specifier)) {
      problems.push({
        file,
        line: blockLine,
        specifier,
        message: `\`${specifier}\` is not a subpath any @opensaas package exports`,
      })
      continue
    }
    const resolved = exportedNames.get(specifier)
    if (!resolved) continue // opaque entry (no .d.ts to enumerate, e.g. a stylesheet)
    if (bindings.hasDefault && !resolved.hasDefault) {
      problems.push({
        file,
        line: blockLine,
        specifier,
        message: `\`${specifier}\` has no default export`,
      })
    }
    for (const name of bindings.named) {
      if (!resolved.names.has(name)) {
        problems.push({
          file,
          line: blockLine,
          specifier,
          message: `\`${specifier}\` does not export \`${name}\``,
        })
      }
    }
  }
  return problems
}

function checkFile(relativePath) {
  const text = readFileSync(path.join(repoRoot, relativePath), 'utf8')
  const problems = []
  for (const block of extractBlocks(text)) problems.push(...checkBlock(relativePath, block))
  return problems
}

function report(problems) {
  console.error(
    `${problems.length} documentation sample(s) import from a subpath, or a name, an ` +
      `@opensaas package does not export:\n`,
  )
  for (const p of problems) {
    console.error(`  ${p.file}:${p.line}`)
    console.error(`    ${p.message}`)
  }
}

if (selfTestMode) {
  const fixtures = path.join(repoRoot, 'scripts/doc-import-specifiers/self-test')
  const files = ['good', 'bad'].map((kind) =>
    path.relative(repoRoot, path.join(fixtures, `${kind}.md`)),
  )
  const problems = files.flatMap(checkFile)
  const bad = problems.filter((p) => p.file.endsWith('bad.md'))
  const good = problems.filter((p) => p.file.endsWith('good.md'))

  const issues = []
  if (bad.length !== 4) {
    issues.push(`expected 4 findings in bad.md, got ${bad.length}: ${JSON.stringify(bad)}`)
  }
  if (good.length !== 0) {
    issues.push(`expected 0 findings in good.md, got ${good.length}: ${JSON.stringify(good)}`)
  }
  if (issues.length > 0) {
    console.error('Self-test failed:\n')
    for (const issue of issues) console.error(`  - ${issue}`)
    process.exit(1)
  }
  console.log('Self-test passed: 4 bad shapes reported, 0 good shapes reported.')
  process.exit(0)
}

const files = [...collectMarkdownFiles(ROOTS), ...EXTRA_FILES()]
const problems = files.flatMap(checkFile)

if (jsonMode) {
  console.log(JSON.stringify(problems, null, 2))
  process.exit(problems.length > 0 ? 1 : 0)
}

if (problems.length > 0) {
  report(problems)
  process.exit(1)
}

console.log(
  `No bad @opensaas/* import specifiers found across ${files.length} documentation files.`,
)
