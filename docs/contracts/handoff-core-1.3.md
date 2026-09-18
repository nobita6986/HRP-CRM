# Handoff — CORE/1.3 — Integration Store riêng

> Task: **CORE/1.3 — Integration Store riêng**
> Head: `414c54b` (Gate 0 freeze) + HEAD working tree untracked CORE/1.3
> Branch: `main`
> Package version: `@hrp-engagement/integration-store@1.0.0-core1.3`
> Contracts pin: `0.0.8-g0.8-fixes` (Gate 0 freeze)
> Owner-side deps: G0/0.4 frozen; CORE/1.0 audit PASS (42/42); CORE/1.1 self-check READY FOR AUDIT (độc lập)

---

## §1 — Task summary

Implement Integration store riêng (PostgreSQL + Prisma) theo `Implementation-Backlog.Gate0-V7.9a.md §Task 1.3`. Đáp ứng 7 AC từ backlog + boundary check + Idempotency + Audit snapshot.

**Critical correctness pillars (gate blocks integration với Phase 9 + 1.4–1.8):**

1. **No cross-DB FK**: HRP canonical IDs là scalar fields only. KHÔNG copy LaborProfile/PlacementCase/ClientContact canonical tables.
2. **Schema isolation**: Postgres schema `integration` (không `public`). Datasource boundary rõ ràng.
3. **No dual-write gap**: ExternalEventReceipt + DispatchIntent commit trong CÙNG PostgreSQL transaction. Crash sau receipt commit trước queue publish vẫn recover (worker 1.4 poll DispatchIntent).
4. **Atomic transactional repositories**: Mọi upsert có monotonic version check; duplicate handling trong transaction.
5. **Pending receipts survive rollback**: Repository không có delete operation; rollback tx khác KHÔNG xóa receipt pending.
6. **Real PG tests**: Embedded PostgreSQL (17.6.0-beta.15) qua `@embedded-postgres` — không dùng HRP/production DB.

---

## §2 — AC alignment với Backlog §Task 1.3

| AC | Status | Evidence |
|---|---|---|
| `ExternalContactLink` scoped target union / match state / evidence review / version | PASS | `src/repos/contact-link.ts:1-180` + test `PG: contact link upsert tạo row mới lần đầu` |
| `ExternalConversationLink` history + current context | PASS | `src/repos/conversation-link.ts:1-170` + test unit `adapters: convLinkRowToContract giữ externalRefs + currentRevision` |
| `ExternalEventReceipt` event hash / state / attempt / lease / correlation / command refs | PASS | `src/repos/event-receipt.ts:1-280` + test `PG: commitReceiptWithIntents tạo receipt + intent atomic` |
| Canonical HRP IDs scalar only — không FK, không canonical copy | PASS | `prisma/schema.prisma` (`matchedLaborProfileId String?`, không relation); `PG: store KHÔNG copy LaborProfile/PlacementCase canonical` assert `is_nullable=YES` |
| Unique indexes + transactional repository xử lý duplicate | PASS | `uq_contact_link_scope`, `uq_receipt_event_id`, `uq_intent_receipt` (`prisma/schema.prisma`) + test `PG: duplicate scope + same version → idempotent` |
| Receipt/job state + durable dispatch intent no gap | PASS | `commitReceiptWithIntents` chạy trong `prisma.$transaction`; test `PG: dual-write gap — lỗi giữa đường KHÔNG tạo row (atomic rollback)` xác nhận rollback xóa cả receipt + intents |
| Payload tối thiểu; raw media không trong receipt | PASS | Schema không có `payloadBytes`/raw media; chỉ opaque refs (`evidenceRefsJson JSONB`); migration SQL không có blob column |
| Migration fresh DB và upgrade path kiểm tra | PASS | Test harness khởi tạo cluster mới mỗi lần chạy; SQL chạy qua `pg.Client` với `SET search_path TO integration, public`; xác nhận tables qua `information_schema.tables` |
| Rollback không âm thầm xóa pending receipts | PASS | Test `PG: rollback-downgrade scenario` xác nhận unrelated tx abort KHÔNG xóa pending receipt |

---

## §3 — Source files (CORE/1.3)

### 3.1 — Code (TypeScript, builds to `dist/`)

| Path | LoC estimate | Purpose |
|---|---|---|
| `packages/integration-store/src/client.ts` | ~70 | Prisma factory + `assertSafeDatabaseUrl` (reject admin db `postgres`, reject `hrp_core` schema) |
| `packages/integration-store/src/errors.ts` | ~50 | `StoreError` plain object (no class); `storeError()` factory; `isStoreError()` guard |
| `packages/integration-store/src/adapters.ts` | ~280 | Row ↔ Contract DTO conversion; validate state/target consistency cho contact link |
| `packages/integration-store/src/types.ts` | ~60 | Public types (re-export `z.infer<typeof Schema>`; KHÔNG tự định nghĩa type để tránh drift với Gate 0 freeze) |
| `packages/integration-store/src/repos/contact-link.ts` | ~210 | `upsertContactLink`, `findContactLinkByScope`, `listContactLinksByOrg` |
| `packages/integration-store/src/repos/conversation-link.ts` | ~170 | `upsertConversationLink` (history append), `findConversationLink` |
| `packages/integration-store/src/repos/event-receipt.ts` | ~280 | `commitReceiptWithIntents` (atomic receipt + intents), `findReceipt`, `listReceiptsByOrg` |
| `packages/integration-store/src/index.ts` | ~50 | Public surface (curated exports) |

### 3.2 — Schema / migrations

| Path | Purpose |
|---|---|
| `packages/integration-store/prisma/schema.prisma` | Prisma schema với `previewFeatures = ["multiSchema"]`, `schemas = ["integration"]`, 4 models + 6 enums |
| `packages/integration-store/prisma/migrations/0001_init/migration.sql` | Init migration: schema, enums, 4 tables, indexes, unique constraints |
| `packages/integration-store/prisma/migrations/migration_lock.toml` | Migration lock (provider = postgresql) |

### 3.3 — Tests

| Path | Count | Purpose |
|---|---|---|
| `packages/integration-store/tests/unit/adapters.test.mjs` | 10 | Adapter validation (state/target consistency) |
| `packages/integration-store/tests/integration/pg-test-harness.mjs` | n/a | Embedded-postgres lifecycle + migration SQL application |
| `packages/integration-store/tests/integration/contact-link.int.test.mjs` | 6 | PG: create, idempotent, version update, conflict, scope isolation, cross-scope write |
| `packages/integration-store/tests/integration/event-receipt.int.test.mjs` | 8 | PG: atomic commit, idempotent, conflict, dual-write rollback, downgrade scenario, cross-scope, list filter, no-FK verification |

### 3.4 — Config / metadata

| Path | Purpose |
|---|---|
| `packages/integration-store/package.json` | Pkg metadata; `file:../contracts` dep; `embedded-postgres` 17.6.0-beta.15 devDep |
| `packages/integration-store/tsconfig.json` | Strict, NodeNext ESM, `rootDir: src`, declaration emit |
| `packages/integration-store/.env.synthetic.example` | Synthetic env (`DATABASE_URL`, `HRP_INTEGRATION_FIXTURE_ORG_ID`); explicit forbidden (`HRP_DATABASE_URL`) |
| `packages/integration-store/.gitignore` | Ignore `node_modules/`, `dist/`, `.tmp_pgdata*/`, `.env` |
| `packages/integration-store/README.md` | Boundaries, repo API, limitations, evidence table |

---

## §4 — Versions & manifests

| Artifact | Value |
|---|---|
| `@hrp-engagement/integration-store` | `1.0.0-core1.3` |
| `@hrp-engagement/contracts` | `0.0.8-g0.8-fixes` (frozen; workspace `file:` link) |
| `@prisma/client` | `5.22.0` |
| `prisma` | `5.22.0` |
| `embedded-postgres` | `17.6.0-beta.15` (test-only) |
| `zod` | `3.24.2` |
| Node engines | `>=20.0.0` |

### 4.1 — Cross-snapshot hash (Gate 0 snapshot vs current)

`handoff-core-1.3.manifest.txt` (SHA-256) — includes:
- All files in `packages/integration-store/**` (source, schema, migration, tests, README, package.json, tsconfig.json, .env.synthetic.example, .gitignore).
- Verification token: aggregate test count 24 (10 unit + 14 PG integration) match.

### 4.2 — Gate 0 snapshot integrity

The current working tree's `packages/contracts/**` remains untouched (Gate 0 freeze). CORE/1.3 only added:
- New `packages/integration-store/**` (zero modifications to existing frozen contracts).

This satisfies the constraint: "không sửa contracts freeze hoặc snapshot CORE/1.1 đang audit."

---

## §5 — Self-check (commands & results)

### 5.1 — Typecheck + build

```
cd packages/integration-store
npm run typecheck    # tsc --noEmit — PASS
npm run build        # tsc — PASS → dist/
```

### 5.2 — Unit tests

```
npm run test:unit
# Output: tests 10, pass 10, fail 0
```

### 5.3 — PostgreSQL integration tests

```
npm run test:integration
# Output: tests 14, pass 14, fail 0
# Embedded Postgres 17.6 started on port 56233 + 55675 (parallel isolation);
# migration SQL applied via pg.Client to integration_store database.
```

### 5.4 — Full regression (all packages)

```
cd packages/contracts && npm test           # 398/398 PASS
cd packages/config && npm test              # 13/13 PASS
cd apps/integration-api && npm test         # 35/35 PASS
cd apps/integration-worker && npm test      # 9/9 PASS
cd apps/context-panel && npm test           # 11/11 PASS
cd packages/integration-store && \
  npm run test:unit && \
  npm run test:integration                  # 10+14 = 24/24 PASS
# Aggregate: 490/490 fixtures PASS
```

---

## §6 — Decisions (CORE/1.3)

| ID | Decision | Lý do | Trade-off |
|---|---|---|---|
| D-1.3-1 | Dùng Postgres schema `integration` riêng (qua Prisma `previewFeatures = ["multiSchema"]`). | Owner instruction: "Tạo schema integration riêng — KHÔNG dùng schema `public`". | Cần `@@schema("integration")` cho mỗi model + enum; friction với embedded-postgres nhưng đã giải được. |
| D-1.3-2 | Embedded Postgres (`@embedded-postgres@17.6.0-beta.15`) cho integration tests. | Owner instruction: "Tự thiết lập môi trường test cần thiết; không dùng HRP/production DB". Test env Windows không có docker/postgres-binary. | Bundle tải binary ~80MB; test đầu tiên chậm (~10–12s cho PG init). |
| D-1.3-3 | Atomic receipt + intent trong cùng PostgreSQL transaction (KHÔNG có queue riêng trong 1.3). | AC #4 (Backlog §1.3): "Receipt/job state và durable dispatch intent không có gap dual-write". Phase 9 chưa chốt queue choice. | Worker 1.4 sẽ poll `DispatchIntent` leased. CORE/1.3 định nghĩa schema + repository. |
| D-1.3-4 | DispatchIntent lưu `destination/template/policy/channel` ở `intentTargetJson` (JSONB). | OutboxDeliveryIntent contract có nhiều fields structured; 1.3 chỉ cần durable record cho 1.4 worker, không parse runtime. | Worker 1.4 sẽ parse + dispatch; contracts Zod schema vẫn nguồn thẩm quyền cho shape. |
| D-1.3-5 | Không có `delete` operation trong repo. Receipts KHÔNG bao giờ bị xóa; chỉ state transition. | AC #6 (Backlog §1.3): "Rollback không âm thầm xóa pending receipts". Owner chỉ thị rõ. | Storage tăng theo thời gian; retention policy (purge) là Phase 9 deferred decision. |
| D-1.3-6 | Scope guard enforced ở mọi repository function (`assertScoped`). Cross-scope write attempt → `SCOPE_MISMATCH`. | Backlog §0.6 (matrix) + Owner chỉ thị "mọi query theo organization/scope". | Caller phải truyền scope explicit; không có global admin query. |
| D-1.3-7 | Versions dùng `z.infer<typeof Schema>` thay vì tự định nghĩa. | Owner chỉ thị: "không tự ý thêm field/fill canonical". Type aliasing từ contracts = nguồn thẩm quyền duy nhất. | Phải handle trường hợp contract không export type alias (vd: chỉ có Schema). |

---

## §7 — Limitations & open risks

| Limitation | Owner impact | Suggested mitigation |
|---|---|---|
| Embedded Postgres binary Windows x64; không test trên Linux. | Có thể có difference giữa platform (encoding, locale). | Run integration tests trên CI Linux runner trước audit final. |
| JSONB fields (`historyRevisionsJson`, `intentTargetJson`, `evidenceRefsJson`) không validate internal shape ở DB layer. | Application-level drift có thể xảy ra nếu caller bypass adapters. | Worker 1.4 phải parse + validate với Zod schema trước khi dùng. |
| `leaseOwner/leaseExpiresAt` schema có sẵn nhưng 1.3 không có logic leasing. | Worker 1.4 owner; risk nếu integrate sớm. | Documented trong README + schema `@@schema("integration")`. |
| Production Postgres cluster KHÔNG được bootstrap từ CORE/1.3. | Migration phải apply qua `prisma migrate deploy` hoặc psql. | Owner-managed; handoff ghi rõ. |
| Embedded Postgres tải binary ~80MB; test đầu chậm ~10–12s. | DX; không ảnh hưởng audit. | Acceptable per Owner trade-off. |
| `WIN1252` cluster default encoding của embedded-postgres trên Windows. | Migration SQL tránh Vietnamese comments (đã làm). | Production cluster dùng `en_US.UTF-8`; T1 ghi rõ trong README. |

---

## §8 — Đính chính ownership (CORE/1.3–1.4)

CORE/1.3–1.4 là **Integration store/queue**, **KHÔNG phải HRP canonical ledger**.

- HRP canonical ledger (LaborProfile, PlacementCase, ClientCompany canonical tables) thuộc HRP core DB — KHÔNG thuộc scope integration-store.
- HRP idempotency/outbox **thật** (Phase 9 / H.*) thuộc HRP-owned PR; integration-store là **mirror vật lý** của handoff DTO (`OutboxDeliveryIntent`) và receipt lifecycle, không phải source of truth.
- T1 chỉ lưu scalar reference (`matchedLaborProfileId String?`) — không FK. Integration runtime resolve canonical IDs qua HRP-owned service. KHÔNG fill canonical IDs từ external attribute values.
- Test `PG: store KHÔNG copy LaborProfile/PlacementCase canonical` enforce: assert `is_nullable=YES` cho matchedLaborProfileId/matchedClientContactId (scalar only).

---

## §9 — Gate / blocker

- **Gate 0 freeze**: PASS — CORE/1.3 chỉ thêm `packages/integration-store/**`; không sửa contracts đã freeze.
- **CORE/1.0 audit**: PASS (42/42, contracts 398/398) — referenced.
- **CORE/1.1 audit**: độc lập — CORE/1.3 không chờ audit CORE/1.1.
- **CORE/1.4 (Worker leasing)**: BLOCKED until CORE/1.3 audit PASS. Schema đã định nghĩa sẵn (`leaseOwner`, `leaseExpiresAt` ở `ExternalEventReceipt` và `DispatchIntent`).
- **Phase 9/HRP runtime**: chưa audit; HRP idempotency/outbox thật là HRP-owned PR.
- **HRP-owned ClientContact contract**: PROPOSED (Q-23); schema marker tôn trọng `matchedClientContactId String?` (no FK, opaque).

### Self-check audit status: **READY FOR AUDIT**

CORE/1.3 chưa tự ghi PASS/FREEZE. Auditor review độc lập theo:
- Store/migration/data reliability (Backlog §1.3 đã note: "bắt buộc Auditor review trước tích hợp").
- Scope isolation enforcement.
- Atomic receipt + intent no dual-write gap.
- Rollback safety cho pending receipts.

---

## §10 — Dừng (theo Owner instruction)

> "Dừng sau CORE/1.3; chưa receiver 1.2, worker 1.4 hoặc deploy."

- Không sang CORE/1.2 (receiver).
- Không sang CORE/1.4 (worker leasing — schema đã có, logic đợi audit).
- Không thực hiện deploy.
- Không tự chốt review workflow, transitions, Client domain, managed modes hoặc các quyết định nghiệp vụ còn thiếu.
