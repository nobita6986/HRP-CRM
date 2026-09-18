/**
 * src/observability/metrics.ts — CORE/1.14 in-process metrics.
 *
 * Tracks ONLY non-PII events. Labels are restricted to a small enum set
 * (`routeName`, `outcome`, `mockMode`, `killSwitchState`, `decision`).
 * NEVER pass fullName / phone / citizenId / etc. as a metric label.
 *
 * Three metric types:
 *  - `inc(name, labels)` — COUNTER (monotonic event count).
 *  - `observe(name, value, labels)` — GAUGE/HISTOGRAM observation (lag, depth).
 *    Observe supports snapshot values, mean, p50, p95, count.
 *  - Injected clock (setClock) for deterministic test timing.
 */
export type Outcome =
  | 'success'
  | 'forbidden'
  | 'unauthorized'
  | 'mock_disabled'
  | 'kill_switch_blocked'
  | 'unknown_field'
  | 'validation_error'
  | 'idempotent'
  | 'conflict'
  | 'dlq'
  | 'retry'
  | 'replay_safe'
  | 'error';

export type MappingReviewDecision = 'accept' | 'reject' | 'review';
export type DlqDecision = 'replay' | 'give_up';
export type KillSwitchState = 'armed' | 'disarmed' | 'transition';
export type RecoveryState = 'healthy' | 'degraded' | 'recovering' | 'recovered';

const ALLOWED_LABEL_KEYS = new Set([
  'routeName',
  'outcome',
  'mockMode',
  'killSwitchState',
  'recoveryState',
  'decision',
  'retryClass',
  'errorCode',
]);

/**
 * Validate a label key. We enforce an allowlist to prevent accidental
 * PII-label creation. New label keys must be explicitly added here.
 */
export function isAllowedLabelKey(key: string): boolean {
  return ALLOWED_LABEL_KEYS.has(key);
}

/** A single counter snapshot — used for /api/admin/metrics endpoint. */
export interface CounterSnapshot {
  name: string;
  labels: Record<string, string>;
  value: number;
}

const counters: Map<string, CounterSnapshot> = new Map();
const observations: Map<string, number[]> = new Map();

function key(name: string, labels: Record<string, string>): string {
  const sortedKeys = Object.keys(labels).sort();
  const parts = sortedKeys.map((k) => `${k}=${labels[k]}`).join('|');
  return `${name}|${parts}`;
}

/**
 * CORE/1.14 B4: injected clock. Tests can override the time source
 * to produce deterministic lag values. Production uses `Date.now()`.
 */
let clock: () => number = () => Date.now();
export function setClock(fn: () => number): void {
  clock = fn;
}
export function resetClock(): void {
  clock = () => Date.now();
}

/**
 * Duration gauge/histogram observation. NOT a counter — duration values
 * can decrease (e.g., rebuild gauge). Used for lag measurements where
 * the unit is milliseconds.
 *
 * Returns the snapshot statistics for this metric. Aggregates: count,
 * sum, mean, min, max, p50, p95 (linear interpolation on sorted array).
 */
export interface ObservationSummary {
  count: number;
  sum: number;
  mean: number;
  min: number;
  max: number;
  p50: number;
  p95: number;
}
export function observe(
  name: string,
  valueMs: number,
  labels: Record<string, string> = {},
): ObservationSummary {
  for (const k of Object.keys(labels)) {
    if (!isAllowedLabelKey(k)) {
      throw new Error(
        `metrics: label key '${k}' not in allowlist. Add explicit allowlist entry if non-PII.`,
      );
    }
  }
  const k = key(name, labels);
  const arr = observations.get(k);
  if (arr) {
    arr.push(valueMs);
  } else {
    observations.set(k, [valueMs]);
  }
  const summary = summarize(observations.get(k)!);
  // Last-value gauge semantic: also bump a counter for `value`.
  return summary;
}

function summarize(arr: number[]): ObservationSummary {
  if (arr.length === 0) {
    return { count: 0, sum: 0, mean: 0, min: 0, max: 0, p50: 0, p95: 0 };
  }
  const sorted = [...arr].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  const mean = sum / sorted.length;
  const min = sorted[0]!;
  const max = sorted[sorted.length - 1]!;
  const p50 = sorted[Math.floor(sorted.length * 0.5)] ?? 0;
  const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] ?? 0;
  return { count: sorted.length, sum, mean, min, max, p50, p95 };
}

/** Read observations snapshot. */
export function observationsSnapshot(): Array<{
  name: string;
  labels: Record<string, string>;
  summary: ObservationSummary;
}> {
  return Array.from(observations.entries()).map(([k, arr]) => {
    const [name, ...rest] = k.split('|');
    const labels: Record<string, string> = {};
    for (const part of rest.join('|').split('|')) {
      const idx = part.indexOf('=');
      if (idx > 0) {
        const key = part.slice(0, idx);
        const val = part.slice(idx + 1);
        if (key) labels[key] = val;
      }
    }
    return { name: name ?? '', labels, summary: summarize(arr) };
  });
}

/**
 * Increment a counter. Validates that all label keys are in the allowlist.
 * Caller must NEVER pass PII (fullName, phone, citizenId, etc.).
 */
export function inc(name: string, labels: Record<string, string> = {}): void {
  for (const k of Object.keys(labels)) {
    if (!isAllowedLabelKey(k)) {
      throw new Error(
        `metrics: label key '${k}' not in allowlist. ` +
          `Add explicit allowlist entry if non-PII.`,
      );
    }
  }
  const k = key(name, labels);
  const cur = counters.get(k);
  if (cur) {
    cur.value += 1;
  } else {
    counters.set(k, { name, labels: { ...labels }, value: 1 });
  }
}

/** Read all counters — for /api/admin/metrics endpoint and tests. */
export function snapshot(): CounterSnapshot[] {
  return Array.from(counters.values()).map((c) => ({ ...c, labels: { ...c.labels } }));
}

/** Reset all counters + observations — used by /api/admin/metrics reset (manager-only). */
export function resetAll(): void {
  counters.clear();
  observations.clear();
  resetClock();
}

/**
 * Test-only: read a single counter value by name + exact label match.
 * Returns 0 if absent.
 */
export function get(name: string, labels: Record<string, string> = {}): number {
  const k = key(name, labels);
  return counters.get(k)?.value ?? 0;
}

/** Test-only: read a single observation summary. */
export function getObservation(
  name: string,
  labels: Record<string, string> = {},
): ObservationSummary {
  const k = key(name, labels);
  const arr = observations.get(k);
  return summarize(arr ?? []);
}

/** Test-only: now() — returns the injected clock value. */
export function now(): number {
  return clock();
}
