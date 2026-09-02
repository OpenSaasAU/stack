import { defineContract, model, field, rel } from '@prisma/orm-postgres/contract-builder'
import { textColumn, boolColumn } from '@prisma/orm-postgres/adapter/column-types'

export const User = model('User', {
  fields: {
    id: field.column(textColumn).id(),
    name: field.column(textColumn),
  },
  relations: {
    posts: rel.hasMany('Post', { by: 'authorId' }),
  },
})

export const Post = model('Post', {
  fields: {
    id: field.column(textColumn).id(),
    title: field.column(textColumn),
    published: field.column(boolColumn),
    authorId: field.column(textColumn),
  },
  relations: {
    author: rel.belongsTo('User', { from: 'authorId', to: 'id' }),
  },
})

export const contract = defineContract({ models: { User, Post } })

export const DDL = `
create table if not exists "User" (id text primary key, name text not null);
create table if not exists "Post" (
  id text primary key, title text not null, published boolean not null,
  "authorId" text not null references "User"(id)
);
`
