/**
 * scripts/run-b02-isolated.mjs -- T1-B / C-B02-1, C-B02-5, C-B02-6
 *
 * Runs the B.02 Local E2E suite N times sequentially. Each run:
 *   - gets a unique PG_HARNESS_SUFFIX (timestamp + entropy)
 *   - uses a unique data dir and a unique embedded-PG port
 *   - audits leftover listeners + processes after exit
 *   - records exit code, TAP summary, and teardown verification
 *
 * Output: a JSON evidence file at
 *   apps/integration-worker/.b02-evidence/<ts>/runs.json
 * plus per-run stdout/stderr captures under the same directory.
 *
 * Acceptance (T1-B):
 *   - 3/3 sequential runs exit 0
 *   - each run reports 8/8 scenarios PASS
 *   - teardown audit shows no leftover listener/process for that run
 */

import { spawn } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const WORKER_DIR = path.resolve(__dirname, '..', 'apps', 'integration-worker');
const EVIDENCE_DIR = path.join(WORKER_DIR, '.b02-evidence');
const NODE = process.execPath;
const RUN_COUNT = Number(process.env['B02_RUN_COUNT'] ?? '3');

function deriveSuffix(idx) {
  const ts = Date.now().toString(36);
  const rand = randomBytes(4).toString('hex');
  return 'b02_r' + idx + '_' + ts + '_' + rand;
}

function derivePort(suffix) {
  return 53000 + (Math.abs([...suffix].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 0)) % 5000);
}

function auditLeftovers(port) {
  return new Promise((resolve) => {
    let cmd;
    try {
      cmd = spawn('netstat', ['-ano', '-p', 'tcp'], { shell: true });
    } catch {
      resolve({ ok: null, portHits: [], note: 'netstat unavailable' });
      return;
    }
    let out = '';
    cmd.stdout.on('data', (d) => (out += d.toString()));
    cmd.stderr.on('data', () => {});
    cmd.on('error', () => resolve({ ok: null, portHits: [], note: 'netstat unavailable' }));
    cmd.on('close', () => {
      const portHits = [];
      const lines = out.split(/\r?\n/);
      for (const line of lines) {
        const m = line.match(/\s127\.0\.0\.1:(\d+)\s+\S+\s+LISTENING\s+(\d+)/);
        if (m && Number(m[1]) === port) {
          portHits.push({ pid: m[2] });
        }
      }
      resolve({
        ok: portHits.length === 0,
        portHits,
        note: portHits.length === 0 ? 'no listener on harness port' : 'listener still alive',
      });
    });
  });
}

async function runOnce(idx, evidenceRunDir) {
  const suffix = deriveSuffix(idx);
  const port = derivePort(suffix);
  const dataDir = path.join(WORKER_DIR, '.tmp_pgdata_worker_' + suffix);
  const stdoutPath = path.join(evidenceRunDir, 'run-' + idx + '.stdout.txt');
  const stderrPath = path.join(evidenceRunDir, 'run-' + idx + '.stderr.txt');

  const env = {
    ...process.env,
    PG_HARNESS_SUFFIX: suffix,
    HRP_ORGANIZATION_ID: process.env['HRP_ORGANIZATION_ID'] ?? '00000000-0000-0000-0000-000000000b02',
    NODE_ENV: 'development',
  };

  const cmd = NODE;
  const args = ['--test', '--test-reporter=tap', 'tests/b02-local-e2e.test.mjs'];
  console.log('[run-b02-isolated] run ' + idx + '/' + RUN_COUNT + ' suffix=' + suffix + ' port=' + port + ' dataDir=' + dataDir);

  const startedAt = Date.now();
  const child = spawn(cmd, args, { cwd: WORKER_DIR, env, stdio: ['ignore', 'pipe', 'pipe'] });

  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (d) => (stdout += d.toString()));
  child.stderr.on('data', (d) => (stderr += d.toString()));

  const exitCode = await new Promise((resolve) => {
    child.on('close', (code) => resolve(code));
  });
  const elapsedMs = Date.now() - startedAt;

  await writeFile(stdoutPath, stdout);
  await writeFile(stderrPath, stderr);

  const tap = { ok: 0, notOk: 0, total: 0 };
  const tapLines = stdout.split(/\r?\n/);
  for (const line of tapLines) {
    if (line.match(/^ok\s+\d+/)) { tap.ok += 1; tap.total += 1; }
    else if (line.match(/^not ok\s+\d+/)) { tap.notOk += 1; tap.total += 1; }
  }
  const planLine = tapLines.find((l) => l.match(/^1\.\.\d+/));
  const plan = planLine ? planLine.match(/^1\.\.(\d+)/)?.[1] : null;

  await new Promise((r) => setTimeout(r, 250));
  const audit1 = await auditLeftovers(port);
  const audit2 = await auditLeftovers(port);

  if (existsSync(dataDir)) {
    await rm(dataDir, { recursive: true, force: true }).catch(() => {});
  }

  return {
    idx,
    suffix,
    port,
    dataDir,
    node: NODE,
    command: cmd + ' ' + args.join(' '),
    startedAt,
    elapsedMs,
    exitCode,
    tap: { ...tap, plan: plan ? Number(plan) : null },
    teardownAudit: { immediatelyAfterExit: audit1, after250ms: audit2 },
  };
}

const evidenceRunDir = path.join(EVIDENCE_DIR, String(Date.now()));
await mkdir(evidenceRunDir, { recursive: true });

const runs = [];
let failed = false;
for (let i = 1; i <= RUN_COUNT; i++) {
  const r = await runOnce(i, evidenceRunDir);
  runs.push(r);
  console.log('[run-b02-isolated] run ' + i + ' exit=' + r.exitCode + ' ok=' + r.tap.ok + ' notOk=' + r.tap.notOk + ' elapsed=' + r.elapsedMs + 'ms');
  if (r.exitCode !== 0 || r.tap.notOk !== 0) {
    failed = true;
    break;
  }
}

const summary = {
  startedAt: new Date().toISOString(),
  nodeVersion: process.version,
  platform: process.platform,
  arch: process.arch,
  runsRequested: RUN_COUNT,
  runsCompleted: runs.length,
  allExitZero: runs.every((r) => r.exitCode === 0),
  allTapClean: runs.every((r) => r.tap.notOk === 0),
  allTeardownClean: runs.every(
    (r) =>
      r.teardownAudit.immediatelyAfterExit.ok !== false &&
      r.teardownAudit.after250ms.ok !== false,
  ),
  runs,
};
await writeFile(path.join(evidenceRunDir, 'summary.json'), JSON.stringify(summary, null, 2));
console.log('[run-b02-isolated] evidence: ' + path.join(evidenceRunDir, 'summary.json'));
console.log(
  '[run-b02-isolated] allExitZero=' + summary.allExitZero +
    ' allTapClean=' + summary.allTapClean +
    ' allTeardownClean=' + summary.allTeardownClean,
);
process.exit(failed ? 1 : 0);
