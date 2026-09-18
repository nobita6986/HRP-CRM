#!/usr/bin/env python3
"""Append CORE/1.3 section to docs/contracts/inventory.md (UTF-8, no BOM)."""
import pathlib
from datetime import datetime, timezone, timedelta

ROOT = pathlib.Path('.').resolve()
INVENTORY = ROOT / 'docs' / 'contracts' / 'inventory.md'

tz = timezone(timedelta(hours=7))
today = datetime.now(tz).strftime('%Y-%m-%d')

SECTION = f"""

---

## CORE/1.3 — Integration Store riêng (2026-09-14)

Task ID: **CORE/1.3** (Backlog Gate0-V7.9a §Task 1.3)
Owner: T1 (Coder) — implementation; Auditor review độc lập (data reliability).
Dependencies: G0/0.4 frozen, CORE/1.0 audit PASS (42/42). CORE/1.1 self-check READY FOR AUDIT (độc lập; không block 1.3).

### Output

- `packages/integration-store/` — package mới (zero modifications to existing contracts/configs/apps).
  - Source: src/client.ts, errors.ts, adapters.ts, types.ts, index.ts, repos/contact-link.ts, repos/conversation-link.ts, repos/event-receipt.ts.
  - Schema: prisma/schema.prisma (multiSchema + 4 models + 6 enums), prisma/migrations/0001_init/migration.sql.
  - Tests: tests/unit/adapters.test.mjs (10), tests/integration/pg-test-harness.mjs + contact-link.int.test.mjs + event-receipt.int.test.mjs (14 PG).
  - Config: package.json (pin contracts 0.0.8-g0.8-fixes), tsconfig.json, README.md, .env.synthetic.example, .gitignore.

### Boundaries

- **No cross-DB FK**: HRP canonical IDs (LaborProfileId, ClientContactId, ConversationId...) là scalar fields only. Verified bằng test `PG: store KHÔNG copy LaborProfile/PlacementCase canonical` (assert is_nullable=YES).
- **PostgreSQL schema isolation**: Schema `integration` riêng (không `public`). Sử dụng `previewFeatures = ["multiSchema"]` + `@@schema("integration")` cho models + enums.
- **Embedded Postgres tests**: `@embedded-postgres@17.6.0-beta.15` chạy real PG cluster trên Windows (cross-platform binary). KHÔNG dùng HRP/production DB.
- **Scope enforcement**: Mọi repository function require `organizationId + provider + connectionId`; cross-scope write attempt throws `SCOPE_MISMATCH`.
- **No deletes on receipts**: Repository không có delete operation; pending receipts KHÔNG bị âm thầm xóa bởi rollback tx khác (verified bằng test `PG: rollback-downgrade scenario`).

### AC alignment

- ✅ ExternalContactLink scoped target union / match state / evidence review / version
- ✅ ExternalConversationLink history + current context
- ✅ ExternalEventReceipt event hash / state / attempt / lease / correlation / command refs
- ✅ Canonical HRP IDs scalar only — không FK
- ✅ Unique indexes + transactional repository xử lý duplicate
- ✅ Receipt/job state + durable dispatch intent no gap (atomic Prisma `$transaction`)
- ✅ Payload tối thiểu; raw media không trong receipt (chỉ opaque refs JSON)
- ✅ Migration fresh DB + upgrade path (test harness init cluster mới mỗi lần)
- ✅ Rollback không âm thầm xóa pending receipts

### Evidence (commands + results)

| Suite | Pass | Total |
|---|---|---|
| packages/contracts | 398 | 398 |
| packages/config | 13 | 13 |
| apps/integration-api | 35 | 35 |
| apps/integration-worker | 9 | 9 |
| apps/context-panel | 11 | 11 |
| packages/integration-store unit | 10 | 10 |
| packages/integration-store PG integration | 14 | 14 |
| **Aggregate** | **490** | **490** |

### Đính chính ownership (CORE/1.3–1.4)

CORE/1.3–1.4 là **Integration store/queue**, **KHÔNG phải HRP canonical ledger**.

- HRP canonical ledger (LaborProfile, PlacementCase, ClientCompany canonical tables) thuộc HRP core DB — KHÔNG thuộc scope integration-store.
- HRP idempotency/outbox **thật** (Phase 9 / H.*) thuộc HRP-owned PR; integration-store là **mirror vật lý** của handoff DTO (`OutboxDeliveryIntent`) và receipt lifecycle, không phải source of truth.
- T1 chỉ lưu scalar reference (`matchedLaborProfileId String?`) — không FK. Integration runtime resolve canonical IDs qua HRP-owned service.

### Decisions (Q-44+)

- **Q-44**: CORE/1.3 dùng Postgres schema `integration` riêng + Prisma `multiSchema`. Cross-DB FK intentionally absent.
- **Q-45**: Atomic receipt + intent commit trong CÙNG PostgreSQL transaction (queue riêng deferred; Phase 9 chưa chốt queue choice).
- **Q-46**: Embedded Postgres cho integration tests (`@embedded-postgres@17.6.0-beta.15`). Production cluster Owner-managed.

### Gate / blockers

- **Gate 0 freeze**: PASS — CORE/1.3 chỉ thêm `packages/integration-store/**`; không sửa contracts đã freeze.
- **CORE/1.0 audit**: PASS (referenced).
- **CORE/1.1 audit**: độc lập — CORE/1.3 không chờ audit CORE/1.1.
- **CORE/1.4 (Worker leasing)**: BLOCKED until CORE/1.3 audit PASS. Schema có sẵn (`leaseOwner`, `leaseExpiresAt`).
- **Store/migration/data reliability**: REQUIRED audit trước tích hợp (Backlog §1.3 explicit).

### Audit status

**READY FOR AUDIT** (T1 self-check). T1 KHÔNG tự ghi PASS/FREEZE cho store/migration/data reliability. Auditor review độc lập.
"""

if not INVENTORY.exists():
    raise SystemExit(f'MISSING: {INVENTORY}')

content = INVENTORY.read_text(encoding='utf-8')
# Check no duplicate CORE/1.3
if '## CORE/1.3' in content:
    print('CORE/1.3 section already present, skip.')
    raise SystemExit(0)

INVENTORY.write_text(content + SECTION, encoding='utf-8')
print(f'Appended CORE/1.3 section to {INVENTORY}')
