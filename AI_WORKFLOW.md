# AI workflow note

## Tools used

- **OpenCode** (agentic coding CLI, Big Pickle model) — planning, implementation, tests, and documentation drafts.
- **Playwright Core driving the installed Microsoft Edge build** — real-browser verification of the UI and screenshot capture.
- No AI-generated images or mockups; every screenshot in `docs/screenshots/` comes from the running app.

## Where AI materially sped up the work

| Area | What it saved |
| --- | --- |
| Express + SQLite service, schema, and seed data | ~20 minutes of boilerplate, including WAL/foreign-key pragmas and the demo documents |
| Delta ↔ Markdown conversion | The fiddly part: block attributes live on newline ops, lists need running counters, links need a scheme allowlist |
| Test harness | `node:test` + built-in `fetch` against a temp database, with cookie handling and multipart uploads |
| Permission-matrix tests | Enumerating every actor/action cell, including 404-vs-403 behaviour |
| Design system and responsive CSS | A coherent visual layer without a framework or build step |
| Docs drafts | README, architecture, and this note — then edited for accuracy |

The biggest speed-up was not code volume; it was **keeping the verification loop tight**. The agent could write an API route and its test in the same pass, then run it immediately.

## What I changed or rejected

### Design-level rejections

- **Next.js + Prisma + TipTap** — rejected. Three dependency trees, a migration step, and a production build would have consumed the timebox and added failure modes that a reviewer would hit before seeing the product.
- **`better-sqlite3`** — rejected in favour of Node 24's built-in `node:sqlite`. No `node-gyp`, no prebuilt-binary mismatch on Windows or Alpine.
- **Storing editor HTML** — rejected. HTML round-trips lossily through the browser and creates a stored-XSS surface. Quill Deltas preserve formatting exactly and are rendered by a known-format renderer.
- **Auto-retrying failed saves** — rejected. It hides failures and can hammer a downed API. The UI now shows an explicit failure state and tells the user to retry with Ctrl/Cmd + S.
- **Attachments, realtime collaboration, `.docx`/PDF import, PDF export** — cut, documented in the README and architecture note. Each is a product surface of its own; half-building them would have weakened the core loop.
- **Docker-based Render deploy** — initially planned, then switched to Render's native Node runtime because Docker is not installed on this machine and I could not verify an image build locally. The `Dockerfile` remains for other platforms.

### Concrete fixes to AI output, found by running things

1. **`npm test` failed immediately.** The generated script was `node --test test/`, which Node 24 tries to resolve as a module. Changed to `node --test` (default discovery).
2. **The boot-error retry button violated the CSP added in the same build.** AI used an inline `onclick`, which `script-src 'self'` blocks. Replaced with a real event listener.
3. **The browser smoke test asserted the wrong thing.** It checked `getAttribute('readonly')`, which returns an empty string for a boolean attribute — falsy. Switched to Playwright's `isEditable()`.
4. **Mobile layout hid the document navigation entirely.** The responsive CSS collapsed the sidebar but dropped `.doc-nav`. Changed to a scrollable section so documents remain reachable on narrow screens.
5. **The smoke test's first draft polluted the seeded demo data.** It now runs against a throwaway database on a separate port, so screenshots and demos always start from a clean state.

## How correctness, UX, and reliability were verified

1. **API tests (`npm test`)** — seven integration tests over real HTTP against a temporary SQLite file. They cover authentication, create/rename/save/reload with formatting, every permission cell (owner/editor/viewer/unrelated), sharing validation, import parsing and rejection, export, and deletion rules.
2. **Real-browser smoke test (`npm run smoke`)** — headless Edge drives the actual UI: one-click login, open a document, type, wait for autosave, reload and confirm persistence, invite a viewer, sign out, sign in as that viewer, confirm the read-only state, import Markdown, and export it. The run fails on **any** console or page error and checks for horizontal overflow at each screen. It also produces the submission screenshots.
3. **Failure-path checks** — wrong password, anonymous API access, viewer write attempts, unknown share recipient, self-share, invalid role, PDF upload, empty file, missing file, empty title, non-string Delta inserts, and a 404 for an unrelated user.
4. **Visual review** — screenshots at 1440×900 for login, list, editor with sharing, view-only, and imported document; narrow-width layout checked via the responsive rules.
5. **Fresh-install check** — `npm ci` from the lockfile, `npm start`, `/healthz`, and the full smoke flow.
6. **Not verified locally:** the Docker image build (no Docker on this machine) and the live Render deployment. The Render Blueprint uses the native Node runtime specifically to avoid an unverified Docker build; the deploy steps are in the README.

## What I did not delegate

- **Scope:** which surfaces to cut, and the decision to keep the editor loop and permissions deep instead of adding breadth.
- **Data model:** Delta storage, composite share key, cascade behaviour, 404-not-403 access policy.
- **Security posture:** the deliberate demo-account tradeoff, CSP, cookie flags, and the list of gaps (CSRF, rate limiting) that are stated rather than hidden.
- **Acceptance:** every claim in the README is tied to a test, a smoke step, or an explicit limitation.

## Takeaway

AI compressed the mechanical work — CRUD, parsers, CSS, test scaffolding — and made it cheap to verify each change immediately. It did not decide what the product should be. The useful pattern was: **fix the scope first, ask for the smallest coherent slice, then require executable evidence before accepting any of it.**
