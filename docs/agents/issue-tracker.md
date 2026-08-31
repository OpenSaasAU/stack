# Issue tracker: GitHub

Issues and PRDs for this repo live as GitHub issues.

**`gh` is not always available.** Claude Code on the web has no `gh`, no `hub`, and no direct GitHub API access from the shell by default — it has the GitHub MCP tools (`mcp__github__*`) instead. Every operation below is given in whichever form your session actually has:

| Session has                                | Use                                                                                                                           |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `gh` on `PATH`                             | the `gh` commands below                                                                                                       |
| GitHub MCP tools                           | the `mcp__github__*` tools below                                                                                              |
| Neither, but `GITHUB_TOKEN`/`GH_TOKEN` set | `curl` against the REST API (the only route for issue **dependencies** — see [Wayfinding operations](#wayfinding-operations)) |

Check with `command -v gh` before assuming the first.

`gh` resolves `GH_TOKEN` and `GITHUB_TOKEN` itself; **raw `curl` does not**, so a session with only `GH_TOKEN` set would send an empty `Authorization` header. Normalize once, and use `$TOKEN` in every REST example below:

```bash
TOKEN="${GITHUB_TOKEN:-$GH_TOKEN}"
```

## Conventions

| Operation                          | `gh`                                                                                             | MCP tool                                                                                 |
| ---------------------------------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| Create an issue                    | `gh issue create --title "..." --body "..."` (heredoc for multi-line bodies)                     | `issue_write` — `method: "create"`, `title`, `body`, `labels`                            |
| Read an issue                      | `gh issue view <n> --comments`                                                                   | `issue_read` — `method: "get"`; `"get_comments"` for comments, `"get_labels"` for labels |
| List issues                        | `gh issue list --state open --json number,title,body,labels,comments` with `--label` / `--state` | `list_issues` — `state: "OPEN"`, `labels: [...]`, `fields: [...]` to trim the payload    |
| Comment                            | `gh issue comment <n> --body "..."`                                                              | `add_issue_comment` — `issue_number`, `body`                                             |
| Labels                             | `gh issue edit <n> --add-label "..."` / `--remove-label "..."`                                   | `issue_write` — `method: "update"`, `labels`                                             |
| Assign (see [Claiming](#claiming)) | `gh issue edit <n> --add-assignee <user>`                                                        | `issue_write` — `method: "update"`, `assignees`                                          |
| Close                              | `gh issue close <n> --comment "..."`                                                             | `issue_write` — `method: "update"`, `state: "closed"`, `state_reason: "completed"`       |

Two MCP gotchas, both silent:

- **`labels` and `assignees` on `issue_write` replace the whole set**, they do not add to it. `gh`'s `--add-label` is additive; the MCP field is not. Read the current values first when you mean to add one.
- **`issue_read` output is capped.** On a long issue or a map with many children it returns a "result exceeds maximum allowed tokens" error rather than truncated content — fall back to REST.

Anything with no MCP tool at all — issue **dependencies**, most importantly — is REST-only; see [Wayfinding operations](#wayfinding-operations).

Infer the repo from `git remote -v`. `gh` does this automatically inside a clone; the MCP tools and REST both need `owner` and `repo` passed explicitly.

## Wayfinding operations

How _this_ repo expresses the `wayfinder` skill's map, tickets, blocking and frontier. Read this before charting or working a map.

### The map

A map is an ordinary issue labelled **`wayfinder:map`**. Find the open ones:

- `gh issue list --label wayfinder:map --state open`
- MCP: `list_issues` with `labels: ["wayfinder:map"]`, `state: "OPEN"`
- REST: `GET /repos/{owner}/{repo}/issues?labels=wayfinder:map&state=open`

### Tickets are sub-issues

A ticket is a **native GitHub sub-issue** of the map, not a checklist line in the map body. Create it and attach it in one call:

- MCP: `issue_write` with `method: "create"`, `parent_issue_number: <map>`, and the type label.
- REST: create the issue, then `POST /repos/{owner}/{repo}/issues/{map}/sub_issues` with `{"sub_issue_id": <the child's id>}`.

**`id` is not `number`.** The sub-issue and dependency APIs take the issue's global `id` (an eight-digit-plus integer from the issue payload), never its `#number`. Reading one back:

- MCP: `issue_read` with `method: "get_sub_issues"` — but on a large map this can exceed the tool's output cap, in which case use REST.
- REST: `GET /repos/{owner}/{repo}/issues/{map}/sub_issues?per_page=100`

Type labels, one per ticket: **`wayfinder:research`**, **`wayfinder:prototype`**, **`wayfinder:grilling`**, **`wayfinder:task`**. All four exist — do not invent a fifth.

### Blocking is native

GitHub's issue-dependency API is available on this repo and **is** the blocking mechanism — do not fall back to a body convention. This is what makes the frontier visible in GitHub's own UI without opening the map.

```bash
# A is blocked by B  (BLOCKER_ID is B's `id`, not its number)
curl -X POST -H "Authorization: Bearer $TOKEN" \
  https://api.github.com/repos/OWNER/REPO/issues/A/dependencies/blocked_by \
  -d '{"issue_id": BLOCKER_ID}'                                    # 201

curl -H "Authorization: Bearer $TOKEN" \
  https://api.github.com/repos/OWNER/REPO/issues/A/dependencies/blocked_by   # what blocks A

curl -H "Authorization: Bearer $TOKEN" \
  https://api.github.com/repos/OWNER/REPO/issues/B/dependencies/blocking     # what B blocks

curl -X DELETE -H "Authorization: Bearer $TOKEN" \
  https://api.github.com/repos/OWNER/REPO/issues/A/dependencies/blocked_by/BLOCKER_ID  # 200
```

There is no MCP tool for dependencies — this is REST-only.

**Create first, wire second.** Issues need ids before they can reference each other, so a charting session makes every ticket, then adds the edges in a second pass.

### Claiming

A session claims a ticket by **assigning it to the dev driving the map, before any work** — `gh issue edit <n> --add-assignee <user>`, or MCP `issue_write` with `method: "update"` and `assignees`. That assignee _is_ the claim: an open, unassigned ticket is unclaimed.

### The frontier

Open children of the map that are **unblocked** (every `blocked_by` entry closed) and **unassigned**. There is no single query — list the sub-issues, then filter:

```bash
curl -sS -H "Authorization: Bearer $TOKEN" \
  "https://api.github.com/repos/OWNER/REPO/issues/MAP/sub_issues?per_page=100" \
| python3 -c '
import json, sys
for i in json.load(sys.stdin):
    if i["state"] == "open" and not i["assignees"]:
        print(i["number"], "|", ",".join(l["name"] for l in i["labels"]), "|", i["title"])'
```

Then check `dependencies/blocked_by` on each candidate — GitHub also renders the blocked ones in the UI, so a human reading the map's sub-issue list sees the frontier without running anything.

### Resolving

1. Post the answer as a **resolution comment** (`gh issue comment`, or MCP `add_issue_comment`).
2. **Close** the issue with `state_reason: "completed"`.
3. Append a one-line gist plus link to the map's **Decisions so far**.

Editing the map body means rewriting it whole — there is no partial-update API in either form (MCP `issue_write` with `method: "update"` and `body` replaces the body exactly as `PATCH` does). On a long map, retyping it is both expensive and a chance to corrupt it, so fetch the body, patch it with a script, and write it back:

```bash
curl -sS -H "Authorization: Bearer $TOKEN" \
  https://api.github.com/repos/OWNER/REPO/issues/MAP \
| python3 -c 'import json,sys; open("map.md","w").write(json.load(sys.stdin)["body"])'
# ...edit map.md...
python3 -c 'import json; json.dump({"body": open("map.md").read()}, open("payload.json","w"))'
curl -X PATCH -H "Authorization: Bearer $TOKEN" \
  https://api.github.com/repos/OWNER/REPO/issues/MAP -d @payload.json
```

**Re-read the map immediately before you write to it.** Sessions run concurrently on unmerged branches; a body fetched at session start is routinely stale by write-up time.

### Attribution

Every comment or issue body you author ends with the attribution footer:

```
---
_Generated by [Claude Code](https://claude.ai/code)_
```

## When a skill says "publish to the issue tracker"

Create a GitHub issue — `gh issue create`, or MCP `issue_write` with `method: "create"`.

## When a skill says "fetch the relevant ticket"

Run `gh issue view <number> --comments`, or MCP `issue_read` with `method: "get"` followed by `method: "get_comments"`. If either reports the output cap, fall back to `GET /repos/{owner}/{repo}/issues/{number}` and `.../comments`.
