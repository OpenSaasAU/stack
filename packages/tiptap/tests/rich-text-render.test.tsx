import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import type { JSONContent } from '@tiptap/react'
import { RichTextContent } from '../src/render/index.js'
import type { RichTextFeatures } from '../src/features/features.js'

function html(value: unknown, features?: RichTextFeatures): string {
  const { container } = render(<RichTextContent value={value} features={features} />)
  return container.innerHTML
}

const doc = (...content: JSONContent[]): JSONContent => ({ type: 'doc', content })
const p = (...content: JSONContent[]): JSONContent => ({ type: 'paragraph', content })
const t = (text: string, marks?: JSONContent['marks']): JSONContent => ({
  type: 'text',
  text,
  marks,
})

describe('RichTextContent', () => {
  it('renders default-feature nodes and marks', () => {
    const out = html(
      doc(
        { type: 'heading', attrs: { level: 2 }, content: [t('Title')] },
        p(t('hi', [{ type: 'bold' }])),
      ),
    )
    expect(out).toContain('<h2>Title</h2>')
    expect(out).toContain('<strong>hi</strong>')
  })

  it('drops nodes and marks outside the feature set without throwing', () => {
    const out = html(
      doc(
        { type: 'codeBlock', content: [t('secret')] },
        { type: 'script', content: [t('x')] },
        p(t('kept', [{ type: 'underline' }, { type: 'bold' }])),
      ),
    )
    expect(out).not.toContain('<pre')
    expect(out).not.toContain('secret')
    expect(out).not.toContain('<u>')
    expect(out).toContain('<strong>kept</strong>')
  })

  it('drops a heading whose level is not allowed', () => {
    const out = html(doc({ type: 'heading', attrs: { level: 5 }, content: [t('no')] }), {
      heading: { levels: [2] },
    })
    expect(out).not.toContain('<h')
  })

  it('renders an allowed link with pinned target and rel', () => {
    const out = html(
      doc(p(t('a', [{ type: 'link', attrs: { href: 'https://x.dev', onclick: 'x()' } }]))),
      {
        link: {},
      },
    )
    expect(out).toContain('href="https://x.dev"')
    expect(out).toContain('rel="noopener noreferrer nofollow"')
    expect(out).not.toContain('onclick')
  })

  it.each([
    'javascript:alert(1)',
    '/relative',
    '//evil.example',
    '/\\evil.example',
    '/&#47;evil.example',
  ])('re-applies the link policy at render time: %s', (href) => {
    const out = html(doc(p(t('a', [{ type: 'link', attrs: { href } }]))), {
      link: { allowRelative: href === '/relative' ? false : true },
    })
    expect(out).not.toContain('<a')
    expect(out).toContain('>a<')
  })

  it('keeps a relative link under allowRelative', () => {
    const out = html(doc(p(t('a', [{ type: 'link', attrs: { href: '/about' } }]))), {
      link: { allowRelative: true },
    })
    expect(out).toContain('href="/about"')
  })

  it('renders nothing for a non-document', () => {
    expect(html(null)).toBe('')
    expect(html('text')).toBe('')
    expect(html({ type: 'paragraph' })).toBe('')
  })

  it('escapes text rather than injecting markup', () => {
    const out = html(doc(p(t('<img src=x onerror=alert(1)>'))))
    expect(out).not.toContain('<img')
  })
})
