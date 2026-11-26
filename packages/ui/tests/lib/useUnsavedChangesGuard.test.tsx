import { describe, it, expect, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useUnsavedChangesGuard } from '../../src/lib/useUnsavedChangesGuard.js'

describe('useUnsavedChangesGuard', () => {
  it('navigates straight away when clean', () => {
    const navigate = vi.fn()
    const { result } = renderHook(() => useUnsavedChangesGuard(false, navigate))
    act(() => result.current.requestLeave('/admin/post'))
    expect(navigate).toHaveBeenCalledWith('/admin/post')
    expect(result.current.prompt.isOpen).toBe(false)
  })

  it('asks first when dirty, and navigates only on confirm', () => {
    const navigate = vi.fn()
    const { result } = renderHook(() => useUnsavedChangesGuard(true, navigate))
    act(() => result.current.requestLeave('/admin/post'))
    expect(navigate).not.toHaveBeenCalled()
    expect(result.current.prompt.isOpen).toBe(true)
    act(() => result.current.prompt.onConfirm())
    expect(navigate).toHaveBeenCalledWith('/admin/post')
  })

  it('cancelling keeps the user on the page', () => {
    const navigate = vi.fn()
    const { result } = renderHook(() => useUnsavedChangesGuard(true, navigate))
    act(() => result.current.requestLeave('/x'))
    act(() => result.current.prompt.onCancel())
    expect(navigate).not.toHaveBeenCalled()
    expect(result.current.prompt.isOpen).toBe(false)
  })

  it('blocks beforeunload and in-app link clicks only while dirty', () => {
    const navigate = vi.fn()
    const dirty = renderHook(() => useUnsavedChangesGuard(true, navigate))
    const unload = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(unload)
    expect(unload.defaultPrevented).toBe(true)

    const link = document.createElement('a')
    link.href = '/admin/other'
    document.body.appendChild(link)
    act(() => {
      link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    })
    expect(dirty.result.current.prompt.isOpen).toBe(true)
    dirty.unmount()

    renderHook(() => useUnsavedChangesGuard(false, navigate))
    const clean = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(clean)
    expect(clean.defaultPrevented).toBe(false)
    link.remove()
  })
})
