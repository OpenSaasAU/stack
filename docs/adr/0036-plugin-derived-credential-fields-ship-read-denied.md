# Plugin-derived credential fields ship read-denied

Status: accepted

A field on a plugin-derived list that holds a **live, presentable credential** — one where reading the value is equivalent to holding it — ships with a field-level `read` deny that the plugin sets when it creates the list. Granting operation-level access to such a list does not grant access to those fields. For the auth plugin this covers `Session.token`, `Verification.value`, `Account.password`, and the OAuth token columns (`accessToken`, `refreshToken`, `idToken`).

## Context

"Access control belongs to the application, not plugins" (ADR-0013) settled that plugin-injected lists ship **closed** and the application opens them, authoring access through a passthrough on the plugin's own config. That default does real work: nothing is reachable until the application says so.

What it does not do is give the application any granularity once it says so. A list's access carries `operation` only — there is no `fields` member on `ListAccessControl`, and field-level access is declared on the field builder at declaration time, inside the plugin. So the grant is all-or-nothing: an application that wants an ordinary "your active sessions" screen (device, IP, last seen) must open `query` on the whole session list, and thereby expose the session token too.

That exposure is not theoretical or confined to `context.db`. The admin list view renders unregistered field types through a plain text Cell, and its default-column curation excludes a hardcoded set of _names_. A credential column is neither excluded nor masked, so opening the list renders live bearer tokens as visible table columns.

So the safe configuration is not merely undocumented — it is **unexpressible**. The application cannot say "readable, except the token column" through any seam that exists.

Two properties make the deny cheap. `sudo()` skips field-level access checks, so the auth package's own identity helpers are unaffected. And better-auth's flows run through the raw Prisma driver adapter, bypassing access control entirely, so authentication never reads these columns through the secured context. Nothing in the stack's own operation depends on these fields being readable.

## Considered options

- **Ship the credential fields read-denied (chosen).** The common case is safe with no application action, which is the same direction ADR-0013 chose for lists. The application still gets the list it asked for; it just doesn't get the one column that turns a listing into a credential dump. The cost is that an application with a genuine need has no way back in — accepted for now, because no such need is known and inventing a re-opening seam before one exists would be speculative.
- **Add a field-access passthrough to the plugin config and leave the defaults open.** Rejected as the primary move: it makes the safe configuration expressible without making it the default, so an application still has to know the footgun exists to avoid it. Worth building when a concrete need to re-open a specific field appears — at which point it composes with this decision rather than replacing it.
- **Give the fields a redacting serialization wrapper instead.** Rejected as a substitute: it closes the serialization path but leaves the value readable through `context.db`, which is the wrong boundary for a credential. Not rejected as a complement — a wrapper remains a reasonable second layer if one is wanted later.
- **Fix only the admin UI's column curation.** Rejected: it addresses the most visible symptom and leaves the underlying grant just as coarse. The UI defect is real and worth fixing on its own merits, but it is not this decision.

## Consequences

- **This changes behaviour for an application that reads these fields today.** One that opens a derived auth list and deliberately reads one of these fields through `context.db` will start receiving the field stripped. The packages are pre-1.0 and ship breaking behaviour changes as **minor** releases, so this is a minor bump like any other — which makes the changeset text load-bearing: it must name each affected field explicitly, because the version number will not signal the break on its own.
- **A denied field is stripped, not an error.** It follows the field-level access path's existing behaviour; a list read still succeeds and returns every other field. The application sees a missing column, not a failure.
- **`sudo()` still reads these fields.** That is the supported path for an application with a legitimate need until a narrower seam exists, and it is what the auth package's own helpers already use.
- **The rule is about the credential, not the list.** A derived field that merely identifies (`Session.ipAddress`, `Account.providerId`) stays open. The test is whether reading the value confers the ability to act as someone — that is what earns a deny.
