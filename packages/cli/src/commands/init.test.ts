import { describe, expect, it } from 'vitest'
import { npxInvocation, quoteForCmd } from './init.js'

describe('npxInvocation', () => {
  it('passes a hostile project name as one argv element without a shell off Windows', () => {
    const invocation = npxInvocation(['x; rm -rf ~'], 'linux')
    expect(invocation.shell).toBe(false)
    expect(invocation.args).toEqual(['create-opensaas-app@latest', 'x; rm -rf ~'])
  })

  it('quotes every argument on Windows, where npx needs a shell', () => {
    const invocation = npxInvocation(['my app & calc'], 'win32')
    expect(invocation.shell).toBe(true)
    expect(invocation.args[1]).toBe('"my app & calc"')
  })

  it('escapes quotes and percent signs for cmd', () => {
    expect(quoteForCmd('a"b%c')).toBe('"a""b"^%"c"')
  })
})
