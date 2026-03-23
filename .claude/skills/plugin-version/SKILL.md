---
name: plugin-version
description: Bump plugin versions in the OpenSaaS Stack monorepo. Use whenever you modify files in claude-plugins/* or .claude-plugin/ (marketplace root files). Handles semver bumping with patch for fixes, minor for features, and major only when explicitly requested. Directly edits plugin.json and marketplace.json — no changeset files.
allowed-tools: Read, Edit, Bash, Grep, Glob
---

# Plugin Version Skill

This skill bumps version numbers for Claude plugins and the marketplace manifest. Use it whenever you modify plugin code, skills, commands, agents, or the marketplace configuration itself.

## When to Use

- When modifying files in `claude-plugins/opensaas-stack/**`
- When modifying files in `claude-plugins/opensaas-migration/**`
- When modifying `.claude-plugin/marketplace.json` structure (not just version fields)
- When modifying `.claude-plugin/MARKETPLACE.md` or other root marketplace files
- Before committing any changes to plugins or the marketplace

## Files This Skill Manages

| Changed directory | Files to update |
|---|---|
| `claude-plugins/opensaas-stack/` | `claude-plugins/opensaas-stack/.claude-plugin/plugin.json` (version) AND `.claude-plugin/marketplace.json` (plugins[name="opensaas-stack"].version) |
| `claude-plugins/opensaas-migration/` | `claude-plugins/opensaas-migration/.claude-plugin/plugin.json` (version) AND `.claude-plugin/marketplace.json` (plugins[name="opensaas-migration"].version) |
| `.claude-plugin/` root files only | `.claude-plugin/marketplace.json` (metadata.version only) |

## Versioning Rules

### Patch (bug fixes only)

- **Use for**: Bug fixes, typo corrections, documentation fixes, minor wording improvements in skill descriptions
- **Bump**: `x.y.Z` → `x.y.Z+1`
- **Description**: Maximum 2 lines

### Minor (features or enhancements)

- **Use for**: New skills, new commands, new agents, new MCP tools, enhancements to existing capabilities
- **Bump**: `x.Y.z` → `x.Y+1.0` (reset patch to 0)
- **Description**: Describe the new capability

### Major (breaking changes)

- **Use for**: Removed skills/commands/tools, changed invocation patterns, incompatible changes
- **ONLY when explicitly requested by the user**
- **Bump**: `X.y.z` → `X+1.0.0` (reset minor and patch to 0)

## Instructions

### Step 1: Identify Changed Plugin Directories

Run git commands to detect which plugin areas changed:

```bash
git diff --name-only HEAD
# or for staged changes:
git diff --name-only --cached
# or for all changes relative to main:
git diff --name-only origin/main...HEAD
```

Look for paths starting with:
- `claude-plugins/opensaas-stack/` → opensaas-stack plugin changed
- `claude-plugins/opensaas-migration/` → opensaas-migration plugin changed
- `.claude-plugin/` → marketplace root changed (check if any file other than version fields changed)

### Step 2: Determine Version Bump Type

For each changed plugin:

- **Is this a bug fix or correction?** → Use `patch`
- **Is this a new skill, command, agent, or capability?** → Use `minor`
- **Does this remove or rename something users depend on?** → Use `major` only if user explicitly requested it; otherwise ask

### Step 3: Read Current Versions

For each affected plugin, read the current version:

```
Read: claude-plugins/<plugin-name>/.claude-plugin/plugin.json
```

The version is in the top-level `"version"` field.

For the marketplace:

```
Read: .claude-plugin/marketplace.json
```

The marketplace metadata version is at `metadata.version`. Each plugin's marketplace entry version is at `plugins[i].version` where `plugins[i].name` matches the plugin name.

### Step 4: Calculate New Version

Given the current version string `"x.y.z"`:

- **patch**: increment z → `"x.y.(z+1)"`
  - `"0.2.0"` → `"0.2.1"`
  - `"1.3.4"` → `"1.3.5"`
- **minor**: increment y, reset z to 0 → `"x.(y+1).0"`
  - `"0.2.0"` → `"0.3.0"`
  - `"1.3.4"` → `"1.4.0"`
- **major**: increment x, reset y and z to 0 → `"(x+1).0.0"`
  - `"0.2.0"` → `"1.0.0"`
  - `"1.3.4"` → `"2.0.0"`

### Step 5: Edit the JSON Files

For each changed plugin, make two targeted edits using the Edit tool.

**Edit 1 — The plugin's own plugin.json:**

Find the `"version"` field near the top of the file and replace just that value.

Example in `claude-plugins/opensaas-stack/.claude-plugin/plugin.json`:
```
"version": "0.2.0",
```
→
```
"version": "0.2.1",
```

**Edit 2 — The matching entry in marketplace.json:**

The `plugins` array in `.claude-plugin/marketplace.json` has one object per plugin. Find the object where `"name"` matches the plugin name and edit its `"version"` field.

Example: find the block for `"name": "opensaas-stack"` and edit:
```
      "version": "0.2.0",
```
→
```
      "version": "0.2.1",
```

**Edit 3 (conditional) — Marketplace metadata.version:**

Only bump `metadata.version` if files in the `.claude-plugin/` root directory were directly changed (e.g., `MARKETPLACE.md`, new fields added to `marketplace.json` structure, owner/metadata fields edited). Do NOT bump it just because plugin versions changed.

### Step 6: Verify the Edits

After editing, read back the affected files to confirm:
- The version field shows the new version
- No other fields were accidentally changed
- Both plugin.json and the matching marketplace.json entry show the same new version number

## Examples

### Example 1: Patch — Fix a typo in a skill description

Changed files: `claude-plugins/opensaas-stack/skills/some-skill/SKILL.md`

Current version: `"0.2.0"` → New version: `"0.2.1"`

Edit `claude-plugins/opensaas-stack/.claude-plugin/plugin.json`:
- `"version": "0.2.0"` → `"version": "0.2.1"`

Edit `.claude-plugin/marketplace.json` (in the `opensaas-stack` plugins entry):
- `"version": "0.2.0"` → `"version": "0.2.1"`

Do NOT change `metadata.version` — the marketplace structure itself did not change.

### Example 2: Minor — Add a new skill to opensaas-migration

Changed files: `claude-plugins/opensaas-migration/skills/new-skill/SKILL.md` (new file)

Current version: `"0.2.0"` → New version: `"0.3.0"`

Edit `claude-plugins/opensaas-migration/.claude-plugin/plugin.json`:
- `"version": "0.2.0"` → `"version": "0.3.0"`

Edit `.claude-plugin/marketplace.json` (in the `opensaas-migration` plugins entry):
- `"version": "0.2.0"` → `"version": "0.3.0"`

### Example 3: Changes to both plugins

Changed files include both `claude-plugins/opensaas-stack/...` and `claude-plugins/opensaas-migration/...`

Determine bump type independently for each plugin based on the nature of its changes. They can be bumped to different versions.

Edit `claude-plugins/opensaas-stack/.claude-plugin/plugin.json` with its new version.
Edit `claude-plugins/opensaas-migration/.claude-plugin/plugin.json` with its new version.
Edit `.claude-plugin/marketplace.json` twice — once for each plugin's entry.

### Example 4: Marketplace-only change

Changed files: `.claude-plugin/marketplace.json` (added a new top-level field) or `.claude-plugin/MARKETPLACE.md`

The marketplace structure itself changed, so bump `metadata.version`.

Current: `"version": "1.1.0"` → New: `"version": "1.1.1"` (patch)

Edit `.claude-plugin/marketplace.json` `metadata.version` field only.
Do NOT change any plugin.json files — no plugin logic changed.

## Common Mistakes to Avoid

1. **Don't bump metadata.version just because plugin versions changed**
   - Plugin version entries in marketplace.json are synced from plugin.json
   - Only bump metadata.version when the marketplace file's own structure changed

2. **Don't forget the marketplace.json plugin entry**
   - When you bump a plugin.json, always also update the matching entry in marketplace.json
   - The two must stay in sync

3. **Don't use major unless explicitly requested**
   - New skills and commands are minor, not major
   - Ask the user if you think a major bump is warranted

4. **Don't reset patch to 0 on a patch bump**
   - patch: `0.2.3` → `0.2.4` (not `0.2.0`)
   - minor: `0.2.3` → `0.3.0` (reset patch)
   - major: `0.2.3` → `1.0.0` (reset both)

5. **Don't edit unrelated fields**
   - Use Edit tool with precise old_string/new_string targeting just the version line
   - Verify after editing that only the version changed

6. **Don't create changeset files**
   - This skill edits JSON files directly
   - Plugin versions are NOT managed by the npm changeset system

## Workflow

When working on plugin changes:

1. Make your plugin code changes
2. Before committing, invoke this skill to bump versions
3. Verify the JSON files show the correct new versions
4. Commit all changed files together (plugin code + plugin.json + marketplace.json)

## Troubleshooting

**Q: Both plugins changed but for very different reasons — do I use the same bump type?**
A: No. Evaluate each plugin independently. One might be a patch and the other a minor bump.

**Q: I added a new skill AND fixed a bug in the same plugin. Which bump type?**
A: Use minor (the higher of the two).

**Q: How do I know if marketplace metadata.version should be bumped?**
A: Ask: "Did I change marketplace.json itself beyond just updating plugin version entries?" If you edited owner, metadata.description, added new top-level fields, or changed MARKETPLACE.md — yes. If you only updated plugin version numbers — no.

**Q: What if I only changed README.md inside a plugin directory?**
A: Still bump the plugin version (patch). Documentation is part of the plugin release.

**Q: Should this skill be used alongside pr-changeset?**
A: These are independent. `pr-changeset` handles npm packages in `packages/*`. This skill handles Claude plugins in `claude-plugins/*`. If a PR changes both, use both skills.

## Important Notes

- Plugin versions are semver strings stored directly in JSON — there is no automated tooling managing them
- The marketplace.json `plugins[].version` fields must always match the corresponding plugin.json `version` fields
- marketplace.json `metadata.version` is independent and tracks the marketplace manifest itself
- Both plugin.json files and marketplace.json must be committed together in the same commit as the plugin changes
