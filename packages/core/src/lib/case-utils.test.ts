import { describe, it, expect } from 'vitest'
import {
  pascalToCamel,
  pascalToKebab,
  kebabToPascal,
  kebabToCamel,
  getDbKey,
  getUrlKey,
  getListKeyFromUrl,
  resolveListKeyFromUrl,
} from './case-utils.js'

describe('Case Conversion Utilities', () => {
  describe('pascalToCamel', () => {
    it('should convert single word PascalCase to camelCase', () => {
      expect(pascalToCamel('User')).toBe('user')
    })

    it('should convert multi-word PascalCase to camelCase', () => {
      expect(pascalToCamel('AuthUser')).toBe('authUser')
      expect(pascalToCamel('BlogPost')).toBe('blogPost')
      expect(pascalToCamel('UserProfile')).toBe('userProfile')
    })

    it('should handle already camelCase strings', () => {
      expect(pascalToCamel('user')).toBe('user')
      expect(pascalToCamel('authUser')).toBe('authUser')
    })
  })

  describe('pascalToKebab', () => {
    it('should convert single word PascalCase to kebab-case', () => {
      expect(pascalToKebab('User')).toBe('user')
    })

    it('should convert multi-word PascalCase to kebab-case', () => {
      expect(pascalToKebab('AuthUser')).toBe('auth-user')
      expect(pascalToKebab('BlogPost')).toBe('blog-post')
      expect(pascalToKebab('UserProfile')).toBe('user-profile')
    })

    it('should handle consecutive capital letters', () => {
      expect(pascalToKebab('HTMLElement')).toBe('h-t-m-l-element')
    })
  })

  describe('kebabToPascal', () => {
    it('should convert single word kebab-case to PascalCase', () => {
      expect(kebabToPascal('user')).toBe('User')
    })

    it('should convert multi-word kebab-case to PascalCase', () => {
      expect(kebabToPascal('auth-user')).toBe('AuthUser')
      expect(kebabToPascal('blog-post')).toBe('BlogPost')
      expect(kebabToPascal('user-profile')).toBe('UserProfile')
    })

    it('should handle already PascalCase strings without hyphens', () => {
      expect(kebabToPascal('User')).toBe('User')
      // Note: "AuthUser" without hyphens is treated as a single word
      expect(kebabToPascal('AuthUser')).toBe('AuthUser')
    })
  })

  describe('kebabToCamel', () => {
    it('should convert single word kebab-case to camelCase', () => {
      expect(kebabToCamel('user')).toBe('user')
    })

    it('should convert multi-word kebab-case to camelCase', () => {
      expect(kebabToCamel('auth-user')).toBe('authUser')
      expect(kebabToCamel('blog-post')).toBe('blogPost')
      expect(kebabToCamel('user-profile')).toBe('userProfile')
    })
  })

  describe('getDbKey', () => {
    it('should convert list key to database key format', () => {
      expect(getDbKey('User')).toBe('user')
      expect(getDbKey('AuthUser')).toBe('authUser')
      expect(getDbKey('BlogPost')).toBe('blogPost')
    })
  })

  describe('getUrlKey', () => {
    it('should convert list key to URL key format', () => {
      expect(getUrlKey('User')).toBe('user')
      expect(getUrlKey('AuthUser')).toBe('auth-user')
      expect(getUrlKey('BlogPost')).toBe('blog-post')
    })
  })

  describe('getListKeyFromUrl', () => {
    it('should convert URL key to list key format', () => {
      expect(getListKeyFromUrl('user')).toBe('User')
      expect(getListKeyFromUrl('auth-user')).toBe('AuthUser')
      expect(getListKeyFromUrl('blog-post')).toBe('BlogPost')
    })
  })

  describe('resolveListKeyFromUrl', () => {
    it('resolves a PascalCase list key from its URL segment', () => {
      expect(resolveListKeyFromUrl('blog-post', ['User', 'BlogPost'])).toBe('BlogPost')
    })

    it('resolves a camelCase list key (e.g. a derived plugin list) from its URL segment', () => {
      // getListKeyFromUrl('oauth-application') would reconstruct 'OauthApplication',
      // which isn't a key in this list — that's the bug this resolver fixes.
      expect(resolveListKeyFromUrl('oauth-application', ['oauthApplication'])).toBe(
        'oauthApplication',
      )
    })

    it('returns undefined for a URL segment matching no list key', () => {
      expect(resolveListKeyFromUrl('does-not-exist', ['User', 'BlogPost'])).toBeUndefined()
    })

    it('throws when two distinct list keys produce the same URL segment', () => {
      expect(() =>
        resolveListKeyFromUrl('oauth-application', ['oauthApplication', 'OauthApplication']),
      ).toThrow(/Ambiguous list URL/)
    })

    it('is derived from getUrlKey, so it cannot drift from how URLs are built', () => {
      const listKeys = ['User', 'AuthUser', 'BlogPost', 'oauthApplication']
      for (const listKey of listKeys) {
        expect(resolveListKeyFromUrl(getUrlKey(listKey), listKeys)).toBe(listKey)
      }
    })
  })

  describe('Round-trip conversions', () => {
    it('should maintain consistency: PascalCase -> kebab-case -> PascalCase', () => {
      const original = 'BlogPost'
      const kebab = getUrlKey(original)
      const backToPascal = getListKeyFromUrl(kebab)
      expect(backToPascal).toBe(original)
    })

    it('should maintain consistency: PascalCase -> camelCase -> operations', () => {
      const original = 'AuthUser'
      const camel = getDbKey(original)
      expect(camel).toBe('authUser')
    })

    it('should handle multi-word conversions correctly', () => {
      const testCases = ['User', 'AuthUser', 'BlogPost', 'UserProfile']

      testCases.forEach((original) => {
        const url = getUrlKey(original)
        const db = getDbKey(original)
        const fromUrl = getListKeyFromUrl(url)

        expect(fromUrl).toBe(original)
        expect(db.charAt(0)).toBe(original.charAt(0).toLowerCase())
      })
    })
  })
})
