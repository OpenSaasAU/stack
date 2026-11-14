import { afterEach, describe, expect, test, vi } from 'vitest'
import { decideAdvertisement, type AdvertisementPolicy } from './decide-advertisement.js'

const policy: AdvertisementPolicy = { warning: (subject) => `denied "${subject}"` }

class ControlFlow extends Error {
  readonly digest: string
  constructor(digest: string) {
    super(digest)
    this.digest = digest
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('decideAdvertisement', () => {
  test('returns what the decision answers', async () => {
    expect(await decideAdvertisement('List.field', async () => 'allow', 'deny', policy)).toBe(
      'allow',
    )
  })

  test('denies an ordinary throw and logs it', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const failure = new Error('rule failed')
    const answer = await decideAdvertisement(
      'List.field',
      async () => {
        throw failure
      },
      'deny',
      policy,
    )
    expect(answer).toBe('deny')
    expect(warn).toHaveBeenCalledWith('denied "List.field"', failure)
  })

  async function expectRethrown(thrown: unknown): Promise<void> {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    await expect(
      decideAdvertisement(
        'List.field',
        async () => {
          throw thrown
        },
        'deny',
        policy,
      ),
    ).rejects.toBe(thrown)
    expect(warn).not.toHaveBeenCalled()
  }

  async function expectDenied(thrown: unknown): Promise<void> {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const answer = await decideAdvertisement(
      'List.field',
      async () => {
        throw thrown
      },
      'deny',
      policy,
    )
    expect(answer).toBe('deny')
    expect(warn).toHaveBeenCalledWith('denied "List.field"', thrown)
  }

  test.each([
    ['redirect()', 'NEXT_REDIRECT;replace;/sign-in;307;'],
    ['notFound()', 'NEXT_HTTP_ERROR_FALLBACK;404'],
    ['forbidden()', 'NEXT_HTTP_ERROR_FALLBACK;403'],
    ['the legacy notFound()', 'NEXT_NOT_FOUND'],
    ['dynamic server usage', 'DYNAMIC_SERVER_USAGE'],
    ['a client-side rendering bailout', 'BAILOUT_TO_CLIENT_SIDE_RENDERING'],
    ['a hanging prerender promise', 'HANGING_PROMISE_REJECTION'],
  ])('rethrows an Error carrying the digest of %s, without logging', async (_label, digest) => {
    await expectRethrown(new ControlFlow(digest))
  })

  test('rethrows a plain object carrying a control-flow digest', async () => {
    await expectRethrown({ digest: 'NEXT_HTTP_ERROR_FALLBACK;404' })
  })

  test('rethrows React’s postpone, without logging', async () => {
    await expectRethrown(
      Object.assign(new Error('postponed'), { $$typeof: Symbol.for('react.postpone') }),
    )
  })

  test.each([
    ['an Error', new ControlFlow('3735928559')],
    ['a plain object', { digest: 'SOME_LIBRARY_ERROR' }],
    ['a digest naming a prefix mid-string', { digest: 'wrapped:NEXT_REDIRECT' }],
  ])('denies %s carrying an unrelated digest and logs it', async (_label, thrown) => {
    await expectDenied(thrown)
  })

  test('denies a throw whose $$typeof is another symbol', async () => {
    await expectDenied({ $$typeof: Symbol.for('react.element') })
  })

  test('denies a throw whose digest is not a string', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const answer = await decideAdvertisement(
      'List.field',
      async () => {
        throw { digest: 404 }
      },
      'deny',
      policy,
    )
    expect(answer).toBe('deny')
    expect(warn).toHaveBeenCalledOnce()
  })
})
