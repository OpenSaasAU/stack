#!/usr/bin/env node
// Compiles every fenced TypeScript block in the markdown files listed in
// scripts/doc-blocks/files.txt against the built packages, reports a block that
// leans on the prelude for an import it should make itself, and compares any
// type a block redeclares under a shipped name against the package's own.
//
// Usage: pnpm build && pnpm check:doc-ts-blocks   (--json for the raw verdict,
//        --self-test to run the fixture in scripts/doc-blocks/self-test instead)
//
// Known limits
//
//   - Coverage is the file list, not the tree. A markdown file not named in
//     files.txt is never compiled, and nothing detects that a new one was
//     added.
//   - Fragment entries are keyed `file:line`. The orphan check catches a key
//     that has drifted off every block, but a key that drifts onto a different
//     block's first line still excuses that block instead.
//   - A fragment entry excuses only the diagnostics it names: an unresolved
//     bare name, or a `TSnnnn 'token'` code-and-token pair. Every other
//     diagnostic in the block fails it. A `{ "whole": … }` entry excuses every
//     compile diagnostic — that form is for a block that is not a statement
//     list at all (an object-literal body, a `...` elision) — and the summary
//     counts those blocks separately. No entry excuses a redeclared shipped
//     name from agreeing with the package, or an unimported name.
//   - `context.db` is the prelude's hand-written surface, not a generated one:
//     three lists (Article, Document, DocumentChunk) whose rows carry the
//     fields the listed prose uses. `where` and `orderBy` take the package's
//     untyped vocabulary rather than the list's own columns, so a misspelt key
//     in either is not a compile error; `include`, `distinct`, `distinctOn`
//     and `cursor` are not modelled, nor are `select`/`include` on a write.
//     `create` takes a fully partial `data`, because `CreateInput` requires a
//     member exactly where the contract shows a non-nullable column with no
//     default and no listed page declares one — a documented create omitting a
//     field a reader's own stricter list requires is therefore not a compile
//     error here. A wrong-cased or unknown list, a misspelt vector column, a
//     missing null check and a misspelt row field are compile errors. The
//     generated `SecuredList` cannot be used here because it is instantiated
//     from the emitted Prisma contract, which nothing but the generator can
//     write.
//   - `@opensaas/*` resolves through each package's own `exports` map, so a
//     subpath the package does not export fails for the checker as it fails
//     for a reader. Shadowing compares against every `types` entry of every
//     `packages/*/package.json`, and only at the block's own module scope: a
//     declaration nested in a function or a namespace is reported, not
//     compared. A `declare module '@opensaas/…'` in a block fails outright.
//   - A redeclared name exported by more than one specifier as different types
//     is compared against the specifiers the block imports from, or against
//     every one of them when it imports from none, and fails only when it
//     matches none.
//   - The comparison is a member-by-member diff computed from the checker:
//     member presence, optionality, `readonly` (declared, or introduced by a
//     mapped type such as `Readonly<>`), `any` against something narrower,
//     index signatures, call-signature arity, and each member's type —
//     recursing into object-typed members whether required or optional
//     (`T | undefined` and `T | null` are entered after their nullability is
//     compared) and into non-generic signatures, and falling back to
//     assignability in both directions at the leaves, for unions of more than
//     one object type, and for generic signatures. An intersection therefore
//     compares equal to its flattened spelling. What it does not see is
//     everything the type system does not carry — a `@default` that no longer
//     matches the code, a member whose name is right and whose meaning has
//     changed, an option documented as accepting a range the package narrows
//     only at runtime. Two declarations can compare equal and still document
//     the package wrongly.
//   - Type parameters: a parameter the block declares past the package's
//     arity is a difference, as is a parameter that has a default on one side
//     and none on the other; both fail. A parameter the package declares past
//     the block's arity is not — the block documents the default
//     instantiation — unless the package requires it, which bails. An
//     unused parameter is filled with `never`, whatever its constraint; a used
//     one with a fresh opaque type; a used one carrying a constraint other
//     than `unknown`/`any` cannot be filled and bails. Defaults are compared by
//     a second instantiation at the shared required arity when both sides
//     have optional parameters there.
//   - A member whose declared type does not resolve is skipped and reported,
//     and its siblings are still compared. The comparison bails only when the
//     type itself — a heritage clause, an intersection operand, a mapped-type
//     body — does not resolve, because an error type agrees with everything.
//   - A redeclaration the parser cannot fully read (a `...` elision inside its
//     body) is compared one way, over the members the parser recovered: an
//     invented or mistyped member still fails, a member the block elided does
//     not. The block is reported as compared with that note.
//   - Every bail is reported as `NOT COMPARED` with its reason and excluded
//     from the compared tally, and none of them fails the block.
//   - The package's side of a comparison is trusted to resolve. Every program
//     here sets `skipLibCheck`, so a `packages/*/dist` that is present but
//     internally broken degrades an export to an error type with no diagnostic,
//     and a wrong block then compares clean. The guard checks only that every
//     `exports[*].types` file exists (#1350).
//   - A `tsx` fence is extracted but never compiled — no `jsx` option is set
//     and React is not resolvable from the scratch project — so neither the
//     compile nor the import check runs on it. It is reported as `UNCHECKED`
//     and does not fail; a fragment entry on one is stale.
//   - A listed path that cannot be read fails by name. The one exception is
//     `.changeset/*`, which release consumes; that path is skipped and its
//     fixture keys are exempted from the orphan report along with it.
//   - A doc block whose code puts a diagnostic in a prelude — `declare global`
//     colliding with a prelude binding, say — aborts the run with exit 2.
//   - Block extraction is textual. The closing fence must match the opening
//     indent exactly; a block fenced with four backticks, or one whose fence
//     carries trailing whitespace, is extracted wrongly or not at all.
//   - A block compiles in isolation with the preludes in scope. It is not run.
//   - The scratch directory is removed on exit and on SIGINT/SIGTERM; a run
//     killed outright (SIGKILL) leaves one behind, which .gitignore covers.
//   - CI runs this on PRs into prisma-8 only; the gate and the instruction for
//     flipping it live together in .github/workflows/test.yml.

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import ts from 'typescript'

const repoRoot = path.resolve(fileURLToPath(import.meta.url), '../..')
const blocksDir = path.join(repoRoot, 'scripts', 'doc-blocks')
const selfTestFixture = 'scripts/doc-blocks/self-test/fixture.md'

const flags = new Set(process.argv.slice(2))
const jsonMode = flags.has('--json')
const selfTestMode = flags.has('--self-test')

class ToolingFailure extends Error {}

const toPosix = (p) => p.replace(/\\/g, '/')
const format = (d) => `TS${d.code}: ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`
const yieldToEventLoop = () => new Promise((resolve) => setImmediate(resolve))

// ---------------------------------------------------------------------------
// Inputs: the listed files and their fragment classifications.

function readListedFiles(listedPaths) {
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
  // fixture keys go with it. The path is normalised first: a raw prefix test
  // lets `.changeset/../docs/absent.md` inherit the exemption.
  const isChangeset = (relativePath) =>
    /^\.changeset\/[^/]+\.md$/.test(toPosix(path.normalize(relativePath)))
  return {
    sources,
    consumed: new Set(unreadable.filter(isChangeset)),
    missingFiles: unreadable.filter((relativePath) => !isChangeset(relativePath)),
    files: listedPaths.filter((relativePath) => sources.has(relativePath)),
  }
}

const EXCUSE = /^(?:TS\d+(?: '[^']+')?|[A-Za-z_$][\w$]*)$/

// An entry is `{ "whole": reason }` or `{ "excuses": [...], "reason"?: … }`;
// anything else is a tooling failure rather than a silently ignored key.
function parseFragments(raw, origin) {
  const fragments = new Map()
  for (const [key, value] of Object.entries(raw)) {
    const fail = (why) => {
      throw new ToolingFailure(`${origin}: entry for ${key} ${why}`)
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      fail('must be an object: { "whole": "reason" } or { "excuses": [...] }')
    }
    const keys = Object.keys(value).sort().join(',')
    if (keys === 'whole') {
      if (typeof value.whole !== 'string' || !value.whole.trim()) fail('has an empty "whole"')
      fragments.set(key, { whole: value.whole })
      continue
    }
    if (keys !== 'excuses' && keys !== 'excuses,reason') {
      fail(`has keys [${keys}]; expected "whole", or "excuses" with an optional "reason"`)
    }
    if (!Array.isArray(value.excuses) || value.excuses.length === 0) {
      fail('needs a non-empty "excuses" array')
    }
    for (const excuse of value.excuses) {
      if (typeof excuse !== 'string' || !EXCUSE.test(excuse)) {
        fail(
          `has an excuse ${JSON.stringify(excuse)} that is neither a bare name nor \`TSnnnn 'token'\``,
        )
      }
    }
    fragments.set(key, { excuses: value.excuses, reason: value.reason ?? null })
  }
  return fragments
}

const UNRESOLVED_NAME = /^TS(?:2304|2552|2593): Cannot find name '([^']+)'/

function excuseMatches(excuse, error) {
  const coded = excuse.match(/^(TS\d+)(?: '([^']+)')?$/)
  if (coded) {
    return error.startsWith(`${coded[1]}:`) && (!coded[2] || error.includes(`'${coded[2]}'`))
  }
  return error.match(UNRESOLVED_NAME)?.[1] === excuse
}

const describeFragment = (fragment) =>
  fragment.whole
    ? `whole: "${fragment.whole}"`
    : `excuses ${fragment.excuses.map((e) => `\`${e}\``).join(', ')}` +
      (fragment.reason ? ` — "${fragment.reason}"` : '')

// ---------------------------------------------------------------------------
// The packages: every `exports[*].types` of every @opensaas package is both a
// module the scratch project can resolve and a shadow-comparison target.

function typesEntry(value) {
  if (typeof value === 'string') return value.endsWith('.d.ts') ? value : null
  if (!value || typeof value !== 'object') return null
  if ('types' in value) return typesEntry(value.types)
  for (const key of ['import', 'default', 'require']) {
    if (key in value) {
      const found = typesEntry(value[key])
      if (found) return found
    }
  }
  return null
}

function discoverPackages() {
  const packages = []
  for (const dir of readdirSync(path.join(repoRoot, 'packages'))) {
    const manifestPath = path.join(repoRoot, 'packages', dir, 'package.json')
    if (!existsSync(manifestPath)) continue
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    if (!manifest.name?.startsWith('@opensaas/') || !manifest.exports) continue
    const entries = {}
    for (const [subpath, value] of Object.entries(manifest.exports)) {
      const types = typesEntry(value)
      if (!types || subpath.includes('*')) continue
      entries[`${manifest.name}${subpath.slice(1)}`] = path.join('packages', dir, types)
    }
    packages.push({ name: manifest.name, dir, entries })
  }
  return packages
}

const packages = discoverPackages()
const packageEntries = Object.assign({}, ...packages.map((p) => p.entries))

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

// ---------------------------------------------------------------------------
// Block extraction.

const FENCE = /^(\s*)```(typescript|ts|tsx)(?:\s+\S.*)?\s*$/
const MARKER =
  /^<!--\s*expect:\s*(fail|pass compared|pass not-compared|pass|excused)((?:\s+(?:excuses|whole)="[^"]*")*)\s*-->$/
const MARKER_ATTRIBUTE = /(excuses|whole)="([^"]*)"/g

function parseMarker(line) {
  const marker = line.match(MARKER)
  if (!marker) return null
  const attributes = Object.fromEntries(
    [...marker[2].matchAll(MARKER_ATTRIBUTE)].map(([, key, value]) => [key, value]),
  )
  let fragment = null
  if (attributes.whole) fragment = { whole: attributes.whole }
  else if (attributes.excuses) {
    fragment = { excuses: attributes.excuses.split(',').map((e) => e.trim()), reason: null }
  }
  return { verdict: marker[1], fragment }
}

function extractBlocks(relativePath, text) {
  const lines = text.split('\n')
  const blocks = []
  let heading = ''
  for (let i = 0; i < lines.length; i++) {
    const headingLine = lines[i].match(/^#+\s+(.*)$/)
    if (headingLine) heading = headingLine[1].trim()
    const fence = lines[i].match(FENCE)
    if (!fence) continue
    const indent = fence[1]
    let j = i + 1
    while (j < lines.length && lines[j] !== `${indent}\`\`\``) j++
    const body = lines.slice(i + 1, j).map((line) => line.slice(indent.length))
    let above = i - 1
    while (above > 0 && lines[above].trim() === '') above--
    blocks.push({
      file: relativePath,
      line: i + 2,
      language: fence[2],
      code: body.join('\n'),
      heading,
      expectation: above >= 0 ? parseMarker(lines[above].trim()) : null,
    })
    i = j
  }
  return blocks
}

// ---------------------------------------------------------------------------
// Type parameters, and what a block declares.

const constrains = (constraint) =>
  Boolean(constraint) &&
  constraint.kind !== ts.SyntaxKind.UnknownKeyword &&
  constraint.kind !== ts.SyntaxKind.AnyKeyword

function isTypeParameterUsed(declaration, parameter) {
  let used = false
  const visit = (node) => {
    if (used || node === parameter) return
    if (ts.isIdentifier(node) && node.text === parameter.name.text) used = true
    else ts.forEachChild(node, visit)
  }
  ts.forEachChild(declaration, visit)
  return used
}

function describeTypeParameters(declarations) {
  const declaration = declarations.find((d) => d.typeParameters?.length)
  return (declaration?.typeParameters ?? []).map((p) => ({
    optional: Boolean(p.default),
    constrained: constrains(p.constraint),
    used: isTypeParameterUsed(declaration, p),
  }))
}

const TYPE_SYMBOL =
  ts.SymbolFlags.Interface | ts.SymbolFlags.TypeAlias | ts.SymbolFlags.Class | ts.SymbolFlags.Enum

const resolveAlias = (checker, symbol) =>
  symbol.getFlags() & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol

const declarationKey = (declaration) =>
  `${toPosix(declaration.getSourceFile().fileName)}:${declaration.pos}`

// Every barrel in this repo re-exports with `export type { X } from './y.js'`,
// and those symbols carry only SymbolFlags.Alias, so the flag test is made on
// the alias target. The map is keyed by name and holds one candidate per
// distinct declaration, each with every specifier that exports it: a name two
// specifiers export as different types is two candidates.
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
      const target = resolveAlias(checker, symbol)
      const declarations = target.declarations ?? []
      if (!(target.getFlags() & TYPE_SYMBOL) || declarations.length === 0) continue
      const name = symbol.getName()
      const key = declarationKey(declarations[0])
      const candidates = names.get(name) ?? []
      const existing = candidates.find((c) => c.key === key)
      if (existing) existing.specifiers.push(specifier)
      else {
        candidates.push({
          key,
          specifiers: [specifier],
          typeParameters: describeTypeParameters(declarations),
        })
      }
      names.set(name, candidates)
    }
  }
  return names
}

// Which names a block declares is a question about TypeScript's grammar, so
// the parser answers it. Only the block's module scope can collide with the
// package's export, so those are what the probe compares; the rest of the tree
// is walked anyway, and a declaration below module scope is reported rather
// than passing unremarked. The colliding name is the one the module exports,
// which is not always the one it declared, so the export clause is read too —
// and the checker's own view of the module's exports is merged in afterwards,
// for the spellings that route through an import.
function findBlockDeclarations(code, scriptKind) {
  const source = ts.createSourceFile('block.ts', code, ts.ScriptTarget.ES2022, true, scriptKind)
  const declared = new Map()
  const nested = new Set()
  const exportedByOwnName = new Set()
  const exportedAs = new Map()
  const augmentations = []
  const specifiers = new Set()
  const record = (name, node, exported) => {
    const entry = declared.get(name) ?? { declarations: [], exported: false }
    entry.declarations.push(node)
    entry.exported ||= exported
    declared.set(name, entry)
  }
  const visit = (node, atModuleScope) => {
    if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      if (ts.isStringLiteral(node.argument.literal)) specifiers.add(node.argument.literal.text)
    }
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      specifiers.add(node.moduleSpecifier.text)
    }
    if (
      atModuleScope &&
      ts.isExportDeclaration(node) &&
      !node.moduleSpecifier &&
      node.exportClause &&
      ts.isNamedExports(node.exportClause)
    ) {
      for (const element of node.exportClause.elements) {
        const local = element.propertyName?.text ?? element.name.text
        if (local === element.name.text) exportedByOwnName.add(local)
        else exportedAs.set(element.name.text, local)
      }
      return
    }
    if (
      atModuleScope &&
      ts.isModuleDeclaration(node) &&
      ts.isStringLiteral(node.name) &&
      node.name.text.startsWith('@opensaas/')
    ) {
      const declares = []
      const collect = (inner) => {
        if (
          (ts.isTypeAliasDeclaration(inner) ||
            ts.isInterfaceDeclaration(inner) ||
            ts.isClassDeclaration(inner) ||
            ts.isEnumDeclaration(inner) ||
            ts.isFunctionDeclaration(inner) ||
            ts.isVariableStatement(inner)) &&
          'name' in inner &&
          inner.name
        ) {
          declares.push(inner.name.text)
        } else ts.forEachChild(inner, collect)
      }
      ts.forEachChild(node, collect)
      augmentations.push({ specifier: node.name.text, declares })
      return
    }
    const modifiers = ts.canHaveModifiers(node) ? (ts.getModifiers(node) ?? []) : []
    const exported =
      modifiers.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) &&
      !modifiers.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword)
    if (atModuleScope && ts.isImportEqualsDeclaration(node)) {
      if (ts.isExternalModuleReference(node.moduleReference)) {
        const expression = node.moduleReference.expression
        if (ts.isStringLiteral(expression)) specifiers.add(expression.text)
      }
      record(node.name.text, node, exported)
      return
    }
    const declares =
      ts.isTypeAliasDeclaration(node) ||
      ts.isInterfaceDeclaration(node) ||
      ts.isClassDeclaration(node) ||
      ts.isEnumDeclaration(node)
    if (declares && node.name) {
      if (!atModuleScope) nested.add(node.name.text)
      else record(node.name.text, node, exported)
    }
    ts.forEachChild(node, (child) => visit(child, false))
  }
  for (const statement of source.statements) visit(statement, true)

  const describe = (entry, exported) => ({
    typeParameters: describeTypeParameters(entry.declarations),
    spans: entry.declarations.map((d) => ({ start: d.getStart(source), end: d.getEnd() })),
    exported,
  })
  const moduleScope = new Map()
  for (const [name, entry] of declared) {
    moduleScope.set(name, describe(entry, entry.exported || exportedByOwnName.has(name)))
  }
  for (const [exportedName, local] of exportedAs) {
    const entry = declared.get(local)
    if (!entry || moduleScope.has(exportedName)) continue
    moduleScope.set(exportedName, describe(entry, true))
  }
  return {
    moduleScope,
    nestedOnly: [...nested].filter((name) => !moduleScope.has(name)),
    augmentations,
    specifiers,
  }
}

// The checker's view of what the block exports, resolved through every alias,
// so `import type { A as X } from '…'; export type { X as Shipped }` is seen
// as an export of `Shipped` whose declaration is `A`'s.
function exportedTypesOf(program, entry) {
  const checker = program.getTypeChecker()
  const source = program.getSourceFile(entry)
  const moduleSymbol = source && checker.getSymbolAtLocation(source)
  if (!moduleSymbol) return new Map()
  const entryName = toPosix(entry)
  const found = new Map()
  for (const symbol of checker.getExportsOfModule(moduleSymbol)) {
    const target = resolveAlias(checker, symbol)
    const declarations = target.declarations ?? []
    if (!(target.getFlags() & TYPE_SYMBOL) || declarations.length === 0) continue
    found.set(symbol.getName(), {
      typeParameters: describeTypeParameters(declarations),
      spans: declarations
        .filter((d) => toPosix(d.getSourceFile().fileName) === entryName)
        .map((d) => ({ start: d.getStart(), end: d.getEnd() })),
      exported: true,
    })
  }
  return found
}

function findShadowedNames(code, exportedTypes, { scriptKind = ts.ScriptKind.TS, program, entry }) {
  const { moduleScope, nestedOnly, augmentations, specifiers } = findBlockDeclarations(
    code,
    scriptKind,
  )
  if (program) {
    for (const [name, documented] of exportedTypesOf(program, entry)) {
      if (!moduleScope.has(name)) moduleScope.set(name, documented)
    }
  }
  const found = new Map()
  for (const [name, documented] of moduleScope) {
    const candidates = exportedTypes.get(name)
    if (!candidates) continue
    const imported = candidates.filter((c) => c.specifiers.some((s) => specifiers.has(s)))
    found.set(name, {
      candidates: imported.length > 0 ? imported : candidates,
      documented: documented.typeParameters,
      exported: documented.exported,
      spans: documented.spans,
    })
  }
  return {
    found,
    outOfScope: nestedOnly.filter((name) => exportedTypes.has(name)),
    augmentations,
  }
}

const requiredCount = (params) => params.filter((p) => !p.optional).length

// The probe instantiates both declarations with the same arguments, so each
// needs an argument list its own parameters accept. `never` satisfies any
// constraint, which is why an unused parameter never retires the comparison.
function planComparison(documented, shipped) {
  const differences = []
  if (documented.length > shipped.length) {
    differences.push(
      `the block declares ${documented.length} type parameter(s), the package ${shipped.length}`,
    )
  }
  const shared = Math.min(documented.length, shipped.length)
  for (let i = 0; i < shared; i++) {
    if (documented[i].optional !== shipped[i].optional) {
      const [has, lacks] = documented[i].optional ? ['block', 'package'] : ['package', 'block']
      differences.push(
        `type parameter ${i + 1} has a default in the ${has} and none in the ${lacks}`,
      )
    }
  }

  // Positions the two sides share take the same fresh type; a side's own
  // parameters past that either take `never` (unused), their default
  // (optional, so omitted along with everything after them), or cannot be
  // supplied at all.
  const argumentsFor = (params, count, fresh, pastCount) => {
    const args = []
    for (let i = 0; i < params.length; i++) {
      const p = params[i]
      if (!p.used) {
        args.push('never')
        continue
      }
      if (i >= count) {
        if (p.optional) break
        return { unfillable: pastCount(i + 1) }
      }
      if (p.constrained) {
        return { unfillable: 'its type parameters carry constraints the probe cannot fill' }
      }
      fresh.add(`P${i}`)
      args.push(`P${i}`)
    }
    return { args }
  }
  const instantiate = (label, count) => {
    const fresh = new Set()
    const own = argumentsFor(
      documented,
      count,
      fresh,
      (n) => `the block uses type parameter ${n}, past the package's ${shipped.length}`,
    )
    const theirs = argumentsFor(
      shipped,
      count,
      fresh,
      (n) => `the package requires type argument ${n}, which the block does not declare`,
    )
    if (own.unfillable || theirs.unfillable) {
      return { unfillable: own.unfillable ?? theirs.unfillable }
    }
    return { label, documented: own.args, shipped: theirs.args, fresh: [...fresh] }
  }

  const full = instantiate('', shared)
  if (full.unfillable) return { differences, instantiations: [], reason: full.unfillable }
  const instantiations = [full]
  const required = Math.max(
    requiredCount(documented.slice(0, shared)),
    requiredCount(shipped.slice(0, shared)),
  )
  if (required < shared) {
    const defaults = instantiate('at its default type arguments, ', required)
    if (!defaults.unfillable) instantiations.push(defaults)
  }
  return { differences, instantiations }
}

// ---------------------------------------------------------------------------
// The scratch project. It lives under packages/rag so a bare import a block
// makes — `vitest`, `zod` — resolves by walking up from there as it does for
// the package's own sources; `@types/node` comes from the explicit
// `typeRoots`, so the script runs from any cwd. node_modules/@opensaas holds
// symlinks to packages/* so `@opensaas/*` resolves through each package's own
// `exports` map.

let scratchDir = null
let preludePaths = []

function createScratch() {
  scratchDir = mkdtempSync(path.join(repoRoot, 'packages', 'rag', '.doc-blocks-check-'))
  const scopeDir = path.join(scratchDir, 'node_modules', '@opensaas')
  mkdirSync(scopeDir, { recursive: true })
  for (const { name, dir } of packages) {
    symlinkSync(
      path.join(repoRoot, 'packages', dir),
      path.join(scopeDir, name.split('/')[1]),
      'dir',
    )
  }
  // Copied in as `.ts`, not `.d.ts`: `skipLibCheck` is on — it has to be, for
  // Prisma's generated client — and it would skip a declaration file entirely,
  // including a prelude whose imports no longer resolve.
  for (const prelude of ['prelude', 'prelude-exports']) {
    writeFileSync(
      path.join(scratchDir, `${prelude}.ts`),
      readFileSync(path.join(blocksDir, `${prelude}.d.ts`), 'utf8'),
    )
  }
  preludePaths = ['prelude.ts', 'prelude-exports.ts'].map((f) => path.join(scratchDir, f))
}

function removeScratch() {
  if (scratchDir) rmSync(scratchDir, { recursive: true, force: true })
  scratchDir = null
}

// `finally` does not run on a signal. The handler removes the scratch
// directory and re-raises, so the exit status is still the signal's (130 for
// SIGINT); the per-block yield in runBlocks is what lets it run mid-check.
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    removeScratch()
    process.kill(process.pid, signal)
  })
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
  typeRoots: [path.join(repoRoot, 'node_modules', '@types')],
}

let checking = null

function runProgram(entryFiles, { withExports = true } = {}) {
  const preludes = withExports ? preludePaths : preludePaths.slice(0, 1)
  const program = ts.createProgram([...entryFiles, ...preludes], compilerOptions)
  const all = [...program.getSyntacticDiagnostics(), ...program.getSemanticDiagnostics()]
  // A diagnostic with no file is about the checker's own configuration — a
  // missing `@types/node`, a bad option — and would otherwise be filtered out
  // with the diagnostics that belong to other files.
  const global = [
    ...program.getOptionsDiagnostics(),
    ...program.getGlobalDiagnostics(),
    ...all.filter((d) => !d.file),
  ]
  if (global.length > 0) {
    throw new ToolingFailure(
      `the checker's own program is misconfigured:\n${global.map((d) => `  ${format(d)}`).join('\n')}`,
    )
  }
  // A prelude that fails to resolve a package degrades every binding it
  // declares to `any`, and then every block "passes". That must be loud.
  const preludeNames = new Set(preludes.map(toPosix))
  const inPrelude = all.filter((d) => preludeNames.has(toPosix(d.file.fileName)))
  if (inPrelude.length > 0) {
    throw new ToolingFailure(
      inPrelude.map((d) => `prelude ${path.basename(d.file.fileName)}: ${format(d)}`).join('\n') +
        `\n\nRaised while checking ${checking ?? 'the preludes'} — either the build is broken or ` +
        `that block's own code reaches into a prelude. Blocks after it did not run.`,
    )
  }
  return { program, diagnostics: all }
}

function diagnose(entryFiles, options) {
  const owned = new Set(entryFiles.map(toPosix))
  const { program, diagnostics } = runProgram(entryFiles, options)
  return {
    program,
    errors: diagnostics.filter((d) => owned.has(toPosix(d.file.fileName))).map(format),
  }
}

// `export {}` makes the block a module, so top-level `await` is legal and a
// local `const context` shadows the prelude's rather than colliding with it.
function compileBlock(code, options) {
  const entry = path.join(scratchDir, 'block.ts')
  writeFileSync(entry, `${code}\nexport {}\n`)
  return { entry, ...diagnose([entry], options) }
}

// Names the exports prelude supplied that the block did not import itself.
function findUnimportedExports(code, withPreludeErrors) {
  if (!/^\s*import\s/m.test(code)) return []
  const withPrelude = new Set(
    withPreludeErrors.map((d) => d.match(UNRESOLVED_NAME)?.[1]).filter(Boolean),
  )
  return [
    ...new Set(
      compileBlock(code, { withExports: false })
        .errors.map((d) => d.match(UNRESOLVED_NAME)?.[1])
        .filter((name) => name && !withPrelude.has(name)),
    ),
  ]
}

// ---------------------------------------------------------------------------
// The shadow probe.

const isErrorType = (type) =>
  Boolean(type.flags & ts.TypeFlags.Any) && type.intrinsicName === 'error'

const isMemberNode = (node) =>
  ts.isPropertySignature(node) ||
  ts.isMethodSignature(node) ||
  ts.isPropertyDeclaration(node) ||
  ts.isMethodDeclaration(node) ||
  ts.isGetAccessorDeclaration(node) ||
  ts.isSetAccessorDeclaration(node)

// Every type the block's declaration names is handed to the checker, which
// resolves through aliases, so `type Broken = NotReal` then `item: Broken`
// yields the error type at the reference. Each unresolved reference is
// attributed to the top-level member it sits inside, or to the type itself
// when it sits outside every member.
function findUnresolved(checker, sourceFile, spans) {
  const roots = []
  const collect = (node) => {
    if (
      spans.some(({ start, end }) => node.getStart(sourceFile) === start && node.getEnd() === end)
    )
      roots.push(node)
    else ts.forEachChild(node, collect)
  }
  ts.forEachChild(sourceFile, collect)

  const unresolved = new Map()
  const note = (text, member) => unresolved.set(`${member}\u0000${text}`, { text, member })
  const scan = (node, member) => {
    if (member === null && isMemberNode(node) && node.name && ts.isIdentifier(node.name)) {
      member = node.name.text
    }
    if (ts.isImportEqualsDeclaration(node)) {
      const local = checker.getSymbolAtLocation(node.name)
      const target = local && resolveAlias(checker, local)
      if (!target || (target.declarations ?? []).length === 0) {
        note(node.moduleReference.getText(sourceFile), member)
      }
      return
    }
    const names =
      ts.isTypeReferenceNode(node) ||
      ts.isExpressionWithTypeArguments(node) ||
      ts.isTypeQueryNode(node) ||
      ts.isImportTypeNode(node)
    if (names && isErrorType(checker.getTypeAtLocation(node))) {
      note(node.getText(sourceFile).split('\n')[0], member)
      return
    }
    ts.forEachChild(node, (child) => scan(child, member))
  }
  for (const root of roots) scan(root, null)
  return [...unresolved.values()]
}

const MAX_DEPTH = 8

// `readonly` lives on the declaration when written there and on the symbol's
// check flags when a mapped type such as `Readonly<>` introduced it. The
// check flags are not part of TypeScript's public API; when the build in use
// does not expose them, a mapped member's readonly-ness is reported as
// unread rather than assumed absent.
const checkFlagsOf =
  typeof ts.getCheckFlags === 'function' && ts.CheckFlags?.Readonly ? ts.getCheckFlags : null

function readonlyView(symbol) {
  const declared = (symbol.declarations ?? []).some(
    (d) => ts.getCombinedModifierFlags(d) & ts.ModifierFlags.Readonly,
  )
  if (declared) return true
  if (!(symbol.getFlags() & ts.SymbolFlags.Transient)) return false
  if (!checkFlagsOf) return null
  return Boolean(checkFlagsOf(symbol) & ts.CheckFlags.Readonly)
}

// The member-by-member diff that decides the comparison. Neither built-in
// relation answers the question on its own: assignability in both directions
// cannot see an optional member appear, and identity holds an intersection
// apart from its flattened spelling. `oneWay` is for a declaration the parser
// could not fully read: only what the block spells is held against the
// package, never the reverse.
function diffTypes(checker, documentedType, shippedType, location, { skip, oneWay = false }) {
  const differences = []
  const notes = []
  const seen = new Map()
  const str = (t) => checker.typeToString(t)
  const isAny = (t) => Boolean(t.flags & ts.TypeFlags.Any)
  const objectLike = (t) => Boolean(t.flags & (ts.TypeFlags.Object | ts.TypeFlags.Intersection))
  const label = (p) => (p ? `\`${p}\`` : 'the type')
  const typeOf = (symbol) => checker.getTypeOfSymbolAtLocation(symbol, location)
  const isOptional = (symbol) => Boolean(symbol.getFlags() & ts.SymbolFlags.Optional)
  const hasRest = (signature) => {
    const last = signature.parameters.at(-1)
    const declaration = last?.valueDeclaration
    return Boolean(declaration && ts.isParameter(declaration) && declaration.dotDotDotToken)
  }
  const visited = (own, theirs) => {
    const set = seen.get(own) ?? new Set()
    seen.set(own, set)
    if (set.has(theirs)) return true
    set.add(theirs)
    return false
  }
  const constituents = (t) => (t.flags & ts.TypeFlags.Union ? t.types : [t])
  const nullishness = (t) =>
    constituents(t)
      .filter((u) => u.flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Null))
      .map(str)
      .sort()
      .join(' | ')
  // Two aliases print as the same name; when they do, print what they name.
  const expanded = (t) =>
    checker.typeToString(
      t,
      undefined,
      ts.TypeFormatFlags.InTypeAlias | ts.TypeFormatFlags.NoTruncation,
    )
  const differ = (p, own, theirs) => {
    const [a, b] =
      str(own) === str(theirs) ? [expanded(own), expanded(theirs)] : [str(own), str(theirs)]
    differences.push(`${label(p)} is \`${a}\` in the block and \`${b}\` in the package`)
  }

  const compare = (own, theirs, p, depth) => {
    if (own === theirs) return
    if (isAny(own) || isAny(theirs)) {
      if (isAny(own) !== isAny(theirs)) differ(p, own, theirs)
      return
    }
    if (visited(own, theirs)) return
    if (objectLike(own) && objectLike(theirs) && depth < MAX_DEPTH) {
      compareMembers(own, theirs, p, depth)
      return
    }
    const ownBare = checker.getNonNullableType(own)
    const theirBare = checker.getNonNullableType(theirs)
    if (
      (ownBare !== own || theirBare !== theirs) &&
      objectLike(ownBare) &&
      objectLike(theirBare) &&
      depth < MAX_DEPTH
    ) {
      if (nullishness(own) !== nullishness(theirs)) differ(p, own, theirs)
      compareMembers(ownBare, theirBare, p, depth)
      return
    }
    if (!(checker.isTypeAssignableTo(own, theirs) && checker.isTypeAssignableTo(theirs, own))) {
      differ(p, own, theirs)
    }
  }

  const compareMembers = (own, theirs, p, depth) => {
    const at = (member) => (p ? `${p}.${member}` : member)
    const indexes = (t) =>
      new Map(checker.getIndexInfosOfType(t).map((i) => [str(i.keyType), str(i.type)]))
    const ownIndexes = indexes(own)
    const theirIndexes = indexes(theirs)
    const render = (m) =>
      [...m]
        .map(([k, v]) => `[${k}]: ${v}`)
        .sort()
        .join(', ') || 'none'
    const indexesDiffer = oneWay
      ? [...ownIndexes].some(([k, v]) => theirIndexes.get(k) !== v)
      : render(ownIndexes) !== render(theirIndexes)
    if (indexesDiffer) {
      differences.push(
        `${label(p)}'s index signatures are \`${render(ownIndexes)}\` in the block and ` +
          `\`${render(theirIndexes)}\` in the package`,
      )
    }
    const members = (t) =>
      new Map(
        checker
          .getPropertiesOfType(t)
          .filter((s) => !(depth === 0 && skip.has(s.getName())))
          .map((s) => [s.getName(), s]),
      )
    const ownMembers = members(own)
    const theirMembers = members(theirs)
    for (const member of ownMembers.keys()) {
      if (!theirMembers.has(member))
        differences.push(`the block declares \`${at(member)}\`, the package does not`)
    }
    if (!oneWay) {
      for (const member of theirMembers.keys()) {
        if (!ownMembers.has(member))
          differences.push(`the package declares \`${at(member)}\`, the block does not`)
      }
    }
    for (const [member, ownSymbol] of ownMembers) {
      const theirSymbol = theirMembers.get(member)
      if (!theirSymbol) continue
      if (isOptional(ownSymbol) !== isOptional(theirSymbol)) {
        differences.push(
          `\`${at(member)}\` is ${isOptional(ownSymbol) ? 'optional' : 'required'} in the ` +
            `block and ${isOptional(theirSymbol) ? 'optional' : 'required'} in the package`,
        )
      }
      const ownReadonly = readonlyView(ownSymbol)
      const theirReadonly = readonlyView(theirSymbol)
      if (ownReadonly === null || theirReadonly === null) {
        notes.push(
          `whether \`${at(member)}\` is readonly could not be read from a mapped type — ` +
            `this TypeScript build exposes no check flags`,
        )
      } else if (ownReadonly !== theirReadonly) {
        differences.push(
          `\`${at(member)}\` is ${ownReadonly ? '' : 'not '}readonly in the block ` +
            `and ${theirReadonly ? '' : 'not '}readonly in the package`,
        )
      }
      compare(typeOf(ownSymbol), typeOf(theirSymbol), at(member), depth + 1)
    }
    for (const [kind, word] of [
      [ts.SignatureKind.Call, 'call'],
      [ts.SignatureKind.Construct, 'construct'],
    ]) {
      const ownSignatures = checker.getSignaturesOfType(own, kind)
      const theirSignatures = checker.getSignaturesOfType(theirs, kind)
      if (ownSignatures.length !== theirSignatures.length) {
        if (oneWay && ownSignatures.length === 0) continue
        differences.push(
          `${label(p)} has ${ownSignatures.length} ${word} signature(s) in the block and ` +
            `${theirSignatures.length} in the package`,
        )
        continue
      }
      ownSignatures.forEach((ownSignature, index) =>
        compareSignature(ownSignature, theirSignatures[index], p, depth, word),
      )
    }
  }

  const compareSignature = (own, theirs, p, depth, word) => {
    const shape = (s) =>
      `${s.parameters.length} parameter(s), ${s.minArgumentCount} required` +
      `${hasRest(s) ? ', rest' : ''}, ${s.typeParameters?.length ?? 0} type parameter(s)`
    if (shape(own) !== shape(theirs)) {
      differences.push(
        `${label(p)}'s ${word} signature has ${shape(own)} in the block and ` +
          `${shape(theirs)} in the package`,
      )
      return
    }
    // A generic signature's parameters are typed by its own type parameters,
    // which differ by identity on the two sides; it is covered by the outer
    // assignability assertions instead.
    if (own.typeParameters?.length) return
    own.parameters.forEach((parameter, index) =>
      compare(
        typeOf(parameter),
        typeOf(theirs.parameters[index]),
        `${p}(${parameter.getName()})`,
        depth + 1,
      ),
    )
    compare(
      checker.getReturnTypeOfSignature(own),
      checker.getReturnTypeOfSignature(theirs),
      `${p}()`,
      depth + 1,
    )
  }

  compare(documentedType, shippedType, '', 0)
  return { differences, notes: [...new Set(notes)] }
}

const scratchPaths = (text) =>
  text.replaceAll(toPosix(scratchDir) + '/', '').replaceAll(scratchDir + path.sep, '')

// One probe function per instantiation the plan asks for. Each holds the two
// sides as parameters — so the checker hands back their types — asserts
// assignability both ways, and asserts identity on a line the diagnostics are
// attributed to separately.
function writeProbe(probe, name, specifier, plan) {
  const list = (args) => (args.length > 0 ? `<${args.join(', ')}>` : '')
  const lines = [
    `import type { ${name} as Documented } from './shadowed.js'`,
    `import type { ${name} as Shipped } from '${specifier}'`,
    `type Identical<X, Y> =`,
    `  (<T>() => T extends X ? 1 : 2) extends (<T>() => T extends Y ? 1 : 2) ? true : false`,
  ]
  const functions = []
  plan.instantiations.forEach((instantiation, index) => {
    const documented = `Documented${list(instantiation.documented)}`
    const shipped = `Shipped${list(instantiation.shipped)}`
    const identityLine = `  const same${index}: true = identical`
    const start = lines.join('\n').length + 1
    lines.push(
      `export function probe${index}${list(instantiation.fresh)}(`,
      `  documented: ${documented},`,
      `  shipped: ${shipped},`,
      `  identical: Identical<${documented}, ${shipped}>,`,
      `) {`,
      `  const a: ${shipped} = documented`,
      `  const b: ${documented} = shipped`,
      identityLine,
      `  return [a, b, same${index}]`,
      `}`,
    )
    const text = lines.join('\n')
    const identityStart = text.lastIndexOf(identityLine)
    functions.push({
      name: `probe${index}`,
      label: instantiation.label,
      start,
      end: text.length,
      identityStart,
      identityEnd: identityStart + identityLine.length,
    })
  })
  lines.push('')
  writeFileSync(probe, lines.join('\n'))
  return functions
}

function compileShadowProbe(code, name, specifier, alreadyExported, plan) {
  const subject = path.join(scratchDir, 'shadowed.ts')
  const probe = path.join(scratchDir, 'probe.ts')
  writeFileSync(subject, alreadyExported ? `${code}\n` : `${code}\nexport type { ${name} }\n`)
  const functions = writeProbe(probe, name, specifier, plan)

  const probeName = toPosix(probe)
  const { program, diagnostics } = runProgram([probe, subject])
  for (const fn of functions) {
    fn.notIdentical = false
    fn.assignability = []
  }
  for (const d of diagnostics) {
    if (toPosix(d.file.fileName) !== probeName) continue
    const fn = functions.find((f) => d.start >= f.start && d.start < f.end)
    if (!fn) continue
    if (d.start >= fn.identityStart && d.start < fn.identityEnd) fn.notIdentical = true
    else fn.assignability.push(format(d))
  }
  const subjectFile = program.getSourceFile(subject)
  const inDeclaration = program
    .getSyntacticDiagnostics(subjectFile)
    .filter((d) =>
      plan.spans.some((span) => d.start < span.end && d.start + (d.length ?? 0) > span.start),
    )
  const oneWay = inDeclaration.length > 0

  const checker = program.getTypeChecker()
  const unresolved = findUnresolved(checker, subjectFile, plan.spans)
  const whole = unresolved.find((u) => u.member === null)
  if (whole) {
    return {
      ran: false,
      reason:
        `the block's ${name} is declared in terms of \`${whole.text}\`, which does not resolve ` +
        `here — an error type agrees with anything in both directions`,
    }
  }
  const skipped = unresolved.map(
    (u) =>
      `\`${name}.${u.member}\` is declared in terms of \`${u.text}\`, which does not resolve here`,
  )
  if (oneWay) {
    skipped.push(
      `the block's declaration of ${name} does not parse in full (${format(inDeclaration[0])}), ` +
        `so only the members it spells are held against the package's`,
    )
  }
  const skip = new Set(unresolved.map((u) => u.member))

  const probeFile = program.getSourceFile(probe)
  const errors = []
  for (const fn of functions) {
    const declaration = probeFile.statements.find(
      (s) => ts.isFunctionDeclaration(s) && s.name?.text === fn.name,
    )
    const [documentedNode, shippedNode, identicalNode] = declaration.parameters
    const documentedType = checker.getTypeAtLocation(documentedNode)
    const shippedType = checker.getTypeAtLocation(shippedNode)
    if (isErrorType(documentedType) || isErrorType(shippedType)) {
      return { ran: false, reason: `one side of the ${name} comparison is an error type` }
    }
    const identity = checker.getTypeAtLocation(identicalNode)
    const identical =
      !fn.notIdentical &&
      !oneWay &&
      skip.size === 0 &&
      Boolean(identity.flags & ts.TypeFlags.BooleanLiteral)
    if (identical) continue
    const { differences, notes } = diffTypes(checker, documentedType, shippedType, documentedNode, {
      skip,
      oneWay,
    })
    skipped.push(...notes)
    if (differences.length > 0) {
      errors.push(`${fn.label}not the type the package declares — ${differences.join('; ')}`)
    } else if (fn.assignability.length > 0 && !oneWay) {
      errors.push(...fn.assignability.map((line) => `${fn.label}${scratchPaths(line)}`))
    }
  }
  return { errors, ran: true, skipped }
}

// ---------------------------------------------------------------------------
// One block.

function checkBlock(block, exportedTypes, fragments) {
  const key = `${block.file}:${block.line}`
  checking = key
  const base = {
    key,
    file: block.file,
    line: block.line,
    language: block.language,
    heading: block.heading,
    fragment: fragments.get(key) ?? null,
  }
  const describeCandidate = (c) => `${c.specifiers.join(' and ')}`

  // A tsx fence is recognised before anything compiles it: handing JSX to a
  // program with no `jsx` option produces a cascade of parse errors that say
  // nothing about the block. The parser still reads it, so a name it
  // redeclares is named as one this check did not compare.
  if (block.language === 'tsx') {
    const { found, outOfScope, augmentations } = findShadowedNames(block.code, exportedTypes, {
      scriptKind: ts.ScriptKind.TSX,
    })
    return {
      ...base,
      errors: [],
      unimported: [],
      unchecked: [
        'a tsx fence carries JSX, which this check sets no `jsx` option for — so it is ' +
          'neither compiled nor checked for imports it does not make',
      ],
      shadowed: [...found.keys()],
      compared: [],
      uncompared: [...found.keys(), ...outOfScope].map(
        (name) =>
          `${name} from ${exportedTypes.get(name).map(describeCandidate).join(', ')} — the ` +
          `block is a tsx fence, which this check does not compile`,
      ),
      partial: [],
      shadowErrors: augmentations.map(augmentationError),
    }
  }

  const compiled = compileBlock(block.code)
  const { found, outOfScope, augmentations } = findShadowedNames(block.code, exportedTypes, {
    program: compiled.program,
    entry: compiled.entry,
  })
  const shadowErrors = augmentations.map(augmentationError)
  const compared = []
  const partial = []
  const uncompared = outOfScope.map(
    (name) =>
      `${name} from ${exportedTypes.get(name).map(describeCandidate).join(', ')} — the parser ` +
      `placed its declaration below the block's module scope, where it cannot be compared`,
  )
  for (const [name, { candidates, documented, exported, spans }] of found) {
    const outcomes = []
    for (const candidate of candidates) {
      const where = describeCandidate(candidate)
      const plan = planComparison(documented, candidate.typeParameters)
      const errors = plan.differences.map((d) => `not the type the package declares — ${d}`)
      if (plan.instantiations.length === 0) {
        outcomes.push({ where, ran: false, reason: plan.reason, errors, skipped: [] })
        continue
      }
      const probe = compileShadowProbe(block.code, name, candidate.specifiers[0], exported, {
        ...plan,
        spans,
      })
      outcomes.push({
        where,
        ran: probe.ran,
        reason: probe.reason,
        errors: [...errors, ...(probe.errors ?? [])],
        skipped: probe.skipped ?? [],
      })
    }
    for (const o of outcomes.filter((o) => !o.ran)) {
      uncompared.push(`${name} from ${o.where} — ${o.reason}`)
    }
    if (outcomes.some((o) => o.ran)) compared.push(name)
    const matched = outcomes.find((o) => o.ran && o.errors.length === 0)
    if (matched) {
      for (const note of matched.skipped) partial.push(`${name} from ${matched.where} — ${note}`)
      continue
    }
    for (const o of outcomes) {
      for (const note of o.skipped) partial.push(`${name} from ${o.where} — ${note}`)
      for (const error of o.errors) shadowErrors.push(`shadows ${name} from ${o.where} — ${error}`)
    }
  }
  return {
    ...base,
    errors: compiled.errors,
    unimported: findUnimportedExports(block.code, compiled.errors),
    unchecked: [],
    shadowed: [...found.keys()],
    compared,
    uncompared,
    partial,
    shadowErrors,
  }
}

const augmentationError = ({ specifier, declares }) =>
  `declares the module '${specifier}' — the packages are resolved from their own built ` +
  `declarations, and a block cannot add to them` +
  (declares.length > 0 ? ` (it declares ${declares.join(', ')})` : '')

// ---------------------------------------------------------------------------
// Verdicts and reporting.

const isCompiled = (r) => r.unchecked.length === 0
const compiles = (r) => isCompiled(r) && r.errors.length === 0

const unexcusedErrors = (r) =>
  r.fragment
    ? r.errors.filter(
        (error) => !(r.fragment.whole || r.fragment.excuses.some((e) => excuseMatches(e, error))),
      )
    : r.errors
const staleExcuses = (r) => {
  if (!r.fragment) return []
  if (r.fragment.whole) {
    return r.errors.length === 0 ? ['classified as a whole-block fragment, but compiles'] : []
  }
  return r.fragment.excuses
    .filter((e) => !r.errors.some((error) => excuseMatches(e, error)))
    .map((e) => `excuse \`${e}\` matches no diagnostic in the block`)
}
const problems = (r) => [
  ...unexcusedErrors(r),
  ...r.shadowErrors,
  ...r.unimported.map((name) => `uses ${name} without importing it`),
]

// A fragment entry excuses the compile diagnostics it names. It never excuses
// a block from agreeing with the type it redeclares, or from importing what it
// uses, and an excuse that matches nothing is stale. A block this check never
// compiles is not one an entry can classify.
function verdictOf(result) {
  if (!isCompiled(result)) return result.fragment ? 'stale' : 'unchecked'
  if (problems(result).length > 0) return 'fail'
  if (!result.fragment) return 'clean'
  return staleExcuses(result).length > 0 ? 'stale' : 'excused'
}

function report(results, { fragments, consumed, missingFiles }) {
  const verdicts = results.map((result) => ({ ...result, verdict: verdictOf(result) }))
  const extracted = new Set(results.map((r) => r.key))
  const orphans = [...fragments.keys()].filter((key) => {
    if (extracted.has(key)) return false
    const separator = key.lastIndexOf(':')
    return !(separator > 0 && consumed.has(key.slice(0, separator)))
  })
  const count = (pick) => results.reduce((total, r) => total + pick(r).length, 0)
  const summary = {
    blocks: results.length,
    compiling: results.filter(compiles).length,
    notCompiled: results.filter((r) => !isCompiled(r)).length,
    classified: results.filter((r) => r.fragment).length,
    wholeBlock: results.filter((r) => r.fragment?.whole).length,
    stale: verdicts.filter((r) => r.verdict === 'stale').length,
    failing: verdicts.filter((r) => r.verdict === 'fail').length,
    compared: count((r) => r.compared),
    notCompared: count((r) => r.uncompared),
    orphans: orphans.length,
    missingFiles: missingFiles.length,
  }
  const ok =
    summary.failing === 0 &&
    summary.stale === 0 &&
    orphans.length === 0 &&
    missingFiles.length === 0
  return { verdicts, orphans, summary, ok }
}

const comparedLine = (summary) =>
  `Redeclared exported names: ${summary.compared} compared against the package, ` +
  `${summary.notCompared} not compared.`

function printReport({ verdicts, orphans, summary, ok }, { fragments, missingFiles }) {
  for (const relativePath of missingFiles) {
    console.error(`MISSING ${relativePath} — listed in files.txt but could not be read`)
  }
  for (const result of verdicts) {
    if (result.verdict === 'stale') {
      console.error(
        isCompiled(result)
          ? `STALE  ${result.key} — fragments.json ${describeFragment(result.fragment)}:`
          : `STALE  ${result.key} — never compiled, so fragments.json cannot classify it:`,
      )
      for (const line of staleExcuses(result)) console.error(`         ${line}`)
    }
    if (result.verdict !== 'fail') continue
    const tag = result.shadowed.length > 0 ? ` (redeclares ${result.shadowed.join(', ')})` : ''
    console.error(`FAIL   ${result.key}${tag}`)
    for (const error of problems(result)) console.error(`         ${error}`)
    for (const line of staleExcuses(result)) console.error(`         (stale) ${line}`)
  }
  // Advisories go to stderr beside the failures: what was not compiled, what
  // was not compared, and what was compared only in part.
  for (const result of verdicts) {
    for (const note of result.unchecked) console.error(`UNCHECKED ${result.key} — ${note}`)
    for (const note of result.uncompared) console.error(`NOT COMPARED ${result.key} — ${note}`)
    for (const note of result.partial) console.error(`PARTIAL ${result.key} — ${note}`)
  }
  for (const key of orphans) {
    console.error(`ORPHAN ${key} — fragments.json classifies no block at that line:`)
    console.error(`         ${describeFragment(fragments.get(key))}`)
  }
  console.log(
    `${summary.blocks} blocks: ${summary.compiling} compile, ${summary.notCompiled} not compiled; ` +
      `${summary.classified} carry a fragment entry (${summary.wholeBlock} whole-block, ` +
      `${summary.stale} stale). ${comparedLine(summary)}`,
  )
  if (!ok) {
    console.error(
      `\n${summary.failing} failing, ${summary.stale} stale and ${orphans.length} orphaned ` +
        `classification(s), ${missingFiles.length} listed file(s) missing.`,
    )
  }
}

// ---------------------------------------------------------------------------
// Modes.

// The checker's work is synchronous; the yield between blocks is what gives a
// pending signal handler its turn.
async function runBlocks(files, sources, exportedTypes, fragments) {
  const results = []
  for (const file of files) {
    for (const block of extractBlocks(file, sources.get(file))) {
      results.push(checkBlock(block, exportedTypes, fragments))
      await yieldToEventLoop()
    }
  }
  return results
}

async function realRun(exportedTypes) {
  const listedPaths = readFileSync(path.join(blocksDir, 'files.txt'), 'utf8')
    .split('\n')
    .map((line) => line.replace(/#.*$/, '').trim())
    .filter(Boolean)
  const fragments = parseFragments(
    JSON.parse(readFileSync(path.join(blocksDir, 'fragments.json'), 'utf8')),
    'scripts/doc-blocks/fragments.json',
  )
  const { sources, consumed, missingFiles, files } = readListedFiles(listedPaths)
  const results = await runBlocks(files, sources, exportedTypes, fragments)
  const reported = report(results, { fragments, consumed, missingFiles })
  if (jsonMode) {
    console.log(
      JSON.stringify(
        {
          ok: reported.ok,
          summary: reported.summary,
          results: reported.verdicts,
          orphans: reported.orphans,
          missingFiles,
        },
        null,
        2,
      ),
    )
  } else {
    printReport(reported, { fragments, missingFiles })
  }
  return reported.ok ? 0 : 1
}

// What each fixture marker demands of the block's result. `pass compared`
// and `excused` insist that every shipped name the block redeclares was
// actually compared — a bail on a known-good block is a mismatch, not a pass.
const EXPECTATIONS = {
  fail: (r) => r.verdict === 'fail',
  pass: (r) => r.verdict === 'clean' && r.shadowed.length === 0,
  'pass compared': (r) =>
    r.verdict === 'clean' &&
    r.shadowed.length > 0 &&
    r.compared.length === r.shadowed.length &&
    r.uncompared.length === 0,
  'pass not-compared': (r) => r.verdict === 'clean' && r.uncompared.length > 0,
  excused: (r) =>
    r.verdict === 'excused' && r.compared.length === r.shadowed.length && r.uncompared.length === 0,
}

async function selfTest(exportedTypes) {
  const { sources, consumed, missingFiles, files } = readListedFiles([selfTestFixture])
  if (missingFiles.length > 0)
    throw new ToolingFailure(`self-test fixture missing: ${selfTestFixture}`)
  const blocks = extractBlocks(selfTestFixture, sources.get(selfTestFixture))
  const fragments = new Map()
  for (const block of blocks) {
    if (block.expectation?.fragment) {
      fragments.set(`${block.file}:${block.line}`, block.expectation.fragment)
    }
  }
  const results = await runBlocks(files, sources, exportedTypes, fragments)
  const reported = report(results, { fragments, consumed, missingFiles })
  const expectations = new Map(blocks.map((b) => [`${b.file}:${b.line}`, b.expectation]))
  let mismatches = 0
  const rows = []
  for (const result of reported.verdicts) {
    const expected = expectations.get(result.key)
    const met = expected ? EXPECTATIONS[expected.verdict](result) : false
    if (!met) mismatches++
    const got =
      result.verdict +
      (result.shadowed.length > 0
        ? ` (compared ${result.compared.length}/${result.shadowed.length}` +
          `${result.uncompared.length > 0 ? `, ${result.uncompared.length} not compared` : ''})`
        : '')
    rows.push(
      `${met ? 'ok      ' : 'MISMATCH'} expected ${expected?.verdict ?? '(no marker)'}, got ` +
        `${got}  ${result.key}  ${result.heading}`,
    )
    if (!met) {
      for (const line of [...problems(result), ...staleExcuses(result), ...result.uncompared]) {
        rows.push(`           ${line}`)
      }
    }
  }
  const tally = Object.keys(EXPECTATIONS)
    .map((verdict) => {
      const n = blocks.filter((b) => b.expectation?.verdict === verdict).length
      return n > 0 ? `${n} ${verdict}` : null
    })
    .filter(Boolean)
    .join(', ')
  console.log(rows.join('\n'))
  console.log(
    `\nself-test: ${blocks.length} blocks — expected ${tally}; ` +
      `${comparedLine(reported.summary)} ${mismatches} mismatch(es).`,
  )
  return mismatches === 0 ? 0 : 1
}

async function main() {
  try {
    createScratch()
    const exportedTypes = collectExportedTypes()
    await yieldToEventLoop()
    return selfTestMode ? await selfTest(exportedTypes) : await realRun(exportedTypes)
  } catch (error) {
    if (!(error instanceof ToolingFailure)) throw error
    console.error(error.message)
    return 2
  } finally {
    checking = null
    removeScratch()
  }
}

process.exit(await main())
