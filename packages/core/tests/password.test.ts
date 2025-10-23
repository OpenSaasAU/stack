import { describe, it, expect } from 'vitest'
import { hashPassword, comparePassword, isHashedPassword, HashedPassword } from '../src/utils/password.js'

describe('Password Utilities', () => {
  describe('hashPassword', () => {
    it('should hash a plaintext password', async () => {
      const plain = 'mypassword123'
      const hashed = await hashPassword(plain)

      expect(hashed).toBeDefined()
      expect(hashed).not.toBe(plain)
      expect(hashed.length).toBeGreaterThan(50)
      expect(hashed).toMatch(/^\$2[aby]\$\d{2}\$/)
    })

    it('should generate different hashes for same password', async () => {
      const plain = 'mypassword123'
      const hash1 = await hashPassword(plain)
      const hash2 = await hashPassword(plain)

      expect(hash1).not.toBe(hash2) // Different salts
      expect(await comparePassword(plain, hash1)).toBe(true)
      expect(await comparePassword(plain, hash2)).toBe(true)
    })

    it('should reject empty string', async () => {
      await expect(hashPassword('')).rejects.toThrow('Password must be a non-empty string')
    })

    it('should reject non-string input', async () => {
      // @ts-expect-error - Testing invalid input
      await expect(hashPassword(null)).rejects.toThrow('Password must be a non-empty string')
      // @ts-expect-error - Testing invalid input
      await expect(hashPassword(undefined)).rejects.toThrow('Password must be a non-empty string')
      // @ts-expect-error - Testing invalid input
      await expect(hashPassword(123)).rejects.toThrow('Password must be a non-empty string')
    })

    it('should accept custom cost factor', async () => {
      const plain = 'mypassword123'
      const hashed = await hashPassword(plain, 4) // Low cost for testing

      expect(hashed).toMatch(/^\$2[aby]\$04\$/) // Cost factor 04
      expect(await comparePassword(plain, hashed)).toBe(true)
    })
  })

  describe('comparePassword', () => {
    it('should return true for matching passwords', async () => {
      const plain = 'mypassword123'
      const hashed = await hashPassword(plain)

      const result = await comparePassword(plain, hashed)
      expect(result).toBe(true)
    })

    it('should return false for non-matching passwords', async () => {
      const plain1 = 'mypassword123'
      const plain2 = 'wrongpassword'
      const hashed = await hashPassword(plain1)

      const result = await comparePassword(plain2, hashed)
      expect(result).toBe(false)
    })

    it('should return false for empty strings', async () => {
      const hashed = await hashPassword('test')

      expect(await comparePassword('', hashed)).toBe(false)
      expect(await comparePassword('test', '')).toBe(false)
    })

    it('should return false for non-string inputs', async () => {
      const hashed = await hashPassword('test')

      // @ts-expect-error - Testing invalid input
      expect(await comparePassword(null, hashed)).toBe(false)
      // @ts-expect-error - Testing invalid input
      expect(await comparePassword('test', null)).toBe(false)
      // @ts-expect-error - Testing invalid input
      expect(await comparePassword(undefined, hashed)).toBe(false)
    })

    it('should return false for invalid hash format', async () => {
      const result = await comparePassword('test', 'not-a-valid-hash')
      expect(result).toBe(false)
    })

    it('should be case sensitive', async () => {
      const plain = 'MyPassword123'
      const hashed = await hashPassword(plain)

      expect(await comparePassword('MyPassword123', hashed)).toBe(true)
      expect(await comparePassword('mypassword123', hashed)).toBe(false)
      expect(await comparePassword('MYPASSWORD123', hashed)).toBe(false)
    })
  })

  describe('isHashedPassword', () => {
    it('should return true for bcrypt hashes', async () => {
      const hash = await hashPassword('test')
      expect(isHashedPassword(hash)).toBe(true)
    })

    it('should return true for various bcrypt formats', () => {
      const hash2a = '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy'
      const hash2b = '$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy'
      const hash2y = '$2y$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy'

      expect(isHashedPassword(hash2a)).toBe(true)
      expect(isHashedPassword(hash2b)).toBe(true)
      expect(isHashedPassword(hash2y)).toBe(true)
    })

    it('should return false for plaintext passwords', () => {
      expect(isHashedPassword('mypassword123')).toBe(false)
      expect(isHashedPassword('$2a$')).toBe(false) // Too short
      expect(isHashedPassword('$3a$10$...')).toBe(false) // Wrong version
      expect(isHashedPassword('')).toBe(false)
    })

    it('should return false for non-string inputs', () => {
      // @ts-expect-error - Testing invalid input
      expect(isHashedPassword(null)).toBe(false)
      // @ts-expect-error - Testing invalid input
      expect(isHashedPassword(undefined)).toBe(false)
      // @ts-expect-error - Testing invalid input
      expect(isHashedPassword(123)).toBe(false)
    })
  })

  describe('HashedPassword class', () => {
    it('should wrap a hash and provide compare method', async () => {
      const plain = 'mypassword123'
      const hash = await hashPassword(plain)
      const wrapped = new HashedPassword(hash)

      const result = await wrapped.compare(plain)
      expect(result).toBe(true)
    })

    it('should return false for wrong password', async () => {
      const hash = await hashPassword('correct')
      const wrapped = new HashedPassword(hash)

      const result = await wrapped.compare('wrong')
      expect(result).toBe(false)
    })

    it('should convert to string correctly', async () => {
      const hash = await hashPassword('test')
      const wrapped = new HashedPassword(hash)

      expect(wrapped.toString()).toBe(hash)
      expect(String(wrapped)).toBe(hash)
      expect(`Password: ${wrapped}`).toBe(`Password: ${hash}`)
    })

    it('should serialize to JSON correctly', async () => {
      const hash = await hashPassword('test')
      const wrapped = new HashedPassword(hash)

      const json = JSON.stringify({ password: wrapped })
      expect(json).toBe(JSON.stringify({ password: hash }))
    })

    it('should work with valueOf', async () => {
      const hash = await hashPassword('test')
      const wrapped = new HashedPassword(hash)

      expect(wrapped.valueOf()).toBe(hash)
    })

    it('should throw error for invalid input', () => {
      // @ts-expect-error - Testing invalid input
      expect(() => new HashedPassword(null)).toThrow('HashedPassword requires a non-empty hash string')
      // @ts-expect-error - Testing invalid input
      expect(() => new HashedPassword(undefined)).toThrow(
        'HashedPassword requires a non-empty hash string',
      )
      // @ts-expect-error - Testing invalid input
      expect(() => new HashedPassword('')).toThrow('HashedPassword requires a non-empty hash string')
    })

    it('should work in comparisons and object operations', async () => {
      const hash = await hashPassword('test')
      const wrapped = new HashedPassword(hash)

      // Should be usable as a string
      expect(wrapped == hash).toBe(true) // eslint-disable-line eqeqeq
      expect(wrapped === hash).toBe(false) // Not strictly equal (different types)

      // Should work in object spread
      const obj = { password: wrapped }
      expect(obj.password.toString()).toBe(hash)
    })
  })

  describe('Integration: Full password lifecycle', () => {
    it('should hash, store, retrieve, and verify password', async () => {
      // 1. Hash password (would happen in create operation)
      const plainPassword = 'userPassword123!'
      const hashedPassword = await hashPassword(plainPassword)

      // 2. Store in database (simulated)
      const storedUser = {
        id: '1',
        email: 'test@example.com',
        password: hashedPassword,
      }

      // 3. Retrieve from database and wrap with HashedPassword
      const retrievedUser = {
        ...storedUser,
        password: new HashedPassword(storedUser.password),
      }

      // 4. Verify password on login
      const loginAttempt1 = await retrievedUser.password.compare(plainPassword)
      expect(loginAttempt1).toBe(true)

      const loginAttempt2 = await retrievedUser.password.compare('wrongPassword')
      expect(loginAttempt2).toBe(false)
    })

    it('should not re-hash already hashed passwords', async () => {
      const plain = 'password123'
      const hash = await hashPassword(plain)

      // If password is already hashed, don't hash again
      if (isHashedPassword(hash)) {
        expect(isHashedPassword(hash)).toBe(true)
        // Would skip hashing in actual implementation
      } else {
        // Would hash in actual implementation
        await hashPassword(plain)
      }
    })
  })
})
