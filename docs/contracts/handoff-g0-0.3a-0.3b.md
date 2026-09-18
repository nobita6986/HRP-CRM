# G0/0.3a–0.3b — Handoff bundle

**T1 (Coder)**: 2026-09-13. Workspace `D:\CodeApp\Hrp-Crm`, branch `main`,
chưa có commit. Bundle ổn định bằng working tree.

## Trạng thái thực tế

- Tiếp theo G0/0.0–0.2 (đã đóng + checkpoint `checkpoint.g0-0.0-0.2.md`).
- Repo chỉ có 6 tài liệu `docs/Importal/*` + skeleton `packages/contracts/`
  (đã có từ đợt trước).
- Không có HRP core checkout, schema Prisma, `AGENTS.md`,
  `AI_CODING_GUARDRAILS.md`, auth thật → contracts runtime gate không xác
  minh được.

## Changed files

```
docs/contracts/inventory.md                      (append §"Cập nhật G0/0.3a–0.3b")
docs/contracts/decision-register.md              (append Q-13..Q-18)
docs/contracts/checkpoint.g0-0.0-0.2.md          (mới — checkpoint đợt trước)
docs/contracts/handoff-g0-0.3a-0.3b.md           (mới — file này)
packages/contracts/src/index.ts                  (re-export commands/*)
packages/contracts/src/commands/evidence.ts      (mới)
packages/contracts/src/commands/identity.ts      (mới)
packages/contracts/src/commands/profile.ts       (mới)
packages/contracts/src/commands/intake.ts        (mới)
packages/contracts/tests/identity.test.mjs       (mới — 18 fixtures)
packages/contracts/tests/profile-intake.test.mjs (mới — 25 fixtures)
```

## Hash manifest (SHA-256 thực, đo tại 2026-09-13 10:06 UTC+7)

```
.gitignore                                       1DDD9AC19D54ED8C1900C5740EE27D7A8807DABE6AF93763D52DACF8E950DCE0
docs/Importal/Execution-Guide.HRP-Engagement.md  1DCFB69E3FEA477855158EE98BCB8B7FE435155B2B23C51F468B17450213420F
docs/Importal/Master-Plan.V2.6.md                B82EF7A5A36BF7AC9CF19F1E1F57BBB71CFA19F8C3CE81F69AA1F7A9754FC1CC
docs/Importal/Implementation-Backlog.Gate0-V7.9a.md  0DFB02809F07F69A9DE897EB349983393E5E7A138DFB7A6BBAB902C94379C73E
docs/Importal/Implementation-Backlog.HRP-Owned-V7.9b-f.md  BE7F9B3F789C62A69460D79D079F5353CFFCF42153706B809CCD41AE02C4A673
docs/Importal/Implementation-Backlog.V7.10-AI-BoD.md  77E5A6FC33E90BD828BDE3D31C8927F88D22F2B486D6ECDDB73F693E4F4314DD
docs/Importal/hrp-connector.md                   EFBAE0F5525F4A408B6D542B0B3B2C21C6A521734947D698D47DBA7AD9A2618B
docs/contracts/checkpoint.g0-0.0-0.2.md          B2B61AE671BDA722973342DBCA638E3FB814DEB68EB953CE7EDECDB9023E6EC7
docs/contracts/decision-register.md              204CB20B41E86CC2F7ABE63E83EF87694AE6FA85F6F599C16C3BBAC959D52564
docs/contracts/g0-0.0-0.2-handoff.md             823075ED8EA611634B3CD120B64031B6003F614133F6692310D16E185EF54658
docs/contracts/handoff-g0-0.3a-0.3b.md           9C7E8143345AD0F71A044BFADA924C3D4C14DB4A7F17E588130869CBA3594E80
docs/contracts/inventory.md                      6527917A52FBE77E60E6820D9BC9B7E4EFFB65CD6DA8E55D6AAE02565E8183AE
packages/contracts/package-lock.json             31EBFAA71DD86030DE374B4DF62D852A30A32517D7D07A40C0F0629C12604FC0
packages/contracts/package.json                  569E9705604989A16F560554FB34F9923A9B027959FE587CF4D6D431242E5D27
packages/contracts/README.md                     097FF97E7FA7CE791EFCFA9495F73EE7DA897599C640C639CDC9BAF3784F8EC4
packages/contracts/tsconfig.json                 5AC522BD9ED4375A22933BE65A9E3B00A4C546F34D7EE8A276CC40F8C00058D2
packages/contracts/src/index.ts                  9863986382BE7A2585129D35CB70F1735A9A15315605A2559CA46C3D649DA299
packages/contracts/src/enums.ts                  29F4D520786A3A3FB15901592487B593F8AADC3ABD60D7095EEF1F8CD2D354EA
packages/contracts/src/primitives.ts             51DAE2C7431A023573ADF3233F3F5DFD88BDE2D3F87F71678EC869660BB25288
packages/contracts/src/errors.ts                 69376F02D1B1830A94303A19CC617FC12C22203571C4E3DDBD81973518C468B9
packages/contracts/src/envelopes.ts              CF874BF70872B724E2FD74D2FE1FB211DCAABADF2F1E5FBE3819372836C3E5A3
packages/contracts/src/commands/evidence.ts      E9B123EC0E2F3D23B460407F9CA442B4B555AB22196B0C482CBD791D3BB62C54
packages/contracts/src/commands/identity.ts      6304D2E16C2E2729AC93468294E2BBC2849710F8BF19A0AB556B9CC9A6FAF82A
packages/contracts/src/commands/profile.ts       A10A7DC96855C656C7D41924D31AFF16D3F1A40857EE040BBFB7294F1FBB9C50
packages/contracts/src/commands/intake.ts        D95DFE2B0898CC3C1949C580F652F512D408C2274719267DDA5EAD6ED04DDC7B
packages/contracts/tests/enums.test.mjs          B96ADC1E020478371483461B73E7592AF4D207A6080AE0FF4C41FED0CCFE419B
packages/contracts/tests/errors.test.mjs         A92D3A3A102C14B2AB247F53DDA473AC7BDDAC15F3E322173D94AF397A3573F5
packages/contracts/tests/envelopes.test.mjs      CE1817F04C53E1C649985980A20CDF5903063D8018C18337DCFD37A6E8F16AC4
packages/contracts/tests/identity.test.mjs       3C1D634CA911AAC5CB321C416FE980A5755066839D89F5B98AEA3DAB18BDA40B
packages/contracts/tests/profile-intake.test.mjs CC17D2702904ABFA6E6F9A3A487309B4269CD43A4BAD8A97CF225F0C866ECC70
packages/contracts/tests/contracts.synthetic.mjs EDE9DFECCD3A9F148047D872C48D36F15E5B12E3E5609356F5660A3E70572F03
packages/contracts/tests/_synthetic-pending.md   8B5E583F49FCAC24C3C119A81856AF4BB991AE18A443D33E45520406D18E06CD
```

Hash sẽ thay đổi khi thêm/sửa file trong bundle Gate 0 tiếp theo; manifest
cập nhật theo từng commit/handoff.

## Commands / results

### Typecheck

```
$ cd packages/contracts && npm run typecheck
> tsc --noEmit
(exit 0, no output)
```

### Test (75/75 PASS)

```
$ npm test
> tsc && node --test tests/*.test.mjs

[G0/0.0–0.2 — 32 fixtures giữ nguyên PASS]

[G0/0.3a — 18 fixtures mới]
✔ IdentitySignal: phone normalized là signal, không unique proof
✔ IdentitySignal: CCCD chỉ chấp nhận 9–12 chữ số, không ép UUID
✔ IdentitySignal: ít nhất một field
✔ IdentitySignal: strict — field lạ bị reject
✔ CreateOrMatchLaborProfile input: hợp lệ với phone + 2 evidence
✔ CreateOrMatchLaborProfile input: thiếu evidence KHÔNG ép NEW
✔ CreateOrMatchLaborProfile input: policyHint MATCH_ONLY thiếu signal bị reject
✔ EvidenceRef: opaque ID + kind + org; field cấm bị reject (strict)
✔ EVIDENCE_FORBIDDEN_CLIENT_FLAGS liệt kê các flag cấm
✔ EXACT_MATCH có canonicalId + version
✔ POSSIBLE_MATCH có reviewReference, KHÔNG có canonicalId mutation được
✔ NEW_PROFILE có canonicalId + version + createdByPolicy
✔ MatchingOutcomeResult: 3 outcome phân biệt
✔ MatchingOutcomeResult: union cho phép 3 outcome; reject khác
✔ DncAction: tách biệt, KHÔNG bị buộc CCCD/evidence đầy đủ
✔ DncAction: KHÔNG chứa fullName/phone/CCCD trong payload
✔ IdentityProvenance: provider + connectionId + collectedAt required
✔ OrganizationId bắt buộc trong input

[G0/0.3b — 25 fixtures mới]
✔ PROFILE_PATCH_WHITELIST giới hạn field được phép patch
✔ ProfilePatch: field trong whitelist accept
✔ ProfilePatch: field NGOÀI whitelist bị reject
✔ ProfilePatch: empty object bị reject
✔ ProfilePatchSafe: field cấm (CurrentRelationship/Handling/Beneficiary/Worker) reject
✔ PROFILE_PATCH_FORBIDDEN_FIELDS đầy đủ
✔ UpdateLaborProfile input: required laborProfileId + expectedVersion + patch
✔ UpdateLaborProfile input: thiếu expectedVersion bị reject
✔ UpdateLaborProfile result: APPLIED / NOOP discriminated
✔ IntakeContextRef: HRP_UI không có connectionId provider
✔ BusinessIntent: AVAILABLE_FROM_DATE yêu cầu availableFromDate
✔ BusinessIntent: availableFromDate chỉ hợp lệ với AVAILABLE_FROM_DATE
✔ IntakeSubmissionPayload: full intake yêu cầu ≥ 2 evidence (front + back)
✔ IntakeSubmissionPayload: tách CCCD address (citizenIdentity) vs contactAddress
✔ IntakeSubmissionPayload: rawTranscript/messages bị reject
✔ StaffReviewContext: draftDigest phải SHA-256 hex 64 ký tự
✔ StaffReviewConfirmation: confirmed phải là literal true
✔ isConfirmationValid: thay đổi field/target/version làm confirmation cũ invalid
✔ PreviewResolverRequest: signal có ít nhất 1 field
✔ PreviewResolverResult: candidates ≤ 16, có expiresAt
✔ PreviewResolver là READ-ONLY — không gọi createOrMatch mutation
✔ Submission lifecycle: 3 label tách biệt; SUBMITTED/APPLIED/HRP_REVIEWED proposed
✔ DncAction tách biệt intake: isDncActionValid với payload tối thiểu
✔ IntakeSubmissionPayload: DNC không bị buộc intake đầy đủ

ℹ tests 75
ℹ pass 75
ℹ fail 0
ℹ duration_ms 352.7468
```

## AC từng mục

### G0/0.3a — Identity & evidence DTOs — **PASS**

| AC | Trạng thái | Evidence |
|---|---|---|
| EXACT/NEW có canonical ID/version; POSSIBLE không có target mutation | PASS | `MatchingOutcomeResultSchema` 3 nhánh; tests `EXACT_MATCH có canonicalId + version`, `POSSIBLE_MATCH có reviewReference, KHÔNG có canonicalId mutation được`, `NEW_PROFILE có canonicalId + version` |
| NEW_PROFILE không là matching state thứ tư | PASS | `MatchingOutcomeResultSchema` chỉ là 3 outcome; `MatchingOutcomeResult: union cho phép 3 outcome; reject khác` (UNRESOLVED/4th bị reject) + `MatchingOutcomeResult: 3 outcome phân biệt; NEW_PROFILE KHÔNG là state thứ tư của mapping` |
| EvidenceRef opaque (ID + kind); không base64/raw URL; không tin client scan flags | PASS | `CommandEvidenceRefSchema` + `EVIDENCE_FORBIDDEN_CLIENT_FLAGS` (scanPassed, scanStatus, publicUrl, rawUrl, base64, sha256, ...); test `EvidenceRef: opaque ID + kind + org; field cấm bị reject (strict)` + `EVIDENCE_FORBIDDEN_CLIENT_FLAGS liệt kê các flag cấm` |
| Tách identity-signal DTO tối thiểu với complete-intake DTO | PASS | `IdentitySignalSchema` (minimal, optional fields) vs `IntakeSubmissionPayloadSchema` (full intake); tests `IdentitySignal` (3 fixtures) + `IntakeSubmissionPayload` (3 fixtures) tách riêng |
| Thiếu evidence KHÔNG ép tạo NEW | PASS | `CreateOrMatchLaborProfileInputSchema.evidence` optional; test `CreateOrMatchLaborProfile input: thiếu evidence KHÔNG ép NEW (signal-only OK)` |
| SĐT normalized là signal, không unique-person proof | PASS | `NormalizedPhoneSchema` (regex, 8–15 chữ số, không unique enforcement); test `IdentitySignal: phone normalized là signal, không unique proof` |
| DNC không bị buộc intake/CCCD | PASS | `DncActionSchema` (tách schema, không có evidence/CCCD required); tests `DncAction: tách biệt, KHÔNG bị buộc CCCD/evidence đầy đủ` + `IntakeSubmissionPayload: DNC không bị buộc intake đầy đủ` |

### G0/0.3b — Profile completion, staff review, preview — **PASS**

| AC | Trạng thái | Evidence |
|---|---|---|
| Patch whitelist; KHÔNG CurrentRelationship/Handling/Beneficiary | PASS | `PROFILE_PATCH_WHITELIST` (7 fields) + `PROFILE_PATCH_FORBIDDEN_FIELDS` (16 field cấm); tests `PROFILE_PATCH_WHITELIST giới hạn field được phép patch` + `ProfilePatch: field NGOÀI whitelist bị reject` + `ProfilePatchSafe: field cấm (CurrentRelationship/Handling/Beneficiary/Worker) reject` |
| Fill-missing: không ghi đè giá trị đã có | PASS (schema) | `UpdateLaborProfileInputSchema.fillMissingOnly: z.boolean().default(true)`; runtime HRP gate enforcement ghi trong comment. Schema không thể enforce runtime. |
| Confirmation gắn draft revision/digest/actor/context; thay field/evidence/intent/target → invalid | PASS | `StaffReviewConfirmationSchema` + `StaffReviewContextSchema` (draftRevisionId, draftDigest SHA-256 hex 64, canonicalId, canonicalVersion); `isConfirmationValid()` so sánh draftRevisionId/draftDigest/canonicalId/canonicalVersion; tests `isConfirmationValid: thay đổi field/target/version làm confirmation cũ invalid` (4 nhánh: change revision/id/version → invalid) |
| EXACT vẫn cần staff review | PASS (schema + marker) | `MatchingOutcomeResultSchema` (3 outcome) + `StaffReviewConfirmationSchema` (bind context với EXACT); Q-13 mở cho Owner quyết policy. Schema không thể enforce runtime. |
| Preview dùng read-only resolver, không gọi createOrMatch | PASS | `PreviewResolverRequestSchema` (chỉ signal + context, KHÔNG evidence/canonicalId write target); `PreviewResolverResultSchema` (chỉ candidateId opaque + strength); test `PreviewResolver là READ-ONLY — không gọi createOrMatch mutation` |
| Submitted/applied/HRP-reviewed tách biệt; workflow chưa chốt ghi proposed | PASS | `SUBMISSION_LIFECYCLE` = `['SUBMITTED', 'APPLIED', 'HRP_REVIEWED']`; `SUBMISSION_LIFECYCLE_PROPOSED = true`; test `Submission lifecycle: 3 label tách biệt; SUBMITTED/APPLIED/HRP_REVIEWED đánh dấu proposed` + validate APPROVED canonical bị reject |

## AC FAIL / BLOCKED còn tồn đọng

- **BLOCKED-OWNER (theo Owner/Chủ nhân)**: 18 open questions Q-01..Q-18.
  Q-13..Q-18 mới phát sinh từ G0/0.3a–0.3b.
- **BLOCKED-ENV**: thiếu HRP core checkout, schema Prisma, `AGENTS.md`,
  `AI_CODING_GUARDRAILS.md`, auth IdP thật, endpoint thực — không
  contracts runtime gate nào xác minh được.
- **BLOCKED-AUDIT**: shared mutation/review contracts (MatchingOutcome,
  IntakeSubmission, StaffReviewConfirmation, ProfilePatch) thuộc diện
  audit theo Execution-Guide §5.3; chưa có independent audit PASS.
  Owner quyết gom cùng Gate 0 bundle trước freeze.

## Trạng thái self-check vs audit

- **Self-check**: PASS (75/75 fixtures PASS + typecheck strict PASS).
- **Independent audit**: **PENDING**. Shared mutation/review contracts
  (MatchingOutcome, IntakeSubmission, StaffReviewConfirmation,
  ProfilePatch) thuộc diện audit bắt buộc theo Owner chỉ thị +
  Execution Guide §5.3; chưa có independent audit PASS. Coder đã rà đối
  chiếu baseline (Master V2.6 + connector v1.0 + Backlog Gate0) và hợp
  nhất phần hợp lệ từ `contracts.synthetic.mjs` (xem
  `_synthetic-pending.md`); không tự công nhận DONE tuyệt đối.
- Audit gate sẽ gom cùng Gate 0 bundle trước freeze.

## Limitations / Missing inputs

1. **Không có checkout HRP core.** Toàn bộ DTO chỉ đối chiếu Master
   V2.6 / connector v1.0 / Backlog Gate0. Mọi claim "schema validate"
   KHÔNG chứng minh runtime HRP đã xác thực.
2. **Fill-missing + EXACT-review + lifecycle → canonical** là runtime
   decision; schema chỉ bind shape + flag. Owner/Chủ nhân/HRP-side
   quyết policy.
3. **`contracts.synthetic.mjs`** (rename từ `contracts.test.mjs`) chứa
   test do agent nội bộ đặt; vẫn BLOCKED-OWNER, không đại tu baseline.
4. **Audit gate chưa động.** Self-check bằng 75 fixtures runtime;
   không thay thế independent audit.

## Bundle ổn định

Repo chưa có commit. Working tree ổn định:

```
.gitignore                                       (có sẵn)
docs/Importal/*.md                               (baseline, không đụng)
docs/contracts/inventory.md                      (giữ + append G0/0.3 section)
docs/contracts/decision-register.md              (giữ + append Q-13..Q-18)
docs/contracts/checkpoint.g0-0.0-0.2.md          (mới)
docs/contracts/handoff-g0-0.3a-0.3b.md           (mới — file này)
docs/contracts/g0-0.0-0.2-handoff.md             (giữ)
packages/contracts/package.json + package-lock.json + tsconfig.json (giữ)
packages/contracts/src/index.ts                  (giữ + re-export commands/*)
packages/contracts/src/enums.ts                  (giữ)
packages/contracts/src/primitives.ts             (giữ)
packages/contracts/src/errors.ts                 (giữ)
packages/contracts/src/envelopes.ts              (giữ)
packages/contracts/src/commands/evidence.ts      (mới)
packages/contracts/src/commands/identity.ts      (mới)
packages/contracts/src/commands/profile.ts       (mới)
packages/contracts/src/commands/intake.ts        (mới)
packages/contracts/tests/enums.test.mjs          (giữ)
packages/contracts/tests/errors.test.mjs         (giữ)
packages/contracts/tests/envelopes.test.mjs      (giữ)
packages/contracts/tests/identity.test.mjs       (mới — 18 fixtures)
packages/contracts/tests/profile-intake.test.mjs (mới — 25 fixtures)
packages/contracts/tests/contracts.synthetic.mjs (rename từ agent trước)
packages/contracts/tests/_synthetic-pending.md   (mới — giải thích BLOCKED-OWNER)
packages/contracts/README.md                     (giữ)
```

Coder đề xuất commit khi Owner/Chủ nhân confirm Gate 0. Hiện tại không
tự commit.

## Risk classification (theo Execution-Guide §5.3)

- **Shared mutation/review contracts** (MatchingOutcome, IntakeSubmission,
  StaffReviewConfirmation, ProfilePatch) — thuộc diện audit bắt buộc
  theo Owner chỉ thị. Coder đã self-check bằng 75 fixtures runtime;
  KHÔNG tự coi là independent audit. Owner/Chủ nhân quyết gom cùng
  Gate 0 bundle trước freeze.
- Không thuộc HRP core writes / auth / PII direct / data reliability
  side effects / AI side effects — chỉ contracts deterministic.
- Không chạm backend, Prisma, migration, Route Handler, provider thật,
  deploy, gửi tin khách.

## Risks & Open decisions (tổng hợp)

- **R-1**: Workflow HRP review pre/post-apply chưa chốt → lifecycle
  đánh dấu proposed. Nếu Owner sớm chốt có thể nâng canonical.
- **R-2**: EXACT_MATCH có cần staff review bắt buộc cho mọi actor hay
  theo policy? Coder bind shape; policy quyết runtime.
- **R-3**: Fill-missing enforcement runtime (HRP-owned audit job?) chưa
  có; nếu runtime lỏng, fill-missing vô hiệu.
- **R-4**: availableFromDate business clock rule chưa chốt.
- **R-5**: PreviewResolver candidate display label redacted scheme chưa
  chốt.
- **R-6**: DNC OTHER reason bắt buộc note + retention chưa chốt.
- **R-7**: Audit cho shared mutation/review contracts chưa có
  independent PASS.

Tất cả mục trên đã ghi vào `decision-register.md` Q-13..Q-18 + Q-01..Q-12
cũ. Coder không tự quyết; chờ Owner/Chủ nhân/HRP-side chốt.

---

**Trạng thái cuối**:
- G0/0.3a–0.3b: **DONE** (75/75 fixtures PASS, typecheck strict PASS).
- Dừng đúng phạm vi Owner giao.
- Không tự sang G0/0.3c–h, G0/0.4–0.7, G0/0.8.
- Không tự gọi sub-agent khác.
- Không tự commit; chờ Owner review Gate 0 bundle.
