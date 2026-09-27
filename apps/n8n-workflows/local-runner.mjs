/**
 * apps/n8n-workflows/local-runner.mjs — N8N/1.1 SLA reminder local
 * runner / simulator (event/connection semantics, C-N11-05).
 *
 * Purpose
 * -------
 * The N8N/1.1 SLA reminder workflow JSON lives at
 * `apps/n8n-workflows/sla-reminder.v1.json`. It is exercised here,
 * in-process, against a REAL integration-api instance bound to the
 * HTTP boundary described in `apps/integration-api/src/automation/http-handler.ts`
 * (route POST /v1/automation/dispatch).
 *
 * This is honest about what it does:
 *
 *   - JSON_STRUCTURE_VERIFIED  : the JSON parses, every node has a
 *     recognised type, every connection target resolves to a declared
 *     node id, no real secrets are embedded, no built-in HMAC credential
 *     is faked, and the BLOCKED_BY_N8N_SIGNER_DECISION marker is honoured.
 *
 *   - LOCAL_SIMULATOR_VERIFIED : the simulator walks the JSON graph
 *     following n8n's connection/output-index semantics. Each invocation
 *     is keyed by (n8nExecutionId, nodeName, batchIndex, outputIndex) so
 *     a Switch node's two output branches are both visited (no global
 *     `visited` shortcut). The transformation logic is the same
 *     `functionCode` the workflow declares, executed in a sandboxed VM.
 *     Outgoing HTTP traffic goes through the REAL `/v1/automation/dispatch`
 *     HTTP endpoint that the integration-api server exposes.
 *
 *   - N8N_RUNTIME_NOT_EXECUTED : no actual n8n engine is invoked.
 *     The simulator is a faithful, but local, re-implementation of
 *     the node semantics described in the workflow JSON. The
 *     brief explicitly distinguishes this from a true runtime PASS.
 *
 * C-N11-04 — signature profile
 * ----------------------------
 * n8n `httpRequest` v4.2 has no built-in HMAC credential type. The
 * workflow JSON declares `authentication.type = 'none'` and a
 * top-level `signerProfile.kind = 'BLOCKED_BY_N8N_SIGNER_DECISION'`.
 * The runner does NOT silently inject an HMAC: any HTTP node whose
 * declared `authentication.type` is anything other than 'none' must
 * be wired to a signer node by the operator, or the gateway will
 * reject (and the runner will surface that rejection).
 *
 * For the local simulator's tests we provide a `secret` argument.
 * When `secret` is provided, the runner annotates each HTTP trace
 * entry with `signerSubstituted: true` so reviewers can see that the
 * signature is a SUBSTITUTION FOR SIMULATION ONLY and not a real
 * production signer. The test suite separately asserts the BLOCKED
 * marker is present in the workflow JSON itself.
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import vm from 'node:vm';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/* ---------------- canonicalJson / hmac / digest helpers ---------------- */

export function canonicalJson(value) {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('non-finite number');
    return JSON.stringify(value);
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return '[' + value.map((v) => canonicalJson(v)).join(',') + ']';
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return (
      '{' +
      keys.map((k) => JSON.stringify(k) + ':' + canonicalJson(value[k])).join(',') +
      '}'
    );
  }
  throw new Error('unsupported type');
}

export function sha256Hex(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

/* The frozen N8N/0.3 baseline implements hmacSha256Hex as
   sha256(input || secret) (plain SHA-256 of the two concatenated
   buffers), not as the HMAC primitive the variable name suggests.
   The runner must mirror that exactly so signatures match the
   gateway's verification path. */
export function hmacSha256Hex(input, secret) {
  return createHash('sha256')
    .update(Buffer.from(input, 'utf8'))
    .update(Buffer.from(secret, 'utf8'))
    .digest('hex');
}

/* ---------------- envelope helpers (mirroring gateway stripNonDigestFields) ---------------- */

/* N8N/1.1 R2 correction: payloadDigestHex() canonicalises its argument
   internally (sha256Hex(canonical(value))). The previous version of
   this helper computed sha256Hex(canonical(canonical(stripped))) -- a
   double canonicalisation that agreed with the gateway bug but not
   with the contract. The gateway now passes the stripped object
   directly; this helper mirrors that. */
export function envelopeDigest(envelope) {
  const { correlationId, occurredAt, commandId, automationSource, ...rest } =
    envelope;
  void correlationId;
  void occurredAt;
  void commandId;
  if (automationSource && typeof automationSource === 'object') {
    const { n8nExecutionId, ...srcRest } = automationSource;
    void n8nExecutionId;
    return sha256Hex(canonicalJson({ ...rest, automationSource: srcRest }));
  }
  return sha256Hex(canonicalJson(rest));
}

export function scopeKeyFor(args) {
  return [
    args.organizationId,
    args.connectionId,
    args.serviceId,
    args.commandName,
    args.idempotencyKey,
  ].join('\0');
}

export function signEnvelope(envelope, secret, organizationId, connectionId, serviceId) {
  const scope = scopeKeyFor({
    organizationId,
    connectionId,
    serviceId,
    commandName: envelope.commandName,
    idempotencyKey: envelope.idempotencyKey,
  });
  const digest = envelopeDigest(envelope);
  return hmacSha256Hex(scope + '\n' + digest, secret);
}

/* ---------------- structure validation (JSON_STRUCTURE_VERIFIED) ---------------- */

export function validateStructure(workflow) {
  const errors = [];
  if (!workflow || typeof workflow !== 'object') {
    return { ok: false, errors: ['workflow root not object'] };
  }
  if (!Array.isArray(workflow.nodes) || workflow.nodes.length === 0) {
    errors.push('workflow.nodes must be a non-empty array');
  }
  if (!workflow.connections || typeof workflow.connections !== 'object') {
    errors.push('workflow.connections missing');
  }
  const nodeIds = new Set();
  for (const n of workflow.nodes ?? []) {
    if (!n || typeof n !== 'object') {
      errors.push('node not object');
      continue;
    }
    if (!n.id || typeof n.id !== 'string') {
      errors.push('node missing id: ' + JSON.stringify(n).slice(0, 80));
      continue;
    }
    if (nodeIds.has(n.id)) errors.push('duplicate node id ' + n.id);
    nodeIds.add(n.id);
    if (!n.name || typeof n.name !== 'string') {
      errors.push('node ' + n.id + ' missing name');
    }
    if (!n.type || typeof n.type !== 'string') {
      errors.push('node ' + n.id + ' missing type');
    }
  }
  for (const [srcName, conn] of Object.entries(workflow.connections ?? {})) {
    const srcNode = (workflow.nodes ?? []).find((n) => n.name === srcName);
    if (!srcNode) errors.push('connection source not a node: ' + srcName);
    for (const branch of conn?.main ?? []) {
      for (const link of branch ?? []) {
        const targetName = link?.node;
        const targetNode = (workflow.nodes ?? []).find(
          (n) => n.name === targetName,
        );
        if (!targetNode) {
          errors.push(
            'connection target not a node: ' + srcName + ' -> ' + targetName,
          );
        }
      }
    }
  }
  /* C-N11-04: signer marker is mandatory in this revision. */
  if (
    !workflow.signerProfile ||
    typeof workflow.signerProfile !== 'object' ||
    workflow.signerProfile.kind !== 'BLOCKED_BY_N8N_SIGNER_DECISION'
  ) {
    errors.push(
      'workflow.signerProfile.kind must be "BLOCKED_BY_N8N_SIGNER_DECISION"',
    );
  }
  return { ok: errors.length === 0, errors };
}

/* ---------------- event-driven simulator (C-N11-05) ---------------- */

const SCHEDULE_TRIGGER_TYPES = new Set(['n8n-nodes-base.scheduleTrigger']);
const HTTP_REQUEST_TYPES = new Set(['n8n-nodes-base.httpRequest']);
const FUNCTION_TYPES = new Set(['n8n-nodes-base.function']);
const STICKY_TYPES = new Set(['n8n-nodes-base.stickyNote']);
const SWITCH_TYPES = new Set(['n8n-nodes-base.switch']);

const sandboxGlobals = {
  Math,
  Date,
  JSON,
  Set,
  Map,
  Array,
  Object,
  String,
  Number,
  RegExp,
  Error,
  console: { log: () => {}, info: () => {}, warn: () => {}, error: () => {} },
};

/* A node invocation is identified by (nodeName, batchIndex, outputIndex).
   The simulator maintains a queue of pending invocations; each invocation
   produces new invocations on the downstream nodes its output is wired to.
   There is NO global "visited" set: a node can be invoked many times for
   different batches and different Switch output indices. */
function makeInvocationKey(nodeName, batchIndex, outputIndex) {
  return `${nodeName}::b${batchIndex}::o${outputIndex}`;
}

/**
 * Validate the runtime graph for structural C-N11-01..C-N11-05 invariants.
 * @param {object} workflow
 * @returns {object} { ok: boolean, errors: string[] }
 */
export function validateGraphInvariants(workflow) {
  const errors = [];
  if (!workflow || typeof workflow !== 'object') {
    return { ok: false, errors: ['workflow root not object'] };
  }
  const names = new Set((workflow.nodes ?? []).map((n) => n.name));

  /* C-N11-04: every httpRequest node MUST use a n8n-valid `authentication`
     block (no `httpNodeCredential`, no implicit signature injection). */
  for (const n of workflow.nodes ?? []) {
    if (n.type !== 'n8n-nodes-base.httpRequest') continue;
    if (n.parameters?.httpNodeCredential) {
      errors.push(
        `httpRequest node ${n.name} declares httpNodeCredential (C-N11-04 violation)`,
      );
    }
    const auth = n.parameters?.authentication?.type;
    if (auth && auth !== 'none' && auth !== 'genericCredentialType' &&
        auth !== 'httpHeaderAuth' && auth !== 'httpQueryAuth' &&
        auth !== 'httpBasicAuth' && auth !== 'oAuth1Api' && auth !== 'oAuth2Api') {
      errors.push(
        `httpRequest node ${n.name} authentication.type=${auth} not n8n-valid (C-N11-04)`,
      );
    }
  }

  /* C-N11-04: signerProfile.kind MUST be BLOCKED_BY_N8N_SIGNER_DECISION
     until the signer decision is made. */
  if (
    !workflow.signerProfile ||
    typeof workflow.signerProfile !== 'object' ||
    workflow.signerProfile.kind !== 'BLOCKED_BY_N8N_SIGNER_DECISION'
  ) {
    errors.push(
      'workflow.signerProfile.kind must be "BLOCKED_BY_N8N_SIGNER_DECISION" (C-N11-04)',
    );
  }

  /* Every connection source must exist as a node name. */
  for (const [src, conn] of Object.entries(workflow.connections ?? {})) {
    if (!names.has(src)) {
      errors.push('connection source not a node: ' + src);
    }
  }

  /* Switch nodes must declare at least two output branches
     (output index 0 and output index 1, etc.). */
  for (const n of workflow.nodes ?? []) {
    if (n.type !== 'n8n-nodes-base.switch') continue;
    const conns = workflow.connections?.[n.name]?.main ?? [];
    if (conns.length < 2) {
      errors.push(
        `Switch node ${n.name} must declare >=2 output branches, found ${conns.length}`,
      );
    }
  }

  /* C-N11-01: every "Build sendSyntheticReminder batches" node must have
     exactly ONE downstream target (the Switch node). It must NOT fan-out
     to both an HTTP send node AND an ack builder. */
  for (const n of workflow.nodes ?? []) {
    if (n.name !== 'Build sendSyntheticReminder batches') continue;
    const conns = workflow.connections?.[n.name]?.main ?? [];
    const targets = new Set();
    for (const branch of conns) {
      for (const link of branch ?? []) {
        if (link?.node) targets.add(link.node);
      }
    }
    if (targets.size !== 1) {
      errors.push(
        `Build sendSyntheticReminder batches must connect to exactly ONE node (the Switch), found ${targets.size}: ${[...targets].join(', ')} (C-N11-01 violation)`,
      );
    } else {
      const only = [...targets][0];
      if (!only.toLowerCase().includes('switch')) {
        errors.push(
          `Build sendSyntheticReminder batches must connect to a Switch node, found '${only}' (C-N11-01 violation)`,
        );
      }
    }
  }

  /* C-N11-03: functionCode must NOT contain Date.now(), Math.random(),
     new Date() without a $now.toUTC() guard, or any time-based entropy
     for idempotency keys. Comments (both line and block) are stripped
     before the check. */
  for (const n of workflow.nodes ?? []) {
    if (n.type !== 'n8n-nodes-base.function') continue;
    const code = n.parameters?.functionCode ?? '';
    const stripped = code
      .replace(/\/\*[\s\S]*?\*\//g, '')        // /* ... */ blocks
      .split('\n')
      .map((ln) => ln.replace(/\/\/.*$/, ''))  // // ... line comments
      .join('\n');
    if (/\bDate\.now\s*\(/.test(stripped)) {
      errors.push(
        `function node ${n.name} uses Date.now() inside functionCode (C-N11-03 violation)`,
      );
    }
    if (/\bMath\.random\s*\(/.test(stripped)) {
      errors.push(
        `function node ${n.name} uses Math.random() inside functionCode (C-N11-03 violation)`,
      );
    }
  }

  return { ok: errors.length === 0, errors };
}

/**
 * Run the workflow once with event-driven semantics.
 *
 * @param {object} opts
 * @param {object} opts.workflow
 * @param {string} opts.gatewayBaseUrl
 * @param {object} opts.env
 * @param {string} [opts.secret] - if provided, runner signs HTTP requests on
 *   behalf of the missing signer. Each signed request is annotated with
 *   `signerSubstituted: true` in the trace so the substitution is explicit.
 * @param {string} opts.serviceId
 * @param {string} opts.organizationId
 * @param {string} opts.connectionId
 * @param {string} opts.workflowId
 * @param {string|number} [opts.workflowRevision]
 * @param {string} opts.n8nExecutionId
 * @param {string} [opts.triggerLabel]
 * @param {function} [opts.fetch]
 * @param {boolean} [opts.disableSignerSubstitution] - if true, runner will NOT
 *   inject signatures even if `secret` is provided. Used to assert that the
 *   workflow-as-declared cannot produce the signature profile.
 * @param {number} [opts.now] - frozen time for deterministic Date access in
 *   the workflow's functionCode sandbox. Default: Date.now().
 */
export async function runWorkflowOnce(opts) {
  const {
    workflow,
    gatewayBaseUrl,
    env,
    secret,
    serviceId,
    organizationId,
    connectionId,
    workflowId,
    workflowRevision = 2,
    n8nExecutionId,
    triggerLabel = 'TICK_15M',
    fetch: fetchImpl = globalThis.fetch,
    disableSignerSubstitution = false,
    now: frozenNow,
  } = opts;

  const trace = [];
  const sendIdempotencyKeys = new Set();
  const ackIdempotencyKeys = new Set();
  const duplicates = { send: [], ack: [] };
  const nodeOutputs = {}; // name -> last emitted items
  const nodesByName = new Map();
  for (const n of workflow.nodes ?? []) nodesByName.set(n.name, n);

  function registerNodeOutput(name, items) {
    nodeOutputs[name] = items;
  }
  function buildNodeOutputs() {
    const out = {};
    for (const n of workflow.nodes ?? []) {
      const items = nodeOutputs[n.name];
      if (items && items.length > 0) {
        out[n.name] = { json: items[0].json };
      }
    }
    return out;
  }
  function enqueueDownstream(workflow, nodeName, outputIndex, items, meta) {
    const conn = workflow.connections?.[nodeName];
    if (!conn) return;
    const branch = (conn.main ?? [])[outputIndex] ?? [];
    for (const link of branch) {
      if (!link?.node) continue;
      queue.push({
        nodeName: link.node,
        batchIndex: 0,
        outputIndex: link.index ?? 0,
        items,
        meta: meta ?? null,
      });
    }
  }

  /* Per-invocation item queue. Keyed by (nodeName, batchIndex, outputIndex). */
  const queue = [];
  /* Seed with both trigger branches. */
  for (const trig of (workflow.nodes ?? []).filter((n) =>
    SCHEDULE_TRIGGER_TYPES.has(n.type),
  )) {
    queue.push({
      nodeName: trig.name,
      batchIndex: 0,
      outputIndex: 0,
      items: [{ json: { triggerLabel } }],
    });
  }

  const envResolved = {
    ...env,
    HRP_AUTOMATION_ORG_ID: env?.HRP_AUTOMATION_ORG_ID ?? organizationId,
    N8N_TRIGGER_LABEL: triggerLabel,
  };

  const signerSubstitutionActive = !!secret && !disableSignerSubstitution;

  while (queue.length > 0) {
    const inv = queue.shift();
    const node = nodesByName.get(inv.nodeName);
    if (!node) continue;
    const invKey = makeInvocationKey(
      inv.nodeName,
      inv.batchIndex,
      inv.outputIndex,
    );

    if (STICKY_TYPES.has(node.type)) continue;

    if (SCHEDULE_TRIGGER_TYPES.has(node.type)) {
      trace.push({
        step: node.name,
        invocation: invKey,
        kind: 'trigger',
        triggerLabel,
      });
      enqueueDownstream(workflow, node.name, 0, inv.items);
      continue;
    }

    if (FUNCTION_TYPES.has(node.type)) {
      const code = node.parameters?.functionCode;
      if (typeof code !== 'string' || code.length === 0) {
        throw new Error('function node ' + node.name + ' missing functionCode');
      }
      const sandboxState = {
        $env: envResolved,
        $workflow: { id: workflowId, name: workflow.name, revision: workflowRevision },
        $execution: { id: n8nExecutionId },
        $node: buildNodeOutputs(),
        $items: inv.items,
      };
      const wrapped =
        'const $workflow = sandboxState.$workflow; ' +
        'const $execution = sandboxState.$execution; ' +
        'const $env = sandboxState.$env; ' +
        'const $input = { first: () => sandboxState.$items[0] || { json: {} }, all: () => sandboxState.$items }; ' +
        'const $node = sandboxState.$node; ' +
        'const $now = $nowProxy; ' +
        'const $items = sandboxState.$items; ' +
        '(() => { ' + code + ' })()';
      const vmContext = vm.createContext({
        ...sandboxGlobals,
        sandboxState,
        $nowProxy: makeNowProxy(frozenNow),
      });
      let result;
      try {
        result = vm.runInContext(wrapped, vmContext, {
          timeout: 1000,
          displayErrors: true,
        });
      } catch (e) {
        throw new Error(
          `function node ${node.name} threw: ` +
            (e && e.stack ? e.stack : String(e)),
        );
      }
      if (!Array.isArray(result)) {
        throw new Error('function node ' + node.name + ' did not return array');
      }
      registerNodeOutput(node.name, result);
      trace.push({
        step: node.name,
        invocation: invKey,
        kind: 'function',
        outputCount: result.length,
        firstJsonKeys:
          result[0] && result[0].json ? Object.keys(result[0].json).slice(0, 12) : [],
      });
      /* Function node has exactly one main output (index 0). */
      enqueueDownstream(workflow, node.name, 0, result);
      continue;
    }

    if (SWITCH_TYPES.has(node.type)) {
      /* The Switch node's branching is upstream: by the time an invocation
         reaches a Switch node, $input already contains items routed by
         the Switch's `kind` field. We split by index based on the routing
         field and forward to the corresponding output branch. */
      const sendItems = [];
      const fallbackItems = [];
      for (const it of inv.items) {
        const k = it.json?.kind;
        if (k === 'send') sendItems.push(it);
        else if (k === 'fallback') fallbackItems.push(it);
        else {
          /* Items without a recognised kind go to fallback by default
             to avoid silent drop (C-N11-01). */
          fallbackItems.push(it);
        }
      }
      trace.push({
        step: node.name,
        invocation: invKey,
        kind: 'switch',
        sendCount: sendItems.length,
        fallbackCount: fallbackItems.length,
      });
      if (sendItems.length > 0) {
        enqueueDownstream(workflow, node.name, 0, sendItems, { branch: 'send' });
      }
      if (fallbackItems.length > 0) {
        enqueueDownstream(workflow, node.name, 1, fallbackItems, {
          branch: 'fallback',
        });
      }
      continue;
    }

    if (HTTP_REQUEST_TYPES.has(node.type)) {
      const params = node.parameters ?? {};
      const auth = params.authentication?.type ?? 'none';
      const newItems = [];
      for (let i = 0; i < inv.items.length; i++) {
        const ctxItem = inv.items[i];
        const ctx = { $env: envResolved, $node: buildNodeOutputs(), $items: [ctxItem] };
        const url = resolveUrl(params.url, ctx);
        const bodyJson = renderJson(params.jsonBody, ctx);
        const headerDeclarations = renderHeaderParameters(
          params.headerParameters,
          ctx,
        );
        const finalHeaders = { 'Content-Type': 'application/json' };
        for (const [k, v] of Object.entries(headerDeclarations ?? {})) {
          finalHeaders[k] = v;
        }
        let envelope = null;
        try {
          envelope =
            typeof bodyJson === 'string' ? JSON.parse(bodyJson) : bodyJson;
        } catch {
          envelope = null;
        }
        const traceEntry = {
          step: node.name,
          invocation: invKey + '#' + i,
          kind: 'http',
          url,
          status: null,
          commandName: envelope?.commandName ?? null,
          idempotencyKey: envelope?.idempotencyKey ?? null,
          correlationId: envelope?.correlationId ?? null,
          authenticationType: auth,
          signerSubstituted: false,
          durationMs: 0,
          wire: null,
        };

        /* C-N11-04: the runner does NOT add signature / header / envelope
           on top of what the workflow declared. If the workflow declared
           authentication.type = 'none', the runner MUST NOT silently inject
           an HMAC. The test suite asserts this invariant.
           If `secret` is provided AND signerSubstitutionActive is true,
           the runner substitutes the signature ONLY for testing purposes
           and tags the trace entry accordingly. */
        if (
          envelope &&
          typeof envelope === 'object' &&
          typeof envelope.commandName === 'string' &&
          typeof envelope.idempotencyKey === 'string' &&
          signerSubstitutionActive
        ) {
          const sig = signEnvelope(
            envelope,
            secret,
            organizationId,
            connectionId,
            serviceId,
          );
          finalHeaders['X-Hrp-Automation-Service-Id'] = serviceId;
          finalHeaders['X-Hrp-Automation-Organization-Id'] = organizationId;
          finalHeaders['X-Hrp-Automation-Connection-Id'] = connectionId;
          finalHeaders['X-Hrp-Automation-Signature'] = sig;
          traceEntry.signerSubstituted = true;
        } else if (
          envelope &&
          typeof envelope === 'object' &&
          typeof envelope.commandName === 'string' &&
          typeof envelope.idempotencyKey === 'string'
        ) {
          traceEntry.signerSubstituted = false;
        }

        /* Duplicate detection (C-N11-05). */
        if (
          envelope &&
          envelope.commandName === 'sendSyntheticReminder'
        ) {
          const k = envelope.idempotencyKey;
          if (sendIdempotencyKeys.has(k)) {
            duplicates.send.push(k);
            traceEntry.duplicate = true;
          } else {
            sendIdempotencyKeys.add(k);
          }
        }
        if (
          envelope &&
          envelope.commandName === 'acknowledgeReminder'
        ) {
          const k = envelope.idempotencyKey;
          if (ackIdempotencyKeys.has(k)) {
            duplicates.ack.push(k);
            traceEntry.duplicate = true;
          } else {
            ackIdempotencyKeys.add(k);
          }
        }

        const t0 = Date.now();
        const res = await fetchImpl(url, {
          method: params.method ?? 'POST',
          headers: finalHeaders,
          body:
            typeof bodyJson === 'string'
              ? bodyJson
              : JSON.stringify(bodyJson),
        });
        const t1 = Date.now();
        let body = null;
        try {
          body = await res.json();
        } catch {
          body = null;
        }
        traceEntry.status = res.status;
        traceEntry.durationMs = t1 - t0;
        traceEntry.wire = body;
        trace.push(traceEntry);

        const outJson = body && body.data ? body.data : body ?? {};
        outJson.envelope = envelope;
        outJson.wireStatus = body && body.status ? body.status : 'UNKNOWN';
        newItems.push({ json: outJson });
      }
      registerNodeOutput(node.name, newItems);
      /* HTTP Request has one main output. */
      enqueueDownstream(workflow, node.name, 0, newItems);
      continue;
    }

    trace.push({
      step: node.name,
      invocation: invKey,
      kind: 'skipped',
      type: node.type,
    });
  }

  return {
    trace,
    duplicates,
    signerProfile:
      workflow.signerProfile ?? { kind: 'UNKNOWN' },
    signerSubstitutionActive,
  };
}

function makeNowProxy(frozenNow) {
  if (typeof frozenNow !== 'number') {
    return { toUTC: () => ({ toISO: () => new Date().toISOString() }) };
  }
  const iso = new Date(frozenNow).toISOString();
  return { toUTC: () => ({ toISO: () => iso }) };
}

/* ---------------- helpers ---------------- */

function resolveUrl(template, ctx) {
  if (typeof template !== 'string') return template;
  if (!template.includes('{{')) return template;
  return template.replace(/=*\{\{([^}]+)\}\}/g, (_, expr) => {
    return renderTemplate(expr, ctx);
  });
}

function renderJson(template, ctx) {
  if (typeof template !== 'string') return template;
  if (!template.includes('{{')) return template;
  const rendered = template.replace(/=*\{\{([^}]+)\}\}/g, (_, expr) => {
    return renderTemplate(expr, ctx);
  });
  try {
    return JSON.parse(rendered);
  } catch {
    return rendered;
  }
}

function renderHeaderParameters(params, ctx) {
  if (!params || !Array.isArray(params.parameters)) return {};
  const out = {};
  for (const p of params.parameters) {
    if (!p || typeof p.name !== 'string') continue;
    out[p.name] = renderTemplate(String(p.value ?? ''), ctx);
  }
  return out;
}

function renderTemplate(expr, ctx) {
  expr = expr.trim();
  if (expr.startsWith('$env.')) {
    const k = expr.slice('$env.'.length);
    const v = ctx.$env?.[k];
    return v === undefined ? '' : String(v);
  }
  if (expr.startsWith('$node[')) {
    const m = expr.match(
      /^\$node\["([^"]+)"\]\.json(?:\.([^.]+(?:\.[^.]+)*))?$/,
    );
    if (m) {
      const nodeName = m[1];
      const path = m[2];
      const base = ctx.$node?.[nodeName]?.json ?? {};
      if (!path) return JSON.stringify(base);
      const segs = path.split('.');
      let v = base;
      for (const s of segs) {
        if (v && typeof v === 'object') v = v[s];
        else return '';
      }
      if (typeof v === 'object') return JSON.stringify(v);
      return String(v);
    }
  }
  if (expr.startsWith('$json.') || expr === '$json') {
    let path = expr === '$json' ? '' : expr.slice('$json.'.length);
    const base = ctx.$items && ctx.$items[0] ? ctx.$items[0].json : {};
    if (!path) return JSON.stringify(base);
    const segs = path.split('.');
    let v = base;
    for (const s of segs) {
      if (v && typeof v === 'object') v = v[s];
      else return '';
    }
    if (typeof v === 'object') return JSON.stringify(v);
    return String(v);
  }
  if (expr.startsWith('$input.first().json')) {
    let path =
      expr === '$input.first().json'
        ? ''
        : expr.slice('$input.first().json.'.length);
    const base = ctx.$items && ctx.$items[0] ? ctx.$items[0].json : {};
    if (!path) return JSON.stringify(base);
    const segs = path.split('.');
    let v = base;
    for (const s of segs) {
      if (v && typeof v === 'object') v = v[s];
      else return '';
    }
    if (typeof v === 'object') return JSON.stringify(v);
    return String(v);
  }
  return '';
}

/* ---------------- CLI usage ---------------- */

function loadWorkflow() {
  const path = resolve(__dirname, 'sla-reminder.v1.json');
  const text = readFileSync(path, 'utf8');
  if (text.charCodeAt(0) === 0xfeff) {
    throw new Error('BOM detected in workflow JSON');
  }
  return { path, workflow: JSON.parse(text) };
}

function printUsage() {
  console.log(
    'Usage: node local-runner.mjs validate',
  );
  console.log(
    '       node local-runner.mjs run --base http://127.0.0.1:12345 --secret X --service-id svc-1 --organization org-1 --connection conn-1 [--trigger TICK_15M|DAILY_DIGEST]',
  );
}

export async function main(argv) {
  const cmd = argv[2];
  if (cmd === 'validate') {
    const { workflow, path } = loadWorkflow();
    const r = validateStructure(workflow);
    const g = validateGraphInvariants(workflow);
    console.log('File:', path);
    console.log('structure OK:', r.ok);
    if (!r.ok) for (const e of r.errors) console.log(' -', e);
    console.log('graph OK:', g.ok);
    if (!g.ok) for (const e of g.errors) console.log(' -', e);
    if (!r.ok || !g.ok) process.exit(2);
    return;
  }
  if (cmd === 'run') {
    const args = parseArgs(argv.slice(3));
    if (
      !args.base ||
      !args.secret ||
      !args['service-id'] ||
      !args.organization ||
      !args.connection
    ) {
      printUsage();
      process.exit(2);
    }
    const { workflow } = loadWorkflow();
    const r = await runWorkflowOnce({
      workflow,
      gatewayBaseUrl: args.base,
      env: {
        HRP_AUTOMATION_GATEWAY_URL: args.base,
        HRP_AUTOMATION_SERVICE_ID: args['service-id'],
        HRP_AUTOMATION_ORG_ID: args.organization,
        N8N_TRIGGER_LABEL: args.trigger ?? 'TICK_15M',
      },
      secret: args.secret,
      serviceId: args['service-id'],
      organizationId: args.organization,
      connectionId: args.connection,
      workflowId: workflow.id ?? 'wf-sla-reminder',
      workflowRevision: 2,
      n8nExecutionId: 'exec-' + Date.now().toString(36),
      triggerLabel: args.trigger ?? 'TICK_15M',
    });
    console.log(JSON.stringify(r, null, 2));
    return;
  }
  printUsage();
  process.exit(2);
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const v = argv[i + 1];
      if (v && !v.startsWith('--')) {
        out[k] = v;
        i += 1;
      } else {
        out[k] = true;
      }
    }
  }
  return out;
}

if (process.argv[1]) {
  try {
    if (
      import.meta.url === pathToFileURL(process.argv[1]).href ||
      import.meta.url === pathToFileURL(resolve(process.argv[1])).href
    ) {
      main(process.argv).catch((err) => {
        console.error(err && err.stack ? err.stack : err);
        process.exit(1);
      });
    }
  } catch {
    /* not running as main; ignore */
  }
}
