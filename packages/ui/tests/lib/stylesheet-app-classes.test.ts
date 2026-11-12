import { readdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { compile } from 'tailwindcss'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const root = join(import.meta.dirname, '../..')
const repo = join(root, '../..')

const stylesheet = readFileSync(join(root, 'dist/styles/globals.css'), 'utf8')

const appDirectories = [
  ...readdirSync(join(repo, 'examples')).map((name) => join(repo, 'examples', name)),
  ...['auth', 'tiptap', 'storage', 'rag'].map((name) => join(repo, 'packages', name, 'src')),
]

const skipped = new Set(['node_modules', '.next', '.opensaas', 'dist', '.turbo'])

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true, encoding: 'utf8' }).flatMap((entry) => {
    if (skipped.has(entry.name)) return []
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return /\.(tsx|html)$/.test(entry.name) ? [path] : []
  })
}

const candidates = new Set(
  appDirectories
    .flatMap((directory) => {
      try {
        return sourceFiles(directory)
      } catch {
        return []
      }
    })
    .flatMap((file) => readFileSync(file, 'utf8').match(/[\w:.\-/[\]()%*,#!&@]+/g) ?? []),
)

const compiler = await compile('@import "tailwindcss";', {
  base: root,
  loadStylesheet: async (id, base) => {
    const path = require.resolve(id === 'tailwindcss' ? 'tailwindcss/index.css' : id, {
      paths: [base],
    })
    return { path, base, content: readFileSync(path, 'utf8') }
  },
})

const asSelector = (className: string) =>
  `.${className.replace(/[^\w-]/g, (character) => `\\${character}`)}`

const defines = (css: string, className: string) =>
  new RegExp(`${asSelector(className).replace(/[\\^$.*+?()[\]{}|]/g, '\\$&')}(?![\\w-])`).test(css)

const generated = [...candidates].filter((className) =>
  defines(compiler.build([className]), className),
)

const missing = generated.filter((className) => !defines(stylesheet, className))

// Classes apps use that the stylesheet never carried.
const knownMissing: string[] = JSON.parse(
  readFileSync(join(import.meta.dirname, 'stylesheet-known-missing.json'), 'utf8'),
)

describe('the prebuilt stylesheet against the classes apps use', () => {
  it('finds the classes apps use', () => {
    expect(generated.length).toBeGreaterThan(100)
    expect(generated).toContain('min-h-screen')
  })

  it('has lost no class that an app uses', () => {
    expect(missing.filter((className) => !knownMissing.includes(className))).toEqual([])
  })
})
