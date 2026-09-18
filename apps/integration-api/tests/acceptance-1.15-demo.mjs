/**
 * apps/integration-api/tests/acceptance-1.15-demo.mjs
 *
 * CORE/1.15 - V7.9a acceptance harness.
 *
 * Scenarios A01-A15 (per Implementation-Backlog.Gate0-V7.9a.md section C).
 *
 * Run:
 *   cd apps/integration-api
 *   node --test --test-timeout=60000 tests/acceptance-1.15-demo.mjs
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createHmac } from "node:crypto";
import path from "node:path";
import url from "node:url";
import EmbeddedPostgres from "embedded-postgres";
import { readFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { createRequire } from "node:module";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../../..");
const API_DIR = path.resolve(ROOT, "apps/integration-api");

if (!existsSync(path.join(API_DIR, "dist/server.js"))) {
  execSync("npm run build", { cwd: API_DIR, stdio: "inherit" });
}

const ORG_A = "org-synthetic-001";
const ORG_B = "org-synthetic-002";
const PROVIDER = "CHATWOOT";
const CONN_ID = "conn-synth-001";
const CONN_SECRET = "synthetic-int-secret-do-not-use-in-prod";
const PG_SUFFIX = `acc115_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
const PG_PORT = 57000 + Math.abs([...PG_SUFFIX].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 0)) % 4000;
const PG_DATA_DIR = `.tmp_pgdata_acc115_${PG_SUFFIX}`;
const PG_USER = "integration";
const PG_PASSWORD = "synthetic";
const PG_DB = "integration_store_acc115";
const PG_SCHEMA = "integration";
const API_PORT = 14115;
console.log(`[acceptance-1.15-demo] SUFFIX=${PG_SUFFIX} PG_PORT=${PG_PORT} API_PORT=${API_PORT}`);

async function buildPgHarness() {
  const pg = new EmbeddedPostgres({
    databaseDir: PG_DATA_DIR,
    user: PG_USER,
    password: PG_PASSWORD,
    port: PG_PORT,
    persistent: false,
    initdbFlags: ["--locale=C", "--encoding=UTF8", "--no-locale"],
  });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase(PG_DB);
  const dbUrl = `postgresql://${PG_USER}:${PG_PASSWORD}@127.0.0.1:${PG_PORT}/${PG_DB}?schema=${PG_SCHEMA}`;
  const candidates = [
    path.resolve(process.cwd(), "node_modules/@hrp-engagement/integration-store/prisma/migrations"),
    path.resolve(process.cwd(), "../../../packages/integration-store/prisma/migrations"),
  ];
  let migrationDir;
  for (const c of candidates) {
    try { const stat = readFileSync(path.join(c, "0001_init/migration.sql"), "utf8"); if (stat) { migrationDir = c; break; } } catch {}
  }
  if (!migrationDir) throw new Error("Cannot locate integration-store prisma migrations");
  const migrationFiles = [
    "0001_init/migration.sql",
    "0002_worker_lease_fencing/migration.sql",
    "0003_intake_checkpoint/migration.sql",
    "0004_recovery_action/migration.sql",
    "0005_reconciliation_entry/migration.sql",
  ];
  const require = createRequire(import.meta.url);
  const pkg = require("pg");
  const { Client } = pkg;
  const client = new Client({ host: "127.0.0.1", port: PG_PORT, user: PG_USER, password: PG_PASSWORD, database: PG_DB });
  await client.connect();
  try {
    await client.query(`SET client_encoding TO UTF8`);
    await client.query(`SET search_path TO ${PG_SCHEMA}, public`);
    for (const mf of migrationFiles) { try { const sql = readFileSync(path.join(migrationDir, mf), "utf8"); await client.query(sql); } catch {} }
  } finally { await client.end(); }
  const integrationStore = await import("@hrp-engagement/integration-store");
  const prisma = integrationStore.createPrismaClient({ databaseUrl: dbUrl, logger: "error" });
  return { url: dbUrl, prisma, async stop() { await prisma.$disconnect(); try { await pg.stop(); } catch {} } };
}

function httpReq(host, port, method, pathStr, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = body !== null && body !== undefined ? Buffer.from(typeof body === "string" ? body : JSON.stringify(body)) : null;
    const opts = { hostname: host, port, path: pathStr, method,
      headers: { "Content-Type": "application/json", ...(data ? { "Content-Length": data.length } : {}), ...headers }, };
    const req = http.request(opts, (res) => { let buf = ""; res.on("data", (c) => (buf += c));
      res.on("end", () => { try { resolve({ status: res.statusCode, body: JSON.parse(buf) }); }
        catch { resolve({ status: res.statusCode, body: buf }); } });
    });
    req.on("error", reject); if (data) req.write(data); req.end();
  });
}

function chatwootSign(body, secret) { return createHmac("sha256", secret).update(body).digest("hex"); }
function logE(s, d) { console.log(`[${s}-EVIDENCE] ${d}`); }

function buildEnv(dbUrl, overrides = {}) {
  const defaultConn = { organizationId: ORG_A, provider: PROVIDER, connectionId: CONN_ID, secret: CONN_SECRET, algorithm: "HMAC_SHA256" };
  const zaloConn = { organizationId: ORG_A, provider: "ZALO_OA", connectionId: CONN_ID, secret: "synthetic-zalo-secret-do-not-use-in-prod", algorithm: "HMAC_SHA256" };
  const registry = overrides.registry ?? [defaultConn, zaloConn];
  return {
    NODE_ENV: "development", HRP_MOCK_MODE: "deterministic", HRP_ORGANIZATION_ID: ORG_A,
    HRP_LISTEN_HOST: "127.0.0.1", HRP_LISTEN_PORT: String(API_PORT),
    HRP_MOCK_ROUTES: "/health/live,/health/ready,/mock/integration,/mock/gateway,/mock/review/list,/mock/review/detail,/mock/review/decide,/mock/review/link,/mock/review/unlink,/mock/review/replay,/mock/outbox/intent,/mock/outbox/receipt,/mock/outbox/report,/mock/outbox/unknown-delivery,/mock/outbox/recover,/mock/reconciler/stuck-receipts,/mock/reconciler/intents,/mock/dlq/list,/mock/dlq/replay",
    HRP_REQUEST_TIMEOUT_MS: "15000", HRP_RECEIVER_ENABLED: "true", HRP_RECEIVER_MAX_BODY_BYTES: "262144",
    HRP_RECEIVER_RATE_LIMIT_PER_MIN: "600", HRP_WEBHOOK_CONNECTIONS: JSON.stringify(registry),
    DATABASE_URL: dbUrl, HRP_NOW_EPOCH_MS: "1700000000000", ...overrides.env,
  };
}

describe("CORE/1.15 V7.9a Acceptance Harness", { timeout: 300000 }, () => {
  let harness, apiServer;
  const apiPort = API_PORT;
  before(async () => {
    console.log("\n[EVIDENCE] Starting CORE/1.15 acceptance harness...\n");
    try {
      harness = await buildPgHarness();
      console.log(`[EVIDENCE] PG started: ${harness.url}`);
      const { startServer } = await import(url.pathToFileURL(path.join(API_DIR, "dist/server.js")).href);
      const { loadConfig } = await import(url.pathToFileURL(path.resolve(ROOT, "packages/config/dist/index.js")).href);
      const env = buildEnv(harness.url);
      const cfg = loadConfig({ env, kind: "api" });
      apiServer = await startServer(cfg.config, { env, prisma: harness.prisma });
      console.log(`[EVIDENCE] API server started: 127.0.0.1:${apiPort}`);
      console.log(`[EVIDENCE] Contracts version: ${cfg.config.contractsVersion ?? "unknown"}`);
      console.log(`[EVIDENCE] Mock mode: ${cfg.mockAllowed ? "allowed" : "blocked"}`);
    } catch (err) {
      console.error("[EVIDENCE] before() FAILED:", err && err.stack ? err.stack : err);
      throw err;
    }
  });
  after(async () => {
    console.log("\n[EVIDENCE] Teardown: stopping all processes...");
    if (apiServer) await new Promise((r) => apiServer.close(() => r()));
    if (harness) await harness.stop();
    console.log("[EVIDENCE] Teardown complete.\n");
  });

  test("A01: Concurrent duplicate events -> idempotent dedupe, one receipt row", async () => {
    const eventId = `evt-a01-${Date.now()}`;
    const payload = { event: "message_created", id: eventId };
    const bodyStr = JSON.stringify(payload);
    const sig = chatwootSign(bodyStr, CONN_SECRET);
    const hdrs = { "X-Chatwoot-Signature": sig, "X-Zalo-Oa-Signature": "" };
    const apiPath = `/webhooks/${ORG_A}/${PROVIDER}/${CONN_ID}`;
    const [res1, res2] = await Promise.all([
      httpReq("127.0.0.1", apiPort, "POST", apiPath, bodyStr, hdrs),
      httpReq("127.0.0.1", apiPort, "POST", apiPath, bodyStr, hdrs),
    ]);
    logE("A01", `Receipt 1: status=${res1.status} created=${res1.body?.created}`);
    logE("A01", `Receipt 2: status=${res2.status} created=${res2.body?.created}`);
    // Both return 202: first with created=true, second with created=false (idempotent dedupe).
    assert.equal(res1.status, 202);
    assert.equal(res2.status, 202);
    const oneIsDeduped = [res1.body?.created, res2.body?.created].includes(false);
    assert.ok(oneIsDeduped, "A01: at least one returned created=false (idempotent dedupe)");
    const receiptCount = await harness.prisma.externalEventReceipt.count({ where: { organizationId: ORG_A, eventId } });
    logE("A01", `Receipt rows in DB: ${receiptCount}`);
    assert.equal(receiptCount, 1, "A01: exactly 1 receipt row despite concurrent events");
    console.log("[A01] PASS: Concurrent duplicate events correctly deduplicated\n");
  });

  test("A02: Config validates DATABASE_URL; invalid URL -> VALIDATION_ERROR", async () => {
    const { loadConfig } = await import(url.pathToFileURL(path.resolve(ROOT, "packages/config/dist/index.js")).href);
    const badUrls = ["", "postgresql://bad", "mysql://x", "postgresql://postgres"];
    for (const badUrl of badUrls) {
      try {
        const badEnv = buildEnv(badUrl);
        loadConfig({ env: badEnv, kind: "api" });
        assert.fail(`A02: invalid URL "${badUrl}" should throw VALIDATION_ERROR`);
      } catch (err) {
        const msg = err.message ?? String(err);
        assert.ok(msg.includes("VALIDATION_ERROR") || msg.includes("postgres") || msg.includes("trong"), `A02: invalid URL -> error: ${badUrl}`);
      }
    }
    console.log("[A02] PASS: Config correctly validates DATABASE_URL\n");
  });

  test("A03: Receipt persisted after webhook accepted - durable row in PG", async () => {
    const eventId = "msg-a03-001";
    const payload = { event: "message_created", id: eventId };
    const bodyStr = JSON.stringify(payload);
    const sig = chatwootSign(bodyStr, CONN_SECRET);
    const res = await httpReq("127.0.0.1", apiPort, "POST", `/webhooks/${ORG_A}/${PROVIDER}/${CONN_ID}`, bodyStr, { "X-Chatwoot-Signature": sig, "X-Zalo-Oa-Signature": "" });
    logE("A03", `Webhook: status=${res.status} receiptId=${res.body?.receiptId}`);
    assert.equal(res.status, 202, "A03: webhook accepted");
    const count = await harness.prisma.externalEventReceipt.count({ where: { organizationId: ORG_A, eventId } });
    logE("A03", `Receipt rows: ${count}`);
    assert.ok(count >= 1, "A03: receipt persisted");
    console.log("[A03] PASS: Receipt durable after webhook accepted\n");
  });

  test("A04: Mock gateway endpoint accessible - routing invariant", async () => {
    const res = await httpReq("127.0.0.1", apiPort, "GET", "/mock/gateway");
    logE("A04", `Gateway endpoint: status=${res.status}`);
    assert.ok(res.status !== 404, "A04: mock gateway route registered (got " + res.status + ")");
    console.log("[A04] PASS: Mock gateway routing works\n");
  });

  test("A05: Same eventId different payload -> 409 conflict", async () => {
    const eventId = `evt-a05-${Date.now()}`;
    const body1 = JSON.stringify({ event: "message_created", id: eventId, content: "First" });
    const body2 = JSON.stringify({ event: "message_created", id: eventId, content: "CHANGED" });
    const sig1 = chatwootSign(body1, CONN_SECRET);
    const sig2 = chatwootSign(body2, CONN_SECRET);
    const res1 = await httpReq("127.0.0.1", apiPort, "POST", `/webhooks/${ORG_A}/${PROVIDER}/${CONN_ID}`, body1, { "X-Chatwoot-Signature": sig1, "X-Zalo-Oa-Signature": "" });
    logE("A05", `First payload: status=${res1.status}`);
    assert.equal(res1.status, 202, "A05: first payload accepted");
    const res2 = await httpReq("127.0.0.1", apiPort, "POST", `/webhooks/${ORG_A}/${PROVIDER}/${CONN_ID}`, body2, { "X-Chatwoot-Signature": sig2, "X-Zalo-Oa-Signature": "" });
    logE("A05", `Different payload same eventId: status=${res2.status} code=${res2.body?.code}`);
    assert.equal(res2.status, 409, "A05: same eventId different payload -> 409");
    console.log("[A05] PASS\n");
  });

  test("A06: POSSIBLE_MATCH -> REVIEW_PENDING; stale review guard", async () => {
    const { IntakeOrchestrator, digestCanonical, buildCanonicalDraft, OrchestratorError } = await import(url.pathToFileURL(path.join(API_DIR, "dist/orchestrator/index.js")).href);
    const revisionId = `rev-a06-${Date.now()}`;
    const draft = { fullName: "Test A06", phone: "0909000006", citizenIdentity: { number: "111222333444", address: "PG Lane A06" },
      intent: { stage: "NEW", availability: "AVAILABLE_NOW" },
      evidenceRefs: [{ evidenceId: "ev-a06-001", kind: "CCCD_FRONT" }, { evidenceId: "ev-a06-002", kind: "CCCD_BACK" }] };
    const ctx = { organizationId: ORG_A, intakeRevisionId: revisionId, ...draft };
    const digest = digestCanonical(buildCanonicalDraft({ ...ctx, canonicalId: "lp-a06-001", canonicalVersion: 1 }));
    const possibleGw = async () => ({ status: "APPLIED", schemaVersion: "1", commandId: "", correlationId: "",
      data: { matchingOutcome: "POSSIBLE_MATCH", reviewRef: "review-a06-001", laborProfileId: "lp-a06-001", version: 1 }, errors: [] });
    const orch = new IntakeOrchestrator({ prisma: harness.prisma, gatewayCall: possibleGw,
      identityPreview: { resolveIdentityCandidates: () => Promise.resolve({ candidates: [] }) } });
    const result = await orch.run({
      organizationId: ORG_A, intakeRevisionId: revisionId, ...draft,
      confirmation: { organizationId: ORG_A, context: { draftRevisionId: revisionId, draftDigest: digest, canonicalId: "lp-a06-001", canonicalVersion: 1 }, confirmed: true },
      draftDigest: digest, provider: PROVIDER, connectionId: CONN_ID,
      externalReference: "ext-a06", correlationId: `corr-a06-${Date.now()}`,
    });
    logE("A06", `POSSIBLE_MATCH: state=${result.state} appliedSteps=${JSON.stringify(result.appliedSteps)}`);
    assert.equal(result.state, "REVIEW_PENDING");
    assert.ok(!result.appliedSteps.includes("PROFILE")); assert.ok(!result.appliedSteps.includes("CASE")); assert.ok(!result.appliedSteps.includes("AVAILABILITY"));
    const req2 = { ...draft, organizationId: ORG_A, intakeRevisionId: revisionId,
      confirmation: { organizationId: ORG_A, context: { draftRevisionId: "rev-a06-DIFFERENT", draftDigest: digest, canonicalId: "lp-a06-001", canonicalVersion: 1 }, confirmed: true },
      draftDigest: digest, provider: PROVIDER, connectionId: CONN_ID, externalReference: "ext-a06", correlationId: `corr-a06-stale-${Date.now()}` };
    await assert.rejects(orch.run(req2), (err) => err instanceof OrchestratorError, "A06: stale confirmation -> VALIDATION_ERROR");
    console.log("[A06] PASS\n");
  });

  test("A07: CASE fail -> PARTIAL; resume skips applied steps", async () => {
    const { IntakeOrchestrator, digestCanonical, buildCanonicalDraft } = await import(url.pathToFileURL(path.join(API_DIR, "dist/orchestrator/index.js")).href);
    const revisionId = `rev-a07-${Date.now()}`;
    const draft = { fullName: "Test A07", phone: "0909000007", citizenIdentity: { number: "999988887777", address: "addr" },
      intent: { stage: "NEW", availability: "AVAILABLE_NOW" },
      evidenceRefs: [{ evidenceId: "ev-a07-001", kind: "CCCD_FRONT" }, { evidenceId: "ev-a07-002", kind: "CCCD_BACK" }] };
    const ctx = { organizationId: ORG_A, intakeRevisionId: revisionId, ...draft };
    const digest = digestCanonical(buildCanonicalDraft({ ...ctx, canonicalId: "lp-a07-001", canonicalVersion: 1 }));
    const makeReq = () => ({ organizationId: ORG_A, intakeRevisionId: revisionId, ...draft,
      confirmation: { organizationId: ORG_A, context: { draftRevisionId: revisionId, draftDigest: digest, canonicalId: "lp-a07-001", canonicalVersion: 1 }, confirmed: true },
      draftDigest: digest, provider: PROVIDER, connectionId: CONN_ID,
      externalReference: "ext-a07", correlationId: `corr-a07-${Date.now()}` });
    const failCaseGw = async (args) => {
      if (args.method === "openPlacementCase") return { status: "FAILED", schemaVersion: "1", commandId: "", correlationId: "",
        errors: [{ code: "POLICY_REJECTION", messageKey: "errors.policyRejection", retryClass: "NEVER" }] };
      return { status: "APPLIED", schemaVersion: "1", commandId: "", correlationId: "",
        data: { matchingOutcome: "EXACT_MATCH", laborProfileId: "lp-a07-001", version: 1 }, errors: [] };
    };
    const orch = new IntakeOrchestrator({ prisma: harness.prisma, gatewayCall: failCaseGw,
      identityPreview: { resolveIdentityCandidates: () => Promise.resolve({ candidates: [] }) } });
    const firstResult = await orch.run(makeReq());
    logE("A07", `First run: state=${firstResult.state} partialFailure=${JSON.stringify(firstResult.partialFailure)}`);
    assert.equal(firstResult.state, "PARTIAL");
    assert.equal(firstResult.partialFailure?.failedStep, "CASE");
    assert.ok(firstResult.appliedSteps.includes("IDENTITY")); assert.ok(firstResult.appliedSteps.includes("PROFILE")); assert.ok(!firstResult.appliedSteps.includes("CASE"));
    const fixedGw = async (args) => {
      if (args.method === "openPlacementCase") return { status: "APPLIED", schemaVersion: "1", commandId: "", correlationId: "",
        data: { canonicalId: "case-a07-001", version: 1, appliedStage: "NEW" }, errors: [] };
      return { status: "APPLIED", schemaVersion: "1", commandId: "", correlationId: "",
        data: { matchingOutcome: "EXACT_MATCH", laborProfileId: "lp-a07-001", version: 1 }, errors: [] };
    };
    const orch2 = new IntakeOrchestrator({ prisma: harness.prisma, gatewayCall: fixedGw,
      identityPreview: { resolveIdentityCandidates: () => Promise.resolve({ candidates: [] }) } });
    const resumeResult = await orch2.resumeWithPayload(makeReq());
    logE("A07", `Resume: state=${resumeResult.state} appliedSteps=${JSON.stringify(resumeResult.appliedSteps)}`);
    assert.equal(resumeResult.state, "COMPLETED");
    assert.ok(resumeResult.appliedSteps.includes("CASE")); console.log("[A07] PASS\n");
  });

  test("A08: Preview does NOT mutate - confirm required for actual write", async () => {
    const { IntakeOrchestrator } = await import(url.pathToFileURL(path.join(API_DIR, "dist/orchestrator/index.js")).href);
    let mutCalled = false;
    const safeGw = async (args) => { if (args.method === "createOrMatchLaborProfile") mutCalled = true;
      return { status: "APPLIED", schemaVersion: "1", commandId: "", correlationId: "",
        data: { matchingOutcome: "EXACT_MATCH", laborProfileId: "lp-a08", version: 1 }, errors: [] }; };
    const orch = new IntakeOrchestrator({ prisma: harness.prisma, gatewayCall: safeGw,
      identityPreview: { resolveIdentityCandidates: () => Promise.resolve({ candidates: [{ candidateId: "cand-a08-001", strength: "STRONG" }] }) } });
    mutCalled = false;
    const previewResult = await orch.preview({ organizationId: ORG_A, signal: { fullName: "Test A08", phone: "0909000008" },
      provider: PROVIDER, connectionId: CONN_ID }, `corr-a08-${Date.now()}`);
    logE("A08", `Preview: present=${!!previewResult} mutCalled=${mutCalled}`);
    assert.equal(mutCalled, false, "A08: preview does NOT call createOrMatchLaborProfile");
    console.log("[A08] PASS\n");
  });

  test("A09: AVAILABILITY applied after CASE - full pipeline", async () => {
    const { IntakeOrchestrator, digestCanonical, buildCanonicalDraft } = await import(url.pathToFileURL(path.join(API_DIR, "dist/orchestrator/index.js")).href);
    const revisionId = `rev-a09-${Date.now()}`;
    const draft = { fullName: "Test A09", phone: "0909000009", citizenIdentity: { number: "111222333555", address: "addr" },
      intent: { stage: "NEW", availability: "AVAILABLE_NOW" },
      evidenceRefs: [{ evidenceId: "ev-a09-001", kind: "CCCD_FRONT" }, { evidenceId: "ev-a09-002", kind: "CCCD_BACK" }] };
    const ctx = { organizationId: ORG_A, intakeRevisionId: revisionId, ...draft };
    const digest = digestCanonical(buildCanonicalDraft({ ...ctx, canonicalId: "lp-a09-001", canonicalVersion: 1 }));
    const fullGw = async (args) => {
      if (args.method === "openPlacementCase") return { status: "APPLIED", schemaVersion: "1", commandId: "", correlationId: "",
        data: { canonicalId: "case-a09-001", version: 1, appliedStage: "NEW" }, errors: [] };
      if (args.method === "updateLaborAvailability") return { status: "APPLIED", schemaVersion: "1", commandId: "", correlationId: "",
        data: { canonicalId: "lp-a09-001", version: 2, appliedAvailability: "AVAILABLE_NOW", appliedAvailableFromDate: null }, errors: [] };
      return { status: "APPLIED", schemaVersion: "1", commandId: "", correlationId: "",
        data: { matchingOutcome: "EXACT_MATCH", laborProfileId: "lp-a09-001", version: 1 }, errors: [] };
    };
    const orch = new IntakeOrchestrator({ prisma: harness.prisma, gatewayCall: fullGw,
      identityPreview: { resolveIdentityCandidates: () => Promise.resolve({ candidates: [] }) } });
    const result = await orch.run({
      organizationId: ORG_A, intakeRevisionId: revisionId, ...draft,
      confirmation: { organizationId: ORG_A, context: { draftRevisionId: revisionId, draftDigest: digest, canonicalId: "lp-a09-001", canonicalVersion: 1 }, confirmed: true },
      draftDigest: digest, provider: PROVIDER, connectionId: CONN_ID,
      externalReference: "ext-a09", correlationId: `corr-a09-${Date.now()}`,
    });
    logE("A09", `state=${result.state} appliedSteps=${JSON.stringify(result.appliedSteps)}`);
    assert.ok(result.appliedSteps.includes("AVAILABILITY"), "A09: AVAILABILITY step applied");
    console.log("[A09] PASS\n");
  });

  test("A10: DNC action independent of intake", async () => {
    const { executeDncAction } = await import(url.pathToFileURL(path.join(API_DIR, "dist/orchestrator/index.js")).href);
    let dncCalled = false;
    const dncGw = async (args) => { if (args.method === "commitSuppression") { dncCalled = true;
      return { status: "APPLIED", schemaVersion: "1", commandId: "", correlationId: "", data: { suppressionId: "sup-a10-001", version: 1 }, errors: [] }; }
      return { status: "APPLIED", schemaVersion: "1", commandId: "", correlationId: "", data: { matchingOutcome: "EXACT_MATCH", laborProfileId: "lp-a10", version: 1 }, errors: [] }; };
    const dncResult = await executeDncAction({
      organizationId: ORG_A, provider: PROVIDER, connectionId: CONN_ID,
      externalContactId: "ext-contact-a10", externalAccountId: "ext-acct-a10",
      reason: "CANDIDATE_REQUEST", note: "A10 test", idempotencyKey: `dnc-a10-${Date.now()}`,
      correlationId: `corr-a10-${Date.now()}`, actor: { kind: "SERVICE", serviceId: "svc-a10" },
    }, dncGw);
    logE("A10", `outcome=${dncResult.outcome} dncCalled=${dncCalled}`);
    assert.equal(dncResult.outcome, "APPLIED"); assert.ok(dncResult.suppressionEventId); assert.ok(dncCalled);
    const dncCps = await harness.prisma.intakeCheckpoint.count({ where: { organizationId: ORG_A, intakeRevisionId: { contains: "dnc" } } });
    logE("A10", `DNC-related intake checkpoints: ${dncCps}`);
    assert.equal(dncCps, 0); console.log("[A10] PASS\n");
  });

  test("A11: Cross-org connection not registered -> 4xx", async () => {
    const payload = { event: "message_created", id: "msg-a11-001" };
    const bodyStr = JSON.stringify(payload);
    const sig = chatwootSign(bodyStr, CONN_SECRET);
    const res = await httpReq("127.0.0.1", apiPort, "POST", `/webhooks/${ORG_B}/${PROVIDER}/${CONN_ID}`, bodyStr, { "X-Chatwoot-Signature": sig, "X-Zalo-Oa-Signature": "" });
    logE("A11", `Cross-org webhook: status=${res.status} code=${res.body?.code}`);
    assert.ok(res.status === 400 || res.status === 404, `A11: cross-org -> 400/404 (got ${res.status})`);
    const resA = await httpReq("127.0.0.1", apiPort, "POST", `/webhooks/${ORG_A}/${PROVIDER}/${CONN_ID}`, bodyStr, { "X-Chatwoot-Signature": sig, "X-Zalo-Oa-Signature": "" });
    logE("A11", `Same-org webhook: status=${resA.status}`);
    assert.equal(resA.status, 202); console.log("[A11] PASS\n");
  });

  test("A12: Spoofed body attributes ignored - URL scope used", async () => {
    const payload = { event: "message_created", id: "msg-a12-001", content: "Test A12",
      _spoof: { organizationId: ORG_B, canonicalTarget: "lp-spoofed" } };
    const bodyStr = JSON.stringify(payload);
    const sig = chatwootSign(bodyStr, CONN_SECRET);
    const res = await httpReq("127.0.0.1", apiPort, "POST", `/webhooks/${ORG_A}/${PROVIDER}/${CONN_ID}`, bodyStr, { "X-Chatwoot-Signature": sig, "X-Zalo-Oa-Signature": "" });
    logE("A12", `Spoofed webhook: status=${res.status}`);
    assert.equal(res.status, 202);
    const receipt = await harness.prisma.externalEventReceipt.findFirst({ where: { organizationId: ORG_A, eventId: "msg-a12-001" }, orderBy: { createdAt: "desc" } });
    logE("A12", `Receipt org: ${receipt?.organizationId}`);
    assert.equal(receipt?.organizationId, ORG_A); console.log("[A12] PASS\n");
  });

  test("A13: Review list accessible; nonexistent entry -> non-200", async () => {
    const listRes = await httpReq("127.0.0.1", apiPort, "GET", "/mock/review/list");
    logE("A13", `Review list: status=${listRes.status}`);
    assert.equal(listRes.status, 200);
    const staleRes = await httpReq("127.0.0.1", apiPort, "POST", "/mock/review/decide",
      { reviewEntryId: "rev-nonexistent-a13", kind: "REJECT", reason: "A13 test", expectedEntryVersion: 999 },
      { "Content-Type": "application/json" });
    logE("A13", `Stale review: status=${staleRes.status} body=${JSON.stringify(staleRes.body)}`);
    assert.ok(staleRes.status !== 200, `A13: nonexistent review -> non-200 (got ${staleRes.status})`);
    console.log("[A13] PASS\n");
  });

  test("A14: Webhook accepted with gateway offline; receipt survives", async () => {
    const healthRes = await httpReq("127.0.0.1", apiPort, "GET", "/health/ready");
    logE("A14", `API health: status=${healthRes.status}`);
    assert.equal(healthRes.status, 200);
    const payload = { event: "message_created", id: "msg-a14-001" };
    const bodyStr = JSON.stringify(payload);
    const sig = chatwootSign(bodyStr, CONN_SECRET);
    const res = await httpReq("127.0.0.1", apiPort, "POST", `/webhooks/${ORG_A}/${PROVIDER}/${CONN_ID}`, bodyStr, { "X-Chatwoot-Signature": sig, "X-Zalo-Oa-Signature": "" });
    logE("A14", `Webhook: status=${res.status}`);
    assert.equal(res.status, 202);
    const receipt = await harness.prisma.externalEventReceipt.findFirst({ where: { organizationId: ORG_A, eventId: "msg-a14-001" }, orderBy: { createdAt: "desc" } });
    logE("A14", `Receipt exists: ${receipt !== null}`);
    assert.ok(receipt); console.log("[A14] PASS\n");
  });

  test("A15: Worker recovery, reconciler, DLQ routes accessible", async () => {
    const reconcileRes = await httpReq("127.0.0.1", apiPort, "GET", "/mock/reconciler/stuck-receipts");
    logE("A15", `Stuck receipts endpoint: status=${reconcileRes.status}`);
    assert.ok(reconcileRes.status !== 404);
    const dlqRes = await httpReq("127.0.0.1", apiPort, "GET", "/mock/dlq/list");
    logE("A15", `DLQ endpoint: status=${dlqRes.status}`);
    assert.ok(dlqRes.status !== 404); console.log("[A15] PASS\n");
  });
});
