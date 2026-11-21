import Markdoc, { type Config, type Node } from '@markdoc/markdoc'
import { codeToHtml } from 'shiki'
import { renderPlainCode, resolveCodeLanguage } from './code-highlighting'

export function slugifyHeading(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9 -]/g, '')
    .replace(/ /g, '-')
}

function nodeText(node: Node): string {
  if (typeof node.attributes.content === 'string') return node.attributes.content
  return node.children.map(nodeText).join('')
}

export interface HeadingEntry {
  level: number
  text: string
  base: string
  id: string
  explicit: boolean
}

export function collectHeadings(ast: Node): HeadingEntry[] {
  const used = new Set<string>()
  const entries: Array<{ node: Node; entry: HeadingEntry }> = []
  for (const node of ast.walk()) {
    if (node.type !== 'heading') continue
    const text = nodeText(node)
    const explicit = typeof node.attributes.id === 'string' ? node.attributes.id : undefined
    const base = explicit ?? slugifyHeading(text)
    if (explicit !== undefined) used.add(explicit)
    entries.push({
      node,
      entry: {
        level: Number(node.attributes.level),
        text,
        base,
        id: base,
        explicit: explicit !== undefined,
      },
    })
  }
  const counts = new Map<string, number>()
  for (const { entry } of entries) {
    if (entry.explicit || entry.base === '') continue
    const seen = counts.get(entry.base) ?? 0
    counts.set(entry.base, seen + 1)
    if (seen === 0 && !used.has(entry.base)) {
      used.add(entry.base)
      continue
    }
    let n = Math.max(seen, 1)
    while (used.has(`${entry.base}-${n}`)) n++
    entry.id = `${entry.base}-${n}`
    used.add(entry.id)
  }
  return entries.map(({ entry }) => entry)
}

/**
 * Markdoc configuration with custom nodes and tags
 */
export const markdocConfig = {
  nodes: {
    document: {
      ...Markdoc.nodes.document,
      transform(node: Node, config: Config) {
        const headings = [...node.walk()].filter((n) => n.type === 'heading')
        collectHeadings(node).forEach((entry, i) => {
          headings[i].attributes.id = entry.id || undefined
        })
        return new Markdoc.Tag(
          'article',
          node.transformAttributes(config),
          node.transformChildren(config),
        )
      },
    },
    heading: {
      ...Markdoc.nodes.heading,
      transform(node: Node, config: Config) {
        const attributes = node.transformAttributes(config)
        const children = node.transformChildren(config)
        return new Markdoc.Tag(
          `h${node.attributes.level}`,
          { ...attributes, id: attributes.id },
          children,
        )
      },
    },
    fence: {
      render: 'CodeBlock',
      attributes: {
        language: {
          type: String,
        },
        content: {
          type: String,
        },
      },
    },
  },
  tags: {
    callout: {
      render: 'Callout',
      attributes: {
        type: {
          type: String,
          default: 'info',
          matches: ['info', 'warning', 'error', 'success'],
        },
      },
    },
    unreleased: {
      render: 'Unreleased',
      attributes: {},
    },
  },
}

/**
 * Parse markdown content with Markdoc
 */
export function parseMarkdoc(content: string) {
  const ast = Markdoc.parse(content)
  const transformed = Markdoc.transform(ast, markdocConfig)
  return transformed
}

/**
 * Render Markdoc AST to React
 */
export function renderMarkdoc(
  content: string,
  components?: Record<string, React.ComponentType<unknown>>,
) {
  const transformed = parseMarkdoc(content)
  return Markdoc.renderers.react(transformed, React, { components })
}

/**
 * Highlight code with Shiki
 */
export async function highlightCode(
  code: string,
  language: string = 'typescript',
): Promise<string> {
  const shikiLanguage = resolveCodeLanguage(language)

  if (!shikiLanguage) {
    return renderPlainCode(code)
  }

  try {
    const html = await codeToHtml(code, {
      lang: shikiLanguage,
      theme: 'github-dark',
    })
    return html
  } catch (error) {
    console.error('Error highlighting code:', error)
    return renderPlainCode(code)
  }
}

/**
 * Extract headings from markdown for table of contents
 */
export function extractHeadings(content: string) {
  return collectHeadings(Markdoc.parse(content))
    .filter((h) => h.level === 2 || h.level === 3)
    .map(({ level, text, id }) => ({ level, text, id }))
}

import React from 'react'
