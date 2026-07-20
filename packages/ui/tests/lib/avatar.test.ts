import { describe, it, expect } from 'vitest'
import { getInitials, getAvatarTone, AVATAR_TONES } from '../../src/lib/avatar.js'

/**
 * Avatar helpers (issue #735) — initials and tone must derive deterministically
 * from the row's label, so a row renders the same bubble everywhere and across
 * reloads. Tones are Theme-token classes, never raw hex.
 */
describe('getInitials', () => {
  it('takes the first letter of the first and last word for multi-word names', () => {
    expect(getInitials('Ada Lovelace')).toBe('AL')
    expect(getInitials('Grace Brewster Hopper')).toBe('GH')
  })

  it('takes the first two letters of a single word', () => {
    expect(getInitials('opensaas')).toBe('OP')
  })

  it('upper-cases the initials', () => {
    expect(getInitials('ada lovelace')).toBe('AL')
  })

  it('collapses surrounding and repeated whitespace', () => {
    expect(getInitials('   Ada    Lovelace   ')).toBe('AL')
  })

  it('handles a single-character name without over-slicing', () => {
    expect(getInitials('x')).toBe('X')
  })

  it('degrades to "?" for an empty or whitespace-only label', () => {
    expect(getInitials('')).toBe('?')
    expect(getInitials('   ')).toBe('?')
  })
})

describe('getAvatarTone', () => {
  it('always returns a class pair from the token-derived palette', () => {
    for (const seed of ['Ada Lovelace', 'opensaas', 'a', '', 'Zzzz']) {
      expect(AVATAR_TONES).toContain(getAvatarTone(seed))
    }
  })

  it('is deterministic — the same seed always maps to the same tone', () => {
    expect(getAvatarTone('Ada Lovelace')).toBe(getAvatarTone('Ada Lovelace'))
    expect(getAvatarTone('Grace Hopper')).toBe(getAvatarTone('Grace Hopper'))
  })

  it('derives only from theme tokens — never a raw hex colour', () => {
    for (const tone of AVATAR_TONES) {
      expect(tone).not.toMatch(/#[0-9a-f]{3,8}/i)
    }
  })
})
