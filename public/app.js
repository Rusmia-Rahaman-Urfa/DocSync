/* DocSync client: a small hash-routed SPA on top of the REST API. */

const state = {
  user: null,
  demoAccounts: [],
  demoPassword: 'demo1234',
  documents: { owned: [], shared: [] },
  doc: null,
  role: null,
  quill: null,
  saveTimer: null,
  saving: false,
  saveQueued: false,
  dirty: false,
  loadToken: 0,
  shareOpen: false,
};

const appEl = document.getElementById('app');
const toastEl = document.getElementById('toast');

/* ------------------------------------------------------------------ utils */

function escapeHtml(value) {
  return String(value ?? '').replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char],
  );
}

function initials(name) {
  return String(name ?? '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join('');
}

function relativeTime(timestamp) {
  const seconds = Math.max(1, Math.round((Date.now() - Number(timestamp)) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(Number(timestamp)).toLocaleDateString();
}

function clockTime(timestamp) {
  return new Date(Number(timestamp)).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function roleLabel(role) {
  if (role === 'owner') return 'Owner';
  if (role === 'editor') return 'Can edit';
  if (role === 'viewer') return 'View only';
  return role;
}

function canEdit() {
  return state.role === 'owner' || state.role === 'editor';
}

let toastTimer = null;
function toast(message, kind = 'info') {
  toastEl.textContent = message;
  toastEl.className = `toast show ${kind === 'error' ? 'error' : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastEl.className = 'toast';
  }, 4200);
}

class ApiError extends Error {
  constructor(message, status, code) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

async function api(path, options = {}) {
  const { body, headers, ...rest } = options;
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData;

  let response;
  try {
    response = await fetch(path, {
      credentials: 'same-origin',
      ...rest,
      body,
      headers: isForm ? headers : { 'content-type': 'application/json', ...(headers || {}) },
    });
  } catch {
    throw new ApiError('Network error. Check your connection and try again.', 0, 'network_error');
  }

  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }

  if (!response.ok) {
    if (response.status === 401 && !path.includes('/auth/login')) {
      state.user = null;
      renderLogin();
      throw new ApiError('Your session expired. Please sign in again.', 401, 'unauthorized');
    }
    throw new ApiError(data?.message || `Request failed (${response.status}).`, response.status, data?.error);
  }

  return data;
}

/* ------------------------------------------------------------------ boot */

async function boot() {
  try {
    const data = await api('/api/auth/me');
    state.demoAccounts = data.demoAccounts || [];
    state.demoPassword = data.demoPassword || 'demo1234';
    if (data.user) {
      state.user = data.user;
      renderShell();
      await loadDocuments();
      await route();
    } else {
      renderLogin();
    }
  } catch (error) {
    appEl.innerHTML = `<div class="loading-card">Could not reach DocSync: ${escapeHtml(error.message)}<br /><br /><button class="btn ghost" id="boot-retry" type="button">Retry</button></div>`;
    document.getElementById('boot-retry').addEventListener('click', () => location.reload());
  }
}

/* ------------------------------------------------------------------ login */

function renderLogin() {
  state.user = null;
  state.doc = null;
  state.quill = null;
  document.title = 'Sign in · DocSync';

  const demoButtons = state.demoAccounts
    .map(
      (account) => `
        <button class="demo-btn" type="button" data-email="${escapeHtml(account.email)}">
          <span class="avatar" style="background:${escapeHtml(account.color || '#4f46e5')}">${initials(account.name)}</span>
          <span><strong>${escapeHtml(account.name)}</strong><small>${escapeHtml(account.email)}</small></span>
        </button>`,
    )
    .join('');

  appEl.className = '';
  appEl.innerHTML = `
    <div class="login-page">
      <div class="login-card">
        <div class="brand brand-lg"><span class="brand-mark">D</span> DocSync</div>
        <h1>Sign in</h1>
        <p class="muted">A lightweight collaborative editor for shared work.</p>
        <form id="login-form" novalidate>
          <label class="field"><span>Email</span>
            <input name="email" type="email" autocomplete="username" required value="ana@ajaia.dev" />
          </label>
          <label class="field"><span>Password</span>
            <input name="password" type="password" autocomplete="current-password" required value="${escapeHtml(state.demoPassword)}" />
          </label>
          <p class="form-error" id="login-error" role="alert" hidden></p>
          <button class="btn primary block" type="submit" id="login-submit">Sign in</button>
        </form>
        <div class="divider"><span>or use a demo account</span></div>
        <div class="demo-list">${demoButtons}</div>
        <p class="hint">All demo accounts use the password <code>${escapeHtml(state.demoPassword)}</code>. Sharing is easiest to test with Ana and Ben.</p>
      </div>
      <aside class="login-aside">
        <div class="brand brand-lg"><span class="brand-mark">D</span> DocSync</div>
        <h2>Write together without the busywork.</h2>
        <ul>
          <li><span class="tick">1</span><span><strong>Rich text that persists.</strong> Headings, lists, bold, italic and underline are stored as structured editor data.</span></li>
          <li><span class="tick">2</span><span><strong>Sharing with intent.</strong> Invite a teammate as a viewer or an editor, and see owned and shared work separately.</span></li>
          <li><span class="tick">3</span><span><strong>Bring your notes.</strong> Import a <code>.md</code> or <code>.txt</code> file and keep editing it as a document.</span></li>
        </ul>
        <p class="aside-note">Built as a focused product slice: document creation, editing, import, and a simple two-role sharing model. No realtime co-editing by design.</p>
      </aside>
    </div>`;

  const form = document.getElementById('login-form');
  const errorEl = document.getElementById('login-error');
  const submitButton = document.getElementById('login-submit');

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const formData = new FormData(form);
    submitLogin(formData.get('email'), formData.get('password'), errorEl, submitButton);
  });

  for (const button of document.querySelectorAll('.demo-btn')) {
    button.addEventListener('click', () => {
      const email = button.dataset.email;
      form.elements.email.value = email;
      form.elements.password.value = state.demoPassword;
      submitLogin(email, state.demoPassword, errorEl, submitButton);
    });
  }
}

async function submitLogin(email, password, errorEl, submitButton) {
  errorEl.hidden = true;
  submitButton.disabled = true;
  const originalLabel = submitButton.textContent;
  submitButton.textContent = 'Signing in…';

  try {
    const data = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    state.user = data.user;
    history.replaceState(null, '', '#/');
    renderShell();
    await loadDocuments();
    await route();
  } catch (error) {
    errorEl.textContent = error.message;
    errorEl.hidden = false;
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = originalLabel;
  }
}

async function logout() {
  try {
    await saveNow();
    await api('/api/auth/logout', { method: 'POST' });
  } catch {
    // Signing out locally is still the right outcome.
  }
  state.user = null;
  state.documents = { owned: [], shared: [] };
  state.doc = null;
  state.quill = null;
  history.replaceState(null, '', '#/');
  renderLogin();
}

/* ------------------------------------------------------------------ shell */

function renderShell() {
  appEl.className = '';
  appEl.innerHTML = `
    <div class="shell">
      <aside class="sidebar">
        <div class="sidebar-top">
          <div class="brand"><span class="brand-mark">D</span> DocSync</div>
          <button class="btn primary block" id="new-doc" type="button">New document</button>
          <button class="btn ghost block" id="import-doc" type="button">Import .md or .txt</button>
          <input type="file" id="file-input" accept=".md,.markdown,.txt" hidden />
        </div>
        <nav class="doc-nav" id="doc-nav" aria-label="Documents"></nav>
        <div class="sidebar-footer">
          <div class="user-chip" title="${escapeHtml(state.user.email)}">
            <span class="avatar" style="background:${escapeHtml(state.user.color || '#4f46e5')}">${initials(state.user.name)}</span>
            <span class="user-meta"><strong>${escapeHtml(state.user.name)}</strong><small>${escapeHtml(state.user.email)}</small></span>
          </div>
          <button class="btn ghost small" id="logout" type="button">Sign out</button>
        </div>
      </aside>
      <main class="main" id="main"></main>
    </div>`;

  document.getElementById('new-doc').addEventListener('click', createDocument);
  document.getElementById('logout').addEventListener('click', logout);

  const fileInput = document.getElementById('file-input');
  document.getElementById('import-doc').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    const [file] = fileInput.files || [];
    fileInput.value = '';
    if (file) importFile(file);
  });
}

async function loadDocuments() {
  const data = await api('/api/documents');
  state.documents = { owned: data.owned || [], shared: data.shared || [] };
  renderNav();
}

function renderNav() {
  const nav = document.getElementById('doc-nav');
  if (!nav) return;

  const hash = location.hash;
  const item = (doc) => `
    <a class="doc-item${hash === `#/doc/${doc.id}` ? ' active' : ''}" href="#/doc/${escapeHtml(doc.id)}">
      <span class="doc-item-title">${escapeHtml(doc.title)}</span>
      <span class="doc-item-meta">${doc.role === 'owner' ? escapeHtml(relativeTime(doc.updated_at)) : `${escapeHtml(doc.owner.name)} · ${escapeHtml(roleLabel(doc.role))}`}</span>
    </a>`;

  const section = (title, docs, emptyText) => `
    <div class="nav-section">
      <div class="nav-title"><span>${title}</span><span class="nav-count">${docs.length}</span></div>
      ${docs.length ? docs.map(item).join('') : `<p class="nav-empty">${emptyText}</p>`}
    </div>`;

  nav.innerHTML =
    section('My documents', state.documents.owned, 'No documents yet. Create one to get started.') +
    section('Shared with me', state.documents.shared, 'Nothing shared with you yet.');
}

async function createDocument() {
  try {
    const data = await api('/api/documents', { method: 'POST', body: JSON.stringify({ title: 'Untitled document' }) });
    await loadDocuments();
    location.hash = `#/doc/${data.document.id}`;
    toast('New document created.');
    setTimeout(() => {
      const title = document.getElementById('doc-title');
      if (title) {
        title.focus();
        title.select();
      }
    }, 120);
  } catch (error) {
    toast(error.message, 'error');
  }
}

async function importFile(file) {
  if (!/\.(md|markdown|txt)$/i.test(file.name)) {
    toast('Only .md, .markdown and .txt files can be imported.', 'error');
    return;
  }
  if (file.size > 2 * 1024 * 1024) {
    toast('Files must be 2 MB or smaller.', 'error');
    return;
  }

  const body = new FormData();
  body.append('file', file);

  try {
    const data = await api('/api/import', { method: 'POST', body });
    toast(`Imported “${data.document.title}”.`);
    await loadDocuments();
    location.hash = `#/doc/${data.document.id}`;
  } catch (error) {
    toast(error.message, 'error');
  }
}

/* ------------------------------------------------------------------ routing */

async function route() {
  if (!state.user) return;
  await saveNow();

  const match = /^#\/doc\/([A-Za-z0-9_]+)$/.exec(location.hash);
  if (match) {
    await openDocument(match[1]);
  } else {
    await showList();
  }
}

window.addEventListener('hashchange', () => {
  route().catch((error) => toast(error.message, 'error'));
});

window.addEventListener('beforeunload', (event) => {
  if (state.dirty) {
    event.preventDefault();
    event.returnValue = '';
  }
});

document.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
    if (!state.doc || !canEdit()) return;
    event.preventDefault();
    state.dirty = true;
    saveNow();
  }
});

/* ------------------------------------------------------------------ list */

async function showList() {
  const token = ++state.loadToken;
  state.doc = null;
  state.role = null;
  state.quill = null;
  state.dirty = false;
  document.title = 'DocSync';

  const main = document.getElementById('main');
  if (!main) return;

  await loadDocuments();
  if (token !== state.loadToken) return;

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const firstName = state.user.name.split(' ')[0];
  const { owned, shared } = state.documents;

  const card = (doc) => `
    <a class="doc-card" href="#/doc/${escapeHtml(doc.id)}">
      <div class="doc-card-top">
        <span class="doc-icon" aria-hidden="true">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>
        </span>
        <span class="badge ${escapeHtml(doc.role)}">${escapeHtml(roleLabel(doc.role))}</span>
      </div>
      <h3>${escapeHtml(doc.title)}</h3>
      <p class="doc-preview">${escapeHtml(doc.preview || 'Empty document')}</p>
      <div class="doc-card-foot">
        <span>${doc.role === 'owner' ? 'You' : escapeHtml(doc.owner.name)}</span>
        <span>${escapeHtml(relativeTime(doc.updated_at))}</span>
      </div>
    </a>`;

  const section = (title, hint, docs, emptyTitle, emptyBody) => `
    <section class="doc-section">
      <h2 class="section-title">${title} <span>${hint}</span></h2>
      ${
        docs.length
          ? `<div class="doc-grid">${docs.map(card).join('')}</div>`
          : `<div class="empty-state"><strong>${emptyTitle}</strong>${emptyBody}</div>`
      }
    </section>`;

  main.innerHTML = `
    <div class="list-view">
      <header class="page-head">
        <div>
          <h1>${greeting}, ${escapeHtml(firstName)}</h1>
          <p class="muted">Create, format, import, and share documents with your team.</p>
        </div>
        <div class="page-actions">
          <button class="btn primary" id="new-doc-main" type="button">New document</button>
        </div>
      </header>

      <div class="stat-row">
        <div class="stat"><strong>${owned.length}</strong><span>Documents you own</span></div>
        <div class="stat"><strong>${shared.length}</strong><span>Shared with you</span></div>
        <div class="stat"><strong>${owned.filter((doc) => doc.role === 'owner').length}</strong><span>Shareable as owner</span></div>
      </div>

      ${section('My documents', 'owned by you', owned, 'No documents yet', 'Create a new document or import a .md / .txt file to get started.')}
      ${section('Shared with me', 'invited by teammates', shared, 'Nothing shared with you yet', 'Sign in as Ben or Cara, or ask Ana to share a document with you.')}
    </div>`;

  document.getElementById('new-doc-main').addEventListener('click', createDocument);
  renderNav();
}

/* ------------------------------------------------------------------ editor */

async function openDocument(id) {
  const token = ++state.loadToken;
  state.doc = null;
  state.role = null;
  state.dirty = false;

  const main = document.getElementById('main');
  if (!main) return;
  main.innerHTML = '<div class="loading-card">Loading document…</div>';

  let data;
  try {
    data = await api(`/api/documents/${id}`);
  } catch (error) {
    if (token !== state.loadToken) return;
    main.innerHTML = `
      <div class="loading-card">
        <strong>${escapeHtml(error.status === 404 ? 'This document is not available.' : error.message)}</strong>
        <p>${error.status === 404 ? 'It may have been deleted, or you may not have access.' : ''}</p>
        <a class="btn ghost" href="#/">Back to documents</a>
      </div>`;
    return;
  }

  if (token !== state.loadToken) return;

  state.doc = data.document;
  state.role = data.document.role;
  state.shareOpen = false;
  document.title = `${data.document.title} · DocSync`;
  renderEditor(data.document);
  renderNav();
}

function renderEditor(doc) {
  const main = document.getElementById('main');
  const editable = doc.role === 'owner' || doc.role === 'editor';
  const isOwner = doc.role === 'owner';
  const ownerLine = isOwner ? 'Owned by you' : `Shared by ${escapeHtml(doc.owner.name)}`;

  main.innerHTML = `
    <div class="editor-view">
      <header class="doc-top">
        <div class="doc-heading">
          <input id="doc-title" class="doc-title" value="${escapeHtml(doc.title)}" maxlength="200" aria-label="Document title" ${editable ? '' : 'readonly'} />
          <div class="doc-sub">
            <span class="badge ${escapeHtml(doc.role)}">${escapeHtml(roleLabel(doc.role))}</span>
            <span>${ownerLine}</span>
            <span class="dot">·</span>
            <span id="save-status" class="save-status" data-kind="saved">${editable ? `Saved ${clockTime(doc.updated_at)}` : 'View only'}</span>
          </div>
        </div>
        <div class="doc-actions">
          ${isOwner ? '<button class="btn ghost" id="share-toggle" type="button">Share</button>' : ''}
          <a class="btn ghost" href="/api/documents/${escapeHtml(doc.id)}/export.md">Export .md</a>
          ${isOwner ? '<button class="btn danger-ghost" id="delete-doc" type="button">Delete</button>' : ''}
        </div>
      </header>

      ${editable ? '' : '<div class="readonly-banner"><strong>View only.</strong> The owner has given you read access. Ask for edit access to make changes.</div>'}

      ${isOwner ? '<div id="share-panel" class="share-panel" hidden></div>' : ''}

      <div class="editor-card"><div id="editor"></div></div>
      <p class="editor-foot">${editable ? 'Changes save automatically. Press Ctrl/Cmd + S to save immediately.' : 'You can export this document as Markdown.'}</p>
    </div>`;

  const titleEl = document.getElementById('doc-title');
  titleEl.addEventListener('input', () => {
    if (!canEdit()) return;
    state.dirty = true;
    setStatus('Unsaved changes', 'dirty');
    clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(saveNow, 900);
  });
  titleEl.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      titleEl.blur();
    }
  });
  titleEl.addEventListener('blur', () => {
    if (!canEdit() || !state.dirty) return;
    saveNow();
  });

  if (isOwner) {
    document.getElementById('share-toggle').addEventListener('click', () => {
      state.shareOpen = !state.shareOpen;
      const panel = document.getElementById('share-panel');
      panel.hidden = !state.shareOpen;
      if (state.shareOpen) renderSharePanel();
    });
    document.getElementById('delete-doc').addEventListener('click', deleteDocument);
  }

  initEditor(doc);
}

function initEditor(doc) {
  const container = document.getElementById('editor');
  const editable = doc.role === 'owner' || doc.role === 'editor';

  const quill = new window.Quill(container, {
    theme: 'snow',
    placeholder: editable ? 'Start writing…' : 'This document is read-only.',
    modules: editable
      ? {
          toolbar: [
            [{ header: [1, 2, 3, false] }],
            ['bold', 'italic', 'underline', 'strike'],
            [{ list: 'ordered' }, { list: 'bullet' }],
            ['blockquote', 'link'],
            ['clean'],
          ],
        }
      : { toolbar: false },
  });

  state.quill = quill;

  let suppress = true;
  try {
    quill.setContents(doc.content && Array.isArray(doc.content.ops) ? doc.content : { ops: [{ insert: '\n' }] });
  } catch {
    quill.setContents({ ops: [{ insert: '\n' }] });
  }
  suppress = false;
  quill.history.clear();

  if (!editable) {
    quill.enable(false);
  } else {
    quill.on('text-change', (delta, oldDelta, source) => {
      if (suppress || source !== 'user' || !canEdit()) return;
      state.dirty = true;
      setStatus('Unsaved changes', 'dirty');
      clearTimeout(state.saveTimer);
      state.saveTimer = setTimeout(saveNow, 900);
    });
  }
}

function setStatus(text, kind = 'saved') {
  const el = document.getElementById('save-status');
  if (!el) return;
  el.textContent = text;
  el.dataset.kind = kind;
}

async function saveNow() {
  clearTimeout(state.saveTimer);
  state.saveTimer = null;

  if (!state.doc || !canEdit() || !state.dirty) return;
  if (state.saving) {
    state.saveQueued = true;
    return;
  }

  const titleEl = document.getElementById('doc-title');
  let title = (titleEl?.value ?? state.doc.title).trim();
  if (!title) {
    title = state.doc.title;
    if (titleEl) titleEl.value = title;
    toast('Title cannot be empty — reverted.', 'error');
  }

  const docId = state.doc.id;
  state.saving = true;
  state.saveQueued = false;
  state.dirty = false;
  setStatus('Saving…', 'saving');

  try {
    const data = await api(`/api/documents/${docId}`, {
      method: 'PATCH',
      body: JSON.stringify({ title, content: state.quill.getContents() }),
    });
    if (!state.doc || state.doc.id !== docId) return;

    state.doc.title = data.document.title;
    state.doc.updated_at = data.document.updated_at;
    setStatus(`Saved ${clockTime(data.document.updated_at)}`, 'saved');
    updateSidebarDocument(data.document);
    document.title = `${data.document.title} · DocSync`;
  } catch (error) {
    if (!state.doc || state.doc.id !== docId) return;
    state.dirty = true;
    setStatus('Save failed — press Ctrl+S to retry', 'error');
    toast(error.message, 'error');
  } finally {
    state.saving = false;
    if (state.saveQueued) {
      state.saveQueued = false;
      saveNow();
    }
  }
}

function updateSidebarDocument(update) {
  let found = false;
  for (const list of [state.documents.owned, state.documents.shared]) {
    const doc = list.find((entry) => entry.id === update.id);
    if (!doc) continue;
    doc.title = update.title;
    doc.preview = update.preview;
    doc.updated_at = update.updated_at;
    found = true;
  }
  if (found) renderNav();
}

/* ------------------------------------------------------------------ sharing */

function renderSharePanel() {
  const panel = document.getElementById('share-panel');
  if (!panel || !state.doc) return;

  const shares = state.doc.shares || [];
  const rows = shares.length
    ? shares
        .map(
          (share) => `
            <li class="share-row">
              <span class="avatar" style="background:${escapeHtml(share.color || '#4f46e5')}">${initials(share.name)}</span>
              <span class="who"><strong>${escapeHtml(share.name)}</strong><small>${escapeHtml(share.email)} · ${escapeHtml(roleLabel(share.role))}</small></span>
              <button class="btn" type="button" data-remove="${escapeHtml(share.userId)}" aria-label="Remove ${escapeHtml(share.name)}">Remove</button>
            </li>`,
        )
        .join('')
    : '<li class="share-empty">Only you have access right now.</li>';

  panel.innerHTML = `
    <h3>Share “${escapeHtml(state.doc.title)}”</h3>
    <p class="muted">Invite a teammate by email. Viewers can read, editors can edit. Only you, the owner, can change access.</p>
    <form class="share-form" id="share-form">
      <input id="share-email" type="email" placeholder="teammate@ajaia.dev" aria-label="Teammate email" required />
      <select id="share-role" aria-label="Access level">
        <option value="viewer">Viewer</option>
        <option value="editor">Editor</option>
      </select>
      <button class="btn primary" type="submit">Invite</button>
    </form>
    <p class="form-error" id="share-error" role="alert" hidden></p>
    <ul class="share-list">${rows}</ul>`;

  document.getElementById('share-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const email = document.getElementById('share-email').value.trim();
    const role = document.getElementById('share-role').value;
    const errorEl = document.getElementById('share-error');
    errorEl.hidden = true;

    try {
      const data = await api(`/api/documents/${state.doc.id}/share`, {
        method: 'POST',
        body: JSON.stringify({ email, role }),
      });
      state.doc.shares = data.shares;
      renderSharePanel();
      toast(`${email} now has ${role} access.`);
    } catch (error) {
      errorEl.textContent = error.message;
      errorEl.hidden = false;
    }
  });

  for (const button of panel.querySelectorAll('[data-remove]')) {
    button.addEventListener('click', async () => {
      const userId = button.dataset.remove;
      try {
        const data = await api(`/api/documents/${state.doc.id}/share/${userId}`, { method: 'DELETE' });
        state.doc.shares = data.shares;
        renderSharePanel();
        toast('Access removed.');
      } catch (error) {
        toast(error.message, 'error');
      }
    });
  }
}

async function deleteDocument() {
  if (!state.doc) return;
  const confirmed = window.confirm(`Delete “${state.doc.title}”? This cannot be undone.`);
  if (!confirmed) return;

  try {
    await api(`/api/documents/${state.doc.id}`, { method: 'DELETE' });
    toast('Document deleted.');
    state.doc = null;
    state.dirty = false;
    clearTimeout(state.saveTimer);
    await loadDocuments();
    location.hash = '#/';
  } catch (error) {
    toast(error.message, 'error');
  }
}

/* ------------------------------------------------------------------ start */

boot();
