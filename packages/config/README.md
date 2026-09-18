# @hrp-engagement/config

CORE/1.0 — shared runtime config types and loader.

- **Mục đích**: Tách `RuntimeConfig` (process-wide), `ApiConfig` (HTTP API),
  `WorkerConfig` (background worker), `PanelConfig` (UI mock). Pin exact
  contracts version đã freeze (`@hrp-engagement/contracts@0.0.8-g0.8-fixes`).
- **Không import**: HRP Prisma client. Không chứa DSN HRP core. Không có
  secret/credential thật. Không có provider/model thật.
- **Mock mode**: `HRP_MOCK_MODE=true` (default khi `NODE_ENV !== 'production'`)
  cho phép runtime gate chạy deterministic mock. Khi `NODE_ENV=production`
  mà `HRP_MOCK_MODE=true` thì **startup chặn** (lý do bảo mật).
- **Boundary**:
  - `ConfigSchema` validate tất cả env vars + cấm runtime mock ở production.
  - `assertNotProductionMock(env)` throw nếu mock ở production.
  - `loadConfig({ env, schema })` đọc env an toàn; không crash process.

## Sử dụng

```ts
import {
  loadConfig,
  assertNotProductionMock,
  type RuntimeConfig,
  type ApiConfig,
  type WorkerConfig,
  type PanelConfig,
} from '@hrp-engagement/config';

const env = process.env;
assertNotProductionMock(env); // chặn nếu production + mock
const cfg = loadConfig({ env, kind: 'api' });
```

## Synthetic env example

Xem `examples/env.synthetic.example.ts` — không commit giá trị thật.
