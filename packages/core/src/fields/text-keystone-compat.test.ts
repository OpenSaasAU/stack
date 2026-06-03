import { describe, it, expect } from 'vitest'
import { text, integer } from './index.js'

/**
 * Unit coverage for Keystone-compat mode on text() (issue #475).
 *
 * Keystone 6 gives every non-null text column an implicit empty-string default.
 * The `keystoneCompat` flag (db.keystoneCompat) reaches text()'s getPrismaType as
 * the 4th positional argument — the same way provider/listName already do — and
 * emits `@default("")` for a non-null text column that has no explicit default.
 *
 * These tests pin the precise on/off/explicit-default/nullable/non-text matrix
 * from the issue's acceptance criteria.
 */
describe('text() Keystone-compat empty-string default', () => {
  const KEYSTONE_COMPAT = true

  describe('with keystoneCompat ON', () => {
    it('emits @default("") for a required (non-null) text field without an explicit default', () => {
      const field = text({ validation: { isRequired: true } })

      const result = field.getPrismaType!('name', 'sqlite', 'User', KEYSTONE_COMPAT)

      expect(result.type).toBe('String')
      expect(result.modifiers).toBe('@default("")')
    })

    it('emits @default("") for a non-null text field made non-null via db.isNullable: false', () => {
      // Non-null at the DB level even though validation does not mark it required.
      const field = text({ db: { isNullable: false } })

      const result = field.getPrismaType!('phone', 'sqlite', 'User', KEYSTONE_COMPAT)

      expect(result.modifiers).toBe('@default("")')
    })

    it('does NOT emit a default for a nullable text field', () => {
      // Optional → nullable; Keystone-compat must leave it alone.
      const field = text()

      const result = field.getPrismaType!('bio', 'sqlite', 'User', KEYSTONE_COMPAT)

      expect(result.modifiers).toBe('?')
      expect(result.modifiers).not.toContain('@default')
    })

    it('does NOT emit a default for a text field made nullable via db.isNullable: true', () => {
      // Required validation, but explicitly nullable at the DB level.
      const field = text({ validation: { isRequired: true }, db: { isNullable: true } })

      const result = field.getPrismaType!('note', 'sqlite', 'User', KEYSTONE_COMPAT)

      expect(result.modifiers).toBe('?')
      expect(result.modifiers).not.toContain('@default')
    })

    it('lets an explicit defaultValue win over the compat empty-string default', () => {
      const field = text({ validation: { isRequired: true }, defaultValue: 'PLEASE_UPDATE' })

      const result = field.getPrismaType!('status', 'sqlite', 'Account', KEYSTONE_COMPAT)

      expect(result.modifiers).toBe('@default("PLEASE_UPDATE")')
      expect(result.modifiers).not.toContain('@default("")')
    })

    it('honours an explicit empty-string defaultValue without double-emitting', () => {
      const field = text({ validation: { isRequired: true }, defaultValue: '' })

      const result = field.getPrismaType!('label', 'sqlite', 'Account', KEYSTONE_COMPAT)

      // A single @default("") — the explicit default, not a duplicate.
      expect(result.modifiers).toBe('@default("")')
      expect(result.modifiers!.match(/@default/g)).toHaveLength(1)
    })

    it('places @default("") alongside other modifiers in the expected order', () => {
      const field = text({
        validation: { isRequired: true },
        isIndexed: 'unique',
        db: { nativeType: 'Text', map: 'full_name' },
      })

      const result = field.getPrismaType!('fullName', 'postgresql', 'User', KEYSTONE_COMPAT)

      // nativeType → default → unique → map, matching the builder's modifier order.
      expect(result.modifiers).toBe('@db.Text @default("") @unique @map("full_name")')
    })
  })

  describe('with keystoneCompat OFF (default)', () => {
    it('emits no default for a required text field when the flag is omitted', () => {
      const field = text({ validation: { isRequired: true } })

      const result = field.getPrismaType!('name', 'sqlite', 'User')

      expect(result.modifiers).toBeUndefined()
    })

    it('emits no default for a required text field when the flag is explicitly false', () => {
      const field = text({ validation: { isRequired: true } })

      const result = field.getPrismaType!('name', 'sqlite', 'User', false)

      expect(result.modifiers).toBeUndefined()
    })

    it('still honours an explicit defaultValue when the flag is off', () => {
      const field = text({ validation: { isRequired: true }, defaultValue: 'PLEASE_UPDATE' })

      const result = field.getPrismaType!('status', 'sqlite', 'Account', false)

      expect(result.modifiers).toBe('@default("PLEASE_UPDATE")')
    })
  })

  describe('non-text fields are unaffected by the flag', () => {
    it('does not give a required integer field an empty-string default under keystoneCompat', () => {
      const field = integer({ validation: { isRequired: true } })

      const result = field.getPrismaType!('count', 'sqlite', 'Widget', KEYSTONE_COMPAT)

      expect(result.type).toBe('Int')
      expect(result.modifiers ?? '').not.toContain('@default')
    })
  })
})
