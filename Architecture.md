# Architecture Note

## Goal and approach

The brief asked for the strongest working slice of a Google Docs–style editor in 4–6 hours. I prioritized **correct, end-to-end behavior in the four required areas** (editing, persistence, sharing, file import) over breadth, and spent the remaining time on reliability: permissions enforced by the server, no silent data loss, and automated tests.

## Overview

```
Browser (public/)                          Server (server.js)                 SQLite (data.db)
───────────────────                        ──────────────────                 ────────────────
index.html  layout + dialogs               /api/login, /api/logout            users
styles.css  design, responsive             /api/me, /api/users                sessions
app.js      contentEditable editor  ──▶    /api/documents (list/create)  ──▶  documents
            autosave, sharing UI   JSON    /api/documents/:id (get/save/del)  shares
            paste cleaning                 /api/documents/:id/shares
                                           /api/import (.txt/.md)
```

- **Backend:** Node.js `http` module, no framework, with Node's built-in **SQLite** (`node:sqlite`).
- **Frontend:** plain HTML/CSS/JavaScript with no build step. Rich text uses the browser's `contentEditable` + `execCommand`.
- **Tests:** Node's built-in test runner (`node --test`).
- **Zero npm dependencies.** Setup is `npm start`; there is nothing to install or pay for.

### Why this stack

| Decision | Reason | Trade-off |
|---|---|---|
| No framework, no dependencies | Fastest path to a reviewable, deployable build; nothing to install or break | More hand-written routing than Express/FastAPI would need |
| SQLite (built into Node) | Real relational storage with zero setup; easy to reset | Single file; not suited to multiple server instances |
| `contentEditable` + `execCommand` | Covers every required format in a few lines, no bundler | `execCommand` is deprecated (still supported in all major browsers). Production would use TipTap/ProseMirror |
| Store documents as **sanitized HTML** | Formatting round-trips exactly; simple to render | Less structured than a JSON document model |

## Data model

| Table | Columns | Notes |
|---|---|---|
| `users` | id, email, name | Three seeded demo users |
| `sessions` | token, user_id, expires_at | Random 256-bit token in an HttpOnly, SameSite=Lax cookie; 7-day expiry; stored in the DB so logins survive restarts |
| `documents` | id, owner_id, title, content, updated_at | `content` is sanitized HTML; `updated_at` (millisecond precision) doubles as a version marker |
| `shares` | document_id, user_id, role | Primary key (document_id, user_id); role is `editor` or `viewer` |

## Access control

Every document request goes through one function, `getAccess(user, doc)`, which returns `owner`, `editor`, `viewer` or nothing.

| Action | Owner | Editor | Viewer | Anyone else |
|---|---|---|---|---|
| Open | ✅ | ✅ | ✅ | 404 |
| Edit / rename | ✅ | ✅ | 403 | 404 |
| Share / change roles / remove people | ✅ | 403 | 403 | 404 |
| Delete | ✅ | 403 | 403 | 404 |

People without access get **404, not 403**, so document ids cannot be probed. The UI hides controls too, but the server is the source of truth, and tests call the API directly to prove it.

## Saving without losing work

- **Autosave** runs after 1 second without typing; there is also a Save button and Ctrl+S. A status line always shows the true state.
- **Conflict protection (optimistic concurrency):** each save sends the `updated_at` the browser last saw. The update is a single conditional SQL statement (`… WHERE id = ? AND updated_at = ?`), so if someone else saved in between, nothing is overwritten and the server returns **409** with their version. The user then chooses *Load their version* or *Keep my version*. Autosave pauses until they decide.
- Network or server errors keep the edits and **retry every 5 seconds**. The browser warns before closing a tab with unsaved changes.
- **Structure normalization:** the browser's editor can nest a list inside a paragraph (invalid HTML), which would gain extra blank lines after a reload. The structure is fixed on a copy before saving, so reopening always shows the same layout.

## Security

- **Sanitizing:** shared documents are rendered in other people's browsers, so every save passes through an allow-list. Only formatting tags (`p, h1–h3, b, i, u, ul, ol, li, br, …`) are kept, and **all attributes are removed** (no `onclick`, `style`, `src`). Pasted content is cleaned the same way in the browser, so what you see is exactly what is saved.
- Titles and names are inserted with `textContent`, never as HTML.
- Upload limits: 1 MB, extension allow-list, and a binary check (null bytes) so images or PDFs renamed to `.txt` are rejected.

## What I deliberately did not build

| Cut | Why |
|---|---|
| Real-time co-editing (live cursors, merging) | Needs WebSockets plus CRDT/OT; not achievable well in the timebox. Conflict detection protects users' work instead |
| `.docx` import | Requires parsing a ZIP + XML format. `.txt`/`.md` cover the requirement reliably |
| Real sign-up / password reset | The brief allows seeded accounts; non-working buttons would be worse than none |
| Comments, version history, export | Optional stretch items; core reliability came first |

## Known limitations

- Demo authentication: one shared password, compared in plain text, no rate limiting.
- The sanitizer is regex-based. It is covered by tests, but production should use a parser-based library such as DOMPurify.
- Render's free plan has no persistent disk: data resets on restart or redeploy.
- If a session expires while someone is typing, unsaved edits are lost on sign-in.
- The editor font is Inter when installed, otherwise Arial (no web-font download).

## Testing

`npm test` runs **14 tests** against a temporary in-memory database:

- Save and reopen preserves the title and all formatting.
- Harmful HTML is stripped while formatting is kept.
- Empty and too-long titles are rejected.
- A stale save returns 409 and does not overwrite the other person's work.
- Editor and viewer permissions are enforced, including changing roles and removing access.
- Guessed or unshared ids return 404, and signed-out users get 401.
- Deleting removes the document for everyone it was shared with.
- `.txt`/`.md` import works, and unsupported, empty, binary and over-1 MB files are rejected (exactly 1 MB is accepted).

The UI was also checked end to end in Chrome with an automated browser script. It covered autosave, refresh, paste, a real two-user conflict, the delete dialog, the viewer lock, import errors, keyboard focus, and layouts at 1366, 1024 and 768 px.

## Next 2–4 hours

1. Persistent hosting: Render disk or managed Postgres, so data survives redeploys.
2. Hashed per-user passwords (scrypt), login rate limiting, and a CSRF token.
3. Swap the editor to TipTap/ProseMirror and the sanitizer to DOMPurify.
4. Version history, which builds naturally on the existing version marker.
5. GitHub Actions CI running `npm test` on every push.
