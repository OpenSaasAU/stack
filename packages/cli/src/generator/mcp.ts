/**
 * MCP metadata generation
 * Generates reference files for MCP configuration
 */

import * as fs from 'fs'
import * as path from 'path'
import type { OpenSaasConfig } from '@opensaas/stack-core'
import { getDbKey } from '@opensaas/stack-core'

/**
 * Generate MCP metadata if MCP is enabled
 */
export function generateMcp(config: OpenSaasConfig, outputPath: string): boolean {
  // Skip if MCP is not enabled
  if (!config.mcp?.enabled) {
    return false
  }

  // Ensure output directory exists
  const mcpDir = path.join(outputPath, '.opensaas', 'mcp')
  if (!fs.existsSync(mcpDir)) {
    fs.mkdirSync(mcpDir, { recursive: true })
  }

  // Generate tool metadata for reference
  const tools: Array<{
    name: string
    description: string
    listKey: string
    operation: string
  }> = []

  for (const [listKey, listConfig] of Object.entries(config.lists)) {
    if (listConfig.mcp?.enabled === false) continue

    const dbKey = getDbKey(listKey)
    const defaultTools = config.mcp?.defaultTools || {
      read: true,
      create: true,
      update: true,
      delete: true,
    }

    const enabledTools = {
      read: listConfig.mcp?.tools?.read ?? defaultTools.read ?? true,
      create: listConfig.mcp?.tools?.create ?? defaultTools.create ?? true,
      update: listConfig.mcp?.tools?.update ?? defaultTools.update ?? true,
      delete: listConfig.mcp?.tools?.delete ?? defaultTools.delete ?? true,
    }

    if (enabledTools.read) {
      tools.push({
        name: `list_${dbKey}_query`,
        description: `Query ${listKey} records with optional filters`,
        listKey,
        operation: 'query',
      })
    }

    if (enabledTools.create) {
      tools.push({
        name: `list_${dbKey}_create`,
        description: `Create a new ${listKey} record`,
        listKey,
        operation: 'create',
      })
    }

    if (enabledTools.update) {
      tools.push({
        name: `list_${dbKey}_update`,
        description: `Update an existing ${listKey} record`,
        listKey,
        operation: 'update',
      })
    }

    if (enabledTools.delete) {
      tools.push({
        name: `list_${dbKey}_delete`,
        description: `Delete a ${listKey} record`,
        listKey,
        operation: 'delete',
      })
    }

    // Custom tools
    if (listConfig.mcp?.customTools) {
      for (const customTool of listConfig.mcp.customTools) {
        tools.push({
          name: customTool.name,
          description: customTool.description,
          listKey,
          operation: 'custom',
        })
      }
    }
  }

  // Write tools.json for reference
  const toolsPath = path.join(mcpDir, 'tools.json')
  fs.writeFileSync(toolsPath, JSON.stringify(tools, null, 2), 'utf-8')

  // Write README with usage instructions
  const readmePath = path.join(mcpDir, 'README.md')
  fs.writeFileSync(
    readmePath,
    `# MCP Tools Reference

This directory contains metadata about your MCP configuration.

## Available Tools

${tools.length} tool(s) available:

${tools
  .map(
    (tool) => `- **${tool.name}** (${tool.operation}): ${tool.description}
  - List: ${tool.listKey}`,
  )
  .join('\n\n')}

## Usage

Create your MCP route handler:

\`\`\`typescript
// app/api/mcp/[[...transport]]/route.ts
import { createMcpHandlers } from '@opensaas/stack-mcp'
import config from '@/opensaas.config'
import { auth } from '@/lib/auth'
import { getContext } from '@/.opensaas/context'

const { GET, POST, DELETE } = createMcpHandlers({
  config,
  auth,
  getContext
})

export { GET, POST, DELETE }
\`\`\`

## Connecting to Claude Desktop

### Option 1: Remote MCP Server (Recommended for Production)

For production use with OAuth authentication, add your server via **Claude Desktop > Settings > Connectors**.

Claude Desktop requires:
1. Your server must be publicly accessible (use ngrok/cloudflare tunnel for local testing)
2. OAuth authorization server at \`/.well-known/oauth-authorization-server\`
3. Dynamic Client Registration (DCR) support - Better Auth MCP plugin provides this

**Note:** Remote MCP servers with OAuth cannot be configured via \`claude_desktop_config.json\` - they must be added through the Claude Desktop UI.

### Option 2: Local Development (No OAuth)

For local development without OAuth, you can create a proxy MCP server script:

1. Create \`mcp-server.js\` in your project root:

\`\`\`javascript
#!/usr/bin/env node
import { spawn } from 'child_process';

// Start Next.js dev server in background
const server = spawn('npm', ['run', 'dev'], { stdio: 'inherit' });

// Wait for server to be ready
setTimeout(() => {
  console.log('MCP server ready at http://localhost:3000${config.mcp.basePath || '/api/mcp'}');
}, 3000);

process.on('SIGINT', () => {
  server.kill();
  process.exit();
});
\`\`\`

2. Add to \`claude_desktop_config.json\`:

\`\`\`json
{
  "mcpServers": {
    "my-app": {
      "command": "node",
      "args": ["mcp-server.js"]
    }
  }
}
\`\`\`

### Option 3: Using ngrok for Local OAuth Testing

1. Start your dev server: \`npm run dev\`
2. Expose with ngrok: \`ngrok http 3000\`
3. Add to Claude Desktop via **Settings > Connectors** with your ngrok URL
`,
    'utf-8',
  )

  return true
}

/**
 * Write MCP metadata to disk
 */
export function writeMcp(config: OpenSaasConfig, outputPath: string) {
  const generated = generateMcp(config, outputPath)

  if (!generated) {
    // Clean up MCP directory if MCP is disabled
    const mcpDir = path.join(outputPath, '.opensaas', 'mcp')
    if (fs.existsSync(mcpDir)) {
      fs.rmSync(mcpDir, { recursive: true, force: true })
    }
  }

  return generated
}
