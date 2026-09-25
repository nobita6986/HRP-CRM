/**
 * scripts/run-b02-repro.mjs -- T1-B round-2 / C2-07
 *
 * Runs the narrow reproducer N times sequentially with unique suffix.
 * For each run, captures:
 *   - exit code
 *   - the `kind=repro_result` JSON line (structured)
 *   - per-run stdout/stderr
 *
 * Exit code:
 *   0 = GATE_PASS (each run reported; classification may be CONFIRMED or NOT_CONFIRMED)
 *   1 = unexpected runtime failure (e.g. spawn error, harness crash)
 *
 * Output: apps/integration-worker/.b02-repro/<ts>/runs.json + summary.json
 */

import { spawn, execSync } from 'node:child_process';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const WORKER_DIR = path.resolve(__dirname, '..', 'apps', 'integration-worker');
const EVIDENCE_DIR = path.join(WORKER_DIR, '.b02-repro');
const NODE = process.execPath;
const RUN_COUNT = Number(process.env['B02_REPRO_COUNT'] ?? '3');
const RUN_TIMEOUT_MS = Number(process.env['B02_REPRO_TIMEOUT_MS'] ?? '60000');

function deriveSuffix(i) {
  return 'repro_v2_' + Date.now().toString(36) + '_' + randomBytes(3).toString('hex');
}

const evidenceRunDir = path.join(EVIDENCE_DIR, String(Date.now()));
await mkdir(evidenceRunDir, { recursive: true });

const runs = [];
let crashed = false;
for (let i = 1; i <= RUN_COUNT; i++) {
  const suffix = deriveSuffix(i);
  const outPath = path.join(evidenceRunDir, 'repro-' + i + '.stdout.txt');
  const errPath = path.join(evidenceRunDir, 'repro-' + i + '.stderr.txt');
  const env = {
    ...process.env,
    PG_HARNESS_SUFFIX: suffix,
    B02_REPRO_RUN: String(i),
    NODE_ENV: 'development',
  };
  const startedAt = Date.now();
  const child = spawn(
    NODE,
    ['tests/repro/receiver-503-race.test.mjs'],
    { cwd: WORKER_DIR, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
  );
  let out = '';
  let err = '';
  child.stdout.on('data', (d) => (out += d.toString()));
  child.stderr.on('data', (d) => (err += d.toString()));
  const exitCode = await new Promise((resolve) => {
    const t = setTimeout(() => {
      // Force-kill if reproducer hangs
      try {
        execSync(
          `powershell -NoProfile -Command "Stop-Process -Id ${child.pid} -Force -ErrorAction SilentlyContinue"`,
          { stdio: 'ignore', windowsHide: true },
        );
      } catch {}
      resolve(null);
    }, RUN_TIMEOUT_MS).unref?.();
    child.on('close', (code) => {
      clearTimeout(t);
      resolve(code);
    });
  });
  const elapsedMs = Date.now() - startedAt;
  await writeFile(outPath, out);
  await writeFile(errPath, err);

  // Extract the structured repro_result JSON line(s).
  let reproResult = null;
  for (const line of out.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith('{"kind":"repro_result"')) {
      try {
        reproResult = JSON.parse(trimmed);
        break;
      } catch {}
    }
  }
  const dataDir = path.join(WORKER_DIR, '.tmp_pgdata_worker_' + suffix);
  if (existsSync(dataDir)) {
    await rm(dataDir, { recursive: true, force: true }).catch(() => {});
  }
  runs.push({
    idx: i,
    suffix,
    startedAt,
    elapsedMs,
    exitCode,
    classification: reproResult ? reproResult.classification : 'NO_RESULT',
    observed: reproResult ? reproResult.observed : null,
    signature: reproResult ? reproResult.signature : null,
  });
  console.log(
    '[run-b02-repro] run ' +
      i +
      '/' +
      RUN_COUNT +
      ' suffix=' +
      suffix +
      ' exit=' +
      exitCode +
      ' classification=' +
      (reproResult ? reproResult.classification : 'NO_RESULT') +
      ' okCount=' +
      (reproResult ? reproResult.observed.okCount : '?') +
      ' storeUnavailable=' +
      (reproResult ? reproResult.observed.storeUnavailable : '?') +
      ' elapsed=' +
      elapsedMs +
      'ms',
  );
  if (exitCode === null || exitCode > 2) crashed = true;
}

const summary = {
  startedAt: new Date().toISOString(),
  finishedAt: new Date().toISOString(),
  runsRequested: RUN_COUNT,
  runsCompleted: runs.length,
  classifications: {
    confirmed: runs.filter((r) => r.classification === 'REPRO_CONFIRMED').length,
    notConfirmed: runs.filter((r) => r.classification === 'REPRO_NOT_CONFIRMED').length,
    noResult: runs.filter((r) => r.classification === 'NO_RESULT').length,
  },
  crashed,
  runs,
};
await writeFile(path.join(evidenceRunDir, 'summary.json'), JSON.stringify(summary, null, 2));
console.log('[run-b02-repro] evidence: ' + path.join(evidenceRunDir, 'summary.json'));
console.log(
  '[run-b02-repro] confirmed=' +
    summary.classifications.confirmed +
    ' notConfirmed=' +
    summary.classifications.notConfirmed +
    ' noResult=' +
    summary.classifications.noResult +
    ' crashed=' +
    summary.crashed,
);

setImmediate(() => process.exit(crashed ? 1 : 0));
