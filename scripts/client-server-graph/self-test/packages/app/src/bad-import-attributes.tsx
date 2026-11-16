'use client'

export const load = async () =>
  (await import('@fixture/core', { with: { type: 'javascript' } })).getUrlKey('BlogPost')
