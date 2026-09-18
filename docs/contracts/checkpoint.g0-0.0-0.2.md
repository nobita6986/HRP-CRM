# Checkpoint — G0/0.0–0.2 (đã đóng)

**T1 (Coder)**: 2026-09-13. Workspace `D:\CodeApp\Hrp-Crm`, branch `main`,
chưa có commit. Bundle ổn định bằng working tree.

**Trạng thái**: G0/0.0-0.2 đã đóng. Snapshot source ổn định cho Auditor.

**Đính chính theo Owner instruction 2026-09-14**: Audit PASS ≠ Owner
FREEZE (hai trạng thái riêng biệt); PASS cuối bao gồm F2 follow-up
(`fixtures-fix-f2-gateway-hrpui.test.mjs`) không ghi PASS trước follow-up;
hash ghi SHA-256 thực tế thay vì placeholder "xác minh bằng
Get-FileHash"; quyết định còn thiếu (Q-19, Q-33, Q-34, Q-37, Q-23, Q-32,
OrgScope) chỉ chặn path phụ thuộc, không chặn G0/0.0-0.2.

## Changed files

```
.gitignore                                       (có sẵn)
docs/Importal/*.md                               (có sẵn; baseline)
docs/contracts/inventory.md                      (giữ + bổ sung §cuối)
docs/contracts/decision-register.md              (giữ)
docs/contracts/g0-0.0-0.2-handoff.md             (mới)
packages/contracts/package.json                  (có sẵn)
packages/contracts/package-lock.json             (npm tạo)
packages/contracts/tsconfig.json                 (có sẵn)
packages/contracts/README.md                     (có sẵn)
packages/contracts/src/index.ts                  (giữ)
packages/contracts/src/enums.ts                  (giữ)
packages/contracts/src/primitives.ts             (giữ)
packages/contracts/src/errors.ts                 (giữ)
packages/contracts/src/envelopes.ts              (giữ)
packages/contracts/tests/enums.test.mjs          (giữ)
packages/contracts/tests/errors.test.mjs         (giữ)
packages/contracts/tests/envelopes.test.mjs      (giữ)
packages/contracts/tests/contracts.synthetic.mjs (rename từ contracts.test.mjs)
packages/contracts/tests/_synthetic-pending.md   (mới)
```

`dist/` (build output), `node_modules/`, `.npm-cache/` đã có trong
`.gitignore` — không tracked.

## Hash manifest (SHA-256)

```
$ find . -path ./node_modules -prune -o -path ./dist -prune -o -path ./.npm-cache -prune -o -path ./.git -prune -o -type f -print
.gitignore
docs/Importal/Execution-Guide.HRP-Engagement.md
docs/Importal/Implementation-Backlog.Gate0-V7.9a.md
docs/Importal/Implementation-Backlog.HRP-Owned-V7.9b-f.md
docs/Importal/Implementation-Backlog.V7.10-AI-BoD.md
docs/Importal/Master-Plan.V2.6.md
docs/Importal/hrp-connector.md
docs/contracts/decision-register.md
docs/contracts/g0-0.0-0.2-handoff.md
docs/contracts/inventory.md
packages/contracts/README.md
packages/contracts/package-lock.json
packages/contracts/package.json
packages/contracts/src/enums.ts
packages/contracts/src/envelopes.ts
packages/contracts/src/errors.ts
packages/contracts/src/index.ts
packages/contracts/src/primitives.ts
packages/contracts/tests/_synthetic-pending.md
packages/contracts/tests/contracts.synthetic.mjs
packages/contracts/tests/enums.test.mjs
packages/contracts/tests/envelopes.test.mjs
packages/contracts/tests/errors.test.mjs
packages/contracts/tsconfig.json
```

Hashes (SHA-256, tính 2026-09-14 bằng `Get-FileHash -Algorithm SHA256`):

```
.gitignore                                       1DDD9AC19D54ED8C1900C5740EE27D7A8807DABE6AF93763D52DACF8E950DCE0
docs/Importal/Execution-Guide.HRP-Engagement.md  49B57A23CEACBD8897BBBEE400D3EB786C81083BD0151D3AB8685C408246A1AD
docs/Importal/Implementation-Backlog.Gate0-V7.9a.md  0DFB02809F07F69A9DE897EB349983393E5E7A138DFB7A6BBAB902C94379C73E
docs/Importal/Implementation-Backlog.HRP-Owned-V7.9b-f.md  BE7F9B3F789C62A69460D79D079F5353CFFCF42153706B809CCD41AE02C4A673
docs/Importal/Implementation-Backlog.V7.10-AI-BoD.md  77E5A6FC33E90BD828BDE3D31C8927F88D22F2B486D6ECDDB73F693E4F4314DD
docs/Importal/Master-Plan.V2.6.md                B82EF7A5A36BF7AC9CF19F1E1F57BBB71CFA19F8C3CE81F69AA1F7A9754FC1CC
docs/contracts/decision-register.md              1DDEDF114FB5C6A1ABD2E3C6ABED27804ACBBC6D139E361264BBD9830AE1A14F
docs/contracts/g0-0.0-0.2-handoff.md             823075ED8EA611634B3CD120B64031B6003F614133F6692310D16E185EF54658
docs/contracts/inventory.md                      4EFC23749DFA29FCF51442098D2294797698D20A9F98868ADF98909AFFE1ABB5
packages/contracts/README.md                     (đã có trong contracts bundle; xem bundle đầy đủ §Contracts)
packages/contracts/package-lock.json            31EBFAA71DD86030DE374B4DF62D852A30A32517D7D07A40C0F0629C12604FC0
packages/contracts/package.json                 3E202CA38EC4EF1F4F0FED78F4B571EBB54FD86E6997EEAEFE67956B581AF70E
packages/contracts/src/enums.ts                  FF6EE50AADA938843BFA4546EF0D268EF8EAC702BFA4690D18F396520F1D1581
packages/contracts/src/envelopes.ts              F68EA4866C4F33786B03298CA531B454FF97437200D31457D5AC89D1F32AF4D2
packages/contracts/src/errors.ts                 54DF177848033B509789607377DD92F7319A08988B29558E8100F6C5E7E867E0
packages/contracts/src/index.ts                  BE9E99F29E59A0191BF404A0CC0A8EF39BDF4EF72C8F20099D7F0C73ADE2DF3E
packages/contracts/src/primitives.ts             359A37758E18069ED69E5E1015B8EA00ED18C6B2F598B6125AFCE01962EF56AC
packages/contracts/tests/_synthetic-pending.md   (xem contracts bundle)
packages/contracts/tests/contracts.synthetic.mjs  EDE9DFECCD3A9F148047D872C48D36F15E5B12E3E5609356F5660A3E70572F03
packages/contracts/tests/enums.test.mjs          24C6AC5BDCEE4529E36DE3A9A26A5BF00F6FE0485C8652888B091F2BE4755D91
packages/contracts/tests/envelopes.test.mjs      3D406A11189C02C226CF6C8A6DD423C6622AF3F0C03B4FCC53007D8DE52E26A5
packages/contracts/tests/errors.test.mjs         D5F404E14A748559607557AC2566F7F0141130D0F5A8CE9F1D3C2348E3E5503F
packages/contracts/tsconfig.json                 5AC522BD9ED4375A22933BE65A9E3B00A4C546F34D7EE8A276CC40F8C00058D2
```

Self-reference: file này KHÔNG ghi hash của chính nó.

Để tái lập (nếu cần verify):

```bash
# Trên Windows PowerShell:
Get-FileHash -Algorithm SHA256 <path-to-file> | Select-Object Hash

# Hoặc dùng cross-platform:
find . -path ./node_modules -prune -o -path ./dist -prune -o -path ./.npm-cache -prune -o -path ./.git -prune -o -type f -print0 | sort -z | xargs -0 sha256sum
```

## Commands / results

### Typecheck

```
$ cd packages/contracts && npm run typecheck
> @hrp-engagement/contracts@0.0.1-g0.1 typecheck
> tsc --noEmit
(exit 0, no output)
```

### Test (npm run build + node --test)

```
$ npm test
> @hrp-engagement/contracts@0.0.1-g0.1 test
> npm run build && node --test tests/*.test.mjs

> tsc

✔ placement stages đúng 8 giá trị đã chốt
✔ case status chỉ ACTIVE/CLOSED, đóng duy nhất là CLOSED
✔ close reason đúng 9 giá trị, không có stage nào lẫn vào
✔ availability đúng 5 giá trị
✔ current relationship đúng 5 giá trị, đánh dấu read-only
✔ matching outcomes là command result, không thêm matching state mới
✔ next action status là 3 giá trị độc lập
✔ closed_variants cấm luôn bị reject
✔ schema version pin cho envelope
✔ request envelope base hợp lệ với USER actor và HRP_UI source
✔ malformed actor (USER có delegatedBy) bị reject
✔ actor SERVICE thiếu delegatedBy vẫn pass (audit sẽ kiểm runtime)
✔ source HRP_UI không được gán là Zalo adapter giả
✔ unknown schema version bị reject
✔ idempotency key vượt giới hạn độ dài bị reject
✔ correlation id và idempotency key tồi tại độc lập
✔ ACCEPTED response có operation reference, không có data
✔ APPLIED response yêu cầu data, errors rỗng
✔ APPLIED base schema chấp nhận data unknown ở layer envelope chung
✔ FAILED response không được có data hữu dụng
✔ idempotency: same payload digest → trùng
✔ idempotency: different payload digest → khác
✔ canonicalize sort key ổn định
✔ error code đủ 10 loại
✔ retry defaults: validation/forbidden/version conflict không retry
✔ retry defaults: dependency/rate-limit là retryable
✔ HTTP hint ổn định theo code
✔ makeError cấm chứa raw stack/provider body
✔ field path phải là JSON pointer, không chứa giá trị
✔ ErrorList minimum 1, maximum 64
✔ messageKey bắt buộc, dùng để UI dịch
✔ retry detail có retryAfterSec giới hạn
ℹ tests 32
ℹ pass 32
ℹ fail 0
ℹ duration_ms 153.987
```

## AC từng mục

### G0/0.0 — Inventory & ownership — **PASS**

- Mỗi command/query/event có owner, consumer, trạng thái, nguồn —
  `docs/contracts/inventory.md` §Commands/§Queries/§Events.
- Open-status, transitions, review pre/post-apply, managed-mode, KPI
  attribution ghi là cần domain review — `decision-register.md` D-001..D-021
  và §"Open questions" Q-01..Q-12.
- Phân biệt Integration DB được phép với HRP core không được truy cập —
  `inventory.md` §"Storage / gates" + D-014, D-019.

### G0/0.1 — Enums & constants — **PASS**

- 8 stages, CLOSED duy nhất, 9 closeReason, 5 Availability, 5
  CurrentRelationship (read-only), NextAction OPEN/DONE/CANCELLED,
  matching outcomes 3 giá trị, FORBIDDEN_CLOSED_VARIANTS —
  `packages/contracts/src/enums.ts` + tests/enums.test.mjs 9/9.

### G0/0.2 — Envelopes + error taxonomy — **PASS**

- ACCEPTED/APPLIED/FAILED discriminated union; operation reference
  bền; idempotency SHA-256 + canonical JSON; 10 error codes với
  retry defaults + HTTP hint; StructuredError chỉ field an toàn —
  `src/envelopes.ts`, `src/errors.ts`, `src/primitives.ts`. Tests
  `envelopes.test.mjs` (12) + `errors.test.mjs` (11) = 23/23.

## AC FAIL / BLOCKED còn tồn đọng

- **BLOCKED-OWNER (theo Owner/Chủ nhân)**: 12 open questions Q-01..Q-12
  trong `decision-register.md` (transitions matrix, managed-mode, OTHER
  explanation, actor cho automated interactions, signature protocol,
  …). Coder tạm ghi lại; không tự quyết.
- **BLOCKED-ENV**: thiếu HRP core checkout, schema Prisma, `AGENTS.md`,
  `AI_CODING_GUARDRAILS.md`, auth IdP thật, endpoint thực — không
  contracts runtime gate nào xác minh được.
- **BLOCKED-AUDIT**: shared contract (actor/source/envelope) thuộc
  diện audit theo Execution-Guide §5.3; chưa có independent audit
  PASS. Owner quyết gom cùng Gate 0 bundle.

Không có AC FAIL tự thuộc Coder — toàn bộ 32/32 fixtures pass strict
typecheck. Tiếp tục G0/0.3a–0.3b với evidence đủ, không cần chờ
commit/PR.
