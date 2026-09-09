import { describe, expect, it } from 'vitest'
import { config } from '../config/index.js'
import { getContext } from './index.js'
import { unavailableUnsafeSurface } from '../unsafe.js'
import type { StorageUtils } from '../access/types.js'
import {
  engineContextOf,
  EngineContextUnavailableError,
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
