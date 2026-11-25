import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import type { FilterFieldSuggestion } from '@opensaas/stack-core'
import { FilterBuilder } from '../../src/components/FilterBuilder.js'

vi.mock('next/navigation.js', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/admin/post',
}))

const suggestions: FilterFieldSuggestion[] = [
  {
    field: 'status',
    operators: ['eq'],
    freeText: false,
    valueSource: {
      kind: 'enum',
      options: [
        { value: 'draft', label: 'Draft' },
        { value: 'published', label: 'Published' },
      ],
    },
  },
  {
    field: 'views',
    operators: ['eq', 'gt', 'gte', 'lt', 'lte'],
    freeText: false,
    valueSource: { kind: 'none' },
    valueFormat: { pattern: '^-?\\d+$', description: 'takes a whole number' },
  },
  { field: 'title', operators: ['eq'], freeText: true, valueSource: { kind: 'none' } },
]

function chipsFor(defaultValue: string) {
  render(<FilterBuilder suggestions={suggestions} defaultValue={defaultValue} onApply={vi.fn()} />)
  return screen
    .getAllByRole('group')
    .filter((group) => group.dataset.slot === 'filter-builder-chip')
}

describe('a token naming a field the list does not have', () => {
  it('says the field does not exist and what is searched instead', () => {
    const [chip] = chipsFor('stauts:draft')

    expect(chip).toHaveAccessibleName('Text contains draft (no field called stauts)')
    expect(within(chip).getByText('no field called stauts')).toBeInTheDocument()
  })

  it('names the missing field on each chip it affects', () => {
    const chips = chipsFor('stauts:draft status:published')

    expect(chips.map((chip) => chip.getAttribute('aria-label'))).toEqual([
      'Text contains draft (no field called stauts)',
      'Status is Published',
    ])
  })
})

describe('chips that need no note', () => {
  it.each([
    ['a bare word', 'draft', 'Text contains draft'],
    ['a quoted phrase', '"stauts:draft"', 'Text contains stauts:draft'],
    ['a known field', 'status:draft', 'Status is Draft'],
    [
      'a negated unknown field, searched as written',
      '-stauts:draft',
      'Text contains -stauts:draft',
    ],
  ])('%s', (_label, query, name) => {
    const [chip] = chipsFor(query)

    expect(chip).toHaveAccessibleName(name)
    expect(within(chip).queryByText(/no field called/)).not.toBeInTheDocument()
  })
})
