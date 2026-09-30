/**
 * Throw from a custom or plugin MCP tool handler to return `message` to the
 * client verbatim. Any other error is redacted and logged server-side.
 */
export class McpToolError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'McpToolError'
  }
}
