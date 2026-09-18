# Auditor Review Report: CORE/1.8 — Retry, DLQ, Reconciliation & Outbox Handoff Mock

- **Date:** 2026-09-16
- **Verdict:** `PASS`
- **Role:** Independent Auditor
- **Snapshot / Head Reviewed:** Working tree snapshot (Base commit: `414c54b`)
- **Artifacts Inspected:**
  - `docs/contracts/handoff-core-1.8.md`
  - `docs/contracts/handoff-core-1.8.manifest.txt`
  - `docs/Importal/Implementation-Backlog.Gate0-V7.9a.md` (Task 1.8)

---

## 1. Đánh giá 5 Acceptance Criteria (AC)

| AC | Tiêu chí | Kết quả | Bằng chứng kiểm tra thực tế |
|---|---|:---:|---|
| **AC1** | Retry có giới hạn, backoff/jitter xác định, lỗi policy/validation không retry vô tận | **PASS** | `apps/integration-api/tests/retry.test.mjs` chạy thực tế trên embedded PG: **42/42 tests PASS**. Jitter ±20%, maxAttempts=8, `VALIDATION_ERROR` / `VERSION_CONFLICT` chuyển thẳng `DEAD_LETTERED`. |
| **AC2** | DLQ safe metadata/attempts, redrive scope, giữ keys, actor audit, DNC guard | **PASS** | `apps/integration-api/tests/dlq.test.mjs`: **12/12 tests PASS**. Metadata strip stack trace/PII, redrive chặn bởi `MockDncGuard`, `OUTBOX_PATCH_FORBIDDEN` được kiểm soát. |
| **AC3** | Outbound intent → durable receipt → ACK; không ACK trước commit, duplicate không trùng | **PASS** | `apps/integration-api/tests/outbox.test.mjs`: **12/12 tests PASS** trên embedded PG (0 fail, 0 cancelled, 0 skipped). Harness khởi tạo đúng isolated `pgDataDir`, test concurrency tranh chấp 1 intent xác nhận đúng 1 worker acquire lease qua `FOR UPDATE SKIP LOCKED`, không duplicate delivery. Teardown và dọn sạch temp data hoàn tất. |
| **AC4** | UNKNOWN đi qua reconciliation, không auto-delivered / không blind resend, failed không fake success | **PASS** | `apps/integration-api/tests/outbox-reconcile.test.mjs`: **15/15 tests PASS** trên embedded PG. `INVESTIGATION_PENDING` được kích hoạt, không tự nhảy `DELIVERED`. |
| **AC5** | Reconciler stuck receipt/job/mapping/result, recovery dedupe, an toàn concurrent, giữ lease/fencing | **PASS** | `apps/integration-api/tests/reconciler.test.mjs`: **20/20 tests PASS** trên embedded PG. Dedupe via unique constraint `(itemType, itemId)`, không truy vấn HRP core DB. |

---

## 2. Kiểm tra Invariants & Boundaries

- **Frozen Contracts (`packages/contracts`):** Giữ nguyên vẹn 100% so với manifest freeze (`packages/contracts/src/` khớp hoàn toàn SHA-256; 398/398 contracts tests PASS).
- **Mock Boundary Guards:** Tuyến `/mock/gateway/*`, `/mock/review/*`, `/mock/dlq/*`, `/mock/outbox/*`, `/mock/reconciler/*` trong `apps/integration-api/src/server.ts` đều có server-level guard trả về `404` khi `mockMode === 'off'`.
- **HRP Isolation:** Không có kết nối DB HRP thật, không gọi external providers/models, không bypass policy.

---

## 3. Trạng thái Blockers sau Recheck

### [BLOCKER 1] Test suite `outbox.test.mjs` (AC3) hỏng khởi tạo PG & test concurrency sai logic
- **Trạng thái:** **CLOSED** ✅
- **Xác minh thực tế:**
  1. **Harness initialization & cleanup:** Đã bổ sung `initialise()`, `start()`, `createDatabase()`, tách thư mục tạm độc lập `.tmp_pgdata_outbox_*` và `rmSync(..., { recursive: true, force: true })` sau test. Sau khi suite kết thúc: 0 thư mục tạm sót lại, không tiến trình `postgres.exe` nào bị treo.
  2. **Concurrency test setup:** Test `outbox: concurrent dispatchers for same intent → only one acquires lease (no duplicate delivery)` đã tạo đúng **1 intent** duy nhất cho 2 dispatchers cùng tranh chấp. Cơ chế `FOR UPDATE SKIP LOCKED` đảm bảo chỉ 1 dispatcher chiếm được lease (`successResults.length === 1`), `attempts === 1`, trạng thái cuối là `DELIVERED`, không nhân bản delivery.
  3. **Kết quả test:** Tự chạy `node --test tests/outbox.test.mjs` cho kết quả:
     ```text
     ℹ tests 12
     ℹ suites 3
     ℹ pass 12
     ℹ fail 0
     ℹ cancelled 0
     ℹ skipped 0
     ```

---

### [BLOCKER 2] Manifest thiếu 2 files thuộc phạm vi CORE/1.8
- **Trạng thái:** **CLOSED** ✅
- **Xác minh thực tế:**
  - `apps/integration-api/src/outbox/ac3-handler.ts` (`9EF00968F09088EFB25E01EE85F0493E8854E5B6FCF0F2B49FBA96632EBC3EEA`) và `apps/integration-api/tests/pg-reconcile-harness.mjs` (`EA4235F9D4C8046E7588DEAA9FF3500147B1CADBEF726176C26B8512BDB87C4E`) đã được bổ sung đầy đủ vào `docs/contracts/handoff-core-1.8.manifest.txt`.
  - Đối soát độc lập toàn bộ 30/30 files trong manifest: 30 MATCH, 0 MISMATCH, 0 MISSING, 0 DUPLICATE.
  - Toàn bộ source/tests ngoài delta giữ nguyên snapshot đã audit, không có code delta ngoài phạm vi.

---

## 4. Non-blocking Recommendations

- Giữ vững quy chuẩn dọn dẹp tài nguyên Embedded Postgres trên Windows (`teardownDatabase` kèm cleanup thư mục tạm) cho các suite tích hợp tiếp theo ở Gate 0.

---

## 5. Kết luận

- **Verdict Tổng hợp CORE/1.8:** `PASS`
- **Snapshot kiểm tra:** Working tree commit `414c54b` + delta CORE/1.8 (30 files đã kiểm chứng checksum).
- Tất cả 5 AC (AC1 - AC5) đều đạt yêu cầu kỹ thuật và invariants. 2 blockers đã được đóng dứt điểm.
- **Tuân thủ quy trình:** Không bước sang CORE/1.9; không commit/push/deploy; frozen contracts không bị sửa đổi.
