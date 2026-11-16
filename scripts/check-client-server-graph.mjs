#!/usr/bin/env node
// Fails when a `'use client'` module in a shipped package can reach a Node
// builtin or a server-only dependency through its static import graph. Next's
// webpack build rejects that graph (`UnhandledSchemeError: node:async_hooks`)
// while Turbopack tolerates it, so `next dev` and the default `next build` stay
// green over a client bundle webpack cannot build. See issue #2430.
//
// Usage: pnpm check:client-server-graph
//        --self-test  runs the fixtures in scripts/client-server-graph/self-test
//                     instead of the repository, asserting the checker reports
//                     the bad graphs and clears the good ones.
//        --inventory  also prints every value a client graph imports from
//                     `@opensaas/stack-core`, under any subpath.
//
// Known limits
//
//   - Roots are the `'use client'` modules under packages/*/src, examples/ and
//     the scaffolder templates, judged by their leading directive, plus the
//     entries on CLIENT_ENTRIES, which promise the same thing without the
//     directive. Tests are not roots.
//   - `@/` resolves against the nearest package.json directory, trying `src/`
//     first. No other path alias is resolved.
//   - The walk reads TypeScript source, not built output: a workspace import is
//     mapped through the target package.json `exports` from `dist/` back to
//     `src/`. A subpath whose built path has no source twin is not followed.
//   - A module is followed only through value imports and re-exports. `import
//     type`, `export type` and an import whose every named binding is marked
//     `type` are erased by tsc and are not edges. An import of a type written
//     without the `type` marker is still an edge, which can only over-report.
//   - A `'use server'` module is a reference across the boundary, not bundled,
//     so the walk stops there.
//   - Third-party packages are not walked. One is a finding only when it is on
//     SERVER_ONLY_PACKAGES; any other is trusted to ship a browser build.
//   - `require()` calls and non-literal dynamic imports are not followed.

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { builtinModules } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import ts from 'typescript'

const repoRoot = path.resolve(fileURLToPath(import.meta.url), '../..')

const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.js', '.jsx', '.mjs']
const SKIP_DIRECTORIES = new Set(['node_modules', 'dist', '__tests__', 'tests', 'e2e'])
const APPLICATION_ROOTS = ['examples', 'packages/create-opensaas-app/templates']
const CLIENT_ENTRIES = ['packages/core/src/client-safe.ts']
const TEST_FILE = /\.(test|spec|browser\.test)\.[cm]?[jt]sx?$/
const BUILTINS = new Set(builtinModules.flatMap((name) => [name, name.split('/')[0]]))
const SERVER_ONLY_PACKAGES = [
  'pg',
  'server-only',
  'better-auth/adapters',
  '@prisma/',
  '@electric-sql/',
]

function collectSourceFiles(dir, found = []) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return found
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (SKIP_DIRECTORIES.has(entry.name) || entry.name.startsWith('.')) continue
      collectSourceFiles(full, found)
    } else if (SOURCE_EXTENSIONS.includes(path.extname(entry.name))) {
      if (!TEST_FILE.test(entry.name) && !entry.name.endsWith('.d.ts')) found.push(full)
    }
  }
  return found
}

function leadingDirective(source) {
  const body = source.replace(/^(?:\s+|\/\/[^\n]*|\/\*[\s\S]*?\*\/)*/, '')
  const match = /^(['"])use (client|server)\1/.exec(body)
  return match ? match[2] : null
}

function isFile(candidate) {
  try {
    return statSync(candidate).isFile()
  } catch {
    return false
  }
}

function resolveFile(base) {
  const candidates = [base]
  const stem = base.replace(/\.(?:[cm]?js|jsx)$/, '')
  for (const ext of SOURCE_EXTENSIONS) candidates.push(stem + ext)
  for (const ext of SOURCE_EXTENSIONS) candidates.push(path.join(base, 'index' + ext))
  for (const candidate of candidates) {
    if (isFile(candidate) && !candidate.endsWith('.d.ts')) return candidate
  }
  return null
}

function loadWorkspacePackages(packagesDir) {
  const byName = new Map()
  for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const dir = path.join(packagesDir, entry.name)
    const manifestPath = path.join(dir, 'package.json')
    if (!isFile(manifestPath)) continue
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    byName.set(manifest.name, { dir, manifest })
  }
  return byName
}

function exportTarget(entry) {
  if (typeof entry === 'string') return entry
  if (entry && typeof entry === 'object') {
    for (const condition of ['browser', 'import', 'default']) {
      const target = exportTarget(entry[condition])
      if (target) return target
    }
  }
  return null
}

function packageOf(specifier, packages) {
  for (const [name, pkg] of packages) {
    if (specifier === name || specifier.startsWith(name + '/')) {
      return { name, pkg, subpath: '.' + specifier.slice(name.length) }
    }
  }
  return null
}

function resolveWorkspaceImport(specifier, packages) {
  const owner = packageOf(specifier, packages)
  if (!owner) return undefined
  const target = exportTarget(owner.pkg.manifest.exports?.[owner.subpath])
  if (!target) return null
  const source = target.replace(/^\.\/dist\//, './src/')
  return resolveFile(path.join(owner.pkg.dir, source))
}

function classifyExternal(specifier) {
  if (specifier.startsWith('node:') || BUILTINS.has(specifier)) return 'a Node builtin'
  if (
    SERVER_ONLY_PACKAGES.some(
      (p) => specifier === p || specifier.startsWith(p.endsWith('/') ? p : p + '/'),
    )
  ) {
    return 'a server-only package'
  }
  return null
}

function isErasedImport(node) {
  const clause = node.importClause
  if (!clause) return false
  if (clause.isTypeOnly) return true
  if (clause.name) return false
  const bindings = clause.namedBindings
  if (!bindings || !ts.isNamedImports(bindings)) return false
  return bindings.elements.length > 0 && bindings.elements.every((e) => e.isTypeOnly)
}

function isErasedExport(node) {
  if (node.isTypeOnly) return true
  const clause = node.exportClause
  return Boolean(
    clause &&
    ts.isNamedExports(clause) &&
    clause.elements.length > 0 &&
    clause.elements.every((e) => e.isTypeOnly),
  )
}

function valueNames(node) {
  const names = []
  if (ts.isImportDeclaration(node)) {
    const clause = node.importClause
    if (clause?.name) names.push('default')
    const bindings = clause?.namedBindings
    if (bindings && ts.isNamespaceImport(bindings)) names.push('*')
    if (bindings && ts.isNamedImports(bindings)) {
      for (const e of bindings.elements) {
        if (!e.isTypeOnly) names.push((e.propertyName ?? e.name).text)
      }
    }
  } else if (ts.isExportDeclaration(node)) {
    const clause = node.exportClause
    if (!clause) names.push('*')
    else if (ts.isNamespaceExport(clause)) names.push('*')
    else
      for (const e of clause.elements)
        if (!e.isTypeOnly) names.push((e.propertyName ?? e.name).text)
  }
  return names
}

const sourceCache = new Map()

function valueImportsOf(file) {
  const cached = sourceCache.get(file)
  if (cached) return cached
  const text = readFileSync(file, 'utf8')
  const kind = file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  const sourceFile = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind)
  const imports = []
  const visit = (node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      if (!isErasedImport(node)) {
        imports.push({ specifier: node.moduleSpecifier.text, names: valueNames(node) })
      }
    } else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      if (!isErasedExport(node)) {
        imports.push({ specifier: node.moduleSpecifier.text, names: valueNames(node) })
      }
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1 &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      imports.push({ specifier: node.arguments[0].text, names: ['*'] })
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  const result = { directive: leadingDirective(text), imports }
  sourceCache.set(file, result)
  return result
}

function projectRootOf(file) {
  for (let dir = path.dirname(file); ; dir = path.dirname(dir)) {
    if (isFile(path.join(dir, 'package.json'))) return dir
    if (path.dirname(dir) === dir) return null
  }
}

function resolveEdge(specifier, importer, packages) {
  if (specifier.startsWith('.')) {
    return { file: resolveFile(path.resolve(path.dirname(importer), specifier)) }
  }
  if (specifier.startsWith('@/')) {
    const root = projectRootOf(importer)
    if (!root) return { file: null }
    const rest = specifier.slice(2)
    return { file: resolveFile(path.join(root, 'src', rest)) ?? resolveFile(path.join(root, rest)) }
  }
  const workspace = resolveWorkspaceImport(specifier, packages)
  if (workspace !== undefined) return { file: workspace }
  return { external: classifyExternal(specifier) }
}

function walk(root, packages, inventory) {
  const parent = new Map([[root, null]])
  const queue = [root]
  const chainTo = (file) => {
    const chain = []
    for (let at = file; at; at = parent.get(at)) chain.unshift(path.relative(repoRoot, at))
    return chain
  }
  while (queue.length > 0) {
    const file = queue.shift()
    const { directive, imports } = valueImportsOf(file)
    if (directive === 'server' && file !== root) continue
    for (const { specifier, names } of imports) {
      if (specifier.startsWith('@opensaas/stack-core')) {
        for (const name of names) inventory.add(`${specifier} :: ${name}`)
      }
      const edge = resolveEdge(specifier, file, packages)
      if (edge.external) {
        return [{ root, reached: specifier, why: edge.external, chain: chainTo(file) }]
      }
      if (edge.file && !parent.has(edge.file)) {
        parent.set(edge.file, file)
        queue.push(edge.file)
      }
    }
  }
  return []
}

function check(packagesDir, applicationDirs = [], entries = []) {
  const packages = loadWorkspacePackages(packagesDir)
  const scanned = [
    ...[...packages.values()].map(({ dir }) => path.join(dir, 'src')),
    ...applicationDirs,
  ]
  const roots = [...entries]
  for (const dir of scanned) {
    for (const file of collectSourceFiles(dir)) {
      if (valueImportsOf(file).directive === 'client') roots.push(file)
    }
  }
  const inventory = new Set()
  const findings = roots.flatMap((root) => walk(root, packages, inventory))
  return { roots, findings, inventory }
}

function report(findings) {
  console.error("A 'use client' module reaches server-only code:\n")
  for (const f of findings) {
    console.error(`  ${path.relative(repoRoot, f.root)} reaches ${f.reached} (${f.why})`)
    for (const step of f.chain.slice(1)) console.error(`    -> ${step}`)
    console.error(`    -> ${f.reached}`)
  }
  console.error(
    '\nwebpack cannot bundle that graph for the browser. Import the value from\n' +
      "'@opensaas/stack-core/client-safe' (or the narrowest subpath that does not reach\n" +
      'a server module), or move the code that needs it behind the server boundary.',
  )
}

const args = process.argv.slice(2)

if (args.includes('--self-test')) {
  const fixtures = path.join(repoRoot, 'scripts/client-server-graph/self-test/packages')
  const { roots, findings } = check(fixtures)
  const bad = new Set(findings.map((f) => path.basename(f.root)))
  const expectedBad = roots.map((r) => path.basename(r)).filter((name) => name.startsWith('bad-'))
  const problems = []
  for (const name of expectedBad) {
    if (!bad.has(name)) problems.push(`expected a finding for ${name}, got none`)
  }
  for (const name of bad) {
    if (!name.startsWith('bad-')) problems.push(`expected no finding for ${name}, got one`)
  }
  if (expectedBad.length === 0) problems.push('no bad-* roots found among the fixtures')
  if (problems.length > 0) {
    console.error('Self-test failed:\n')
    for (const problem of problems) console.error(`  - ${problem}`)
    report(findings)
    process.exit(1)
  }
  console.log(
    `Self-test passed: ${expectedBad.length} bad client graphs reported, ${roots.length - expectedBad.length} good ones cleared.`,
  )
  process.exit(0)
}

const { roots, findings, inventory } = check(
  path.join(repoRoot, 'packages'),
  APPLICATION_ROOTS.map((dir) => path.join(repoRoot, dir)),
  CLIENT_ENTRIES.map((file) => path.join(repoRoot, file)),
)

if (args.includes('--inventory')) {
  console.log(`Values the graphs of ${roots.length} client roots import from core:`)
  for (const line of [...inventory].sort()) console.log(`  ${line}`)
}

if (findings.length > 0) {
  report(findings)
  process.exit(1)
}

console.log(
  `No client module reaches server-only code (${roots.length} roots: 'use client' modules under packages/*/src, ${APPLICATION_ROOTS.join(', ')}, and ${CLIENT_ENTRIES.join(', ')}).`,
)
