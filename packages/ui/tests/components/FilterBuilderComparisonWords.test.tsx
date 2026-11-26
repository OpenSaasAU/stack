import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { FilterFieldSuggestion } from '@opensaas/stack-core'
import { FilterBuilder } from '../../src/components/FilterBuilder.js'

vi.mock('next/navigation.js', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/admin/post',
}))

const suggestions: FilterFieldSuggestion[] = [
  {
    field: 'views',
    operators: ['eq', 'gt', 'gte', 'lt', 'lte'],
    freeText: false,
    valueSource: { kind: 'none' },
    valueFormat: { pattern: '^-?\\d+$', description: 'takes a whole number' },
  },
  {
    field: 'comments',
    operators: ['eq', 'gt', 'gte'],
    freeText: false,
    valueSource: { kind: 'none' },
    valueFormat: {
      pattern: '^0$',
      description: 'takes 0: “is 0” finds none, “greater than 0” finds any',
      operators: {
        gte: { pattern: '^1$', description: 'takes 1 with “at least”, which finds any' },
      },
    },
  },
  { field: 'title', operators: ['eq'], freeText: true, valueSource: { kind: 'none' } },
]

async function typeInBar(text: string) {
  const onApply = vi.fn<(query: string) => void>()
  const user = userEvent.setup()
  render(<FilterBuilder suggestions={suggestions} onApply={onApply} />)
  const bar = screen.getByRole('combobox')
  await user.click(bar)
  await user.type(bar, text)
  return { user, onApply }
}

describe('typing the words a chip shows', () => {
  it.each([
    ['views greater than 5', 'Views greater than 5', 'views:>5'],
    ['views at least 5', 'Views at least 5', 'views:>=5'],
    ['views less than 5', 'Views less than 5', 'views:<5'],
    ['views at most 5', 'Views at most 5', 'views:<=5'],
    ['comments at least 1', 'Comments at least 1', 'comments:>=1'],
    ['comments greater than 0', 'Comments greater than 0', 'comments:>0'],
  ])('reads %j as a filter', async (typed, option, query) => {
    const { user, onApply } = await typeInBar(typed)

    expect(screen.getAllByRole('option')[0]).toHaveAccessibleName(option)
    await user.keyboard('{Enter}')
    expect(onApply).toHaveBeenCalledWith(query)
  })

  it('explains a value the condition does not take', async () => {
    await typeInBar('comments at least 3')

    expect(screen.getByText(/takes 1 with “at least”/)).toBeInTheDocument()
  })

  it('explains a field that cannot be compared', async () => {
    await typeInBar('title at least 3')

    expect(screen.getByText('Title cannot be compared with “at least”.')).toBeInTheDocument()
  })
})
