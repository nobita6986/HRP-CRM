/**
 * context-panel/src/ui/app.tsx — CORE/1.9 React UI entry point.
 *
 * Task: CORE/1.9 — Context Panel + Intake review mock UI.
 * Dependencies: CORE/1.1 (mock gateway), CORE/1.6 (orchestrator), frozen contracts.
 *
 * AC:
 * 1. React/Next UI dùng mock API/gateway. Tokens cam là đề xuất; branding chưa xác minh.
 * 2. Talent/Client layout riêng. PlacementCase/Availability tách biệt.
 *    CurrentRelationship badge read-only. Close reason đúng 9 giá trị.
 * 3. Intake review: diff + evidence giả, checkbox không prechecked,
 *    edit làm mất confirmation cũ. Preview không mutation.
 * 4. Loading/empty/forbidden/unresolved/stale/timeout/partial success = tiếng Việt.
 * 5. Keyboard, panel hẹp, focus/contrast. Chưa claim embedded Chatwoot thật.
 *
 * Boundaries:
 * - Synthetic data; client domain chưa xác nhận → UNAVAILABLE.
 * - Không sửa frozen contracts.
 * - Không CORE/1.10+, HRP/provider/model thật, Docker/deploy.
 */

import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { TalentPanel } from './components/talent-panel.js';
import { ClientPanel } from './components/client-panel.js';
import { IntakeReviewPanel } from './components/intake-review.js';
import { RoutingPanel } from './components/routing-panel.js';
import { DashboardPanel } from './components/dashboard-panel.js';
import { AssistantPanel } from './components/assistant-panel.js';

/* ─────────────────────────────────────────────────────────────────────────────
 * App shell — thin routing shell (Talent | Client | Intake Review).
 * Panel width adapts: >=480px full, <480px narrow.
 * ───────────────────────────────────────────────────────────────────────────── */

type AppView = 'talent' | 'client' | 'intake-review' | 'routing' | 'dashboard' | 'assistant';

function resolveIsManager(): boolean {
  if (typeof window === 'undefined') return false;
  const staffId = (window as { __HRP_STAFF_ID?: string }).__HRP_STAFF_ID;
  return staffId === 'staff-supervisor-001';
}

function resolveStaffId(): string {
  if (typeof window === 'undefined') return '';
  return (window as { __HRP_STAFF_ID?: string }).__HRP_STAFF_ID ?? '';
}

export function AppShell() {
  const [view, setView] = React.useState<AppView>('talent');
  const [panelWidth, setPanelWidth] = React.useState(720);
  const [isManager, setIsManager] = React.useState(false);
  const [staffId, setStaffId] = React.useState('');

  React.useEffect(() => {
    setIsManager(resolveIsManager());
    setStaffId(resolveStaffId());
  }, []);

  // Keyboard navigation: Alt+1..6 cycles views.
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.altKey) {
        if (e.key === '1') setView('talent');
        if (e.key === '2') setView('client');
        if (e.key === '3') setView('intake-review');
        if (e.key === '4') setView('routing');
        if (e.key === '5') setView('dashboard');
        if (e.key === '6') setView('assistant');
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const isNarrow = panelWidth < 480;

  return (
    <div
      style={{
        fontFamily: 'ui-sans-serif, system-ui, -apple-system, sans-serif',
        maxWidth: panelWidth,
        margin: '0 auto',
        padding: isNarrow ? '0.5rem' : '1rem',
        background: '#fafafa',
        minHeight: '100vh',
      }}
      data-testid="app-shell"
    >
      {/* Header */}
      <header
        style={{
          display: 'flex',
          gap: '0.5rem',
          borderBottom: '1px solid #e5e5e5',
          paddingBottom: '0.5rem',
          marginBottom: '1rem',
          flexWrap: 'wrap',
          alignItems: 'center',
        }}
        role="banner"
      >
        <h1 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>
          HRP Context Panel
          <span style={{ fontWeight: 400, color: '#666', marginLeft: '0.5rem' }}>
            (mock UI)
          </span>
        </h1>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button
            onClick={() => setView('talent')}
            aria-pressed={view === 'talent'}
            style={{
              padding: '0.25rem 0.5rem',
              border: '1px solid #ccc',
              borderRadius: '4px',
              background: view === 'talent' ? '#e6f0ff' : '#fff',
              cursor: 'pointer',
            }}
          >
            Talent
          </button>
          <button
            onClick={() => setView('client')}
            aria-pressed={view === 'client'}
            style={{
              padding: '0.25rem 0.5rem',
              border: '1px solid #ccc',
              borderRadius: '4px',
              background: view === 'client' ? '#e6f0ff' : '#fff',
              cursor: 'pointer',
            }}
          >
            Client
          </button>
          <button
            onClick={() => setView('intake-review')}
            aria-pressed={view === 'intake-review'}
            style={{
              padding: '0.25rem 0.5rem',
              border: '1px solid #ccc',
              borderRadius: '4px',
              background: view === 'intake-review' ? '#e6f0ff' : '#fff',
              cursor: 'pointer',
            }}
          >
            Intake Review
          </button>
          <button
            onClick={() => setView('routing')}
            aria-pressed={view === 'routing'}
            style={{
              padding: '0.25rem 0.5rem',
              border: '1px solid #ccc',
              borderRadius: '4px',
              background: view === 'routing' ? '#e6f0ff' : '#fff',
              cursor: 'pointer',
            }}
          >
            Routing
          </button>
          <button
            onClick={() => setView('dashboard')}
            aria-pressed={view === 'dashboard'}
            style={{
              padding: '0.25rem 0.5rem',
              border: '1px solid #ccc',
              borderRadius: '4px',
              background: view === 'dashboard' ? '#e6f0ff' : '#fff',
              cursor: 'pointer',
            }}
          >
            Dashboard (BoD)
          </button>
          <button
            onClick={() => setView('assistant')}
            aria-pressed={view === 'assistant'}
            style={{
              padding: '0.25rem 0.5rem',
              border: '1px solid #ccc',
              borderRadius: '4px',
              background: view === 'assistant' ? '#e6f0ff' : '#fff',
              cursor: 'pointer',
            }}
          >
            Assistant
          </button>
        </div>
      </header>

      {/* Branding note: tokens cam là đề xuất, chưa xác minh. */}
      <div
        style={{
          fontSize: '0.75rem',
          color: '#888',
          marginBottom: '1rem',
          padding: '0.25rem 0.5rem',
          background: '#f5f5f5',
          borderRadius: '4px',
        }}
      >
        ⚠️ Mã màu/branding trong UI này là đề xuất, chưa được xác minh chính thức.
      </div>

      {/* View content */}
      <main role="main">
        {view === 'talent' && <TalentPanel isNarrow={isNarrow} />}
        {view === 'client' && <ClientPanel />}
        {view === 'intake-review' && <IntakeReviewPanel isNarrow={isNarrow} />}
        {view === 'routing' && <RoutingPanel isManager={isManager} staffId={staffId} isNarrow={isNarrow} />}
        {view === 'dashboard' && <DashboardPanel isManager={isManager} staffId={staffId} isNarrow={isNarrow} />}
        {view === 'assistant' && <AssistantPanel isManager={isManager} staffId={staffId} isNarrow={isNarrow} />}
      </main>

      {/* Keyboard shortcuts hint */}
      <footer
        style={{
          marginTop: '1rem',
          paddingTop: '0.5rem',
          borderTop: '1px solid #e5e5e5',
          fontSize: '0.75rem',
          color: '#888',
        }}
        role="contentinfo"
      >
        Phím tắt: Alt+1 Talent | Alt+2 Client | Alt+3 Intake Review | Alt+4 Routing | Alt+5 Dashboard (BoD) | Alt+6 Assistant
      </footer>

      {/* Panel resize handle (dev only) */}
      <div style={{ marginTop: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <label style={{ fontSize: '0.75rem', color: '#888' }}>Panel width:</label>
        <input
          type="range"
          min={320}
          max={960}
          value={panelWidth}
          onChange={(e) => setPanelWidth(Number(e.target.value))}
          aria-label="Panel width"
          style={{ flex: 1 }}
        />
        <span style={{ fontSize: '0.75rem', color: '#666', minWidth: 40 }}>{panelWidth}px</span>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
 * Bootstrap — mount React app.
 * ───────────────────────────────────────────────────────────────────────────── */

export function mountApp(containerId: string) {
  const el = document.getElementById(containerId);
  if (!el) throw new Error(`Container #${containerId} not found`);
  const root = createRoot(el);
  root.render(React.createElement(AppShell));
  return root;
}

// Auto-mount if loaded as module script with a container div.
if (typeof document !== 'undefined' && document.getElementById('root')) {
  void mountApp('root');
}
