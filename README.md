# Ajaia Docs

A lightweight collaborative document editor inspired by Google Docs, built for the Ajaia AI-Native Full Stack assignment.

**Live app:** https://ajaia-docs-65tj.onrender.com
**Source:** https://github.com/likitha-reddy-ux/ajaia-docs

> Hosted on Render's free plan: if the app has been idle, the first load can take 30–60 seconds while it wakes up.

## Demo accounts

All three use the password **`Likitha@123`**. The sign-in page also has one-click buttons for each account.

| Name | Email |
|---|---|
| Likitha | likitha@ajaia.test |
| Bhavitha | bhavitha@ajaia.test |
| Harshitha | harshitha@ajaia.test |

**Quick review path (about 2 minutes):**
1. Sign in as **Likitha** → **New document** → type, use Heading / Bold / Italic / Underline / lists.
2. Refresh the page: the same document reopens with formatting intact.
3. **Share** → add Bhavitha as *Can edit* and Harshitha as *Can view*.
4. Sign out → **Harshitha**: the doc is under *Shared with me*, read-only with a "View only" banner.
5. Sign out → **Bhavitha**: she can edit it.
6. **Import file** → upload `sample.md` from this repo → it becomes a new editable document.

## Features

- **Documents:** create, rename, edit, delete (with confirmation), reopen. Autosave after 1 second of inactivity, plus a Save button and Ctrl+S. Status shows *Unsaved changes… / Saving… / All changes saved ✓ / Not saved: …*.
- **Rich text:** Heading 1–3, bold, italic, underline, bulleted and numbered lists, undo/redo. Formatting is stored as sanitized HTML and survives refresh.
- **Sharing:** owner shares with another user as **Editor** or **Viewer**, can change roles or remove access. Documents are split into *My documents* and *Shared with me*. All rules are enforced on the server.
- **No silent overwrites:** if two people edit the same document, the second save is refused and the user chooses *Load their version* or *Keep my version*.
- **File import:** `.txt` and `.md` files (max 1 MB) become new editable documents. Other types, empty files and binary files are rejected with a clear message.
- **Security basics:** HttpOnly session cookie, server-side permission checks (unknown/unshared ids return 404), HTML sanitized on save and on paste.

**Supported import types: `.txt` and `.md` only (max 1 MB).** `.docx` is intentionally not supported (see ARCHITECTURE.md).

## Run locally

Requires **Node.js 22.13 or newer** (uses Node's built-in SQLite). There are **no npm dependencies** to install.

```bash
git clone https://github.com/likitha-reddy-ux/ajaia-docs.git
cd ajaia-docs
npm start          # http://localhost:3000
npm test           # 14 automated tests
```

The database file `data.db` is created automatically on first start, with the three demo accounts. Delete it to reset all data.

| Environment variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | Port to listen on (set automatically by Render) |
| `DB_PATH` | `data.db` | SQLite file location (`:memory:` is used by tests) |

## Project structure

```
server.js            HTTP server + JSON API, permissions, sanitizing, file import
db.js                SQLite schema + demo users
public/index.html    Page structure (sign-in, sidebar, editor, dialogs)
public/styles.css    Design and responsive layout
public/app.js        Browser logic: editor, autosave, sharing, import
test/                Automated tests (node:test)
sample.md, sample.txt  Files for trying the import feature
```

## Deployment

Deployed on **Render** as a Node web service: build `npm install`, start `npm start`, environment variable `NODE_VERSION=22.13.0`.

**Known limitation:** the free plan has no persistent disk, so documents are cleared when Render restarts or redeploys the service. Demo accounts are recreated automatically. In production this would use a persistent disk or a managed Postgres database.

## Further reading

- [ARCHITECTURE.md](ARCHITECTURE.md): design, what I prioritized and why, limitations, next steps
- [AI_WORKFLOW.md](AI_WORKFLOW.md): how AI tools were used and how the output was verified
- [SUBMISSION.md](SUBMISSION.md): what is included in this submission
