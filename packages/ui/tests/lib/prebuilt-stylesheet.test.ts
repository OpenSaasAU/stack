import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = join(import.meta.dirname, '../..')
const stylesheet = readFileSync(join(root, 'dist/styles/globals.css'), 'utf8')

const sources = readdirSync(join(root, 'src'), { recursive: true, encoding: 'utf8' })
  .filter((file) => /\.tsx?$/.test(file))
  .map((file) => readFileSync(join(root, 'src', file), 'utf8'))

const responsiveClasses = [
  ...new Set(
    sources.flatMap((source) => source.match(/(?<![\w-])(?:max-)?md:[\w./:[\]()%*,-]+/g) ?? []),
  ),
]

const asSelector = (className: string) =>
  `.${className.replace(/[^\w-]/g, (character) => `\\${character}`)}`

// An app with no Tailwind of its own gets only `@opensaas/stack-ui/styles`: a
// class missing from it does nothing there, silently.
describe('the prebuilt stylesheet', () => {
  it('finds the responsive classes to check', () => {
    expect(responsiveClasses).toEqual(
      expect.arrayContaining(['md:contents', 'max-md:**:scroll-mt-24']),
    )
  })

  it.each(responsiveClasses)('carries %s', (className) => {
    expect(stylesheet).toContain(asSelector(className))
  })
})
