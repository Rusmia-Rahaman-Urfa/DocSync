# Architecture note

## Context

A 4–6 hour assignment, compressed into roughly one hour of build time, asking for a credible product slice of a collaborative editor: creation, rich-text editing, upload, sharing, persistence, tests, and a deployment path.

That constraint drove one rule: **depth in the flows a reviewer will actually touch, and explicit cuts everywhere else.** A smaller app that survives a hostile click-through beats a broad app with broken edges.

## Priorities, in order

1. **The editing loop must feel real** — format, rename, autosave, reload, formatting intact.
2. **Sharing must be provably enforced** — not just hidden buttons. The permission matrix is tested over HTTP.
3. **Reviewers must need zero setup** — seeded accounts, one-click login, no external services, no paid dependencies.
4. **It must run reliably** — no native modules, no build step, no CDN dependency, one process.
5. **Then polish** — visual hierarchy, empty states, save feedback, error copy.

## Scope decisions

| Decision | Why |
| --- | --- |
| Import `.md`/`.txt` → **new document** (not attachments) | One upload behaviour done end to end. Attachment storage adds disk lifecycle, download auth, and cleanup for little product insight. |
| **Viewer / Editor** roles only | Demonstrates intent and is fully enforceable. Role hierarchies, transfer ownership, and link sharing would add surface without changing the story. |
| **No realtime** | Real collaborative editing is a multi-day problem (CRDT/OT, presence, reconnect). Half-built realtime is worse than none. Called out in the UI and README. |
| **No version history / comments** | Valuable, but they are separate product surfaces. Listed as next steps. |
| **Seeded demo accounts, no signup** | The assignment explicitly allows mocked auth. One-click accounts remove reviewer friction and make the sharing story testable in seconds. |
| **Markdown as the import/export boundary** | Cheap to implement, easy to verify, and useful to a real user. PDF export needs a headless browser; `.docx` needs a parser dependency. |
| **SQLite, not Postgres** | Zero infrastructure, zero cost, transactional, and durable on a mounted volume. The schema is plain SQL, so a Postgres move is mechanical. |

## Stack and why

| Layer | Choice | Rationale |
| --- | --- | --- |
| Server | Node 24 + Express 5 | Two dependencies, no build step, stable routing and static file handling |
| Persistence | `node:sqlite` | Built into Node 24 — no `node-gyp`, no prebuilt binary risk on Windows or Alpine |
| Editor | Quill 2.0.3, vendored | Mature rich-text editing with a Delta data model; vendoring removes CDN/offline failure modes |
| Frontend | Vanilla ES modules, hash router | No bundler, no hydration bugs, ~700 lines of readable code for this scope |
| Auth | scrypt + HMAC-signed cookie | No auth dependency; constant-time password checks; no server-side session table needed |
| Tests | `node:test` + built-in `fetch` | Real HTTP, real database, no test framework dependency |
| Browser verification | Playwright with the installed Edge/Chrome | Catches what API tests cannot: console errors, broken DOM, CSP violations |

**Rejected:** Next.js + Prisma + TipTap (install/build/migrate time would have eaten the budget and added failure modes), `better-sqlite3` (native build risk), Passport/NextAuth (unnecessary for three seeded accounts).

## System shape

```
Browser (public/app.js)
  │  fetch + session cookie
  ▼
Express app (src/app.js)
  ├─ security headers, JSON body limit, static files, SPA fallback, error handler
  ├─ /healthz
  └─ /api  (src/routes.js)
        ├─ auth      login / logout / me
        ├─ documents list / create / read / update / delete / export
        ├─ shares    invite / revoke
        └─ import    multipart .md/.txt → new document
              │
              ▼
        SQLite (data/docsync.db)
        users · documents · shares
```

## Data model

```sql
users(id, name, email UNIQUE COLLATE NOCASE, password_hash, color, created_at)
documents(id, owner_id → users, title, content, created_at, updated_at, updated_by → users)
shares(document_id → documents, user_id → users, role CHECK IN ('viewer','editor'), created_at,
       PRIMARY KEY (document_id, user_id))
```

- `documents.content` is a serialized **Quill Delta** (`{"ops":[...]}`).
- `shares` has a composite primary key, so a person can hold exactly one role per document; inviting again updates the role via `ON CONFLICT ... DO UPDATE`.
- Foreign keys cascade on document and user deletion, so revoking/deleting cannot leave orphaned access rows.
- Indexes on `documents.owner_id` and `shares.user_id` cover the two list queries.

## Access control

Every document route funnels through one helper:

```js
getAccess(documentId, userId) → { row, role: 'owner' | 'editor' | 'viewer' } | null
```

- Owner is derived from `documents.owner_id`; collaborators come from `shares`.
- `null` becomes **404**, not 403, so an unrelated user cannot probe for document IDs.
- Write routes reject `viewer` with 403; share/delete routes reject anyone who is not the owner.
- The UI mirrors these rules (read-only editor, hidden Share/Delete), but the UI is never the enforcement point. The API tests exercise each cell of the matrix.

## Why Deltas instead of HTML

Storing HTML from a contenteditable is tempting and wrong for this scope:

- **Fidelity:** Delta is the editor's native format. `getContents()` → store → `setContents()` round-trips headings, lists, and marks exactly. HTML round-trips through browser normalization and quietly changes structure.
- **Security:** storing HTML creates a stored-XSS surface the moment it is rendered. Deltas are rendered by Quill, which only understands known formats; the server never injects stored markup.
- **Size and previews:** previews are a simple string walk over `insert` values, with no HTML stripping.
- **Export:** Markdown is generated from the Delta at the boundary, keeping storage independent of presentation.

Validation rejects non-string inserts and caps content at 200,000 characters / 5,000 operations, so the editor cannot be used as a blob store.

## Autosave

- Edits and title changes mark the document dirty and debounce a save by 900 ms; Ctrl/Cmd+S saves immediately.
- Only one PATCH is in flight per tab. If more edits arrive mid-flight, a single queued save runs afterwards (coalescing, not a request per keystroke).
- Failures keep the document dirty, surface an explicit "Save failed — press Ctrl+S to retry" status, and do not silently drop changes. There is deliberately **no automatic retry loop** — it hides failures and can hammer a downed API.
- Navigating between documents awaits the pending save; closing the tab with unsaved changes triggers the browser's unload prompt.
- Known gap: no optimistic concurrency, so two tabs can overwrite each other (last write wins). A `version` column + 409 handling is the first item in "next".

## Auth and sessions

- Passwords are hashed with scrypt and verified with `timingSafeEqual`.
- The session cookie contains `{uid, exp}` plus an HMAC-SHA256 signature; `httpOnly`, `SameSite=Lax`, and `Secure` when on Render/HTTPS.
- The signing secret comes from `SESSION_SECRET` when set (Render generates one), otherwise a random secret is generated once and persisted with `0600` permissions.
- Demo accounts are intentionally public and one-click; this is a review aid, not a production auth design. It is documented as such.

## Upload pipeline

`multer` with **memory storage** (2 MB cap) → extension allowlist → NUL-byte check for binary files → UTF-8 decode/BOM strip → non-empty check → Markdown or plain-text parser → single INSERT. Nothing is written to disk, so there is no temp-file cleanup path to get wrong.

## Error handling and validation

- Every failure returns `{ error, message }` with a specific status: 400 validation, 401 auth, 403 permission, 404 missing/inaccessible, 409 duplicate (unused in v1), 413 size, 500 unexpected.
- The global error handler maps `multer` limits, oversized bodies, and malformed JSON to friendly messages; unknown errors are logged server-side and returned as a generic 500 with no stack trace.
- Titles are trimmed, non-empty, and capped at 200 characters. Emails are normalized and format-checked. Roles are allowlisted. Every route validates before touching the database.
- Security headers include CSP (`script-src 'self'`), `nosniff`, `DENY` framing, and a same-origin referrer policy. All UI code is external, so the strict script policy holds.

## Frontend structure

A single hash-routed module:

- `boot()` → `/api/auth/me` decides login vs. app shell.
- `#/` renders the document list (owned/shared sections, stats, empty states).
- `#/doc/:id` renders the editor; Quill is created per document and disposed with the DOM.
- A `loadToken` counter discards stale responses when the user navigates quickly.
- All user-controlled strings pass through an `escapeHtml` helper before interpolation.
- Autosave, sharing, import, export, and delete are wired to the same API the tests exercise.

## Verification

1. `npm test` — seven integration tests, real HTTP, temp database, including every permission cell, validation failures, import parsing, and export.
2. `npm run smoke` — headless Edge/Chrome drives the real UI: login → edit → autosave → reload → share → view-only account → import → export. Fails on any console/page error and checks for horizontal overflow. Produces the screenshots in `docs/screenshots/`.
3. Manual pass in two browsers at desktop and narrow widths.
4. Health check and cold-start check against the deployed Render service.

## Security posture and honest gaps

Present: hashed passwords, signed httpOnly cookies, server-side authorization, CSP, input caps, no stored HTML, no secrets in the repo.

Missing by design for the timebox: CSRF tokens (mitigated by SameSite + JSON-only bodies), login rate limiting, signup/reset, audit logging, and per-document encryption. These are called out rather than implied.

## What I would build next (2–4 hours)

1. **Optimistic concurrency** — `version` column, 409 on stale writes, conflict banner with reload/overwrite.
2. **Presence** — WebSocket broadcast of "who is here" and cursor positions; real CRDT editing is a larger follow-up.
3. **Comments** — anchored to Delta ranges, with resolve/reopen.
4. **Version history** — append-only snapshot table, restore action.
5. **Durable deployment** — Render disk or Postgres, plus automated backups.
