import { describe, expect, test } from 'vitest'
import {
  LIKE_ESCAPE_CHARACTER,
  escapeLikeLiteral,
  likeContainsPattern,
  likeEndsWithPattern,
  likeEqualsPattern,
  likeStartsWithPattern,
} from './like.js'

describe('escapeLikeLiteral', () => {
  test('leaves an ordinary literal alone', () => {
    expect(escapeLikeLiteral('alice@example.com')).toBe('alice@example.com')
  })

  test('escapes the wildcards and the escape character itself', () => {
    expect(escapeLikeLiteral('100%_off')).toBe('100\\%\\_off')
    expect(escapeLikeLiteral('a\\b')).toBe('a\\\\b')
  })

  test('escapes the character it names', () => {
    expect(escapeLikeLiteral(LIKE_ESCAPE_CHARACTER)).toBe(
      `${LIKE_ESCAPE_CHARACTER}${LIKE_ESCAPE_CHARACTER}`,
    )
  })
})

describe('patterns', () => {
  test('anchor where they say they do', () => {
    expect(likeEqualsPattern('ada')).toBe('ada')
    expect(likeContainsPattern('ada')).toBe('%ada%')
    expect(likeStartsWithPattern('ada')).toBe('ada%')
    expect(likeEndsWithPattern('ada')).toBe('%ada')
  })

  test('keep the caller wildcards and escape the value ones', () => {
    expect(likeContainsPattern('50%')).toBe('%50\\%%')
    expect(likeStartsWithPattern('_x')).toBe('\\_x%')
  })
})
