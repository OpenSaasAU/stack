import Markdoc from '@markdoc/markdoc'
import { codeToHtml } from 'shiki'
import { renderPlainCode, resolveCodeLanguage } from './code-highlighting'

/**
 * Markdoc configuration with custom nodes and tags
 */
export const markdocConfig = {
  nodes: {
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
  const headingRegex = /^(#{2,3})\s+(.+)$/gm
  const headings: Array<{ level: number; text: string; id: string }> = []

  let match
  while ((match = headingRegex.exec(content)) !== null) {
    const level = match[1].length
    const text = match[2]
    const id = text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')

    headings.push({ level, text, id })
  }

  return headings
}

import React from 'react'
