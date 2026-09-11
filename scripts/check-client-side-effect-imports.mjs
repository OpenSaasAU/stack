#!/usr/bin/env node
// Fails when a server module imports a local `'use client'` module for its side
// effects alone. Next.js only evaluates a `'use client'` module where something
// in the tree renders it, so `import '@/lib/register-fields'` from a server
// component never runs in the browser: the registration it exists for silently
// does not happen. See issue #1172 and the FieldRegistration components under
// examples/*/app/admin/.
//
// Usage: pnpm check:client-side-effect-imports
//        --self-test  runs the fixtures in scripts/client-side-effect-imports/
//                     self-test instead of the repository, asserting the
//                     checker reports the bad shape and clears the good one.
//
// Known limits
//
//   - Roots are examples/ and packages/create-opensaas-app/templates/, not the
//     whole tree. Application code under packages/*/src is not scanned.
//   - Only a *bare* side-effect import is a finding. `import { x } from './m'`
//     against a `'use client'` module is the supported boundary and is ignored,
//     as is a side-effect import of a package (non-relative, non-`@/`) whose
//     source this checker does not resolve.
//   - The importer is judged by its own first directive only. A server module
//     that is itself reached solely from a client module is still reported;
//     that shape is rare and worth an explicit `'use client'` anyway.
//   - Resolution tries the literal path then `.ts`/`.tsx`/`.js`/`.jsx` and an
//     `index.*` under it. A path alias other than the `@/` root convention
//     these projects use is not resolved and so is not checked.

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const repoRoot = path.resolve(fileURLToPath(import.meta.url), '../..')

const SCAN_ROOTS = ['examples', 'packages/create-opensaas-app/templates']
const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mts', '.mjs']
const SKIP_DIRECTORIES = new Set(['node_modules', '.next', 'dist', '.opensaas', '.turbo'])

function collectSourceFiles(dir, found = []) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return found
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.') && entry.name !== '.opensaas') {
      if (entry.isDirectory()) continue
    }
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (SKIP_DIRECTORIES.has(entry.name)) continue
      collectSourceFiles(full, found)
    } else if (SOURCE_EXTENSIONS.includes(path.extname(entry.name))) {
      found.push(full)
    }
  }
  return found
}

// The directive counts only when it leads the module, so skip comments and
// blank lines and then require it at the very first statement position.
function isClientModule(source) {
  const body = source.replace(/^(?:\s+|\/\/[^\n]*|\/\*[\s\S]*?\*\/)*/, '')
  return /^(['"])use client\1\s*;?/.test(body)
}

function resolveLocalImport(specifier, importerFile, projectRoot) {
  let base
  if (specifier.startsWith('@/')) {
    if (!projectRoot) return null
    base = path.join(projectRoot, specifier.slice(2))
  } else if (specifier.startsWith('.')) {
    base = path.resolve(path.dirname(importerFile), specifier)
  } else {
    return null
  }

  const candidates = [base]
  for (const ext of SOURCE_EXTENSIONS) candidates.push(base + ext)
  for (const ext of SOURCE_EXTENSIONS) candidates.push(path.join(base, 'index' + ext))
  // A published-form specifier ('./m.js') whose source is TypeScript.
  const withoutJs = base.replace(/\.js$/, '')
  if (withoutJs !== base) {
    candidates.push(withoutJs + '.ts', withoutJs + '.tsx')
  }

  for (const candidate of candidates) {
    try {
      if (statSync(candidate).isFile()) return candidate
    } catch {
      /* next candidate */
    }
  }
  return null
}

// The nearest ancestor holding a package.json is what `@/` is rooted at.
function findProjectRoot(file) {
  let dir = path.dirname(file)
  for (;;) {
    try {
      if (statSync(path.join(dir, 'package.json')).isFile()) return dir
    } catch {
      /* keep walking */
    }
    const parent = path.dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

const SIDE_EFFECT_IMPORT = /^[^\S\n]*import\s+(['"])([^'"]+)\1[^\S\n]*;?[^\S\n]*$/gm

function findViolations(roots) {
  const violations = []
  for (const root of roots) {
    for (const file of collectSourceFiles(root)) {
      const source = readFileSync(file, 'utf8')
      if (isClientModule(source)) continue

      const projectRoot = findProjectRoot(file)
      SIDE_EFFECT_IMPORT.lastIndex = 0
      let match
      while ((match = SIDE_EFFECT_IMPORT.exec(source)) !== null) {
        const specifier = match[2]
        const resolved = resolveLocalImport(specifier, file, projectRoot)
        if (!resolved) continue
        if (!isClientModule(readFileSync(resolved, 'utf8'))) continue
        violations.push({
          file: path.relative(repoRoot, file),
          line: source.slice(0, match.index).split('\n').length,
          specifier,
          target: path.relative(repoRoot, resolved),
        })
      }
    }
  }
  return violations
}

function report(violations) {
  console.error("A server module imports a 'use client' module for side effects only:\n")
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}`)
    console.error(`    import '${v.specifier}'  ->  ${v.target}`)
  }
  console.error(
    "\nNext.js evaluates a 'use client' module only where the tree renders it, so this\n" +
      'import does nothing in the browser. Move it into a client component and render\n' +
      'that component — see examples/tiptap-demo/app/admin/[[...admin]]/FieldRegistration.tsx.',
  )
}

const selfTest = process.argv.includes('--self-test')

if (selfTest) {
  const fixtures = path.join(repoRoot, 'scripts/client-side-effect-imports/self-test')
  const found = findViolations([path.join(fixtures, 'bad'), path.join(fixtures, 'good')])
  const bad = found.filter((v) => v.file.includes('/bad/'))
  const good = found.filter((v) => v.file.includes('/good/'))

  const problems = []
  if (bad.length !== 3) {
    problems.push(`expected 3 findings under bad/, got ${bad.length}: ${JSON.stringify(bad)}`)
  }
  if (good.length !== 0) {
    problems.push(`expected 0 findings under good/, got ${good.length}: ${JSON.stringify(good)}`)
  }

  if (problems.length > 0) {
    console.error('Self-test failed:\n')
    for (const problem of problems) console.error(`  - ${problem}`)
    process.exit(1)
  }
  console.log(`Self-test passed: 3 bad shapes reported, 0 good shapes reported.`)
  process.exit(0)
}

const violations = findViolations(SCAN_ROOTS.map((r) => path.join(repoRoot, r)))

if (violations.length > 0) {
  report(violations)
  process.exit(1)
}

console.log(
  `No side-effect-only imports of 'use client' modules from server modules (${SCAN_ROOTS.join(', ')}).`,
)
