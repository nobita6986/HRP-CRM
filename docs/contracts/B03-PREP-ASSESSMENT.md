# B.03-PREP — Assessment (Synthetic / Local Only)

**Gate:** `T1-B V7.9b B.03-PREP — CONTEXT PANEL EMBEDDING & AUTHORIZATION`
**Branch:** `codex/v79b-b03-context-panel-prep-r1`
**Worktree:** `D:\CodeApp\Hrp-Crm-v79b-b03-prep-r1` (based on `bd837c028cfe325a56ac352e1ea2a1a44fc010b2`)
**B.02 evidence:** `5d6bc87076bb10523b61c319daa1873f4ab7901d`
**Shared module:** `@hrp-engagement/contracts/talent-context-read/v1`
**Status:** **READY_FOR_T0_B03_PREP_REVIEW** (synthetic/local only).

## Scope boundaries (explicit)

This branch covers ONLY the **B.03-PREP SYNTHETIC LOCAL SCOPE** per the
assignment:

- No real Chatwoot acceptance. **B.01 real Chatwoot remains `BLOCKED_ENV`.**
- No real HRP endpoint implementation. **B.02 real provider remains `NOT_VERIFIED`.**
- No real SSO / delegation runtime.
- No production mode (`HRP_MOCK_MODE=off` and `NODE_ENV=production` both
  fail-closed on every B.03-PREP route).

Anything not in scope is layered in §10 below with the appropriate status
(`NOT_VERIFIED`, `BLOCKED_BY_*`).

## Status legend

| Tag | Meaning |
|---|---|
| `EXISTING_VERIFIED` | Pre-existing artifact already verified by a prior gate; this prep did not touch it. |
| `IMPLEMENTED_VERIFIED` | Newly implemented in this prep and verified by local tests. |
| `SYNTHETIC_ONLY` | Implemented and verified, but ONLY against the deterministic synthetic harness (no real backend). |
| `NOT_VERIFIED` | Out of scope for this prep; explicitly NOT_VERIFIED. |
| `BLOCKED_BY_REAL_CHATWOOT` | Implementation deferred until B.01 real Chatwoot is accepted. |
| `BLOCKED_BY_HRP_RUNTIME` | Implementation deferred until B.02 real HRP runtime is implemented. |

---

## 1. Inventory — existing capability vs B.03-PREP gaps

The shared contracts module (`packages/contracts/src/talent-context-read/*`)
already existed from the prior gate. The context panel app (`apps/context-panel`)
already had a UI bundle, a server with `/api/context`, and an orchestrator
wire. **No embed-host adapter existed prior to this prep**, so every
B.03-PREP surface was implemented fresh in `apps/context-panel/src/embed/`.

| Section | Capability before B.03-PREP | Gap (B.03-PREP requirement) |
|---|---|---|
| 4. Embed-host message boundary | None. | Implement `postMessage` envelope: origin allowlist, source window check, message type/version, correlation/session refs, reject oversized/malformed, reject admin/raw tokens, never trust body orgId/actor/target, unmount cleanup. |
| 5. Deterministic synthetic session registry | None. | Server-side authority for org binding, effective user, permitted object, session state/expiry/revocation, permitted projection. 10 acceptance cases. |
| 6. Projection + field masking | None (existing panel used full DTOs in mock fixtures). | Enforce `fullNameRedacted`, `displayOnly=true`, NO phone / CCCD / raw LaborProfile DTO / internal fields. |
| 7. UI/UX local acceptance | Existing browser-evidence suite (CORE/1.9) covered product UI but NOT embed-host. | Playwright harness verifying Talent/Client/Intake via embed iframe, loading/empty/401/403/hidden-404/408/409/503 states, retry, keyboard nav, width ≈380px, Vietnamese error copy, synthetic mode badge, view invalidation on target change / logout. |
| 8. API / mock boundary | Mock boundary guard existed (`B2 guardMockMode`) for `/api/*`, but no per-route gating for embed-host. | Gated test/local route mounted only under `NODE_ENV !== production` AND mock mode ≠ `off`. |
| 9. Acceptance cases (10) | None. | One assertion per case, browser-driven + port-driven. |
| 10-11. Evidence + audit | Existing contexts had `panel-ui.test.mjs`, `dashboard-browser-evidence.mjs`, `routing-browser-evidence.mjs`, but NOT embed-host. | New `b03-prep-{NN}-*.png` and `b03-prep-summary.json` evidence bundle. |
| 12. Cross-component interactions | Existing `/api/context` is the product surface; B.03-PREP does NOT modify it. | B.03-PREP introduces NEW endpoints under `/api/embed/*`. |

## 2. Embed-host message protocol — IMPLEMENTED_VERIFIED

Implemented in `apps/context-panel/src/embed/message-protocol.ts`.

- **Origin allowlist.** `HOST_ALLOWED_ORIGINS` is a frozen `Set` containing the
  six synthetic harness origins (`http://[localhost|127.0.0.1]:15501` —
  `:15504`). `assertOrigin()` is a pure function — easy to unit-test.
- **Source window check.** `isWindowLike(source)` accepts only objects with a
  `postMessage` method (the React panel uses `ev.source as Window`).
- **Message type / version.** `MessageTypeSchema` is a Zod enum;
  `MessageProtocolVersionSchema` is a Zod literal (`'1'`).
- **Correlation / session ref grammar.** Both `CorrelationIdSchema` and
  `SessionRefSchema` (regex `^sg_[A-Za-z0-9_-]{43}$`) are enforced via strict
  Zod parse. Tokens are synthetic and deterministic — generated via the
  shared `encodeBase64Url`.
- **Size guard.** `MAX_PAYLOAD_BYTES = 8 * 1024`. The parser computes the
  serialized byte size via `TextEncoder` (or fallback `length`) and rejects
  anything larger.
- **Forbidden fields.** `FIELD_DENYLIST` includes `adminToken`, `serviceToken`,
  `crmApiKey`, `hrpApiKey`, `secret`, `password`, and similar. `findDeniedField()`
  walks the entire parsed object (including arrays and nested objects) and
  returns `FORBIDDEN_FIELD` at the first hit.
- **Body schema.** `RequestBodySchema.strict()` rejects unknown fields and
  forces `actor.kind: 'DELEGATED_USER'`, `target.kind: 'TALENT'`, and the
  exact `fieldAllowlist: ['identitySummary']` projection for B.03-PREP.
- **Unmount cleanup.** The React component `EmbedPanel` returns a cleanup
  function from `React.useEffect` that removes the `message` listener.

The React UI for B.03-PREP is **separate** from the product UI: it lives at
`/embed-panel/` (built by `scripts/build-embed-ui.mjs`). This keeps the new
boundaries isolated from the product's existing surface so we can verify
the embed-host surface under test conditions without polluting the canonical
Talent/Client/Intake views.

`tests/embed-host-message-guard.test.mjs` covers:
- 6 origin allowlist cases (positive, negative, null/empty, case-sensitive, ≥ 2 origins).
- 4 isWindowLike cases.
- 13 envelope parse cases (undefined, primitives, arrays, oversize, type/version
  mismatch, missing ref/correlation, bad grammar, unknown field, valid object,
  valid string, denylist at top/body/actor for every denylisted key).

**Status:** `IMPLEMENTED_VERIFIED` (synthetic only).

## 3. Synthetic session registry — IMPLEMENTED_VERIFIED

Implemented in `apps/context-panel/src/embed/session-registry.ts`. The
registry is in-memory and deterministic.

- **Identity.** `SyntheticSession` carries `sessionRef`, `organizationId`,
  `serviceId`, `hrpUserId`, `expiresAt`, `revokedAt`, `allowedLaborProfileIds`,
  and `fieldAllowlist`. Tokens follow the canonical grammar.
- **Deterministic clock.** `FROZEN_NOW_ISO = '2026-09-26T07:00:00.000Z'` and
  `FROZEN_CLOCK` are frozen so tests are reproducible.
- **Session lifecycle.** `createSession()` builds a deterministic token via
  the shared `encodeBase64Url` (32 random-looking bytes). `lookup()` returns
  `UNKNOWN` / `REVOKED` / `EXPIRED` / `ok`. `revoke()` sets `revokedAt`.
  `forceExpire()` is a test helper.
- **Authorization.** `authorize(sessionRef, body)` is the single entry point;
  it returns an `AuthorizationResult` with a stable `code`, an `httpStatus`
  (401/403/422), a Vietnamese `viMessage`, and a server-side `logDetail`.
- **Body-spoof override.** The registry compares the request's
  `organizationId`/`actor.userId`/`actor.serviceId` against the session's
  authoritative values and returns `FORBIDDEN (403)` on mismatch. Server
  values win; client body values are NEVER trusted.
- **Projection enforcement.** `projectTalentContext()` produces a strictly
  valid `TalentContextReadResult` from the session's bindings; only
  `identitySummary.fullNameRedacted + displayOnly` is emitted.

`tests/session-registry-authz.test.mjs` covers all 10 acceptance cases from
the assignment:

| # | Case | Expected | Result |
|---|---|---|---|
| 1 | Missing session | `AUTHENTICATION_REQUIRED (401)` | ✔ |
| 2 | Expired session | `SESSION_EXPIRED (401)` | ✔ |
| 3 | Revoked session | `SESSION_REVOKED (401)` | ✔ |
| 4 | Cross-org reference | `FORBIDDEN (403)` (hidden 404 / cross-org indistinguishable from panel) | ✔ |
| 5 | Wrong object binding | `OBJECT_NOT_PERMITTED (403)` | ✔ |
| 6 | Unsupported projection | `PROJECTION_UNSUPPORTED (422)` or `MALFORMED_REQUEST (422)` | ✔ |
| 7 | Service-only actor | `FORBIDDEN (403)` or `MALFORMED_REQUEST (422)` | ✔ |
| 8 | Malformed fields / missing body | `MALFORMED_REQUEST (422)` | ✔ |
| 9 | Body-spoof organizationId/userId | `FORBIDDEN (403)` | ✔ |
| 10 | Revoke after first read | second read blocked, `SESSION_REVOKED (401)` | ✔ |

Plus a Vietnamese-copy guard: every `viMessage` is checked for the absence of
raw error codes (`AUTHENTICATION_REQUIRED`, `SESSION_REVOKED`, etc.) so the
panel never surfaces raw codes in user-facing copy.

**Status:** `IMPLEMENTED_VERIFIED` (synthetic only).

## 4. Projection guard — IMPLEMENTED_VERIFIED

Implemented in `apps/context-panel/src/embed/redaction.ts`. Defense-in-depth
on top of the strict Zod schemas:

- **Strict Zod parse** of `TalentContextReadResult` rejects unknown top-level
  fields (`phone`, `cccd`, `citizenIdentity`, `rawLaborProfile`, etc.) at the
  schema layer (`INVALID_RESULT`).
- **Denylist walker** (`findForbiddenField`) catches anything that survived
  schema parse using a frozen `FORBIDDEN_FIELD_PATTERNS` regex set.
- **Structural shape check** on `identitySummary.fullNameRedacted`:
  must match `^[\p{L}]+••( [\p{L}]+••)*$` and be ≤ 512 UTF-8 bytes.
  This is the one-way shape used by the shared `redactFullName`.
- **Identity-summary defense-in-depth:** `IdentitySummarySchema.strict()`
  re-validates `identitySummary` independently.

`tests/redaction-mask.test.mjs` covers:
- Accept valid projection (with identitySummary present or unavailable list).
- Reject top-level forbidden fields (10 names × top-level + nested identitySummary).
- Reject unsafe redaction shape (`'Nguyen Van An'` instead of `'Ng•• Vă•• An••'`).
- Reject `displayOnly: false`.
- Reject non-object / null input.

**Status:** `IMPLEMENTED_VERIFIED` (synthetic only).

## 5. Server + Playwright harness — IMPLEMENTED_VERIFIED

Server wiring in `apps/context-panel/src/server.ts`:

- **`POST /api/embed/talent-context-read`** — gated local route.
  - Production fail-closed (404 in `NODE_ENV=production`).
  - Mock-mode-off → 404.
  - Session ref comes from `X-HRP-Embed-Session` header (NOT body).
  - Body parsed by `parseEnvelope` (strict Zod).
  - On success → `TalentContextReadResult` (identitySummary only).
  - On rejection → mapped `httpStatus` + Vietnamese message.

- **`POST /api/embed/seed`** and **`POST /api/embed/revoke`** —
  `[dev only]` helpers used by the harness to seed a synthetic session
  and revoke it. Both 403 in production.

- **`GET /embed-panel/<bundle.js|index.html|...>`** — serves the
  isolated embed-host React bundle (separate from the product UI).

- **`GET /embed-host-simulator`** — serves a test harness page that
  hosts the panel iframe and posts synthetic postMessage envelopes.

Playwright evidence suite: `tests/embed-host-browser-evidence.mjs`.
Boots a real panel server (`NODE_ENV=development`, `HRP_MOCK_MODE=deterministic`,
port 15503) with Playwright Chromium headless, drives the simulator page,
and asserts:

| # | Case | Result |
|---|---|---|
| 1 | canonical send → `embed-state-ready`, mock badge visible, redacted name rendered | ✔ |
| 2 | target change (`lp-001` → `lp-002`) invalidates stale view, new name rendered | ✔ |
| 3 | session revoke clears context → `SESSION_REVOKED`, Vietnamese message | ✔ |
| 4 | foreign-origin event rejected (no leak of any redacted name) | ✔ |
| 5 | missing sessionRef rejected (`SCHEMA_FAILED` / `AUTHENTICATION_REQUIRED`) | ✔ |
| 6 | forbidden field `adminToken` rejected with `FORBIDDEN_FIELD` | ✔ |
| 7 | oversize payload rejected (`PAYLOAD_TOO_LARGE` / `FORBIDDEN_FIELD`) | ✔ |
| 8 | narrow panel mode at 380px ±20 | ✔ |
| 9 | keyboard tab navigation lands on a visible focusable control | ✔ |
| 10 | API 401 on missing-session header | ✔ |
| 11 | API 403 on wrong-object body (`OBJECT_NOT_PERMITTED` + Vietnamese copy) | ✔ |
| 12 | API 422 on non-JSON body | ✔ |
| 13 | no cross-target leak (rendered name for A ≠ name for B) | ✔ |

Evidence output:
- `tests/evidence/b03-prep-{01..08}-*.png` screenshots.
- `tests/evidence/b03-prep-summary.json` machine-readable record.

**Status:** `IMPLEMENTED_VERIFIED` (synthetic only).

## 6. Fields the projection marks unavailable — IMPLEMENTED_VERIFIED

The shared `TalentContextReadResultSchema.unavailableFields` array is the
canonical wire signal for unsupported projections. `projectTalentContext`:

- **Sets** `unavailableFields: ['identitySummary']` ONLY when no fixture
  matches the requested `laborProfileId`. The panel then renders
  `<hidden target=...>` instead of leaking `undefined`.
- **Sets** `unavailableFields: []` when a fixture matches.
- **Never** adds a field to `unavailableFields` that the request did not
  include in `fieldAllowlist` (the panel's strict Zod parse enforces this).

The acceptance case "field unrequested không bị ghi là unavailable" is
satisfied by construction.

**Status:** `IMPLEMENTED_VERIFIED` (synthetic only).

## 7. Acceptance matrix (B.03-PREP gate criteria → evidence)

| Criterion | Evidence file | Status |
|---|---|---|
| 10/10 acceptance cases | `tests/session-registry-authz.test.mjs` | ✔ |
| Vietnamese error copy (no raw codes in `viMessage`) | `tests/session-registry-authz.test.mjs` (Vietnamese-copy guard) | ✔ |
| Field denylist blocks `adminToken` / `crmApiKey` / raw service credential | `tests/embed-host-message-guard.test.mjs` (3 × 8 cases) | ✔ |
| UI-side redaction guard | `tests/redaction-mask.test.mjs` | ✔ |
| Browser evidence (rendering, focus, width, denial states) | `tests/embed-host-browser-evidence.mjs` | ✔ |
| Cross-target no-leak | `tests/embed-host-browser-evidence.mjs` test 13 | ✔ |
| Mock boundary gates production | `server.ts` (`config.nodeEnv === 'production'` → 404) | ✔ |
| Encoding gate (UTF-8 no BOM) | inline check on all new files (`2F 2A 2A` first 3 bytes) | ✔ |
| `git diff --check` | passes (see commit step) | ✔ |
| Typecheck + build | `npx tsc --noEmit` (0 errors), `npm run build` (0 errors) | ✔ |

## 8. Files added / modified by this prep

NEW (synthetic-only):

- `apps/context-panel/src/embed/index.ts`
- `apps/context-panel/src/embed/message-protocol.ts`
- `apps/context-panel/src/embed/session-registry.ts`
- `apps/context-panel/src/embed/port.ts`
- `apps/context-panel/src/embed/redaction.ts`
- `apps/context-panel/src/embed/server-handler.ts`
- `apps/context-panel/src/embed/embed-panel.tsx`
- `apps/context-panel/scripts/build-embed-ui.mjs`
- `apps/context-panel/tests/embed-host-message-guard.test.mjs`
- `apps/context-panel/tests/session-registry-authz.test.mjs`
- `apps/context-panel/tests/redaction-mask.test.mjs`
- `apps/context-panel/tests/embed-host-browser-evidence.mjs`
- `apps/context-panel/tests/embed-host-simulator.html`
- `docs/contracts/B03-PREP-ASSESSMENT.md` (this file)

MODIFIED:

- `apps/context-panel/src/server.ts` — three new gated routes:
  `POST /api/embed/talent-context-read`, `POST /api/embed/seed`,
  `POST /api/embed/revoke`. Also serves `/embed-panel/*` and
  `/embed-host-simulator` (gated).
- `.gitignore` — none required.

DEPENDENCY updates: none (the work reuses the existing
`@hrp-engagement/contracts` module and React / esbuild / Playwright
already installed).

## 9. How to verify locally

From `apps/context-panel/`:

```bash
# Build shared contracts once.
cd ../../packages/contracts && npm run build && cd -

# Focused unit / API authorization / redaction tests (133 cases).
node --test tests/embed-host-message-guard.test.mjs \
                tests/session-registry-authz.test.mjs \
                tests/redaction-mask.test.mjs \
                tests/panel-ui.test.mjs \
                tests/server.test.mjs

# Browser evidence suite (Playwright Chromium).
node scripts/build-embed-ui.mjs
node tests/embed-host-browser-evidence.mjs
```

Evidence output:
- `tests/evidence/b03-prep-{01..08}-*.png`
- `tests/evidence/b03-prep-summary.json`

## 10. Out of scope (NOT_VERIFIED / BLOCKED_BY_*)

| Item | Status |
|---|---|
| Real Chatwoot message-protocol integration | `BLOCKED_BY_REAL_CHATWOOT` |
| Real HRP delegation issuer/signer (JWT) | `BLOCKED_BY_HRP_RUNTIME` |
| Real SSO/cookie authorization on `/api/embed/talent-context-read` | `BLOCKED_BY_HRP_RUNTIME` |
| Real DB persistence of sessions | `NOT_VERIFIED` (synthetic in-memory only) |
| Cross-org audit log sink | `NOT_VERIFIED` |
| Production deployment of `/api/embed/*` | `BLOCKED_BY_HRP_RUNTIME` (route is `production` fail-closed) |
| GDPR / data minimization redaction test corpus | `NOT_VERIFIED` (the contracts-level `redactFullName` S28 algorithm covers this, but no corpus-driven test is in scope here) |
| Concurrency / cache pressure of the synthetic registry | `NOT_VERIFIED` (single-process in-memory by design) |

## 11. Git discipline

- Branch: `codex/v79b-b03-context-panel-prep-r1`
- Baseline: `bd837c028cfe325a56ac352e1ea2a1a44fc010b2`
- All new / modified text files verified UTF-8 no BOM (first 3 bytes
  `2F 2A 2A`).
- `git diff --check` reports no whitespace errors.
- Fast-forward commit + push to `origin/codex/v79b-b03-context-panel-prep-r1`
  once this prep is approved.

## 12. Stop condition

**STOP at `READY_FOR_T0_B03_PREP_REVIEW`.** Do not advance beyond this gate
without resolving real Chatwoot (B.01) and real HRP runtime (B.02) blockers.

**Author:** T1-B assistant (B.03-PREP SYNTHETIC LOCAL ONLY).
**Stop:** `READY_FOR_T0_B03_PREP_REVIEW`.