# Handoff — CORE/1.0 (Scaffold và boundaries)

**T1 (Coder)**: 2026-09-14. Workspace `D:\CodeApp\Hrp-Crm`, branch `main`,
HEAD `414c54b` (Gate 0 freeze đã Owner xác nhận).
**Checkpoint ref**: `docs/contracts/checkpoint.gate-0-freeze.md`.

## Task ID

- `CORE/1.0` — Scaffold và boundaries.
- Backlog §0.0 task 1.0.

## Output

| Path | Mô tả |
|---|---|
| `packages/config/` | Shared config types + loader; pin contracts `0.0.8-g0.8-fixes` |
| `apps/integration-api/` | HTTP API mock (webhook receiver + health) |
| `apps/integration-worker/` | Background worker scaffold (mock tick + health) |
| `apps/context-panel/` | UI mock panel (static HTML + health) |
| `packages/config/examples/env.synthetic.example.ts` | Synthetic env (KHÔNG có giá trị thật) |
| `apps/integration-api/.env.synthetic.example` | API env synthetic |
| `apps/integration-worker/.env.synthetic.example` | Worker env synthetic |
| `apps/context-panel/.env.synthetic.example` | Panel env synthetic |

## AC theo Backlog §1.0

| AC | Status | Evidence |
|---|---|---|
| Runtime/API/worker config tách | **PASS** | `packages/config/src/types.ts` — `ApiConfig`/`WorkerConfig`/`PanelConfig` discriminated union theo `appKind` |
| Contracts version pinned exact | **PASS** | `RuntimeConfigSchema.contractsVersion: z.literal('0.0.8-g0.8-fixes')` — test "contractsVersion pin 0.0.8-g0.8-fixes" PASS ở cả 3 apps + config |
| Không import HRP Prisma client | **PASS** | `FORBIDDEN_ENV_KEYS` ở loader reject `HRP_DATABASE_URL`/`HRP_PRISMA_CLIENT_PATH`/`HRP_CORE_DSN`/`HRP_CANONICAL_DSN`; tests "HRP_DATABASE_URL bị reject" PASS ở 3 apps + config |
| Không đặt HRP core DSN | **PASS** | Loader reject + superRefine ở `RuntimeConfigSchema`; tests PASS |
| Mock mode hiển thị rõ | **PASS** | `mockMode: 'off' \| 'deterministic'`; mọi response health/ready + log startup đều có `mockMode`/`production`/`mockAllowed` |
| Startup chặn mock production | **PASS** | `assertNotProductionMock(env)` throw `STARTUP_BLOCKED`; test "assertNotProductionMock throws ở production + mock" PASS ở 3 apps + config |
| Dependencies có lockfile | **PASS** | Mỗi package có `package.json` + `package-lock.json` (sinh bởi `npm install`) |
| Synthetic env example | **PASS** | 3 file `.env.synthetic.example` + `packages/config/examples/env.synthetic.example.ts` |
| Health phân biệt alive/dependency ready | **PASS** | `/health/live` (process alive) tách `/health/ready` (config loaded + pinned + `dependenciesConnected: false`); tests PASS ở 3 apps |
| Không báo dependency connected khi chưa triển khai | **PASS** | `dependenciesConnected: false` ở mọi response ready; tests "dependenciesConnected=false" PASS ở 3 apps |

## Commands / results

### Typecheck

```bash
$ cd packages/config && npm run build
> @hrp-engagement/config@1.0.0-core1.0 build
> tsc
(exit 0)

$ cd apps/integration-api && npm run build
> @hrp-engagement/integration-api@1.0.0-core1.0 build
> tsc
(exit 0)

$ cd apps/integration-worker && npm run build
> @hrp-engagement/integration-worker@1.0.0-core1.0 build
> tsc
(exit 0)

$ cd apps/context-panel && npm run build
> @hrp-engagement/context-panel@1.0.0-core1.0 build
> tsc
(exit 0)

# Contracts package — không đổi sau Gate 0 freeze
$ cd packages/contracts && npm run typecheck
> @hrp-engagement/contracts@0.0.8-g0.8-fixes typecheck
> tsc --noEmit
(exit 0)
```

### Tests

```bash
$ cd packages/config && npm test
ℹ tests 13
ℹ pass 13
ℹ fail 0

$ cd apps/integration-api && npm test
ℹ tests 9
ℹ pass 9
ℹ fail 0

$ cd apps/integration-worker && npm test
ℹ tests 9
ℹ pass 9
ℹ fail 0

$ cd apps/context-panel && npm test
ℹ tests 11
ℹ pass 11
ℹ fail 0

# Contracts (Gate 0 freeze — không đổi)
$ cd packages/contracts && npm test
ℹ tests 398
ℹ pass 398
ℹ fail 0
```

**Tổng CORE/1.0 fixtures**: 13 + 9 + 9 + 11 = **42 fixtures PASS** (mới).
**Gate 0 fixtures**: 398/398 PASS (giữ nguyên).

## Snapshot & hash

- HEAD: `414c54bfa2e227ec1a25694310e48908e0d67abe` (Gate 0 freeze).
- Working tree: untracked (CORE/1.0 mới + Gate 0 bundle đã đối chiếu).
- `git diff --stat HEAD`: rỗng (không tracked modified).
- Contracts package version: `0.0.8-g0.8-fixes` (pinned exact ở config + 3 apps).
- Config/apps versions: `1.0.0-core1.0` (chưa bump — scaffold).

## Decisions / blockers

### Quyết định

- **Config loader tách `ZodObject` (không `ZodEffects`)** để `discriminatedUnion` ở
  `ConfigSchema` type-check đúng. Panel có `superRefine` riêng (allowDevTools
  guard) — variants trong union dùng `PanelConfigObject`, không qua refine.
- **App entrypoint guard pattern**: mỗi app export `startXxx(config)` để test
  có thể gọi trực tiếp mà không cần start process. Auto-start chỉ khi
  `process.argv[1]` match filename pattern.
- **Mock `deterministic` vs `off`**: chỉ 2 giá trị. Production cấm cả hai không
  phải — `off` là default safe. Worker tick chỉ chạy khi mockMode !== 'off'
  để không spam log ở production.
- **Health ports**:
  - `apps/integration-api` — listen config (mặc định 4001).
  - `apps/integration-worker` — ephemeral port (random); chỉ để health probe.
  - `apps/context-panel` — listen config (mặc định 4003).

### Không tự quyết (chờ Owner/HRP-owned PR)

- Auth/IdP thật — CORE/1.0 không có.
- Signature protocol (Q-33) — chưa xác minh.
- HYBRID policy (Q-34) — đề xuất kỹ thuật.
- Dual-control AI (Q-37) — runtime HRP gate.
- Review workflow (G0-07/Q-7) — PROPOSED.
- Transitions matrix (G0-06/Q-19) — chưa chốt.
- Managed mode (G0-08) — placement EFFECTIVE workflow unknown.
- Client domain (Q-23) — field bindings PROPOSED.

## Risk classification (theo Execution Guide §5.3)

| Nhóm | Status | Ghi chú |
|---|---|---|
| Shared contract | LOW | CORE/1.0 chỉ đọc contracts; không sửa schema |
| HRP core/domain writes | NONE | Scaffold mock, không DB thật |
| Auth/permissions/PII | LOW | Mock chỉ; không credential thật |
| Data reliability | NONE | Chưa có store |
| AI có quyền/dữ liệu | NONE | Mock |
| Chỉ số quản trị | NONE | Mock |
| UI trình bày | LOW | Static HTML mock |
| Mock/read-only prototype | YES | CORE/1.0 đúng phân loại — không audit mặc định |
| Docs/copy/refactor | LOW | README + .env.example |

**Boundary/security changes** cần Owner review:
- `FORBIDDEN_ENV_KEYS` list ở config loader (HRP core markers cấm).
- `assertNotProductionMock` startup guard.

Theo §5.3: "Mock/read-only prototype cô lập → Không mặc định". CORE/1.0
thuộc nhóm này. Boundary/security changes ở loader là **LOW** risk
(constraint enforcement, không policy thật) nhưng vẫn liệt kê để Owner
biết.

## Scope đã dừng

- Chỉ CORE/1.0; chưa gateway mock (1.1), webhook receiver (1.2), store (1.3),
  queue/lease (1.4), normalize (1.5), intake orchestration (1.6), review
  service (1.7), retry/DLQ (1.8), context panel UI thật (1.9).
- Không canonical HRP runtime, auth/provider/model thật, deploy.
- Không chốt review workflow, transitions, Client domain, managed modes.

## Out-of-scope từ chối

- Không thêm dep ngoài `zod`, `typescript`, `@types/node`, `tsx` (dev).
- Không tự commit git (HEAD vẫn `414c54b`).
- Không tự merge/push/deploy.
- Không tự chốt policy/transition bất kỳ.
