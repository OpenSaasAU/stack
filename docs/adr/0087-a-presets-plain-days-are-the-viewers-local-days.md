# A preset's plain days are the viewer's local days

Status: accepted

A plain `YYYY-MM-DD` on a timestamp field means the UTC day (ADR-0083's grammar, #2490). The Filter builder never writes one for a timestamp: it writes offset instants for the browser's local day. A Preset view's `search` is written by the developer and resolved on the server, which has no time zone for the viewer. So "Published on 2026-08-04" in a preset covered 10am on the 4th to 10am on the 5th for an admin in Sydney, while the same day picked in the builder covered their whole 4th.

**A preset's plain days on a timestamp field are the viewer's local days.**

## How the server learns the zone

`AdminUI` renders a client component that writes the browser's IANA zone to an `opensaas-tz` cookie (one year, `SameSite=Lax`, path `/`), rewriting it only when it differs. `ListView` reads the cookie only when the open preset has a plain day on a timestamp field, so no other request reads it. A value that is not a time zone `Intl` accepts is ignored. `ListView` also takes `timeZone`, which wins over the cookie, for a host that knows the zone another way.

The zone is a display preference, not an identity or access input. It changes which rows a filter names, never which rows the session may see, since the query is still ANDed with the access filter.

## How the days are rewritten

Before the read, each such token becomes offset instants for that day in the zone: `is` becomes the day's first and last millisecond as one `a..b` range, `>=` and `<` take the first millisecond, `>` and `<=` the last, and a range takes the first of its low day and the last of its high. A calendar day field, a value already written as an instant, a quoted value and any other field are left alone. The rewritten query is what reaches the table, so the `?search=` a first edit writes out keeps the same rows.

## What stays UTC

A plain day typed into a URL, or a preset opened before the cookie exists, is the UTC day, and its chip says "(UTC)". Reading URL days in the viewer's zone would make a shared link name different rows for different people, which a URL should not do; a preset already resolves per viewer (its `search` sees their session), so its days can too.
