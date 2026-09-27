/**
 * validate-n8n-envelopes-encoding.test.mjs -- negative-probe coverage
 * for the validator entrypoint's strict encoding policy.
 *
 * Scope (per T0 R2 directive):
 *   - reject UTF-8 BOM EF BB BF;
 *   - reject UTF-16 LE/BE BOM;
 *   - decode strict UTF-8 (no replacement char; invalid bytes fail);
 *   - no strip-then-accept behaviour for BOMs;
 *   - negative probes assert REJECT_EXPECTED.
 *
 * No DB, no Docker, no HRP provider. Pure script + temp files in the
 * worktree (cleaned up at the end).
 *
 * Strict UTF-8 no BOM.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const VALID_ENVELOPE_JSON =
  '{ "schemaVersion": "1", "commandId": "cmd-enc-probe-001",' +
  ' "commandName": "listDueNextActions",' +
  ' "idempotencyKey": "idem-enc-probe-001",' +
  ' "correlationId": "corr-enc-probe-001",' +
  ' "organizationId": "org-enc-probe-001",' +
  ' "source": { "kind": "HRP_UI", "provider": "HRP_UI", "connectionId": null },' +
  ' "actor": { "kind": "SERVICE", "serviceId": "svc-enc-probe-001" },' +
  ' "automationSource": { "kind": "N8N_AUTOMATION", "workflowId": "wf-enc-probe-001",' +
  ' "workflowRevision": 1, "n8nExecutionId": "exec-enc-probe-001" },' +
  ' "operation": { "op": "listDueNextActions",' +
  ' "payload": { "schemaVersion": "1", "pageSize": 50 } } }';

// Resolve the script path relative to this test file so the test is
// robust to whichever directory node --test is invoked from.
const SCRIPT = fileURLToPath(
  new URL('../scripts/validate-n8n-envelopes.mjs', import.meta.url),
);

function runValidator(args) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: 'utf8',
  });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

describe('validator: positive baseline', () => {
  test('strict UTF-8 no BOM input -> PASS', () => {
    const dir = mkdtempSync(join(tmpdir(), 'enc-probe-'));
    try {
      const p = join(dir, 'valid.json');
      writeFileSync(p, VALID_ENVELOPE_JSON, { encoding: 'utf8' });
      const r = runValidator([p]);
      assert.equal(r.code, 0, 'expected exit 0; stderr=' + r.stderr);
      assert.ok(
        /^PASS\s/m.test(r.stdout),
        'expected PASS line in stdout; got: ' + r.stdout,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('validator: negative encoding probes (REJECT_EXPECTED)', () => {
  test('UTF-8 BOM (EF BB BF) at start of file is rejected outright', () => {
    const dir = mkdtempSync(join(tmpdir(), 'enc-probe-'));
    try {
      const p = join(dir, 'utf8-bom.json');
      const buf = Buffer.concat([
        Buffer.from([0xef, 0xbb, 0xbf]),
        Buffer.from(VALID_ENVELOPE_JSON, 'utf8'),
      ]);
      writeFileSync(p, buf);
      const r = runValidator([p]);
      assert.notEqual(r.code, 0, 'expected non-zero exit');
      assert.ok(
        r.stderr.includes('UTF-8 BOM'),
        'expected UTF-8 BOM rejection in stderr; got: ' + r.stderr,
      );
      assert.ok(r.stderr.includes('FAIL'), 'expected FAIL in stderr');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('UTF-16 LE BOM (FF FE) at start of file is rejected outright', () => {
    const dir = mkdtempSync(join(tmpdir(), 'enc-probe-'));
    try {
      const p = join(dir, 'utf16-le-bom.json');
      const buf = Buffer.concat([
        Buffer.from([0xff, 0xfe]),
        Buffer.from(VALID_ENVELOPE_JSON, 'utf16le'),
      ]);
      writeFileSync(p, buf);
      const r = runValidator([p]);
      assert.notEqual(r.code, 0, 'expected non-zero exit');
      assert.ok(
        r.stderr.includes('UTF-16 LE BOM'),
        'expected UTF-16 LE BOM rejection in stderr; got: ' + r.stderr,
      );
      assert.ok(r.stderr.includes('FAIL'), 'expected FAIL in stderr');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('UTF-16 BE BOM (FE FF) at start of file is rejected outright', () => {
    // Node.js Buffer does not support a 'utf16be' encoding; build the
    // big-endian body byte-by-byte by swapping the little-endian
    // pairs that 'utf16le' produces.
    const dir = mkdtempSync(join(tmpdir(), 'enc-probe-'));
    try {
      const p = join(dir, 'utf16-be-bom.json');
      const le = Buffer.from(VALID_ENVELOPE_JSON, 'utf16le');
      const be = Buffer.allocUnsafe(le.length);
      for (let i = 0; i < le.length; i += 2) {
        be[i] = le[i + 1];
        be[i + 1] = le[i];
      }
      const buf = Buffer.concat([Buffer.from([0xfe, 0xff]), be]);
      writeFileSync(p, buf);
      const r = runValidator([p]);
      assert.notEqual(r.code, 0, 'expected non-zero exit');
      assert.ok(
        r.stderr.includes('UTF-16 BE BOM'),
        'expected UTF-16 BE BOM rejection in stderr; got: ' + r.stderr,
      );
      assert.ok(r.stderr.includes('FAIL'), 'expected FAIL in stderr');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('invalid UTF-8 byte sequence (0xFF) is rejected with strict-decoding error', () => {
    const dir = mkdtempSync(join(tmpdir(), 'enc-probe-'));
    try {
      const p = join(dir, 'bad-utf8.json');
      // JSON-ish payload with an 0xFF byte (invalid as UTF-8 anywhere).
      const buf = Buffer.from([
        0x7b, 0x22, 0x73, 0x63, 0x68, 0x65, 0x6d, 0x61,
        0x56, 0x65, 0x72, 0x73, 0x69, 0x6f, 0x6e, 0x22,
        0x3a, 0xff, 0x22, 0x31, 0x22, 0x7d,
      ]);
      writeFileSync(p, buf);
      const r = runValidator([p]);
      assert.notEqual(r.code, 0, 'expected non-zero exit');
      assert.ok(
        r.stderr.includes('invalid UTF-8'),
        'expected invalid UTF-8 rejection in stderr; got: ' + r.stderr,
      );
      assert.ok(r.stderr.includes('FAIL'), 'expected FAIL in stderr');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
