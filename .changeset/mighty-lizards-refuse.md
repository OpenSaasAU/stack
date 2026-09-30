---
'@opensaas/stack-storage': minor
---

Fix a stored-XSS vulnerability: `acceptedMimeTypes` was checked against the client-declared MIME type, and every provider stored the upload under the client's own filename extension — an `.html` file declared `application/pdf` passed a PDF-only field and was served same-origin as `text/html`.

`file()` and `image()` now validate and store under the **effective** MIME type — the declared type (or the type looked up from the filename when none is declared) for `file()`, and the bytes sharp actually decodes for `image()`, ignoring whatever the client claimed. The stored extension and the content type handed to the storage provider always derive from that effective type, never from the client's filename:

```typescript
// x.html declared as application/pdf is now stored as `<name>.pdf` with
// mimeType: 'application/pdf' — never served back as .html.
await context.db.Post.create({
  data: { attachment: new File([bytes], 'x.html', { type: 'application/pdf' }) },
})
```

Active content types (`text/html`, `image/svg+xml`, `application/xhtml+xml`, `text/xml`, `application/xml`, and the JavaScript MIME types) are now **refused by default**, even for a `file()`/`image()` field with no `validation` config at all. Opt in explicitly per field to accept one:

```typescript
richTextUpload: file({
  storage: 'files',
  validation: { acceptedMimeTypes: ['text/html'] },
}),
```

No sniffing was added for `file()` — the declared type is still trusted, since the extension/content-type fix above means a false declaration now only produces a correctly-typed, inert file. `image()` already reads the bytes to get dimensions, so it uses that same read to determine the effective type instead of trusting the declared one.
