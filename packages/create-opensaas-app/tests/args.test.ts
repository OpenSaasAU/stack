import { describe, it, expect } from 'vitest'
import { removedDbFlagMessage } from '../src/lib/args.js'

describe('removedDbFlagMessage', () => {
  it.each([
    ['--db postgres', ['my-app', '--db', 'postgres']],
    ['--db sqlite', ['my-app', '--db', 'sqlite']],
    ['--db=postgres', ['my-app', '--db=postgres']],
    ['a bare --db', ['my-app', '--db']],
  ])('refuses %s', (_label, args) => {
    expect(removedDbFlagMessage(args)).toMatch(/--db flag has been removed/)
  })

  it('accepts an argv without the flag', () => {
    expect(removedDbFlagMessage(['my-app', '--with-auth', '--no-ai'])).toBeUndefined()
  })

  it('does not fire on an unrelated flag that merely starts with --d', () => {
    expect(removedDbFlagMessage(['my-app', '--debug'])).toBeUndefined()
  })
})
