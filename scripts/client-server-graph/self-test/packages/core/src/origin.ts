import { AsyncLocalStorage } from 'node:async_hooks'

export const origin = new AsyncLocalStorage<string>()
