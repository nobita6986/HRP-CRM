# Auditor Review Report: CORE/1.9 — Context Panel + Intake Review Mock UI

- **Date:** 2026-09-16
- **Verdict:** `CHANGES_REQUIRED`
- **Role:** Independent Auditor (Recheck sau fix bundle của T1 theo Execution Guide §5.3)
- **Snapshot / Head Reviewed:** Working tree snapshot (Base commit: `414c54b`)
- **Artifacts Inspected:**
  - `docs/contracts/handoff-core-1.9.md`
  - `docs/contracts/handoff-core-1.9.status.md`
  - `docs/contracts/handoff-core-1.9.manifest.txt`
  - `apps/context-panel/src/.source-link.json`
  - `apps/context-panel/src/orchestrator-wire.ts`
  - `apps/context-panel/src/server.ts`
  - `apps/context-panel/src/ui/components/intake-review.tsx`
  - `apps/context-panel/src/ui/mock-api.ts`
  - `apps/context-panel/tests/security-evidence.mjs`
  - `apps/context-panel/tests/browser-evidence.mjs`
- **Frozen Contracts Status:** `packages/contracts/src/` giữ nguyên vẹn 100% (398/398 contracts tests PASS).

---

## 1. Bảng Đánh giá Trạng thái B1–B5 & Rủi ro Kỹ thuật

| Mục | Nội dung kiểm tra | Kết quả Recheck | Đánh giá chi tiết / Bằng chứng thực tế |
|---|---|:---:|---|
| **B1** | Snapshot binding (actor/scope/revision/digest/target/version), chống drift & bypass | **PARTIAL / BLOCKED Ở UI** | **Server:** `ReviewSnapshot` và `handleRun` đã bind đầy đủ và chặn thành công direct API bypass (4/4 kịch bản security tests PASS).<br>**UI Bug (Mới phát sinh):** `intake-review.tsx` làm lệch `revisionId` giữa preview và submit (`rev-${Date.now()}` vs `rev-preview-${snapshotId}`), khiến mọi lượt nộp qua giao diện đều bị server từ chối với **HTTP 400 MISSING_REVIEW**. |
| **B2** | Mock boundary: tất cả `/api/*` bị chặn khi `mockMode === 'off'` | **PASS** ✅ | `server.ts` đã thêm `guardMockMode`. Khi chạy `mockMode: 'off'`, toàn bộ `/api/*` (gồm cả `/api/intake/dnc`) đều trả về **HTTP 404 `mock_disabled`**. Static UI và health check vẫn hoạt động bình thường. |
| **B3** | Authorization/Actor/Scope enforce phía server; DNC actor từ MockIdentity | **PASS** ✅ | Server đã có `extractIdentity` bắt buộc `X-HRP-Staff-Id` (thiếu → 401). Phân quyền theo role trên server. Tuyến `/api/intake/dnc` bắt buộc actor khớp với `identity.actor`, chặn giả mạo actor qua request body (403 `CROSS_ACTOR`). |
| **B4** | Replay & partial→resume an toàn; single session store; call-log evidence | **PASS** ✅ | Đã loại bỏ `handle.reset()` trong `finally`; chuyển sang `ServerSession` singleton. Sử dụng `createMockPrismaClient` từ `@hrp-engagement/integration-store`. Replay cùng revision/digest trả về kết quả idempotent, không duplicate mutation; partial resume cache-hit idempotency keys. |
| **B5** | Manifest bao phủ toàn bộ delta | **CHANGES_REQUIRED** | Đã có `handoff-core-1.9.manifest.txt` với 38 file khớp SHA-256, nhưng **bỏ sót** các file mới phát sinh: `apps/context-panel/src/.source-link.json`, `scripts/generate-source-link.mjs`, `scripts/generate-manifest.mjs`, và `handoff-core-1.9.status.md`. |
| **Reuse/Wiring** | Cơ chế `.source-link.json` & wiring CORE/1.7 | **CHANGES_REQUIRED** | 1. `.source-link.json` thực chất là cơ chế kiểm tra hash của bản copy đồng bộ (**synchronized copy**), runtime vẫn chạy bản copy nội bộ chứ **chưa dùng shared module**.<br>2. **Chưa có wiring với CORE/1.7**: Panel thay thế hoàn toàn review service của CORE/1.7 bằng `ReviewSnapshot` in-memory cục bộ, trái với định hướng kiến trúc của Owner. |
| **Browser** | Kiểm chứng luồng UI thực tế trên bundle hiện tại | **FAILED** | Chạy thực tế `node tests/browser-evidence.mjs` trên live server: **10/24 tests FAILED (14/24 PASS)**. Submit form bị HTTP 400; các test direct API trong suite bị HTTP 401 do chưa cập nhật header `X-HRP-Staff-Id`. |

---

## 2. Chi tiết các Vấn đề Tồn tại (Blockers cho lần Recheck này)

### [BLOCKER 1] Lỗi lệch `revisionId` tại UI `intake-review.tsx` gây lỗi HTTP 400 MISSING_REVIEW khi Submit
- **Vị trí:** `apps/context-panel/src/ui/components/intake-review.tsx:115, 153-155`
- **Evidence:**
  - Khi người dùng bấm "Xem trước" (Preview):
    ```typescript
    // Dòng 115
    const revisionId = `rev-${Date.now()}`;
    const result = await previewIntake({ organizationId: DEFAULT_ORG_ID, intakeRevisionId: revisionId, ... });
    ```
    Server lưu snapshot vào `serverSession` với key `${DEFAULT_ORG_ID}:${revisionId}` (ví dụ: `org-001:rev-172648...`).
  - Khi người dùng tích xác nhận và bấm "Nộp hồ sơ" (Submit):
    ```typescript
    // Dòng 153-155
    const revisionId = state.kind === 'preview-success'
      ? `rev-preview-${snapshotId}`
      : `rev-${Date.now()}`;
    const result = await runIntake({ organizationId: DEFAULT_ORG_ID, intakeRevisionId: revisionId, ... });
    ```
    Hàm `handleSubmit` tự sinh một `revisionId` hoàn toàn mới (`rev-preview-snap-...`) thay vì dùng lại `revisionId` đã preview.
  - Server tìm snapshot theo `req.intakeRevisionId`, không tìm thấy snapshot tương ứng và lập tức ném lỗi:
    ```json
    {
      "errorCode": "MISSING_REVIEW",
      "httpStatus": 400,
      "message": "Bạn cần xem trước hồ sơ trước khi nộp. Vui lòng gọi preview trước."
    }
    ```
- **Hậu quả:** Toàn bộ flow nộp hồ sơ từ giao diện người dùng bị tê liệt. Người dùng preview và confirm hợp lệ nhưng khi submit luôn bị lỗi 400.
- **Sửa tối thiểu:** Trong `intake-review.tsx`, lưu `revisionId` vào React state khi preview thành công và truyền đúng `revisionId` đó vào `runIntake` khi submit.

---

### [BLOCKER 2] Browser Test Suite (`browser-evidence.mjs`) bị regression, 10/24 tests thất bại
- **Vị trí:** `apps/context-panel/tests/browser-evidence.mjs`
- **Evidence:**
  - Khởi động server với `HRP_MOCK_MODE=deterministic` và chạy `node tests/browser-evidence.mjs`:
    ```text
    ✔ page loads, React AppShell mounts
    ✔ Talent panel renders header
    ✔ Talent context-panel renders
    ✔ CurrentRelationship section visible (read-only)
    ✔ PlacementCase section visible
    ✔ Availability section visible
    ✔ Client panel shows UNAVAILABLE
    ✔ Intake Review panel visible
    ✔ Preview returns candidates
    ✔ Confirmation checkbox NOT prechecked
    ✔ Submit disabled without confirmation
    ✔ Submit enabled after confirmation
    [browser err] Failed to load resource: the server responded with a status of 400 (Bad Request)
    ✖ Intake submit returns mock service result (partial or success)
    ✖ Edit after confirm shows invalidation warning
    ✖ Submit disabled after edit invalidates confirmation
    ✔ Narrow panel (380px) renders Talent
    ✔ Narrow panel (380px) renders Intake Review
    ✖ API: forbidden scenario returns 403
    ✖ API: stale scenario returns 409
    ✖ API: timeout scenario returns 408
    ✖ API: partial scenario returns 200 with unavailableFields
    ✖ API: partial scenario body has unavailableFields
    ✖ API: client target returns 503 UNAVAILABLE
    ✖ Preview returns candidates without mutation

    — Browser verification summary: 14/24 passed.
    ```
  - **Nguyên nhân kép:**
    1. Lỗi Blocker 1 ở trên khiến flow submit trong browser văng HTTP 400.
    2. Các assertion gọi direct API trong `browser-evidence.mjs` (dòng 182, 188, 194, 200, 214, 222) không gửi header `X-HRP-Staff-Id`, dẫn đến bị server chặn với HTTP 401 thay vì trả về các mã lỗi nghiệp vụ mong đợi (403, 409, 408, 503, 200).
- **Hậu quả:** Báo cáo handoff khẳng định "24/24 pass" là dựa trên evidence cũ trước khi fix B1–B3; trên mã nguồn thực tế hiện tại, suite bị regression nặng.
- **Sửa tối thiểu:** Sửa Blocker 1 tại UI và cập nhật `browser-evidence.mjs` để gửi đúng header danh tính cho các cuộc gọi direct API, sau đó chạy lại để đạt 24/24 PASS thật.

---

### [BLOCKER 3] Cơ chế Reuse chỉ là Bản copy Đồng bộ; Thiếu Wiring CORE/1.7 Review Service
- **Vị trí:** `apps/context-panel/src/.source-link.json`, `apps/context-panel/src/orchestrator/`, `apps/context-panel/src/gateway/`
- **Evidence:**
  1. **Bản chất `.source-link.json`:** Đây chỉ là file dữ liệu ghi lại mã hash SHA-256 của 10 file nguồn giữa `integration-api` và `context-panel`, kèm script kiểm tra drift `security-evidence.mjs:608`. Về mặt runtime, `apps/context-panel` vẫn import và thực thi **bản copy mã nguồn nội bộ**, hoàn toàn chưa phải là dùng chung module (shared package) như định hướng kiến trúc loại bỏ code phân kỳ.
  2. **Thay thế Review Service bằng In-memory Snapshot:** CORE/1.7 đã cung cấp ranh giới Review Service (`/mock/review/*`). Tuy nhiên `context-panel` không hề thực hiện cuộc gọi nào đến CORE/1.7 mà tự triển khai toàn bộ vòng đời review/confirm qua `ReviewSnapshot` in-memory.
- **Hậu quả:** Vi phạm yêu cầu của Owner: "không thay review service bằng confirmation snapshot; loại bỏ copy phân kỳ".
- **Sửa tối thiểu:** Làm rõ trong tài liệu handoff ranh giới này là giải pháp mock trung gian cho Gate 0 (nếu Owner cho phép châm chước vì lý do in-process standalone), hoặc refactor sang package dùng chung nếu Owner kiên quyết loại bỏ hoàn toàn bản copy.

---

### [BLOCKER 4] Manifest thiếu các file mới phát sinh trong quá trình fix
- **Vị trí:** `docs/contracts/handoff-core-1.9.manifest.txt`
- **Evidence:** Đối soát thư mục `apps/context-panel` và `docs/contracts` phát hiện các file sau đã được tạo ra và tham gia test nhưng vắng mặt trong manifest:
  - `apps/context-panel/src/.source-link.json`
  - `apps/context-panel/scripts/generate-source-link.mjs`
  - `apps/context-panel/scripts/generate-manifest.mjs`
  - `docs/contracts/handoff-core-1.9.status.md`
- **Hậu quả:** Vi phạm quy tắc bao phủ toàn bộ delta của manifest (§5.3).
- **Sửa tối thiểu:** Chạy lại `generate-manifest.mjs` để bổ sung các file trên vào `handoff-core-1.9.manifest.txt`.

---

## 3. Tổng kết & Trạng thái

- **Verdict Tổng hợp CORE/1.9:** **`CHANGES_REQUIRED`**
- **Tiến độ:** Các blockers an ninh cốt lõi (B2 mock boundary, B3 server-side auth, B4 session replay) đã được sửa tốt ở tầng server. Tuy nhiên, thay đổi ở B1/B3 đã gây **regression ở tầng UI và browser test suite** (10/24 test hỏng), kèm thiếu sót manifest và ranh giới reuse/wiring.
- Yêu cầu T1 khắc phục triệt để các tồn tại trên trước khi yêu cầu recheck tiếp theo.
- Giữ nguyên ranh giới: Không commit, không push, không merge, không deploy, không mở rộng sang CORE/1.10+.
