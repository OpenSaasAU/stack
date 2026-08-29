import { defineContract, model, field } from '@prisma/orm-postgres/contract-builder'
import { textColumn, boolColumn } from '@prisma/orm-postgres/adapter/column-types'

export const contract = defineContract({
  models: {
    Post: model('Post', {
      fields: {
        id: field.column(textColumn).id(),
        title: field.column(textColumn),
        authorId: field.column(textColumn),
        published: field.column(boolColumn),
      },
    }),
  },
})
