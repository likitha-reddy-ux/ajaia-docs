# AI Workflow Note

## Tools used

- **Claude (Anthropic)**, used as a pair programmer and reviewer throughout: planning the scope, writing most of the code, writing tests, and reviewing UI quality and reliability.
- **VS Code** for editing and running the app, **Chrome/Edge** for manual testing, **GitHub** and **Render** for hosting and deployment.

## How I worked with it

I treated the AI as a fast implementer and kept the decisions and the verification myself:

1. Broke the brief into small steps (server → database → login → documents → editor → sharing → import → tests → UI → deploy).
2. For each step, had the AI explain the approach, then ran it locally and tested it in the browser with all three demo accounts **before moving on**.
3. When something was wrong, I reported exactly what I saw (screenshots, error text) and checked the fix again.
4. Near the end, I asked for focused reviews ("review this like a senior reviewer", "make it production-quality") and required real test runs, not claims.

## Where AI materially sped things up

- **Scaffolding a zero-dependency stack** (Node `http` + built-in SQLite + vanilla JS), which made setup and deployment trivial.
- **Edge-case coverage** I would have been slow to write by hand: HTML sanitizing, Markdown conversion, conflict detection, and paste cleaning for Google Docs content.
- **Test writing:** 14 API tests covering permissions, persistence, conflicts and import validation.
- **UI polish and accessibility:** focus states, labels, live status messages, and responsive breakpoints.

## What I changed, rejected or corrected

These all came from testing in the browser, not from the AI getting it right first time:

| Issue I found | Outcome |
|---|---|
| A file got saved to my Downloads folder instead of the project, so the server could not find it | Fixed my workflow: create files only from inside the project |
| **Autosave silently did nothing** | Rewrote the save logic to use an explicit "has changes" flag instead of comparing status text |
| **Refreshing logged me out** | The cookie name `sid` matched cookies from my other local projects (e.g. `connect.sid`). Renamed it to `ajaia_sid`, read it by exact name, and moved sessions into the database |
| Refresh lost which document was open | Added the document id to the URL (`#/doc/1`) |
| I wanted friendlier demo data | Changed the demo users and password; removed UI text I found unnecessary |
| The first UI looked like a prototype | Asked for a structured UI pass, then reviewed it and requested specific fixes (e.g. the password placeholder looked like a pre-filled password) |
| `data.db` (with test data and session tokens) was pushed to GitHub | Added `.gitignore`, removed the file and rewrote the commit before deploying |
| **Two editors could silently overwrite each other** (found by an API probe the AI ran during the reliability review I requested) | Added conflict detection (409 + "Load their version / Keep my version") |
| Binary files renamed to `.txt` were accepted | Server now rejects them with a clear message |
| Lists added an extra blank line after reopening (found by the automated browser check) | Normalized the HTML structure before saving |

**Rejected or deferred on purpose:** `.docx` import and real-time co-editing (too much risk for the timebox), fake sign-up or "forgot password" buttons (non-working UI), and adding a web-font download (would add an external dependency).

## How I verified correctness, UX and reliability

- **Manual testing at every step** with three accounts (owner, editor, viewer), including refresh, sign-out/in, and the live Render deployment.
- **Automated tests:** `npm test`, 14 passing. Permissions are tested by calling the API directly, so hidden buttons alone can never pass.
- **Automated browser checks** (Chrome via Playwright) for flows that unit tests can't see: autosave, refresh persistence, paste, a real two-user conflict, the delete dialog, the viewer lock, keyboard focus, and no horizontal scrolling at 1366/1024/768 px. These found two real bugs listed above.
- **Code review:** every change came with a plain-language explanation (how the session cookie works, how `getAccess` decides permissions, why HTML is sanitized, how the conflict check works), which I read before pasting the code in and testing it.

## Reflection

AI made it possible to ship a tested, deployed product in the timebox. The most valuable parts were not the first drafts but the loop: test in the browser, report precisely, demand evidence (test runs, probes), and refuse to move on until it worked. Several of the most important fixes (silent logouts, silent overwrites, accepted garbage files) only surfaced because of that verification.
