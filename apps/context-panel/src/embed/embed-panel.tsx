/**
 * context-panel/src/embed/embed-panel.tsx — B.03-PREP isolated embed-host React panel.
 *
 * Rendered ONLY for the embed-host simulator harness (not the product UI).
 *
 * Strictness (C-B03-01):
 *   - Mounts by binding to window.parent and the URL-or-injected-hint origin.
 *     Messages accepted iff BOTH origin in allowlist AND event.source === bound parent.
 *   - Outbound postMessage uses verifiedParentOrigin as targetOrigin —
 *     never '*' and never window.location.origin.
 *
 * User-visible hygiene (C-B03-04):
 *   - UI NEVER renders raw error codes / messages / stack / parser detail.
 *   - Diagnostic codes live in data-* attributes only.
 *   - Only Vietnamese allowlisted copy is rendered as visible text.
 *
 * SYNTHETIC ONLY. No real Chatwoot / HRP runtime.
 */
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { parseEnvelope, type ParseResult, type Envelope, HOST_ALLOWED_ORIGINS } from './message-protocol.js';
import { bindChannel, postToParent, type ChannelBinding } from './channel-binding.js';
import { assertAllowed, type RedactionGuardResult } from './redaction.js';
import { MESSAGES_VI } from './messages-vi.js';

type PanelState =
  | { kind: 'idle' }
  | { kind: 'loading'; envelope: Envelope }
  | { kind: 'ready'; envelope: Envelope; result: unknown; redaction: RedactionGuardResult }
  | { kind: 'denied'; envelope: Envelope | null; viMessage: string; dataDenyCode: string }
  | { kind: 'error'; viMessage: string; dataErrorDetail: string };

interface MountProbeWindow {
  parent?: unknown;
  location?: { search?: string; origin?: string; href?: string };
}

function readBoundOrigin(search: string): string | null {
  const probe = window as unknown as { __HRP_EMBED_PARENT_ORIGIN?: unknown };
  const hint = typeof probe.__HRP_EMBED_PARENT_ORIGIN === 'string' ? probe.__HRP_EMBED_PARENT_ORIGIN : null;
  if (hint && HOST_ALLOWED_ORIGINS.has(hint)) return hint;
  const params = new URLSearchParams(search);
  const raw = params.get('parentOrigin');
  if (typeof raw !== 'string') return null;
  if (!HOST_ALLOWED_ORIGINS.has(raw)) return null;
  return raw;
}

function viForChannel(code: string): string {
  switch (code) {
    case 'ORIGIN_NOT_ALLOWED':
    case 'SOURCE_MISMATCH':
    case 'NOT_WINDOW':
    case 'UNBOUND_PARENT':
      return MESSAGES_VI.sourceInvalid;
    default:
      return MESSAGES_VI.sourceInvalid;
  }
}

function viForParse(code: string): string {
  switch (code) {
    case 'PAYLOAD_TOO_LARGE':
      return MESSAGES_VI.payloadTooLarge;
    default:
      return MESSAGES_VI.requestInvalid;
  }
}

function viForApi(code: string): string {
  switch (code) {
    case 'AUTHENTICATION_REQUIRED':
    case 'SESSION_EXPIRED':
    case 'SESSION_REVOKED':
      return MESSAGES_VI.sessionInvalid;
    case 'CROSS_ORG':
      return MESSAGES_VI.crossOrgDenied;
    case 'OBJECT_NOT_PERMITTED':
    case 'FORBIDDEN':
      return MESSAGES_VI.objectDenied;
    case 'PROJECTION_UNSUPPORTED':
      return MESSAGES_VI.projectionUnsupported;
    case 'TIMEOUT':
      return MESSAGES_VI.requestTimeout;
    case 'STALE':
      return MESSAGES_VI.stale;
    case 'DEPENDENCY_UNAVAILABLE':
    case 'UNAVAILABLE':
      return MESSAGES_VI.unavailable;
    case 'VALIDATION_ERROR':
    case 'MALFORMED_REQUEST':
    default:
      return MESSAGES_VI.requestInvalid;
  }
}

function readErrorCode(data: unknown): string {
  if (data !== null && typeof data === 'object' && 'error' in data) {
    const v = (data as { error?: unknown }).error;
    if (typeof v === 'string') return v;
  }
  return 'UNKNOWN';
}

function sendState(binding: ChannelBinding | null, kind: PanelState['kind']): void {
  if (!binding) return;
  postToParent(binding, { kind: 'hrp/panel-state', state: kind });
}

function EmbedPanel(props: { binding: ChannelBinding }) {
  const binding = props.binding;
  const [state, setState] = React.useState<PanelState>({ kind: 'idle' });
  const [activeTarget, setActiveTarget] = React.useState<string | null>(null);
  const [lastCorrelation, setLastCorrelation] = React.useState<string | null>(null);

  const onEnvelope = React.useCallback(
    async (env: Envelope) => {
      setState({ kind: 'loading', envelope: env });
      sendState(binding, 'loading');
      try {
        const resp = await fetch('/api/embed/talent-context-read', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-HRP-Embed-Session': env.sessionRef,
            'X-HRP-Embed-Correlation': env.correlationId,
          },
          body: JSON.stringify(env.body),
        });
        const data: unknown = await resp.json();
        if (!resp.ok) {
          const code = readErrorCode(data);
          const den: PanelState = {
            kind: 'denied',
            envelope: env,
            viMessage: viForApi(code),
            dataDenyCode: code,
          };
          setState(den);
          sendState(binding, 'denied');
          return;
        }
        const redaction = assertAllowed(data);
        if (!redaction.ok) {
          const den: PanelState = {
            kind: 'denied',
            envelope: env,
            viMessage: MESSAGES_VI.dataInvalid,
            dataDenyCode: redaction.code,
          };
          setState(den);
          sendState(binding, 'denied');
          return;
        }
        const ready: PanelState = {
          kind: 'ready',
          envelope: env,
          result: redaction.redacted,
          redaction,
        };
        setState(ready);
        sendState(binding, 'ready');
      } catch (e) {
        const den: PanelState = {
          kind: 'error',
          viMessage: MESSAGES_VI.requestInvalid,
          dataErrorDetail: e instanceof Error ? e.name : 'unknown',
        };
        setState(den);
        sendState(binding, 'error');
      }
    },
    [binding],
  );

  React.useEffect(() => {
    function onMessage(ev: MessageEvent) {
      const verdict = binding.accept(ev);
      if (!verdict.ok) {
        const den: PanelState = {
          kind: 'denied',
          envelope: null,
          viMessage: viForChannel(verdict.code),
          dataDenyCode: verdict.code,
        };
        setState(den);
        sendState(binding, 'denied');
        return;
      }
      const rawSize = typeof ev.data === 'string'
        ? new TextEncoder().encode(ev.data).length
        : (() => {
            try {
              return JSON.stringify(ev.data).length;
            } catch {
              return 0;
            }
          })();
      const parsed: ParseResult = parseEnvelope(ev.data, rawSize);
      if (!parsed.ok) {
        const den: PanelState = {
          kind: 'denied',
          envelope: null,
          viMessage: viForParse(parsed.code),
          dataDenyCode: parsed.code,
        };
        setState(den);
        sendState(binding, 'denied');
        return;
      }
      const hint = parsed.envelope;
      const newTarget = hint.body.target.laborProfileId;
      if (activeTarget && newTarget !== activeTarget) {
        setState({ kind: 'idle' });
      }
      setActiveTarget(newTarget);
      setLastCorrelation(hint.correlationId);
      void onEnvelope(hint);
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [binding, onEnvelope, activeTarget]);

  return (
    <div
      data-testid="embed-panel"
      data-parent-origin={binding.verifyParentOrigin() ?? ''}
      data-active-target={activeTarget ?? ''}
      data-last-correlation={lastCorrelation ?? ''}
      style={{
        fontFamily: 'ui-sans-serif, system-ui, sans-serif',
        padding: '1rem',
        background: '#fafafa',
        minHeight: '100vh',
      }}
    >
      <header
        data-testid="embed-panel-header"
        style={{
          borderBottom: '1px solid #ddd',
          paddingBottom: '0.5rem',
          marginBottom: '1rem',
        }}
      >
        <h2 style={{ margin: 0, fontSize: '1.1rem' }}>
          HRP Embed Panel
          <span
            data-testid="embed-panel-mock-badge"
            style={{
              display: 'inline-block',
              marginLeft: '0.5rem',
              padding: '0.15rem 0.5rem',
              borderRadius: '999px',
              fontSize: '0.7rem',
              background: '#fde68a',
              color: '#92400e',
              fontWeight: 600,
            }}
          >
            MOCK / SYNTHETIC
          </span>
        </h2>
        <div style={{ fontSize: '0.8rem', color: '#555', marginTop: '0.25rem' }}>
          parent: <code data-testid="embed-parent-origin">{binding.verifyParentOrigin() ?? '(unknown)'}</code>
          {' · '}target: <code data-testid="embed-active-target">{activeTarget ?? '(none)'}</code>
          {' · '}correlation: <code data-testid="embed-correlation">{lastCorrelation ?? '(none)'}</code>
        </div>
      </header>

      {state.kind === 'idle' && (
        <div data-testid="embed-state-idle" style={{ color: '#666' }}>
          {MESSAGES_VI.idle}
        </div>
      )}

      {state.kind === 'loading' && (
        <div data-testid="embed-state-loading" style={{ color: '#1e40af' }}>
          {MESSAGES_VI.loading}
        </div>
      )}

      {state.kind === 'denied' && (
        <div
          data-testid="embed-state-denied"
          role="alert"
          data-deny-code={state.dataDenyCode}
          style={{
            background: '#fef2f2',
            border: '1px solid #fecaca',
            color: '#991b1b',
            padding: '0.75rem',
            borderRadius: '4px',
          }}
        >
          <strong>{MESSAGES_VI.deniedHeader}</strong>
          <div data-testid="embed-vi-message" style={{ marginTop: '0.25rem' }}>
            {state.viMessage}
          </div>
        </div>
      )}

      {state.kind === 'error' && (
        <div
          data-testid="embed-state-error"
          role="alert"
          data-error-detail={state.dataErrorDetail}
          style={{
            background: '#fef2f2',
            border: '1px solid #fecaca',
            color: '#991b1b',
            padding: '0.75rem',
            borderRadius: '4px',
          }}
        >
          <strong>{MESSAGES_VI.deniedHeader}</strong>
          <div data-testid="embed-vi-message" style={{ marginTop: '0.25rem' }}>
            {state.viMessage}
          </div>
        </div>
      )}

      {state.kind === 'ready' && state.redaction.ok && (
        <div data-testid="embed-state-ready">
          <div
            data-testid="embed-redacted-name"
            style={{ fontSize: '1.25rem', fontWeight: 600 }}
          >
            {state.redaction.redacted.identitySummary?.fullNameRedacted ?? MESSAGES_VI.hidden}
          </div>
          <div data-testid="embed-display-only" style={{ fontSize: '0.75rem', color: '#666' }}>
            displayOnly: {String(state.redaction.redacted.identitySummary?.displayOnly)}
          </div>
          <div
            data-testid="embed-unavailable"
            style={{ fontSize: '0.75rem', color: '#666', marginTop: '0.25rem' }}
          >
            unavailableFields: {JSON.stringify(state.redaction.redacted.unavailableFields)}
          </div>
        </div>
      )}
    </div>
  );
}

function mount(): void {
  const root = document.getElementById('root');
  if (!root) return;
  const probe = window as unknown as MountProbeWindow;
  if (typeof probe.parent === 'undefined' || probe.parent === window) {
    document.body.dataset.embedPanelMounted = 'no-parent';
    return;
  }
  const origin = readBoundOrigin(probe.location?.search ?? '');
  if (!origin) {
    document.body.dataset.embedPanelMounted = 'no-allowlisted-origin';
    return;
  }
  let binding: ChannelBinding;
  try {
    binding = bindChannel(probe.parent as { postMessage: (msg: unknown, target: string) => void }, origin);
  } catch {
    document.body.dataset.embedPanelMounted = 'bind-failed';
    return;
  }
  createRoot(root).render(<EmbedPanel binding={binding} />);
  document.body.dataset.embedPanelMounted = 'true';
}

mount();