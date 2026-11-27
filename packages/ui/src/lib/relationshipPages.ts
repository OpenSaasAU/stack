import type { RelationshipTablePagination } from '../components/RelationshipTableClient.js'

type SearchParams = { [key: string]: string | string[] | undefined }

export function relationshipPageParam(fieldName: string): string {
  return `${fieldName}Page`
}

export function readRelationshipPage(searchParams: SearchParams, fieldName: string): number {
  const raw = searchParams[relationshipPageParam(fieldName)]
  const page = typeof raw === 'string' && /^\d+$/.test(raw) ? Number(raw) : 1
  return Number.isSafeInteger(page) && page >= 1 ? page : 1
}

/**
 * The paging a Relationship table shows for `page` of `total` rows, `take` at
 * a time, with every link keeping the item page's other parameters.
 */
export function relationshipPagination({
  itemHref,
  searchParams,
  fieldName,
  page,
  take,
  total,
}: {
  itemHref: string
  searchParams: SearchParams
  fieldName: string
  page: number
  take: number
  total: number
}): RelationshipTablePagination | undefined {
  const lastPage = Math.max(1, Math.ceil(total / take))
  if (lastPage === 1 && page === 1) return undefined

  const hrefFor = (target: number) => {
    const params = new URLSearchParams()
    for (const [key, value] of Object.entries(searchParams)) {
      if (key === relationshipPageParam(fieldName) || value === undefined) continue
      for (const entry of Array.isArray(value) ? value : [value]) params.append(key, entry)
    }
    if (target > 1) params.set(relationshipPageParam(fieldName), String(target))
    const query = params.toString()
    return query === '' ? itemHref : `${itemHref}?${query}`
  }

  if (page > lastPage) return { offset: (page - 1) * take, lastPageHref: hrefFor(lastPage) }
  return {
    offset: (page - 1) * take,
    previousHref: page > 1 ? hrefFor(page - 1) : undefined,
    nextHref: page < lastPage ? hrefFor(page + 1) : undefined,
  }
}
