import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ThemeScript } from '../../src/components/ThemeScript.js'
import { themeInitScript } from '../../src/lib/theme-mode.js'

// External behaviour only: the server-rendered `<script>` markup, which is what
// a strict nonce-based `script-src` CSP evaluates. ThemeScript is a server-safe
// element with no client runtime, so the rendered output is the whole contract.

describe('ThemeScript', () => {
  it('emits no nonce attribute when the prop is omitted', () => {
    const html = renderToStaticMarkup(<ThemeScript />)
    expect(html).not.toContain('nonce')
    // The flash-prevention script itself is always present, unchanged.
    expect(html).toContain(themeInitScript)
  })

  it('forwards the given value to the script nonce attribute when provided', () => {
    const html = renderToStaticMarkup(<ThemeScript nonce="abc123==" />)
    expect(html).toContain('nonce="abc123=="')
    // The script body never interpolates the nonce — only the attribute carries it.
    expect(html).toContain(themeInitScript)
    expect(themeInitScript).not.toContain('abc123==')
  })
})
