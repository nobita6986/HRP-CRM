/**
 * tests/embed-host-mockoff-matrix.mjs — B.03-PREP C-B03-02 mock-off matrix.
 *
 * Boots the panel server with HRP_MOCK_MODE=off and NODE_ENV=production, then
 * probes every embed surface + traversal vectors. All probes must return 404
 * or non-success status without serving sensitive file content.
 */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { request } from 'node:http';

const PORT = 15604;
const BASE = 'http://127.0.0.1:' + PORT;
const APP_DIR = process.cwd();

function fetchRaw(method, path, body = null) {
  return new Promise((resolve) => {
    const data = body ? JSON.stringify(body) : null;
    const headers = { 'Content-Type': 'application/json' };
    if (data) headers['Content-Length'] = Buffer.byteLength(data);
    const req = request({ host: '127.0.0.1', port: PORT, path, method, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf-8');
        resolve({ status: res.statusCode, body: text });
      });
    });
    req.on('error', (e) => resolve({ status: 0, body: 'error: ' + e.message }));
    if (data) req.write(data);
    req.end();
  });
}

let server;

async function startServer() {
  server = spawn('node', ['--import', 'tsx/esm', 'src/server.ts'], {
    cwd: APP_DIR,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      HRP_MOCK_MODE: 'off',
      HRP_LISTEN_HOST: '127.0.0.1',
      HRP_LISTEN_PORT: String(PORT),
      HRP_NOW_EPOCH_MS: '1764166800000',
    },
  });
  for (let i = 0; i < 60; i++) {
    await sleep(250);
    try {
      const r = await fetchRaw('GET', '/health/live');
      if (r.status === 200) return;
    } catch { /* not yet */ }
  }
  throw new Error('server did not start in 15s');
}

async function stopServer() {
  if (!server) return;
  server.kill('SIGTERM');
  await new Promise((r) => { server.on('exit', r); setTimeout(r, 2000); });
  server = null;
}

const SURFACES = [
  // ── embed surface paths (must be 404)
  { name: 'embed-panel index', method: 'GET', path: '/embed-panel/index.html', expectNot: 'dist/embed-ui' },
  { name: 'embed-host-simulator', method: 'GET', path: '/embed-host-simulator', expectNot: 'embed-host-simulator.html' },
  { name: 'api/embed/talent-context-read', method: 'POST', path: '/api/embed/talent-context-read', body: { schemaVersion: '1', correlationId: 'c1', organizationId: 'o1', actor: { kind: 'DELEGATED_USER', serviceId: 's', userId: 'u', delegationRef: 'dg_x' }, target: { kind: 'TALENT', laborProfileId: 'lp-1' }, fieldAllowlist: ['identitySummary'] } },
  { name: 'api/embed/seed', method: 'POST', path: '/api/embed/seed', body: { organizationId: 'o1' } },
  { name: 'api/embed/revoke', method: 'POST', path: '/api/embed/revoke', body: { sessionRef: 'sg_x' } },
  // ── traversal probes (must NOT serve package.json content)
  { name: 'traversal: ../../package.json', method: 'GET', path: '/embed-panel/../../package.json', expectNot: 'package.json' },
  { name: 'traversal: %2e%2e%2fpackage.json', method: 'GET', path: '/embed-panel/%2e%2e%2fpackage.json', expectNot: 'package.json' },
  { name: 'traversal: %2e%2e/%2e%2e/package.json', method: 'GET', path: '/embed-panel/%2e%2e/%2e%2e/package.json', expectNot: 'package.json' },
  { name: 'traversal: backslash %5c..%5cpackage.json', method: 'GET', path: '/embed-panel/%5c..%5cpackage.json', expectNot: 'package.json' },
  { name: 'traversal: UNC-style //server/share', method: 'GET', path: '/embed-panel//server/share/package.json', expectNot: 'package.json' },
];

let pass = 0, fail = 0;
const results = [];

await startServer();
try {
  for (const p of SURFACES) {
    const r = await fetchRaw(p.method, p.path, p.body || null);
    const notServed = !p.expectNot || !r.body.includes(p.expectNot);
    const isOk = r.status >= 400 && r.status < 500;
    const ok = notServed && isOk;
    results.push({ name: p.name, status: r.status, servedForbiddenContent: !notServed, body: r.body.slice(0, 100) });
    if (ok) pass++; else fail++;
  }
} finally {
  await stopServer();
}

console.log(JSON.stringify({ pass, fail, results }, null, 2));
process.exit(fail > 0 ? 1 : 0);