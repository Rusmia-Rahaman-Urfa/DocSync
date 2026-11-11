/**
 * End-to-end smoke test in a real browser (headless Edge/Chrome).
 *
 * Runs against a throwaway database on port 3100, walks the full demo flow
 * (login -> create/edit/save -> share -> switch account -> read-only view),
 * fails on console/page errors, and captures screenshots for the submission.
 *
 *   npm run smoke
 *
 * Override the browser binary with EDGE_PATH if needed.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const PORT = 3100;
const BASE = `http://localhost:${PORT}`;
const CANDIDATES = [
  process.env.EDGE_PATH,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
].filter(Boolean);
const executablePath = CANDIDATES.find((candidate) => existsSync(candidate));

if (!executablePath) {
  console.error('No Edge/Chrome binary found. Set EDGE_PATH and try again.');
  process.exit(1);
}

const tempDir = mkdtempSync(join(tmpdir(), 'docsync-smoke-'));
const shotsDir = join(process.cwd(), 'docs', 'screenshots');
mkdirSync(shotsDir, { recursive: true });

const server = spawn(process.execPath, ['src/server.js'], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    PORT: String(PORT),
    DOCSYNC_DATA_DIR: tempDir,
    DOCSYNC_DB: join(tempDir, 'smoke.db'),
    SESSION_SECRET: 'smoke-test-session-secret-0123456789',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let serverOutput = '';
server.stdout.on('data', (chunk) => {
  serverOutput += chunk.toString();
});
server.stderr.on('data', (chunk) => {
  serverOutput += chunk.toString();
});

async function waitForServer() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`${BASE}/healthz`);
      if (response.ok) return;
    } catch {
      // Not up yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Server did not start.\n${serverOutput}`);
}

function assert(condition, message) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

async function assertNoHorizontalOverflow(page, label) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert(overflow <= 2, `${label} has no horizontal overflow (got ${overflow}px)`);
}

let browser;
const consoleErrors = [];
const pageErrors = [];

try {
  await waitForServer();

  browser = await chromium.launch({ executablePath, headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));

  // 1. Login screen
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForSelector('.demo-btn');
  await page.screenshot({ path: join(shotsDir, '01-login.png'), fullPage: true });
  await assertNoHorizontalOverflow(page, 'login view');
  assert((await page.locator('.demo-btn').count()) === 3, 'three demo accounts are listed');

  // 2. Sign in as Ana and view the document list
  await page.locator('.demo-btn', { hasText: 'Ana Ruiz' }).click();
  await page.waitForSelector('.list-view');
  await page.waitForSelector('.doc-card');
  await page.screenshot({ path: join(shotsDir, '02-documents.png'), fullPage: true });
  await assertNoHorizontalOverflow(page, 'document list');
  assert(await page.locator('.doc-card', { hasText: 'Welcome to DocSync' }).count(), 'welcome doc is listed');

  // 3. Open the seeded document and verify rich text rendered
  await page.locator('.doc-card', { hasText: 'Welcome to DocSync' }).first().click();
  await page.waitForSelector('.ql-editor h1');
  const editorText = await page.locator('.ql-editor').innerText();
  assert(editorText.includes('Welcome to DocSync'), 'seeded heading rendered in the editor');

  // 4. Edit, rename, autosave
  await page.locator('.ql-editor').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('\n\nAdded by the automated smoke test.');
  await page.locator('#doc-title').fill('Welcome to DocSync');
  await page.waitForFunction(
    () => document.querySelector('#save-status')?.textContent.trim().startsWith('Saved'),
    null,
    { timeout: 15000 },
  );
  const saveStatus = await page.locator('#save-status').innerText();
  assert(/Saved/.test(saveStatus), 'autosave reported success');

  // 5. Persistence after reload
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.ql-editor');
  const reloadedText = await page.locator('.ql-editor').innerText();
  assert(reloadedText.includes('Added by the automated smoke test.'), 'content survived a reload');

  // 6. Share as owner
  await page.locator('#share-toggle').click();
  await page.waitForSelector('#share-form');
  await page.locator('#share-email').fill('cara@ajaia.dev');
  await page.locator('#share-role').selectOption('viewer');
  await page.locator('#share-form button[type="submit"]').click();
  await page.waitForSelector('.share-row', { hasText: 'Cara Lin' });
  await page.screenshot({ path: join(shotsDir, '03-editor-share.png'), fullPage: true });
  await assertNoHorizontalOverflow(page, 'editor with share panel');

  // 7. Sign out, sign in as the viewer
  await page.locator('#logout').click();
  await page.waitForSelector('.demo-btn');
  await page.locator('.demo-btn', { hasText: 'Cara Lin' }).click();
  await page.waitForSelector('.list-view');
  await page.locator('.doc-card', { hasText: 'Welcome to DocSync' }).first().click();
  await page.waitForSelector('.readonly-banner');
  assert(!(await page.locator('#doc-title').isEditable()), 'viewer cannot rename the title');
  assert((await page.locator('#share-toggle').count()) === 0, 'viewer cannot open the share panel');
  await page.screenshot({ path: join(shotsDir, '04-view-only.png'), fullPage: true });
  await assertNoHorizontalOverflow(page, 'view-only editor');

  // 8. A shared document appears in Ben's list too
  await page.locator('#logout').click();
  await page.waitForSelector('.demo-btn');
  await page.locator('.demo-btn', { hasText: 'Ben Okafor' }).click();
  await page.waitForSelector('.list-view');
  const sharedCount = await page.locator('.doc-card', { hasText: 'Welcome to DocSync' }).count();
  assert(sharedCount > 0, 'shared document is visible to Ben');

  // 9. Import a markdown file through the UI
  await page.setInputFiles('#file-input', {
    name: 'smoke-import.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from('# Imported by smoke\n\n- one\n- **two**\n'),
  });
  await page.waitForSelector('.ql-editor h1');
  const importedText = await page.locator('.ql-editor').innerText();
  assert(importedText.includes('Imported by smoke'), 'markdown import opened a new document');

  // 10. Rename via the title field, save with the keyboard shortcut, reload
  await page.locator('#doc-title').fill('Imported by smoke (renamed)');
  await page.keyboard.press('Control+S');
  await page.waitForFunction(
    () => document.querySelector('#save-status')?.textContent.trim().startsWith('Saved'),
    null,
    { timeout: 15000 },
  );
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('#doc-title');
  assert(
    (await page.locator('#doc-title').inputValue()) === 'Imported by smoke (renamed)',
    'renamed title survived a reload',
  );

  // 11. Export produces a download
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('a', { hasText: 'Export .md' }).click(),
  ]);
  assert(download.suggestedFilename().endsWith('.md'), 'markdown export downloads a .md file');

  await page.screenshot({ path: join(shotsDir, '05-imported.png'), fullPage: true });
  await assertNoHorizontalOverflow(page, 'imported document');

  assert(pageErrors.length === 0, `no page errors (got: ${pageErrors.join(' | ')})`);
  assert(consoleErrors.length === 0, `no console errors (got: ${consoleErrors.join(' | ')})`);

  console.log('Smoke test passed: login, edit, autosave, reload, share, view-only, import, export.');
  console.log(`Screenshots written to ${shotsDir}`);
} catch (error) {
  console.error(`Smoke test failed: ${error.message}`);
  if (serverOutput) console.error(serverOutput.trim());
  if (consoleErrors.length) console.error(`Console errors: ${consoleErrors.join(' | ')}`);
  if (pageErrors.length) console.error(`Page errors: ${pageErrors.join(' | ')}`);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  server.kill();
  await new Promise((resolve) => setTimeout(resolve, 400));
  try {
    rmSync(tempDir, { recursive: true, force: true });
  } catch {
    // Windows can hold the SQLite handle briefly; the temp dir is disposable.
  }
}
