import { describe, it, expect } from 'vitest'
import { generateContext } from './context.js'
import type { OpenSaasConfig } from '@opensaas/stack-core'
import { text } from '@opensaas/stack-core/fields'

describe('Context Generator', () => {
  describe('generateContext', () => {
    it('should generate context factory with default Prisma client', () => {
      const config: OpenSaasConfig = {
        db: {
          provider: 'sqlite',
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          prismaClientConstructor: (() => null) as any,
        },
        lists: {
          User: {
            fields: {
              name: text(),
            },
          },
        },
      }

      const context = generateContext(config)

      expect(context).toMatchSnapshot()
    })

    it('should generate context factory with custom Prisma client constructor', () => {
      const config: OpenSaasConfig = {
        db: {
          provider: 'postgresql',
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          prismaClientConstructor: ((PrismaClient: any) => new PrismaClient()) as any,
        },
        lists: {
          User: {
            fields: {
              name: text(),
            },
          },
        },
      }

      const context = generateContext(config)

      expect(context).toMatchSnapshot()
    })

    it('should include singleton pattern for Prisma client', () => {
      const config: OpenSaasConfig = {
        db: {
          provider: 'sqlite',
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          prismaClientConstructor: (() => null) as any,
        },
        lists: {},
      }

      const context = generateContext(config)

      expect(context).toContain('const globalForPrisma')
      expect(context).toContain('globalThis as unknown as { prisma: PrismaClient | null }')
      expect(context).toContain('globalForPrisma.prisma')
      expect(context).toContain("if (process.env.NODE_ENV !== 'production')")
    })

    it('should include JSDoc comments', () => {
      const config: OpenSaasConfig = {
        db: {
          provider: 'sqlite',
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          prismaClientConstructor: (() => null) as any,
        },
        lists: {},
      }

      const context = generateContext(config)

      expect(context).toContain('/**')
      expect(context).toContain('Auto-generated context factory')
      expect(context).toContain('DO NOT EDIT')
      expect(context).toContain('Get OpenSaas context with optional session')
      expect(context).toContain('@param session')
      expect(context).toContain('@example')
    })

    it('should include usage examples in comments', () => {
      const config: OpenSaasConfig = {
        db: {
          provider: 'sqlite',
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          prismaClientConstructor: (() => null) as any,
        },
        lists: {},
      }

      const context = generateContext(config)

      expect(context).toContain('// Anonymous access')
      expect(context).toContain('const context = await getContext()')
      expect(context).toContain('// Authenticated access')
      expect(context).toContain("const context = await getContext({ userId: 'user-123' })")
    })

    it('should export rawOpensaasContext', () => {
      const config: OpenSaasConfig = {
        db: {
          provider: 'sqlite',
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          prismaClientConstructor: (() => null) as any,
        },
        lists: {},
      }

      const context = generateContext(config)

      expect(context).toMatchSnapshot()
    })

    it('should type session parameter correctly', () => {
      const config: OpenSaasConfig = {
        db: {
          provider: 'sqlite',
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          prismaClientConstructor: (() => null) as any,
        },
        lists: {},
      }

      const context = generateContext(config)

      expect(context).toContain('session?: TSession')
      expect(context).toContain('<TSession extends OpensaasSession = OpensaasSession>')
    })
  })
})
