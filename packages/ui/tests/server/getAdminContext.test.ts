import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getAdminContext } from '../../src/server/getAdminContext.js'
import type { OpenSaaSConfig } from '@opensaas/core'

// Mock the @opensaas/core module
vi.mock('@opensaas/core', () => ({
  getContext: vi.fn(async (config, prisma, session) => ({
    db: { user: {} },
    session,
    prisma,
    serverAction: vi.fn(),
  })),
}))

describe('getAdminContext', () => {
  let mockPrisma: any
  let config: OpenSaaSConfig

  beforeEach(() => {
    mockPrisma = {
      user: {
        findUnique: vi.fn(),
        findMany: vi.fn(),
      },
    }

    config = {
      db: {
        provider: 'postgresql',
        url: 'postgresql://localhost:5432/test',
      },
      lists: {
        User: {
          fields: {
            name: { type: 'text' },
            email: { type: 'text', isIndexed: 'unique' },
          },
        },
      },
    }
  })

  it('should create admin context without session', async () => {
    const adminContext = await getAdminContext(config, mockPrisma)

    expect(adminContext).toBeDefined()
    expect(adminContext.config).toBe(config)
    expect(adminContext.prisma).toBe(mockPrisma)
    expect(adminContext.session).toBeNull()
    expect(adminContext.context).toBeDefined()
  })

  it('should create admin context with session', async () => {
    const mockSession = { userId: '123', role: 'admin' }
    const configWithSession: OpenSaaSConfig = {
      ...config,
      session: {
        getSession: vi.fn(async () => mockSession),
      },
    }

    const adminContext = await getAdminContext(configWithSession, mockPrisma)

    expect(adminContext.session).toEqual(mockSession)
    expect(configWithSession.session?.getSession).toHaveBeenCalled()
  })

  it('should pass session to context', async () => {
    const mockSession = { userId: '123', role: 'admin' }
    const configWithSession: OpenSaaSConfig = {
      ...config,
      session: {
        getSession: vi.fn(async () => mockSession),
      },
    }

    const adminContext = await getAdminContext(configWithSession, mockPrisma)

    expect(adminContext.context.session).toEqual(mockSession)
  })

  it('should include UI config if provided', async () => {
    const configWithUI: OpenSaaSConfig = {
      ...config,
      ui: {
        basePath: '/admin',
      },
    }

    const adminContext = await getAdminContext(configWithUI, mockPrisma)

    expect(adminContext.config.ui).toEqual({ basePath: '/admin' })
  })

  it('should return context with serverAction method', async () => {
    const adminContext = await getAdminContext(config, mockPrisma)

    expect(adminContext.context.serverAction).toBeDefined()
    expect(typeof adminContext.context.serverAction).toBe('function')
  })
})
