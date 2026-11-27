import { describe, expect, it } from 'vitest'
import { readRelationshipPage, relationshipPagination } from '../../src/lib/relationshipPages.js'

describe('relationship table paging links', () => {
  it('reads a positive whole page and treats anything else as the first', () => {
    expect(readRelationshipPage({ postsPage: '3' }, 'posts')).toBe(3)
    for (const raw of ['0', '-1', '1.5', 'two', undefined]) {
      expect(readRelationshipPage({ postsPage: raw }, 'posts')).toBe(1)
    }
  })

  it('keeps the other tables’ pages in every link', () => {
    expect(
      relationshipPagination({
        itemHref: '/admin/author/u1',
        searchParams: { notesPage: '2', postsPage: '2' },
        fieldName: 'posts',
        page: 2,
        take: 10,
        total: 30,
      }),
    ).toEqual({
      offset: 10,
      previousHref: '/admin/author/u1?notesPage=2',
      nextHref: '/admin/author/u1?notesPage=2&postsPage=3',
    })
  })

  it('has nothing to page when one page holds every row', () => {
    expect(
      relationshipPagination({
        itemHref: '/x',
        searchParams: {},
        fieldName: 'posts',
        page: 1,
        take: 10,
        total: 10,
      }),
    ).toBeUndefined()
  })
})
