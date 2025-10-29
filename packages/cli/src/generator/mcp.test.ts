import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { generateMcp } from './mcp.js'
import type { OpenSaasConfig } from '@opensaas/stack-core'
import { text } from '@opensaas/stack-core/fields'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

describe('MCP Generator', () => {
  let tempDir: string

  beforeEach(() => {
    // Create a temporary directory for each test
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-test-'))
  })

  afterEach(() => {
    // Clean up temporary directory
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  })

  describe('generateMcp', () => {
    it('should return false when MCP is not enabled', () => {
      const config: OpenSaasConfig = {
        db: {
          provider: 'sqlite',
          url: 'file:./dev.db',
        },
        lists: {
          User: {
            fields: {
              name: text(),
            },
          },
        },
      }

      const generated = generateMcp(config, tempDir)

      expect(generated).toBe(false)
    })

    it('should return true when MCP is enabled', () => {
      const config: OpenSaasConfig = {
        db: {
          provider: 'sqlite',
          url: 'file:./dev.db',
        },
        mcp: {
          enabled: true,
        },
        lists: {
          User: {
            fields: {
              name: text(),
            },
          },
        },
      }

      const generated = generateMcp(config, tempDir)

      expect(generated).toBe(true)
    })

    it('should create MCP directory when enabled', () => {
      const config: OpenSaasConfig = {
        db: {
          provider: 'sqlite',
          url: 'file:./dev.db',
        },
        mcp: {
          enabled: true,
        },
        lists: {},
      }

      generateMcp(config, tempDir)

      const mcpDir = path.join(tempDir, '.opensaas', 'mcp')
      expect(fs.existsSync(mcpDir)).toBe(true)
    })

    it('should generate tools.json with default CRUD tools', () => {
      const config: OpenSaasConfig = {
        db: {
          provider: 'sqlite',
          url: 'file:./dev.db',
        },
        mcp: {
          enabled: true,
        },
        lists: {
          User: {
            fields: {
              name: text(),
            },
          },
        },
      }

      generateMcp(config, tempDir)

      const toolsPath = path.join(tempDir, '.opensaas', 'mcp', 'tools.json')
      expect(fs.existsSync(toolsPath)).toBe(true)

      const tools = JSON.parse(fs.readFileSync(toolsPath, 'utf-8'))
      expect(tools).toHaveLength(4) // query, create, update, delete

      const toolNames = tools.map((t: { name: string }) => t.name)
      expect(toolNames).toContain('list_user_query')
      expect(toolNames).toContain('list_user_create')
      expect(toolNames).toContain('list_user_update')
      expect(toolNames).toContain('list_user_delete')
    })

    it('should respect list-level MCP enabled flag', () => {
      const config: OpenSaasConfig = {
        db: {
          provider: 'sqlite',
          url: 'file:./dev.db',
        },
        mcp: {
          enabled: true,
        },
        lists: {
          User: {
            fields: {
              name: text(),
            },
            mcp: {
              enabled: false,
            },
          },
          Post: {
            fields: {
              title: text(),
            },
          },
        },
      }

      generateMcp(config, tempDir)

      const toolsPath = path.join(tempDir, '.opensaas', 'mcp', 'tools.json')
      const tools = JSON.parse(fs.readFileSync(toolsPath, 'utf-8'))

      // Only Post tools should be generated
      const userTools = tools.filter((t: { listKey: string }) => t.listKey === 'User')
      const postTools = tools.filter((t: { listKey: string }) => t.listKey === 'Post')

      expect(userTools).toHaveLength(0)
      expect(postTools).toHaveLength(4)
    })

    it('should respect custom tool configuration', () => {
      const config: OpenSaasConfig = {
        db: {
          provider: 'sqlite',
          url: 'file:./dev.db',
        },
        mcp: {
          enabled: true,
        },
        lists: {
          User: {
            fields: {
              name: text(),
            },
            mcp: {
              tools: {
                read: true,
                create: false,
                update: false,
                delete: false,
              },
            },
          },
        },
      }

      generateMcp(config, tempDir)

      const toolsPath = path.join(tempDir, '.opensaas', 'mcp', 'tools.json')
      const tools = JSON.parse(fs.readFileSync(toolsPath, 'utf-8'))

      expect(tools).toHaveLength(1)
      expect(tools[0].name).toBe('list_user_query')
    })

    it('should include custom tools', () => {
      const config: OpenSaasConfig = {
        db: {
          provider: 'sqlite',
          url: 'file:./dev.db',
        },
        mcp: {
          enabled: true,
        },
        lists: {
          User: {
            fields: {
              name: text(),
            },
            mcp: {
              tools: {
                read: false,
                create: false,
                update: false,
                delete: false,
              },
              customTools: [
                {
                  name: 'user_verify_email',
                  description: 'Verify a user email address',
                  inputSchema: {},
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  handler: async () => ({}) as any,
                },
              ],
            },
          },
        },
      }

      generateMcp(config, tempDir)

      const toolsPath = path.join(tempDir, '.opensaas', 'mcp', 'tools.json')
      const tools = JSON.parse(fs.readFileSync(toolsPath, 'utf-8'))

      expect(tools).toHaveLength(1)
      expect(tools[0].name).toBe('user_verify_email')
      expect(tools[0].operation).toBe('custom')
    })

    it('should generate README.md with usage instructions', () => {
      const config: OpenSaasConfig = {
        db: {
          provider: 'sqlite',
          url: 'file:./dev.db',
        },
        mcp: {
          enabled: true,
        },
        lists: {
          User: {
            fields: {
              name: text(),
            },
          },
        },
      }

      generateMcp(config, tempDir)

      const readmePath = path.join(tempDir, '.opensaas', 'mcp', 'README.md')
      expect(fs.existsSync(readmePath)).toBe(true)

      const readme = fs.readFileSync(readmePath, 'utf-8')
      expect(readme).toContain('# MCP Tools Reference')
      expect(readme).toContain('Available Tools')
      expect(readme).toContain('Usage')
      expect(readme).toContain('createMcpHandlers')
      expect(readme).toContain('Connecting to Claude Desktop')
    })

    it('should list tools in README', () => {
      const config: OpenSaasConfig = {
        db: {
          provider: 'sqlite',
          url: 'file:./dev.db',
        },
        mcp: {
          enabled: true,
        },
        lists: {
          User: {
            fields: {
              name: text(),
            },
          },
        },
      }

      generateMcp(config, tempDir)

      const readmePath = path.join(tempDir, '.opensaas', 'mcp', 'README.md')
      const readme = fs.readFileSync(readmePath, 'utf-8')

      expect(readme).toContain('list_user_query')
      expect(readme).toContain('list_user_create')
      expect(readme).toContain('list_user_update')
      expect(readme).toContain('list_user_delete')
      expect(readme).toContain('4 tool(s) available')
    })

    it('should handle multiple lists', () => {
      const config: OpenSaasConfig = {
        db: {
          provider: 'sqlite',
          url: 'file:./dev.db',
        },
        mcp: {
          enabled: true,
        },
        lists: {
          User: {
            fields: {
              name: text(),
            },
          },
          Post: {
            fields: {
              title: text(),
            },
          },
        },
      }

      generateMcp(config, tempDir)

      const toolsPath = path.join(tempDir, '.opensaas', 'mcp', 'tools.json')
      const tools = JSON.parse(fs.readFileSync(toolsPath, 'utf-8'))

      expect(tools).toHaveLength(8) // 4 tools per list
    })

    it('should respect global defaultTools config', () => {
      const config: OpenSaasConfig = {
        db: {
          provider: 'sqlite',
          url: 'file:./dev.db',
        },
        mcp: {
          enabled: true,
          defaultTools: {
            read: true,
            create: true,
            update: false,
            delete: false,
          },
        },
        lists: {
          User: {
            fields: {
              name: text(),
            },
          },
        },
      }

      generateMcp(config, tempDir)

      const toolsPath = path.join(tempDir, '.opensaas', 'mcp', 'tools.json')
      const tools = JSON.parse(fs.readFileSync(toolsPath, 'utf-8'))

      expect(tools).toHaveLength(2)
      const toolNames = tools.map((t: { name: string }) => t.name)
      expect(toolNames).toContain('list_user_query')
      expect(toolNames).toContain('list_user_create')
    })

    it('should use correct dbKey for tool names', () => {
      const config: OpenSaasConfig = {
        db: {
          provider: 'sqlite',
          url: 'file:./dev.db',
        },
        mcp: {
          enabled: true,
        },
        lists: {
          BlogPost: {
            fields: {
              title: text(),
            },
          },
        },
      }

      generateMcp(config, tempDir)

      const toolsPath = path.join(tempDir, '.opensaas', 'mcp', 'tools.json')
      const tools = JSON.parse(fs.readFileSync(toolsPath, 'utf-8'))

      const toolNames = tools.map((t: { name: string }) => t.name)
      expect(toolNames).toContain('list_blogPost_query')
      expect(toolNames).toContain('list_blogPost_create')
    })
  })
})
