import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { FilterFieldSuggestion } from '@opensaas/stack-core'
import { FilterBuilder } from '../../src/components/FilterBuilder.js'

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
    valueFormat: { pattern: '^-?\\d+$', description: 'takes a whole number' },
  },
  { field: 'title', operators: ['eq'], freeText: true, valueSource: { kind: 'none' } },
  {
    field: 'author',
    operators: ['eq'],
    freeText: false,
    valueSource: { kind: 'relationship', listKey: 'User', many: false },
  },
]

function setup(props: { defaultValue?: string; resultCount?: number } = {}) {
  const onApply = vi.fn<(query: string) => void>()
  const user = userEvent.setup()
  const view = render(<FilterBuilder suggestions={suggestions} onApply={onApply} {...props} />)
  const bar = screen.getByRole('combobox', { name: 'Filter' })
  return { onApply, user, bar, view }
}

const optionNames = () => screen.getAllByRole('option').map((option) => option.textContent)

const chipNames = () =>
  within(screen.getByRole('combobox', { name: 'Filter' }).parentElement ?? document.body)
    .queryAllByRole('group')
    .map((chip) => chip.getAttribute('aria-label'))

beforeEach(() => {
  push.mockClear()
})

describe('FilterBuilder', () => {
  describe('suggestions', () => {
    it('lists every filterable field when the empty bar is focused', async () => {
      const { user, bar } = setup()
      await user.click(bar)
      expect(bar).toHaveAttribute('aria-expanded', 'true')
      expect(optionNames()).toEqual(['Status', 'Views', 'Title', 'Author'])
    })

    it('suggests a field from part of its name, and Enter goes straight to its values', async () => {
      const { user, bar } = setup()
      await user.type(bar, 'sta')
      expect(screen.getByRole('option', { name: 'Status' })).toBeInTheDocument()

      await user.keyboard('{Enter}')
      expect(bar).toHaveValue('')
      expect(screen.getByRole('listbox', { name: 'Status values' })).toBeInTheDocument()
      expect(optionNames()).toEqual(['Draft', 'Published'])
    })

    it('commits a chosen value as a chip and applies its query at once', async () => {
      const { user, bar, onApply } = setup()
      await user.type(bar, 'sta{Enter}')
      await user.click(screen.getByRole('option', { name: 'Published' }))

      expect(onApply).toHaveBeenCalledExactlyOnceWith('status:published')
      expect(chipNames()).toEqual(['Status is Published'])
      expect(bar).toHaveAttribute('aria-expanded', 'false')
    })

    it('suggests a config-enumerated value directly from part of it', async () => {
      const { user, bar, onApply } = setup()
      await user.type(bar, 'publ')
      expect(screen.getByRole('option', { name: 'Status is Published' })).toBeInTheDocument()

      await user.keyboard('{Enter}')
      expect(onApply).toHaveBeenCalledWith('status:published')
    })

    it.each([
      ['views > 5000', 'views:>5000'],
      ['views >= 10', 'views:>=10'],
      ['status is draft', 'status:draft'],
      ['Status is Published', 'status:published'],
      ['title contains Ada', 'title:Ada'],
    ])('reads the plain phrase %j as a token, never as text', async (phrase, query) => {
      const { user, bar, onApply } = setup()
      await user.type(bar, phrase)
      await user.keyboard('{Enter}')
      expect(onApply).toHaveBeenCalledWith(query)
    })

    it('reads a field name followed by a value', async () => {
      const { user, bar } = setup()
      await user.type(bar, 'status dra')
      expect(screen.getByRole('option', { name: 'Status is Draft' })).toBeInTheDocument()
    })

    it('always offers a free-text search for what was typed', async () => {
      const { user, bar, onApply } = setup()
      await user.type(bar, 'hello world')
      await user.click(screen.getByRole('option', { name: 'Search all text for “hello world”' }))
      expect(onApply).toHaveBeenCalledWith('hello world')
      expect(chipNames()).toEqual(['Text contains hello', 'Text contains world'])
    })

    it('keeps a quoted phrase whole when searching all text', async () => {
      const { user, bar, onApply } = setup()
      await user.type(bar, '"Ada Lovelace" beta')
      await user.click(
        screen.getByRole('option', { name: 'Search all text for “"Ada Lovelace" beta”' }),
      )
      expect(onApply).toHaveBeenCalledWith('"Ada Lovelace" beta')
      expect(chipNames()).toEqual(['Text contains Ada Lovelace', 'Text contains beta'])
    })

    it('reads a word phrase when the symbol form names no field', async () => {
      const { user, bar, onApply } = setup()
      await user.type(bar, 'title is a=b')
      expect(screen.getByRole('option', { name: 'Title contains a=b' })).toBeInTheDocument()
      await user.keyboard('{Enter}')
      expect(onApply).toHaveBeenCalledWith('title:a=b')
    })

    it('offers no field condition for a typed value the field does not take', async () => {
      const { user, bar, onApply } = setup()
      await user.type(bar, 'views:abc')
      expect(optionNames()).toEqual(['Search all text for “views:abc”'])
      await user.keyboard('{Enter}')
      expect(onApply).toHaveBeenCalledWith('"views:abc"')
      expect(chipNames()).toEqual(['Text contains views:abc'])
    })

    it('keeps field-shaped free text literal', async () => {
      const { user, bar, onApply } = setup()
      await user.type(bar, 'nosuch:thing')
      await user.click(screen.getByRole('option', { name: 'Search all text for “nosuch:thing”' }))
      expect(onApply).toHaveBeenCalledWith('"nosuch:thing"')
    })

    it('applies a typed query in the URL grammar as tokens', async () => {
      const { user, bar, onApply } = setup()
      await user.type(bar, 'status:draft views:>3')
      await user.click(
        screen.getByRole('option', { name: 'Status is Draft and Views greater than 3' }),
      )
      expect(onApply).toHaveBeenCalledWith('status:draft views:>3')
    })

    it('works from serializable suggestion data alone', async () => {
      const serializable: FilterFieldSuggestion[] = JSON.parse(JSON.stringify(suggestions))
      const onApply = vi.fn()
      const user = userEvent.setup()
      render(<FilterBuilder suggestions={serializable} onApply={onApply} />)
      await user.type(screen.getByRole('combobox', { name: 'Filter' }), 'draft{Enter}')
      expect(onApply).toHaveBeenCalledWith('status:draft')
    })

    it('offers only free-text search when no field is filterable', async () => {
      const onApply = vi.fn()
      const user = userEvent.setup()
      render(<FilterBuilder suggestions={[]} onApply={onApply} />)
      const bar = screen.getByRole('combobox', { name: 'Filter' })
      await user.click(bar)
      expect(screen.queryAllByRole('option')).toHaveLength(0)
      await user.type(bar, 'beta{Enter}')
      expect(onApply).toHaveBeenCalledWith('beta')
    })
  })

  describe('conditions and values', () => {
    it('switches the condition with Tab and applies the comparison', async () => {
      const { user, bar, onApply } = setup()
      await user.type(bar, 'views{Enter}')
      const conditions = screen.getByRole('group', { name: 'Views condition' })
      expect(within(conditions).getByRole('button', { name: 'is' })).toHaveAttribute(
        'aria-pressed',
        'true',
      )

      await user.keyboard('{Tab}')
      expect(within(conditions).getByRole('button', { name: 'greater than' })).toHaveAttribute(
        'aria-pressed',
        'true',
      )
      expect(bar).toHaveFocus()

      await user.keyboard('5000{Enter}')
      expect(onApply).toHaveBeenCalledWith('views:>5000')
    })

    it('switches the condition by click', async () => {
      const { user, bar, onApply } = setup()
      await user.type(bar, 'views{Enter}')
      await user.click(screen.getByRole('button', { name: 'at most' }))
      await user.type(bar, '9{Enter}')
      expect(onApply).toHaveBeenCalledWith('views:<=9')
    })

    it('sets the comparison from > or < typed at the start of a number', async () => {
      const { user, bar, onApply } = setup()
      await user.type(bar, 'views{Enter}>=12{Enter}')
      expect(onApply).toHaveBeenCalledWith('views:>=12')
    })

    it('offers no condition row on a field with one condition', async () => {
      const { user, bar } = setup()
      await user.type(bar, 'title{Enter}')
      expect(screen.queryByRole('group', { name: 'Title condition' })).not.toBeInTheDocument()
    })

    it('explains a value that does not fit the field in place', async () => {
      const { user, bar, onApply } = setup()
      await user.type(bar, 'views{Enter}abc')

      expect(screen.getByText('Views takes a whole number.')).toBeInTheDocument()
      expect(optionNames()).toEqual(['Search all text for “abc”'])
      expect(onApply).not.toHaveBeenCalled()
    })

    it('explains an enumerated value that matches nothing', async () => {
      const { user, bar } = setup()
      await user.type(bar, 'status{Enter}zzz')
      expect(screen.getByText('No status matches “zzz”.')).toBeInTheDocument()
    })

    it('explains a plain phrase whose value does not fit', async () => {
      const { user, bar } = setup()
      await user.type(bar, 'views > lots')
      expect(screen.getByText('Views takes a whole number.')).toBeInTheDocument()
    })

    it('reads typed relationship text as contains', async () => {
      const { user, bar, onApply } = setup()
      await user.type(bar, 'author{Enter}pri{Enter}')
      expect(onApply).toHaveBeenCalledWith('author:pri')
      expect(chipNames()).toEqual(['Author contains pri'])
    })

    it('never applies partly typed text', async () => {
      const { user, bar, onApply } = setup()
      await user.type(bar, 'views{Enter}50')
      await user.click(document.body)
      await user.type(bar, 'some text')
      await user.tab()
      expect(onApply).not.toHaveBeenCalled()
      expect(push).not.toHaveBeenCalled()
    })
  })

  describe('chips', () => {
    it('hydrates chips from the query and keeps degraded tokens as text', () => {
      setup({ defaultValue: 'status:published nosuch:value "status:draft" views:>2 beta' })
      expect(chipNames()).toEqual([
        'Status is Published',
        'Text contains nosuch:value',
        'Text contains status:draft',
        'Views greater than 2',
        'Text contains beta',
      ])
    })

    it('edits a chip by clicking any part of it, in place', async () => {
      const { user, onApply } = setup({ defaultValue: 'beta status:draft views:>2' })
      await user.click(screen.getByRole('button', { name: 'Change value of Status is Draft' }))
      expect(screen.getByRole('option', { name: 'Draft' })).toHaveAttribute('aria-selected', 'true')
      await user.click(screen.getByRole('option', { name: 'Published' }))
      expect(onApply).toHaveBeenCalledWith('beta status:published views:>2')
    })

    it('edits a comparison chip’s condition', async () => {
      const { user, bar, onApply } = setup({ defaultValue: 'views:>2' })
      await user.click(
        screen.getByRole('button', { name: 'Change condition of Views greater than 2' }),
      )
      expect(bar).toHaveValue('2')
      await user.click(screen.getByRole('button', { name: 'less than' }))
      await user.keyboard('{Enter}')
      expect(onApply).toHaveBeenCalledWith('views:<2')
    })

    it('edits a free-text chip', async () => {
      const { user, bar, onApply } = setup({ defaultValue: 'alpha beta' })
      await user.click(screen.getByRole('button', { name: 'Edit Text contains alpha' }))
      expect(bar).toHaveValue('alpha')
      await user.clear(bar)
      await user.type(bar, 'gamma{Enter}')
      expect(onApply).toHaveBeenCalledWith('gamma beta')
    })

    it('removes one chip', async () => {
      const { user, onApply } = setup({ defaultValue: 'status:draft beta' })
      await user.click(screen.getByRole('button', { name: 'Remove Status is Draft' }))
      expect(onApply).toHaveBeenCalledWith('beta')
      expect(chipNames()).toEqual(['Text contains beta'])
    })

    it('clears every chip', async () => {
      const { user, onApply } = setup({ defaultValue: 'status:draft beta' })
      await user.click(screen.getByRole('button', { name: 'Clear' }))
      expect(onApply).toHaveBeenCalledWith('')
      expect(chipNames()).toEqual([])
    })

    it('writes the remaining query exactly as it was written', async () => {
      const written = 'title:"Ada \\"the Countess\\"" "status:draft" views:>=10 beta'
      const { user, onApply } = setup({ defaultValue: `${written} gamma` })
      await user.click(screen.getByRole('button', { name: 'Remove Text contains gamma' }))
      expect(onApply).toHaveBeenCalledWith(written)
    })

    it('replaces the first is filter on a field with a second', async () => {
      const { user, bar, onApply } = setup({ defaultValue: 'status:draft beta' })
      await user.type(bar, 'status is published{Enter}')
      expect(onApply).toHaveBeenCalledWith('beta status:published')
    })

    it('keeps two contains filters on one field', async () => {
      const { user, bar, onApply } = setup({ defaultValue: 'title:ada' })
      await user.type(bar, 'title contains lovelace{Enter}')
      expect(onApply).toHaveBeenCalledWith('title:ada title:lovelace')
    })

    it('keeps only the last of two is filters typed together on one field', async () => {
      const { user, bar, onApply } = setup()
      await user.type(bar, 'status:draft status:published')
      await user.click(screen.getByRole('option', { name: 'Status is Published' }))
      expect(onApply).toHaveBeenCalledWith('status:published')
      expect(chipNames()).toEqual(['Status is Published'])
    })

    it('replaces an existing is chip with the last of two typed together', async () => {
      const { user, bar, onApply } = setup({ defaultValue: 'status:draft beta' })
      await user.type(bar, 'status:published status:draft')
      await user.click(screen.getByRole('option', { name: 'Status is Draft' }))
      expect(onApply).toHaveBeenCalledWith('beta status:draft')
      expect(chipNames()).toEqual(['Text contains beta', 'Status is Draft'])
    })

    it('shows a hydrated value the field does not take as text, and writes it back as read', async () => {
      const { user, onApply } = setup({ defaultValue: 'views:abc views:>2 beta' })
      expect(chipNames()).toEqual([
        'Text contains views:abc',
        'Views greater than 2',
        'Text contains beta',
      ])
      await user.click(screen.getByRole('button', { name: 'Remove Text contains beta' }))
      expect(onApply).toHaveBeenCalledWith('views:abc views:>2')
    })

    it('pastes a value the field does not take as a text chip', async () => {
      const { user, bar, onApply } = setup()
      await user.click(bar)
      await user.paste('status:draft views:abc')
      expect(onApply).toHaveBeenCalledWith('status:draft views:abc')
      expect(chipNames()).toEqual(['Status is Draft', 'Text contains views:abc'])
    })

    it('pastes only values the fields do not take as typed text', async () => {
      const { user, bar, onApply } = setup()
      await user.click(bar)
      await user.paste('views:abc')
      expect(bar).toHaveValue('views:abc')
      expect(onApply).not.toHaveBeenCalled()
    })

    it('keeps an edited phrase chip one phrase', async () => {
      const { user, bar, onApply } = setup({ defaultValue: '"Ada Lovelace" beta' })
      await user.click(screen.getByRole('button', { name: 'Edit Text contains Ada Lovelace' }))
      expect(bar).toHaveValue('"Ada Lovelace"')
      await user.keyboard('{Enter}')
      expect(onApply).toHaveBeenCalledWith('"Ada Lovelace" beta')
      expect(chipNames()).toEqual(['Text contains Ada Lovelace', 'Text contains beta'])
    })

    it('keeps a hand-written pair of is filters on one field', () => {
      setup({ defaultValue: 'status:draft status:published' })
      expect(chipNames()).toEqual(['Status is Draft', 'Status is Published'])
    })

    it('turns a pasted query into chips', async () => {
      const { user, bar, onApply } = setup({ defaultValue: 'beta' })
      await user.click(bar)
      await user.paste('status:draft views:>5')
      expect(onApply).toHaveBeenCalledWith('beta status:draft views:>5')
      expect(chipNames()).toEqual(['Text contains beta', 'Status is Draft', 'Views greater than 5'])
      expect(bar).toHaveValue('')
    })

    it('pastes plain text as typed text', async () => {
      const { user, bar, onApply } = setup()
      await user.click(bar)
      await user.paste('just words')
      expect(bar).toHaveValue('just words')
      expect(onApply).not.toHaveBeenCalled()
    })

    it('follows a changed query, as Back navigation delivers it', () => {
      const { view } = setup({ defaultValue: 'status:draft' })
      view.rerender(
        <FilterBuilder suggestions={suggestions} onApply={vi.fn()} defaultValue="views:>1" />,
      )
      expect(chipNames()).toEqual(['Views greater than 1'])
    })
  })

  describe('keyboard', () => {
    it('focuses the bar on / from elsewhere on the page', async () => {
      const { user, bar } = setup()
      expect(bar).not.toHaveFocus()
      await user.keyboard('/')
      expect(bar).toHaveFocus()
      expect(bar).toHaveValue('')
    })

    it('leaves / alone while another text box has focus', async () => {
      const user = userEvent.setup()
      render(
        <>
          <input aria-label="Other" />
          <FilterBuilder suggestions={suggestions} onApply={vi.fn()} />
        </>,
      )
      await user.type(screen.getByLabelText('Other'), 'a/b')
      expect(screen.getByLabelText('Other')).toHaveValue('a/b')
    })

    it('moves the active option with the arrows', async () => {
      const { user, bar } = setup()
      await user.click(bar)
      const activeName = () =>
        document.getElementById(bar.getAttribute('aria-activedescendant') ?? '')?.textContent
      expect(activeName()).toBe('Status')
      await user.keyboard('{ArrowDown}{ArrowDown}')
      expect(activeName()).toBe('Title')
      await user.keyboard('{ArrowUp}{ArrowUp}{ArrowUp}')
      expect(activeName()).toBe('Author')
      await user.keyboard('{Enter}')
      expect(screen.getByRole('listbox', { name: 'Author values' })).toBeInTheDocument()
    })

    it('selects chips with the arrows and Backspace, and removes one with a second Backspace', async () => {
      const { user, bar, onApply } = setup({ defaultValue: 'status:draft views:>2 beta' })
      await user.click(bar)

      await user.keyboard('{Backspace}')
      expect(screen.getByRole('group', { name: 'Text contains beta' })).toHaveAttribute(
        'data-armed',
      )
      await user.keyboard('{ArrowLeft}{ArrowLeft}')
      expect(screen.getByRole('group', { name: 'Status is Draft' })).toHaveAttribute('data-armed')
      expect(screen.getByText(/Status is Draft selected/)).toBeInTheDocument()
      await user.keyboard('{ArrowRight}')
      expect(screen.getByRole('group', { name: 'Views greater than 2' })).toHaveAttribute(
        'data-armed',
      )

      await user.keyboard('{Backspace}')
      expect(onApply).toHaveBeenCalledWith('status:draft beta')
      expect(bar).toHaveFocus()
    })

    it('edits the selected chip with Enter', async () => {
      const { user, bar } = setup({ defaultValue: 'status:draft' })
      await user.click(bar)
      await user.keyboard('{ArrowLeft}{Enter}')
      expect(screen.getByRole('listbox', { name: 'Status values' })).toBeInTheDocument()
    })

    it('cancels the filter being built and closes with Esc', async () => {
      const { user, bar, onApply } = setup({ defaultValue: 'status:draft' })
      await user.type(bar, 'views{Enter}12')
      await user.keyboard('{Escape}')
      expect(bar).toHaveValue('')
      expect(bar).toHaveAttribute('aria-expanded', 'false')
      expect(screen.queryByText('Views')).not.toBeInTheDocument()
      expect(chipNames()).toEqual(['Status is Draft'])
      expect(onApply).not.toHaveBeenCalled()
    })

    it('cancels an edit with Esc and keeps the chip', async () => {
      const { user, onApply } = setup({ defaultValue: 'status:draft' })
      await user.click(screen.getByRole('button', { name: 'Edit Status is Draft' }))
      await user.keyboard('{Escape}')
      expect(chipNames()).toEqual(['Status is Draft'])
      expect(onApply).not.toHaveBeenCalled()
    })
  })

  describe('accessibility', () => {
    it('is a labelled combobox controlling a listbox through aria-activedescendant', async () => {
      const { user, bar } = setup()
      expect(bar).toHaveAttribute('aria-autocomplete', 'list')
      await user.click(bar)
      const listbox = screen.getByRole('listbox', { name: 'Filter suggestions' })
      expect(bar).toHaveAttribute('aria-controls', listbox.id)
      const active = bar.getAttribute('aria-activedescendant')
      expect(active).toBeTruthy()
      expect(within(listbox).getAllByRole('option')[0]).toHaveAttribute('id', active)
    })

    it('announces how many suggestions there are', async () => {
      const { user, bar } = setup()
      await user.type(bar, 'publ')
      expect(screen.getByText('2 suggestions')).toBeInTheDocument()
    })

    it('leaves the page a single status role while the menu is open', async () => {
      const onApply = vi.fn<(query: string) => void>()
      const user = userEvent.setup()
      render(
        <>
          <p role="status">2 rows selected</p>
          <FilterBuilder suggestions={suggestions} onApply={onApply} resultCount={3} />
        </>,
      )
      await user.type(screen.getByRole('combobox', { name: 'Filter' }), 'views abc')
      expect(screen.getByText('Views takes a whole number.')).toBeInTheDocument()
      expect(screen.getAllByRole('status')).toHaveLength(1)
      expect(screen.getByText('1 suggestion').closest('[aria-live]')).toHaveAttribute(
        'aria-live',
        'polite',
      )
    })

    it('announces the result count', () => {
      setup({ resultCount: 3 })
      expect(screen.getByText('3 results')).toHaveAttribute('aria-live', 'polite')
    })
  })

  describe('navigation', () => {
    it('navigates to ?search= itself when no onApply is provided', async () => {
      const user = userEvent.setup()
      render(<FilterBuilder suggestions={suggestions} />)
      await user.type(screen.getByRole('combobox', { name: 'Filter' }), 'hello{Enter}')
      expect(push).toHaveBeenCalledWith('/admin/post?search=hello')
    })

    it('navigates to the bare pathname when the last chip goes', async () => {
      const user = userEvent.setup()
      render(<FilterBuilder suggestions={suggestions} defaultValue="hello" />)
      await user.click(screen.getByRole('button', { name: 'Remove Text contains hello' }))
      expect(push).toHaveBeenCalledWith('/admin/post')
    })
  })
})
