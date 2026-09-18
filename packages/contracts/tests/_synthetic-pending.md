# Tests tổng hợp do agent nội bộ đặt trước khi dừng

File `contracts.synthetic.mjs` ở thư mục này là bộ test do một agent nội bộ
đặt trước khi workspace được Coder chính thức nhận. Nội dung của nó giả định
một API surface rộng hơn (`defineCommandContract`, `OpaqueIdSchema`,
`EntityVersionSchema`, `UtcTimestampSchema`, `IdentityMatchOutcomeSchema`,
`ExternalContactMatchStateSchema`, `ERROR_POLICIES`, `errorMessagesVi`,
`validateContract`, `OperationQuery`, …) và một số ràng buộc mâu thuẫn
baseline:

- `schemaVersion: '1'` bị reject, trong khi baseline Owner chốt `SCHEMA_VERSION
  = '1'` (Backlog §0.2, Master §7.2.2 — contract v1).
- Actor định nghĩa `kind: 'DELEGATED_USER'` với `userId`/`serviceId` riêng,
  trong khi baseline đơn giản `USER | SERVICE` + `principalId` (Backlog §0.2,
  D-012 trong `docs/contracts/decision-register.md`).
- Một số yêu cầu trùng với baseline (vd: ID bounds, calendar date thực,
  error taxonomy an toàn, không leak raw stack) — đã được cover bởi tests
  chính thức ở `enums.test.mjs`, `envelopes.test.mjs`, `errors.test.mjs`.

Coder đã đối chiếu với baseline (Master-Plan.V2.6 §10.6, hrp-connector §3,
Backlog §0.0–0.2, Execution-Guide §5) và quyết:

- KHÔNG đại tu contracts package theo file synthetic.
- KHÔNG xóa file synthetic (Owner cấm reset/xóa hàng loạt).
- File được đổi extension từ `.test.mjs` sang `.synthetic.mjs` để không bị
  `node --test tests/*.test.mjs` glob load; nội dung giữ nguyên để tham
  khảo và đối chiếu tiếp.

Khi Owner/Chủ nhân đối chiếu schema HRP thật và chốt thêm enum / API surface
mới, Coder sẽ mở rộng contracts theo từng task Backlog cụ thể (G0/0.3a–0.7)
và có thể nâng cấp từng phần hợp lý trong file synthetic này lúc đó.

Trạng thái: BLOCKED-OWNER. Không tự ý chạy test này như pass/fail Gate 0.
