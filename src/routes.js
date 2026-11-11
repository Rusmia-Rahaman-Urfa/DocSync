import { Router } from 'express';
import multer from 'multer';
import { randomUUID } from 'node:crypto';
import { basename, extname } from 'node:path';
import { demoAccounts, DEMO_PASSWORD_HINT, getDb } from './db.js';
import { verifyPassword } from './password.js';
import {
  clearSessionCookie,
  currentUser,
  requireAuth,
  setSessionCookie,
} from './auth.js';
import {
  deltaToMarkdown,
  deltaToText,
  markdownToDelta,
  plainTextToDelta,
} from './markdown.js';

export const router = Router();

const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
const MAX_TITLE_LENGTH = 200;
const MAX_CONTENT_CHARS = 200_000;
const MAX_OPS = 5000;
const ALLOWED_EXTENSIONS = new Set(['.md', '.markdown', '.txt']);
const ROLES = new Set(['viewer', 'editor']);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
});

function newId(prefix) {
  return `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
}

function fail(res, status, error, message) {
  return res.status(status).json({ error, message });
}

function parseContent(raw) {
  try {
    const parsed = JSON.parse(raw);
    return parsed && Array.isArray(parsed.ops) ? parsed : { ops: [{ insert: '\n' }] };
  } catch {
    return { ops: [{ insert: '\n' }] };
  }
}

function validateTitle(title) {
  if (typeof title !== 'string') return 'Title must be text.';
  const trimmed = title.trim();
  if (!trimmed) return 'Title cannot be empty.';
  if (trimmed.length > MAX_TITLE_LENGTH) return `Title must be ${MAX_TITLE_LENGTH} characters or fewer.`;
  return null;
}

function validateContent(content) {
  if (!content || typeof content !== 'object' || Array.isArray(content)) return 'Content must be a Delta object.';
  if (!Array.isArray(content.ops)) return 'Content must include an ops array.';
  if (content.ops.length > MAX_OPS) return 'Document content is too large.';

  let characters = 0;
  for (const op of content.ops) {
    if (!op || typeof op !== 'object' || Array.isArray(op)) return 'Invalid content operation.';
    if (typeof op.insert !== 'string') return 'Only text content is supported.';
    if (op.attributes !== undefined) {
      if (!op.attributes || typeof op.attributes !== 'object' || Array.isArray(op.attributes)) {
        return 'Invalid formatting attributes.';
      }
    }
    characters += op.insert.length;
    if (characters > MAX_CONTENT_CHARS) {
      return `Document content must be ${MAX_CONTENT_CHARS.toLocaleString('en-US')} characters or fewer.`;
    }
  }
  return null;
}

/** Look up a document plus the caller's effective role. Returns null when the caller has no access. */
function getAccess(documentId, userId) {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT d.*, u.name AS owner_name, u.email AS owner_email
       FROM documents d
       JOIN users u ON u.id = d.owner_id
       WHERE d.id = ?`,
    )
    .get(documentId);

  if (!row) return null;
  if (row.owner_id === userId) return { row, role: 'owner' };

  const share = db.prepare('SELECT role FROM shares WHERE document_id = ? AND user_id = ?').get(documentId, userId);
  if (!share) return null;
  return { row, role: share.role };
}

function summarize(row) {
  const content = parseContent(row.content);
  return {
    id: row.id,
    title: row.title,
    preview: deltaToText(content).slice(0, 140),
    role: row.role,
    owner: { id: row.owner_id, name: row.owner_name, email: row.owner_email },
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function listShares(documentId) {
  return getDb()
    .prepare(
      `SELECT s.user_id AS userId, s.role, s.created_at AS createdAt, u.name, u.email, u.color
       FROM shares s
       JOIN users u ON u.id = s.user_id
       WHERE s.document_id = ?
       ORDER BY u.name COLLATE NOCASE`,
    )
    .all(documentId);
}

function slugify(title) {
  return (
    String(title)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'document'
  );
}

// ---------------------------------------------------------------- auth

router.get('/auth/me', (req, res) => {
  res.json({
    user: currentUser(req),
    demoAccounts,
    demoPassword: DEMO_PASSWORD_HINT,
  });
});

router.post('/auth/login', (req, res) => {
  const { email, password } = req.body ?? {};
  if (typeof email !== 'string' || typeof password !== 'string' || !email.trim() || !password) {
    return fail(res, 400, 'invalid_request', 'Email and password are required.');
  }

  const user = getDb().prepare('SELECT * FROM users WHERE email = ?').get(email.trim());
  if (!user || !verifyPassword(password, user.password_hash)) {
    return fail(res, 401, 'invalid_credentials', 'Email or password is incorrect.');
  }

  setSessionCookie(res, user.id);
  return res.json({ user: { id: user.id, name: user.name, email: user.email, color: user.color } });
});

router.post('/auth/logout', (req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

router.get('/users', requireAuth, (req, res) => {
  const users = getDb().prepare('SELECT id, name, email, color FROM users ORDER BY name COLLATE NOCASE').all();
  res.json({ users });
});

// ---------------------------------------------------------------- documents

router.get('/documents', requireAuth, (req, res) => {
  const db = getDb();
  const owned = db
    .prepare(
      `SELECT d.*, u.name AS owner_name, u.email AS owner_email, 'owner' AS role
       FROM documents d
       JOIN users u ON u.id = d.owner_id
       WHERE d.owner_id = ?
       ORDER BY d.updated_at DESC`,
    )
    .all(req.user.id)
    .map(summarize);

  const shared = db
    .prepare(
      `SELECT d.*, u.name AS owner_name, u.email AS owner_email, s.role AS role
       FROM shares s
       JOIN documents d ON d.id = s.document_id
       JOIN users u ON u.id = d.owner_id
       WHERE s.user_id = ?
       ORDER BY d.updated_at DESC`,
    )
    .all(req.user.id)
    .map(summarize);

  res.json({ owned, shared });
});

router.post('/documents', requireAuth, (req, res) => {
  const body = req.body ?? {};
  const title = body.title === undefined ? 'Untitled document' : body.title;
  const titleError = validateTitle(title);
  if (titleError) return fail(res, 400, 'invalid_title', titleError);

  const db = getDb();
  const now = Date.now();
  const id = newId('doc');
  const content = { ops: [{ insert: '\n' }] };

  db.prepare(
    'INSERT INTO documents (id, owner_id, title, content, created_at, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(id, req.user.id, title.trim(), JSON.stringify(content), now, now, req.user.id);

  return res.status(201).json({
    document: {
      id,
      title: title.trim(),
      preview: '',
      role: 'owner',
      owner: { id: req.user.id, name: req.user.name, email: req.user.email },
      created_at: now,
      updated_at: now,
    },
  });
});

router.get('/documents/:id', requireAuth, (req, res) => {
  const access = getAccess(req.params.id, req.user.id);
  if (!access) return fail(res, 404, 'not_found', 'Document not found.');

  const { row, role } = access;
  const shares = role === 'owner' ? listShares(row.id) : [];

  return res.json({
    document: {
      id: row.id,
      title: row.title,
      content: parseContent(row.content),
      role,
      owner: { id: row.owner_id, name: row.owner_name, email: row.owner_email },
      shares,
      created_at: row.created_at,
      updated_at: row.updated_at,
      updated_by: row.updated_by,
    },
  });
});

router.patch('/documents/:id', requireAuth, (req, res) => {
  const access = getAccess(req.params.id, req.user.id);
  if (!access) return fail(res, 404, 'not_found', 'Document not found.');
  if (access.role === 'viewer') {
    return fail(res, 403, 'read_only', 'You have view-only access to this document.');
  }

  const body = req.body ?? {};
  if (body.title === undefined && body.content === undefined) {
    return fail(res, 400, 'invalid_request', 'Provide a title or content to update.');
  }

  let title = access.row.title;
  if (body.title !== undefined) {
    const titleError = validateTitle(body.title);
    if (titleError) return fail(res, 400, 'invalid_title', titleError);
    title = body.title.trim();
  }

  let contentRaw = access.row.content;
  if (body.content !== undefined) {
    const contentError = validateContent(body.content);
    if (contentError) return fail(res, 400, 'invalid_content', contentError);
    contentRaw = JSON.stringify(body.content);
  }

  const now = Date.now();
  getDb()
    .prepare('UPDATE documents SET title = ?, content = ?, updated_at = ?, updated_by = ? WHERE id = ?')
    .run(title, contentRaw, now, req.user.id, access.row.id);

  const content = parseContent(contentRaw);
  return res.json({
    document: {
      id: access.row.id,
      title,
      preview: deltaToText(content).slice(0, 140),
      role: access.role,
      updated_at: now,
      updated_by: req.user.id,
    },
  });
});

router.delete('/documents/:id', requireAuth, (req, res) => {
  const access = getAccess(req.params.id, req.user.id);
  if (!access) return fail(res, 404, 'not_found', 'Document not found.');
  if (access.role !== 'owner') {
    return fail(res, 403, 'forbidden', 'Only the owner can delete this document.');
  }

  getDb().prepare('DELETE FROM documents WHERE id = ?').run(access.row.id);
  return res.json({ ok: true });
});

router.get('/documents/:id/export.md', requireAuth, (req, res) => {
  const access = getAccess(req.params.id, req.user.id);
  if (!access) return fail(res, 404, 'not_found', 'Document not found.');

  const markdown = deltaToMarkdown(parseContent(access.row.content));
  res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${slugify(access.row.title)}.md"`);
  res.send(markdown);
});

// ---------------------------------------------------------------- sharing

router.post('/documents/:id/share', requireAuth, (req, res) => {
  const access = getAccess(req.params.id, req.user.id);
  if (!access) return fail(res, 404, 'not_found', 'Document not found.');
  if (access.role !== 'owner') {
    return fail(res, 403, 'forbidden', 'Only the owner can change sharing.');
  }

  const { email, role } = req.body ?? {};
  if (typeof email !== 'string' || !email.trim()) {
    return fail(res, 400, 'invalid_email', 'Enter the email of the teammate to invite.');
  }
  const normalized = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    return fail(res, 400, 'invalid_email', 'Enter a valid email address.');
  }
  if (!ROLES.has(role)) {
    return fail(res, 400, 'invalid_role', 'Role must be "viewer" or "editor".');
  }

  const db = getDb();
  const target = db.prepare('SELECT id, name, email FROM users WHERE email = ?').get(normalized);
  if (!target) {
    return fail(
      res,
      404,
      'user_not_found',
      'No DocSync account uses that email. Try ben@ajaia.dev or cara@ajaia.dev.',
    );
  }
  if (target.id === req.user.id) {
    return fail(res, 400, 'invalid_share', 'You already own this document.');
  }

  db.prepare(
    `INSERT INTO shares (document_id, user_id, role, created_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(document_id, user_id) DO UPDATE SET role = excluded.role`,
  ).run(access.row.id, target.id, role, Date.now());

  return res.json({ shares: listShares(access.row.id) });
});

router.delete('/documents/:id/share/:userId', requireAuth, (req, res) => {
  const access = getAccess(req.params.id, req.user.id);
  if (!access) return fail(res, 404, 'not_found', 'Document not found.');
  if (access.role !== 'owner') {
    return fail(res, 403, 'forbidden', 'Only the owner can change sharing.');
  }

  const result = getDb()
    .prepare('DELETE FROM shares WHERE document_id = ? AND user_id = ?')
    .run(access.row.id, req.params.userId);
  if (result.changes === 0) return fail(res, 404, 'not_found', 'That person does not have access.');

  return res.json({ shares: listShares(access.row.id) });
});

// ---------------------------------------------------------------- import

router.post('/import', requireAuth, upload.single('file'), (req, res, next) => {
  try {
    if (!req.file) {
      return fail(res, 400, 'file_required', 'Choose a .md, .markdown or .txt file to import.');
    }

    const originalName = req.file.originalname || 'document.txt';
    const extension = extname(originalName).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(extension)) {
      return fail(res, 400, 'unsupported_file', 'Only .md, .markdown and .txt files are supported.');
    }
    if (req.file.buffer.includes(0)) {
      return fail(res, 400, 'unsupported_file', 'That file looks binary. Import a plain text file instead.');
    }

    let text = req.file.buffer.toString('utf8');
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    if (!text.trim()) return fail(res, 400, 'empty_file', 'That file is empty.');

    const rawTitle = basename(originalName, extension).replace(/[_-]+/g, ' ').trim();
    const title = (rawTitle || 'Imported document').slice(0, MAX_TITLE_LENGTH);
    const content = extension === '.txt' ? plainTextToDelta(text) : markdownToDelta(text);

    const db = getDb();
    const now = Date.now();
    const id = newId('doc');
    db.prepare(
      'INSERT INTO documents (id, owner_id, title, content, created_at, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(id, req.user.id, title, JSON.stringify(content), now, now, req.user.id);

    return res.status(201).json({
      document: {
        id,
        title,
        preview: deltaToText(content).slice(0, 140),
        role: 'owner',
        owner: { id: req.user.id, name: req.user.name, email: req.user.email },
        created_at: now,
        updated_at: now,
      },
    });
  } catch (error) {
    return next(error);
  }
});

export const uploadLimits = { maxBytes: MAX_UPLOAD_BYTES, extensions: [...ALLOWED_EXTENSIONS] };
