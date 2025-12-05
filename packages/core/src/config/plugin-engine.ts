import type {
  OpenSaasConfig,
  Plugin,
  PluginContext,
  ListConfig,
  Hooks,
  OperationAccess,
  McpCustomTool,
  BaseFieldConfig,
} from './types.js'

/**
 * Topological sort for plugin dependency resolution
 * Ensures plugins execute in correct order based on dependencies
 */
function sortPluginsByDependencies(plugins: Plugin[]): Plugin[] {
  const pluginMap = new Map<string, Plugin>()
  const visited = new Set<string>()
  const visiting = new Set<string>()
  const sorted: Plugin[] = []

  // Build plugin map
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

    // Visit dependencies first
    if (plugin.dependencies) {
      for (const dep of plugin.dependencies) {
        visit(dep, [...path, pluginName])
      }
    }

    visiting.delete(pluginName)
    visited.add(pluginName)
    sorted.push(plugin)
  }

  // Visit all plugins
  for (const plugin of plugins) {
    visit(plugin.name)
  }

  return sorted
}

/**
 * Merge hooks from extension into existing hooks
 * Combines hook arrays so multiple plugins can add hooks
 */
function mergeHooks(existing: Hooks | undefined, extension: Hooks | undefined): Hooks | undefined {
  if (!extension) return existing
  if (!existing) return extension

  const merged: Partial<Hooks> = {}

  // Merge resolveInput hooks (chain them, passing resolvedData through)
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

  // Merge validateInput hooks (run both)
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

  // Merge beforeOperation hooks (run both in sequence)
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

  // Merge afterOperation hooks (run both in sequence)
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

/**
 * Merge access control from extension into existing access
 */
function mergeAccess(
  existing: { operation?: OperationAccess } | undefined,
  extension: { operation?: OperationAccess } | undefined,
): { operation?: OperationAccess } | undefined {
  if (!extension) return existing
  if (!existing) return extension

  const merged: { operation?: OperationAccess } = {}

  // Merge operation access (use extension if provided, otherwise keep existing)
  if (existing.operation || extension.operation) {
    merged.operation = {
      ...existing.operation,
      ...extension.operation,
    }
  }

  return merged
}

/**
 * Execute plugins and transform config
 * Returns modified config with plugin data attached
 */
export async function executePlugins(config: OpenSaasConfig): Promise<OpenSaasConfig> {
  if (!config.plugins || config.plugins.length === 0) {
    return config
  }

  // Sort plugins by dependencies
  const sortedPlugins = sortPluginsByDependencies(config.plugins)

  // Initialize mutable config state - preserve all config properties
  let currentConfig: OpenSaasConfig = {
    ...config,
    lists: { ...config.lists }, // Clone lists object to avoid mutating original
    _pluginData: {},
  }

  // Field type registry (for third-party fields)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Registry must accept any field config builder
  const fieldTypeRegistry = new Map<string, (options?: unknown) => BaseFieldConfig<any>>()

  // MCP tools registry
  const mcpToolsRegistry: McpCustomTool[] = []

  // Execute each plugin
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

        // Deep merge fields
        const mergedFields = {
          ...existing.fields,
          ...extension.fields,
        }

        // Merge hooks
        const mergedHooks = mergeHooks(existing.hooks, extension.hooks)

        // Merge access control
        const mergedAccess = mergeAccess(existing.access, extension.access)

        // Merge MCP config
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
          access: mergedAccess,
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

      setPluginData: <T>(pluginName: string, data: T) => {
        if (!currentConfig._pluginData) {
          currentConfig._pluginData = {}
        }
        currentConfig._pluginData[pluginName] = data
      },
    }

    // Execute plugin init
    await plugin.init(context)
  }

  // Store registered MCP tools in config (if any)
  if (mcpToolsRegistry.length > 0) {
    if (!currentConfig._pluginData) {
      currentConfig._pluginData = {}
    }
    currentConfig._pluginData.__mcpTools = mcpToolsRegistry
  }

  // Store plugin instances in config for runtime access
  // This allows context creation to call plugin.runtime() functions
  if (!currentConfig._plugins) {
    currentConfig._plugins = []
  }
  currentConfig._plugins = sortedPlugins

  return currentConfig
}

/**
 * Execute beforeGenerate hooks from plugins
 */
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

/**
 * Execute afterGenerate hooks from plugins
 */
export async function executeAfterGenerateHooks(
  config: OpenSaasConfig,
  files: { prismaSchema: string; types: string; context: string; [key: string]: string },
): Promise<{ prismaSchema: string; types: string; context: string; [key: string]: string }> {
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
