import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  controlFlowFromRethrow,
  decideAdvertisement,
  rethrowControlFlow,
  type AdvertisementPolicy,
  type ControlFlowPredicate,
} from './decide-advertisement.js'

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

  async function expectRethrown(thrown: unknown, propagated: unknown = thrown): Promise<void> {
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
    ).rejects.toBe(propagated)
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
    ['an interrupted prerender', 'NEXT_PRERENDER_INTERRUPTED'],
  ])('rethrows an Error carrying the digest of %s, without logging', async (_label, digest) => {
    await expectRethrown(new ControlFlow(digest))
  })

  test('rethrows a plain object carrying a control-flow digest', async () => {
    await expectRethrown({ digest: 'NEXT_HTTP_ERROR_FALLBACK;404' })
  })

  test.each([
    ['redirect()', new ControlFlow('NEXT_REDIRECT;replace;/sign-in;307;')],
    ['notFound()', new ControlFlow('NEXT_HTTP_ERROR_FALLBACK;404')],
    ['postpone', { $$typeof: Symbol.for('react.postpone') }],
  ])('rethrows the cause of an Error wrapping %s, without logging', async (_label, cause) => {
    await expectRethrown(new Error('rule wrapped it', { cause }), cause)
  })

  test('rethrows a control-flow cause several links down', async () => {
    const innermost = new ControlFlow('NEXT_REDIRECT;push;/;307;')
    const middle = new Error('middle', { cause: innermost })
    await expectRethrown(new Error('outer', { cause: middle }), innermost)
  })

  test('denies an ordinary throw whose cause is an unrelated error and logs it', async () => {
    await expectDenied(new Error('rule failed', { cause: new Error('database unreachable') }))
  })

  test('denies a throw whose cause chain is a cycle and logs it', async () => {
    const first = new Error('first')
    const second = new Error('second', { cause: first })
    Object.assign(first, { cause: second })
    await expectDenied(first)
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

class SignedOut extends Error {}

const isSignedOut = (thrown: unknown): boolean => thrown instanceof SignedOut

describe('decideAdvertisement with an injected control-flow predicate', () => {
  async function decideWith(thrown: unknown, isFrameworkControlFlow?: ControlFlowPredicate) {
    return await decideAdvertisement(
      'List.field',
      async () => {
        throw thrown
      },
      'deny',
      policy,
      isFrameworkControlFlow,
    )
  }

  test('rethrows what the predicate recognises, without logging', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const signal = new SignedOut('signed out')
    await expect(decideWith(signal, isSignedOut)).rejects.toBe(signal)
    expect(warn).not.toHaveBeenCalled()
  })

  test('denies the same throw when nothing is injected', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const signal = new SignedOut('signed out')
    expect(await decideWith(signal)).toBe('deny')
    expect(warn).toHaveBeenCalledWith('denied "List.field"', signal)
  })

  test('rethrows the recognised cause of a wrapping Error', async () => {
    const signal = new SignedOut('signed out')
    await expect(
      decideWith(
        new Error('outer', { cause: new Error('middle', { cause: signal }) }),
        isSignedOut,
      ),
    ).rejects.toBe(signal)
  })

  test('keeps the built-in recognition beside the injected predicate', async () => {
    const redirect = new ControlFlow('NEXT_REDIRECT;replace;/sign-in;307;')
    await expect(decideWith(redirect, () => false)).rejects.toBe(redirect)
  })

  test('denies a throw neither recognises', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    expect(await decideWith(new Error('rule failed'), isSignedOut)).toBe('deny')
    expect(warn).toHaveBeenCalledOnce()
  })
})

describe('rethrowControlFlow', () => {
  test('rethrows what an injected predicate recognises', () => {
    const signal = new SignedOut('signed out')
    expect(() => rethrowControlFlow(signal, isSignedOut)).toThrow(signal)
  })

  test('returns for an ordinary throw', () => {
    expect(() => rethrowControlFlow(new Error('rule failed'), isSignedOut)).not.toThrow()
  })
})

describe('controlFlowFromRethrow', () => {
  /** The shape of Next's `unstable_rethrow`: throw the value, else recurse into its cause. */
  function rethrowLike(recognises: (thrown: unknown) => boolean): (thrown: unknown) => void {
    const rethrow = (thrown: unknown): void => {
      if (recognises(thrown)) throw thrown
      if (thrown instanceof Error && 'cause' in thrown) rethrow(thrown.cause)
    }
    return rethrow
  }

  const predicate = controlFlowFromRethrow(rethrowLike(isSignedOut))

  test('recognises a value the rethrow throws back', () => {
    expect(predicate(new SignedOut('signed out'))).toBe(true)
  })

  test('does not recognise a value the rethrow returns for', () => {
    expect(predicate(new Error('rule failed'))).toBe(false)
  })

  test('does not recognise a wrapper whose cause the rethrow throws, so the cause propagates', async () => {
    const signal = new SignedOut('signed out')
    const wrapper = new Error('wrapped', { cause: signal })
    expect(predicate(wrapper)).toBe(false)
    await expect(
      decideAdvertisement(
        'List.field',
        async () => {
          throw wrapper
        },
        'deny',
        policy,
        predicate,
      ),
    ).rejects.toBe(signal)
  })

  test('does not recognise anything when the rethrow itself fails', () => {
    const failing = controlFlowFromRethrow(() => {
      throw new RangeError('Maximum call stack size exceeded')
    })
    expect(failing(new Error('rule failed'))).toBe(false)
  })
})
