import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import { userEvent } from 'vitest/browser'
import { ThemeToggle } from '../../../src/components/ThemeToggle.js'
import { THEME_STORAGE_KEY, themeInitScript } from '../../../src/lib/theme-mode.js'

// External behaviour only: the `data-theme` attribute on the document root, the
// `localStorage` entry, and restore-on-mount. Never the component's internal
// state or DOM structure.

const root = document.documentElement

function reset() {
  root.removeAttribute('data-theme')
  localStorage.clear()
}

describe('ThemeToggle (Browser)', () => {
  beforeEach(reset)
  afterEach(() => {
    cleanup()
    reset()
  })

  it('starts in system mode with no data-theme attribute when nothing is stored', async () => {
    render(<ThemeToggle />)
    // Wait for the restore-on-mount effect to run.
    await waitFor(() => expect(screen.getByRole('button')).toBeInTheDocument())
    expect(root.hasAttribute('data-theme')).toBe(false)
  })

  it('cycles light → dark → system, setting the root attribute each step', async () => {
    render(<ThemeToggle />)
    const button = screen.getByRole('button')

    await userEvent.click(button) // system → light
    expect(root.getAttribute('data-theme')).toBe('light')

    await userEvent.click(button) // light → dark
    expect(root.getAttribute('data-theme')).toBe('dark')

    await userEvent.click(button) // dark → system
    expect(root.hasAttribute('data-theme')).toBe(false)
  })

  it('persists every choice to localStorage', async () => {
    render(<ThemeToggle />)
    const button = screen.getByRole('button')

    await userEvent.click(button) // → light
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light')

    await userEvent.click(button) // → dark
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark')

    await userEvent.click(button) // → system
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('system')
  })

  it('restores the persisted choice on mount without user interaction', async () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark')
    render(<ThemeToggle />)
    await waitFor(() => expect(root.getAttribute('data-theme')).toBe('dark'))
  })

  it('restore-on-mount reconciles a stale attribute back to the stored choice', async () => {
    // Simulate a wrong scheme painted before hydration.
    root.setAttribute('data-theme', 'dark')
    localStorage.setItem(THEME_STORAGE_KEY, 'light')
    render(<ThemeToggle />)
    await waitFor(() => expect(root.getAttribute('data-theme')).toBe('light'))
  })

  it('inline init script pins the stored scheme before hydration (flash prevention)', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark')
    // Executing the script tag synchronously mirrors first-paint in <head>.
    const el = document.createElement('script')
    el.textContent = themeInitScript
    document.head.appendChild(el)
    expect(root.getAttribute('data-theme')).toBe('dark')
    el.remove()
  })

  it('inline init script leaves the attribute absent for system (no stored choice)', () => {
    root.setAttribute('data-theme', 'dark') // stale value from a prior visitor
    const el = document.createElement('script')
    el.textContent = themeInitScript
    document.head.appendChild(el)
    expect(root.hasAttribute('data-theme')).toBe(false)
    el.remove()
  })
})
