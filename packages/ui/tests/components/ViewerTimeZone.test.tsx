import { afterEach, describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'
import { ViewerTimeZone } from '../../src/components/ViewerTimeZone.js'

function zoneCookie(): string | undefined {
  return document.cookie
    .split('; ')
    .find((entry) => entry.startsWith('opensaas-tz='))
    ?.slice('opensaas-tz='.length)
}

afterEach(() => {
  document.cookie = 'opensaas-tz=; path=/; max-age=0'
  vi.restoreAllMocks()
})

function inZone(timeZone: string) {
  const original = Intl.DateTimeFormat.prototype.resolvedOptions
  vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockImplementation(function (
    this: Intl.DateTimeFormat,
  ) {
    return { ...original.call(this), timeZone }
  })
}

describe('ViewerTimeZone', () => {
  it("records the browser's time zone for the server", () => {
    inZone('Australia/Sydney')
    render(<ViewerTimeZone />)

    expect(decodeURIComponent(zoneCookie() ?? '')).toBe('Australia/Sydney')
  })

  it('updates the record when the browser moves zone', () => {
    document.cookie = 'opensaas-tz=UTC; path=/'
    inZone('America/New_York')
    render(<ViewerTimeZone />)

    expect(decodeURIComponent(zoneCookie() ?? '')).toBe('America/New_York')
  })

  it('renders nothing', () => {
    const { container } = render(<ViewerTimeZone />)

    expect(container).toBeEmptyDOMElement()
  })
})
