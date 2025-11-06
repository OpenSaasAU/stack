/**
 * Text chunking utilities for splitting documents into smaller segments
 * suitable for embedding generation.
 */

export type ChunkingStrategy = 'recursive' | 'sentence' | 'sliding-window' | 'token-aware'

export interface ChunkingOptions {
  /** Target chunk size in characters */
  chunkSize?: number
  /** Overlap between chunks in characters */
  chunkOverlap?: number
  /** Strategy for chunking text */
  strategy?: ChunkingStrategy
  /** Separators for recursive strategy (in priority order) */
  separators?: string[]
  /** Token limit for token-aware strategy */
  tokenLimit?: number
}

export interface TextChunk {
  /** The chunked text content */
  text: string
  /** Start position in original text */
  start: number
  /** End position in original text */
  end: number
  /** Chunk index */
  index: number
  /** Metadata about the chunk */
  metadata?: Record<string, unknown>
}

const DEFAULT_SEPARATORS = ['\n\n', '\n', '. ', ' ', '']

/**
 * Split text into chunks using specified strategy
 */
export function chunkText(text: string, options: ChunkingOptions = {}): TextChunk[] {
  const {
    chunkSize = 1000,
    chunkOverlap = 200,
    strategy = 'recursive',
    separators = DEFAULT_SEPARATORS,
    tokenLimit,
  } = options

  // Handle empty text early
  if (!text || text.trim().length === 0) {
    return []
  }

  if (chunkOverlap >= chunkSize) {
    throw new Error('chunkOverlap must be less than chunkSize')
  }

  switch (strategy) {
    case 'recursive':
      return recursiveChunk(text, chunkSize, chunkOverlap, separators)
    case 'sentence':
      return sentenceChunk(text, chunkSize, chunkOverlap)
    case 'sliding-window':
      return slidingWindowChunk(text, chunkSize, chunkOverlap)
    case 'token-aware':
      return tokenAwareChunk(text, tokenLimit || chunkSize, chunkOverlap)
    default:
      throw new Error(`Unknown chunking strategy: ${strategy}`)
  }
}

/**
 * Recursive text splitting - tries to split by paragraphs, then sentences, then words
 */
function recursiveChunk(
  text: string,
  chunkSize: number,
  overlap: number,
  separators: string[],
): TextChunk[] {
  const chunks: TextChunk[] = []

  function splitRecursive(content: string, startPos: number, sepIndex: number): void {
    if (content.length <= chunkSize) {
      if (content.trim()) {
        chunks.push({
          text: content,
          start: startPos,
          end: startPos + content.length,
          index: chunks.length,
        })
      }
      return
    }

    if (sepIndex >= separators.length) {
      // No more separators, force split at chunkSize
      let pos = 0
      while (pos < content.length) {
        const end = Math.min(pos + chunkSize, content.length)
        const chunk = content.slice(pos, end)
        if (chunk.trim()) {
          chunks.push({
            text: chunk,
            start: startPos + pos,
            end: startPos + end,
            index: chunks.length,
          })
        }
        pos += chunkSize - overlap
      }
      return
    }

    const separator = separators[sepIndex]
    const parts = content.split(separator)

    let currentChunk = ''
    let chunkStart = startPos

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i] + (i < parts.length - 1 ? separator : '')

      if (currentChunk.length + part.length <= chunkSize) {
        currentChunk += part
      } else {
        if (currentChunk.trim()) {
          // Try to split current chunk with next separator
          if (currentChunk.length > chunkSize) {
            splitRecursive(currentChunk, chunkStart, sepIndex + 1)
            chunkStart += currentChunk.length
          } else {
            chunks.push({
              text: currentChunk,
              start: chunkStart,
              end: chunkStart + currentChunk.length,
              index: chunks.length,
            })
            chunkStart += currentChunk.length
          }
        }

        // Handle overlap
        if (overlap > 0 && currentChunk.length >= overlap) {
          currentChunk = currentChunk.slice(-overlap) + part
          chunkStart -= overlap
        } else {
          currentChunk = part
        }
      }
    }

    if (currentChunk.trim()) {
      if (currentChunk.length > chunkSize) {
        splitRecursive(currentChunk, chunkStart, sepIndex + 1)
      } else {
        chunks.push({
          text: currentChunk,
          start: chunkStart,
          end: chunkStart + currentChunk.length,
          index: chunks.length,
        })
      }
    }
  }

  splitRecursive(text, 0, 0)
  return chunks
}

/**
 * Sentence-based chunking - preserves sentence boundaries
 */
function sentenceChunk(text: string, chunkSize: number, overlap: number): TextChunk[] {
  const chunks: TextChunk[] = []

  // Split into sentences (simple regex, can be improved)
  const sentenceRegex = /[^.!?]+[.!?]+/g
  const sentences: { text: string; start: number; end: number }[] = []

  let match: RegExpExecArray | null
  while ((match = sentenceRegex.exec(text)) !== null) {
    sentences.push({
      text: match[0],
      start: match.index,
      end: match.index + match[0].length,
    })
  }

  if (sentences.length === 0) {
    // No sentences found, return whole text as one chunk
    return [
      {
        text: text,
        start: 0,
        end: text.length,
        index: 0,
      },
    ]
  }

  let currentChunk: typeof sentences = []
  let currentLength = 0

  for (let i = 0; i < sentences.length; i++) {
    const sentence = sentences[i]

    if (currentLength + sentence.text.length > chunkSize && currentChunk.length > 0) {
      // Save current chunk
      const chunkText = currentChunk.map((s) => s.text).join('')
      chunks.push({
        text: chunkText,
        start: currentChunk[0].start,
        end: currentChunk[currentChunk.length - 1].end,
        index: chunks.length,
      })

      // Calculate overlap
      if (overlap > 0) {
        let overlapLength = 0
        const overlapSentences: typeof sentences = []

        for (let j = currentChunk.length - 1; j >= 0; j--) {
          if (overlapLength + currentChunk[j].text.length <= overlap) {
            overlapSentences.unshift(currentChunk[j])
            overlapLength += currentChunk[j].text.length
          } else {
            break
          }
        }

        currentChunk = overlapSentences
        currentLength = overlapLength
      } else {
        currentChunk = []
        currentLength = 0
      }
    }

    currentChunk.push(sentence)
    currentLength += sentence.text.length
  }

  // Add final chunk
  if (currentChunk.length > 0) {
    const chunkText = currentChunk.map((s) => s.text).join('')
    chunks.push({
      text: chunkText,
      start: currentChunk[0].start,
      end: currentChunk[currentChunk.length - 1].end,
      index: chunks.length,
    })
  }

  return chunks
}

/**
 * Sliding window chunking - fixed-size chunks with overlap
 */
function slidingWindowChunk(text: string, chunkSize: number, overlap: number): TextChunk[] {
  const chunks: TextChunk[] = []
  const step = chunkSize - overlap

  for (let i = 0; i < text.length; i += step) {
    const end = Math.min(i + chunkSize, text.length)
    const chunk = text.slice(i, end)

    if (chunk.trim()) {
      chunks.push({
        text: chunk,
        start: i,
        end: end,
        index: chunks.length,
      })
    }

    // Stop if we've reached the end
    if (end === text.length) break
  }

  return chunks
}

/**
 * Token-aware chunking - estimates token count and splits accordingly
 * Uses a rough estimate of ~4 characters per token (actual depends on tokenizer)
 */
function tokenAwareChunk(text: string, tokenLimit: number, overlap: number): TextChunk[] {
  const CHARS_PER_TOKEN = 4 // Rough estimate
  const chunkSize = tokenLimit * CHARS_PER_TOKEN
  const overlapChars = overlap * CHARS_PER_TOKEN

  // Use recursive strategy with token-aware chunk size
  return recursiveChunk(text, chunkSize, overlapChars, DEFAULT_SEPARATORS)
}

/**
 * Estimate token count for text (rough approximation)
 */
export function estimateTokenCount(text: string): number {
  const CHARS_PER_TOKEN = 4
  return Math.ceil(text.length / CHARS_PER_TOKEN)
}

/**
 * Merge small chunks to improve efficiency
 */
export function mergeSmallChunks(chunks: TextChunk[], minSize: number): TextChunk[] {
  if (chunks.length === 0) return []

  const merged: TextChunk[] = []
  let current = chunks[0]

  for (let i = 1; i < chunks.length; i++) {
    const next = chunks[i]

    if (current.text.length < minSize) {
      // Merge with next chunk
      current = {
        text: current.text + next.text,
        start: current.start,
        end: next.end,
        index: merged.length,
        metadata: { ...current.metadata, ...next.metadata },
      }
    } else {
      merged.push(current)
      current = { ...next, index: merged.length }
    }
  }

  merged.push(current)
  return merged
}
