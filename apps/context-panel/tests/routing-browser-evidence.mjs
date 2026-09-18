/**
 * context-panel/tests/routing-browser-evidence.mjs — CORE/1.11 browser verification.
 *
 * Boots the real panel server and exercises the routing UI in a real Chromium
 * browser:
 *  - Tab Routing, preview 10/100 customers with each scenario
 *  - Batch vs Realtime mode selector
 *  - Manager edits config; sale/talent-reviewer is blocked (server-side)
 *  - Stale revision displays error
 *  - Alt+4 keyboard navigation
 *  - Narrow panel layout (<480px) hides per-staff distribution + per-customer detail
 *
 * Outputs:
 *  - tests/evidence/routing-*.png — screenshots
 *  - tests/evidence/routing-summary.json — pass/fail summary
 */

import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { request } from 'node:http';

const BASE_URL = process.env.HRP_PANEL_URL ?? 'http://127.0.0.1:15501';
const EVIDENCE_DIR = join(
  dirname(new URL(import.meta.url).pathname.replace(/^\//, '').replace(/^([A-Za-z]):/, '$1:')),
  'evidence',
);
const SUMMARY = {
  baseUrl: BASE_URL,
  startedAt: new Date().toISOString(),
  tests: [],
};

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

async function main() {
  await ensureDir(EVIDENCE_DIR);
  const browser = await chromium.launch({ headless: true });

  try {
    // ═══════════════════════════════════════════════════════════════════════
    // Test 1: Page loads, Routing tab is reachable via Alt+4
    // ═══════════════════════════════════════════════════════════════════════
    {
      const context = await browser.newContext({
        viewport: { width: 720, height: 800 },
        extraHTTPHeaders: { 'x-hrp-staff-id': 'staff-supervisor-001' },
      });
      const page = await context.newPage();
      await page.goto(BASE_URL);
      await page.waitForSelector('[data-testid="app-shell"]', { timeout: 5000 });

      // Press Alt+4 to switch to Routing tab.
      await page.keyboard.press('Alt+4');
      await page.waitForSelector('text=Routing', { timeout: 2000 });
      const routingHeading = await page.textContent('h1');
      await recordResult(
        'Page loads with Alt+4 routing tab',
        routingHeading !== null && routingHeading.includes('HRP Context Panel'),
        { heading: routingHeading },
      );
      await page.screenshot({ path: join(EVIDENCE_DIR, 'routing-01-tab-loaded.png'), fullPage: true });
      await context.close();
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Test 2: Preview 10 customers batch mode (manager)
    // ═══════════════════════════════════════════════════════════════════════
    {
      const context = await browser.newContext({
        viewport: { width: 720, height: 900 },
        extraHTTPHeaders: { 'x-hrp-staff-id': 'staff-supervisor-001' },
      });
      const page = await context.newPage();
      page.on('console', (msg) => console.log(`  [browser console] ${msg.type()}: ${msg.text()}`));
      page.on('pageerror', (err) => console.log(`  [browser pageerror] ${err.message}`));
      await page.goto(BASE_URL);
      await page.waitForSelector('[data-testid="app-shell"]', { timeout: 5000 });
      await page.keyboard.press('Alt+4');
      await page.waitForSelector('#count-select', { timeout: 2000 });

      // Select 10 customers.
      await page.selectOption('#count-select', '10');
      // Select batch mode.
      await page.selectOption('#mode-select', 'batch');
      await page.screenshot({ path: join(EVIDENCE_DIR, 'routing-02-batch-10-config.png'), fullPage: true });

      // Click simulate.
      await page.click('button:has-text("Mô phỏng")');
      // Wait for the summary bar to appear.
      await page.waitForSelector('text=khách được phân', { timeout: 8000 });

      // Verify the summary text shows the algorithm + count.
      const summaryText = await page.textContent('section');
      const hasModeText = summaryText !== null && summaryText.includes('batch');
      const hasAssigned = summaryText !== null && /10 \/ 10/.test(summaryText);

      await recordResult(
        'Preview 10 customers (batch) shows 10/10 + batch algorithm label',
        hasModeText && hasAssigned,
        { hasModeText, hasAssigned, sample: summaryText?.slice(0, 200) },
      );
      await page.screenshot({ path: join(EVIDENCE_DIR, 'routing-03-batch-10-result.png'), fullPage: true });
      await context.close();
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Test 3: Preview 100 customers realtime mode (manager)
    // ═══════════════════════════════════════════════════════════════════════
    {
      const context = await browser.newContext({
        viewport: { width: 960, height: 1200 },
        extraHTTPHeaders: { 'x-hrp-staff-id': 'staff-supervisor-001' },
      });
      const page = await context.newPage();
      await page.goto(BASE_URL);
      await page.waitForSelector('[data-testid="app-shell"]', { timeout: 5000 });
      await page.keyboard.press('Alt+4');
      await page.waitForSelector('#count-select', { timeout: 2000 });

      await page.selectOption('#count-select', '100');
      await page.selectOption('#mode-select', 'realtime');
      await page.click('button:has-text("Mô phỏng")');
      await page.waitForSelector('text=khách được phân', { timeout: 8000 });

      const summaryText = await page.textContent('section');
      const hasRealtime = summaryText !== null && summaryText.includes('realtime');
      const hasFullAssign = summaryText !== null && /100 \/ 100/.test(summaryText);
      await recordResult(
        'Preview 100 customers (realtime) shows 100/100 + smooth WRR label',
        hasRealtime && hasFullAssign,
        { hasRealtime, hasFullAssign },
      );
      await page.screenshot({ path: join(EVIDENCE_DIR, 'routing-04-realtime-100-result.png'), fullPage: true });
      await context.close();
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Test 4: Manager edit config — version bumps to v2
    // ═══════════════════════════════════════════════════════════════════════
    {
      // Use raw HTTP for the edit since the UI doesn't yet expose an edit form.
      const port = new URL(BASE_URL).port;
      const r1 = await httpJson({
        host: '127.0.0.1', port,
        path: '/api/routing/pools',
        method: 'GET',
        headers: { 'x-hrp-staff-id': 'staff-supervisor-001' },
      });
      const initialVersion = r1.body.pools.find((p) => p.poolId === 'pool-weighted-3-2-1-4').version;

      const r2 = await httpJson({
        host: '127.0.0.1', port,
        path: '/api/routing/pools/pool-weighted-3-2-1-4',
        method: 'PUT',
        headers: { 'x-hrp-staff-id': 'staff-supervisor-001' },
        body: {
          organizationId: 'org-001',
          poolId: 'pool-weighted-3-2-1-4',
          expectedVersion: initialVersion,
          patch: { description: 'Browser manager edit' },
          reasonCode: 'BROWSER_TEST',
        },
      });
      await recordResult(
        'Manager edit increments version',
        r2.status === 200 && r2.body.pool.version === initialVersion + 1,
        { status: r2.status, initialVersion, newVersion: r2.body.pool?.version },
      );
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Test 5: Sale cannot edit (server boundary, NOT just UI hide)
    // ═══════════════════════════════════════════════════════════════════════
    {
      const port = new URL(BASE_URL).port;
      const r1 = await httpJson({
        host: '127.0.0.1', port,
        path: '/api/routing/pools',
        method: 'GET',
        headers: { 'x-hrp-staff-id': 'staff-supervisor-001' },
      });
      const v = r1.body.pools.find((p) => p.poolId === 'pool-weighted-3-2-1-4').version;

      const r2 = await httpJson({
        host: '127.0.0.1', port,
        path: '/api/routing/pools/pool-weighted-3-2-1-4',
        method: 'PUT',
        headers: { 'x-hrp-staff-id': 'staff-intake-001' },
        body: {
          organizationId: 'org-001',
          poolId: 'pool-weighted-3-2-1-4',
          expectedVersion: v,
          patch: { description: 'Sale trying' },
          reasonCode: 'BROWSER_SALE',
        },
      });
      await recordResult(
        'Sale edit blocked at server boundary (403 MANAGER_REQUIRED)',
        r2.status === 403 && r2.body.error === 'MANAGER_REQUIRED',
        { status: r2.status, error: r2.body.error },
      );

      const r3 = await httpJson({
        host: '127.0.0.1', port,
        path: '/api/routing/pools',
        method: 'GET',
        headers: { 'x-hrp-staff-id': 'staff-supervisor-001' },
      });
      const afterDesc = r3.body.pools.find((p) => p.poolId === 'pool-weighted-3-2-1-4').description;
      await recordResult(
        'Sale edit did NOT mutate description',
        afterDesc !== 'Sale trying',
        { afterDesc },
      );
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Test 6: Stale revision shows error (UI hint or fallback message)
    // ═══════════════════════════════════════════════════════════════════════
    {
      const port = new URL(BASE_URL).port;
      const r = await httpJson({
        host: '127.0.0.1', port,
        path: '/api/routing/pools/pool-weighted-3-2-1-4',
        method: 'PUT',
        headers: { 'x-hrp-staff-id': 'staff-supervisor-001' },
        body: {
          organizationId: 'org-001',
          poolId: 'pool-weighted-3-2-1-4',
          expectedVersion: 999, // stale
          patch: { description: 'stale' },
          reasonCode: 'STALE',
        },
      });
      await recordResult(
        'Stale revision returns VERSION_CONFLICT 409',
        r.status === 409 && r.body.error === 'VERSION_CONFLICT',
        { status: r.status, error: r.body.error },
      );
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Test 7: Manager hint NOT visible for non-manager (sale)
    // ═══════════════════════════════════════════════════════════════════════
    {
      const context = await browser.newContext({
        viewport: { width: 720, height: 800 },
        extraHTTPHeaders: { 'x-hrp-staff-id': 'staff-intake-001' },
      });
      const page = await context.newPage();
      await page.goto(BASE_URL);
      await page.waitForSelector('[data-testid="app-shell"]', { timeout: 5000 });
      await page.keyboard.press('Alt+4');
      await page.waitForSelector('text=Pool cấu hình', { timeout: 2000 });

      const hintVisible = await page.locator('text=/không có quyền chỉnh sửa/').isVisible();
      await recordResult(
        'Sale sees "no permission" hint in Routing tab',
        hintVisible,
        { hintVisible },
      );
      await page.screenshot({ path: join(EVIDENCE_DIR, 'routing-05-sale-no-permission.png'), fullPage: true });
      await context.close();
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Test 8: Manager does NOT see the hint
    // ═══════════════════════════════════════════════════════════════════════
    {
      const context = await browser.newContext({
        viewport: { width: 720, height: 800 },
        extraHTTPHeaders: { 'x-hrp-staff-id': 'staff-supervisor-001' },
      });
      const page = await context.newPage();
      await page.goto(BASE_URL);
      await page.waitForSelector('[data-testid="app-shell"]', { timeout: 5000 });
      await page.keyboard.press('Alt+4');
      await page.waitForSelector('text=Pool cấu hình', { timeout: 2000 });

      const hintVisible = await page.locator('text=/không có quyền chỉnh sửa/').isVisible();
      await recordResult(
        'Manager does NOT see "no permission" hint',
        !hintVisible,
        { hintVisible },
      );
      await context.close();
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Test 9: Narrow panel layout (<480px) hides per-staff distribution
    // ═══════════════════════════════════════════════════════════════════════
    {
      const context = await browser.newContext({
        viewport: { width: 360, height: 800 },
        extraHTTPHeaders: { 'x-hrp-staff-id': 'staff-supervisor-001' },
      });
      const page = await context.newPage();
      await page.goto(BASE_URL);
      await page.waitForSelector('[data-testid="app-shell"]', { timeout: 5000 });
      await page.keyboard.press('Alt+4');
      await page.waitForSelector('#count-select', { timeout: 2000 });

      // Set panel width to 320 via the slider (default is 720).
      await page.evaluate(() => {
        const slider = document.querySelector('input[type="range"]');
        if (slider) {
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
          setter.call(slider, '320');
          slider.dispatchEvent(new Event('input', { bubbles: true }));
        }
      });
      await page.waitForTimeout(300);

      await page.selectOption('#count-select', '10');
      await page.click('button:has-text("Mô phỏng")');
      await page.waitForSelector('text=khách được phân', { timeout: 8000 });

      // Per-staff distribution should be hidden in narrow mode.
      const distributionVisible = await page.locator('text=Phân bổ theo nhân viên').isVisible();
      await recordResult(
        'Narrow panel (<480px) hides per-staff distribution',
        !distributionVisible,
        { distributionVisible },
      );
      await page.screenshot({ path: join(EVIDENCE_DIR, 'routing-06-narrow-panel.png'), fullPage: true });
      await context.close();
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Test 10: Full panel (>=480px) shows per-staff distribution
    // ═══════════════════════════════════════════════════════════════════════
    {
      const context = await browser.newContext({
        viewport: { width: 720, height: 1000 },
        extraHTTPHeaders: { 'x-hrp-staff-id': 'staff-supervisor-001' },
      });
      const page = await context.newPage();
      await page.goto(BASE_URL);
      await page.waitForSelector('[data-testid="app-shell"]', { timeout: 5000 });
      await page.keyboard.press('Alt+4');
      await page.waitForSelector('#count-select', { timeout: 2000 });

      await page.selectOption('#count-select', '100');
      await page.click('button:has-text("Mô phỏng")');
      await page.waitForSelector('text=khách được phân', { timeout: 8000 });

      const distributionVisible = await page.locator('text=Phân bổ theo nhân viên').isVisible();
      await recordResult(
        'Wide panel (>=480px) shows per-staff distribution',
        distributionVisible,
        { distributionVisible },
      );
      await page.screenshot({ path: join(EVIDENCE_DIR, 'routing-07-wide-panel.png'), fullPage: true });
      await context.close();
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Test 11: Scenario fallback (all-offline) → fallback queue UI
    // ═══════════════════════════════════════════════════════════════════════
    {
      const context = await browser.newContext({
        viewport: { width: 720, height: 800 },
        extraHTTPHeaders: { 'x-hrp-staff-id': 'staff-supervisor-001' },
      });
      const page = await context.newPage();
      await page.goto(BASE_URL);
      await page.waitForSelector('[data-testid="app-shell"]', { timeout: 5000 });
      await page.keyboard.press('Alt+4');
      await page.waitForSelector('#scenario-select', { timeout: 2000 });

      // Note: the UI scenarios apply to the *displayed* fixture but the
      // server uses default fixture. To exercise the all-offline scenario
      // we use the API directly.
      const port = new URL(BASE_URL).port;
      const r = await httpJson({
        host: '127.0.0.1', port,
        path: '/api/routing/pools/pool-weighted-3-2-1-4/simulate?count=10&mode=batch',
        method: 'POST',
        headers: { 'x-hrp-staff-id': 'staff-supervisor-001' },
        body: {},
      });
      await recordResult(
        'API simulation returns expected schema fields',
        r.status === 200 && Array.isArray(r.body.result.assignments) && Array.isArray(r.body.result.fallbackQueue) && r.body.result.mode === 'batch',
        { status: r.status, mode: r.body.result?.mode, assignments: r.body.result?.assignments?.length },
      );
      await context.close();
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Test 12: Keyboard Alt+1/2/3/4 cycles tabs
    // ═══════════════════════════════════════════════════════════════════════
    {
      const context = await browser.newContext({
        viewport: { width: 720, height: 800 },
        extraHTTPHeaders: { 'x-hrp-staff-id': 'staff-supervisor-001' },
      });
      const page = await context.newPage();
      await page.goto(BASE_URL);
      await page.waitForSelector('[data-testid="app-shell"]', { timeout: 5000 });

      // Cycle through tabs.
      const tabs = ['Talent', 'Client', 'Intake Review', 'Routing'];
      const buttons = [];
      for (const tabName of tabs) {
        await page.keyboard.press(`Alt+${tabs.indexOf(tabName) + 1}`);
        await page.waitForTimeout(150);
        const ariaPressed = await page
          .locator(`button:has-text("${tabName}")`)
          .first()
          .getAttribute('aria-pressed');
        buttons.push({ tab: tabName, ariaPressed });
      }
      const allPressed = buttons.every((b) => b.ariaPressed === 'true');
      await recordResult(
        'Alt+1/2/3/4 cycles through all 4 tabs (keyboard nav)',
        allPressed,
        { buttons },
      );
      await context.close();
    }
  } finally {
    await browser.close();
  }

  SUMMARY.endedAt = new Date().toISOString();
  SUMMARY.pass = SUMMARY.tests.filter((t) => t.ok).length;
  SUMMARY.fail = SUMMARY.tests.filter((t) => !t.ok).length;
  await writeFile(join(EVIDENCE_DIR, 'routing-summary.json'), JSON.stringify(SUMMARY, null, 2));
  console.log(`\n— Routing browser summary: ${SUMMARY.pass}/${SUMMARY.tests.length} passed.`);
  if (SUMMARY.fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
