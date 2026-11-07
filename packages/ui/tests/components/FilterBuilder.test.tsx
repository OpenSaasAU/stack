import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { FilterFieldSuggestion } from '@opensaas/stack-core'
import { FilterBuilder } from '../../src/components/FilterBuilder.js'

// FilterBuilder calls useRouter()/usePathname() at render even when `onApply`
// is supplied (the standalone navigation fallback path).
const push = vi.fn()
vi.mock('next/navigation.js', () => ({
  useRouter: () => ({ push }),
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
  },
  { field: 'title', operators: ['eq'], freeText: true, valueSource: { kind: 'none' } },
]

describe('FilterBuilder', () => {
  it('renders a free-text search box and no condition rows by default', () => {
    render(<FilterBuilder suggestions={suggestions} onApply={vi.fn()} />)
    expect(screen.getByLabelText('Search')).toBeInTheDocument()
    expect(screen.queryByLabelText('Filter field')).not.toBeInTheDocument()
  })

  it('applies a free-text query', async () => {
    const onApply = vi.fn()
    const user = userEvent.setup()
    render(<FilterBuilder suggestions={suggestions} onApply={onApply} />)

    await user.type(screen.getByLabelText('Search'), 'hello world')
    await user.click(screen.getByRole('button', { name: 'Apply' }))

    // Two bare words are separate free-text tokens (implicit AND), matching the
    // engine's grammar — not one quoted phrase.
    expect(onApply).toHaveBeenCalledWith('hello world')
  })

  it('adds a condition row whose field picker lists every filterable field', async () => {
    const user = userEvent.setup()
    render(<FilterBuilder suggestions={suggestions} onApply={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: /add filter/i }))

    const fieldSelect = screen.getByLabelText('Filter field')
    const optionLabels = within(fieldSelect)
      .getAllByRole('option')
      .map((o) => o.textContent)
    // Field names are humanised via formatFieldName.
    expect(optionLabels).toEqual(['Status', 'Views', 'Title'])
  })

  it('offers enum options as a dropdown and produces a field:value token', async () => {
    const onApply = vi.fn()
    const user = userEvent.setup()
    render(<FilterBuilder suggestions={suggestions} onApply={onApply} />)

    await user.click(screen.getByRole('button', { name: /add filter/i }))
    // First suggestion is `status` (enum) — no operator picker (eq-only).
    expect(screen.queryByLabelText('Filter operator')).not.toBeInTheDocument()

    const valueSelect = screen.getByLabelText('Filter value')
    expect(within(valueSelect).getByRole('option', { name: 'Published' })).toBeInTheDocument()

    await user.selectOptions(valueSelect, 'published')
    await user.click(screen.getByRole('button', { name: 'Apply' }))

    expect(onApply).toHaveBeenCalledWith('status:published')
  })

  it('shows an operator picker for a comparison field and serialises the prefix', async () => {
    const onApply = vi.fn()
    const user = userEvent.setup()
    render(<FilterBuilder suggestions={suggestions} onApply={onApply} />)

    await user.click(screen.getByRole('button', { name: /add filter/i }))
    // Switch the row to the numeric `views` field.
    await user.selectOptions(screen.getByLabelText('Filter field'), 'views')

    const operatorSelect = screen.getByLabelText('Filter operator')
    await user.selectOptions(operatorSelect, 'gt')

    await user.type(screen.getByLabelText('Filter value'), '5')
    await user.click(screen.getByRole('button', { name: 'Apply' }))

    expect(onApply).toHaveBeenCalledWith('views:>5')
  })

  it('combines a structured row with free text on apply', async () => {
    const onApply = vi.fn()
    const user = userEvent.setup()
    render(<FilterBuilder suggestions={suggestions} onApply={onApply} />)

    await user.type(screen.getByLabelText('Search'), 'beta')
    await user.click(screen.getByRole('button', { name: /add filter/i }))
    await user.selectOptions(screen.getByLabelText('Filter value'), 'draft')
    await user.click(screen.getByRole('button', { name: 'Apply' }))

    expect(onApply).toHaveBeenCalledWith('status:draft beta')
  })

  it('hydrates structured rows and free text from an existing query', () => {
    render(
      <FilterBuilder
        suggestions={suggestions}
        defaultValue="status:published gamma"
        onApply={vi.fn()}
      />,
    )
    const valueSelect = screen.getByLabelText('Filter value') as HTMLSelectElement
    expect(valueSelect.value).toBe('published')
    expect((screen.getByLabelText('Search') as HTMLInputElement).value).toBe('gamma')
  })

  it.each([
    ['an unknown field', 'nosuch:value', 'nosuch:value'],
    ['an operator the field does not support', 'status:>2', 'status:>2'],
    ['a quoted field-shaped word', '"status:draft"', '"status:draft"'],
  ])('keeps %s in the free-text box rather than a row', (_case, query, freeText) => {
    render(<FilterBuilder suggestions={suggestions} defaultValue={query} onApply={vi.fn()} />)
    expect(screen.queryByLabelText('Filter field')).not.toBeInTheDocument()
    expect((screen.getByLabelText('Search') as HTMLInputElement).value).toBe(freeText)
  })

  it('applies an unchanged hydrated query as it was written', async () => {
    const onApply = vi.fn()
    const user = userEvent.setup()
    const written = 'status:draft views:>=10 title:"Ada \\"the Countess\\"" "status:draft" beta'
    render(<FilterBuilder suggestions={suggestions} defaultValue={written} onApply={onApply} />)

    expect(screen.getAllByLabelText('Filter field')).toHaveLength(3)
    await user.click(screen.getByRole('button', { name: 'Apply' }))
    expect(onApply).toHaveBeenCalledWith(written)
  })

  it('keeps free text written before a field token in its place', async () => {
    const onApply = vi.fn()
    const user = userEvent.setup()
    render(
      <FilterBuilder
        suggestions={suggestions}
        defaultValue="beta status:draft"
        onApply={onApply}
      />,
    )

    expect(screen.getAllByLabelText('Filter field')).toHaveLength(1)
    await user.click(screen.getByRole('button', { name: 'Apply' }))
    expect(onApply).toHaveBeenCalledWith('beta status:draft')
  })

  it('never writes an empty row or empty token into the query', async () => {
    const onApply = vi.fn()
    const user = userEvent.setup()
    render(
      <FilterBuilder suggestions={suggestions} defaultValue='title: "" beta' onApply={onApply} />,
    )

    await user.click(screen.getByRole('button', { name: /add filter/i }))
    await user.click(screen.getByRole('button', { name: 'Apply' }))
    expect(onApply).toHaveBeenCalledWith('beta')
  })

  it('escapes a quote typed into a row value', async () => {
    const onApply = vi.fn()
    const user = userEvent.setup()
    render(<FilterBuilder suggestions={suggestions} onApply={onApply} />)

    await user.click(screen.getByRole('button', { name: /add filter/i }))
    await user.selectOptions(screen.getByLabelText('Filter field'), 'title')
    await user.type(screen.getByLabelText('Filter value'), 'say "hi"')
    await user.click(screen.getByRole('button', { name: 'Apply' }))

    expect(onApply).toHaveBeenCalledWith('title:"say \\"hi\\""')
  })

  it('drops a row with no value', async () => {
    const onApply = vi.fn()
    const user = userEvent.setup()
    render(<FilterBuilder suggestions={suggestions} onApply={onApply} />)

    await user.click(screen.getByRole('button', { name: /add filter/i }))
    await user.type(screen.getByLabelText('Search'), 'beta')
    await user.click(screen.getByRole('button', { name: 'Apply' }))

    expect(onApply).toHaveBeenCalledWith('beta')
  })

  it('removes a condition row', async () => {
    const user = userEvent.setup()
    render(
      <FilterBuilder suggestions={suggestions} defaultValue="status:published" onApply={vi.fn()} />,
    )

    expect(screen.getByLabelText('Filter field')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Remove filter' }))
    expect(screen.queryByLabelText('Filter field')).not.toBeInTheDocument()
  })

  it('clears all filters and applies an empty query', async () => {
    const onApply = vi.fn()
    const user = userEvent.setup()
    render(
      <FilterBuilder suggestions={suggestions} defaultValue="status:draft" onApply={onApply} />,
    )

    await user.click(screen.getByRole('button', { name: 'Clear' }))
    expect(onApply).toHaveBeenCalledWith('')
  })

  it('shows only free-text search when no fields are filterable', () => {
    render(<FilterBuilder suggestions={[]} onApply={vi.fn()} />)
    expect(screen.getByLabelText('Search')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /add filter/i })).not.toBeInTheDocument()
  })

  it('depends only on serializable suggestion data (no functions crossing the boundary)', async () => {
    // Round-tripping the props through JSON strips any accidental function; if
    // the component needed one it would break. Proves the server/client seam.
    const serializable = JSON.parse(JSON.stringify(suggestions)) as FilterFieldSuggestion[]
    const onApply = vi.fn()
    const user = userEvent.setup()
    render(<FilterBuilder suggestions={serializable} onApply={onApply} />)

    await user.click(screen.getByRole('button', { name: /add filter/i }))
    await user.selectOptions(screen.getByLabelText('Filter value'), 'published')
    await user.click(screen.getByRole('button', { name: 'Apply' }))

    expect(onApply).toHaveBeenCalledWith('status:published')
  })

  it('navigates to ?search= itself when no onApply is provided', async () => {
    const user = userEvent.setup()
    render(<FilterBuilder suggestions={suggestions} />)

    await user.type(screen.getByLabelText('Search'), 'hello')
    await user.click(screen.getByRole('button', { name: 'Apply' }))

    expect(push).toHaveBeenCalledWith('/admin/post?search=hello')
  })
})
