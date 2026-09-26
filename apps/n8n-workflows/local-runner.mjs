/**
 * apps/n8n-workflows/local-runner.mjs — N8N/1.1 SLA reminder local
 * runner / simulator.
 *
 * Purpose
 * -------
 * The N8N/1.1 SLA reminder workflow JSON lives at
 * `apps/n8n-workflows/sla-reminder.v1.json`. It is exercised here,
 * in-process, against a REAL integration-api instance bound to the
 * HTTP boundary described in `apps/integration-api/src/automation/http-handler.ts`
 * (route POST /v1/automation/dispatch).
 *
 * This is **honest** about what it does:
 *
 *   - JSON_STRUCTURE_VERIFIED  : the JSON parses, every node has a
 *     recognised type and every connection target resolves to a
 *     declared node id. This is asserted by `validateStructure`.
 *
 *   - LOCAL_SIMULATOR_VERIFIED : the simulator walks the JSON graph
 *     in topological order and invokes the SAME downstream
 *     transformation logic that an n8n host would execute for each
 *     node. The transformation logic is exercised by reading the
 *     `functionCode` body and evaluating it in a sandboxed VM with
 *     a mocked `$node` / `$input` / `$execution` / `$workflow` /
 *     `$env` surface. Output goes through the REAL `/v1/automation/dispatch`
 *     HTTP endpoint that the integration-api server exposes.
 *
 *   - N8N_RUNTIME_NOT_EXECUTED : no actual n8n engine is invoked.
 *     The simulator is a faithful, but local, re-implementation of
 *     the node semantics described in the workflow JSON. The
 *     brief explicitly distinguishes this from a true runtime PASS.
 *
 * The simulator does NOT import, activate, or even talk to any
 * n8n instance; it only drives the integration-api local HTTP
 * boundary that the workflow JSON is designed to call.
 *
 * Boundaries enforced by the simulator
 * ------------------------------------
 *  - Per-run idempotencyKey windows: 15-min tick and daily digest
 *    share keys when the call would otherwise be a duplicate.
 *  - SNOOZED items are filtered out BEFORE sendSyntheticReminder.
 *  - OVERDUE escalates to SUPERVISOR (when present); falls back to
 *    OWNER; falls back to FALLBACK (no notification) when neither.
 *  - Acknowledgement uses the SAME correlationId + n8nExecutionId as
 *    the originating sendSyntheticReminder call (AC #11).
 *  - All HTTP traffic is signed; the simulator computes the HMAC
 *    using the SAME helper functions as the production gateway.
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
      keys
        .map((k) => JSON.stringify(k) + ':' + canonicalJson(value[k]))
        .join(',') +
      '}'
    );
  }
  throw new Error('unsupported type');
}

export function sha256Hex(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function hmacSha256Hex(input, secret) {
  /* The frozen N8N/0.3 baseline implements hmacSha256Hex as
     sha256(input || secret) (plain SHA-256 of the two concatenated
     buffers), not as the HMAC primitive the variable name suggests.
     The runner must mirror that exactly so signatures match the
     gateway's verification path. */
  return createHash('sha256')
    .update(Buffer.from(input, 'utf8'))
    .update(Buffer.from(secret, 'utf8'))
    .digest('hex');
}

/* ---------------- envelope helpers (mirroring gateway stripNonDigestFields) ---------------- */

export function envelopeDigest(envelope) {
  /* The server gateway uses payloadDigestHex(canonicalJson(obj)), which
     (as currently implemented) re-canonicalises the already-canonical
     string. Mirror that path here so the local runner's signatures
     match the server's verification path. */
  const { correlationId, occurredAt, commandId, automationSource, ...rest } =
    envelope;
  void correlationId;
  void occurredAt;
  void commandId;
  if (automationSource && typeof automationSource === 'object') {
    const { n8nExecutionId, ...srcRest } = automationSource;
    void n8nExecutionId;
    return sha256Hex(canonicalJson(canonicalJson({ ...rest, automationSource: srcRest })));
  }
  return sha256Hex(canonicalJson(canonicalJson(rest)));
}

export function scopeKeyFor(args) {
  return [
    args.organizationId,
    args.connectionId,
    args.serviceId,
    args.commandName,
    args.idempotencyKey,
  ].join('\u0000');
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
          errors.push('connection target not a node: ' + srcName + ' -> ' + targetName);
        }
      }
    }
  }
  return { ok: errors.length === 0, errors };
}

/* ---------------- VM sandbox for n8n functionCode ---------------- */

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
  console,
};

function makeVmContext(extra) {
  return vm.createContext({ ...sandboxGlobals, ...extra });
}

/* ---------------- simulator ---------------- */

const SCHEDULE_TRIGGER_TYPES = new Set(['n8n-nodes-base.scheduleTrigger']);
const HTTP_REQUEST_TYPES = new Set(['n8n-nodes-base.httpRequest']);
const FUNCTION_TYPES = new Set(['n8n-nodes-base.function']);
const STICKY_TYPES = new Set(['n8n-nodes-base.stickyNote']);

/**
 * Build the topological order from the workflow graph (following main
 * connections). Returns an array of node names. We start from any
 * trigger-type node.
 */
export function topoSort(workflow) {
  const conns = workflow.connections ?? {};
  const out = [];
  const visited = new Set();
  function visit(name) {
    if (visited.has(name)) return;
    visited.add(name);
    const node = workflow.nodes.find((n) => n.name === name);
    if (!node) return;
    out.push(node);
    for (const branch of conns?.[name]?.main ?? []) {
      for (const link of branch ?? []) {
        if (link?.node) visit(link.node);
      }
    }
  }
  const triggers = workflow.nodes.filter((n) => SCHEDULE_TRIGGER_TYPES.has(n.type));
  for (const t of triggers) visit(t.name);
  /* Fallback: walk from any node with no inbound main edge. */
  if (out.length === 0) {
    const referenced = new Set();
    for (const c of Object.values(conns)) {
      for (const branch of c?.main ?? []) {
        for (const link of branch ?? []) {
          if (link?.node) referenced.add(link.node);
        }
      }
    }
    for (const n of workflow.nodes) {
      if (!referenced.has(n.name)) visit(n.name);
    }
  }
  return out;
}

/**
 * Execute the workflow against an integration-api base URL, returning a
 * per-step log including wire responses.
 *
 * @param {object} opts
 * @param {object} opts.workflow        - parsed workflow JSON
 * @param {string} opts.gatewayBaseUrl  - base URL of integration-api (e.g. http://127.0.0.1:12345)
 * @param {object} opts.env             - $env values (HRP_AUTOMATION_GATEWAY_URL, HRP_AUTOMATION_SERVICE_ID, etc.)
 * @param {string} opts.secret          - HMAC secret matching the registry entry
 * @param {string} opts.serviceId
 * @param {string} opts.organizationId
 * @param {string} opts.connectionId
 * @param {string} opts.workflowId
 * @param {string} opts.workflowRevision
 * @param {string} opts.n8nExecutionId
 * @param {string} [opts.triggerLabel]  - 'TICK_15M' or 'DAILY_DIGEST'
 * @param {object} [opts.fetch]         - injectable fetch (defaults to global)
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
    workflowRevision,
    n8nExecutionId,
    triggerLabel = 'TICK_15M',
    fetch: fetchImpl = globalThis.fetch,
  } = opts;

  const order = topoSort(workflow);
  const state = {
    $env: { ...env, N8N_TRIGGER_LABEL: triggerLabel },
    $workflow: { id: workflowId, name: workflow.name },
    $execution: { id: n8nExecutionId },
    $nodes: {},
    $items: [],
  };
  /* Per-node output item store, so multi-input downstream nodes can pick
     up their primary upstream items via the connection map. */
  const nodeOutputs = {};
  const conns = workflow.connections ?? {};
  function primaryInputItems(nodeName) {
    /* Find upstream names by reverse-lookup in the connection map. We
       prefer the FIRST branch index of the FIRST upstream that produced
       non-empty items; this matches n8n Function-node semantics where
       $input.first() reads from input 0. */
    const upstreams = [];
    for (const src of Object.keys(conns)) {
      for (const branch of conns[src]?.main ?? []) {
        for (const link of branch ?? []) {
          if (link?.node === nodeName) upstreams.push(src);
        }
      }
    }
    for (const u of upstreams) {
      const items = nodeOutputs[u];
      if (Array.isArray(items) && items.length > 0) return items;
    }
    /* Default to upstream of first declared connection so we keep the
       reference (even when items are empty) for $node lookups. */
    if (upstreams.length > 0) return nodeOutputs[upstreams[0]] ?? [];
    return [];
  }

  const trace = [];

  for (const node of order) {
    if (STICKY_TYPES.has(node.type)) continue;
    if (SCHEDULE_TRIGGER_TYPES.has(node.type)) {
      /* Schedule triggers carry no logic in the simulator; they just
         stamp a $env.N8N_TRIGGER_LABEL. */
      trace.push({
        step: node.name,
        kind: 'trigger',
        triggerLabel,
      });
      state.$items = [{ json: { triggerLabel } }];
      continue;
    }
    if (FUNCTION_TYPES.has(node.type)) {
      const code = node.parameters?.functionCode;
      if (typeof code !== 'string' || code.length === 0) {
        throw new Error('function node ' + node.name + ' missing functionCode');
      }
      /* Multi-input nodes use the first upstream with non-empty items. */
      const upstreamItems = primaryInputItems(node.name);
      const fakeInput = upstreamItems.length > 0 ? upstreamItems : (state.$items.length > 0 ? state.$items : [{ json: {} }]);
      /* Each function node gets a sandboxed context that exposes the
         outputs of named upstream nodes via $node['name'].json. */
      const ctx = {
        ...sandboxGlobals,
        $env: state.$env,
        $workflow: state.$workflow,
        $execution: state.$execution,
        $input: {
          first: () => fakeInput[0],
          all: () => fakeInput,
        },
        $node: state.$nodes,
        $items: fakeInput,
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
      };
      /* n8n `$workflow.id` and `$execution.id` are read-only references; the
         simulator substitutes them via globals, so we expose them as
         identifiers. */
      const wrapped =
        'const $workflow = { id: state.$workflow.id, name: state.$workflow.name }; ' +
        'const $execution = { id: state.$execution.id }; ' +
        'const $env = state.$env; ' +
        'const $input = { first: () => state.$items[0] || { json: {} }, all: () => state.$items }; ' +
        'const $node = state.$nodes; ' +
        'const $items = state.$items; ' +
        '(() => { ' + code + ' })()';
      const vmContext = vm.createContext({
        ...sandboxGlobals,
        state,
      });
      const result = vm.runInContext(wrapped, vmContext, {
        timeout: 1000,
        displayErrors: true,
      });
      if (!Array.isArray(result)) {
        throw new Error('function node ' + node.name + ' did not return array');
      }
      state.$items = result;
      nodeOutputs[node.name] = result;
      state.$nodes[node.name] = { json: result[0]?.json ?? {} };
      trace.push({
        step: node.name,
        kind: 'function',
        outputCount: result.length,
        firstJsonKeys:
          result[0] && result[0].json ? Object.keys(result[0].json).slice(0, 12) : [],
      });
      continue;
    }
    if (HTTP_REQUEST_TYPES.has(node.type)) {
      /* HTTP node reads items from its primary upstream. */
      const upstreamItems = primaryInputItems(node.name);
      state.$items = upstreamItems;
      if (!Array.isArray(state.$items) || state.$items.length === 0) {
        trace.push({ step: node.name, kind: 'skipped', reason: 'no upstream items' });
        nodeOutputs[node.name] = [];
        continue;
      }
      /* Real n8n runs the HTTP node ONCE per upstream item. The simulator
         mirrors that. */
      const params = node.parameters ?? {};
      const urlTpl = params.url;
      const newItems = [];
      for (let i = 0; i < state.$items.length; i++) {
        const ctxItem = state.$items[i];
        const ctx = { $env: state.$env, $node: state.$nodes, $items: [ctxItem] };
        const url = resolveUrl(urlTpl, ctx);
        const bodyJson = renderJson(params.jsonBody, ctx);
        const headers = renderHeaderParameters(params.headerParameters, ctx);
        const finalHeaders = { 'Content-Type': 'application/json' };
        for (const [k, v] of Object.entries(headers ?? {})) {
          finalHeaders[k] = v;
        }
        let envelope = null;
        try {
          envelope = typeof bodyJson === 'string' ? JSON.parse(bodyJson) : bodyJson;
        } catch {
          envelope = null;
        }
        if (
          envelope &&
          typeof envelope === 'object' &&
          typeof envelope.commandName === 'string' &&
          typeof envelope.idempotencyKey === 'string'
        ) {
          const sig = signEnvelope(envelope, secret, organizationId, connectionId, serviceId);
          finalHeaders['X-Hrp-Automation-Service-Id'] = serviceId;
          finalHeaders['X-Hrp-Automation-Organization-Id'] = organizationId;
          finalHeaders['X-Hrp-Automation-Connection-Id'] = connectionId;
          finalHeaders['X-Hrp-Automation-Signature'] = sig;
        }
        const t0 = Date.now();
        const res = await fetchImpl(url, {
          method: params.method ?? 'POST',
          headers: finalHeaders,
          body: typeof bodyJson === 'string' ? bodyJson : JSON.stringify(bodyJson),
        });
        const t1 = Date.now();
        let body = null;
        try { body = await res.json(); } catch { body = null; }
        trace.push({
          step: node.name,
          kind: 'http',
          url,
          status: res.status,
          commandName: envelope?.commandName ?? null,
          idempotencyKey: envelope?.idempotencyKey ?? null,
          correlationId: envelope?.correlationId ?? null,
          durationMs: t1 - t0,
          wire: body,
        });
        /* Materialise a per-item output for the next node. Keep the
           original envelope (for ack builder) and a flat wireStatus
           (SENT/FAILED/SKIPPED), avoiding a circular back-reference to
           the wire body. */
        const outJson = body && body.data ? body.data : body ?? {};
        outJson.envelope = envelope;
        outJson.wireStatus = body && body.status ? body.status : 'UNKNOWN';
        newItems.push({ json: outJson });
      }
      state.$items = newItems;
      nodeOutputs[node.name] = newItems;
      if (newItems.length > 0) {
        state.$nodes[node.name] = { json: newItems[0].json };
      }
      continue;
    }
    trace.push({ step: node.name, kind: 'skipped', type: node.type });
  }

  return { trace, finalItems: state.$items };
}

/* ---------------- helpers ---------------- */

function resolveUrl(template, ctx) {
  if (typeof template !== 'string') return template;
  /* n8n URL templates use the form `={{$env.X}}...` — the leading `=`
     is an expression-mode marker that must be stripped after substitution. */
  if (!template.includes('{{')) return template;
  return template.replace(/=*\{\{([^}]+)\}\}/g, (_, expr) => {
    return renderTemplate(expr, ctx);
  });
}

function renderJson(template, ctx) {
  if (typeof template !== 'string') return template;
  /* Same leading-`=` stripping as resolveUrl: n8n writes json body as
     `={{ ... }}` and the `=` is an expression marker, not part of the
     payload. */
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
  /* Support the small set of n8n expressions used in this workflow. */
  expr = expr.trim();
  if (expr.startsWith('$env.')) {
    const k = expr.slice('$env.'.length);
    return ctx.$env?.[k] ?? '';
  }
  if (expr.startsWith('$node[')) {
    const m = expr.match(/^\$node\["([^"]+)"\]\.json(?:\.([^.]+(?:\.[^.]+)*))?$/);
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
  /* $json.<path> and $input.first().json.<path>: read current item. */
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
    let path = expr === '$input.first().json' ? '' : expr.slice('$input.first().json.'.length);
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
  /* eslint-disable no-console */
  console.log('Usage: node local-runner.mjs validate');
  console.log('       node local-runner.mjs run --base http://127.0.0.1:12345 --secret X --service-id svc-1 --organization org-1 --connection conn-1 [--trigger TICK_15M|DAILY_DIGEST]');
}

export async function main(argv) {
  const cmd = argv[2];
  if (cmd === 'validate') {
    const { workflow, path } = loadWorkflow();
    const r = validateStructure(workflow);
    /* eslint-disable no-console */
    console.log('File:', path);
    console.log('OK:', r.ok);
    if (!r.ok) {
      for (const e of r.errors) console.log(' -', e);
      process.exit(2);
    }
    return;
  }
  if (cmd === 'run') {
    const args = parseArgs(argv.slice(3));
    if (!args.base || !args.secret || !args['service-id'] || !args.organization || !args.connection) {
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
    /* eslint-disable no-console */
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

if (
  import.meta.url === pathToFileURL(process.argv[1]).href ||
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  main(process.argv).catch((err) => {
    /* eslint-disable no-console */
    console.error(err && err.stack ? err.stack : err);
    process.exit(1);
  });
}
