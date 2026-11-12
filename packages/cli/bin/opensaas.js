#!/usr/bin/env node

import { nodeVersionError } from './node-guard.js'

const problem = nodeVersionError(process.versions.node)
if (problem) {
  console.error(problem)
  process.exit(1)
}

await import('../dist/index.js')
