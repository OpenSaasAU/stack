import { test } from 'node:test'
import assert from 'node:assert/strict'
import { belowFloor } from './check-doc-node-version.mjs'

test('flags a stated version below the floor', () => {
  assert.equal(belowFloor('You need Node.js 18+').length, 1)
  assert.equal(belowFloor('Node 20.12 works').length, 1)
})

test('accepts the floor and newer', () => {
  assert.equal(belowFloor('Node.js 22.18 or newer').length, 0)
  assert.equal(belowFloor('Node 24').length, 0)
})

test('a bare major at the floor major is not below it', () => {
  assert.equal(belowFloor('Node 22+').length, 0)
  assert.equal(belowFloor('Node 20+').length, 1)
})
