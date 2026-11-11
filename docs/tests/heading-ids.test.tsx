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
