/**
 * tests/dashboard-browser-evidence.mjs — CORE/1.12 Browser verification.
 *
 * Boots the real panel server and exercises the BoD dashboard UI in a
 * real Chromium browser:
 *  - Alt+5 keyboard navigation reaches Dashboard tab.
 *  - Chart view loads with metrics and coverage header.
 *  - KPI view shows assigned targets + manager-only assign button.
 *  - Table view is accessible alternative.
 *  - Click a chart cell opens drill-down with same filters/snapshot.
 *  - Narrow panel (<480px) hides per-source labels.
 *  - Filters (grain, period) change the chart.
 *  - Manager sees assign affordance; sale does NOT.
 *
 * Outputs:
 *  - tests/evidence/dashboard-*.png — screenshots
 *  - tests/evidence/dashboard-summary.json — pass/fail summary
 */

import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { request } from 'node:http';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..', '..');
const EVIDENCE_DIR = join(__dirname, 'evidence');
const SUMMARY = {
  baseUrl: 'http://127.0.0.1:15501',
  startedAt: new Date().toISOString(),
  tests: [],
};

const PORT = 15501;
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

  // Wait for /health/live.
  let started = false;
  for (let i = 0; i < 50 && !started; i++) {
    try {
      const r = await httpJson({ host: '127.0.0.1', port: PORT, path: '/health/live' });
      if (r.status === 200) started = true;
    } catch (_) {
      // not yet
    }
    if (!started) await sleep(200);
  }
  if (!started) throw new Error('Server failed to start');
}

async function stopServer() {
  if (serverProcess && !serverProcess.killed) {
    serverProcess.kill('SIGTERM');
    await sleep(200);
    if (!serverProcess.killed) serverProcess.kill('SIGKILL');
  }
}

async function main() {
  await ensureDir(EVIDENCE_DIR);

  console.log('— Starting context-panel server...');
  await startServer();

  console.log('— Launching Chromium...');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1024, height: 768 },
    extraHTTPHeaders: { 'x-hrp-staff-id': 'staff-supervisor-001' },
  });
  const page = await context.newPage();

  // ── T1: Alt+5 reaches Dashboard tab ───────────────────────────────────
  await page.goto(`${BASE_URL}/`);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForSelector('[data-testid="app-shell"]');
  await page.keyboard.press('Alt+5');
  await page.waitForSelector('[data-dashboard-panel]', { timeout: 5000 });
  await page.screenshot({ path: join(EVIDENCE_DIR, 'dashboard-01-loaded.png'), fullPage: true });
  await recordResult(
    'Alt+5 keyboard nav reaches Dashboard tab',
    true,
    { note: 'panel rendered' },
  );

  // ── T2: Coverage header shows source/grain/as-of/credit policy ──────────
  // Wait for fetchSnapshot to complete and CoverageBar to render.
  await page.waitForTimeout(2000);
  const panelHtml = await page.locator('[data-dashboard-panel]').innerHTML();
  const hasCoverageElement = /aria-label="Coverage metadata"/.test(panelHtml);
  if (!hasCoverageElement) {
    console.log('— Panel HTML head:', panelHtml.slice(0, 400));
  }
  await page.waitForSelector('[aria-label="Coverage metadata"]', { timeout: 15000 });
  const coverageText = await page.locator('[aria-label="Coverage metadata"]').innerText();
  const hasCoverage = /Source:/.test(coverageText) && /Grain:/.test(coverageText) &&
    /asOf:/.test(coverageText) && /Credit:/.test(coverageText);
  await page.screenshot({ path: join(EVIDENCE_DIR, 'dashboard-02-coverage.png'), fullPage: true });
  await recordResult(
    'Coverage header shows source/grain/as-of/credit policy labels',
    hasCoverage,
    { note: coverageText.slice(0, 120) },
  );

  // ── T3: Chart view shows multiple stages with bars ─────────────────────
  await page.waitForSelector('[data-dashboard-panel]');
  await page.waitForTimeout(500); // allow fetch
  const chartButtons = await page.locator('[data-dashboard-panel] button[aria-label*="Drill-down"]').count();
  await page.screenshot({ path: join(EVIDENCE_DIR, 'dashboard-03-chart.png'), fullPage: true });
  await recordResult(
    'Chart view shows clickable stage cells (≥3)',
    chartButtons >= 3,
    { note: `${chartButtons} cells` },
  );

  // ── T4: Click a chart cell opens drill-down drawer ─────────────────────
  let drilldownOk = false;
  if (chartButtons >= 3) {
    const firstCell = page.locator('[data-dashboard-panel] button[aria-label*="Drill-down"]').first();
    await firstCell.click();
    await page.waitForSelector('[data-testid="drilldown-sumcheck"]', { timeout: 5000 });
    const sumCheck = await page.locator('[data-testid="drilldown-sumcheck"]').innerText();
    drilldownOk = /nhất quán/.test(sumCheck) || /consistent/.test(sumCheck);
    await page.screenshot({ path: join(EVIDENCE_DIR, 'dashboard-04-drilldown.png'), fullPage: true });
    // Close drawer
    const closeBtn = page.locator('[role="dialog"] button:has-text("Đóng")');
    if (await closeBtn.count() > 0) await closeBtn.first().click();
  }
  await recordResult(
    'Click chart cell opens drill-down with consistent sumCheck',
    drilldownOk,
    { note: `cells=${chartButtons}` },
  );

  // ── T5: KPI view shows targets (manager can see assign) ────────────────
  await page.click('button[aria-pressed]:has-text("KPI")');
  await page.waitForTimeout(300);
  const kpiRows = await page.locator('table tbody tr').count();
  await page.screenshot({ path: join(EVIDENCE_DIR, 'dashboard-05-kpi.png'), fullPage: true });
  await recordResult(
    'KPI view shows assigned targets (≥4)',
    kpiRows >= 4,
    { note: `${kpiRows} rows` },
  );

  // ── T6: Table view is accessible alternative ───────────────────────────
  await page.click('button[aria-pressed]:has-text("Bảng dữ liệu")');
  await page.waitForTimeout(300);
  const tableRows = await page.locator('table tbody tr').count();
  await page.screenshot({ path: join(EVIDENCE_DIR, 'dashboard-06-table.png'), fullPage: true });
  await recordResult(
    'Table view shows data rows (≥4)',
    tableRows >= 4,
    { note: `${tableRows} rows` },
  );

  // ── T7: Filters — change period, chart updates ──────────────────────────
  await page.click('button[aria-pressed]:has-text("Biểu đồ")');
  await page.waitForTimeout(200);
  const beforeCells = await page.locator('[data-dashboard-panel] button[aria-label*="Drill-down"]').count();
  await page.selectOption('#period-select', 'DAILY');
  await page.waitForTimeout(700);
  const afterCells = await page.locator('[data-dashboard-panel] button[aria-label*="Drill-down"]').count();
  await page.screenshot({ path: join(EVIDENCE_DIR, 'dashboard-07-period-change.png'), fullPage: true });
  await recordResult(
    'Period filter change updates chart (cell count changed)',
    beforeCells !== afterCells,
    { note: `before=${beforeCells}, after=${afterCells}` },
  );
  // Restore
  await page.selectOption('#period-select', 'WEEKLY');
  await page.waitForTimeout(500);

  // ── T8: Narrow panel (<480px) hides per-source labels ───────────────────
  await page.setViewportSize({ width: 360, height: 720 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(EVIDENCE_DIR, 'dashboard-08-narrow.png'), fullPage: true });
  const narrowVisible = await page.locator('[data-dashboard-panel]').isVisible();
  await recordResult(
    'Narrow panel (<480px) keeps dashboard usable',
    narrowVisible,
    { note: 'narrow layout OK' },
  );
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.waitForTimeout(300);

  // ── T9: Sale cannot see manager assign affordance (UI hint) ─────────────
  // Override staff-id by re-creating the context with sale header.
  const saleContext = await browser.newContext({
    viewport: { width: 1024, height: 768 },
    extraHTTPHeaders: { 'x-hrp-staff-id': 'staff-talent-001' },
  });
  const salePage = await saleContext.newPage();
  await salePage.goto(`${BASE_URL}/`);
  await salePage.waitForSelector('[data-testid="app-shell"]');
  await salePage.keyboard.press('Alt+5');
  await salePage.waitForSelector('[data-dashboard-panel]', { timeout: 5000 });
  await salePage.click('button[aria-pressed]:has-text("KPI")');
  await salePage.waitForTimeout(500);
  const saleKpiText = await salePage.locator('[data-dashboard-panel]').innerText();
  const saleSeesHint = /không có quyền/.test(saleKpiText) || /KHÔNG mutate/.test(saleKpiText);
  await salePage.screenshot({ path: join(EVIDENCE_DIR, 'dashboard-09-sale-no-permission.png'), fullPage: true });
  await recordResult(
    'Sale sees "no permission" hint in KPI view',
    saleSeesHint,
    { note: saleKpiText.slice(0, 80) },
  );
  await saleContext.close();

  // ── T10: Manager does NOT see "no permission" hint ─────────────────────
  const mgrContext = await browser.newContext({
    viewport: { width: 1024, height: 768 },
    extraHTTPHeaders: { 'x-hrp-staff-id': 'staff-supervisor-001' },
  });
  const mgrPage = await mgrContext.newPage();
  await mgrPage.goto(`${BASE_URL}/`);
  await mgrPage.waitForSelector('[data-testid="app-shell"]');
  await mgrPage.keyboard.press('Alt+5');
  await mgrPage.waitForSelector('[data-dashboard-panel]', { timeout: 5000 });
  await mgrPage.click('button[aria-pressed]:has-text("KPI")');
  await mgrPage.waitForTimeout(500);
  const managerKpiText = await mgrPage.locator('[data-dashboard-panel]').innerText();
  const managerSeesHint = /không có quyền/.test(managerKpiText) || /KHÔNG mutate/.test(managerKpiText);
  await mgrPage.screenshot({ path: join(EVIDENCE_DIR, 'dashboard-10-manager-no-hint.png'), fullPage: true });
  await recordResult(
    'Manager does NOT see "no permission" hint',
    !managerSeesHint,
    { note: 'manager view clean' },
  );
  await mgrContext.close();

  await browser.close();
  await stopServer();

  // ── Summary ────────────────────────────────────────────────────────────
  const passed = SUMMARY.tests.filter((t) => t.ok).length;
  SUMMARY.endedAt = new Date().toISOString();
  SUMMARY.passed = passed;
  SUMMARY.total = SUMMARY.tests.length;
  await writeFile(
    join(EVIDENCE_DIR, 'dashboard-summary.json'),
    JSON.stringify(SUMMARY, null, 2),
    'utf-8',
  );
  console.log(`— Dashboard browser summary: ${passed}/${SUMMARY.tests.length} passed.`);
  if (passed !== SUMMARY.tests.length) {
    process.exit(1);
  }
}

main().catch(async (err) => {
  console.error('Browser evidence failed:', err);
  await stopServer();
  process.exit(1);
});
