#!/bin/bash

# Use the correct Node.js version from nvm
export PATH="/Users/joshcalder/.nvm/versions/node/v22.12.0/bin:$PATH"

# Run mcp-remote with all arguments passed through
exec /Users/joshcalder/Library/pnpm/mcp-remote "$@"
