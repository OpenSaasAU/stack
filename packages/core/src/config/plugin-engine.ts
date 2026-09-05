import type {
  OpenSaasConfig,
  Plugin,
  PluginContext,
  ListConfig,
  Hooks,
  McpCustomTool,
  BaseFieldConfig,
} from './types.js'

function sortPluginsByDependencies(plugins: Plugin[]): Plugin[] {
  const pluginMap = new Map<string, Plugin>()
  const visited = new Set<string>()
  const visiting = new Set<string>()
  const sorted: Plugin[] = []

  for (const plugin of plugins) {
    if (pluginMap.has(plugin.name)) {
      throw new Error(`Duplicate plugin name: ${plugin.name}`)
    }
    pluginMap.set(plugin.name, plugin)
  }

  function visit(pluginName: string, path: string[] = []): void {
    if (visited.has(pluginName)) return

    if (visiting.has(pluginName)) {
      throw new Error(`Circular dependency detected: ${[...path, pluginName].join(' -> ')}`)
    }

    const plugin = pluginMap.get(pluginName)
    if (!plugin) {
      throw new Error(
        `Plugin "${pluginName}" is required by "${path[path.length - 1]}" but not found`,
      )
    }

    visiting.add(pluginName)

    if (plugin.dependencies) {
      for (const dep of plugin.dependencies) {
        visit(dep, [...path, pluginName])
      }
    }

    visiting.delete(pluginName)
    visited.add(pluginName)
    sorted.push(plugin)
  }

  for (const plugin of plugins) {
    visit(plugin.name)
  }

  return sorted
}

function mergeHooks(existing: Hooks | undefined, extension: Hooks | undefined): Hooks | undefined {
  if (!extension) return existing
  if (!existing) return extension

  const merged: Partial<Hooks> = {}

  if (existing.resolveInput || extension.resolveInput) {
    if (existing.resolveInput && extension.resolveInput) {
      merged.resolveInput = async (args) => {
        const result1 = await existing.resolveInput!(args)
        const result2 = await extension.resolveInput!({ ...args, resolvedData: result1 })
        return result2
      }
    } else {
      merged.resolveInput = existing.resolveInput || extension.resolveInput
    }
  }

  if (existing.validateInput || extension.validateInput) {
    if (existing.validateInput && extension.validateInput) {
      merged.validateInput = async (args) => {
        await existing.validateInput!(args)
        await extension.validateInput!(args)
      }
    } else {
      merged.validateInput = existing.validateInput || extension.validateInput
    }
  }

  if (existing.beforeOperation || extension.beforeOperation) {
    if (existing.beforeOperation && extension.beforeOperation) {
      merged.beforeOperation = async (args) => {
        await existing.beforeOperation!(args)
        await extension.beforeOperation!(args)
      }
    } else {
      merged.beforeOperation = existing.beforeOperation || extension.beforeOperation
    }
  }

  if (existing.afterOperation || extension.afterOperation) {
    if (existing.afterOperation && extension.afterOperation) {
      merged.afterOperation = async (args) => {
        await existing.afterOperation!(args)
        await extension.afterOperation!(args)
      }
    } else {
      merged.afterOperation = existing.afterOperation || extension.afterOperation
    }
  }

  return Object.keys(merged).length > 0 ? (merged as Hooks) : undefined
}

export async function executePlugins(config: OpenSaasConfig): Promise<OpenSaasConfig> {
  if (!config.plugins || config.plugins.length === 0) {
    return config
  }

  const sortedPlugins = sortPluginsByDependencies(config.plugins)

  let currentConfig: OpenSaasConfig = {
    ...config,
    lists: { ...config.lists }, // Clone lists object to avoid mutating original
    _pluginData: {},
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Registry must accept any field config builder
  const fieldTypeRegistry = new Map<string, (options?: unknown) => BaseFieldConfig<any>>()

  const mcpToolsRegistry: McpCustomTool[] = []

  for (const plugin of sortedPlugins) {
    const context: PluginContext = {
      config: currentConfig,

      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Plugin context must accept any list config
      addList: (name: string, listConfig: ListConfig<any>) => {
        if (currentConfig.lists[name]) {
          throw new Error(
            `Plugin "${plugin.name}" tried to add list "${name}" but it already exists. Use extendList() to modify existing lists.`,
          )
        }
        currentConfig.lists[name] = listConfig
      },

      extendList: (name, extension) => {
        const existing = currentConfig.lists[name]
        if (!existing) {
          throw new Error(
            `Plugin "${plugin.name}" tried to extend list "${name}" but it doesn't exist. Use addList() to create new lists.`,
          )
        }

        // Operation-level access belongs to whoever owns the list (the
        // application, or an earlier plugin that created it via addList).
        // An extension of a pre-existing list must never define or override
        // that access — see ADR-0013. Fields/hooks/relationships/mcp may
        // still be merged in below.
        if (extension.access?.operation) {
          throw new Error(
            `Plugin "${plugin.name}" tried to set operation-level access while extending list "${name}", ` +
              `but access control belongs to the application (or whichever party created the list), never a ` +
              `plugin extending it. Remove "access" from this extension — see ADR-0013.`,
          )
        }

        const mergedFields = {
          ...existing.fields,
          ...extension.fields,
        }

        const mergedHooks = mergeHooks(existing.hooks, extension.hooks)

        const mergedMcp = extension.mcp
          ? {
              ...existing.mcp,
              ...extension.mcp,
            }
          : existing.mcp

        currentConfig.lists[name] = {
          ...existing,
          fields: mergedFields,
          hooks: mergedHooks,
          mcp: mergedMcp,
        }
      },

      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Field type registry must accept any field config
      registerFieldType: (type: string, builder: (options?: unknown) => BaseFieldConfig<any>) => {
        if (fieldTypeRegistry.has(type)) {
          throw new Error(
            `Plugin "${plugin.name}" tried to register field type "${type}" but it's already registered`,
          )
        }
        fieldTypeRegistry.set(type, builder)
      },

      registerMcpTool: (tool: McpCustomTool) => {
        mcpToolsRegistry.push(tool)
      },

      addExtension: ({ name, from }) => {
        const declared = currentConfig.db?.extensions ?? []
        const existing = declared.find((descriptor) => descriptor.name === name)
        if (existing) {
          if (existing.from !== from) {
            throw new Error(
              `Plugin "${plugin.name}" tried to add extension pack "${name}" from "${from}", but the config already declares "${name}" from "${existing.from}". ` +
                `Two packs cannot share a name — rename one of them, or point both declarations at the same package.`,
            )
          }
          return
        }
        currentConfig.db = { ...currentConfig.db, extensions: [...declared, { name, from }] }
      },

      setPluginData: <T>(pluginName: string, data: T) => {
        if (!currentConfig._pluginData) {
          currentConfig._pluginData = {}
        }
        currentConfig._pluginData[pluginName] = data
      },
    }

    await plugin.init(context)
  }

  if (mcpToolsRegistry.length > 0) {
    if (!currentConfig._pluginData) {
      currentConfig._pluginData = {}
    }
    currentConfig._pluginData.__mcpTools = mcpToolsRegistry
  }

  // Stored so context creation can call each plugin's runtime() function.
  if (!currentConfig._plugins) {
    currentConfig._plugins = []
  }
  currentConfig._plugins = sortedPlugins

  return currentConfig
}

export async function executeBeforeGenerateHooks(config: OpenSaasConfig): Promise<OpenSaasConfig> {
  if (!config.plugins || config.plugins.length === 0) {
    return config
  }

  let currentConfig = config

  for (const plugin of config.plugins) {
    if (plugin.beforeGenerate) {
      currentConfig = await plugin.beforeGenerate(currentConfig)
    }
  }

  return currentConfig
}

export async function executeAfterGenerateHooks(
  config: OpenSaasConfig,
  files: { contractModule: string; types: string; context: string; [key: string]: string },
): Promise<{ contractModule: string; types: string; context: string; [key: string]: string }> {
  if (!config.plugins || config.plugins.length === 0) {
    return files
  }

  let currentFiles = files

  for (const plugin of config.plugins) {
    if (plugin.afterGenerate) {
      currentFiles = await plugin.afterGenerate(currentFiles)
    }
  }

  return currentFiles
}
