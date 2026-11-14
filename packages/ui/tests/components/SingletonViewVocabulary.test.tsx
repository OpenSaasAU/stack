import { afterEach, describe, expect, it, vi } from 'vitest'
import * as React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { engineContextOf } from '@opensaas/stack-core'
import type { OpenSaasConfig, OperationAccess, Session } from '@opensaas/stack-core'
import { text } from '@opensaas/stack-core/fields'
import { createTestDatabase } from '@opensaas/stack-core/testing'
import { SingletonView } from '../../src/components/SingletonView.js'

vi.mock('next/navigation.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation.js')>()),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/admin/settings',
}))

vi.mock('next/link.js', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}))

const BOOT = 120_000

type RuleArgs = { session: Session | null }

function adminOrNothing(args: RuleArgs): boolean
function adminOrNothing({ session }: RuleArgs): boolean | null | undefined {
  if (session?.role === 'admin') return true
  return session?.role === 'returns-null' ? null : undefined
}

const serverAction = async () => null

afterEach(() => {
  cleanup()
})

function singletonConfig(operation: OperationAccess, autoCreate = true): OpenSaasConfig {
  return {
    db: { provider: 'postgresql' },
    lists: {
      Settings: {
        isSingleton: autoCreate ? true : { autoCreate: false },
        fields: { siteName: text() },
        access: { operation },
      },
    },
  }
}

async function renderSingleton(config: OpenSaasConfig, session: Session | null, sudo = false) {
  const database = await createTestDatabase(config)
  try {
    const base = database.context(session)
    const element = await SingletonView({
      context: sudo ? base.sudo() : base,
      config,
      listKey: 'Settings',
      basePath: '/admin',
      serverAction,
    })
    return render(element)
  } finally {
    await database.close()
  }
}

function expectNoEditor(): void {
  expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Create' })).not.toBeInTheDocument()
  expect(screen.queryByText('Edit Settings')).not.toBeInTheDocument()
  expect(screen.queryByText('Create Settings')).not.toBeInTheDocument()
}

describe('SingletonView reads the Session vocabulary', () => {
  it.each([
    ['null', 'returns-null'],
    ['undefined', 'returns-undefined'],
  ])(
    'shows no editor when the query rule returns %s',
    async (_label, role) => {
      const config = singletonConfig({
        query: adminOrNothing,
        create: () => true,
        update: () => true,
      })
      const { container } = await renderSingleton(config, { role })

      expect(container.querySelector('[data-slot="singleton-view-unavailable"]')).not.toBeNull()
      expect(screen.getByText("You don't have access to Settings.")).toBeInTheDocument()
      expectNoEditor()
    },
    BOOT,
  )

  it.each([
    ['null', 'returns-null'],
    ['undefined', 'returns-undefined'],
  ])(
    'offers no create form when the create rule returns %s',
    async (_label, role) => {
      const config = singletonConfig(
        { query: () => true, create: adminOrNothing, update: () => true },
        false,
      )
      await renderSingleton(config, { role })

      expect(screen.getByText('There is no Settings record yet.')).toBeInTheDocument()
      expectNoEditor()
    },
    BOOT,
  )

  it(
    'offers the create form where create is allowed',
    async () => {
      const config = singletonConfig(
        { query: () => true, create: adminOrNothing, update: () => true },
        false,
      )
      await renderSingleton(config, { role: 'admin' })

      expect(screen.getByText('Create Settings')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Create' })).toBeInTheDocument()
    },
    BOOT,
  )

  it(
    'shows the editor to a sudo context on a singleton with no operation rules',
    async () => {
      const config: OpenSaasConfig = {
        db: { provider: 'postgresql' },
        lists: { Settings: { isSingleton: { autoCreate: false }, fields: { siteName: text() } } },
      }
      await renderSingleton(config, null, true)

      expect(screen.getByText('Create Settings')).toBeInTheDocument()
      expect(screen.queryByText("You don't have access to Settings.")).not.toBeInTheDocument()
    },
    BOOT,
  )

  async function renderWithVocabularyThrowing(thrown: Error) {
    const config = singletonConfig({ query: () => true, create: () => true, update: () => true })
    const database = await createTestDatabase(config)
    try {
      const context = database.context(null)
      engineContextOf(context)._sessionVocabulary = async () => {
        throw thrown
      }
      return render(
        await SingletonView({
          context,
          config,
          listKey: 'Settings',
          basePath: '/admin',
          serverAction,
        }),
      )
    } finally {
      await database.close()
    }
  }

  it(
    'degrades to its load-failure state, logged once, when the vocabulary read throws',
    async () => {
      const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
      try {
        const failure = new Error('vocabulary exploded')
        const { container } = await renderWithVocabularyThrowing(failure)

        expect(container.querySelector('[data-slot="singleton-view-error"]')).not.toBeNull()
        expect(screen.getByText('Settings could not be loaded')).toBeInTheDocument()
        expectNoEditor()
        expect(error).toHaveBeenCalledOnce()
        expect(error.mock.calls[0]?.[1]).toBe(failure)
      } finally {
        error.mockRestore()
      }
    },
    BOOT,
  )

  it(
    'lets framework control flow thrown by the vocabulary read propagate',
    async () => {
      const redirect = Object.assign(new Error('NEXT_REDIRECT'), {
        digest: 'NEXT_REDIRECT;replace;/sign-in;307;',
      })
      await expect(renderWithVocabularyThrowing(redirect)).rejects.toBe(redirect)
    },
    BOOT,
  )
})
