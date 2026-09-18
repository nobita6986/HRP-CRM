# @hrp-engagement/integration-worker

CORE/1.0 — Background worker mock (chỉ scaffold + boundaries; chưa
durable queue, polling thật hay DB).

- **Mục đích**: Khởi tạo worker process với config tách, mock mode rõ,
  health endpoint. CORE/1.0 chưa implement queue/poll/lease.
- **Boundary**:
  - Pin exact contracts version `0.0.8-g0.8-fixes` (Gate 0 freeze).
  - Mock mode `deterministic` (default `development`), `off` ở production.
  - Không import HRP Prisma client; không đặt HRP_DATABASE_URL.
- **Health**:
  - `/health/live` — process alive.
  - `/health/ready` — config loaded + pinned contracts.

## Run

```bash
cd apps/integration-worker
npm install
npm run dev
NODE_ENV=production npm start  # production (mock OFF bắt buộc)
```

## Synthetic env

Xem `.env.synthetic.example`.
