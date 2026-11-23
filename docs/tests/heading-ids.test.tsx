import assert from 'node:assert/strict'
import test from 'node:test'
import { renderToStaticMarkup } from 'react-dom/server'
import React from 'react'
import Markdoc from '@markdoc/markdoc'
import { extractHeadings, markdocConfig } from '../lib/markdoc'

const source = '## Tooling: CLI + agent plugin\n\n### `db.indexes` option\n'

test('headings carry the id extractHeadings computes', () => {
  const tree = Markdoc.transform(Markdoc.parse(source), markdocConfig)
  const html = renderToStaticMarkup(Markdoc.renderers.react(tree, React) as React.ReactElement)
  for (const { id } of extractHeadings(source)) {
    assert.ok(html.includes(`id="${id}"`), `missing id ${id} in ${html}`)
  }
})

test('an explicit id annotation is kept', () => {
  const tree = Markdoc.transform(Markdoc.parse('## Title {% #custom %}\n'), markdocConfig)
  const html = renderToStaticMarkup(Markdoc.renderers.react(tree, React) as React.ReactElement)
  assert.ok(html.includes('id="custom"'), html)
})

test('duplicate headings get numeric suffixes, in the page and the table of contents', () => {
  const dup = '## Hooks\n\n## Hooks\n\n## Hooks\n'
  const tree = Markdoc.transform(Markdoc.parse(dup), markdocConfig)
  const html = renderToStaticMarkup(Markdoc.renderers.react(tree, React) as React.ReactElement)
  const ids = extractHeadings(dup).map((h) => h.id)
  assert.deepEqual(ids, ['hooks', 'hooks-1', 'hooks-2'])
  for (const id of ids) assert.ok(html.includes(`id="${id}"`), html)
})
