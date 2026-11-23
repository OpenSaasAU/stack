import { config, list } from '@opensaas/stack-core'
import { text } from '@opensaas/stack-core/fields'

export default config({
  db: { provider: 'postgresql' },
  lists: {
    Note: list({
      fields: {
        title: text(),
      },
    }),
  },
})
