import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Point the app at a throwaway database before any app module is imported.
const tempDir = mkdtempSync(join(tmpdir(), 'docsync-test-'));
process.env.DOCSYNC_DATA_DIR = tempDir;
process.env.DOCSYNC_DB = join(tempDir, 'test.db');
process.env.SESSION_SECRET = 'test-session-secret-0123456789';

const { createApp } = await import('../src/app.js');
const { closeDb } = await import('../src/db.js');

let server;
let base;

before(async () => {
  const app = createApp();
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  closeDb();
  rmSync(tempDir, { recursive: true, force: true });
});

async function login(email, password = 'demo1234') {
  const response = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  assert.equal(response.status, 200, `login should succeed for ${email}`);
  const [cookie] = response.headers.getSetCookie();
  return cookie.split(';')[0];
}

async function request(cookie, path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (cookie) headers.cookie = cookie;
  if (options.body && !(options.body instanceof FormData) && !headers['content-type']) {
    headers['content-type'] = 'application/json';
  }

  const response = await fetch(`${base}${path}`, { ...options, headers });
  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  return { status: response.status, data, headers: response.headers };
}

test('health check, authentication, and session handling', async () => {
  const health = await fetch(`${base}/healthz`);
  assert.equal(health.status, 200);

  const anonymous = await request(null, '/api/documents');
  assert.equal(anonymous.status, 401);

  const me = await request(null, '/api/auth/me');
  assert.equal(me.status, 200);
  assert.equal(me.data.user, null);
  assert.equal(me.data.demoAccounts.length, 3);

  const badLogin = await request(null, '/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: 'ana@ajaia.dev', password: 'not-the-password' }),
  });
  assert.equal(badLogin.status, 401);

  const ana = await login('ana@ajaia.dev');
  const session = await request(ana, '/api/auth/me');
  assert.equal(session.data.user.email, 'ana@ajaia.dev');

  const logout = await request(ana, '/api/auth/logout', { method: 'POST' });
  assert.equal(logout.status, 200);
});

test('documents can be created, renamed, and reloaded with formatting intact', async () => {
  const ana = await login('ana@ajaia.dev');

  const created = await request(ana, '/api/documents', {
    method: 'POST',
    body: JSON.stringify({ title: 'Test document' }),
  });
  assert.equal(created.status, 201);
  const id = created.data.document.id;

  const content = {
    ops: [
      { insert: 'Launch plan' },
      { insert: '\n', attributes: { header: 1 } },
      { insert: 'ship it', attributes: { bold: true, italic: true, underline: true } },
      { insert: '\n', attributes: { list: 'bullet' } },
      { insert: 'second item' },
      { insert: '\n', attributes: { list: 'ordered' } },
    ],
  };

  const patched = await request(ana, `/api/documents/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ title: 'Renamed document', content }),
  });
  assert.equal(patched.status, 200);
  assert.equal(patched.data.document.title, 'Renamed document');

  const reloaded = await request(ana, `/api/documents/${id}`);
  assert.equal(reloaded.status, 200);
  assert.deepEqual(reloaded.data.document.content, content);
  assert.equal(reloaded.data.document.role, 'owner');

  const list = await request(ana, '/api/documents');
  const summary = list.data.owned.find((doc) => doc.id === id);
  assert.ok(summary, 'new document should appear in the owned list');
  assert.equal(summary.title, 'Renamed document');
  assert.match(summary.preview, /ship it/);

  const emptyTitle = await request(ana, `/api/documents/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ title: '   ' }),
  });
  assert.equal(emptyTitle.status, 400);

  const invalidContent = await request(ana, `/api/documents/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ content: { ops: [{ insert: { image: 'https://example.com/a.png' } }] } }),
  });
  assert.equal(invalidContent.status, 400);

  const missing = await request(ana, '/api/documents/doc_does_not_exist');
  assert.equal(missing.status, 404);
});

test('sharing grants access with role-based write permissions', async () => {
  const ana = await login('ana@ajaia.dev');
  const ben = await login('ben@ajaia.dev');
  const cara = await login('cara@ajaia.dev');

  // Ana invites Cara as a viewer.
  const share = await request(ana, '/api/documents/doc_welcome/share', {
    method: 'POST',
    body: JSON.stringify({ email: 'cara@ajaia.dev', role: 'viewer' }),
  });
  assert.equal(share.status, 200);
  assert.ok(share.data.shares.some((entry) => entry.email === 'cara@ajaia.dev' && entry.role === 'viewer'));

  const caraView = await request(cara, '/api/documents/doc_welcome');
  assert.equal(caraView.status, 200);
  assert.equal(caraView.data.document.role, 'viewer');
  assert.deepEqual(caraView.data.document.shares, [], 'only the owner receives the collaborator list');

  const caraWrite = await request(cara, '/api/documents/doc_welcome', {
    method: 'PATCH',
    body: JSON.stringify({ title: 'Viewer should not write' }),
  });
  assert.equal(caraWrite.status, 403);

  const caraDelete = await request(cara, '/api/documents/doc_welcome', { method: 'DELETE' });
  assert.equal(caraDelete.status, 403);

  const caraShare = await request(cara, '/api/documents/doc_welcome/share', {
    method: 'POST',
    body: JSON.stringify({ email: 'ana@ajaia.dev', role: 'editor' }),
  });
  assert.equal(caraShare.status, 403);

  // Ben is an editor on the welcome doc (seeded share).
  const benView = await request(ben, '/api/documents/doc_welcome');
  assert.equal(benView.status, 200);
  assert.equal(benView.data.document.role, 'editor');

  const benWrite = await request(ben, '/api/documents/doc_welcome', {
    method: 'PATCH',
    body: JSON.stringify({ content: { ops: [{ insert: 'Ben edited this document' }, { insert: '\n' }] } }),
  });
  assert.equal(benWrite.status, 200);

  const benDelete = await request(ben, '/api/documents/doc_welcome', { method: 'DELETE' });
  assert.equal(benDelete.status, 403);

  // Ben is a viewer on the launch brief (seeded share).
  const benLaunch = await request(ben, '/api/documents/doc_launch');
  assert.equal(benLaunch.data.document.role, 'viewer');
  const benLaunchWrite = await request(ben, '/api/documents/doc_launch', {
    method: 'PATCH',
    body: JSON.stringify({ title: 'Viewer should not write' }),
  });
  assert.equal(benLaunchWrite.status, 403);

  // The shared list is separate from owned documents.
  const benList = await request(ben, '/api/documents');
  assert.ok(benList.data.shared.some((doc) => doc.id === 'doc_welcome'));
  assert.ok(benList.data.shared.some((doc) => doc.id === 'doc_launch'));
  assert.ok(benList.data.owned.every((doc) => doc.role === 'owner'));

  // Revoking access takes effect immediately.
  const revoke = await request(ana, '/api/documents/doc_welcome/share/usr_cara', { method: 'DELETE' });
  assert.equal(revoke.status, 200);
  const caraAfter = await request(cara, '/api/documents/doc_welcome');
  assert.equal(caraAfter.status, 404);

  // Users with no share cannot discover the document.
  const caraNotes = await request(cara, '/api/documents/doc_notes');
  assert.equal(caraNotes.status, 404);
});

test('sharing validates input and ownership', async () => {
  const ana = await login('ana@ajaia.dev');

  const unknownUser = await request(ana, '/api/documents/doc_welcome/share', {
    method: 'POST',
    body: JSON.stringify({ email: 'nobody@ajaia.dev', role: 'viewer' }),
  });
  assert.equal(unknownUser.status, 404);

  const selfShare = await request(ana, '/api/documents/doc_welcome/share', {
    method: 'POST',
    body: JSON.stringify({ email: 'ana@ajaia.dev', role: 'viewer' }),
  });
  assert.equal(selfShare.status, 400);

  const invalidRole = await request(ana, '/api/documents/doc_welcome/share', {
    method: 'POST',
    body: JSON.stringify({ email: 'cara@ajaia.dev', role: 'admin' }),
  });
  assert.equal(invalidRole.status, 400);

  const invalidEmail = await request(ana, '/api/documents/doc_welcome/share', {
    method: 'POST',
    body: JSON.stringify({ email: 'not-an-email', role: 'viewer' }),
  });
  assert.equal(invalidEmail.status, 400);
});

test('markdown import creates a formatted document and rejects other files', async () => {
  const ana = await login('ana@ajaia.dev');

  const form = new FormData();
  form.append(
    'file',
    new Blob(['# Imported notes\n\n- first point\n- **second point**\n\n1. step one\n'], {
      type: 'text/markdown',
    }),
    'meeting-notes.md',
  );
  const imported = await fetch(`${base}/api/import`, {
    method: 'POST',
    headers: { cookie: ana },
    body: form,
  });
  assert.equal(imported.status, 201);
  const payload = await imported.json();
  assert.equal(payload.document.title, 'meeting notes');

  const doc = await request(ana, `/api/documents/${payload.document.id}`);
  const { ops } = doc.data.document.content;
  assert.ok(ops.some((op) => op.attributes?.header === 1), 'heading should survive import');
  assert.ok(ops.some((op) => op.attributes?.list === 'bullet'), 'bullet list should survive import');
  assert.ok(ops.some((op) => op.attributes?.bold === true), 'bold should survive import');

  const pdfForm = new FormData();
  pdfForm.append('file', new Blob(['%PDF-1.4'], { type: 'application/pdf' }), 'brief.pdf');
  const rejected = await fetch(`${base}/api/import`, {
    method: 'POST',
    headers: { cookie: ana },
    body: pdfForm,
  });
  assert.equal(rejected.status, 400);

  const emptyForm = new FormData();
  emptyForm.append('file', new Blob(['   '], { type: 'text/plain' }), 'empty.txt');
  const empty = await fetch(`${base}/api/import`, {
    method: 'POST',
    headers: { cookie: ana },
    body: emptyForm,
  });
  assert.equal(empty.status, 400);

  const missingFile = await fetch(`${base}/api/import`, {
    method: 'POST',
    headers: { cookie: ana },
    body: new FormData(),
  });
  assert.equal(missingFile.status, 400);
});

test('markdown export returns the document content', async () => {
  const ana = await login('ana@ajaia.dev');

  const response = await fetch(`${base}/api/documents/doc_launch/export.md`, {
    headers: { cookie: ana },
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /text\/markdown/);
  assert.match(response.headers.get('content-disposition'), /attachment; filename="q4-launch-brief\.md"/);

  const markdown = await response.text();
  assert.match(markdown, /^# Q4 Launch Brief/);
  assert.match(markdown, /- Ship the new onboarding flow/);
});

test('only the owner can delete a document', async () => {
  const ana = await login('ana@ajaia.dev');
  const ben = await login('ben@ajaia.dev');

  const created = await request(ana, '/api/documents', {
    method: 'POST',
    body: JSON.stringify({ title: 'Disposable document' }),
  });
  const id = created.data.document.id;

  const benDelete = await request(ben, `/api/documents/${id}`, { method: 'DELETE' });
  assert.equal(benDelete.status, 404, 'non-collaborators should not learn the document exists');

  const deleted = await request(ana, `/api/documents/${id}`, { method: 'DELETE' });
  assert.equal(deleted.status, 200);

  const gone = await request(ana, `/api/documents/${id}`);
  assert.equal(gone.status, 404);
});
