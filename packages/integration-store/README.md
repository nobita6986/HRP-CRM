# @hrp-engagement/integration-store

CORE/1.3 — Integration store riêng (PostgreSQL + Prisma).

**Boundaries:**
- Pin contracts `@hrp-engagement/contracts` version `0.0.8-g0.8-fixes` (Gate 0 freeze).
- Cross-DB FK: KHÔNG có. Canonical HRP IDs (LaborProfileId, ClientContactId, ConversationId, PlacementCaseId...) chỉ là scalar fields.
- KHÔNG copy canonical LaborProfile/PlacementCase tables của HRP. Integration chỉ tham chiếu opaque HRP IDs.
- Schema riêng `integration` (Postgres schema, không phải `public`). HRP core ở schema riêng khác (Owner-managed).
- Ownership: **Integration store**, KHÔNG phải HRP canonical ledger (Gate 0 freeze đã định nghĩa HRP idempotency/outbox thật thuộc P9/H.*, chưa runtime).

## Models

| Model | Purpose | G0/0.x anchor |
|---|---|---|
| `ExternalContactLink` | Link `external contact` ↔ canonical target (Talent/Client). | `mappings.ts` (0.4) |
| `ExternalConversationLink` | Link `external conversation` ↔ canonical conversation; giữ history/currentRevision. | `mappings.ts` (0.4) |
| `ExternalEventReceipt` | Webhook payload SHA-256 + state machine + lease. | `events.ts` (0.4) |
| `DispatchIntent` | Durable processing intent; ghi cùng transaction với receipt (no dual-write gap). | `outbox.ts` (0.3g) |

## Repository API

```ts
import { createPrismaClient, upsertContactLink, commitReceiptWithIntents } from '@hrp-engagement/integration-store';

const prisma = createPrismaClient({
  databaseUrl: 'postgresql://integration:synthetic@127.0.0.1:55432/integration_store?schema=integration',
});

// Upsert contact link — atomic, monotonic aggregateVersion.
const { row, created, rowVersion } = await upsertContactLink(prisma, scope, contractInput);

// Commit receipt + dispatch intents — atomic PostgreSQL transaction.
const { result, created } = await commitReceiptWithIntents(prisma, scope, {
  schemaVersion: '1',
  receipt: contractReceiptInput,
  intents: [contractIntent],
});
```

## Boundaries (enforced)

- **`assertSafeDatabaseUrl`**: Reject URLs targeting admin database `postgres` hoặc chứa `hrp_core` schema/role.
- **Scope enforcement**: Mọi repository function require `organizationId + provider + connectionId`. Cross-scope write attempt throws `SCOPE_MISMATCH`.
- **Monotonic versions**: `aggregateVersion` (contact link) + `currentRevision` (conversation link) phải tăng đơn điệu — caller's responsibility; SQL UPDATE trong repo thực thi version check.
- **No deletes on receipts**: Repository không có delete operation; receipts chỉ transition state. Pending receipts KHÔNG bị âm thầm xóa bởi rollback tx khác.

## Limitations (CORE/1.3 only)

- **Embedded Postgres**: Test harness dùng `@embedded-postgres` (`17.6.0-beta.15`) để chạy real PG cluster cho integration tests. Production Postgres cluster phải Owner-managed; schema/migration chạy qua `npx prisma migrate deploy` hoặc apply SQL trực tiếp.
- **JSON fields**: Một số fields (historyRevisions, evidenceRefs, intentTarget) dùng JSONB — không enforce schema nội tại; contracts Zod schemas ở `@hrp-engagement/contracts` enforce qua application layer.
- **Worker leasing**: `leaseOwner/leaseExpiresAt` schema có sẵn nhưng CORE/1.3 chưa có logic leasing — đó là CORE/1.4 (Durable worker/queue leasing).
- **No HRP Prisma**: Cross-DB FK intentionally absent; integration chỉ lưu scalar HRP IDs. Owner-runtime resolver mới có quyền verify canonical.

## Commands

| Command | Purpose |
|---|---|
| `npm run typecheck` | TypeScript compile check (no emit). |
| `npm run build` | Build to `dist/`. |
| `npm run test:unit` | Unit tests (10 fixtures, không cần DB). |
| `npm run test:integration` | PG integration tests (14 fixtures, embedded-postgres). |

## Files

```
src/
  client.ts          # Prisma factory + assertSafeDatabaseUrl
  errors.ts          # StoreError types (no class)
  adapters.ts        # Row ↔ Contract DTO mapping
  types.ts           # Public types (re-export Zod inferred)
  index.ts           # Public surface
  repos/
    contact-link.ts          # ExternalContactLink atomic upsert
    conversation-link.ts     # ExternalConversationLink + history append
    event-receipt.ts         # ExternalEventReceipt + DispatchIntent (atomic)
prisma/
  schema.prisma              # Prisma schema với @@schema("integration") + multiSchema
  migrations/0001_init/migration.sql
tests/
  unit/adapters.test.mjs     # 10 fixtures
  integration/               # PG integration
    pg-test-harness.mjs
    contact-link.int.test.mjs
    event-receipt.int.test.mjs
```

## Evidence (CORE/1.3)

| Suite | Pass | Total |
|---|---|---|
| contracts | 398 | 398 |
| config | 13 | 13 |
| integration-api | 35 | 35 |
| integration-worker | 9 | 9 |
| context-panel | 11 | 11 |
| integration-store unit | 10 | 10 |
| integration-store PG integration | 14 | 14 |
| **Total** | **490** | **490** |
