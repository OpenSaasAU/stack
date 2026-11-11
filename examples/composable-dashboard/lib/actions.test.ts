import { beforeEach, describe, expect, it, vi } from 'vitest'

const update = vi.fn()

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({ redirect: vi.fn() }))
vi.mock('./demo-session', () => ({ demoSession: async () => ({ userId: 'u1' }) }))
vi.mock('@/.opensaas/context', () => ({
  getContext: async () => ({ db: { Post: { update } } }),
}))

import { updatePost } from './actions'

describe('updatePost', () => {
  beforeEach(() => {
    update.mockReset()
    update.mockResolvedValue({ id: 'p1' })
  })

  it('passes only the fields the form sent, leaving status alone', async () => {
    await updatePost('p1', { title: 'New title' })

    expect(update).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { title: 'New title' } })
  })
})
