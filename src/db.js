import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashPassword } from './password.js';
import { markdownToDelta } from './markdown.js';

export const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

export function dataDir() {
  return process.env.DOCSYNC_DATA_DIR || join(ROOT, 'data');
}

export function databasePath() {
  return process.env.DOCSYNC_DB || join(dataDir(), 'docsync.db');
}

let cachedSecret = null;

/**
 * Session secret: use SESSION_SECRET when provided (Render generates one),
 * otherwise persist a random secret in the data directory so sessions survive
 * restarts without shipping a hard-coded key.
 */
export function sessionSecret() {
  if (cachedSecret) return cachedSecret;
  const fromEnv = process.env.SESSION_SECRET;
  if (fromEnv && fromEnv.length >= 16) {
    cachedSecret = fromEnv;
    return cachedSecret;
  }
  const dir = dataDir();
  mkdirSync(dir, { recursive: true });
  const file = join(dir, '.session-secret');
  try {
    const existing = readFileSync(file, 'utf8').trim();
    if (existing.length >= 16) {
      cachedSecret = existing;
      return cachedSecret;
    }
  } catch {
    // First boot: fall through and create the secret.
  }
  cachedSecret = randomBytes(32).toString('hex');
  writeFileSync(file, cachedSecret, { mode: 0o600 });
  return cachedSecret;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  color         TEXT NOT NULL DEFAULT '#4f46e5',
  created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS documents (
  id         TEXT PRIMARY KEY,
  owner_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  content    TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS shares (
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role        TEXT NOT NULL CHECK (role IN ('viewer', 'editor')),
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (document_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_documents_owner ON documents(owner_id);
CREATE INDEX IF NOT EXISTS idx_shares_user ON shares(user_id);
`;

const DEMO_PASSWORD = 'demo1234';

const DEMO_USERS = [
  { id: 'usr_ana', name: 'Ana Ruiz', email: 'ana@ajaia.dev', color: '#4f46e5' },
  { id: 'usr_ben', name: 'Ben Okafor', email: 'ben@ajaia.dev', color: '#0d9488' },
  { id: 'usr_cara', name: 'Cara Lin', email: 'cara@ajaia.dev', color: '#c2410c' },
];

const WELCOME_MD = `# Welcome to DocSync

DocSync is a small collaborative editor built for the Ajaia assignment. This document is owned by **Ana Ruiz** and shared with **Ben Okafor** as an editor.

## Try the basics

- Rename the title at the top of the page
- Use the toolbar for **bold**, *italic*, and underline
- Add headings, bulleted lists, or numbered lists
- Changes save automatically after a moment

## Sharing model

1. Open the Share panel as the owner
2. Invite a teammate by email as a Viewer or an Editor
3. Shared documents appear under "Shared with me" for that teammate

> Everyone sees the same formatting because documents are stored as structured editor data, not screenshots.

Signed in as a demo account? You can switch accounts from the bottom of the sidebar to see the same document from another person's perspective.
`;

const LAUNCH_MD = `# Q4 Launch Brief

**Owner:** Ana Ruiz  
**Status:** Draft for review

## Goals

- Ship the new onboarding flow to all workspaces
- Reduce time-to-first-document below 90 seconds
- Keep support tickets flat week over week

## Open questions

1. Do we gate the template gallery behind the paid plan?
2. Which analytics events are required at launch?
3. Who owns the launch announcement?

> This brief is shared read-only with Ben so he can review without editing.
`;

const NOTES_MD = `# Ben's research notes

Notes from customer calls about document workflows.

## What people asked for

- Faster ways to turn meeting notes into shared docs
- Clear ownership when several people edit the same page
- Simple permissions: view or edit, nothing in between

## Next steps

- Draft a one-page proposal for lightweight sharing
- Review with Ana before Friday
`;

function seed(db) {
  const { count } = db.prepare('SELECT COUNT(*) AS count FROM users').get();
  if (count > 0) return false;

  const now = Date.now();
  const insertUser = db.prepare(
    'INSERT INTO users (id, name, email, password_hash, color, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  );
  const insertDoc = db.prepare(
    'INSERT INTO documents (id, owner_id, title, content, created_at, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
  );
  const insertShare = db.prepare(
    'INSERT INTO shares (document_id, user_id, role, created_at) VALUES (?, ?, ?, ?)',
  );

  const passwordHash = hashPassword(DEMO_PASSWORD);
  for (const user of DEMO_USERS) {
    insertUser.run(user.id, user.name, user.email, passwordHash, user.color, now);
  }

  const docs = [
    {
      id: 'doc_welcome',
      owner: 'usr_ana',
      title: 'Welcome to DocSync',
      markdown: WELCOME_MD,
      updatedAt: now - 1000 * 60 * 12,
    },
    {
      id: 'doc_launch',
      owner: 'usr_ana',
      title: 'Q4 Launch Brief',
      markdown: LAUNCH_MD,
      updatedAt: now - 1000 * 60 * 60 * 26,
    },
    {
      id: 'doc_notes',
      owner: 'usr_ben',
      title: "Ben's research notes",
      markdown: NOTES_MD,
      updatedAt: now - 1000 * 60 * 60 * 3,
    },
  ];

  for (const doc of docs) {
    insertDoc.run(
      doc.id,
      doc.owner,
      doc.title,
      JSON.stringify(markdownToDelta(doc.markdown)),
      doc.updatedAt - 1000 * 60 * 60,
      doc.updatedAt,
      doc.owner,
    );
  }

  insertShare.run('doc_welcome', 'usr_ben', 'editor', now);
  insertShare.run('doc_launch', 'usr_ben', 'viewer', now);
  insertShare.run('doc_notes', 'usr_ana', 'editor', now);

  return true;
}

let db = null;

export function getDb() {
  if (db) return db;

  const file = databasePath();
  mkdirSync(dirname(file), { recursive: true });

  db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA busy_timeout = 5000;');
  db.exec(SCHEMA);
  seed(db);

  return db;
}

export function closeDb() {
  if (!db) return;
  db.close();
  db = null;
}

export const demoAccounts = DEMO_USERS.map(({ id, name, email, color }) => ({ id, name, email, color }));

export const DEMO_PASSWORD_HINT = DEMO_PASSWORD;
