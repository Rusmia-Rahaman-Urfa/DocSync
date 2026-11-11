# Submission

**Project:** DocSync — a lightweight collaborative document editor
**Candidate:** Rusmia Rahaman Urfa
**Live demo:** https://docsync-kxwo.onrender.com
**Walkthrough video:** https://drive.google.com/file/d/1ye98OsL0Csa0r6n0RK3Kj4pq3e_8ZziU/view (also in [`VIDEO_URL.txt`](VIDEO_URL.txt))
**Demo password (all accounts):** `demo1234`

---

## What is in this folder

| Deliverable | File | Status |
| --- | --- | --- |
| Source code | `src/`, `public/`, `test/`, `scripts/` | ✅ |
| Local setup and run instructions | [`README.md`](README.md) | ✅ |
| Architecture note | [`ARCHITECTURE.md`](ARCHITECTURE.md) | ✅ |
| AI workflow note | [`AI_WORKFLOW.md`](AI_WORKFLOW.md) | ✅ |
| Submission manifest | `SUBMISSION.md` (this file) | ✅ |
| Live product URL | https://docsync-kxwo.onrender.com | ✅ deployed |
| Walkthrough video URL | [`VIDEO_URL.txt`](VIDEO_URL.txt) | ✅ recorded |
| Screenshots | [`docs/screenshots/`](docs/screenshots) | ✅ (5 screenshots) |
| Deployment config | `Dockerfile`, `render.yaml`, `.env.example` | ✅ |
| Automated tests | `test/api.test.js`, `scripts/smoke.mjs` | ✅ |

---

## Review credentials

| Name | Email | Password | What to use it for |
| --- | --- | --- | --- |
| Ana Ruiz | `ana@ajaia.dev` | `demo1234` | Owner of two documents; can share and delete |
| Ben Okafor | `ben@ajaia.dev` | `demo1234` | Editor on one document, viewer on another |
| Cara Lin | `cara@ajaia.dev` | `demo1234` | Starts with no access — use to test an invite |

The login page lists all three as one-click buttons, so no typing is required.

## Deployment status

- **URL:** https://docsync-kxwo.onrender.com
- **Platform:** Render free tier, native Node runtime, provisioned from `render.yaml`
- **Verified live:** `/healthz` returns 200, Ana signs in and sees 2 owned + 1 shared document, Markdown export returns 200, Quill assets load, and anonymous API access returns 401
- **Cold start:** 30–60 seconds after the free instance has been idle
- **Storage:** ephemeral on the free plan — a redeploy or long idle period can reset to the seeded demo data (documented in the README)

## Run locally

Requires Node.js 24+.

```bash
npm install
npm start
# http://localhost:3000
```

```bash
npm test        # 7 API integration tests
npm run smoke   # real-browser end-to-end test + screenshots (Edge or Chrome required)
```

The SQLite database and demo data are created automatically at `data/docsync.db` on first boot.

---

## What is working end to end

- **Documents:** create, rename inline, edit rich text, autosave, reopen after refresh, delete (owner only).
- **Rich text:** headings H1–H3, bold, italic, underline, strike, bulleted and numbered lists, blockquote, links, inline code, undo/redo, clear formatting.
- **Formatting persistence:** stored as Quill Delta JSON in SQLite, so structure survives reloads and account switches.
- **File upload:** import `.md`, `.markdown`, or `.txt` (≤ 2 MB, UTF-8) into a new editable document; unsupported or empty files are rejected with a clear message.
- **Sharing:** owner invites a seeded user by email as Viewer or Editor; role changes and revocation take effect immediately.
- **Access control:** enforced server-side on every route. Viewers get 403 on writes, unrelated users get 404, only owners can share or delete.
- **Owned vs shared:** separate sidebar sections, role badges, and owner attribution on every card.
- **Export:** any collaborator can download the document as Markdown.
- **Quality:** validation on every input, consistent JSON error envelope, security headers, CSP, 2 MB upload cap, 200k character content cap.
- **Tests:** 7 API integration tests and a real-browser smoke test, both green.

## What is intentionally incomplete

- **No realtime co-editing or presence.** Two people editing at once is last-write-wins. Not claimed anywhere in the UI.
- **No optimistic concurrency.** Two tabs on the same document can overwrite each other; there is no conflict prompt.
- **No comments, suggestions, or version history.**
- **No `.docx` or PDF import; no PDF export.**
- **No attachments.** The upload requirement is satisfied by import-to-document instead.
- **No signup, password reset, login rate limiting, or CSRF tokens.** Demo accounts are public by design; cookies are `SameSite=Lax` + `httpOnly`.
- **Free-tier persistence is best-effort.** The Render free instance has an ephemeral filesystem; a redeploy or long idle period can reset to the seeded demo data. The README states this explicitly and includes a commented persistent-disk config.

## What I would build next with another 2–4 hours

1. **Optimistic concurrency** — `version` column, 409 on stale writes, and a conflict banner with reload/overwrite.
2. **Presence and live cursors** — WebSocket "who is here" plus cursor positions; CRDT editing as a follow-up.
3. **Comments anchored to text ranges**, with resolve/reopen.
4. **Version history** — append-only snapshots and a restore action.
5. **Durable storage** — Render disk or Postgres, with automated backups.
6. **Hardening** — login rate limiting, CSRF tokens, share-change audit log, `.docx` import via `mammoth`.

---

## Suggested Google Drive folder layout

```
DocSync — Rusmia Rahaman Urfa/
├── DocSync-source.zip         # this repository (37 tracked files, no node_modules/data)
├── README.md
├── ARCHITECTURE.md
├── AI_WORKFLOW.md
├── SUBMISSION.md
├── VIDEO_URL.txt
├── LIVE_URL.txt               # one line: the Render URL
└── screenshots/
    ├── 01-login.png
    ├── 02-documents.png
    ├── 03-editor-share.png
    ├── 04-view-only.png
    └── 05-imported.png
```

The source archive excludes `node_modules/` and `data/`. Both are gitignored and are recreated by `npm install` and the first boot. `git archive --format=zip -o DocSync-source.zip HEAD` produces exactly this archive.

## Reviewer path (about two minutes)

1. Open the live URL → click **Ana Ruiz**.
2. Open **Welcome to DocSync**, format a line, wait for *Saved HH:MM*, refresh.
3. **Share** → invite `cara@ajaia.dev` as **Viewer**.
4. **Sign out → Cara Lin** → open the document from *Shared with me* → confirm the **View only** banner and hidden controls.
5. **Sign out → Ben Okafor** → the same document is editable, but he cannot share or delete it.
6. Click **Import .md or .txt** and upload a Markdown file.
