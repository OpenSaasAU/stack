import bcrypt from 'bcryptjs'

// Bcrypt cost factor: higher is slower but more resistant to brute force.
const DEFAULT_COST_FACTOR = 10

export async function hashPassword(
  plainPassword: string,
  costFactor: number = DEFAULT_COST_FACTOR,
): Promise<string> {
  if (typeof plainPassword !== 'string' || plainPassword.length === 0) {
    throw new Error('Password must be a non-empty string')
  }

  return bcrypt.hash(plainPassword, costFactor)
}

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
    // Fail closed on a malformed hash or other bcrypt error, rather than
    // letting it propagate as an authentication-bypassing exception.
    console.error('Password comparison failed:', error)
    return false
  }
}

export function isHashedPassword(value: string): boolean {
  if (typeof value !== 'string') return false

  return /^\$2[aby]\$\d{2}\$.{53}$/.test(value)
}

// Wraps a bcrypt hash so a password field's value can still be used as a
// plain string while also exposing compare() for authentication.
export class HashedPassword {
  constructor(private readonly hash: string) {
    if (!hash || typeof hash !== 'string') {
      throw new Error('HashedPassword requires a non-empty hash string')
    }
  }

  async compare(plainPassword: string): Promise<boolean> {
    return comparePassword(plainPassword, this.hash)
  }

  toString(): string {
    return this.hash
  }

  // Implicit coercion (template literals, string concatenation) resolves here.
  [Symbol.toPrimitive](hint: string): string {
    if (hint === 'string' || hint === 'default') {
      return this.hash
    }
    return this.hash
  }

  // JSON.stringify calls this when present, so this is the serialize-for-output
  // redaction point — never return the hash here. toString()/valueOf()/
  // Symbol.toPrimitive stay unredacted for internal string/compare use.
  toJSON(): { isSet: boolean } {
    return { isSet: !!this.hash }
  }

  valueOf(): string {
    return this.hash
  }
}
