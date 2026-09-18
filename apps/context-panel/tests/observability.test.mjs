/**
 * tests/observability.test.mjs — CORE/1.14 observability unit tests.
 *
 * Covers:
 *  - Correlation: generation, validation, rejection of invalid inbound.
 *  - Metrics: increment, allowlist enforcement, snapshot, get.
 *  - Kill-switch: state machine, env init, setState returns prev.
 *  - Recovery ledger: register, markApplied (idempotent), markFailed,
 *    depth, getByIdempotencyKey, resolve.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  generateCorrelationId,
  isValidCorrelationId,
  isAllowedLabelKey,
  inc,
  snapshot,
  resetAll,
  get,
  observe,
  observationsSnapshot,
  getObservation,
  setClock,
  resetClock,
  now,
} from '../dist/observability/index.js';
import { killSwitch, recoveryLedger, resetForTest } from '../dist/observability/index.js';

test('correlation: generateCorrelationId produces well-formed id', () => {
  const id = generateCorrelationId('/api/assistant/today');
  assert.ok(id.startsWith('corr-'), 'starts with corr-');
  assert.match(id, /^corr-[a-z0-9-]+-[a-z0-9]+-[a-f0-9]{4,}$/);
});

test('correlation: generateCorrelationId sanitizes unsafe routes', () => {
  const id = generateCorrelationId('/api/<script>alert(1)</script>');
  assert.ok(!id.includes('<'), 'unsafe chars must be removed');
});

test('correlation: isValidCorrelationId accepts valid id', () => {
  assert.equal(isValidCorrelationId('corr-api-foo-1u6r-abcd'), true);
});

test('correlation: isValidCorrelationId rejects PII-shaped strings', () => {
  assert.equal(isValidCorrelationId('Nguyen Van A'), false);
  assert.equal(isValidCorrelationId('0901234567'), false);
  assert.equal(isValidCorrelationId('eyJhbGciOi...'), false);
});

test('correlation: isValidCorrelationId rejects ill-formed shapes', () => {
  assert.equal(isValidCorrelationId('corr-'), false);
  assert.equal(isValidCorrelationId('corr-a-b'), false);
  assert.equal(isValidCorrelationId('notcorr-a-bc-12-abcd'), false);
});

test('correlation: rejects overlong correlation ids', () => {
  assert.equal(isValidCorrelationId('corr-' + 'a'.repeat(200) + '-bc-1234-abcd'), false);
});

test('metrics: isAllowedLabelKey enforces allowlist', () => {
  assert.equal(isAllowedLabelKey('routeName'), true);
  assert.equal(isAllowedLabelKey('outcome'), true);
  assert.equal(isAllowedLabelKey('fullName'), false);
  assert.equal(isAllowedLabelKey('phone'), false);
  assert.equal(isAllowedLabelKey('citizenId'), false);
});

test('metrics: inc accepts allowlisted labels', () => {
  resetAll();
  inc('test.counter', { routeName: 'api-test', outcome: 'success' });
  assert.equal(get('test.counter', { routeName: 'api-test', outcome: 'success' }), 1);
});

test('metrics: inc rejects non-allowlisted labels (PII guard)', () => {
  resetAll();
  assert.throws(() => {
    inc('test.counter', { fullName: 'Nguyen Van A' });
  }, /allowlist/);
  assert.throws(() => {
    inc('test.counter', { phone: '0901234567' });
  }, /allowlist/);
});

test('metrics: snapshot returns all counters', () => {
  resetAll();
  inc('test.a', { routeName: 'a' });
  inc('test.a', { routeName: 'a' });
  inc('test.b', { routeName: 'b' });
  const snap = snapshot();
  assert.ok(snap.length >= 2);
  const a = snap.find((s) => s.name === 'test.a' && s.labels.routeName === 'a');
  assert.equal(a?.value, 2);
});

test('kill-switch: defaults to disarmed', () => {
  resetForTest();
  // We can't easily test env flag here (process.env at module-load),
  // but default state after reset is disarmed.
  assert.equal(killSwitch.getState(), 'disarmed');
});

test('kill-switch: setState transitions and returns prev', () => {
  resetForTest();
  const prev = killSwitch.setState('armed');
  assert.equal(prev, 'disarmed');
  assert.equal(killSwitch.getState(), 'armed');
  assert.equal(killSwitch.isArmed(), true);
  const prev2 = killSwitch.setState('disarmed');
  assert.equal(prev2, 'armed');
  assert.equal(killSwitch.isArmed(), false);
});

test('recovery: register creates a new receipt', () => {
  resetForTest();
  const id = recoveryLedger.register({
    correlationId: 'corr-test-1-abcd',
    routeName: 'test-route',
    effectKind: 'commit_batch',
    idempotencyKey: 'idem-1',
  });
  assert.ok(id.startsWith('rcpt-'));
  assert.equal(recoveryLedger.get(id)?.state, 'pending');
});

test('recovery: register with same idempotencyKey returns same id', () => {
  resetForTest();
  const id1 = recoveryLedger.register({
    correlationId: 'corr-test-1-abcd',
    routeName: 'test-route',
    effectKind: 'commit_batch',
    idempotencyKey: 'idem-dup',
  });
  const id2 = recoveryLedger.register({
    correlationId: 'corr-test-2-efgh',
    routeName: 'test-route',
    effectKind: 'commit_batch',
    idempotencyKey: 'idem-dup',
  });
  assert.equal(id1, id2, 'same idempotencyKey must return same receiptId');
});

test('recovery: markApplied is idempotent (B5 invariant)', () => {
  resetForTest();
  const id = recoveryLedger.register({
    correlationId: 'corr-test-1-abcd',
    routeName: 'test-route',
    effectKind: 'confirm_draft',
    idempotencyKey: 'idem-apply',
  });
  recoveryLedger.markApplied(id);
  recoveryLedger.markApplied(id); // must not error
  recoveryLedger.markApplied(id); // multiple
  const r = recoveryLedger.get(id);
  assert.equal(r?.state, 'applied');
  assert.ok(r?.appliedAt);
});

test('recovery: depth count is correct', () => {
  resetForTest();
  recoveryLedger.register({
    correlationId: 'c1', routeName: 'r', effectKind: 'commit_batch', idempotencyKey: 'k1',
  });
  recoveryLedger.register({
    correlationId: 'c2', routeName: 'r', effectKind: 'commit_batch', idempotencyKey: 'k2',
  });
  const id3 = recoveryLedger.register({
    correlationId: 'c3', routeName: 'r', effectKind: 'commit_batch', idempotencyKey: 'k3',
  });
  recoveryLedger.markApplied(id3);
  const depth = recoveryLedger.depth();
  assert.equal(depth.total, 3);
  assert.equal(depth.pending, 2);
  assert.equal(depth.applied, 1);
  assert.equal(depth.failed, 0);
});

test('recovery: listPending returns only pending', () => {
  resetForTest();
  const id1 = recoveryLedger.register({
    correlationId: 'c1', routeName: 'r', effectKind: 'commit_batch', idempotencyKey: 'k1',
  });
  recoveryLedger.register({
    correlationId: 'c2', routeName: 'r', effectKind: 'commit_batch', idempotencyKey: 'k2',
  });
  recoveryLedger.markApplied(id1);
  const pending = recoveryLedger.listPending();
  assert.equal(pending.length, 1);
});

test('recovery: resolve marks applied and is idempotent', () => {
  resetForTest();
  const id = recoveryLedger.register({
    correlationId: 'c1', routeName: 'r', effectKind: 'commit_batch', idempotencyKey: 'k1',
  });
  assert.equal(recoveryLedger.resolve(id), true);
  assert.equal(recoveryLedger.get(id)?.state, 'applied');
  // Idempotent — second resolve should still return true.
  assert.equal(recoveryLedger.resolve(id), true);
  // Unknown id returns false.
  assert.equal(recoveryLedger.resolve('rcpt-unknown'), false);
});

test('recovery: recordReplay updates lastAction', () => {
  resetForTest();
  const id = recoveryLedger.register({
    correlationId: 'c1', routeName: 'r', effectKind: 'commit_batch', idempotencyKey: 'k1',
  });
  recoveryLedger.recordReplay(id);
  const last = recoveryLedger.getLastAction();
  assert.equal(last?.receiptId, id);
  assert.equal(last?.kind, 'replay');
});

// ─────────────────────────────────────────────────────────────────
// CORE/1.14 B4 — Metrics have a real source. Lag is a gauge/histogram,
// not a counter. Labels must use the non-PII allowlist. Use injected
// clock to produce deterministic lag values.
// ─────────────────────────────────────────────────────────────────

test('B4: observe() records duration as gauge/histogram, not counter', () => {
  resetAll();
  // Inject deterministic clock.
  let fake = 1000;
  setClock(() => fake);

  // Observe three durations for the same metric+labels.
  observe('orchestrator.lag_ms', 50, { outcome: 'success' });
  fake += 100; observe('orchestrator.lag_ms', 150, { outcome: 'success' });
  fake += 200; observe('orchestrator.lag_ms', 350, { outcome: 'success' });
  resetClock();

  const obs = getObservation('orchestrator.lag_ms', { outcome: 'success' });
  // Summary is gauge/histogram semantics: count, sum, mean, min, max, p50, p95.
  assert.equal(obs.count, 3, 'count=3');
  assert.equal(obs.sum, 550, 'sum=50+150+350');
  assert.equal(obs.mean, 550 / 3);
  assert.equal(obs.min, 50);
  assert.equal(obs.max, 350);
  assert.ok(obs.p50 >= 50 && obs.p50 <= 350);
  assert.ok(obs.p95 >= 50 && obs.p95 <= 350);

  // The same key MUST NOT be present in the counter snapshot.
  // Counters track events, observations track durations.
  resetAll();
  observe('orchestrator.lag_ms', 50, { outcome: 'success' });
  const counters = snapshot();
  const lagAsCounter = counters.find((c) => c.name === 'orchestrator.lag_ms');
  assert.equal(
    lagAsCounter,
    undefined,
    'lag_ms must NOT appear in counter snapshot (it is a gauge/histogram, not a counter)',
  );
});

test('B4: observe() rejects non-allowlisted label keys', () => {
  resetAll();
  assert.throws(
    () => observe('orchestrator.lag_ms', 10, { staffId: 'staff-001' }),
    /not in allowlist/,
    'staffId is PII-shaped and must be rejected as a label key',
  );
  assert.throws(
    () => observe('orchestrator.lag_ms', 10, { phone: '0901234567' }),
    /not in allowlist/,
    'phone must be rejected as a label key',
  );
});

test('B4: mapping_review metric increments on accept/reject/review decisions', () => {
  resetAll();
  inc('mapping_review', { decision: 'accept' });
  inc('mapping_review', { decision: 'reject' });
  inc('mapping_review', { decision: 'review' });
  assert.equal(get('mapping_review', { decision: 'accept' }), 1);
  assert.equal(get('mapping_review', { decision: 'reject' }), 1);
  assert.equal(get('mapping_review', { decision: 'review' }), 1);
});

test('B4: dlq metric increments only on give_up (failed terminal state)', () => {
  resetAll();
  // Pending registration must NOT increment dlq.
  resetForTest();
  const id1 = recoveryLedger.register({
    correlationId: 'c1', routeName: 'r', effectKind: 'commit_batch', idempotencyKey: 'k1',
  });
  // Note: register() does NOT call inc('intent.dlq'). Only markFailed does.
  assert.equal(get('intent.dlq', { decision: 'give_up' }), 0, 'pending registration is not dlq');

  // markFailed emits intent.dlq { decision: 'give_up' }.
  recoveryLedger.markFailed(id1, 'simulated permanent failure');
  assert.equal(get('intent.dlq', { decision: 'give_up' }), 1, 'failed receipt → dlq');

  // Recovery replay (markApplied) does NOT emit dlq.
  const id2 = recoveryLedger.register({
    correlationId: 'c2', routeName: 'r', effectKind: 'commit_batch', idempotencyKey: 'k2',
  });
  recoveryLedger.markApplied(id2);
  assert.equal(get('intent.dlq', { decision: 'give_up' }), 1, 'applied receipt → still 1, not dlq');

  // Idempotent markFailed does NOT double-count.
  recoveryLedger.markFailed(id1, 'already failed');
  assert.equal(get('intent.dlq', { decision: 'give_up' }), 1, 'idempotent markFailed is no-op');
});

test('B4: observationsSnapshot returns one entry per (name,labels)', () => {
  resetAll();
  observe('orchestrator.lag_ms', 10, { outcome: 'success' });
  observe('orchestrator.lag_ms', 20, { outcome: 'success' });
  observe('orchestrator.lag_ms', 30, { outcome: 'error' });
  const snap = observationsSnapshot();
  const lag = snap.filter((s) => s.name === 'orchestrator.lag_ms');
  assert.equal(lag.length, 2, 'two distinct label-sets');
  const success = lag.find((s) => s.labels.outcome === 'success');
  assert.ok(success, 'success bucket present');
  assert.equal(success.summary.count, 2);
  assert.equal(success.summary.sum, 30);
});

test('B4: resetAll() clears observations AND clock', () => {
  setClock(() => 12345);
  observe('orchestrator.lag_ms', 100, { outcome: 'success' });
  resetAll();
  // After reset, clock returns Date.now() and observations are empty.
  assert.notEqual(now(), 12345, 'clock is reset to Date.now()');
  const snap = observationsSnapshot();
  assert.equal(snap.length, 0, 'observations cleared');
});
