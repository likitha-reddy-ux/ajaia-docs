# Submission: Ajaia Docs

**Candidate:** Likitha Addala
**Role:** Senior AI Engineer: AI-Native Full Stack Developer Assignment

## Links

| | |
|---|---|
| Live app | https://ajaia-docs-65tj.onrender.com (free hosting: first load after idle can take 30–60 s) |
| Source code | https://github.com/likitha-reddy-ux/ajaia-docs |
| Walkthrough video | See `VIDEO_URL.txt` |

## Test accounts

Password for all: **`Likitha@123`** (the sign-in page also has one-click buttons).

| Name | Email | Suggested use |
|---|---|---|
| Likitha | likitha@ajaia.test | Owner: create, share, delete |
| Bhavitha | bhavitha@ajaia.test | Share as **Editor** |
| Harshitha | harshitha@ajaia.test | Share as **Viewer** |

## What is included in this folder

| File / folder | Contents |
|---|---|
| `server.js`, `db.js`, `package.json` | Backend: API, permissions, sanitizing, import, SQLite schema |
| `public/` | Frontend: `index.html`, `styles.css`, `app.js` |
| `test/` | Automated tests (`npm test`, 14 tests) |
| `sample.md`, `sample.txt` | Files to try the import feature |
| `README.md` | Setup, run instructions, demo accounts, features |
| `ARCHITECTURE.md` | Architecture note: design, priorities, trade-offs, limitations |
| `AI_WORKFLOW.md` | AI workflow note: tools, speed-ups, what I changed or rejected, verification |
| `SUBMISSION.md` | This file |
| `VIDEO_URL.txt` | Link to the walkthrough video |

## What is working (end to end, on the live app)

- Create, rename, edit, autosave/save, reopen and delete documents (delete asks for confirmation).
- Rich text: Heading 1–3, bold, italic, underline, bulleted/numbered lists; preserved after refresh.
- Import `.txt` / `.md` (max 1 MB) as a new editable document; clear errors for other files.
- Sharing with **Editor** or **Viewer** roles; change role or remove access; *My documents* vs *Shared with me*.
- Permissions enforced on the server (viewers cannot edit/delete; unshared users get 404).
- Conflict protection: a second editor cannot silently overwrite the first.
- 14 automated tests passing.

## What is incomplete or intentionally out of scope

- No real-time co-editing (conflicts are detected and resolved by the user instead).
- No `.docx` import; no sign-up / password reset (seeded demo accounts per the brief).
- Free hosting has no persistent disk: data resets when Render restarts or redeploys.

## What I would build next with another 2–4 hours

1. Persistent storage (Render disk or managed Postgres).
2. Per-user hashed passwords, login rate limiting, CSRF token.
3. TipTap/ProseMirror editor + DOMPurify sanitizer.
4. Version history (builds on the existing version marker).
5. GitHub Actions CI running the test suite on every push.

## Run locally

```bash
git clone https://github.com/likitha-reddy-ux/ajaia-docs.git
cd ajaia-docs
npm start     # http://localhost:3000  (Node 22.13+, no npm install needed)
npm test
```
