/**
 * tests/assistant-browser-evidence.mjs — CORE/1.13 Browser verification.
 *
 * Boots the real panel server and exercises the Assistant UI in a real
 * Chromium browser:
 *  - Alt+6 keyboard navigation reaches Assistant tab.
 *  - Today/week views render with deterministic fixtures.
 *  - Autofill tab shows clear/conflict/stale proposals.
 *  - Manager can accept (mutate); sale sees "no permission" hint.
 *  - Planning tab commit shows partial results (per-item outcomes).
 *  - Reschedule stale version surfaces conflict.
 *  - Provider tab shows read DTO without API keys.
 *  - Reminder tab runs simulator (no real notification claim).
 *  - Narrow panel (<480px) keeps tab usable.
 *  - Manager/sale role-based UI hints differ.
 *
 * Outputs:
 *  - tests/evidence/assistant-*.png — screenshots
 *  - tests/evidence/assistant-summary.json — pass/fail summary
 */

import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { request } from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..', '..');
const EVIDENCE_DIR = join(__dirname, 'evidence');
const SUMMARY = {
  baseUrl: 'http://127.0.0.1:15507',
  startedAt: new Date().toISOString(),
  tests: [],
};

const PORT = 15507;
const BASE_URL = `http://127.0.0.1:${PORT}`;

async function ensureDir(path) {
  await mkdir(path, { recursive: true });
}

async function recordResult(name, ok, details = {}) {
  SUMMARY.tests.push({ name, ok, ...details });
  const status = ok ? '✔' : '✖';
  console.log(`${status} ${name}${details.note ? ` — ${details.note}` : ''}`);
}

function httpJson({ host, port, path, method = 'GET', headers = {}, body = null }) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const reqHeaders = { ...headers };
    if (data) reqHeaders['Content-Type'] = 'application/json';
    if (data) reqHeaders['Content-Length'] = Buffer.byteLength(data);
    const r = request(
      { host, port, path, method, headers: reqHeaders },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf-8');
          let json;
          try { json = JSON.parse(text); } catch { json = text; }
          resolve({ status: res.statusCode, body: json });
        });
      },
    );
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

let serverProcess = null;

async function startServer() {
  serverProcess = spawn(
    'node',
    ['--import', 'tsx/esm', 'src/server.ts'],
    {
      cwd: join(REPO_ROOT, 'apps/context-panel'),
      env: {
        ...process.env,
        NODE_ENV: 'development',
        HRP_MOCK_MODE: 'deterministic',
        HRP_LISTEN_PORT: String(PORT),
        HRP_LISTEN_HOST: '127.0.0.1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  let started = false;
  for (let i = 0; i < 50 && !started; i++) {
    try {
      const r = await httpJson({ host: '127.0.0.1', port: PORT, path: '/health/live' });
      if (r.status === 200) started = true;
    } catch (_) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  if (!started) {
    throw new Error(`Server did not start on port ${PORT}`);
  }
}

async function stopServer() {
  if (serverProcess && !serverProcess.killed) {
    serverProcess.kill('SIGTERM');
  }
}

await ensureDir(EVIDENCE_DIR);

let allPassed = true;

try {
  console.log('— Starting context-panel server...');
  await startServer();

  console.log('— Launching Chromium...');
  const browser = await chromium.launch({ headless: true });

  // Manager context
  const mgrContext = await browser.newContext({
    viewport: { width: 1024, height: 768 },
    extraHTTPHeaders: { 'x-hrp-staff-id': 'staff-supervisor-001' },
  });
  const page = await mgrContext.newPage();

  // ── T1: Alt+6 keyboard nav reaches Assistant tab ──────────────────────
  await page.goto(`${BASE_URL}/`);
  await page.waitForSelector('[data-testid="app-shell"]');
  await page.keyboard.press('Alt+6');
  await page.waitForSelector('[data-assistant-panel]', { timeout: 5000 });
  await page.screenshot({ path: join(EVIDENCE_DIR, 'assistant-01-loaded.png'), fullPage: true });
  await recordResult(
    'Alt+6 keyboard nav reaches Assistant tab',
    await page.locator('[data-assistant-panel]').isVisible(),
    { note: 'panel rendered' },
  );

  // ── T2: Today view shows items + KPI summary ────────────────────────
  await page.click('button[role="tab"]:has-text("Hôm nay")');
  await page.waitForTimeout(500);
  const todayItemCount = await page.locator('[data-today-item]').count();
  await page.screenshot({ path: join(EVIDENCE_DIR, 'assistant-02-today.png'), fullPage: true });
  await recordResult(
    'Today view renders deterministic items',
    todayItemCount >= 3,
    { note: `${todayItemCount} items` },
  );

  // ── T3: Week view shows week plan items ─────────────────────────────
  await page.click('button[role="tab"]:has-text("Tuần này")');
  await page.waitForTimeout(500);
  const weekItemCount = await page.locator('[data-week-item]').count();
  await page.screenshot({ path: join(EVIDENCE_DIR, 'assistant-03-week.png'), fullPage: true });
  await recordResult(
    'Week view renders plan items',
    weekItemCount >= 5,
    { note: `${weekItemCount} items` },
  );

  // ── T4: Autofill tab shows clear/conflict/stale proposals ────────────
  await page.click('button[role="tab"]:has-text("Autofill")');
  await page.waitForTimeout(800);
  const proposalCount = await page.locator('[data-autofill-proposal]').count();
  await page.screenshot({ path: join(EVIDENCE_DIR, 'assistant-04-autofill.png'), fullPage: true });
  await recordResult(
    'Autofill shows clear/conflict/stale proposals',
    proposalCount === 3,
    { note: `${proposalCount} proposals` },
  );

  // ── T5: Manager can accept fields (mutation allowed) ─────────────────
  // NEW FLOW: manager accept creates DRAFT; mutation requires confirm.
  const clearProposal = page.locator('[data-autofill-proposal]').first();
  const firstField = clearProposal.locator('[data-autofill-field] input[type="checkbox"]').first();
  await firstField.check();
  const acceptBtn = clearProposal.locator('button:has-text("Accept")');
  await acceptBtn.click();
  await page.waitForTimeout(500);
  // After manager accept, draft panel should be visible.
  const draftPanel = await page.locator('[data-autofill-pending-draft]').isVisible();
  await page.screenshot({ path: join(EVIDENCE_DIR, 'assistant-05-manager-accept.png'), fullPage: true });
  // Now confirm the draft.
  await page.click('[data-autofill-confirm-button]');
  await page.waitForTimeout(500);
  const statusText = await clearProposal.locator('header').innerText();
  await recordResult(
    'Manager can accept autofill (draft + confirm; mutation applied)',
    draftPanel && statusText.includes('ACCEPTED'),
    { note: `draftPanel=${draftPanel}; status=${statusText.slice(0, 60)}` },
  );

  // ── T6: Planning tab shows partial results on commit ─────────────────
  await page.click('button[role="tab"]:has-text("Planning")');
  await page.waitForTimeout(500);
  await page.click('button:has-text("Commit batch")');
  await page.waitForTimeout(500);
  const batchResult = await page.locator('[data-batch-result]').isVisible();
  await page.screenshot({ path: join(EVIDENCE_DIR, 'assistant-06-planning.png'), fullPage: true });
  await recordResult(
    'Planning tab commit shows batch result',
    batchResult,
    { note: 'batch result visible' },
  );

  // ── T7: Reschedule stale version surfaces conflict ───────────────────
  await page.click('button:has-text("stale version")');
  await page.waitForTimeout(500);
  const reschedulePre = await page.locator('pre').innerText();
  await page.screenshot({ path: join(EVIDENCE_DIR, 'assistant-07-reschedule-stale.png'), fullPage: true });
  await recordResult(
    'Reschedule stale version surfaces VERSION_CONFLICT',
    reschedulePre.includes('VERSION_CONFLICT'),
    { note: reschedulePre.slice(0, 60) },
  );

  // ── T8: Provider tab shows configs WITHOUT raw API keys ─────────────
  await page.click('button[role="tab"]:has-text("Provider")');
  await page.waitForTimeout(500);
  const providerCount = await page.locator('[data-provider-config]').count();
  const providerText = await page.locator('[data-assistant-panel]').innerText();
  await page.screenshot({ path: join(EVIDENCE_DIR, 'assistant-08-provider.png'), fullPage: true });
  await recordResult(
    'Provider tab renders ≥2 configs without raw API key',
    providerCount >= 2 &&
      !providerText.toLowerCase().includes('apikey=') &&
      !providerText.toLowerCase().includes('api_key='),
    { note: `${providerCount} providers` },
  );

  // ── T9: Reminder tab runs simulator ─────────────────────────────────
  await page.click('button[role="tab"]:has-text("Reminder")');
  await page.waitForTimeout(500);
  await page.click('button:has-text("Chạy mô phỏng")');
  await page.waitForTimeout(500);
  const reminderText = await page.locator('[data-assistant-panel]').innerText();
  await page.screenshot({ path: join(EVIDENCE_DIR, 'assistant-09-reminder.png'), fullPage: true });
  await recordResult(
    'Reminder tab runs simulator with deterministic counts',
    reminderText.includes('Sẽ kích hoạt') &&
      reminderText.includes('Bị chặn') &&
      reminderText.includes('KHÔNG claim scheduler production'),
    { note: 'simulator ran' },
  );

  // ── T10: Narrow panel (<480px) keeps Assistant usable ───────────────
  await page.setViewportSize({ width: 360, height: 720 });
  await page.waitForTimeout(500);
  await page.click('button[role="tab"]:has-text("Hôm nay")');
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(EVIDENCE_DIR, 'assistant-10-narrow.png'), fullPage: true });
  await recordResult(
    'Narrow panel (<480px) keeps Assistant usable',
    await page.locator('[data-assistant-panel]').isVisible(),
    { note: 'narrow OK' },
  );

  await mgrContext.close();

  // ── T11: Sale sees "no permission" hint on Autofill/Provider ───────
  const saleContext = await browser.newContext({
    viewport: { width: 1024, height: 768 },
    extraHTTPHeaders: { 'x-hrp-staff-id': 'staff-talent-001' },
  });
  const salePage = await saleContext.newPage();
  await salePage.goto(`${BASE_URL}/`);
  await salePage.waitForSelector('[data-testid="app-shell"]');
  await salePage.keyboard.press('Alt+6');
  await salePage.waitForSelector('[data-assistant-panel]', { timeout: 5000 });
  await salePage.click('button[role="tab"]:has-text("Autofill")');
  await salePage.waitForTimeout(800);
  const saleAutofillText = await salePage.locator('[data-assistant-panel]').innerText();
  await salePage.screenshot({ path: join(EVIDENCE_DIR, 'assistant-11-sale-autofill.png'), fullPage: true });
  await recordResult(
    'Sale sees "no permission" hint on Autofill',
    saleAutofillText.includes('Bạn không phải manager') ||
      saleAutofillText.includes('Sale/AI'),
    { note: 'sale hint shown' },
  );

  await salePage.click('button[role="tab"]:has-text("Provider")');
  await salePage.waitForTimeout(500);
  const saleProviderText = await salePage.locator('[data-assistant-panel]').innerText();
  await salePage.screenshot({ path: join(EVIDENCE_DIR, 'assistant-12-sale-provider.png'), fullPage: true });
  await recordResult(
    'Sale sees "no permission" hint on Provider',
    saleProviderText.includes('Sale/AI không được sửa provider config'),
    { note: 'sale provider hint' },
  );

  await saleContext.close();
  await browser.close();

  // Summary
  SUMMARY.endedAt = new Date().toISOString();
  const passed = SUMMARY.tests.filter((t) => t.ok).length;
  const failed = SUMMARY.tests.filter((t) => !t.ok).length;
  SUMMARY.summary = { passed, failed, total: SUMMARY.tests.length };
  await writeFile(
    join(EVIDENCE_DIR, 'assistant-summary.json'),
    JSON.stringify(SUMMARY, null, 2),
    'utf-8',
  );

  if (failed > 0) {
    console.error(`\n— Assistant browser summary: ${passed}/${SUMMARY.tests.length} passed. ${failed} FAILED.`);
    process.exit(1);
  } else {
    console.log(`\n— Assistant browser summary: ${passed}/${SUMMARY.tests.length} passed.`);
  }
} catch (err) {
  console.error('Browser evidence failed:', err);
  await writeFile(
    join(EVIDENCE_DIR, 'assistant-summary.json'),
    JSON.stringify({ ...SUMMARY, error: String(err), stack: err.stack }, null, 2),
    'utf-8',
  );
  process.exit(1);
} finally {
  await stopServer();
}
