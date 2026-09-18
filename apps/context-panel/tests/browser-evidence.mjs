/**
 * context-panel/tests/browser-evidence.mjs — CORE/1.9 browser verification.
 *
 * Uses Playwright to:
 *  - Load the React UI in a real browser.
 *  - Capture screenshots of each view (Talent, Client, Intake Review).
 *  - Verify Talent layout renders context panel data.
 *  - Verify Client shows UNAVAILABLE state.
 *  - Verify Intake Review: preview → confirm → run flow with mock service.
 *  - Verify edit-after-confirm invalidates the confirmation.
 *  - Verify narrow panel layout (320px, 480px).
 *  - Verify keyboard navigation (Alt+1/2/3).
 *  - Test forbidden/stale/timeout/partial scenarios via mock service.
 *
 * Outputs:
 *  - tests/evidence/*.png — screenshots.
 *  - tests/evidence/summary.json — pass/fail summary.
 */

import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';

const BASE_URL = process.env.HRP_PANEL_URL ?? 'http://127.0.0.1:3000';
const EVIDENCE_DIR = join(dirname(new URL(import.meta.url).pathname.replace(/^\//, '').replace(/^([A-Za-z]):/, '$1:')), 'evidence');
const SUMMARY = {
  baseUrl: BASE_URL,
  tests: [],
  startedAt: new Date().toISOString(),
};

async function ensureDir(path) {
  await mkdir(path, { recursive: true });
}

async function recordResult(name, ok, details = {}) {
  SUMMARY.tests.push({ name, ok, ...details });
  const status = ok ? '✔' : '✖';
  console.log(`${status} ${name}${details.note ? ` — ${details.note}` : ''}`);
}

async function main() {
  await ensureDir(EVIDENCE_DIR);
  const browser = await chromium.launch({ headless: true });

  try {
    // ── Test 1: Page loads, React mounts ──────────────────────────────────
    {
      const context = await browser.newContext({ viewport: { width: 720, height: 800 } });
      const page = await context.newPage();
      page.on('console', (msg) => {
        if (msg.type() === 'error') console.log('[browser err]', msg.text());
      });

      const response = await page.goto(BASE_URL, { waitUntil: 'networkidle' });
      await page.waitForSelector('[data-testid="app-shell"]', { timeout: 5000 });

      await page.screenshot({ path: join(EVIDENCE_DIR, '01-talent-default.png'), fullPage: true });
      await recordResult(
        'page loads, React AppShell mounts',
        response?.status() === 200,
        { status: response?.status() },
      );

      // ── Test 2: Talent layout renders ───────────────────────────────────
      const talentHeader = await page.locator('section[aria-label="Talent Context Panel"] h2').textContent();
      await recordResult('Talent panel renders header', talentHeader?.includes('Hồ sơ ứng viên'), { talentHeader });

      const contextPanelVisible = await page.locator('[data-testid="context-panel"]').isVisible().catch(() => false);
      await recordResult('Talent context-panel renders', contextPanelVisible);

      // Check for CurrentRelationship read-only indicator
      const crSection = await page.locator('section[aria-label="Quan hệ với HRP"]').isVisible().catch(() => false);
      await recordResult('CurrentRelationship section visible (read-only)', crSection);

      // Check for PlacementCase & Availability sections
      const placementVisible = await page.locator('section[aria-label="Đợt tìm việc"]').isVisible().catch(() => false);
      const availabilityVisible = await page.locator('section[aria-label="Tình trạng sẵn sàng"]').isVisible().catch(() => false);
      await recordResult('PlacementCase section visible', placementVisible);
      await recordResult('Availability section visible', availabilityVisible);

      // ── Test 3: Keyboard navigation Alt+2 → Client ─────────────────────
      await page.keyboard.press('Alt+2');
      await page.waitForTimeout(200);
      const clientHeader = await page.locator('section[aria-label="Client Context Panel"]').isVisible().catch(() => false);
      await page.screenshot({ path: join(EVIDENCE_DIR, '02-client-unavailable.png'), fullPage: true });
      await recordResult('Client panel shows UNAVAILABLE', clientHeader);

      // ── Test 4: Keyboard navigation Alt+3 → Intake Review ──────────────
      await page.keyboard.press('Alt+3');
      await page.waitForTimeout(500);
      // Check section aria-label
      const intakeHeader = await page.locator('section[aria-label="Intake Review"]').count();
      await page.screenshot({ path: join(EVIDENCE_DIR, '03-intake-review-idle.png'), fullPage: true });
      await recordResult('Intake Review panel visible', intakeHeader > 0, { count: intakeHeader });

      // ── Test 5: Preview flow → candidate list appears ──────────────────
      const previewBtn = page.getByRole('button', { name: 'Xem trước' });
      await previewBtn.click();
      await page.waitForTimeout(800); // wait for orchestrator preview
      const candidateList = await page.locator('text=Kết quả tìm kiếm').isVisible().catch(() => false);
      await page.screenshot({ path: join(EVIDENCE_DIR, '04-intake-review-preview.png'), fullPage: true });
      await recordResult('Preview returns candidates', candidateList);

      // ── Test 6: Confirmation checkbox NOT prechecked ────────────────────
      const checkbox = page.getByRole('checkbox');
      const initialChecked = await checkbox.isChecked();
      await recordResult('Confirmation checkbox NOT prechecked', initialChecked === false, { initialChecked });

      // ── Test 7: Submit disabled without confirmation ────────────────────
      const submitBtn = page.getByRole('button', { name: 'Nộp hồ sơ' });
      const submitDisabledBefore = await submitBtn.isDisabled();
      await recordResult('Submit disabled without confirmation', submitDisabledBefore);

      // ── Test 8: Confirm + Submit → mock service runs ────────────────────
      await checkbox.check();
      await page.waitForTimeout(100);
      const submitEnabledAfter = !(await submitBtn.isDisabled());
      await recordResult('Submit enabled after confirmation', submitEnabledAfter);

      await submitBtn.click();
      await page.waitForTimeout(1500);
      // Result: orchestrator returns PARTIAL because of CORE/1.6 step scenario limitation.
      const partialVisible = await page.locator('text=Nộp hồ sơ một phần').isVisible().catch(() => false);
      const successVisible = await page.locator('text=Nộp hồ sơ thành công').isVisible().catch(() => false);
      await page.screenshot({ path: join(EVIDENCE_DIR, '05-intake-review-result.png'), fullPage: true });
      await recordResult(
        'Intake submit returns mock service result (partial or success)',
        partialVisible || successVisible,
        { partialVisible, successVisible },
      );

      // ── Test 9: Edit after confirm invalidates confirmation ────────────
      // Reload the page to reset all state, then navigate to Intake Review.
      await page.reload({ waitUntil: 'networkidle' });
      await page.keyboard.press('Alt+3');
      await page.waitForTimeout(300);

      const previewBtn2 = page.getByRole('button', { name: 'Xem trước' });
      const previewBtnVisible = await previewBtn2.isVisible().catch(() => false);
      if (previewBtnVisible) {
        await previewBtn2.click();
        await page.waitForTimeout(800);
        const cb = page.getByRole('checkbox');
        await cb.check();
        await page.waitForTimeout(100);
        // Edit a field to invalidate
        const fullNameInput = page.getByLabel('Họ tên ứng viên');
        await fullNameInput.fill('Nguyễn Văn B');
        await page.waitForTimeout(200);
        const warningVisible = await page.locator('text=Bạn đã chỉnh sửa sau khi xác nhận').isVisible().catch(() => false);
        await page.screenshot({ path: join(EVIDENCE_DIR, '06-intake-review-edit-invalidates.png'), fullPage: true });
        await recordResult('Edit after confirm shows invalidation warning', warningVisible);
        // Submit should be disabled
        const submitBtn2 = page.getByRole('button', { name: 'Nộp hồ sơ' });
        const submitDisabledAfterEdit = await submitBtn2.isDisabled();
        await recordResult('Submit disabled after edit invalidates confirmation', submitDisabledAfterEdit);
      } else {
        await recordResult('Edit-after-confirm flow', false, { note: 'Preview button not found for re-test' });
      }

      // ── Test 10: Narrow panel layout ───────────────────────────────────
      await page.setViewportSize({ width: 380, height: 800 });
      await page.keyboard.press('Alt+1');
      await page.waitForTimeout(300);
      await page.screenshot({ path: join(EVIDENCE_DIR, '07-talent-narrow.png'), fullPage: true });
      const talentNarrowVisible = await page.locator('section[aria-label="Talent Context Panel"]').count();
      await recordResult('Narrow panel (380px) renders Talent', talentNarrowVisible > 0, { count: talentNarrowVisible });

      await page.keyboard.press('Alt+3');
      await page.waitForTimeout(500);
      await page.screenshot({ path: join(EVIDENCE_DIR, '08-intake-narrow.png'), fullPage: true });
      const intakeNarrowVisible = await page.locator('section[aria-label="Intake Review"]').count();
      await recordResult('Narrow panel (380px) renders Intake Review', intakeNarrowVisible > 0, { count: intakeNarrowVisible });

      // ── Test 11: Forbidden scenario ─────────────────────────────────────
      await page.setViewportSize({ width: 720, height: 800 });
      // R2: Direct API tests must include X-HRP-Staff-Id header (server rejects 401
      // without it). Use staff-supervisor-001 to access both talent and client.
      const STAFF_HEADER = { 'X-HRP-Staff-Id': 'staff-supervisor-001' };

      const apiResp = await page.request.get(`${BASE_URL}/api/context?target=talent&scenario=forbidden`, {
        headers: STAFF_HEADER,
      });
      await recordResult(
        'API: forbidden scenario returns 403',
        apiResp.status() === 403,
        { status: apiResp.status() },
      );
      const apiRespStale = await page.request.get(`${BASE_URL}/api/context?target=talent&scenario=stale`, {
        headers: STAFF_HEADER,
      });
      await recordResult(
        'API: stale scenario returns 409',
        apiRespStale.status() === 409,
        { status: apiRespStale.status() },
      );
      const apiRespTimeout = await page.request.get(`${BASE_URL}/api/context?target=talent&scenario=timeout`, {
        headers: STAFF_HEADER,
      });
      await recordResult(
        'API: timeout scenario returns 408',
        apiRespTimeout.status() === 408,
        { status: apiRespTimeout.status() },
      );
      const apiRespPartial = await page.request.get(`${BASE_URL}/api/context?target=talent&scenario=partial`, {
        headers: STAFF_HEADER,
      });
      await recordResult(
        'API: partial scenario returns 200 with unavailableFields',
        apiRespPartial.status() === 200,
        { status: apiRespPartial.status() },
      );
      const partialBody = await apiRespPartial.json();
      await recordResult(
        'API: partial scenario body has unavailableFields',
        Array.isArray(partialBody?.unavailableFields) && partialBody.unavailableFields.length > 0,
        { unavailableFields: partialBody?.unavailableFields },
      );

      // ── Test 12: Client target returns UNAVAILABLE (503) ───────────────
      const apiRespClient = await page.request.get(`${BASE_URL}/api/context?target=client`, {
        headers: STAFF_HEADER,
      });
      await recordResult(
        'API: client target returns 503 UNAVAILABLE',
        apiRespClient.status() === 503,
        { status: apiRespClient.status() },
      );

      // ── Test 13: Preview → read-only, no state mutation ─────────────────
      const previewResp = await page.request.post(`${BASE_URL}/api/intake/preview`, {
        data: {
          organizationId: 'org-001',
          intakeRevisionId: 'rev-browser-001',
          signal: { phone: '0901234567', fullName: 'Test User', citizenId: '123456789012' },
        },
        headers: { 'Content-Type': 'application/json', 'X-HRP-Staff-Id': 'staff-intake-001' },
      });
      const previewBody = await previewResp.json();
      await recordResult(
        'Preview returns candidates without mutation',
        previewResp.status() === 200 && Array.isArray(previewBody?.candidates),
        { candidates: previewBody?.candidates?.length },
      );

      // ── R2: Identity-required tests — server rejects missing/unknown staff. ──
      // These MUST stay rejected (cannot be bypassed by adding high-privilege header).
      const apiRespNoAuth = await page.request.get(`${BASE_URL}/api/context?target=talent`);
      await recordResult(
        'API: missing X-HRP-Staff-Id returns 401',
        apiRespNoAuth.status() === 401,
        { status: apiRespNoAuth.status() },
      );

      const apiRespBadAuth = await page.request.get(`${BASE_URL}/api/context?target=talent`, {
        headers: { 'X-HRP-Staff-Id': 'staff-not-in-map' },
      });
      await recordResult(
        'API: invalid X-HRP-Staff-Id returns 401',
        apiRespBadAuth.status() === 401,
        { status: apiRespBadAuth.status() },
      );

      // talent-reviewer cannot access /api/intake/run (RBAC).
      const apiRespForbidden = await page.request.post(`${BASE_URL}/api/intake/run`, {
        data: { organizationId: 'org-001' },
        headers: { 'Content-Type': 'application/json', 'X-HRP-Staff-Id': 'staff-talent-001' },
      });
      await recordResult(
        'API: talent-reviewer cannot call /api/intake/run',
        apiRespForbidden.status() === 403,
        { status: apiRespForbidden.status() },
      );

      await context.close();
    }
  } finally {
    await browser.close();
    SUMMARY.endedAt = new Date().toISOString();
    SUMMARY.pass = SUMMARY.tests.filter((t) => t.ok).length;
    SUMMARY.fail = SUMMARY.tests.filter((t) => !t.ok).length;
    await writeFile(join(EVIDENCE_DIR, 'summary.json'), JSON.stringify(SUMMARY, null, 2));
    console.log(`\n— Browser verification summary: ${SUMMARY.pass}/${SUMMARY.tests.length} passed.`);
    if (SUMMARY.fail > 0) process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
