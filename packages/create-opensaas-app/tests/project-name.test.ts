import { describe, it, expect } from 'vitest'
import { validateProjectName } from '../src/lib/project-name.js'

describe('validateProjectName', () => {
  it('accepts lowercase, numbers, and hyphens', () => {
    expect(validateProjectName('my-app')).toEqual({ ok: true })
    expect(validateProjectName('my-saas-2024')).toEqual({ ok: true })
    expect(validateProjectName('app')).toEqual({ ok: true })
  })

  it('rejects an empty or missing name', () => {
    expect(validateProjectName('')).toMatchObject({ ok: false })
    expect(validateProjectName(undefined)).toMatchObject({ ok: false })
    expect(validateProjectName(null)).toMatchObject({ ok: false })
  })

  it('rejects uppercase, underscores, spaces, and other punctuation', () => {
    for (const invalid of ['My-App', 'my_app', 'my app', 'my.app', 'café']) {
      const result = validateProjectName(invalid)
      expect(result.ok).toBe(false)
    }
  })

  it('explains why a name is invalid', () => {
    const result = validateProjectName('My App')
    expect(result).toMatchObject({ ok: false })
    if (!result.ok) {
      expect(result.message).toMatch(/lowercase letters, numbers, and hyphens/)
    }
  })
})
