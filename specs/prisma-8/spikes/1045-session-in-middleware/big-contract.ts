import { defineContract, model, field } from '@prisma/orm-postgres/contract-builder'
import { textColumn, boolColumn } from '@prisma/orm-postgres/adapter/column-types'

const models: Record<string, any> = {}
for (let i = 0; i < 40; i++) {
  const fields: Record<string, any> = { id: field.column(textColumn).id() }
  for (let f = 0; f < 12; f++) fields['f' + f] = field.column(textColumn)
  fields.published = field.column(boolColumn)
  models['M' + i] = model('M' + i, { fields })
}
models.Post = model('Post', {
  fields: {
    id: field.column(textColumn).id(),
    title: field.column(textColumn),
    authorId: field.column(textColumn),
    published: field.column(boolColumn),
  },
})
export const bigContract = defineContract({ models } as any)
