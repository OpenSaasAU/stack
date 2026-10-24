import { describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import { z } from 'zod'
import { richText } from '../src/fields/richText.js'
import {
  defaultRichTextFeatures,
  richTextExtensions,
  type RichTextFeatures,
} from '../src/features/features.js'

function parse(features: RichTextFeatures | undefined, value: unknown) {
  const field = richText(features ? { features } : undefined)
  const schema = z.object({ content: field.getZodSchema!('content', 'create') })
  return schema.safeParse({ content: value })
}

const accepts = (features: RichTextFeatures | undefined, value: unknown) =>
  parse(features, value).success

const doc = (...content: unknown[]) => ({ type: 'doc', content })
const para = (...content: unknown[]) => ({ type: 'paragraph', content })
const text = (value: string, marks?: unknown[]) => ({
  type: 'text',
  text: value,
  ...(marks && { marks }),
})
const link = (attrs: Record<string, unknown>) => ({ type: 'link', attrs })
const linked = (attrs: Record<string, unknown>) => doc(para(text('x', [link(attrs)])))

const withLink: RichTextFeatures = { ...defaultRichTextFeatures, link: {} }

describe('feature set enforcement', () => {
  it('accepts toolbar content on the default set', () => {
    expect(
      accepts(
        undefined,
        doc(
          { type: 'heading', attrs: { level: 2 }, content: [text('h')] },
          para(text('b', [{ type: 'bold' }, { type: 'italic' }, { type: 'strike' }])),
          { type: 'bulletList', content: [{ type: 'listItem', content: [para(text('i'))] }] },
          {
            type: 'orderedList',
            attrs: { start: 1 },
            content: [{ type: 'listItem', content: [para()] }],
          },
          { type: 'blockquote', content: [para(text('q'))] },
        ),
      ),
    ).toBe(true)
  })

  it.each([
    ['a link mark', doc(para(text('x', [link({ href: 'https://a.test' })])))],
    ['an image node', doc({ type: 'image', attrs: { src: 'a.png' } })],
    ['an unknown node', doc({ type: 'bogus' })],
    ['an unknown mark', doc(para(text('x', [{ type: 'bogus' }])))],
    ['an unknown paragraph attribute', doc({ type: 'paragraph', attrs: { onclick: 'x' } })],
  ])('refuses %s on the default set', (_label, value) => {
    expect(accepts(undefined, value)).toBe(false)
  })

  it('refuses a node in a position the schema does not allow', () => {
    expect(accepts(undefined, doc(para(para(text('x')))))).toBe(false)
  })

  describe('link policy', () => {
    it.each(['https://a.test', 'http://a.test', 'mailto:a@b.test', 'tel:+61400000000'])(
      'accepts %s',
      (href) => expect(accepts(withLink, linked({ href }))).toBe(true),
    )
    it.each([
      'javascript:alert(1)',
      'JavaScript:alert(1)',
      ' javascript:alert(1)',
      'java\nscript:x',
      'data:text/html,x',
      '/relative',
    ])('refuses %j', (href) => expect(accepts(withLink, linked({ href }))).toBe(false))
    it('accepts relative hrefs when allowed', () => {
      const features = { ...defaultRichTextFeatures, link: { allowRelative: true } }
      expect(accepts(features, linked({ href: '/relative' }))).toBe(true)
      expect(accepts(features, linked({ href: '#anchor' }))).toBe(true)
      expect(accepts(features, linked({ href: 'javascript:x' }))).toBe(false)
    })
    it.each([
      '//evil.example',
      '/\\evil.example',
      '\\\\evil.example',
      'javascript&colon;alert(1)',
      'javascript&#58;alert(1)',
      'javascript&#x3a;alert(1)',
    ])('refuses %j under allowRelative', (href) => {
      const features = { ...defaultRichTextFeatures, link: { allowRelative: true } }
      expect(accepts(features, linked({ href }))).toBe(false)
    })
    it.each(['/path', './a', '../a', '?q=1', '#a', '/search?q=a&page=2'])(
      'accepts %j under allowRelative',
      (href) => {
        const features = { ...defaultRichTextFeatures, link: { allowRelative: true } }
        expect(accepts(features, linked({ href }))).toBe(true)
      },
    )
    it('honours a custom protocol list', () => {
      const features = { link: { protocols: ['ftp'] } }
      expect(accepts(features, linked({ href: 'ftp://a.test' }))).toBe(true)
      expect(accepts(features, linked({ href: 'https://a.test' }))).toBe(false)
    })
    it.each([{ target: '_top' }, { rel: 'me' }, { class: 'x' }, { onclick: 'x' }])(
      'refuses %j',
      (extra) => {
        expect(accepts(withLink, linked({ href: 'https://a.test', ...extra }))).toBe(false)
      },
    )
    it('accepts the pinned target and rel', () => {
      expect(
        accepts(
          withLink,
          linked({
            href: 'https://a.test',
            target: '_blank',
            rel: 'noopener noreferrer nofollow',
            class: null,
          }),
        ),
      ).toBe(true)
    })
  })

  it('restricts heading levels', () => {
    const features = { heading: { levels: [2 as const] } }
    const heading = (level: number) =>
      doc({ type: 'heading', attrs: { level }, content: [text('h')] })
    expect(accepts(features, heading(2))).toBe(true)
    expect(accepts(features, heading(1))).toBe(false)
    expect(accepts({ bold: true }, heading(2))).toBe(false)
  })

  it('treats a declared set as the whole set', () => {
    const features = { link: {} }
    expect(accepts(features, doc(para(text('x', [{ type: 'bold' }]))))).toBe(false)
    expect(accepts(features, linked({ href: 'https://a.test' }))).toBe(true)
  })

  it('checks code block and ordered list attributes', () => {
    const features = { codeBlock: true as const, orderedList: true as const }
    const code = (language: unknown) =>
      doc({ type: 'codeBlock', attrs: { language }, content: [text('x')] })
    expect(accepts(features, code('ts'))).toBe(true)
    expect(accepts(features, code(null))).toBe(true)
    expect(accepts(features, code('"><script>'))).toBe(false)
    const list = (attrs: Record<string, unknown>) =>
      doc({ type: 'orderedList', attrs, content: [{ type: 'listItem', content: [para()] }] })
    expect(accepts(features, list({ start: 3, type: 'a' }))).toBe(true)
    expect(accepts(features, list({ start: 0 }))).toBe(false)
    expect(accepts(features, list({ start: 1, type: 'z' }))).toBe(false)
  })

  it('names the offender without echoing caller-supplied text', () => {
    const marker = 'DISTINCTIVE-MARKER'
    const messages = [
      parse(withLink, linked({ href: `javascript:${marker}` })),
      parse(undefined, doc({ type: marker })),
      parse(undefined, doc({ type: 'image', attrs: { src: marker } })),
      parse(undefined, doc({ type: 'paragraph', attrs: { [marker]: 1 } })),
    ].map((result) => (result.success ? '' : result.error.issues.map((i) => i.message).join(' ')))
    for (const message of messages) {
      expect(message).not.toBe('')
      expect(message).not.toContain(marker)
    }
    expect(messages[0]).toContain('link')
    expect(messages[2]).toContain('image')
  })

  it('refuses a deeply nested document without overflowing the stack', () => {
    let node: Record<string, unknown> = para(text('x'))
    for (let i = 0; i < 20_000; i++) node = { type: 'blockquote', content: [node] }
    expect(() => parse(undefined, doc(node))).not.toThrow()
    expect(accepts(undefined, doc(node))).toBe(false)
  })

  it('copies the resolved set into ui.features', () => {
    expect(richText().ui?.features).toEqual(defaultRichTextFeatures)
    expect(richText({ features: withLink }).ui?.features).toEqual(withLink)
  })
})

describe('editor and validator agree', () => {
  const cases: Array<[string, RichTextFeatures, string]> = [
    ['bold', { bold: true }, '<p><strong>x</strong></p>'],
    ['italic', { italic: true }, '<p><em>x</em></p>'],
    ['strike', { strike: true }, '<p><s>x</s></p>'],
    ['underline', { underline: true }, '<p><u>x</u></p>'],
    ['code', { code: true }, '<p><code>x</code></p>'],
    ['bulletList', { bulletList: true }, '<ul><li><p>x</p></li></ul>'],
    ['orderedList', { orderedList: true }, '<ol start="3"><li><p>x</p></li></ol>'],
    ['blockquote', { blockquote: true }, '<blockquote><p>x</p></blockquote>'],
    ['codeBlock', { codeBlock: true }, '<pre><code class="language-ts">x</code></pre>'],
    ['horizontalRule', { horizontalRule: true }, '<p>x</p><hr>'],
    ['hardBreak', { hardBreak: true }, '<p>x<br>y</p>'],
    ['heading', { heading: { levels: [1, 2] } }, '<h2>x</h2>'],
    ['link', { link: {} }, '<p><a href="https://a.test">x</a></p>'],
  ]

  it.each(cases)('%s', (_name, features, html) => {
    const editor = new Editor({
      extensions: richTextExtensions(features, { editor: true }),
      content: html,
    })
    const json = editor.getJSON()
    editor.destroy()
    expect(parse(features, json).success).toBe(true)
  })
})
