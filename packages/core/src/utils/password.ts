import bcrypt from 'bcryptjs'

/**
 * Default bcrypt cost factor (rounds)
 * Higher values = more secure but slower
 * 10 is a good balance for production use
 */
const DEFAULT_COST_FACTOR = 10

/**
 * Hash a plain text password using bcrypt
 *
 * @param plainPassword - The plain text password to hash
 * @param costFactor - The bcrypt cost factor (default: 10)
 * @returns Promise resolving to the hashed password
 *
 * @example
 * ```typescript
 * const hashed = await hashPassword('mypassword')
 * // Returns: $2a$10$...
 * ```
 */
export async function hashPassword(
  plainPassword: string,
  costFactor: number = DEFAULT_COST_FACTOR,
): Promise<string> {
  if (typeof plainPassword !== 'string' || plainPassword.length === 0) {
    throw new Error('Password must be a non-empty string')
  }

  return bcrypt.hash(plainPassword, costFactor)
}

/**
 * Compare a plain text password with a hashed password
 *
 * @param plainPassword - The plain text password to compare
 * @param hashedPassword - The hashed password to compare against
 * @returns Promise resolving to true if passwords match, false otherwise
 *
 * @example
 * ```typescript
 * const isValid = await comparePassword('mypassword', hashedPassword)
 * if (isValid) {
 *   // Password is correct
 * }
 * ```
 */
export async function comparePassword(
  plainPassword: string,
  hashedPassword: string,
): Promise<boolean> {
  if (typeof plainPassword !== 'string' || typeof hashedPassword !== 'string') {
    return false
  }

  if (plainPassword.length === 0 || hashedPassword.length === 0) {
    return false
  }

  try {
    return await bcrypt.compare(plainPassword, hashedPassword)
  } catch (error) {
    // Invalid hash format or other bcrypt error
    console.error('Password comparison failed:', error)
    return false
  }
}

/**
 * Check if a string appears to be a bcrypt hash
 * Bcrypt hashes follow the format: $2a$10$...
 *
 * @param value - The string to check
 * @returns True if the string looks like a bcrypt hash
 */
export function isHashedPassword(value: string): boolean {
  if (typeof value !== 'string') return false

  // Bcrypt hashes start with $2a$, $2b$, or $2y$ followed by cost factor
  // and are typically 60 characters long
  return /^\$2[aby]\$\d{2}\$.{53}$/.test(value)
}

/**
 * HashedPassword class wraps a bcrypt hash and provides a compare method
 * This allows password field values to be used as strings while also
 * providing a convenient compare() method for authentication
 *
 * @example
 * ```typescript
 * const user = await context.db.user.findUnique({ where: { id: '1' } })
 * const isValid = await user.password.compare('plaintextPassword')
 * ```
 */
export class HashedPassword {
  constructor(private readonly hash: string) {
    if (!hash || typeof hash !== 'string') {
      throw new Error('HashedPassword requires a non-empty hash string')
    }
  }

  /**
   * Compare a plain text password with this hashed password
   *
   * @param plainPassword - The plain text password to compare
   * @returns Promise resolving to true if passwords match
   */
  async compare(plainPassword: string): Promise<boolean> {
    return comparePassword(plainPassword, this.hash)
  }

  /**
   * Get the underlying hash string
   * This allows the HashedPassword to be used anywhere a string is expected
   */
  toString(): string {
    return this.hash
  }

  /**
   * Get the underlying hash when used in string contexts
   * This allows the HashedPassword to be coerced to a string automatically
   */
  [Symbol.toPrimitive](hint: string): string {
    if (hint === 'string' || hint === 'default') {
      return this.hash
    }
    return this.hash
  }

  /**
   * Return the hash for JSON serialization
   * This ensures the hash is properly serialized when converting to JSON
   */
  toJSON(): string {
    return this.hash
  }

  /**
   * Get the underlying hash value
   * This allows accessing the raw hash string
   */
  valueOf(): string {
    return this.hash
  }
}
