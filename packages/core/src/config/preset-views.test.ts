import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { Session } from '../access/types.js'
import { engineContextOf } from '../context/engine-context.js'
import { select, text } from '../fields/index.js'
import { createTestDatabase, type TestDatabase } from '../testing/context.js'
import { config, list } from './index.js'
import { resolvePresetViews } from './preset-views.js'
import type { OpenSaasConfig, Plugin, PresetView } from './types.js'

const BOOT = 120_000

const preset = (key: string): PresetView => ({ key, label: key, search: 'status:draft' })

const withPresets = (keys: string[]) =>
  config({
    db: { provider: 'postgresql' },
    lists: {
      Post: list({
        fields: { title: text() },
        ui: { listView: { presets: keys.map(preset) } },
      }),
    },
  })

describe('Preset view key uniqueness', () => {
  it('refuses two Preset views with the same key, naming the list and the key', () => {
    expect(() => withPresets(['mine', 'drafts', 'mine'])).toThrow(
      /List "Post" declares the Preset view key "mine" more than once/,
    )
  })

  it('accepts distinct keys', () => {
    expect(() => withPresets(['mine', 'drafts'])).not.toThrow()
  })

  it('refuses a duplicate key on a list a plugin adds', async () => {
    const plugin: Plugin = {
      name: 'tickets',
      version: '0.0.0',
      init: async (context) => {
        context.addList(
          'Ticket',
          list({
            fields: { title: text() },
            ui: { listView: { presets: [preset('open'), preset('open')] } },
          }),
        )
      },
    }
    await expect(
      config({
        db: { provider: 'postgresql' },
        lists: { Post: list({ fields: { title: text() } }) },
        plugins: [plugin],
      }),
    ).rejects.toThrow(/List "Ticket" declares the Preset view key "open"/)
  })
})

const searchFn = vi.fn(({ session }: { session: Session | null }) => {
  if (session?.boom === true) throw new Error('boom')
  return `status:draft  title:"${String(session?.name)}"`
})

const presetConfig: OpenSaasConfig = {
  db: { provider: 'postgresql' },
  lists: {
    Post: {
      fields: {
        title: text(),
        status: select({
          options: [
            { label: 'Draft', value: 'draft' },
            { label: 'Published', value: 'published' },
          ],
        }),
      },
      access: { operation: { query: () => true } },
      ui: {
        listView: {
          presets: [
            {
              key: 'drafts',
              label: 'Drafts',
              search: 'status:draft',
              sort: { field: 'title', direction: 'desc' },
            },
            { key: 'mine', label: 'Mine', search: searchFn },
            {
              key: 'editors',
              label: 'Editors',
              search: 'status:published',
              hasAccess: ({ session }) => session?.role === 'editor',
            },
            {
              key: 'broken',
              label: 'Broken',
              search: 'status:draft',
              hasAccess: () => {
                throw new Error('nope')
              },
            },
          ],
        },
      },
    },
  },
}

let database: TestDatabase

beforeAll(async () => {
  database = await createTestDatabase(presetConfig)
}, BOOT)

afterAll(async () => {
  await database?.close()
})

function resolve(session: Session | null, requested: string | undefined) {
  const context = engineContextOf(database.context(session))
  return resolvePresetViews(presetConfig.lists.Post, 'Post', context, requested)
}

describe('resolvePresetViews', () => {
  it('lists only the presets the session may see, as key and label alone', async () => {
    const plain = await resolve({ name: 'Ada' }, undefined)
    expect(plain.tabs).toEqual([
      { key: 'drafts', label: 'Drafts' },
      { key: 'mine', label: 'Mine' },
    ])
    expect(plain.active).toBeNull()

    const editor = await resolve({ role: 'editor' }, undefined)
    expect(editor.tabs.map((tab) => tab.key)).toEqual(['drafts', 'mine', 'editors'])
  })

  it('resolves a string preset with its sort', async () => {
    const { active } = await resolve(null, 'drafts')
    expect(active).toEqual({
      key: 'drafts',
      search: 'status:draft',
      sort: { field: 'title', direction: 'desc' },
    })
  })

  it('resolves a function preset against each session, in canonical grammar', async () => {
    expect((await resolve({ name: 'Ada' }, 'mine')).active).toEqual({
      key: 'mine',
      search: 'status:draft title:"Ada"',
    })
    expect((await resolve({ name: 'Grace Hopper' }, 'mine')).active).toEqual({
      key: 'mine',
      search: 'status:draft title:"Grace Hopper"',
    })
  })

  it('falls back to the plain list for an unknown, denied or failing preset', async () => {
    expect((await resolve({ name: 'Ada' }, 'nope')).active).toBeNull()
    expect((await resolve({ name: 'Ada' }, 'editors')).active).toBeNull()
    expect((await resolve({ name: 'Ada' }, 'broken')).active).toBeNull()
    expect((await resolve({ name: 'Ada', boom: true }, 'mine')).active).toBeNull()
  })

  it('never resolves a hidden preset’s search', async () => {
    searchFn.mockClear()
    await resolve({ name: 'Ada' }, undefined)
    expect(searchFn).not.toHaveBeenCalled()
  })
})
