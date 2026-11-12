#!/usr/bin/env node

import process from 'node:process'
import { nodeVersionError } from './node-guard.js'

const problem = nodeVersionError(process.versions.node)
if (problem) {
  process.stderr.write(`${problem}\n`)
  process.exit(1)
}

await import('../dist/index.js')
