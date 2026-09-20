import assert from 'node:assert/strict'
import test from 'node:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { CodeBlockServer } from '../components/CodeBlockServer'
import { highlightCode } from '../lib/markdoc'

test('renders env fences with syntax highlighting', async () => {
  const html = renderToStaticMarkup(
    await CodeBlockServer({
      content: 'DATABASE_URL=postgres://localhost/opensaas',
      language: 'env',
    }),
  )

  assert.match(html, /class="shiki shiki-themes github-light github-dark"/)
  assert.match(html, /--shiki-light:/)
  assert.match(html, /--shiki-dark:/)
})

test('renders text fences with themed Shiki markup', async () => {
  const html = renderToStaticMarkup(
    await CodeBlockServer({
      content: 'plain documentation output',
      language: 'text',
    }),
  )

  assert.match(html, /class="shiki shiki-themes github-light github-dark"/)
  assert.match(html, /--shiki-light:/)
  assert.match(html, /--shiki-dark:/)
})

test('renders ANSI fences as colored Shiki tokens', async () => {
  const html = renderToStaticMarkup(
    await CodeBlockServer({
      content: '\u001b[31merror\u001b[0m',
      language: 'ansi',
    }),
  )

  assert.equal(html.includes('\u001b'), false)
  assert.match(html, /<span style="--shiki-light:#[\da-f]+;--shiki-dark:#[\da-f]+">error<\/span>/)
})

test('renders unknown-language fences as escaped plain text', async () => {
  const html = renderToStaticMarkup(
    await CodeBlockServer({
      content: '<script>alert("unsafe")</script>',
      language: 'unknown"><img src=x onerror="alert(1)',
    }),
  )

  assert.doesNotMatch(html, /<script>|<img/)
  assert.match(html, /&lt;script&gt;alert\(&quot;unsafe&quot;\)&lt;\/script&gt;/)
})

test('escapes plain-text fallback returned by the Markdoc highlighting helper', async () => {
  const html = await highlightCode('<img src=x onerror="alert(1)">', 'unknown-language')

  assert.doesNotMatch(html, /<img/)
  assert.match(html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/)
})
