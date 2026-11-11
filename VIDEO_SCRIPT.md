# Walkthrough video script (4–5 minutes)

Record at 1440×900 or larger. Use the deployed URL so reviewers see exactly what they will test. Keep the cursor deliberate and pause briefly after each action so the result is visible.

Before recording:

- [ ] Deploy to Render and open the live URL once (free instances cold-start).
- [ ] Have a Markdown file ready on the desktop, e.g. `meeting-notes.md`.
- [ ] Close extra tabs, hide bookmarks, set the browser zoom to 100%.
- [ ] Sign out so the recording starts on the login screen.
- [ ] Do one dry run of the share flow.

---

## 0:00 – 0:25 — What this is

**Show:** the login screen.

**Say:**
> This is DocSync, a lightweight collaborative document editor. It covers document creation, rich-text editing, Markdown and text import, and a two-role sharing model. The whole thing is one Node service with SQLite — no external services, no paid dependencies.

Point at the three one-click demo accounts.

## 0:25 – 0:45 — Sign in as the owner

**Do:** click **Ana Ruiz**. Wait for the document list.

**Say:**
> I'm signing in as Ana. The sidebar separates documents she owns from documents shared with her. You can see role badges on shared items, so ownership is never ambiguous.

## 0:45 – 1:45 — The core editing loop

**Do:**
1. Open **Welcome to DocSync**.
2. Select a sentence, press **Ctrl+B** (or use the toolbar).
3. Add a bullet list item.
4. Change the title to `Welcome to DocSync`.
5. Point at the save status changing from *Unsaved changes* to *Saved HH:MM*.
6. **Refresh the page.**

**Say:**
> Formatting covers headings, bold, italic, underline, bulleted and numbered lists, quotes, and links. Edits autosave after a short pause, and there's an explicit save indicator. I'm refreshing now — the content and formatting come back exactly as they were, because documents are stored as structured editor data rather than HTML.

## 1:45 – 2:35 — Sharing

**Do:**
1. Click **Share**.
2. Invite `cara@ajaia.dev` as **Viewer**, submit.
3. Invite `ben@ajaia.dev` as **Editor** (he may already be listed — change his role if so).
4. Close the panel, sign out, sign in as **Cara Lin**.
5. Open the document from **Shared with me**.

**Say:**
> Sharing is owner-only. I can grant view or edit access by email. Now I'm switching to Cara, who was just invited as a viewer. She sees a view-only banner, the title is read-only, and there are no share or delete controls. That's also enforced in the API — a viewer's write request gets a 403, and someone with no access gets a 404 rather than learning the document exists.

## 2:35 – 3:05 — Editor role and ownership boundaries

**Do:** sign out → **Ben Okafor** → open the shared document → type a word → show save → point at the missing Share/Delete buttons.

**Say:**
> Ben is an editor: he can change the content, but he can't share it or delete it. Only the owner can do that. The role matrix is covered by automated tests.

## 3:05 – 3:35 — File import and export

**Do:**
1. Click **Import .md or .txt**, choose the Markdown file.
2. Show the imported document with its heading and list.
3. Click **Export .md** and show the download.

**Say:**
> Import accepts Markdown and plain text up to two megabytes, and turns the file into a new document with headings and lists preserved. Unsupported files like PDFs are rejected with a clear message. Export gives the document back as Markdown.

## 3:35 – 4:15 — Decisions, cuts, and what's next

**Show:** the README or architecture note.

**Say:**
> Deliberate cuts: no realtime co-editing, no comments or version history, no `.docx` or PDF import, and no attachments — the upload requirement is handled by import-to-document. I prioritised the editing loop, permission enforcement, and a deployment that reviewers can actually reach. With another few hours I'd add optimistic concurrency so two tabs can't overwrite each other, then presence and comments. One honest caveat: on Render's free tier the filesystem is ephemeral, so a redeploy can reset to the seeded demo data.

## 4:15 – 4:45 — AI workflow and verification

**Show:** `AI_WORKFLOW.md` and a terminal with `npm test` passing.

**Say:**
> I used an AI coding agent for scaffolding, the Delta–Markdown converter, test harnesses, CSS, and doc drafts. I rejected several of its suggestions: Next.js with Prisma and TipTap because the install and build risk didn't fit the timebox; `better-sqlite3` because of native build risk; and storing HTML because it's lossy and creates an XSS surface. I also fixed real defects it introduced — a test command that doesn't work on Node 24, an inline event handler blocked by the CSP, and a browser assertion that treated an empty `readonly` attribute as truthy. Verification is executable: seven API tests covering every permission cell, plus a headless-browser smoke test that drives the full flow and fails on any console error.

## 4:45 – 5:00 — Close

**Show:** the document list.

**Say:**
> That's DocSync: create, format, import, share, and persist — end to end. Setup instructions, the architecture note, and the AI workflow note are in the README and the submission folder. Thanks for reviewing.

---

## Recording tips

- Record in one take if possible; a small stumble is more credible than a heavily edited video.
- Keep the mouse still while talking; move it only when you act.
- If a save takes a moment, wait for *Saved* before refreshing — it demonstrates the autosave honestly.
- Upload as **unlisted** on YouTube or Loom, then paste the link into `VIDEO_URL.txt` and `SUBMISSION.md`.
