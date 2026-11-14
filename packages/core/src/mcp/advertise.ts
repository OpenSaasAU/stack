import type { AdvertisementPolicy } from '../access/decide-advertisement.js'

/**
 * MCP's advertisement policy. The catch is deliberately broad — an
 * `InvalidFieldAccessResultError` or a bug in the framework costs the field
 * its advertisement just as a throwing rule does.
 */
export const mcpAdvertisement: AdvertisementPolicy = {
  warning: (subject) =>
    `[opensaas] MCP is not advertising "${subject}": deciding its access threw. ` +
    `Reading or writing the field will raise the same error.`,
}
