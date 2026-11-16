'use client'

export const load = async () => (await import('@fixture/core')).getUrlKey('BlogPost')
