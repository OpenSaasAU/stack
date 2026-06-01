/**
 * AI development-tooling bundle for scaffolded apps.
 *
 * Every template ships an "AI bundle" — a project-oriented `CLAUDE.md` plus a
 * `.claude/` directory that registers the OpenSaaS MCP server — so a freshly
 * scaffolded project is Claude-Code-ready out of the box. When the user opts
 * out of AI tooling (`--with-ai` off / "Enable AI development tools?" declined)
 * that bundle must NOT ship.
 *
 * This module keeps the opt-out logic small, pure, and testable:
 *  - `aiBundlePaths` lists the bundle entries (relative paths) and is the single
 *    source of truth for what "the AI bundle" is.
 *  - `removeAiTooling` deletes those entries from a scaffolded project. It is a
 *    no-op when AI tooling is enabled, so callers can call it unconditionally.
 */

import fs from 'fs-extra'
import path from 'path'

/**
 * The relative paths, inside a scaffolded project, that make up the AI bundle.
 * Removing exactly these (and nothing else) is what "opting out" means.
 */
export const aiBundlePaths: readonly string[] = ['.claude', 'CLAUDE.md']

/**
 * Remove the AI development-tooling bundle from a scaffolded project unless it
 * is enabled. The decision is driven only by `enableMCP`; the sole side effect
 * is deleting the bundle paths under `targetDir`. It is a no-op (and removes
 * nothing) when AI tooling is enabled, so callers can invoke it unconditionally.
 *
 * @returns the relative paths that were removed (empty when AI tooling is kept).
 */
export async function removeAiTooling(
  targetDir: string,
  enableMCP: boolean,
): Promise<readonly string[]> {
  if (enableMCP) return []

  const removed: string[] = []
  for (const relativePath of aiBundlePaths) {
    const fullPath = path.join(targetDir, relativePath)
    if (await fs.pathExists(fullPath)) {
      await fs.remove(fullPath)
      removed.push(relativePath)
    }
  }
  return removed
}
