/**
 * src/embed/embed-panel.tsx — B.03-PREP isolated embed-host React panel.
 *
 * Rendered ONLY for the embed-host simulator harness (not the product UI).
 * Listens for inbound postMessage envelopes from the parent, validates
 * origin/source/size/version/denylist, calls /api/embed/talent-context-read,
 * and renders the projection (or denial state) in Vietnamese.
 *
 * SYNTHETIC ONLY. No real Chatwoot / HRP runtime.
 */
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import {
  parseEnvelope,
  assertOrigin,
  isWindowLike,
  HOST_ALLOWED_ORIGINS,
  extractAcceptedHint,
  type Envelope,
  type ParseResult,
} from './message-protocol.js';
import { assertAllowed, type RedactionGuardResult } from './redaction.js';

type PanelState =
  | { kind: 'idle' }
  | { kind: 'loading'; envelope: Envelope }
  | { kind: 'ready'; envelope: Envelope; result: unknown; redaction: RedactionGuardResult }
  | { kind: 'denied'; envelope: Envelope | null; code: string; detail: string; viMessage: string }
  | { kind: 'error'; message: string };

function viMessageFor(code: string): string {
  switch (code) {
    case 'AUTHENTICATION_REQUIRED':
    case 'SESSION_EXPIRED':
    case 'SESSION_REVOKED':
      return 'Vui lòng đăng nhập lại.';
    case 'CROSS_ORG':
      return 'Bạn không có quyền truy cập tổ chức này.';
    case 'OBJECT_NOT_PERMITTED':
      return 'Bạn không có quyền xem hồ sơ này.';
    case 'PROJECTION_UNSUPPORTED':
      return 'Trường dữ liệu không được hỗ trợ.';
    case 'VALIDATION_ERROR':
    case 'MALFORMED_REQUEST':
      return 'Yêu cầu không hợp lệ.';
    case 'TIMEOUT':
      return 'Yêu cầu quá thời gian. Vui lòng thử lại.';
    case 'STALE':
      return 'Dữ liệu đã cũ. Vui lòng tải lại.';
    case 'DEPENDENCY_UNAVAILABLE':
    case 'UNAVAILABLE':
      return 'Dịch vụ tạm thời không khả dụng.';
    case 'FORBIDDEN':
      return 'Yêu cầu không hợp lệ.';
    default:
      return 'Lỗi không xác định.';
  }
}

function sendState(parent: Window | null, state: PanelState): void {
  if (!parent) return;
  try {
    parent.postMessage({ kind: 'hrp/panel-state', state: state.kind }, window.location.origin);
  } catch {
    /* parent may be gone */
  }
}

function EmbedPanel() {
  const [state, setState] = React.useState<PanelState>({ kind: 'idle' });
  const [activeTarget, setActiveTarget] = React.useState<string | null>(null);
  const [lastCorrelation, setLastCorrelation] = React.useState<string | null>(null);
  const [parentOrigin, setParentOrigin] = React.useState<string>('(unknown)');

  const handleEnvelope = React.useCallback(async (env: Envelope) => {
    setState({ kind: 'loading', envelope: env });
    sendState(window.parent, { kind: 'loading', envelope: env });
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
      const data = await resp.json();
      if (!resp.ok) {
        const code = (data && typeof data === 'object' && 'error' in data) ? String((data as { error?: unknown }).error) : 'UNKNOWN';
        const den = {
          kind: 'denied' as const,
          envelope: env,
          code,
          detail: code,
          viMessage: viMessageFor(code),
        };
        setState(den);
        sendState(window.parent, den);
        return;
      }
      // Defense-in-depth UI-side guard.
      const redaction = assertAllowed(data);
      if (!redaction.ok) {
        const den = {
          kind: 'denied' as const,
          envelope: env,
          code: redaction.code,
          detail: redaction.detail,
          viMessage: 'Dữ liệu không hợp lệ.',
        };
        setState(den);
        sendState(window.parent, den);
        return;
      }
      const ready = {
        kind: 'ready' as const,
        envelope: env,
        result: redaction.redacted,
        redaction,
      };
      setState(ready);
      sendState(window.parent, ready);
    } catch (e) {
      const err = {
        kind: 'error' as const,
        message: e instanceof Error ? e.message : 'unknown',
      };
      setState(err);
      sendState(window.parent, err);
    }
  }, []);

  React.useEffect(() => {
    function onMessage(ev: MessageEvent) {
      const originOk = assertOrigin(ev.origin);
      if (!originOk) {
        const den = {
          kind: 'denied' as const,
          envelope: null,
          code: 'BAD_ORIGIN',
          detail: `origin "${ev.origin}" not in allowlist`,
          viMessage: 'Nguồn không hợp lệ.',
        };
        setState(den);
        sendState(ev.source as Window, den);
        return;
      }
      if (!isWindowLike(ev.source)) {
        const den = {
          kind: 'denied' as const,
          envelope: null,
          code: 'BAD_SOURCE',
          detail: 'event.source is not a window',
          viMessage: 'Nguồn không hợp lệ.',
        };
        setState(den);
        return;
      }
      setParentOrigin(ev.origin);
      const rawSize = typeof ev.data === 'string' ? new TextEncoder().encode(ev.data).length : (() => {
        try { return JSON.stringify(ev.data).length; } catch { return 0; }
      })();
      const parsed: ParseResult = parseEnvelope(ev.data, rawSize);
      if (!parsed.ok) {
        const den = {
          kind: 'denied' as const,
          envelope: null,
          code: parsed.code,
          detail: parsed.detail,
          viMessage: viMessageFor(parsed.code),
        };
        setState(den);
        sendState(ev.source as Window, den);
        return;
      }
      // Invalidate stale view on target change.
      const hint = extractAcceptedHint(parsed.envelope);
      const newTarget = parsed.envelope.body.target.laborProfileId;
      if (activeTarget && newTarget !== activeTarget) {
        setState({ kind: 'idle' });
      }
      setActiveTarget(newTarget);
      setLastCorrelation(hint.correlationId);
      void handleEnvelope(parsed.envelope);
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [handleEnvelope, activeTarget]);

  // Render.
  return (
    <div
      data-testid="embed-panel"
      data-parent-origin={parentOrigin}
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
          parent: <code data-testid="embed-parent-origin">{parentOrigin}</code> · target:{' '}
          <code data-testid="embed-active-target">{activeTarget ?? '(none)'}</code> · correlation:{' '}
          <code data-testid="embed-correlation">{lastCorrelation ?? '(none)'}</code>
        </div>
      </header>

      {state.kind === 'idle' && (
        <div data-testid="embed-state-idle" style={{ color: '#666' }}>
          Đang chờ yêu cầu từ embed host...
        </div>
      )}

      {state.kind === 'loading' && (
        <div data-testid="embed-state-loading" style={{ color: '#1e40af' }}>
          Đang tải ngữ cảnh...
        </div>
      )}

      {state.kind === 'denied' && (
        <div
          data-testid="embed-state-denied"
          role="alert"
          style={{
            background: '#fef2f2',
            border: '1px solid #fecaca',
            color: '#991b1b',
            padding: '0.75rem',
            borderRadius: '4px',
          }}
        >
          <strong>Không thể hiển thị ngữ cảnh.</strong>
          <div data-testid="embed-vi-message" style={{ marginTop: '0.25rem' }}>
            {state.viMessage}
          </div>
          <div data-testid="embed-deny-code" style={{ fontSize: '0.75rem', color: '#666', marginTop: '0.25rem' }}>
            code: {state.code}
          </div>
        </div>
      )}

      {state.kind === 'error' && (
        <div
          data-testid="embed-state-error"
          role="alert"
          style={{
            background: '#fef2f2',
            border: '1px solid #fecaca',
            color: '#991b1b',
            padding: '0.75rem',
            borderRadius: '4px',
          }}
        >
          Lỗi: {state.message}
        </div>
      )}

      {state.kind === 'ready' && state.redaction.ok && (
        <div data-testid="embed-state-ready">
          <div
            data-testid="embed-redacted-name"
            style={{ fontSize: '1.25rem', fontWeight: 600 }}
          >
            {state.redaction.redacted.identitySummary?.fullNameRedacted ?? '(ẩn)'}
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

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(<EmbedPanel />);
  document.body.dataset.embedPanelMounted = 'true';
}