import StarterKit from '@tiptap/starter-kit'
import type { Extensions } from '@tiptap/core'

export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6

export interface LinkFeature {
  /** Allowed URL schemes, without the colon. Defaults to `http`, `https`, `mailto`, `tel`. */
  protocols?: string[]
  /** Accept hrefs with no scheme, such as `/about` and `#anchor`. Defaults to `false`. */
  allowRelative?: boolean
}

/**
 * The marks and nodes a `richText()` field accepts and its editor offers.
 * `doc`, `paragraph` and `text` are always on. A declared set replaces the
 * default rather than merging with it.
 */
export interface RichTextFeatures {
  bold?: true
  italic?: true
  strike?: true
  underline?: true
  code?: true
  bulletList?: true
  orderedList?: true
  blockquote?: true
  codeBlock?: true
  horizontalRule?: true
  hardBreak?: true
  heading?: { levels: HeadingLevel[] }
  link?: LinkFeature
}

export const defaultRichTextFeatures: RichTextFeatures = Object.freeze({
  bold: true,
  italic: true,
  strike: true,
  heading: Object.freeze({ levels: Object.freeze([1, 2, 3] as HeadingLevel[]) as HeadingLevel[] }),
  bulletList: true,
  orderedList: true,
  blockquote: true,
  hardBreak: true,
})

export const DEFAULT_LINK_PROTOCOLS = ['http', 'https', 'mailto', 'tel']

export const LINK_REL = 'noopener noreferrer nofollow'

export function resolveFeatures(features: RichTextFeatures | undefined): RichTextFeatures {
  return features ?? defaultRichTextFeatures
}

function normaliseProtocol(protocol: string): string {
  return protocol.trim().replace(/:$/, '').toLowerCase()
}

export function isAllowedHref(href: string, link: LinkFeature): boolean {
  const compact = Array.from(href)
    .filter((char) => char.charCodeAt(0) > 0x20 && char.charCodeAt(0) !== 0x7f)
    .join('')
  if (compact === '') return false
  const scheme = /^([^/?#:]*):/.exec(compact)
  if (scheme === null) {
    if (link.allowRelative !== true) return false
    return !/^(\/\/|\/\\|\\)/.test(compact) && !/&(#|[a-z0-9]+;)/i.test(compact)
  }
  const protocols = (link.protocols ?? DEFAULT_LINK_PROTOCOLS).map(normaliseProtocol)
  return protocols.includes(scheme[1].toLowerCase())
}

export function richTextExtensions(
  features: RichTextFeatures,
  options: { editor: boolean },
): Extensions {
  const { editor } = options
  const link = features.link
  const lists = features.bulletList === true || features.orderedList === true
  return [
    StarterKit.configure({
      bold: features.bold ? {} : false,
      italic: features.italic ? {} : false,
      strike: features.strike ? {} : false,
      underline: features.underline ? {} : false,
      code: features.code ? {} : false,
      blockquote: features.blockquote ? {} : false,
      codeBlock: features.codeBlock ? {} : false,
      horizontalRule: features.horizontalRule ? {} : false,
      hardBreak: features.hardBreak ? {} : false,
      heading: features.heading ? { levels: features.heading.levels } : false,
      bulletList: features.bulletList ? {} : false,
      orderedList: features.orderedList ? {} : false,
      listItem: lists ? {} : false,
      link: link
        ? {
            openOnClick: false,
            autolink: false,
            linkOnPaste: false,
            HTMLAttributes: { target: '_blank', rel: LINK_REL },
            isAllowedUri: (url: string) => isAllowedHref(url, link),
          }
        : false,
      listKeymap: editor && lists ? {} : false,
      undoRedo: editor ? {} : false,
      dropcursor: editor ? {} : false,
      gapcursor: editor ? undefined : false,
      trailingNode: editor ? {} : false,
    }),
  ]
}
