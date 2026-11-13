import { nodeVersionError } from './node-version.js'

const problem = nodeVersionError(process.versions.node)
if (problem) {
  console.error(problem)
  process.exit(1)
}
