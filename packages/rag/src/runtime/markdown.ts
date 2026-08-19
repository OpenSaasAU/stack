/**
 * Markdown processing utilities for content preparation
 */

/**
 * Strip markdown formatting for cleaner text suitable for embeddings.
 *
 * @example
 * ```typescript
 * import { stripMarkdown } from '@opensaas/stack-rag/runtime'
 *
 * const markdown = '# Hello\n\nThis is **bold** text with a [link](url).'
 * const plain = stripMarkdown(markdown)
 * // Returns: 'Hello\n\nThis is bold text with a link.'
 * ```
 */
export function stripMarkdown(markdown: string): string {
  let text = markdown

  text = text.replace(/```[\s\S]*?```/g, '')
  text = text.replace(/`[^`]+`/g, '')

  text = text.replace(/^#+\s+/gm, '')

  text = text.replace(/\*\*([^*]+)\*\*/g, '$1')
  text = text.replace(/\*([^*]+)\*/g, '$1')
  text = text.replace(/__([^_]+)__/g, '$1')
  text = text.replace(/_([^_]+)_/g, '$1')

  text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')

  text = text.replace(/!\[([^\]]*)\]\([^)]+\)/g, '')

  text = text.replace(/<[^>]+>/g, '')

  text = text.replace(/\n{3,}/g, '\n\n')
  text = text.replace(/[ \t]+/g, ' ')

  return text.trim()
}

/**
 * More aggressive than stripMarkdown - extracts only text content,
 * removes all structural elements.
 */
export function extractMarkdownText(markdown: string): string {
  let text = markdown

  text = text.replace(/^---[\s\S]*?---\n/m, '')

  text = text.replace(/```[\s\S]*?```/g, '')

  text = text.replace(/`[^`]+`/g, '')

  text = text.replace(/^[-*_]{3,}$/gm, '')

  text = text.replace(/^>\s+/gm, '')

  text = text.replace(/^[\s]*[-*+]\s+/gm, '')
  text = text.replace(/^[\s]*\d+\.\s+/gm, '')

  text = text.replace(/^#+\s+/gm, '')

  text = text.replace(/\*\*([^*]+)\*\*/g, '$1')
  text = text.replace(/\*([^*]+)\*/g, '$1')
  text = text.replace(/__([^_]+)__/g, '$1')
  text = text.replace(/_([^_]+)_/g, '$1')

  text = text.replace(/~~([^~]+)~~/g, '$1')

  text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')

  text = text.replace(/\[([^\]]+)\]\[[^\]]*\]/g, '$1')

  text = text.replace(/!\[([^\]]*)\]\([^)]+\)/g, '')

  text = text.replace(/<[^>]+>/g, '')

  text = text.replace(/&[a-z]+;/gi, '')

  text = text.replace(/\n{3,}/g, '\n\n')
  text = text.replace(/[ \t]+/g, ' ')
  text = text.replace(/^\s+|\s+$/gm, '')

  return text.trim()
}
