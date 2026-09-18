# @hrp-engagement/integration-api

CORE/1.0 + CORE/1.1 + CORE/1.2 — HTTP API app.

- **CORE/1.0**: scaffold + boundaries (mock mode, startup guard, contracts pin,
  health tách, allowlist routes).
- **CORE/1.1**: CanonicalHrpGateway deterministic mock (POST /mock/gateway/call,
  GET /mock/gateway/log). In-memory ledger; KHÔNG durable production.
- **CORE/1.2**: Webhook receiver (POST /webhooks/:organizationId/:provider/:connectionId)
  với HMAC verify, URL-path scope (NEVER body), atomic commit qua CORE/1.3
  `commitReceiptWithIntents`. HTTP 202 chỉ sau durable commit. Dedupe by
  `(org, provider, connectionId, eventId)` + `payloadDigest`. Protocol fixture
  cô lập (CHATWOOT/ZALO_OA/GENERIC).

- **Boundary**:
  - Pin exact contracts version `0.0.8-g0.8-fixes` (Gate 0 freeze).
  - Mock mode `deterministic` (default `development`), `off` ở production.
  - Không import HRP Prisma client; không đặt HRP_DATABASE_URL.
  - Receiver chỉ dùng env var `DATABASE_URL` (plain) cho CORE/1.3 store.
  - Receiver KHÔNG depend CORE/1.1 gateway mock (deliberate: 1.1 vẫn
    CHANGES_REQUIRED).
  - Receiver KHÔNG normalize / domain orchestration (deferred to CORE/1.5).

- **Health**:
  - `/health/live` — process alive.
  - `/health/ready` — config loaded + schema pinned (chưa kết nối dependency).
  - Field `receiverEnabled` cho biết receiver có đang bật.

- **CORE/1.2 Webhook Receiver endpoints**:
  - `POST /webhooks/:organizationId/:provider/:connectionId` — webhook entry.
  - 202 → durable commit OK.
  - 400 → malformed JSON / scope spoof / missing eventId / unsupported provider.
  - 401 → missing/invalid HMAC signature.
  - 409 → idempotency_conflict (same eventId, different digest).
  - 413 → payload too large.
  - 429 → rate limit exceeded.
  - 503 → DB unavailable (NO 202).

## Run

```bash
cd apps/integration-api
npm install
npm run dev  # development (CORE/1.1 mock + CORE/1.2 receiver enabled nếu DATABASE_URL set)
NODE_ENV=production npm start  # production (mock OFF bắt buộc)
```

## Synthetic env

Xem `.env.synthetic.example`. CORE/1.2 receiver cần:

- `HRP_RECEIVER_ENABLED=true` để enable route.
- `DATABASE_URL=postgres://...` (plain) cho Integration Store.
- `HRP_WEBHOOK_SECRET_<PROVIDER>_<CONNECTION>` env cho HMAC verify
  (synthetic; production = SecretRef Q-23 HRP-owned).

## Test

```bash
npm test                    # 71 tests: 35 server + 26 receiver unit + 10 receiver PG int
```
