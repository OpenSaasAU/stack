import { describe, it, expect } from 'vitest'
import { removedDbFlagMessage, missingNonInteractiveFlags } from '../src/lib/args.js'

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

describe('missingNonInteractiveFlags', () => {
  it('names every unanswered question', () => {
    expect(missingNonInteractiveFlags([])).toEqual([
      '<project-name>',
      '--with-auth or --no-auth',
      '--with-ai or --no-ai',
    ])
  })

  it('is empty when every question is answered by a flag', () => {
    expect(missingNonInteractiveFlags(['my-app', '--no-auth', '--with-ai'])).toEqual([])
  })

  it('names only what is missing', () => {
    expect(missingNonInteractiveFlags(['my-app', '--with-auth'])).toEqual(['--with-ai or --no-ai'])
  })
})
