import { describe, it, expect } from 'vitest'
import { cleanAuthErrorMessage } from '../src/ui/lib/clean-error-message.js'

describe('cleanAuthErrorMessage', () => {
  it('strips a single [body.field] prefix', () => {
    expect(cleanAuthErrorMessage('[body.password] Password too short')).toBe('Password too short')
  })

  it('strips multiple [body.field] prefixes', () => {
    expect(cleanAuthErrorMessage('[body.email] invalid [body.password] weak')).toBe('invalid weak')
  })

  it('leaves a clean message untouched', () => {
    expect(cleanAuthErrorMessage('Invalid email or password')).toBe('Invalid email or password')
  })

  it('falls back to a default when the message is empty or nullish', () => {
    expect(cleanAuthErrorMessage('', 'Sign in failed')).toBe('Sign in failed')
    expect(cleanAuthErrorMessage(undefined, 'Sign in failed')).toBe('Sign in failed')
  })

  it('uses a generic default when none is provided', () => {
    expect(cleanAuthErrorMessage(undefined)).toBe('Something went wrong')
  })

  it('trims surrounding whitespace left after stripping', () => {
    expect(cleanAuthErrorMessage('  [body.name]   Name is required  ')).toBe('Name is required')
  })
})
