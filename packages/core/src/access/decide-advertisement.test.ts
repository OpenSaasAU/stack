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

  test.each([
    ['an Error', new ControlFlow('NEXT_REDIRECT;replace;/sign-in;307;')],
    ['a plain object', { digest: 'NEXT_HTTP_ERROR_FALLBACK;404' }],
  ])('rethrows %s carrying a string digest, without logging', async (_label, thrown) => {
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
