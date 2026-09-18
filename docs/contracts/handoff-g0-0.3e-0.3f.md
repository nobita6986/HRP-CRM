# G0/0.3e–0.3f — Handoff bundle

**T1 (Coder)**: 2026-09-13 (rev 1, sau G0/0.3c–0.3d handoff rev 2). Workspace
`D:\CodeApp\Hrp-Crm`, branch `main`, chưa có commit. Bundle ổn định bằng
working tree.

## Trạng thái thực tế

- Tiếp theo G0/0.3c–0.3d (đã đóng + rev 2 AC đối chiếu + manifest tách
  file).
- Repo chỉ có 6 tài liệu `docs/Importal/*` + skeleton `packages/contracts/`.
- Không có HRP core checkout, schema Prisma, auth/thật → contracts runtime
  gate không xác minh được.

## Trạng thái self-check vs audit

- **Self-check**: PASS — **200/200 fixtures PASS** + typecheck strict PASS.
- **Test runtime thực**: `duration_ms ≈ 348ms` (Node built-in test
  runner, `node --test tests/*.test.mjs`).
- **Independent audit**: **PENDING**. Shared mutation/review contracts
  (matching outcome, intake submission, staff review confirmation,
  profile patch, placement case patch, interaction timestamps,
  availability mutation, suppression commit, NextAction transition,
  planning batch) thuộc diện audit bắt buộc theo Owner chỉ thị +
  Execution Guide §5.3; chưa có independent audit PASS. Coder đã rà đối
  chiếu baseline (Master V2.6 + connector v1.0 + Backlog Gate0) và hợp
  nhất phần hợp lệ từ `contracts.synthetic.mjs`; không tự công nhận
  DONE tuyệt đối.
- Audit gate sẽ gom cùng Gate 0 bundle trước freeze.

## Changed files (G0/0.3e–0.3f delta)

**Source — 4 file mới:**
```
packages/contracts/src/commands/availability.ts        (mới — G0/0.3e)
packages/contracts/src/commands/suppression.ts         (mới — G0/0.3e)
packages/contracts/src/commands/next-action.ts         (mới — G0/0.3f)
packages/contracts/src/commands/scheduling.ts          (mới — G0/0.3f)
```

**Tests — 4 file mới:**
```
packages/contracts/tests/availability.test.mjs         (13 fixtures)
packages/contracts/tests/suppression.test.mjs          (17 fixtures)
packages/contracts/tests/next-action.test.mjs          (16 fixtures)
packages/contracts/tests/scheduling.test.mjs           (11 fixtures)
```

**Index / docs / manifest:**
```
packages/contracts/src/index.ts                        (re-export 4 commands mới; bump PACKAGE_VERSION → 0.0.3-g0.3e)
docs/contracts/inventory.md                            (append §Update 2026-09-13 10:48 — G0/0.3e–0.3f)
docs/contracts/decision-register.md                    (append Q-25..Q-28 — G0/0.3e–0.3f confirmed baselines)
docs/contracts/handoff-g0-0.3e-0.3f.md                 (file này)
docs/contracts/handoff-g0-0.3e-0.3f.manifest.txt        (mới — hash manifest tách file)
```

**Sum delta**: +4 source, +4 tests, +1 manifest. Tổng bundle G0/0.3a–0.3f:
- 14 source TS (`index.ts` + `enums.ts` + `primitives.ts` + `errors.ts`
  + `envelopes.ts` + 9 commands).
- 13 test `.mjs` (3 legacy `.legacy.mjs` + 10 baseline-aligned).

## Hash manifest

Manifest SHA-256 tách sang `docs/contracts/handoff-g0-0.3e-0.3f.manifest.txt`
để tránh tự ghi hash của chính file chứa manifest (cùng pattern với
handoff rev 2 G0/0.3c–0.3d). Xem file đó cho đầy đủ 52 file path +
SHA-256 (10 source + 5 dist + 12 docs + 13 test).

**Bundle scope mới (G0/0.3e–0.3f)** — 8 file:
- 4 source mới: `commands/availability.ts`, `commands/suppression.ts`,
  `commands/next-action.ts`, `commands/scheduling.ts`.
- 4 test mới: `availability.test.mjs`, `suppression.test.mjs`,
  `next-action.test.mjs`, `scheduling.test.mjs`.

## Commands / results

### Typecheck

```
$ cd packages/contracts && npm run typecheck
> tsc --noEmit
(exit 0, no output)
```

### Test (200/200 PASS)

```
$ npm test
ℹ tests 200
ℹ suites 0
ℹ pass 200
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 348.213 (chạy thực, lần gần nhất)
```

### Fixtures tổng hợp (đếm thực từ test runner)

| File | Fixtures | Phạm vi |
|---|---|---|
| `enums.test.mjs` | 9 | 8 stages + close status + 9 closeReason + 5 availability + 5 current relationship + matching outcomes + ExternalContactLink state + NextAction + FORBIDDEN + version pin |
| `envelopes.test.mjs` | 23 | version pin + commandRequest base + actor discriminator (USER/SERVICE/DELEGATED_USER) + source discriminator (HRP_UI/INTEGRATION) + unknown version + idempotency key bounds + correlation vs idempotency + ID bounds + ISO timestamp + calendar date + ACCEPTED/APPLIED/FAILED + OperationReference + OperationQuery + idempotency digest + canonicalize + ResponseEnvelope + ExpectedVersion |
| `errors.test.mjs` | 13 | 10 codes + retry defaults (NEVER/REVIEW_REQUIRED/REFRESH_AND_REVIEW/REAUTHENTICATE/RECONCILE_FIRST/BOUNDED_SAME_KEY) + HTTP hint + safe shape (no stack/SQL/providerBody/secret/message/details) + fieldPath JSON pointer + ErrorList min/max + messageKey + UNKNOWN_COMMAND_OUTCOME |
| `identity.test.mjs` | 18 | G0/0.3a: identity signals + matching outcomes (3 nhánh) + DNC + evidence opaque |
| `profile-intake.test.mjs` | 25 | G0/0.3b: profile patch whitelist + intake payload + staff review confirmation + preview resolver + lifecycle proposed |
| `enums-extra.test.mjs` | 14 | ExternalContactMatchState vs MatchingOutcome + calendar leap year + IdempotencyKey bounds + ExpectedVersion bounds |
| `placement-case-interactions.test.mjs` | 38 | G0/0.3c–0.3d: openPlacementCase (no caseId) + patch whitelist/forbidden + update/close with expectedVersion + closeReason + CLOSED server-owned + SUCCESS ≠ EFFECTIVE + InteractionKind/Outcome + Talent/Client context + assignee ≠ actor + timestamps shape only (no order) + forbidden fields + stage full enum 8 giá trị + Q-19/Q-20/Q-22 markers |
| `availability.test.mjs` | 13 | **G0/0.3e mới**: AVAILABILITIES enum + AVAILABLE_FROM_DATE rule + no hardcoded clock + leap year bounds + note safe + patch forbidden + appliedAvailableFromDate nullable + suppressionEventId marker |
| `suppression.test.mjs` | 17 | **G0/0.3e mới**: 3 target kinds (LABOR_PROFILE / EXTERNAL_CONTACT / SUPPRESSED_RECIPIENT_FENCE) + safety suppression không tạo LaborProfile + fenceToken+cutOffAt đi cùng + DispatchAuthorization outcomes (AUTHORIZED/SUPPRESSED/UNKNOWN) + CACHE_STALE/HRP_OFFLINE fail closed + 12 patch forbidden |
| `next-action.test.mjs` | 16 | **G0/0.3f mới**: NEXT_ACTION_KINDS + OPEN/DONE/CANCELLED status + SnoozeMode (ACTIVE/SNOOZED/DISMISSED) tách riêng + 3 target kinds + timezone Asia/Ho_Chi_Minh literal + CREATE không cho initialStatus=DONE + UpdateNextAction actionId+expectedVersion + NextActionRevisionRef dedupe key + patch forbidden |
| `scheduling.test.mjs` | 11 | **G0/0.3f mới**: 3 batch item kinds + 4 per-item outcomes (APPLIED/ACCEPTED/FAILED/SKIPPED) + KHÔNG có ALL_SUCCESS + AVAILABILITY batch không DO_NOT_CONTACT + FAILED phải có error + summary applied+accepted+failed+skipped = totalItems + items.length = summary.totalItems |
| **Tổng** | **200** | (pass 200/200 từ runner) |

## AC kết quả

### G0/0.3e — Availability — PASS

| AC | Trạng thái | Evidence |
|---|---|---|
| Input có laborProfileId + availability + expectedVersion | PASS | `UpdateLaborAvailabilityInputSchema` yêu cầu 3 field; test `UpdateLaborAvailabilityInput: thiếu expectedVersion → reject` |
| AVAILABLE_FROM_DATE bắt buộc ngày lịch hợp lệ | PASS | `AvailabilityPatchSchema.superRefine` enforce khi availability = AVAILABLE_FROM_DATE; test `AVAILABLE_FROM_DATE yêu cầu availableFromDate` |
| Validation "tương lai" dùng business clock/context, không hardcode ngày | PASS | Schema KHÔNG so với `Date.now()`; test `KHÔNG hardcode clock (no Date.now() check ở schema)` chứng minh schema cho phép ngày 2020 và 2099. Runtime HRP gate dùng `BUSINESS_TIMEZONE = 'Asia/Ho_Chi_Minh'` + submission/intake effective time. Comment trong schema ghi rõ. |
| Các state khác xử lý ngày cũ rõ ràng (clear khỏi projection) | PASS | Schema reject khi khác AVAILABLE_FROM_DATE mà có availableFromDate; test `khác AVAILABLE_FROM_DATE thì KHÔNG có availableFromDate (clear khỏi projection)`. Runtime HRP gate enforce `appliedAvailableFromDate` nullable. |
| KHÔNG tự đổi CurrentRelationship/case | PASS | `AVAILABILITY_PATCH_FORBIDDEN` reject `currentRelationship`, `placementCaseId`, `intendedStage`, `status`, `closeReason`; test `KHÔNG có field currentRelationship/placementCaseId (trục riêng)` |

### G0/0.3e — Suppression (DNC + dispatch) — PASS

| AC | Trạng thái | Evidence |
|---|---|---|
| DNC event/dispatch authorization/fencing mô tả actor/version/cut-off | PASS | 3 target kinds (`LABOR_PROFILE`/`EXTERNAL_CONTACT`/`SUPPRESSED_RECIPIENT_FENCE`); `CommitSuppressionResultSchema` có `fenceToken` + `fenceCutOffAt`; `DispatchAuthorizationCheckResultSchema` có `nextFenceToken` cho lần dispatch kế tiếp. Tests `3 kind discriminator`, `RecipientFenceTokenRef: fenceToken + cutOffAt đi cùng nhau`, `SUPPRESSED_RECIPIENT_FENCE result phải có fenceToken`. |
| Stale cache KHÔNG cấp phép gửi (fail closed) | PASS | `DispatchAuthorizationOutcomeSchema` (AUTHORIZED/SUPPRESSED/UNKNOWN); `DispatchDenyReasonSchema` (DNC_ACTIVE/DNC_FENCE_EXPIRED/HRP_OFFLINE/CACHE_STALE/TARGET_UNRESOLVED/OK); AUTHORIZED + reason=OK là constraint duy nhất. Test `UNKNOWN = HRP_OFFLINE / CACHE_STALE (fail closed)`. |
| Unresolved contact có local safety suppression, không tạo canonical profile, không đòi CCCD | PASS | `ExternalContactTargetRefSchema` ép `resolvedCanonical: false` literal; `CommitSuppressionInputSchema` validate; test `EXTERNAL_CONTACT target không được có resolvedCanonical=true` + `KHÔNG yêu cầu CCCD/intake đầy đủ (DNC độc lập)` |
| Inbound KHÔNG tự gỡ DNC | PASS | `SUPPRESSION_PATCH_FORBIDDEN` có `inboundOptOutRemoval`, `autoClearOnInbound`, `removeSuppression`, `optBackIn`, `forceSend`; test `SUPPRESSION_PATCH_FORBIDDEN: không cho phép tự gỡ DNC / bypass cache stale` |
| Automatic delivery fail closed khi không xác minh contactability | PASS | `DispatchAuthorizationCheckResultSchema` UNKNOWN outcome → keep pending; test `UNKNOWN outcome KHÔNG có reason=OK`; runtime gate enforce |

### G0/0.3f — NextAction — PASS

| AC | Trạng thái | Evidence |
|---|---|---|
| Define create/update intent rõ: target context, actionId khi update, expectedVersion khi sửa, OPEN/DONE/CANCELLED, due/scheduled time và timezone | PASS | `NextActionKindSchema` (CREATE/UPDATE); `CreateNextActionInputSchema` không có actionId; `UpdateNextActionInputSchema` yêu cầu actionId + expectedVersion; `NextActionStatusSchema` (OPEN/DONE/CANCELLED); `NextActionScheduleSchema` ISO 8601 + Asia/Ho_Chi_Minh literal + dueAt >= scheduledAt. Tests tương ứng. |
| Runtime transition và target ownership thuộc HRP, không suy ra chỉ vì schema pass | PASS | Schema KHÔNG enforce transitions matrix; runtime HRP gate quyết. Schema cho targetKind enum 3 giá trị; test `NextActionTargetRef: 3 kind discriminator`. Runtime ownership gate xác minh qua target `expectedVersion`. |
| Snooze/dismiss notification khác DONE | PASS | `SnoozeModeSchema` (ACTIVE/SNOOZED/DISMISSED) tách riêng `NextActionStatusSchema` (OPEN/DONE/CANCELLED); test `SnoozeMode: ACTIVE / SNOOZED / DISMISSED tách riêng status (AC #3 snooze≠DONE)`. CREATE không cho `initialStatus = DONE`; test `CREATE không cho phép initialStatus=DONE`. |
| Schedule revision/occurrence có key cho dedupe reminder | PASS | `NextActionRevisionRefSchema` có `revisionId` + `occurrenceKey`; test `occurrenceKey phải mới cho snooze rerun`. `NextActionResultSchema.appliedRevision` echo cho scheduler/reminder kế tiếp. |

### G0/0.3f — Scheduling (Planning batch) — PASS

| AC | Trạng thái | Evidence |
|---|---|---|
| DTO planning batch có per-item outcome | PASS | `PlanningBatchItemOutcomeSchema` (APPLIED/ACCEPTED/FAILED/SKIPPED) per item; `PlanningBatchItemResultSchema` per item có outcome + optional appliedId/error; `PlanningBatchSummarySchema` đếm từng loại. Tests `FAILED phải có error`, `APPLIED/ACCEPTED phải có appliedId`, `items.length = summary.totalItems`. |
| KHÔNG báo all success khi một mục lỗi | PASS | `PlanningBatchResultSchema` KHÔNG có field `allSuccess`; test `PlanningBatchResult: KHÔNG có field allSuccess`. Caller đọc per-item + summary để biết partial failure. Test `Batch có 1 FAILED → caller biết partial failure`. |
| AVAILABILITY batch KHÔNG cho DO_NOT_CONTACT (cần suppression.ts) | PASS | `PlanningBatchAvailabilityItemSchema.availability` enum loại trừ DO_NOT_CONTACT; test `AVAILABILITY batch item KHÔNG cho DO_NOT_CONTACT (dùng suppression.ts)` |

## AC FAIL / BLOCKED — phân loại theo Owner chỉ thị

### A. CONFIRMED (đã chốt baseline)

**G0/0.3a–0.3d** (đã ghi ở handoff rev 2):
- Q-13 EXACT review, Q-14 fill-missing, Q-15 availableFromDate clock,
  Q-18 DNC OTHER note, Q-20 SUCCESS ≠ EFFECTIVE (closed), Q-24 stage
  runtime gate vs schema whitelist.

**G0/0.3e–0.3f** (mới — chi tiết xem `decision-register.md`):
- **Q-25 (Availability patch whitelist)**: confirmed baseline.
  Schema bind shape (laborProfileId + availability + expectedVersion
  + patch). Runtime HRP gate enforce optimistic concurrency,
  DO_NOT_CONTACT transaction với suppression event (Master §10.6.5),
  future-date theo `BUSINESS_TIMEZONE = 'Asia/Ho_Chi_Minh'` (Q-15).
  Schema KHÔNG hardcode clock; KHÔNG auto-merge LaborProfile; KHÔNG
  đổi CurrentRelationship/case (trục riêng).
- **Q-26 (Suppression target kind)**: confirmed baseline. 3 kind
  discriminator (LABOR_PROFILE / EXTERNAL_CONTACT /
  SUPPRESSED_RECIPIENT_FENCE). Schema bind shape; runtime gate enforce
  AUTHORIZED/SUPPRESSED/UNKNOWN; stale cache fail closed; inbound
  KHÔNG tự gỡ DNC. Schema KHÔNG có `removeSuppression` / `optBackIn`
  / `forceSend` / `bypassDnc` / `ignoreStaleCache` — opt-in lại qua
  command riêng.
- **Q-27 (NextAction snooze/dismiss vs DONE)**: confirmed baseline.
  Schema phân biệt `status` (OPEN/DONE/CANCELLED) và `snoozeMode`
  (ACTIVE/SNOOZED/DISMISSED). Mỗi snooze rerun cấp `revisionId` +
  `occurrenceKey` mới để dedupe reminder. CREATE chỉ cho
  `initialStatus = OPEN | CANCELLED`.
- **Q-28 (Planning batch per-item outcome)**: confirmed baseline.
  Schema `PlanningBatchResult` KHÔNG có `allSuccess: boolean`; caller
  đọc per-item + summary. Per-item outcome enum: APPLIED / ACCEPTED /
  FAILED / SKIPPED. AVAILABILITY batch KHÔNG cho DO_NOT_CONTACT.

### B. PROPOSED (ghi marker, chờ Owner/HRP domain chốt)

- **Q-16 (Submission lifecycle)**: vẫn PROPOSED.
- **Q-17 (PreviewResolver candidate PII)**: matrix cụ thể open trước
  path HRP thật.

### C. UNKNOWN (chưa có baseline, không tự quyết, ghi rõ trong decision register)

- **G-06 (open-status set / active set / transitions matrix)**:
  UNKNOWN. Schema bind shape; runtime HRP gate quyết.
- **G-07 (HRP review pre-apply vs post-apply)**: UNKNOWN.
- **G-08 (managed mode HRP_MANAGED/CLIENT_MANAGED + EFFECTIVE flow)**:
  UNKNOWN.
- **G-09 (KPI attribution grain)**: UNKNOWN.
- **G-10 (integration runtime, Client domain context)**: UNKNOWN.
  HRP-side Client domain schema (company/contact/opportunity) cần
  HRP-owned PR.
- **Q-19 (PlacementCase open-status / active set / transitions)**:
  UNKNOWN.
- **Q-21 (Talent/Client interaction actor runtime auth/delegation
  protocol)**: UNKNOWN.
- **Q-22 (Interaction timestamps order rule)**: UNKNOWN. Schema
  bind shape only; runtime gate có thể enforce khi domain decision
  xong.
- **Q-23 (Client required context fields)**: **UNRESOLVED / PROPOSED**.
  Schema bind opaque `clientReferenceId`; runtime resolve canonical.
  **Outcome UNKNOWN ở interaction không đủ chứng minh AC PASS cho
  Client domain**.

### D. BLOCKED — task/gate thực sự bị chặn

- **BLOCKED-ENV (scope giới hạn, không phải blocker chung)**:
  - AC bị chặn: actor runtime auth/IdP (Q-21), dispatcher fencing
    production gate, outbox delivery (G-08/G-10), KPI attribution
    grain (G-09), Client domain contract (Q-23), HRP review
    pre/post-apply (G-07).
  - AC KHÔNG bị chặn: contracts/fixtures cho G0/0.3e–0.3h,
    G0/0.4–0.7 (queries/events/mappings/routing/analytics/permission
    matrix), test mock gateway, enum/wire constants, planning
    batch per-item. **Phần contracts-only/mock đủ nguồn tiếp tục
    mà không cần HRP core runtime.**
- **BLOCKED-AUDIT**: shared contracts (matching outcome, intake
  submission, staff review confirmation, profile patch, placement
  case patch, interaction timestamps, availability mutation,
  suppression commit, NextAction transition, planning batch) thuộc
  audit gate; chưa có independent audit PASS. Gom cùng Gate 0
  bundle trước freeze.

## Coverage matrix — risk areas G0/0.3e–0.3f

| Risk area | Verify ở | Tests (count) | Ghi chú |
|---|---|---|---|
| Availability target/version + DO_NOT_CONTACT transaction | `availability.test.mjs` | 5 (AC #1, no clock, AVAILABLE_FROM_DATE rule, suppressionEventId marker, appliedAvailableFromDate nullable) | Schema bind shape; runtime HRP gate enforce DO_NOT_CONTACT transaction + future-date theo business clock. |
| Suppression target discriminator + fencing | `suppression.test.mjs` | 6 (3 kinds, ExternalContact safety, fenceToken+cutOffAt, DispatchAuthorizationCheckInput, DncReason enum) | Schema bind; runtime gate AUTHORIZED/SUPPRESSED/UNKNOWN. |
| Dispatch authorization fail closed (stale cache, HRP offline) | `suppression.test.mjs` | 3 (AUTHORIZED/SUPPRESSED/UNKNOWN outcomes + reasons) | Stale cache không cấp phép gửi. |
| Inbound KHÔNG tự gỡ DNC + bypass forbidden | `suppression.test.mjs` | 1 (12 forbidden fields marker) | Schema forbid `inboundOptOutRemoval`, `autoClearOnInbound`, `bypassDnc`, `ignoreStaleCache`, ... |
| NextAction CREATE/UPDATE intent rõ + status + snoozeMode | `next-action.test.mjs` | 7 (kind discriminator, status enum, snoozeMode enum, schedule timezone, target discriminator, CREATE không DONE) | Snooze/dismiss ≠ DONE tách ở SnoozeMode. |
| NextAction transitions runtime gate (không enforce ở schema) | `next-action.test.mjs` | 2 (UpdateNextAction actionId+expectedVersion, patch optional) | Schema KHÔNG enforce transitions matrix; runtime HRP gate quyết. |
| Schedule revision/occurrence dedupe reminder | `next-action.test.mjs` | 1 (NextActionRevisionRef occurrenceKey mới cho snooze rerun) | Mỗi snooze rerun cấp `revisionId` + `occurrenceKey` mới. |
| Planning batch per-item outcome + summary | `scheduling.test.mjs` | 5 (per-item outcome, FAILED phải có error, APPLIED phải có appliedId, summary tổng = totalItems, items.length = summary.totalItems) | Schema KHÔNG có field allSuccess. |
| KHÔNG báo all success khi một mục lỗi | `scheduling.test.mjs` | 2 (không có field allSuccess, 1 FAILED → caller biết partial failure) | Caller tự quyết từ per-item + summary. |
| AVAILABILITY batch không DO_NOT_CONTACT (cần suppression.ts) | `scheduling.test.mjs` | 1 (AVAILABILITY batch item không cho DO_NOT_CONTACT) | Schema đảm bảo DO_NOT_CONTACT qua suppression transaction. |

## Limitations / Missing inputs

1. **Không có HRP core checkout.** Toàn bộ DTO chỉ đối chiếu Master
   V2.6 / connector v1.0 / Backlog Gate0. Mọi claim "schema validate"
   KHÔNG chứng minh runtime HRP đã xác thực.
2. **Open-status / transitions / managed-mode / EFFECTIVE workflow /
   actor auth/delegation / Client domain** đã liệt kê Q-19..Q-28 — runtime
   HRP gate enforce; schema không tự quyết.
3. **`contracts.synthetic.mjs`** + **`*.legacy.mjs`** giữ nội dung test
   agent nội bộ đặt; đã hợp nhất phần hợp lệ vào baseline test suite,
   phần còn lại ghi rõ lý do loại ở `_synthetic-coverage.md`. Không bỏ
   coverage hợp lệ chỉ vì đổi implementation.
4. **Audit gate chưa động.** Self-check 200/200 fixtures; không thay
   thế independent audit.
5. **G0/0.3e–0.3f deltas**:
   - **availability.ts**: 1 input schema + 1 result schema + patch
     whitelist + 16 forbidden fields. Runtime gate enforce DO_NOT_CONTACT
     transaction, future-date theo Asia/Ho_Chi_Minh + business clock.
   - **suppression.ts**: 3 target kinds + CommitSuppression input/result +
     DispatchAuthorizationCheck input/result + 6 deny reasons + 12 patch
     forbidden. Stale cache fail closed; inbound KHÔNG tự gỡ DNC.
   - **next-action.ts**: 2 intents (CREATE/UPDATE) + 3 target kinds +
     schedule Asia/Ho_Chi_Minh + SnoozeMode + revision/occurrence dedupe
     + patch forbidden.
   - **scheduling.ts**: 3 batch item kinds + 4 per-item outcomes + summary
     + KHÔNG có allSuccess. AVAILABILITY batch không DO_NOT_CONTACT.

## Risks & Open decisions

- **R-1..R-7** (G0/0.3a–0.3b): workflow HRP review pre/post-apply,
  EXACT review policy (đã chốt Q-13), fill-missing audit (đã chốt Q-14),
  availableFromDate clock (đã chốt Q-15), preview label PII, DNC OTHER
  note (đã chốt Q-18).
- **R-8** (Q-19, G-06): Open-status set / active set / transitions matrix
  (proposed).
- **R-9** (Q-20, closed theo nghĩa invariant đã chốt): SUCCESS ≠
  EFFECTIVE. Managed-mode workflow riêng vẫn unknown (G-08).
- **R-10** (Q-21, G-03): Talent/Client interaction actor runtime auth/
  delegation protocol chưa chốt.
- **R-11** (Q-22): Interaction timestamps order rule CHƯA CHỐT
  (schema bind shape only).
- **R-12** (Q-23, G-10): Client required context fields chưa chốt;
  UNRESOLVED/PROPOSED — không đủ chứng minh AC PASS.
- **R-13** (Q-24): Stage runtime gate vs schema whitelist — confirmed.
- **R-14** (Q-25): Availability patch whitelist — confirmed baseline.
- **R-15** (Q-26): Suppression target kind — confirmed baseline.
- **R-16** (Q-27): NextAction snooze/dismiss vs DONE — confirmed baseline.
- **R-17** (Q-28): Planning batch per-item outcome — confirmed baseline
  (không có allSuccess).

---

**Trạng thái cuối**:
- G0/0.3e–0.3f: **Self-check PASS** (200/200 fixtures PASS, runtime
  ≈ 348ms, typecheck strict PASS).
- Audit: **PENDING**, gom bundle Gate 0 trước freeze.
- Dừng đúng phạm vi Owner giao.
- Không tự sang G0/0.3g–h, G0/0.4–0.7, G0/0.8.
- Chờ Owner review Gate 0 bundle.
