import { describe, expect, it, vi } from 'vitest'
import { config } from '../config/index.js'
import { getContext } from './index.js'
import { unavailableUnsafeSurface } from '../unsafe.js'
import type { StorageUtils } from '../access/types.js'
import { controlFlowPredicateOf } from '../access/decide-advertisement.js'
import {
  engineContextOf,
  EngineContextUnavailableError,
  engineFaceOf,
  type AnyStackContext,
} from './engine-context.js'

const storage: StorageUtils = {
  uploadFile: async () => {
    throw new Error('unused')
  },
  uploadImage: async () => {
    throw new Error('unused')
  },
  deleteFile: async () => {
    throw new Error('unused')
  },
  deleteImage: async () => {
    throw new Error('unused')
  },
}

const ormHandle = {}

async function engineBuiltContext() {
  const resolved = await config({ db: { provider: 'postgresql' }, lists: {} })
  return getContext(resolved, ormHandle, { userId: 'u1' }, storage)
}

describe('engineContextOf', () => {
  it('returns the engine face of a context the engine built: the same db, session and handle', async () => {
    const context = await engineBuiltContext()
    const engine = engineContextOf(context)
    expect(engine.db).toBe(context.db)
    expect(engine.session).toEqual({ userId: 'u1' })
    expect(engine.ormHandle).toBe(ormHandle)
    expect(engine._resolveOutputChain).toEqual([])
  })

  it('follows a context derived by sudo() and withSession()', async () => {
    const context = await engineBuiltContext()
    expect(engineContextOf(context.sudo())._isSudo).toBe(true)
    expect(engineContextOf(context.withSession(null)).session).toBeNull()
  })

  it('returns a value already on the engine face as it is', async () => {
    const context = await engineBuiltContext()
    const engine = engineContextOf(context)
    expect(engineContextOf(engine)).toBe(engine)
  })

  it('refuses a hand-assembled object', () => {
    const assembled: AnyStackContext = {
      db: {},
      session: null,
      unsafe: unavailableUnsafeSurface(),
      storage,
      plugins: {},
      _isSudo: false,
    }
    expect(() => engineContextOf(assembled)).toThrow(EngineContextUnavailableError)
  })
})

describe('engineFaceOf', () => {
  const fallback = {
    db: { provider: 'postgresql' as const },
    lists: {},
    isFrameworkControlFlow: () => true,
  }

  it('is the engine face of a context the engine built, and its config answers for control flow', async () => {
    const appConfig = await config({
      db: { provider: 'postgresql' },
      lists: {},
      isFrameworkControlFlow: (thrown) => thrown === 'app',
    })
    const context = getContext(appConfig, ormHandle, { userId: 'u1' }, storage)
    const engine = engineFaceOf(context)
    expect(engine).toBe(engineContextOf(context))
    if (engine === undefined) throw new Error('expected an engine face')
    expect(controlFlowPredicateOf(engine, fallback)?.('app')).toBe(true)
  })

  it('returns a value already on the engine face as it is', async () => {
    const engine = engineContextOf(await engineBuiltContext())
    expect(engineFaceOf(engine)).toBe(engine)
  })

  it('is undefined for an object the engine did not build, so a caller falls back to its own config', () => {
    const assembled = { db: {}, session: null, storage, plugins: {} }
    expect(engineFaceOf(assembled)).toBeUndefined()
    expect(engineFaceOf({})).toBeUndefined()
  })
})

describe('one engine-face key per process', () => {
  it('a second instance of this module resolves the same key', async () => {
    const first = await import('./engine-context.js')
    vi.resetModules()
    const second = await import('./engine-context.js')
    expect(second).not.toBe(first)
    expect(second.ENGINE_FACE).toBe(first.ENGINE_FACE)
  })

  it('narrows a context one instance built through the other instance', async () => {
    const context = await engineBuiltContext()
    const first = await import('./engine-context.js')
    vi.resetModules()
    const second = await import('./engine-context.js')
    expect(second.engineContextOf(context)).toBe(first.engineContextOf(context))
  })
})
