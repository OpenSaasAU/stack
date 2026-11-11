import { describe, it, expect } from 'vitest'
import { config, list } from './index.js'
import { text } from '../fields/index.js'
import type { Plugin } from './types.js'

const rowAction = (key: string) => ({ key, label: key, handler: async () => undefined })

const withRowActions = (keys: string[]) =>
  config({
    db: { provider: 'postgresql' },
    lists: {
      Post: list({
        fields: { title: text() },
        ui: { listView: { rowActions: keys.map(rowAction) } },
      }),
    },
  })

describe('Row action key uniqueness', () => {
  it('refuses two Row actions with the same key, naming the list and the key', () => {
    expect(() => withRowActions(['archive', 'publish', 'archive'])).toThrow(
      /List "Post" declares the Row action key "archive" more than once/,
    )
  })

  it('accepts distinct keys', () => {
    expect(() => withRowActions(['archive', 'publish'])).not.toThrow()
  })

  it('refuses an empty key, naming the list', () => {
    expect(() => withRowActions(['archive', ''])).toThrow(
      /List "Post" declares a Row action with an empty key in ui.listView.rowActions/,
    )
  })

  it('refuses a duplicate key on a list a plugin adds', async () => {
    const plugin: Plugin = {
      name: 'archiver',
      version: '0.0.0',
      init: async (context) => {
        context.addList(
          'Ticket',
          list({
            fields: { title: text() },
            ui: { listView: { rowActions: [rowAction('close'), rowAction('close')] } },
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
    ).rejects.toThrow(/List "Ticket" declares the Row action key "close"/)
  })
})
