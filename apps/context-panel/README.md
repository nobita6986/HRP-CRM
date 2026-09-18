# @hrp-engagement/context-panel

CORE/1.9 — UI mock panel: Context Panel + Intake Review.

## Features

- **Talent/Client layout separate** — Client domain marked UNAVAILABLE.
- **Context Panel** — identity, placement case, availability, current relationship (read-only), next action, recent interactions, contactability.
- **Intake Review** — mock form, preview (read-only), confirmation checkbox (not prechecked), edit invalidates confirmation.
- **Close reason dropdown** — exactly 9 values from `CASE_CLOSE_REASONS` enum.
- **CurrentRelationship badge** — read-only, labels from contracts.
- **Error states** — loading, empty, forbidden, unresolved, stale, timeout, partial success, unavailable. All Vietnamese.
- **Keyboard navigation** — Alt+1/2/3 switches views.
- **Panel narrow mode** — adapts layout at <480px.
- **Branding note** — color tokens are proposals, not verified.

## Run

```bash
cd apps/context-panel
npm install
npm run dev
```

Open http://localhost:3000 in browser.

## Environment

- `HRP_MOCK_MODE=deterministic` (default in development) — deterministic mock data; mock endpoints available.
- `HRP_MOCK_MODE=off` — disables mock endpoints; `/api/*` returns 404 (B2 guard).
- `HRP_PANEL_SCENARIO=forbidden|stale|timeout|partial|unresolved` — simulate error states (per-context query scenarios).
- `HRP_LISTEN_HOST` (default `127.0.0.1`), `HRP_LISTEN_PORT` (default `3000`).

## Boundaries

- Synthetic data only. No real HRP calls.
- Client domain → UNAVAILABLE (contract not finalized).
- Contracts pinned to `0.0.8-g0.8-fixes`.

## Testing

```bash
npm test        # 21 tests (panel-ui.test.mjs)
npm run typecheck  # TypeScript check
npm run build      # Build dist/
```
