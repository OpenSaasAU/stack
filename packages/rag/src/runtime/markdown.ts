/**
 * Markdown processing utilities for content preparation
 */

/**
 * Strip markdown formatting for cleaner text suitable for embeddings
 *
 * Removes code blocks, formatting markers, links, images, and HTML tags
 * while preserving the actual content.
 *
 * @param markdown - Markdown text to process
 * @returns Plain text with markdown removed
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

  // Remove code blocks
  text = text.replace(/```[\s\S]*?```/g, '')
  text = text.replace(/`[^`]+`/g, '')

  // Remove headings markers but keep text
  text = text.replace(/^#+\s+/gm, '')

  // Remove bold/italic markers
  text = text.replace(/\*\*([^*]+)\*\*/g, '$1')
  text = text.replace(/\*([^*]+)\*/g, '$1')
  text = text.replace(/__([^_]+)__/g, '$1')
  text = text.replace(/_([^_]+)_/g, '$1')

  // Remove links but keep text
  text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')

  // Remove images
  text = text.replace(/!\[([^\]]*)\]\([^)]+\)/g, '')

  // Remove HTML tags
  text = text.replace(/<[^>]+>/g, '')

  // Normalize whitespace
  text = text.replace(/\n{3,}/g, '\n\n')
  text = text.replace(/[ \t]+/g, ' ')

  return text.trim()
}

/**
 * Extract text content from common markdown structures
 *
 * More aggressive than stripMarkdown - extracts only text content,
 * removes all structural elements.
 *
 * @param markdown - Markdown text
 * @returns Extracted plain text
 */
export function extractMarkdownText(markdown: string): string {
  let text = markdown

  // Remove YAML frontmatter
  text = text.replace(/^---[\s\S]*?---\n/m, '')

  // Remove code blocks entirely (including content)
  text = text.replace(/```[\s\S]*?```/g, '')

  // Remove inline code
  text = text.replace(/`[^`]+`/g, '')

  // Remove horizontal rules
  text = text.replace(/^[-*_]{3,}$/gm, '')

  // Remove blockquotes markers
  text = text.replace(/^>\s+/gm, '')

  // Remove list markers
  text = text.replace(/^[\s]*[-*+]\s+/gm, '')
  text = text.replace(/^[\s]*\d+\.\s+/gm, '')

  // Remove headings markers
  text = text.replace(/^#+\s+/gm, '')

  // Remove emphasis markers
  text = text.replace(/\*\*([^*]+)\*\*/g, '$1')
  text = text.replace(/\*([^*]+)\*/g, '$1')
  text = text.replace(/__([^_]+)__/g, '$1')
  text = text.replace(/_([^_]+)_/g, '$1')

  // Remove strikethrough
  text = text.replace(/~~([^~]+)~~/g, '$1')

  // Remove links but keep text
  text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')

  // Remove reference-style links
  text = text.replace(/\[([^\]]+)\]\[[^\]]*\]/g, '$1')

  // Remove images
  text = text.replace(/!\[([^\]]*)\]\([^)]+\)/g, '')

  // Remove HTML tags
  text = text.replace(/<[^>]+>/g, '')

  // Remove HTML entities
  text = text.replace(/&[a-z]+;/gi, '')

  // Normalize whitespace
  text = text.replace(/\n{3,}/g, '\n\n')
  text = text.replace(/[ \t]+/g, ' ')
  text = text.replace(/^\s+|\s+$/gm, '')

  return text.trim()
}
