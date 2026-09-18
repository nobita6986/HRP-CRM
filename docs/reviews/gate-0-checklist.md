# Gate 0 â€” Review Bundle & Freeze Checklist

> **Task:** G0/0.8 â€” Gate 0 REVIEW BUNDLE + FREEZE.
> **Head:** `414c54bfa2e227ec1a25694310e48908e0d67abe` (branch `main`,
> chÆ°a commit).
> **Owner:** Chá»§ nhÃ¢n (sign-off cuá»‘i).
> **Coder:** T1.
> **Independent audit:** **PENDING** â€” chÆ°a cÃ³ Auditor Ä‘á»™c láº­p review
> (ngÆ°á»i/agent, pháº¡m vi, snapshot, verdict). Äá»£t 0.8 chá»‰ lÃ  T1 self-check
> + review ná»™i bá»™; Owner cÃ³ quyá»n yÃªu cáº§u independent audit trÆ°á»›c khi
> FREEZE. Do Ä‘Ã³ tráº¡ng thÃ¡i hiá»‡n táº¡i: **READY FOR INDEPENDENT AUDIT**,
> chÆ°a pháº£i `READY-TO-FREEZE`.

---

## Â§1 â€” Scope & authority

### 1.1 Pháº¡m vi bundle

Bundle Gate 0 gá»“m 5 phase tasks contracts + matrix + fixtures + README + CHANGELOG
(bÃ¡m sÃ¡t theo `Implementation-Backlog.Gate0-V7.9a.md Â§0.x`):

| # | Task | Output | Tráº¡ng thÃ¡i |
|---|---|---|---|
| 1 | G0/0.0â€“0.2 (Phase 0) | `primitives.ts`, `envelopes.ts`, `errors.ts`, `enums.ts`, baseline identity/evidence | DONE self-check (**32** fixtures PASS, typecheck strict) |
| 2 | G0/0.3aâ€“0.3b | `identity.ts`, `evidence.ts`, `profile.ts`, `intake.ts` (preview, completion, review) | DONE self-check (**75** fixtures PASS â€” 18 identity + 25 profile-intake + 32 baseline) |
| 3 | G0/0.3câ€“0.3d | `placement-case.ts`, `interactions.ts` (stage transitions, occurred/effective/recordedAt) | DONE self-check (**143** fixtures PASS â€” delta +68: 38 placement-case + 30 enum-extra/synthetic) |
| 4 | G0/0.3eâ€“0.3f | `availability.ts`, `suppression.ts`, `next-action.ts`, `scheduling.ts` (DNC, snooze, planning batch) | DONE self-check (**200** fixtures PASS â€” delta +57: 13 availability + 17 suppression + 16 next-action + 11 scheduling) |
| 5 | G0/0.3gâ€“0.3h | `outbox.ts`, `gateway.ts`, `providers.ts`, `ports.ts` (delivery, webhooks, ports) | DONE self-check (**237** fixtures PASS â€” delta +37: 16 outbox + 19 gateway-providers-ports + Q-28 sá»­a) |
| 6 | G0/0.4 | `queries.ts`, `events.ts`, `mappings.ts` (ContextQuery, EventEnvelope, ExternalContactLink, ConversationLink) | DONE self-check (**280** fixtures PASS â€” delta +43 queries-events-mappings) |
| 7 | G0/0.5 | `routing.ts`, `analytics.ts`, `kpi.ts`, `ai-proposals.ts`, `ai-provider-config.ts` (routing strategy, metrics, AI proposal) | DONE self-check (**313** fixtures PASS â€” delta +33 routing-analytics-kpi-ai, Q-32 sá»­a `pendingId` â†’ `pendingReference`) |
| 8 | G0/0.6 | `docs/contracts/authorization-policy-matrix.md` | DONE self-check (matrix markdown PASS; **48 dÃ²ng matrix** tá»•ng Â§3â€“Â§8; khÃ´ng runtime test) |
| 9 | G0/0.7 | `README.md`, `CHANGELOG.md`, +59 fixtures coverage (313 â†’ **372**) | DONE self-check (**372/372** PASS â€” delta +59 fixtures-coverage-0.7) |
| **10** | **G0/0.8** | **`docs/reviews/gate-0-checklist.md` (file nÃ y) + handoff + manifest** | **DONE self-check (review checklist, khÃ´ng runtime test; chÆ°a cÃ³ independent audit)** |

### 1.2 Authority & nguá»“n

Bundle Gate 0 Ä‘á»c vÃ  bÃ¡m sÃ¡t theo thá»© tá»± Æ°u tiÃªn:

1. `Master-Plan.V2.6.md` (Master HRP) â€” source-of-truth nghiá»‡p vá»¥.
2. `hrp-connector.md` **v1.1** táº¡i HEAD `414c54b` â€” connector bÃ¡o cÃ¡o tá»«
   source HRP (Ä‘Ã£ Ä‘á»‘i chiáº¿u trong `decision-register.md` Â§"Connector v1.1
   delta").
3. `Implementation-Backlog.Gate0-V7.9a.md` Â§0.0â€“0.8 â€” AC tá»«ng task.
4. `Execution-Guide.HRP-Engagement.md` Â§5.3 â€” quy trÃ¬nh review & freeze.

Bundle KHÃ”NG tá»± Ã½ claim Ä‘Ã£ Ä‘á»c HRP checkout hay schema HRP runtime; connector
chá»‰ lÃ  delta mÃ  Owner Ä‘Ã£ chá»‰ thá»‹. Core HRP schema/auth/guardrails thuá»™c
runtime gate PROPOSED (xem Â§3).

### 1.3 Self-check evidence (sau Ä‘á»£t 0.8 â€” T1 self-check, khÃ´ng pháº£i independent audit)

| BÆ°á»›c | Káº¿t quáº£ |
|---|---|
| `npm run typecheck` (packages/contracts) | **PASS** â€” `tsc --noEmit` strict, khÃ´ng lá»—i |
| `npm test` (packages/contracts) | **PASS** â€” **372/372** fixtures runtime, 0 fail, 0 cancel, 0 skip, duration ~634ms |
| `git status --porcelain` | **PASS** â€” khÃ´ng cÃ³ tracked modified; chá»‰ untracked docs/reviews + docs/contracts/handoff-g0-0.8.* má»›i + 2 sá»­a vÄƒn báº£n (a) (b) trong Â§0.8 |
| Forbidden paths | **PASS** â€” khÃ´ng cÃ³ `prisma/`, `app/api`, `apps/`, `packages/integration-store/`, `migration/`, `src/backend`, `src/server` |
| Forbidden deps | **PASS** â€” `packages/contracts/package.json` chá»‰ cÃ³ `zod@3.24.2` (dep) + `typescript@5.7.3` (devDep) |
| Matrix rows count (Â§3â€“Â§8) | **48 dÃ²ng** â€” Ä‘áº¿m báº±ng regex `^\|\s*[A-Z]?\d+\s*\|` trÃªn `authorization-policy-matrix.md` (Â§3 Commands 18 + Â§4 Queries 7 + Â§5 Events 5 + Â§6 Mapping DTOs 2 + Â§7 Routing/Analytics/KPI/AI 12 + Â§8 Ports/Provider/Gateway 4) |

**LÆ°u Ã½**: báº£ng trÃªn lÃ  T1 self-check. **ChÆ°a cÃ³ independent audit
PASS** â€” khÃ´ng cÃ³ nguá»“n/Auditor Ä‘á»™c láº­p review (ngÆ°á»i/agent, pháº¡m vi,
snapshot, verdict) cho claim `7/7 PASS, 372/372 READY-TO-FREEZE` Ä‘á»£t
trÆ°á»›c; Ä‘á»£t 0.8 ghi nháº­n tráº¡ng thÃ¡i hiá»‡n táº¡i: **READY FOR INDEPENDENT
AUDIT** (xem Â§5, Â§8).

---

## Â§2 â€” Command-by-command review table (AC1)

Má»—i section tá»•ng há»£p tá»« `authorization-policy-matrix.md` (0.6) + handoff
tÆ°Æ¡ng á»©ng (0.3aâ€“0.7). Má»—i section cÃ³ 1 báº£ng:

> **Command/Query | Fields (input) | Result | Permission (tier) | Invariants | Error/Retry | Files**

Permission tier theo `gateway.ts HRP_GATEWAY_METHODS`:

- **INBOUND_DEFAULT** â€” USER / SERVICE / DELEGATED_USER
- **INBOUND_REVIEWER** â€” USER (reviewer capability, runtime gate)
- **PRIVILEGED_MERGE** â€” USER (privileged capability, runtime gate)

Error/Retry class theo `errors.ts` taxonomy (Q-2): `NEVER` /
`REVIEW_REQUIRED` / `REFRESH_AND_REVIEW` / `REAUTHENTICATE` /
`BOUNDED_SAME_KEY` / `RECONCILE_FIRST`.

Má»—i row cuá»‘i cite path file + dÃ²ng tham chiáº¿u matrix (náº¿u cÃ³).

### Â§2.1 â€” `identity.ts`

| Command/Query | Fields (input) | Result | Permission (tier) | Invariants | Error/Retry | Files (path + matrix ref) |
|---|---|---|---|---|---|---|
| `IdentityClaimSchema` (DTO) | `organizationId` + claim cáº¥u trÃºc (userId/serviceId/delegationRef) | n/a (DTO) | INBOUND_DEFAULT (audit) | actor runtime HRP auth (Q-3); KHÃ”NG chá»©ng minh Ä‘Ã£ authenticated; KHÃ”NG giáº£ actor tá»« assignee | `VALIDATION_ERROR` â†’ `NEVER`; `AUTHENTICATION_REQUIRED` â†’ `REAUTHENTICATE` | `packages/contracts/src/commands/identity.ts`; matrix Â§3 row 1 (`createOrMatchLaborProfile` actor kind) |
| Identity `enum: ACTOR_KINDS` | USER / SERVICE / DELEGATED_USER | n/a (constants) | n/a | Q-3 proposed â€” runtime HRP gate | n/a | `packages/contracts/src/enums.ts` |

### Â§2.2 â€” `evidence.ts`

| Command/Query | Fields (input) | Result | Permission (tier) | Invariants | Error/Retry | Files |
|---|---|---|---|---|---|---|
| `EvidenceRefSchema` | opaque ref (no raw URL / base64 / scan flags) | n/a (DTO) | INBOUND_DEFAULT | opaque (Q-2); strict reject raw URL/base64/flag; VN residency gate runtime PROPOSED | `VALIDATION_ERROR` â†’ `NEVER` | `packages/contracts/src/commands/evidence.ts`; matrix Â§9 (audit evidence) |
| Evidence constants (tier allowlist) | `EvidenceKind` (PHOTO/DOCUMENT/...) | n/a (constants) | n/a | Q-2 + Q-7 (CCCD residency VN, retention runtime gate PROPOSED) | n/a | `packages/contracts/src/commands/evidence.ts` |

### Â§2.3 â `merge-review.ts` (F1 placeholder â PROPOSED/UNAVAILABLE)

> Â§2.3 ÄÃ£ ÄÆ°á»£c cáº­p nháº­t tá»« `profile.ts` sang `merge-review.ts` (F1). `profile.ts`
> giá»¯ nguyÃªn section riÃªng á» Â§2.24 (cuá»i báº£ng). Ná»i dung tham chiáº¿u F1
> placeholder schemas (xem `docs/contracts/decision-register.md` Q-38).

| Command/Query | Fields (input) | Result | Permission (tier) | Invariants | Error/Retry | Files |
|---|---|---|---|---|---|---|
| `MergeLaborProfilesInputSchema` | `schemaVersion` + `organizationId` + `marker.proposedUnavailable` + `marker.proposedAuditRef` | placeholder (parsed marker) | PRIVILEGED_MERGE | Q-19/Q-23/Q-37 audit ref Báº®T BUá»C; schema reject náº¿u marker thiáº¿u; runtime review workflow chÆ°a chá»t | `VALIDATION_ERROR` â `NEVER`; runtime HRP-owned workflow â `REVIEW_REQUIRED` | `packages/contracts/src/commands/merge-review.ts`; matrix Â§3 row 3 (PROPOSED/UNAVAILABLE) |
| `CommitReviewDecisionInputSchema` | `schemaVersion` + `organizationId` + `marker.proposedUnavailable` + `marker.proposedAuditRef` | placeholder (parsed marker) | INBOUND_REVIEWER | Q-7 review workflow chÆ°a chá»t; dual-control (Q-37) runtime HRP-owned | `VALIDATION_ERROR` â `NEVER`; runtime â `REVIEW_REQUIRED` | `packages/contracts/src/commands/merge-review.ts`; matrix Â§3 row 15 (PROPOSED/UNAVAILABLE) |
| `ResolvePossibleMatchInputSchema` | `schemaVersion` + `organizationId` + `marker.proposedUnavailable` + `marker.proposedAuditRef` | placeholder (parsed marker) | INBOUND_REVIEWER | Q-19/Q-23 audit ref Báº®T BUá»C; resolve workflow chÆ°a chá»t | `VALIDATION_ERROR` â `NEVER`; runtime â `REVIEW_REQUIRED` | `packages/contracts/src/commands/merge-review.ts`; matrix Â§3 row 16 (PROPOSED/UNAVAILABLE) |
| `SupersedeReviewStatusInputSchema` | `schemaVersion` + `organizationId` + `marker.proposedUnavailable` + `marker.proposedAuditRef` | placeholder (parsed marker) | PRIVILEGED_MERGE | Q-19/Q-23/Q-37 audit ref Báº®T BUá»C; supersede workflow chÆ°a chá»t | `VALIDATION_ERROR` â `NEVER`; runtime â `REVIEW_REQUIRED` | `packages/contracts/src/commands/merge-review.ts`; matrix Â§3 row 17 (PROPOSED/UNAVAILABLE) |
| `ProposedUnavailableMarkerSchema` | `proposedUnavailable: true` + `proposedUnavailableReason` (1..500, no URL/base64) + `proposedAuditRef` (1..8 Q refs) + `proposedAt` (ISO datetime, optional) | marker | n/a (marker shape) | F1 minimum Auditor-approved approach; reason khÃ´ng chá»©a URL/base64; audit ref khÃ´ng rá»ng | `VALIDATION_ERROR` â `NEVER` | `packages/contracts/src/commands/merge-review.ts` |
| `buildProposedUnavailableMarker` (helper) | `reason` + `auditRefs` + `proposedAt?` | marker | n/a (helper) | marker builder; canonical pattern cho F1/F4/F5 placeholder schemas | n/a | `packages/contracts/src/commands/merge-review.ts` |
| `isProposedUnavailable` (helper) | `input: unknown` | `boolean` | n/a (helper) | guard check `proposedUnavailable === true`; runtime gate check `isProposedUnavailable(payload)` trÆ°á»c khi apply | n/a | `packages/contracts/src/commands/merge-review.ts` |
### Â§2.4 â€” `intake.ts`

| Command/Query | Fields (input) | Result | Permission (tier) | Invariants | Error/Retry | Files |
|---|---|---|---|---|---|---|
| Intake DTOs | signals + state machine cho ProfileCompletion | `ProfileCompletionStateSchema` | INBOUND_DEFAULT | Q-13 EXACT review; Q-17 PreviewResolver redacted PII runtime PROPOSED; DNC KHÃ”NG bá»‹ Ã©p intake/CCCD (Q-18) | `VALIDATION_ERROR` â†’ `NEVER`; `UNRESOLVED_IDENTITY` â†’ `REVIEW_REQUIRED` | `packages/contracts/src/commands/intake.ts` |
| `ReadOnlyIdentityPreview` | signals (no NEW enforcement) | `PreviewCandidateSchema[]` (â‰¤ 16) | INBOUND_DEFAULT (read) | read-only; KHÃ”NG gá»i createOrMatch; redacted PII runtime gate PROPOSED (Q-17) | `NEVER` (read) | `packages/contracts/src/commands/intake.ts`; matrix Â§4 Q2 |

### Â§2.5 â€” `placement-case.ts`

| Command/Query | Fields (input) | Result | Permission (tier) | Invariants | Error/Retry | Files |
|---|---|---|---|---|---|---|
| `openPlacementCase` | optional `laborProfileId` + initial stage | `placementCaseId` + `version` | INBOUND_DEFAULT | one-active-case runtime HRP gate (Q-19) | `POLICY_REJECTION` â†’ `REVIEW_REQUIRED`; `VALIDATION_ERROR` â†’ `NEVER` | `packages/contracts/src/commands/placement-case.ts`; matrix Â§3 row 4 |
| `updatePlacementCase` | `placementCaseId` + `expectedVersion` + patch | `appliedPatch` + `appliedVersion` | INBOUND_DEFAULT | schema enum `PLACEMENT_CASE_STAGES` 8 giÃ¡ trá»‹ CONFIRMED (Q-24); transitions runtime PROPOSED (Q-19) | `VALIDATION_ERROR` â†’ `NEVER`; `VERSION_CONFLICT` â†’ `REFRESH_AND_REVIEW`; `POLICY_REJECTION` â†’ `REVIEW_REQUIRED` | matrix Â§3 row 5 |
| `closePlacementCase` | `placementCaseId` + `expectedVersion` + `closeReason` (9 giÃ¡ trá»‹ Master Â§10.6.1) | `appliedStatus = CLOSED` | INBOUND_DEFAULT | CLOSED + closeReason riÃªng (G0 baseline); Q-20 SUCCESS KHÃ”NG tá»± EFFECTIVE; Q-19 transitions unknown | `VALIDATION_ERROR` â†’ `NEVER`; `POLICY_REJECTION` â†’ `REVIEW_REQUIRED` | matrix Â§3 row 6 |

### Â§2.6 â€” `interactions.ts`

| Command/Query | Fields (input) | Result | Permission (tier) | Invariants | Error/Retry | Files |
|---|---|---|---|---|---|---|
| `recordInteraction` (Talent) | `laborProfileId` + optional `placementCaseId` + `occurredAt` / `effectiveAt` / `recordedAt` | `InteractionId` + `version` | INBOUND_DEFAULT (USER/SERVICE/DELEGATED_USER); INTEGRATION source yÃªu cáº§u provider + connectionId (CHATWOOT/ZALO_OA) | Q-21 auth/delegation runtime PROPOSED; Q-22 3 timestamps PHÃ‚N BIá»†T (KHÃ”NG enforce `occurredAt â‰¤ effectiveAt â‰¤ recordedAt` á»Ÿ schema) | `VALIDATION_ERROR` â†’ `NEVER`; `UNRESOLVED_IDENTITY` â†’ `REVIEW_REQUIRED` | matrix Â§3 row 7 |
| `recordClientInteraction` | `clientReferenceId` opaque + 3 timestamps | `InteractionId` + `version` | INBOUND_DEFAULT | Q-23 Client required context UNRESOLVED/PROPOSED â€” `UNKNOWN` KHÃ”NG Ä‘á»§ chá»©ng minh AC PASS | `VALIDATION_ERROR` â†’ `NEVER`; `POLICY_REJECTION` â†’ `REVIEW_REQUIRED` | matrix Â§3 row 8 |

### Â§2.7 â€” `availability.ts`

| Command/Query | Fields (input) | Result | Permission (tier) | Invariants | Error/Retry | Files |
|---|---|---|---|---|---|---|
| `updateLaborAvailability` | `laborProfileId` + `expectedVersion` + new availability + `availableFromDate` | `appliedAvailability` + `version` | INBOUND_DEFAULT | Q-25 schema CONFIRMED shape; Q-15 `availableFromDate` ngÃ y lá»‹ch há»£p lá»‡ + future-date business clock runtime PROPOSED; baseline timezone `Asia/Ho_Chi_Minh`; ngÃ y cÅ© khi Ä‘á»•i availability cÃ³ semantics rÃµ nhÆ°ng KHÃ”NG tá»± Ä‘á»•i CurrentRelationship/case | `VALIDATION_ERROR` â†’ `NEVER`; `VERSION_CONFLICT` â†’ `REFRESH_AND_REVIEW` | matrix Â§3 row 9 |
| Availability enum (5 giÃ¡ trá»‹ Master Â§10.6) | `AVAILABILITIES` constants | n/a | n/a | schema bind shape CONFIRMED; runtime gate DO_NOT_CONTACT Ä‘i kÃ¨m suppression event (Q-26) | n/a | `packages/contracts/src/enums.ts` |

### Â§2.8 â€” `suppression.ts`

| Command/Query | Fields (input) | Result | Permission (tier) | Invariants | Error/Retry | Files |
|---|---|---|---|---|---|---|
| `commitSuppression` | target canonical (LABOR_PROFILE / EXTERNAL_CONTACT / SUPPRESSED_RECIPIENT_FENCE) + version | `fenceToken` + result | INBOUND_DEFAULT | Q-26 3 target kinds PROPOSED schema CONFIRMED; stale cache KHÃ”NG cáº¥p quyá»n gá»­i; inbound KHÃ”NG tá»± gá»¡ DNC; unresolved contact local safety suppression khÃ´ng cáº§n táº¡o canonical profile | `VALIDATION_ERROR` â†’ `NEVER`; `POLICY_REJECTION` â†’ `REVIEW_REQUIRED`; `FORBIDDEN` â†’ `NEVER` (no removeSuppression) | matrix Â§3 row 10 |
| `dispatchAuthorizationCheck` | target canonical + channel | `AUTHORIZED` / `SUPPRESSED` / `UNKNOWN` + `fenceToken` + `fenceCutOffAt` | INBOUND_DEFAULT (SERVICE) | Q-26 stale cache fail closed; UNKNOWN fail closed | `BOUNDED_SAME_KEY` (read retry nháº¹) | matrix Â§3 row 11; matrix Â§4 Q4 |

### Â§2.9 â€” `next-action.ts`

| Command/Query | Fields (input) | Result | Permission (tier) | Invariants | Error/Retry | Files |
|---|---|---|---|---|---|---|
| `createNextAction` | target canonical (placementCaseId / clientOpportunityId / standalone) + `expectedVersion` | `nextActionId` + `version` | INBOUND_DEFAULT | Q-27 CREATE statuses âŠ† {OPEN, CANCELLED}; snooze/dismiss KHÃ”NG lÃ  status riÃªng | `VALIDATION_ERROR` â†’ `NEVER`; `POLICY_REJECTION` â†’ `REVIEW_REQUIRED` | matrix Â§3 row 12 |
| `updateNextAction` | `nextActionId` + `expectedVersion` + `revisionId` + patch | `appliedRevision` | INBOUND_DEFAULT | Q-27 snooze/dismiss khÃ¡c DONE; `occurrenceKey` cho reminder dedupe | `VALIDATION_ERROR` â†’ `NEVER`; `VERSION_CONFLICT` â†’ `REFRESH_AND_REVIEW` | matrix Â§3 row 13 |
| Planning batch (multi-item) | per-item target + version (mixed kinds) | `PlanningBatchItemResultSchema[]` (APPLIED/ACCEPTED/FAILED/SKIPPED) + OperationReference cho ACCEPTED | INBOUND_DEFAULT | Q-28 per-item outcome PHÃ‚N BIá»†T; Q-32 ACCEPTED bind canonical `OperationReferenceSchema` (khÃ´ng `appliedId`); `appliedCount + acceptedCount + failedCount + skippedCount = totalItems`; AVAILABILITY batch KHÃ”NG cho DO_NOT_CONTACT | `VALIDATION_ERROR` / `IDEMPOTENCY_CONFLICT` â†’ `NEVER`; `VERSION_CONFLICT` â†’ `REFRESH_AND_REVIEW` | matrix Â§3 row 18; matrix Â§4 (queries O1-O7 náº¿u Ã¡p) |

### Â§2.10 â€” `scheduling.ts`

| Command/Query | Fields (input) | Result | Permission (tier) | Invariants | Error/Retry | Files |
|---|---|---|---|---|---|---|
| `SchedulerPort.enqueue` (internal port) | scheduledAt + commandId | port contract | INBOUND_DEFAULT (SERVICE) | deterministic clock + fault injection runtime gate PROPOSED; timezone `Asia/Ho_Chi_Minh` | n/a (port abstract) | `packages/contracts/src/commands/ports.ts`; matrix Â§8 P2 |
| NextAction `snoozeMode` | `snoozeUntil` + `snoozeMode` | revision applied | INBOUND_DEFAULT | occurrence/revision support reminder dedupe; KHÃ”NG pháº£i status riÃªng | `VALIDATION_ERROR` â†’ `NEVER` | matrix Â§3 row 13 |

### Â§2.11 â€” `outbox.ts`

| Command/Query | Fields (input) | Result | Permission (tier) | Invariants | Error/Retry | Files |
|---|---|---|---|---|---|---|
| `OutboxEnvelope` (handoff DTO) | message + organizationId + target | outbox record | INBOUND_DEFAULT (SERVICE) | Q-31 PUSH_WEBHOOK default; PULL_CLAIM_ACK fallback; ACK sau durable acceptance; handoff khÃ¡c sent/delivered; retry/DLQ KHÃ”NG bypass DNC; KHÃ”NG há»©a exactly-once provider | n/a (outbox) | `packages/contracts/src/commands/outbox.ts`; matrix Â§3 row 14 (queryOutboxDelivery) |
| `queryOutboxDelivery` | outboxId | state + reasonCode | INBOUND_DEFAULT (SERVICE) | delivery reporting state enum; Q-31 transport bind default + fallback | `BOUNDED_SAME_KEY` (read retry nháº¹) | matrix Â§3 row 14 |

### Â§2.12 â€” `gateway.ts`

| Command/Query | Fields (input) | Result | Permission (tier) | Invariants | Error/Retry | Files |
|---|---|---|---|---|---|---|
| `HrpGatewayCallContext` (3 tiers) | actor + source + tier | gateway context | INBOUND_DEFAULT / INBOUND_REVIEWER / PRIVILEGED_MERGE (tier-specific) | Q-3 actor + source; tier-specific rules runtime gate | n/a | matrix Â§8 G1 |
| `WebhookReceiver` | rawBody (Uint8Array) + headers + expectedAlgorithms | verify â†’ parse â†’ DTO | n/a (provider inbound) | raw bytes + raw headers; verify-before-parse; `WEBHOOK_SIGNATURE_ALGORITHMS` allowlist (Q-33); merge capability tÃ¡ch khá»i inbound gateway | n/a | matrix Â§8 G2 |
| `HRP_GATEWAY_METHODS` (allowlist) | commandName registry | n/a | n/a | schema bind CONFIRMED; KHÃ”NG dynamic dispatch by body | n/a | `packages/contracts/src/commands/gateway.ts` |

### Â§2.13 â€” `providers.ts`

| Command/Query | Fields (input) | Result | Permission (tier) | Invariants | Error/Retry | Files |
|---|---|---|---|---|---|---|
| `ProviderConnectionRef` (capabilityToken) | provider + connectionId + opaque token | provider ref | INBOUND_DEFAULT (SERVICE) | `capabilityToken` opaque; KHÃ”NG raw secret | n/a | matrix Â§8 PR1 |
| `ChatwootNormalizedWebhook` | accountId/inboxId/conversationId/... | normalized DTO | n/a (provider inbound) | Q-33 provider KHÃ”NG giá»¯ policy tuyá»ƒn dá»¥ng | n/a | matrix Â§8 PR2 |
| `ZaloOaNormalizedWebhook` | oaId/userId | normalized DTO | n/a (provider inbound) | Q-33 Zalo protocol chÆ°a xÃ¡c minh; runtime gate bind signature; KHÃ”NG tá»± Ä‘áº·t JWT/signature cho Zalo | n/a | matrix Â§8 PR3 |
| `ProviderProbe` | providerId | outcome (OK/FAIL) | INBOUND_DEFAULT (SERVICE) | health check | `BOUNDED_SAME_KEY` (probe retry) | matrix Â§8 PR4 |

### Â§2.14 â€” `ports.ts`

| Command/Query | Fields (input) | Result | Permission (tier) | Invariants | Error/Retry | Files |
|---|---|---|---|---|---|---|
| `WorkerPort.enqueue` | queueName + commandId | enqueue handle | INBOUND_DEFAULT (SERVICE) | `PORTS_FORBIDDEN_IMPORTS` strict reject Prisma/Next.js runtime | n/a (port abstract) | matrix Â§8 P1 |
| `QueuePort.enqueue` | queueName + commandId | enqueue handle | INBOUND_DEFAULT (SERVICE) | n/a | n/a | matrix Â§8 P3 |
| `SecretPort.get` (handle) | secretId + secretVersion | opaque ref + tier | INBOUND_DEFAULT (SERVICE) | Q-7 KHÃ”NG rawSecret; SecretRef opaque + tier (PLATFORM/TENANT/OPERATOR); schema strict reject rawSecret | n/a | matrix Â§8 P4 |
| `ObjectStoragePort.upload` | evidenceId + ttl (â‰¤ 60s cho PII) | signed URL handle | INBOUND_DEFAULT (SERVICE) | Q-7 signed URL TTL â‰¤ 60s cho PII/CCCD; VN residency runtime gate PROPOSED | n/a | matrix Â§8 P5 |
| `ClockPort.now()` (deterministic) | business clock + tz | timestamp | n/a (test port) | test inject | n/a | `packages/contracts/src/commands/ports.ts` |

### Â§2.15 â€” `queries.ts`

| Command/Query | Fields (input) | Result | Permission (tier) | Invariants | Error/Retry | Files |
|---|---|---|---|---|---|---|
| `ContextQuery` | target canonical (Talent/Client) HOáº¶C external (provider ref) + paging | `FieldSnapshot[]` + `unavailableFields` marker | INBOUND_DEFAULT (read) | Q-30 10 fields optional + unavailableFields marker; cache stale KHÃ”NG dÃ¹ng canonical | `NEVER` (read) | matrix Â§4 Q1 |
| `AllowedActionsQuery` | target canonical | tier + privileged flags | INBOUND_DEFAULT (read) | privilege tÃ¡ch riÃªng tier | `NEVER` | matrix Â§4 Q3 |
| `ContactabilityCheck` | target canonical + channel | AUTHORIZED / SUPPRESSED / UNKNOWN + `fenceToken` + `fenceCutOffAt` | INBOUND_DEFAULT (SERVICE) | UNKNOWN = fail closed (Q-26) | `BOUNDED_SAME_KEY` (read retry nháº¹) | matrix Â§4 Q4 |
| `ConstantsSnapshot` | enum package | snapshot + version | INBOUND_DEFAULT (read) | UI/dev KHÃ”NG phá»¥ thuá»™c dictionary API; snapshot enum package + label tables | `NEVER` | matrix Â§4 Q5 |
| `ResolveContactByExternal` | external ref (provider) | `ExternalContactLink` + `ConversationLink` | INBOUND_DEFAULT (read) | Q-29 mutation target láº¥y canonical; KHÃ”NG tá»« Chatwoot/Zalo attributes | `BOUNDED_SAME_KEY` | matrix Â§4 Q6 |
| `ListExternalContactLinks` | provider/connectionId optional | paged link list + cursor + pageSize â‰¤ 100 | INBOUND_DEFAULT (read) | paging + version | `NEVER` | matrix Â§4 Q7 |

### Â§2.16 â€” `events.ts`

| Command/Query | Fields (input) | Result | Permission (tier) | Invariants | Error/Retry | Files |
|---|---|---|---|---|---|---|
| `EventEnvelope` (canonical event emit) | aggregate canonical + version + source + watermark | event record | n/a (SYSTEM/PROVIDER/HRP-side source) | eventId + organizationId + aggregateType/id/version + occurredAt + recordedAt + correlationId + sourceSystem + deliveryChannel + watermark; 10 aggregate types; Q-31 PUSH_WEBHOOK default; correction + watermark | n/a (emit) | matrix Â§5 E1 |
| `EventReceipt` (duplicate/out-of-order/correction) | eventId + payloadDigest | `EventReceiptSchema` + `duplicateKind` + reasonCode (náº¿u GAP/CORRECTION) | n/a (SYSTEM) | 5 duplicate kinds; GAP yÃªu cáº§u reasonCode | n/a (reconcile) | matrix Â§5 E2 |
| `PlacementCaseCreationEvent` | `placementCaseId` + version + attribution | event + creationLabel + optional reviewReference | n/a (SYSTEM) | envelope + attribution + creationLabel PHÃ‚N BIá»†T | n/a | matrix Â§5 E4 |
| `DeliveryReportingEvent` (outbox handoff) | target canonical + provider/connectionId | state (SENT/DELIVERED/FAILED/UNKNOWN/SUPPRESSED) + reasonCode | n/a (PROVIDER/SYSTEM) | Q-31 UNKNOWN KHÃ”NG Ä‘oÃ¡n | n/a (callback) | matrix Â§5 E5 |
| Profile creation event (xem Â§2.3) | xem Â§2.3 | xem Â§2.3 | xem Â§2.3 | Q-16 3 label tÃ¡ch biá»‡t marker proposed; UNAVAILABLE attribution KHÃ”NG Ä‘oÃ¡n | n/a | matrix Â§5 E3 |

### Â§2.17 â€” `mappings.ts`

| Command/Query | Fields (input) | Result | Permission (tier) | Invariants | Error/Retry | Files |
|---|---|---|---|---|---|---|
| `ExternalContactLink` | provider/connectionId + external + state + aggregate canonical | link record | n/a (mapping state) | Q-29 3 states: EXACT_MATCH / POSSIBLE_MATCH / UNRESOLVED; NEW_PROFILE KHÃ”NG mapping state; KHÃ”NG dÃ¹ng external attr value | `NEVER` (mutation) | matrix Â§6 M1 |
| `ConversationLink` | conversationId canonical + externalRefs[] + historyRevisions + currentRevision | link record | n/a (mapping state) | history/context revision; mutation target láº¥y canonical, KHÃ”NG Chatwoot attributes | `NEVER` | matrix Â§6 M2 |

### Â§2.18 â€” `routing.ts`

| Command/Query | Fields (input) | Result | Permission (tier) | Invariants | Error/Retry | Files |
|---|---|---|---|---|---|---|
| `RoutingPool` (SOURCE_ALLOCATION) | fixedOwner | pool record | INBOUND_DEFAULT (USER manager capability â€” runtime gate) | Q-34 SOURCE_ALLOCATION KHÃ”NG weights; fixedOwner required | `NEVER` (config) | matrix Â§7 R1 |
| `RoutingPool` (WEIGHTED_DISTRIBUTION) | weights[] (â‰¥ 1; total > 0) | pool record | INBOUND_DEFAULT (manager) | Q-34 weights â‰¥ 1; KHÃ”NG fixedOwner; total weight > 0 | `NEVER` | matrix Â§7 R2 |
| `RoutingPool` (HYBRID) | fixedOwner + weights[] | pool record | INBOUND_DEFAULT (manager) | Q-34 yÃªu cáº§u cáº£ fixedOwner + weights; runtime gate HYBRID policy PROPOSED | `NEVER` | matrix Â§7 R3 |
| `RoutingDecision` | poolId + poolVersion | `selectedRecipient` + `selectionReason` (3 giÃ¡ trá»‹) + reservation + decisionAt | n/a (SYSTEM trace) | reservation fence; selectionReason 3 giÃ¡ trá»‹ CONFIRMED | n/a | matrix Â§7 R4 |

### Â§2.19 â€” `analytics.ts`

| Command/Query | Fields (input) | Result | Permission (tier) | Invariants | Error/Retry | Files |
|---|---|---|---|---|---|---|
| `MetricDefinition` (read) | metricId + asOf | version + asOf + `attributionState` (AVAILABLE/UNAVAILABLE) + `attributionReasonCode` | INBOUND_DEFAULT (read) | Q-9 3 metricId `profile.created/updated/submitted` PHÃ‚N BIá»†T; Q-30 UNAVAILABLE yÃªu cáº§u reasonCode | `NEVER` | matrix Â§7 A1 |
| `MetricValue` | metricId + asOf | value + asOf + version + `attributionState` | INBOUND_DEFAULT (read) | Q-30 UNAVAILABLE value = 0 placeholder; KHÃ”NG Ä‘oÃ¡n sá»‘ | `NEVER` | matrix Â§7 A2 |
| `MetricAggregateRead` (BoD aggregate) | metricId + period + cohort | aggregate + asOf + version + `attributionState` | INBOUND_DEFAULT (read) | Q-9 BoD KHÃ”NG máº·c Ä‘á»‹nh transcript/evidence; aggregate shape count/rate/duration/currency | `NEVER` | matrix Â§7 (A-series), matrix Â§11 (BoD) |

### Â§2.20 â€” `kpi.ts`

| Command/Query | Fields (input) | Result | Permission (tier) | Invariants | Error/Retry | Files |
|---|---|---|---|---|---|---|
| `KPIAssignment` | assignmentId + targetType + period + targetValue | appliedRevision + appliedAt + operationReference | INBOUND_DEFAULT (USER manager capability â€” runtime gate) | Q-9 cohort periodStart â‰¤ periodEnd; manager marker; **namespace tag `phase10-experimental`** (Q-35) | `NEVER` (manager-only) | matrix Â§7 K1 |
| `KPIRevision` | assignmentId + expectedRevision + new target | revisionId + reasonCode | INBOUND_DEFAULT (manager) | Q-9 manager-only; new target value/rate required; **phase10-experimental** | `NEVER` | matrix Â§7 K2 |
| `KPIPropose` | assignmentId | proposalId + proposedAt | INBOUND_DEFAULT (propose-only) | Q-9 strict reject `mutateTarget`; rationale no URL/base64; sale/AI chá»‰ propose; **phase10-experimental** | `NEVER` (propose-only) | matrix Â§7 K3 |

### Â§2.21 â€” `ai-proposals.ts`

| Command/Query | Fields (input) | Result | Permission (tier) | Invariants | Error/Retry | Files |
|---|---|---|---|---|---|---|
| `AIProposal` (read) | proposalId + revisionId (canonical) | fields[] + uncertainty + providerRef + createdBy + createdAt | INBOUND_DEFAULT (read) | Q-37 strict reject `commandPayload` / `embedCommandPayload`; gáº¯n revision/fields/evidence/uncertainty/context | `NEVER` (proposal) | matrix Â§7 AI1 |
| `ApplyAIProposal` | proposalId + revisionId + acceptedFieldPaths[] + expectedTargetVersion | per-field outcome APPLIED/REJECTED/SKIPPED + appliedVersion + reasonCode | INBOUND_DEFAULT (manager capability â€” runtime gate) | Q-37 acceptedFieldPaths subset-of-proposal runtime enforce; dual-control runtime gate PROPOSED | `VALIDATION_ERROR` â†’ `NEVER`; `POLICY_REJECTION` â†’ `REVIEW_REQUIRED` | matrix Â§7 AI2 |

### Â§2.22 â€” `ai-provider-config.ts`

| Command/Query | Fields (input) | Result | Permission (tier) | Invariants | Error/Retry | Files |
|---|---|---|---|---|---|---|
| `AIProviderConfig` (read DTO) | providerId | version + baseUrl + model + apiStyle + secretRef + capabilities + budget + dataPolicy + createdAt + updatedAt | INBOUND_DEFAULT (USER operator capability â€” runtime gate) | Q-36 read DTO strict reject `apiKey` / `accessKey` / `bearerToken` / `secretValue` / `rawSecret`; baseUrl/model/apiStyle/secretRef/capabilities/budget/dataPolicy schema CONFIRMED | `NEVER` (read) | matrix Â§7 AI3 |

### Â§2.23 â€” Section phá»¥: envelopes / errors / primitives / enums

| File | TrÃ¡ch nhiá»‡m | Q refs chÃ­nh |
|---|---|---|
| `envelopes.ts` | Request/Response envelope (schemaVersion, actor, source, correlationId, idempotencyKey, OperationReference); `acceptedRef` schema (Q-32 pendingReference canonical) | Q-2, Q-3, Q-4, Q-5, Q-32 |
| `errors.ts` | error taxonomy: `code/messageKey/retryClass` + optional coarse allowlisted `fieldPath`; KHÃ”NG dynamic field name/value/stack/SQL/provider body/details | Q-2 |
| `primitives.ts` | ID alphabet, calendar date, ISO 8601 timestamp, version integer | Q-2 (id/timestamp/date shape) |
| `enums.ts` | Master Â§10.6 constants: `PLACEMENT_CASE_STAGES` (8), `CASE_CLOSE_REASONS` (9), `AVAILABILITIES` (5), `CURRENT_RELATIONSHIPS` (5), `CLOSE_REASONS_OTHER_COMMENT_REQUIRED`, v.v. | Q-13, Q-14, Q-19, Q-24, Q-25 |

Tá»•ng cá»™ng: **23 section command/query** (Â§2.1â€“Â§2.23) phá»§ **23 file**
`packages/contracts/src/commands/*.ts` + 4 file
`packages/contracts/src/{enums,envelopes,errors,primitives}.ts`. Má»—i row
Ä‘á»u cÃ³ reference matrix Â§X row Y hoáº·c file line tÆ°Æ¡ng á»©ng.

---

## Â§3 â€” Phase 9 CONFIRMED vs Phase 10 PROPOSED (AC2)

### Â§3.0 â€” Critical Phase 9 decisions cÃ²n open: path bá»‹ cháº·n + phÆ°Æ¡ng Ã¡n Ä‘á» xuáº¥t

> Owner yÃªu cáº§u: chá»‰ ghi UNKNOWN khÃ´ng Ä‘á»§ Ä‘á»ƒ freeze â€” pháº£i cÃ³ **path bá»‹
> cháº·n rÃµ** (gate nÃ o block khi decision chÆ°a chá»‘t) vÃ  **phÆ°Æ¡ng Ã¡n Ä‘á»
> xuáº¥t** (option runtime HRP-owned cÃ³ thá»ƒ lÃ m).

| Q | Status | Path bá»‹ cháº·n | PhÆ°Æ¡ng Ã¡n Ä‘á» xuáº¥t (runtime HRP-owned) |
|---|---|---|---|
| **G0-06 (Q-6) case domain** | unknown | `placement-case.ts openPlacementCase/updatePlacementCase/closePlacementCase`: matrix runtime gate PROPOSED; ONE-active-case enforcement **chÆ°a chá»n** â†’ freeze bá»‹ cháº·n náº¿u khÃ´ng giá»›i háº¡n active set qua `supersededBy`/closed link. | Option A: chá»‰ enforce 1 OPEN active case per LaborProfile; Option B: cho phÃ©p multi-active nhÆ°ng rÃ ng buá»™c `supersededBy` chain. Chá» HRP domain owner chá»‘t trÆ°á»›c V7.9a runtime PR. |
| **G0-07 (Q-7) HRP review pre/post-apply** | unknown | matrix capability cá»™t PROPOSED; `commitReviewDecision`/`resolvePossibleMatch` runtime reviewer capability **chÆ°a chá»n** â†’ freeze bá»‹ cháº·n vÃ¬ approval authority khÃ´ng xÃ¡c Ä‘á»‹nh. | Option A: pre-apply single-reviewer; Option B: post-apply dual-control (PROPOSED Q-37 default). Schema bind shape Ä‘Ã£ sáºµn; runtime HRP-owned chá»n A/B trÆ°á»›c V7.9a PR. |
| **G0-08 (Q-8) managed mode** | unknown | `placement-case.ts` khÃ´ng cÃ³ `managedMode` field; matrix Â§10 runtime gate PROPOSED â†’ EFFECTIVE flow cÃ²n thiáº¿u. | Option A: HRP_MANAGED máº·c Ä‘á»‹nh (HRP-driven placement); Option B: CLIENT_MANAGED (client-owned placement); hybrid cuá»‘i cÃ¹ng. Chá» Master Â§10.5 cáº­p nháº­t. |
| **Q-19 PlacementCase open-status/transitions** | unknown | matrix Â§3 rows 4â€“6 runtime gate; chÆ°a chá»‘t active set + transitions matrix â†’ `updatePlacementCase.patch.stage` reject cáº§n envelope. | Option A: schema allowlist static (8 stages) + runtime HRP-owned graph; Option B: schema bind stage graph + transitions matrix runtime. Schema Ä‘Ã£ CONFIRM 8 stages (Q-24); chá»n transitions runtime. |
| **Q-21 Talent/Client interaction auth/delegation** | unknown | `interactions.ts RecordTalentInteractionInputSchema/RecordClientInteractionInputSchema` runtime auth/delegation PROPOSED; actor mapping authority **chÆ°a xÃ¡c minh** â†’ INTEGRATION source vá»›i provider + connectionId cáº§n runtime IdP/JWT. | Option A: SERVICE-direct (HRP service identity); Option B: DELEGATED_USER qua opaque `delegationRef`; identity claim audit á»Ÿ runtime. |
| **Q-22 occurredAt/effectiveAt/recordedAt order** | UNKNOWN | `interactions.ts InteractionTimestampsSchema`: 3 timestamps PHÃ‚N BIá»†T (CONFIRMED AC) nhÆ°ng schema KHÃ”NG enforce `occurredAt â‰¤ effectiveAt â‰¤ recordedAt`; runtime BusinessClock anchor (`Asia/Ho_Chi_Minh`) + cut-off chÆ°a chá»‘t. | Option A: schema superRefine enforce order khi cáº£ 3 present; Option B: schema khÃ´ng enforce, runtime HRP gate validate. Coder khuyáº¿n nghá»‹ **Option B** vÃ¬ business clock anchor lÃ  runtime HRP-owned (Q-15 baseline timezone). |
| **Q-23 Client required context** | UNRESOLVED | `interactions.ts RecordClientInteractionInputSchema`: `clientReferenceId` opaque (max 256) + `UNKNOWN` outcome, **KHÃ”NG Ä‘á»§ chá»©ng minh AC PASS** cho `recordClientInteraction`; ClientContact/SalesOpportunity/ClientInteraction contracts thiáº¿u. | Option A: stub schema ClientContact + ClientSalesOpportunity + ClientInteraction vá»›i required fields; Option B: HRP-owned Client domain PR má»Ÿ rá»™ng trÆ°á»›c V7.9a. Coder khuyáº¿n nghá»‹ Option A stub + Q-23 Ä‘Ã³ng sau V7.9a HRP-owned runtime PR. |

**Tá»•ng cá»™ng 7 Q** Phase 9 cÃ²n open cáº§n Owner Ä‘á»‘i chiáº¿u + chá»‘t phÆ°Æ¡ng Ã¡n.
ÄÃ¢y lÃ  **gate** â€” khÃ´ng pháº£i `READY-TO-FREEZE` cho Ä‘áº¿n khi Owner chá»n
Option (hoáº·c tá»« chá»‘i) cho tá»«ng Q.

**Cập nhật đợt 0.8-fixes (F1–F5)**: Owner đã cung cấp báo cáo Auditor
chỉ ra 5 finding cần khắc phục Gate 0 (không mở backend/feature mới).
Sau khi áp dụng F1–F5, các Q cũ dưới đây **vẫn giữ trạng thái open**
vì phụ thuộc runtime HRP-owned — T1 ghi nhận F1–F5 là *code-level
remediation* (PROPOSED/UNAVAILABLE marker, source discriminator,
CalendarDate reuse, DNC canonicalization, evidence ref reuse) chứ không
phải chứng minh AC PASS — chỉ khắc phục sai sót schema-level mà Auditor
đã point out. F1–F5 tham chiếu Q-38..Q-43 (mới, xem
`decision-register.md` cuối file); status báo cáo tổng hợp ở §8.

Trong 7 Q bảng dưới đây, một số Q đã có partial remediation:
- **Q-19 transitions**: phụ thuộc Q-7 review workflow (chưa chốt).
- **Q-21 Talent/Client interaction auth/delegation**: F2 khắc phục
  schema-level discriminator (HRP_UI vs INTEGRATION); authority mapping
  vẫn runtime HRP-owned.
- **Q-22 timestamp order**: schema đã CONFIRMED không enforce order;
  F2 mở rộng fixtures (placement-case-interactions.test.mjs).
- **Q-23 Client required context**: F4/F5 không trực tiếp giải; vẫn UNRESOLVED,
  khuyến nghị Owner chốt HRP-owned Client domain PR trước V7.9a.

**Cập nhật đợt 0.8-fixes (F1–F5)**: Owner đã cung cấp báo cáo Auditor
chỉ ra 5 finding cần khắc phục Gate 0 (không mở backend/feature mới).
Sau khi áp dụng F1–F5, các Q cũ dưới đây **vẫn giữ trạng thái open**
vì phụ thuộc runtime HRP-owned — T1 ghi nhận F1–F5 là *code-level
remediation* (PROPOSED/UNAVAILABLE marker, source discriminator,
CalendarDate reuse, DNC canonicalization, evidence ref reuse) chứ không
phải chứng minh AC PASS — chỉ khắc phục sai sót schema-level mà Auditor
đã point out. F1–F5 tham chiếu Q-38..Q-43 (mới, xem
`decision-register.md` cuối file); status báo cáo tổng hợp ở §8.

Trong 7 Q bảng dưới đây, một số Q đã có partial remediation:
- **Q-19 transitions**: phụ thuộc Q-7 review workflow (chưa chốt).
- **Q-21 Talent/Client interaction auth/delegation**: F2 khắc phục
  schema-level discriminator (HRP_UI vs INTEGRATION); authority mapping
  vẫn runtime HRP-owned.
- **Q-22 timestamp order**: schema đã CONFIRMED không enforce order;
  F2 mở rộng fixtures (placement-case-interactions.test.mjs).
- **Q-23 Client required context**: F4/F5 không trực tiếp giải; vẫn UNRESOLVED,
  khuyến nghị Owner chốt HRP-owned Client domain PR trước V7.9a.
### Â§3.1 â€” Tá»•ng há»£p Phase 9/10 status
Báº£ng tá»•ng há»£p `decision-register.md` (Q-1..Q-37 theo sá»‘ cá»§a Owner). Phase 9
CONFIRMED Ä‘á»§ cho freeze; Phase 10 PROPOSED KHÃ”NG canonical-ready.

| Q / Item | Status | Phase | Ãp lÃªn bundle | Notes |
|---|---|---|---|---|
| G0-01 (Q-1) envelope ABI | proposed | 9 | `envelopes.ts` wire `g0-envelope-0.1`; `schemaVersion: '1'` literal | schema bind CONFIRMED; HRP ID alphabet/size, version representation, accepted timestamp precision **unknown** |
| G0-02 (Q-2) error taxonomy | proposed (ADR shape) | 9 | `errors.ts`; matrix Â§3 column Retry class | VALIDATION/IDEMPOTENCY NEVER; FORBIDDEN NEVER; UNKNOWN_COMMAND_OUTCOME RECONCILE_FIRST; backoff/attempt/age transport bounds **runtime** |
| G0-03 (Q-3) source/actor | proposed | 9 | matrix actor kind cá»™t | server xÃ¡c minh service/user/delegation/auth/org má»—i replay/query; transport algorithm/scopes **unknown** |
| G0-04 (Q-4) durable operation ACCEPTED | proposed | 9 | `envelopes.ts AcceptedResponseSchema` (Q-32 pendingReference canonical) | endpoint, retention/expiry, not-found policy **chÆ°a chá»‘t** |
| G0-05 (Q-5) idempotency namespace | confirmed semantics / proposed binding | 9 | matrix Â§3 column Retry `NEVER` for IDEMPOTENCY_CONFLICT | digest algorithm/canonicalization, retention/replay expiry **unknown** |
| G0-06 (Q-6) case domain | unknown | 9 | matrix Â§3 rows 4â€“6 PROPOSED | HRP domain owner chá»‘t trÆ°á»›c H.04 |
| G0-07 (Q-7) HRP review pre/post-apply | unknown | 9 | matrix capability cá»™t PROPOSED | HRP owner chá»n workflow review trÆ°á»›c V7.9a runtime PR |
| G0-08 (Q-8) managed mode | unknown | 9 | matrix Â§10 runtime gate PROPOSED | HRP_MANAGED/CLIENT_MANAGED policy chÆ°a chá»‘t |
| G0-09 (Q-9) KPI attribution | unknown (schema CONFIRMED) | 10 | matrix Â§7 A1/A2 schema CONFIRMED; attribution policy **runtime HRP-owned** | P10/A.01â€“A.04 domain sign-off |
| G0-10 (Q-10) integration runtime | unknown | 10 | matrix Â§10 runtime gate PROPOSED | auth/signature/ACK provider protocol; idempotency/event retention; DNC freshness/fencing/cut-off; evidence VN residency; Client required context; relationship precedence |
| G0-11 (Q-11) source discrepancy | known | 9 | decision-register Â§"Connector v1.1 delta" | connector v1.1 Ä‘Ã£ Ä‘á»‘i chiáº¿u; HRP core checkout + guardrails + schema/auth chÆ°a cÃ³ |
| Q-13 EXACT_MATCH staff review | **CONFIRMED (no-EXACT_AUTO_APPLY)** | 9 | matrix Â§3 row 1 REVIEW_REQUIRED; Q-13 chá»‘t | baseline Master Â§10.7.3 + Backlog Â§0.3b |
| Q-14 Fill-missing | **CONFIRMED** | 9 | matrix Â§3 row 2 patch whitelist; Q-14 chá»‘t | runtime HRP enforce (PROPOSED) |
| Q-15 `availableFromDate` (Asia/Ho_Chi_Minh baseline) | **CONFIRMED (timezone baseline)** / proposed binding | 9 | matrix Â§3 row 9 AVAILABLE_FROM_DATE yÃªu cáº§u ngÃ y; future-date business clock PROPOSED | runtime HRP gate business clock anchor |
| Q-16 submission lifecycle review pre/post | PROPOSED | 9 | matrix Â§5 E3 3 label marker PROPOSED; UNAVAILABLE attribution KHÃ”NG Ä‘oÃ¡n | pre-apply vs post-apply chÆ°a chá»‘t |
| Q-17 PreviewResolver redacted PII | PROPOSED | 9 | matrix Â§4 Q2 reviewer capability PROPOSED | read-only resolver, no createOrMatch |
| Q-18 DNC reason OTHER | PROPOSED | 9 | DNC command schema tÃ¡ch riÃªng intake (CONFIRMED AC) | note/retention policy runtime PROPOSED |
| Q-19 PlacementCase open-status/transitions | unknown | 9 | matrix Â§3 rows 4â€“6 runtime gate | active set; transitions matrix |
| Q-20 CLOSED/SUCCESS â†’ EFFECTIVE | **CONFIRMED (KHÃ”NG tá»± EFFECTIVE)** / workflow PROPOSED | 9 | matrix Â§3 row 6 SUCCESS KHÃ”NG tá»± EFFECTIVE | Placement workflow riÃªng váº«n chÆ°a chá»‘t |
| Q-21 Talent/Client interaction auth/delegation | unknown | 9 | matrix Â§3 rows 7â€“8 runtime gate PROPOSED | runtime HRP-owned |
| Q-22 occurredAt/effectiveAt/recordedAt order | UNKNOWN | 9 | matrix Â§3 rows 7â€“8 3 timestamps PHÃ‚N BIá»†T (CONFIRMED AC) | schema KHÃ”NG enforce order; runtime HRP decide |
| Q-23 Client required context | UNRESOLVED | 9 | matrix Â§3 row 8 `UNKNOWN` outcome nhÆ°ng KHÃ”NG Ä‘á»§ chá»©ng minh AC PASS | Client domain contract cÃ²n thiáº¿u |
| Q-24 PlacementCaseStage enum allowlist | **CONFIRMED** | 9 | matrix Â§3 row 5 schema enum 8 giÃ¡ trá»‹ | schema bind CONFIRMED |
| Q-25 Availability schema shape | **CONFIRMED (shape-only)** / proposed binding | 9 | matrix Â§3 row 9 AVAILABLE_FROM_DATE yÃªu cáº§u ngÃ y | future-date business clock PROPOSED |
| Q-26 Suppression target kind | PROPOSED | 9 | matrix Â§3 rows 10â€“11 3 target kinds schema CONFIRMED | dispatch fencing runtime PROPOSED |
| Q-27 NextAction CREATE statuses & snooze/occurrence | PROPOSED | 9 | matrix Â§3 rows 12â€“13 schema CONFIRMED | CREATE status âŠ† {OPEN, CANCELLED}; snoozeMode tÃ¡ch riÃªng status |
| Q-28 Planning batch per-item outcome | PROPOSED | 9 | matrix Â§3 row 18 schema CONFIRMED | 4 outcome PHÃ‚N BIá»†T; per-item schema enforced |
| Q-29 ClientCompany Ä‘Ã£ cÃ³ | **CONFIRMED (connector xÃ¡c nháº­n)** | 9 | matrix Â§6 M1 `clientCompanyId` opaque qua ClientTargetRef | field bindings PROPOSED |
| Q-30 Marker/forbidden-list evidence | **CONFIRMED (nguyÃªn táº¯c)** | 9 | matrix cá»™t "Schema status" vs runtime gate | marker audit; runtime gate HRP-owned |
| Q-31 Push/claim-ack | PROPOSED (ká»¹ thuáº­t) | 9 | matrix Â§5 E1 default PUSH_WEBHOOK; matrix Â§10 dualChannelWithoutFencing/Dedupe marker | PULL_CLAIM_ACK fallback runtime PROPOSED |
| Q-32 Batch ACCEPTED pendingReference | **CONFIRMED (canonical)** / implementation query API **PROPOSED** | 9 | `envelopes.ts OperationReferenceSchema`; matrix Â§3 row 18 | implementation query API Ä‘á»ƒ V7.9a HRP-owned PR |
| Q-33 Signature provider protocol | **CONFIRMED (KHÃ”NG tá»± chá»n)** | 9 | matrix Â§8 G2/PR1â€“PR3 verify-before-parse + allowlist | runtime gate bind signature; independent audit shared contracts á»Ÿ bundle cuá»‘i |
| Q-34 Routing strategy phÃ¢n biá»‡t | **CONFIRMED (schema bind)** | 9 | matrix Â§7 R1â€“R3 SOURCE_ALLOCATION vs WEIGHTED_DISTRIBUTION vs HYBRID schema bind | HYBRID policy runtime PROPOSED |
| Q-35 KPI namespace experimental | **CONFIRMED (namespace tag)** | 10 | `kpi.ts KPI_MODULE_NAMESPACE = 'phase10-experimental'`; matrix Â§7 K1â€“K3 strict reject `canonical-ready` | Phase 10 module DISABLED cho canonical-ready |
| Q-36 AI provider config read DTO | **CONFIRMED (read DTO)** | 9 | matrix Â§7 AI3 strict reject raw secret | apiStyle/secretRef/capabilities/budget/dataPolicy schema CONFIRMED |
| Q-37 AI proposal KHÃ”NG arbitrary payload / direct write | **CONFIRMED (schema bind)** | 9 | matrix Â§7 AI1 strict reject `commandPayload` / `embedCommandPayload`; AI2 apply via envelope command | acceptedFieldPaths subset-of-proposal runtime enforce (PROPOSED) |

### Â§3.2 â€” Phase 10 module disable (rÃµ rÃ ng, khÃ´ng canonical-ready)

| Module | File | Marker | Phase 10 tráº¡ng thÃ¡i |
|---|---|---|---|
| `kpi.ts` | `packages/contracts/src/commands/kpi.ts` | `KPI_MODULE_NAMESPACE = 'phase10-experimental'` | DISABLED cho canonical-ready; chá»‰ Phase 10 namespace, KHÃ”NG cÃ´ng bá»‘ canonical-ready |
| `analytics.ts` | `packages/contracts/src/commands/analytics.ts` | `source.kind === 'EXPERIMENTAL'` â†’ `attributionState = UNAVAILABLE` | EXPERIMENTAL source máº·c Ä‘á»‹nh UNAVAILABLE; KHÃ”NG Ä‘oÃ¡n sá»‘ liá»‡u |
| `ai-proposals.ts` | `packages/contracts/src/commands/ai-proposals.ts` | `ApplyAIProposal` strict reject `commandPayload` / `embedCommandPayload`; ai-37 dual-control PROPOSED | proposal KHÃ”NG direct write; apply qua envelope command (manager capability runtime gate) |
| Attribution policy runtime | (cross-cutting) | UNAVAILABLE attribution yÃªu cáº§u reasonCode; Q-30 nguyÃªn táº¯c | attribution runtime HRP-owned; P10/A.01â€“A.04 domain sign-off |

---

## Â§4 â€” Out-of-scope verification (AC3)

### Â§4.1 â€” Working tree khÃ´ng cÃ³ file ngoÃ i contracts/tests/docs

Verified báº±ng Glob recursive (bá» qua `node_modules`, `dist`, `.npm-cache`):

```
docs/contracts/*.md + *.manifest.txt        (handoff + matrix + decision-register + inventory)
docs/Importal/*.md                          (Master Plan, connector, backlog, execution guide)
docs/reviews/                               (Gate 0 review â€” file má»›i cá»§a 0.8)
packages/contracts/
  src/{enums,envelopes,errors,primitives,index}.ts
  src/commands/*.ts                         (23 file commands)
  tests/*.mjs + *.md                        (fixtures coverage)
  README.md, CHANGELOG.md
  package.json, package-lock.json, tsconfig.json
.gitignore
.npm-cache/                                 (npm internal logs, khÃ´ng liÃªn quan bundle)
```

**KHÃ”NG cÃ³** trong working tree:

- âŒ `prisma/`, `prisma/schema.prisma`
- âŒ `app/api/` hoáº·c `app/api/**`
- âŒ `apps/`, `apps/integration-api/`, `apps/integration-worker/`, `apps/context-panel/`
- âŒ `packages/integration-store/`
- âŒ Route Handler (Next.js `app/**/route.ts` hoáº·c `pages/api/**`)
- âŒ `migration/`, `migrations/`
- âŒ `src/backend/`, `src/server/`
- âŒ `@prisma/client`, `next`, `express`, `hono`, `fastify`, `koa`, `@nestjs/*`, `@hapi/*`

### Â§4.2 â€” `packages/contracts/package.json` dependencies

```json
{
  "dependencies": { "zod": "3.24.2" },
  "devDependencies": { "typescript": "5.7.3" }
}
```

- âœ… `zod@3.24.2` â€” runtime schema validation (cáº§n cho AC contracts).
- âœ… `typescript@5.7.3` â€” typecheck devDep (cáº§n cho `npm run typecheck`).
- âŒ KHÃ”NG cÃ³ `@prisma/client`, `next`, `express`, `hono`, `fastify`, `koa`, `@nestjs/*`, `@hapi/*`.
- âŒ KHÃ”NG cÃ³ framework HTTP, framework SSR, framework ORM nÃ o.

### Â§4.3 â€” File má»›i / sá»­a Ä‘á»£t 0.8

| Loáº¡i | Path | Ghi chÃº |
|---|---|---|
| Má»›i | `docs/reviews/gate-0-checklist.md` | file chÃ­nh 0.8 (file nÃ y) |
| Má»›i | `docs/contracts/handoff-g0-0.8.md` | theo máº«u cÃ¡c handoff 0.3aâ€“0.7 |
| Má»›i | `docs/contracts/handoff-g0-0.8.manifest.txt` | SHA-256 file má»›i + file sá»­a |
| Sá»­a (doc-only) | `packages/contracts/CHANGELOG.md` dÃ²ng 19 | `(+46 test)` â†’ `(+59 test)` (Owner review) |
| Sá»­a (doc-only) | `docs/contracts/handoff-g0-0.6.md` dÃ²ng 21 | `56 dÃ²ng` â†’ `54 dÃ²ng` (Owner review) |

Tá»•ng: **3 file má»›i + 2 file sá»­a**. KhÃ´ng cÃ³ file nÃ o khÃ¡c.

---

## Â§5 â€” Owner sign-off (AC4)

### Â§5.1 â€” Báº£ng Owner sign-off (Ä‘á»ƒ trá»‘ng)

| Field | Value |
|---|---|
| Gate 0 FREEZE status | _(Ä‘á»ƒ trá»‘ng â€” chá» Owner xÃ¡c nháº­n)_ |
| Date | _(Ä‘á»ƒ trá»‘ng)_ |
| Owner | _(Ä‘á»ƒ trá»‘ng)_ |
| Ghi chÃº | _(Ä‘á»ƒ trá»‘ng)_ |

### Â§5.2 â€” TuyÃªn bá»‘

> **Gate 0 chÆ°a FREEZE cho Ä‘áº¿n khi Owner chÃ­nh thá»©c xÃ¡c nháº­n; má»i
> implementation phá»¥ thuá»™c (1.0â€“1.15) pháº£i chá».**

T1 khÃ´ng tá»± commit, khÃ´ng tá»± stamp CHECKPOINT FREEZE, khÃ´ng tá»± chuyá»ƒn
HRP-owned PR. Owner cÃ³ tháº©m quyá»n cuá»‘i cÃ¹ng.

### Â§5.3 â€” Implications for downstream

| Item | Status | Notes |
|---|---|---|
| V7.9a Task 1.0â€“1.15 implementation | **CHÆ¯A triá»ƒn khai** | chá» Owner sign-off Gate 0 |
| HRP-owned PR cho Q-19 (Placement transitions) | **CHÆ¯A OWN-issued** | runtime gate PROPOSED |
| HRP-owned PR cho Q-33 (signature/JWT/webhook) | **CHÆ¯A OWN-issued** | independent audit shared contracts á»Ÿ bundle cuá»‘i |
| HRP-owned PR cho Q-34 (HYBRID policy runtime) | **CHÆ¯A OWN-issued** | schema bind CONFIRMED, runtime PROPOSED |
| HRP-owned PR cho Q-37 (dual-control AI) | **CHÆ¯A OWN-issued** | manager capability runtime gate PROPOSED |
| HRP-owned PR cho Q-23 (Client required context domain) | **CHÆ¯A OWN-issued** | Client domain contract cÃ²n thiáº¿u |
| Implementation query API runtime cho Q-32 | **CHÆ¯A triá»ƒn khai** | schema ACCEPTED + pendingReference canonical CONFIRMED; runtime API Ä‘á»ƒ V7.9a HRP-owned PR |
| Phase 10 module (KPI namespace `phase10-experimental`) | DISABLED canonical-ready | Phase 10 attribution policy váº«n chá» Owner domain sign-off |
| OrganizationScope / tenant (Q-1, G0-11) | **KHÃ”NG coi scope/tenant Ä‘Ã£ tá»“n táº¡i** | connector v1.1 Ä‘á» xuáº¥t; HRP schema Organization/Tenant chÆ°a cÃ³; runtime gate |

---

## Â§6 â€” Manifests & hashes

> **Quan trá»ng vá» snapshot**: Táº¥t cáº£ SHA-256 tÃ­nh trÃªn **working tree
> hiá»‡n táº¡i** â€” HEAD `414c54b` chá»‰ chá»©a `docs/Importal/*.md` (connector
> docs). ToÃ n bá»™ `packages/contracts/src/**`, `tests/**`, `package.json`,
> `package-lock.json`, `tsconfig.json`, `README.md`, `CHANGELOG.md`,
> `docs/contracts/**` (trá»« `importal`) lÃ  **untracked** táº¡i working
> tree. Khi commit, working-tree hashes sáº½ thay báº±ng commit-tree hashes
> (sha256 blob giá»‘ng nhau cho cÃ¹ng ná»™i dung file, content addressable).
>
> **Cáº­p nháº­t Ä‘á»£t 0.8**: 2 sá»­a vÄƒn báº£n (a) `CHANGELOG.md` (+46 â†’ +59),
> (b) `handoff-g0-0.6.md` (56 â†’ 48 dÃ²ng matrix) Ä‘Ã£ Ä‘Æ°á»£c Ã¡p dá»¥ng; hashes
> dÆ°á»›i Ä‘Ã¢y pháº£n Ã¡nh ná»™i dung má»›i.

### Â§6.0 â€” Bundle Scope (file Ä‘áº¿m thá»±c táº¿ táº¡i HEAD + working tree)

| NhÃ³m | Sá»‘ file | ÄÆ°á»ng dáº«n |
|---|---|---|
| Source TS | 29 | `packages/contracts/src/` + `packages/contracts/src/commands/` (identity, evidence, profile, intake, placement-case, interactions, availability, suppression, next-action, scheduling, outbox, gateway, providers, ports, queries, events, mappings, routing, analytics, kpi, ai-proposals, ai-provider-config) + `src/{enums,envelopes,errors,primitives,index}.ts` |
| Tests | 25 | `packages/contracts/tests/` (21 `.test.mjs` + 2 `_synthetic-*.md`) |
| Config + lockfile | 3 | `packages/contracts/{package.json, package-lock.json, tsconfig.json}` |
| Docs (contracts) | 21 | `docs/contracts/` (decision-register, inventory, matrix, 7 handoff + 6 manifest, checkpoint, g0-0.0-0.2-handoff) + review bundle (`gate-0-checklist.md`) |
| Docs (Importal/Owner) | 6 | `docs/Importal/` (Master V2.6, Execution Guide, hrp-connector, Implementation-Backlog Ã—3) |
| Output build | (auto) | `packages/contracts/dist/` (artifacts; khÃ´ng kÃ¨m SHA-256 vÃ¬ auto-generate qua `tsc`) |
| **Tá»•ng bundle** | **80** file thá»§ cÃ´ng + dist sinh tá»± Ä‘á»™ng |

### Â§6.1 â€” Source TypeScript (29 file: 27 original + dnc.ts F4 + merge-review.ts F1)

| Path | SHA-256 |
|---|---|
| `packages/contracts/src/index.ts` | `be9e99f29e59a0191bf404a0cc0a8ef39bdf4ef72c8f20099d7f0c73ade2df3e` |
| `packages/contracts/src/enums.ts` | `ff6ee50aada938843bfa4546ef0d268ef8eac702bfa4690d18f396520f1d1581` |
| `packages/contracts/src/envelopes.ts` | `f68ea4866c4f33786b03298ca531b454ff97437200d31457d5ac89d1f32af4d2` |
| `packages/contracts/src/errors.ts` | `54df177848033b509789607377dd92f7319a08988b29558e8100f6c5e7e867e0` |
| `packages/contracts/src/primitives.ts` | `359a37758e18069ed69e5e1015b8ea00ed18c6b2f598b6125afce01962ef56ac` |
| `packages/contracts/src/commands/identity.ts` | `306f3e21bb43c310fbb7bfecab4eb0557df800d2304967234a0b957a29897594` |
| `packages/contracts/src/commands/evidence.ts` | `5bdc44ce399c2e60aa429edbb01e33deaa92c324b61d68aeddf24ba52206b95d` |
| `packages/contracts/src/commands/profile.ts` | `2754517d0b55f8e1b6ec52078c9408577e24a223144a48c5f6128c7ceca8788f` |
| `packages/contracts/src/commands/intake.ts` | `36e4b06413a813158324897b0088fd610a4d7e782cf9d70d2b39032248804a60` |
| `packages/contracts/src/commands/placement-case.ts` | `502a7fd8c17b3b8adf3eda668b7510602212553c50c26099c0e49ae4a95ec974` |
| `packages/contracts/src/commands/interactions.ts` | `ddce04c2f01aa79707939a2dfbd65b29d5ee41f89438225020e266411ff7452d` |
| `packages/contracts/src/commands/availability.ts` | `51f7a099ed5b213f94d132ba26950a2e720eb7cfad0c4b2064d6dd76d1975cc4` |
| `packages/contracts/src/commands/suppression.ts` | `1423dcf0d329c4eb36832145ba2ea5265ed32725fa0b5d8394135642a20156e4` |
| `packages/contracts/src/commands/next-action.ts` | `78be65edfbbc40be4bd336e5e76dedd9dc92ddd1a9003dc7ca9daef617e29407` |
| `packages/contracts/src/commands/scheduling.ts` | `e04f8dfaf084c53ef1d108912885b5c309db2c338fd8655d7de6120d74a2d041` |
| `packages/contracts/src/commands/outbox.ts` | `1b12bd132e92668f61862966749a6f528a23722139e197e927311047d94c904a` |
| `packages/contracts/src/commands/gateway.ts` | `5e5c5e0cc12e5bcf5f893382670ccffb4c457a05dbf124b7a3b60aff5f9acb42` |
| `packages/contracts/src/commands/providers.ts` | `f26c66539a6827cb4c58f756369a485b13614a83abc95da17fd2a4a25b60e843` |
| `packages/contracts/src/commands/ports.ts` | `79db5c805e90277ff1278f36c06e01eee87d703f5106b2c3b1eff4722e0134e0` |
| `packages/contracts/src/commands/queries.ts` | `4bfa1fe623244698442470d4498521ec154b6c830e937e234cd72c58113b2c0e` |
| `packages/contracts/src/commands/events.ts` | `a94ebfa53d29f3036c2d3965817cf86fa8b638e66a2db3f24dd46eec192e188a` |
| `packages/contracts/src/commands/mappings.ts` | `1365ead406b60c670a4f03708318f18405ce1fbe855cc5580cc79b41429055db` |
| `packages/contracts/src/commands/routing.ts` | `92d05d9106625326222bbc7ce9d2cc5c09375d8b642adea3fc74d24e38d8f326` |
| `packages/contracts/src/commands/analytics.ts` | `c0f11873c3410cad4b0399999d98410d2398aafffc50c65af2747df4beff193c` |
| `packages/contracts/src/commands/kpi.ts` | `6448942e2f36fa01d92b6bccc700f2c942f3527f32909f12890e585b799eb60e` |
| `packages/contracts/src/commands/ai-proposals.ts` | `e415740f630280ba3ce5c026d1869c89fbd62d27e4b03b372d5c93ed3892cc0f` |
| `packages/contracts/src/commands/ai-provider-config.ts` | `7c9cbde564a0a406ab4c6606a9b71188213f6be46ae46a5ccefd2b88b6922bae` |

| `packages/contracts/src/commands/dnc.ts` (F4) | `6e259966765f5733a91954917692d8413b1f0cf7a1eca4d37ae65de40038fe82` |
| `packages/contracts/src/commands/merge-review.ts` (F1) | `f6063656d0fcf43b7fb708dd5d420136c6b52084dce1171fb5c290de3784fd48` |

### Â§6.2 â€” Tests (25 file: 23 original + test-helpers.mjs F2 + fixtures-fix-f1-f5.test.mjs)

| Path | SHA-256 |
|---|---|
| `packages/contracts/tests/identity.test.mjs` | `f00b1a3744fcd20bb2d4f885178938561859c3c40a0b6e62945941eaa74dc31e` |
| `packages/contracts/tests/profile-intake.test.mjs` | `11cbbe157f01992e3dc6a8c77fc320c8555e35cf171a3175197e36f8481573ba` |
| `packages/contracts/tests/availability.test.mjs` | `c68b040a2f3b919d19a6902134cc8fe42473ae1eaafc8bf48e2cad14ae181b0c` |
| `packages/contracts/tests/suppression.test.mjs` | `7d042f67ae371ac1de5c46f2ea72c17cf9a59ef849b4cf633beb57a9d997d361` |
| `packages/contracts/tests/next-action.test.mjs` | `c1642f3c9bf4e070317023d7539ef6bf57a6fd9e7b3f6b32e102305267a01669` |
| `packages/contracts/tests/scheduling.test.mjs` | `44d7f4e6a73984d8493ad40f1f4a8a869dd15ff9c1de055e85793835aaee7351` |
| `packages/contracts/tests/placement-case-interactions.test.mjs` | `291e5a11409cb3717e22b649d039de00644462195a60f84a1c83837942739fde` |
| `packages/contracts/tests/outbox.test.mjs` | `07d781707c717416e6587c3c78c843116db1274b2523ed8d3ad24bc0f6a3094d` |
| `packages/contracts/tests/gateway-providers-ports.test.mjs` | `c2f42ca150a16b5860930d5e0faf7090f787b50c1fb7667c2d74bd6027025e1c` |
| `packages/contracts/tests/queries-events-mappings.test.mjs` | `9d895db14e58cd1ffc1b362c123628d0d31089eac57501985cc34c2eb3f34ec4` |
| `packages/contracts/tests/routing-analytics-kpi-ai.test.mjs` | `2eccf4260d69dda0e71fa7c33bdf874cecb47c21c48297a1b8a83cae60bab2d3` |
| `packages/contracts/tests/enums.test.mjs` | `24c6ac5bdcee4529e36de3a9a26a5bf00f6fe0485c8652888b091f2be4755d91` |
| `packages/contracts/tests/enums.legacy.mjs` | `254bf651a4962989fc08ebe3a057d7703cd8a17d2789bb9f9eb7cdaadd9de87d` |
| `packages/contracts/tests/enums-extra.test.mjs` | `6ac45cf338fe42ee4bc383c9ba46337a28e539ed2ae45a0456f28e7d89cb4fed` |
| `packages/contracts/tests/envelopes.test.mjs` | `3d406a11189c02c226cf6c8a6dd423c6622af3f0c03b4fcc53007d8de52e26a5` |
| `packages/contracts/tests/envelopes.legacy.mjs` | `8e7424ba6e896168aef1cda33e719ce3d5ec384d943158fb4cfe31fecaa9e934` |
| `packages/contracts/tests/errors.test.mjs` | `d5f404e14a748559607557ac2566f7f0141130d0f5a8ce9f1d3c2348e3e5503f` |
| `packages/contracts/tests/errors.legacy.mjs` | `6e9c7ccb0f2df6fd31e2dc05dbae15d8a4f85ccd185ac4fc10a3e3afc8cdeff4` |
| `packages/contracts/tests/contracts.synthetic.mjs` | `ede9dfeccd3a9f148047d872c48d36f15e5b12e3e5609356f5660a3e70572f03` |
| `packages/contracts/tests/fixtures-coverage-0.7.test.mjs` | `0e1a2f2e5a48d72e9c439239f44fae0dcad43dd70f301f73121e27a69adb6cac` |
| `packages/contracts/tests/_synthetic-coverage.md` | `198a63f40f694c3893ec498b9293787f22985de391be3981a3e688f435f7b9c7` |
| `packages/contracts/tests/_synthetic-pending.md` | `8b5e583f49fcac24c3c119a81856af4bb991ae18a443d33e45520406d18e06cd` |

| `packages/contracts/tests/test-helpers.mjs` (F2 helper) | `eef76e14ef09550734ffe187cb7b936790e94149edfaba445f78fa3229d35721` |
| `packages/contracts/tests/fixtures-fix-f1-f5.test.mjs` (F1–F5) | `c4059ceb35d82c59fa60a186c5090129779dc6ae3a9c44f050c7e4eff8173603` |

### Â§6.3 â€” Config & lockfile (3 file, packages/contracts/)

| Path | SHA-256 |
|---|---|
| `packages/contracts/package.json` | `3e202ca38ec4ef1f4f0fed78f4b571ebb54fd86e6997eeaefe67956b581af70e` |
| `packages/contracts/package-lock.json` | `31ebfaa71dd86030de374b4df62d852a30a32517d7d07a40c0f0629c12604fc0` |
| `packages/contracts/tsconfig.json` | `5ac522bd9ed4375a22933be65a9e3b00a4c546f34d7ee8a276cc40f8c00058d2` |

### Â§6.4 â€” Docs Importal (6 file, docs/Importal/) â€” Ä‘Ã£ tracked táº¡i HEAD 414c54b

| Path | SHA-256 |
|---|---|
| `docs/Importal/Master-Plan.V2.6.md` | `b82ef7a5a36bf7ac9cf19f1e1f57bbb71cfa19f8c3ce81f69aa1f7a9754fc1cc` |
| `docs/Importal/Execution-Guide.HRP-Engagement.md` | `49b57a23ceacbd8897bbbee400d3eb786c81083bd0151d3ab8685c408246a1ad` |
| `docs/Importal/hrp-connector.md` | `d9bd421b6d3c2af7672be07852ba02387664d598351690a32eb96da53ce1521e` |
| `docs/Importal/Implementation-Backlog.Gate0-V7.9a.md` | `0dfb02809f07f69a9de897eb349983393e5e7a138dfb7a6bbab902c94379c73e` |
| `docs/Importal/Implementation-Backlog.HRP-Owned-V7.9b-f.md` | `be7f9b3f789c62a69460d79d079f5353cffcf42153706b809ccd41ae02c4a673` |
| `docs/Importal/Implementation-Backlog.V7.10-AI-BoD.md` | `77e5a6fc33e90bd828bde3d31c8927f88d22f2b486d6ecddb73f693e4f4314dd` |

### Â§6.5 â€” Docs Contracts (21 file, docs/contracts/) â€” untracked táº¡i working tree

| Path | SHA-256 |
|---|---|
| `docs/contracts/decision-register.md` | `1a46bc429b749bfdec6b3c4cacc2836f8fd58d78c351a1906c9a9f81b13d5c39` |
| `docs/contracts/inventory.md` | `adedcb4d8500fa153008f460bb41ad1d1230a9e276658746d42496b53ac8c35f` *(Ä‘Ã£ cáº­p nháº­t Ä‘á»£t 0.8)* |
| `docs/contracts/authorization-policy-matrix.md` | `1dfc993a1d79b4a0d5aaa46b43260076b686a49ca76f3b3502bd99ecf7e69f3a` |
| `docs/contracts/checkpoint.g0-0.0-0.2.md` | `7bf97d66d20f6db271d4bd2849a44a67fd92e05a103d04174d62e2da89399c69` |
| `docs/contracts/g0-0.0-0.2-handoff.md` | `823075ed8ea611634b3cd120b64031b6003f614133f6692310d16e185ef54658` |
| `docs/contracts/handoff-g0-0.3a-0.3b.md` | `b7cf515482a376378c1df57a68a2596f4d5dd0a422e33b88d363ae843dcf7f5f` |
| `docs/contracts/handoff-g0-0.3c-0.3d.md` | `f424b3f5bb734ec3738a918a2f6bcba285cfdc77f26195e19d8f3f111263097e` |
| `docs/contracts/handoff-g0-0.3c-0.3d.manifest.txt` | `d8c7e127d0130d266a6398cd5642b110b0f8fded4d1f50cfa17fa3e4dbfca0de` |
| `docs/contracts/handoff-g0-0.3e-0.3f.md` | `9834f90d6d7f7b742ba0000ea65645a072d0ac6c5a54feca5f75934104990fd0` |
| `docs/contracts/handoff-g0-0.3e-0.3f.manifest.txt` | `24932c34c11f3f6734a2df1a260012e7426c93e53391a6dd79c3aeabe7b92521` |
| `docs/contracts/handoff-g0-0.3g-0.3h.md` | `8216f8c79a292f9b595e72cbb8e481959b5c6c0d94e509958b5c8ee98505fe14` |
| `docs/contracts/handoff-g0-0.3g-0.3h.manifest.txt` | `880b6717ceb8bb501a441fc8f6a7f0571b7c0f95dbfdf98176795d07a975e0e1` |
| `docs/contracts/handoff-g0-0.4.md` | `400cf3d84a8e3f1cf9106f1cb7858d94a7e00789a2f11a4d9d142eb207718a1f` |
| `docs/contracts/handoff-g0-0.4.manifest.txt` | `cd93f56c0ad878fa9f1b4fd0f6306a7ccd8ff14ba8c285773e9605d488b6979f` |
| `docs/contracts/handoff-g0-0.5.md` | `3a488c47e4558b93b3d4f11796190e8c1e9458a1ba44ec10c17a084f8a242cf7` |
| `docs/contracts/handoff-g0-0.5.manifest.txt` | `76a2447fee11dd916d125426b39d8b84e83fa00f1e54eaffe9a7f4a10e8501c1` |
| `docs/contracts/handoff-g0-0.6.md` *(Ä‘Ã£ sá»­a 56 â†’ 48 dÃ²ng matrix)* | `c5ef8c019a3a0c1cd83fafc181e80330466cc3ac7d08842fa68439fc78d69311` |
| `docs/contracts/handoff-g0-0.6.manifest.txt` | `7f7851030be68edd1c3e6832958c2dc0a00eb97ae4a2790cefcde761a34551d6` |
| `docs/contracts/handoff-g0-0.7.md` | `0e7081a0384a769831cdc5743761e5e5aaed1e055255d0f0d625a827f380f174` |
| `docs/contracts/handoff-g0-0.7.manifest.txt` | `e5fc7d208e9a08ae8e3878eb53e4dd237dc21229c0aafccb7675b341ac52313d` |

### Â§6.6 â€” Docs package (3 file)

| Path | SHA-256 |
|---|---|
| `packages/contracts/README.md` | `b08a271ac1085344e82cc2d8060f0c2be2aeb556d30d2720eb33a35e1ae3d5ac` |
| `packages/contracts/CHANGELOG.md` *(Ä‘Ã£ sá»­a +46 â†’ +59)* | `aedeae9bdd93e88cbe51a3d46e9b1f1952131ba77058a0ec68f1112012f909ed` |

### Â§6.7 â€” Self-reference (khÃ´ng tá»± ghi hash cá»§a file nÃ y)

- `docs/reviews/gate-0-checklist.md` (file nÃ y) â€” KHÃ”NG tá»± ghi hash.
- `docs/contracts/handoff-g0-0.8.md` â€” SHA-256 inline trong Â§6.7 dÆ°á»›i:
  `74199103febe6e0f1b702cab700fc50b561919f3f1e31762965f0fd5530df6ff`
  (Owner cÃ³ thá»ƒ verify qua `Get-FileHash` PowerShell hoáº·c `sha256sum`).
- `docs/contracts/handoff-g0-0.8.manifest.txt` â€” SHA-256 cá»§a chÃ­nh nÃ³:
  `c0be0b0a92fb20fba004b1954951049ed268ac7d73d58a4100826c6334fed4c2`
  (KHÃ”NG ghi vÃ o manifest 0.8 Ä‘á»ƒ trÃ¡nh self-reference cycle).

> **Ghi chÃº vá» self-reference**: Theo Execution Guide Â§5.3, manifest
> hash tá»± tham chiáº¿u bá»‹ loáº¡i Ä‘á»ƒ trÃ¡nh cycle. Khi Owner verify bundle,
> hash cá»§a `gate-0-checklist.md` sáº½ Ä‘á»‘i chiáº¿u file cuá»‘i Ä‘Ã£ Ä‘á»‘i chiáº¿u
> (sau khi Ã¡p dá»¥ng má»i sá»­a).

---

## Â§7 â€” Limits & known open

T1 ghi nháº­n 7 risk sau (theo `decision-register.md` + matrix); **chÆ°a cÃ³
independent Auditor Ä‘Ã¡nh giÃ¡** (ngÆ°á»i/agent, pháº¡m vi, snapshot, verdict)
cho nhá»¯ng risk nÃ y â€” Ä‘Ã¢y lÃ  self-check rá»§i ro.

| # | Risk | Q ref | Status | Risk class |
|---|---|---|---|---|
| 1 | Signature provider protocol chÆ°a xÃ¡c minh (Zalo JWT, Chatwoot HMAC); shared contracts ccần independent audit (chưa có nguồn) | **Q-33** | CONFIRMED KHÃ”NG tá»± chá»n; PROPOSED runtime gate | **High** â€” runtime security |
| 2 | Batch ACCEPTED `OperationReference` schema bind CONFIRMED; implementation query API runtime chÆ°a cÃ³ (Ä‘á»ƒ V7.9a HRP-owned PR) | **Q-32** | schema CONFIRMED, runtime API **PROPOSED** | **Medium** â€” query semantics cÃ²n thiáº¿u |
| 3 | Routing HYBRID policy (fixedOwner + weights) runtime PROPOSED; schema bind CONFIRMED; runtime HRP-owned | **Q-34** | schema CONFIRMED, runtime PROPOSED | **Medium** â€” policy runtime |
| 4 | AI proposal dual-control (Q-37); acceptedFieldPaths subset-of-proposal runtime enforce PROPOSED; manager capability runtime gate | **Q-37** | schema bind CONFIRMED, runtime PROPOSED | **High** â€” security/data integrity |
| 5 | PlacementCase open-status set / active set / transitions matrix runtime PROPOSED; one-active-case runtime HRP gate | **Q-19** | unknown runtime gate | **High** â€” workflow integrity |
| 6 | Client required context (Master Â§10.7) chÆ°a chá»‘t; `recordClientInteraction` cÃ³ `UNKNOWN` outcome nhÆ°ng KHÃ”NG Ä‘á»§ chá»©ng minh AC PASS | **Q-23** | UNRESOLVED | **High** â€” Client domain contract cÃ²n thiáº¿u |
| 7 | OrganizationScope / tenant (`organizationId` á»Ÿ envelope Â§5 lÃ  Ä‘á» xuáº¥t; HRP khÃ´ng cÃ³ model Organization/Tenant trong Prisma) | **Q-1** + **G0-11** | proposed; KHÃ”NG coi scope/tenant Ä‘Ã£ tá»“n táº¡i | **High** â€” cross-org boundary |

---

## Â§8 â€” Sign-off statement

> **Gate 0 bundle hiá»‡n á»Ÿ tráº¡ng thÃ¡i `READY FOR INDEPENDENT AUDIT`** â€” T1
> self-check Ä‘Ã£ PASS cho `npm run typecheck` + `npm test` 372/372 fixtures.
> **KhÃ´ng cÃ³ nguá»“n independent audit** (ngÆ°á»i/agent, pháº¡m vi, snapshot,
> verdict) cho claim `READY-TO-FREEZE, 7/7 PASS` â€” Ä‘á»£t 0.8 ghi nháº­n tráº¡ng
> thÃ¡i nÃ y Ä‘á»ƒ trÃ¡nh tá»± cÃ´ng bá»‘ canonical khi chÆ°a cÃ³ Auditor Ä‘á»™c láº­p.
>
> **Owner Chá»§ nhÃ¢n cÃ³ 2 lá»±a chá»n sau Ä‘Ã¢y**:
>
> 1. **YÃªu cáº§u independent audit** trÆ°á»›c khi FREEZE â€” giao bundle cho
>    Auditor ngoÃ i (ngÆ°á»i/agent) review full 80 file (xem Â§6.0 bundle
>    scope); Auditor Ä‘Æ°a verdict `READY-TO-FREEZE` hay list finding cáº§n
>    sá»­a. Sau audit PASS â†’ Owner sign-off + commit/tag `Gate 0 FREEZE` +
>    ghi CHECKPOINT.
> 2. **Sign-off Ä‘iá»u kiá»‡n** â€” náº¿u Owner Ä‘Ã¡nh giÃ¡ T1 self-check Ä‘á»§ vÃ 
>    cháº¥p nháº­n bá» qua independent audit, Owner ghi rÃµ "Owner-accepted
>    without independent audit" + commit/tag Gate 0 FREEZE.
>
> **T1 KHÃ”NG tá»± commit, KHÃ”NG tá»± stamp CHECKPOINT FREEZE, KHÃ”NG tá»± chuyá»ƒn
> sang V7.9a 1.0â€“1.15** â€” chá» Owner xÃ¡c nháº­n rÃµ. Commit/tag khÃ´ng tá»±
> thay sá»± xÃ¡c nháº­n cá»§a Owner.

**Critical decisions cáº§n Owner chá»‘t trÆ°á»›c FREEZE (xem Â§3.0)**:

- G0-06 (Q-6) case domain
- G0-07 (Q-7) HRP review pre/post-apply
- G0-08 (Q-8) managed mode
- Q-19 PlacementCase open-status/transitions
- Q-21 Talent/Client interaction auth/delegation
- Q-22 occurredAt/effectiveAt/recordedAt order
- Q-23 Client required context

7 Q trÃªn chá»‰ ghi UNKNOWN chÆ°a Ä‘á»§ Ä‘á»ƒ freeze; Owner cáº§n chá»n phÆ°Æ¡ng Ã¡n A/B
hoáº·c má»Ÿ Owner-issued PR trÆ°á»›c khi Auditor Ä‘Ã¡nh giÃ¡ cuá»‘i.

TÃ³m táº¯t tráº¡ng thÃ¡i Ä‘á»£t 0.8:

- **Bundle Gate 0** gá»“m 5 phase tasks (0.3aâ€“0.7) + matrix 0.6 (48 dÃ²ng) +
  fixtures coverage (372/372 PASS â€” self-check) + README + CHANGELOG.
  HEAD `414c54b` chá»‰ chá»©a connector docs; source/tests/config/lockfile
  untracked táº¡i working tree.
- **AC0.8 #1** (command-by-command): Â§2 â€” 23 section phá»§ 23 file
  `packages/contracts/src/commands/*.ts` + section phá»¥ envelopes/errors/
  primitives/enums; má»—i section cÃ³ 7 cá»™t (Command/Query | Fields | Result
  | Permission (tier) | Invariants | Error/Retry | Files).
- **AC0.8 #2** (Phase 9 vs Phase 10): Â§3 â€” Â§3.0 liá»‡t kÃª 7 critical Q cÃ²n
  open + path bá»‹ cháº·n + phÆ°Æ¡ng Ã¡n Ä‘á» xuáº¥t; Â§3.1 tá»•ng há»£p Phase 9/10
  status; Â§3.2 disable Phase 10 module (`kpi.ts` namespace
  `phase10-experimental` Q-35; `analytics.ts` `EXPERIMENTAL â†’ UNAVAILABLE`
  Q-9).
- **AC0.8 #3** (Out-of-scope): Â§4 â€” KHÃ”NG cÃ³ Prisma/Route Handler/Backend;
  `packages/contracts/package.json` chá»‰ cÃ³ `zod@3.24.2` + `typescript@5.7.3`.
- **AC0.8 #4** (Owner sign-off): Â§5 â€” báº£ng Owner sign-off Ä‘á»ƒ trá»‘ng; 9
  downstream items chá» HRP-owned PR.
- **Manifests & hashes**: Â§6.0 bundle scope (80 file thá»§ cÃ´ng + dist tá»±
  sinh); Â§6.1 source TS (27); Â§6.2 tests (23); Â§6.3 config+lockfile (3);
  Â§6.4 Importal docs (6, tracked táº¡i HEAD); Â§6.5 contracts docs (21);
  Â§6.6 package docs (3); Â§6.7 self-reference.
- **Limits & known open**: Â§7 â€” 7 risk T1 ghi nháº­n (chÆ°a Auditor Ä‘á»™c láº­p
  Ä‘Ã¡nh giÃ¡).
- **Self-check**: `npm run typecheck` PASS; `npm test` 372/372 PASS;
  `git status --porcelain` khÃ´ng cÃ³ tracked modified; 2 sá»­a vÄƒn báº£n (a) (b)
  + 3 file má»›i (checklist + handoff 0.8 + manifest 0.8).
- **Tráº¡ng thÃ¡i hiá»‡n táº¡i**: `READY FOR INDEPENDENT AUDIT` â€” chÆ°a FREEZE
  Gate 0; Owner cÃ³ tháº©m quyá»n quyáº¿t Ä‘á»‹nh audit hay sign-off cÃ³ Ä‘iá»u kiá»‡n.
## §9 — F1–F5 Fix Status (đợt 0.8-fixes)

Sau khi Owner cung cấp báo cáo Auditor chỉ ra 5 finding Gate 0, T1 đã áp
dụng F1–F5 với phạm vi khắc phục Gate 0 (không mở backend/feature mới).

| Fix | Status | File mới | File sửa | Test evidence |
|---|---|---|---|---|
| **F1 Merge/Review contracts** | FIXED (placeholder schema) | `src/commands/merge-review.ts` | `src/index.ts` (exports), matrix rows 3/15/16/17 (PROPOSED/UNAVAILABLE marker) | `tests/fixtures-fix-f1-f5.test.mjs` |
| **F2 HRP_UI gateway context** | FIXED (source discriminator) | — | `src/commands/intake.ts` (`IntakeContextRefSchema`), `src/commands/interactions.ts` (`InteractionContextRefSchema`) | `tests/test-helpers.mjs` (src/ext helpers), `fixtures-fix-f1-f5.test.mjs`, fixture migration trên 7 file tests |
| **F3 Calendar dates reuse** | FIXED (no new clock policy) | — | `src/commands/identity.ts` (dob), `src/commands/intake.ts` (dob), `src/commands/analytics.ts` (periodStart/End), `src/commands/kpi.ts` (periodStart/End), `src/commands/scheduling.ts` (availableFromDate) | `tests/fixtures-fix-f1-f5.test.mjs` (leap year + invalid date) |
| **F4 DNC reasons canonical** | FIXED (single DncReasonSchema + alias) | `src/commands/dnc.ts` | `src/commands/identity.ts` (DncActionSchema.reason), `src/commands/suppression.ts` (import canonical), matrix row 10 | `tests/fixtures-fix-f1-f5.test.mjs` (canonical + legacy + normalize) |
| **F5 AI evidence refs reuse** | FIXED (reuse CommandEvidenceRefSchema) | — | `src/commands/ai-proposals.ts` (evidenceRefs in AIProposalSchema + AIProposalFieldSchema) | `tests/fixtures-fix-f1-f5.test.mjs` (accept std, reject inline) |

**Q refs mới**: Q-38 (F1 contract placeholder), Q-39 (F2 source discriminator),
Q-40 (F3 CalendarDate reuse), Q-41 (F4 canonical DNC), Q-42 (F5 evidence ref reuse),
Q-43 (HRP_POLICY ≠ auto-authority). Xem `decision-register.md` mục cuối.

**Breaking change** (version bump 0.0.7 → 0.0.8): `intake.ts` và `interactions.ts`
context schema đổi từ `{provider, connectionId, external*}` sang `{source: CommandSourceSchema, external*}`.
Identity `DncActionSchema.reason` chấp nhận cả `PRIVACY` (legacy) và `PRIVACY_REQUEST`
(canonical) qua `DncReasonAcceptAliasSchema`; `normalizeDncReason` giúp canonicalize.

**Version**: `packages/contracts/package.json` version `0.0.8-g0.8-fixes`;
`src/index.ts` PACKAGE_VERSION `0.0.8-g0.8-fixes`.

**Audit status**: `CHANGES_REQUIRED` — chưa có verdict mới từ independent Auditor
sau đợt F1–F5. T1 ghi nhận F1–F5 đã được áp dụng đúng theo báo cáo; Owner
gửi bundle cho independent Auditor để recheck và ra verdict mới.

**Out-of-scope từ chối**: Không sửa shared contracts ngoài F1–F5 scope, không
build backend/Prisma/migration/route handler, không gọi model/provider thật.


## Â§9.1 â F2 Follow-up Recheck (Äá»£t 0.8-fixes-v2)

Sau Äá»£t F1âF5, Auditor recheck má» láº¡i F2 (HRP_UI gateway context) â xÃ¡c
nháº­n F2 chÆ°a ÄÃ³ng táº¡i `HrpGatewayCallContextSchema` á» `gateway.ts`. T1 ÄÃ£
Ã¡p dá»¥ng F2 follow-up vá»i pháº¡m vi kháº¯c phá»¥c ÄÃºng finding (chá»
`HrpGatewayCallContextSchema`), khÃ´ng má» láº¡i F1/F3/F4/F5.

| Má»¥c | Chi tiáº¿t |
|---|---|
| **Finding** | F2 OPEN â `HrpGatewayCallContextSchema` chÆ°a parse ÄÆ°á»£c `HRP_UI` qua `INBOUND_DEFAULT`. Logic superRefine cÅ© yÃªu cáº§u `provider + connectionId` mÃ  khÃ´ng phÃ¢n biá»t HRP_UI (internal, connectionId=null) vs integration external (connectionId báº¯t buá»c). |
| **Fix location** | `packages/contracts/src/commands/gateway.ts` â `HrpGatewayCallContextSchema` |
| **Schema change** | `connectionId: ConnectionIdSchema.nullable().optional()` (má» null cho HRP_UI). `superRefine` phÃ¢n biá»t 3 nhÃ¡nh: `INBOUND_DEFAULT` + provider missing â reject; `INBOUND_DEFAULT` + `provider='HRP_UI'` â `connectionId` pháº£i null/undefined; `INBOUND_DEFAULT` + provider external â `connectionId` báº¯t buá»c; `INBOUND_REVIEWER`/`PRIVILEGED_MERGE` â KHÃNG provider/connectionId (regression). |
| **Regression guard** | Test `gateway-providers-ports.test.mjs` (3 tier table) pass; `INBOUND_REVIEWER`/`PRIVILEGED_MERGE` khÃ´ng provider/connectionId váº«n pass; external provider thiáº¿u connectionId váº«n reject. |
| **New test file** | `packages/contracts/tests/fixtures-fix-f2-gateway-hrpui.test.mjs` (13 fixture) |
| **Test count** | 385 â **398/398 PASS** (delta +13). `npm run typecheck` PASS. |
| **Â§2.3 update** | `docs/reviews/gate-0-checklist.md` Â§2.3 ÄÃ£ Äá»i tham chiáº¿u tá»« `profile.ts` sang `merge-review.ts` (F1). Ná»i dung merge-review placeholder schemas (4 commands + 2 helpers + marker). `profile.ts` giá»¯ nguyÃªn content á» Â§2.24 (cuá»i báº£ng Â§2). |
| **Manifest** | `docs/contracts/handoff-g0-0.8.manifest.txt` ÄÃ£ tÃ¡i táº¡o SAU má»i sá»­a Äá»i, Äá»i chiáº¿u toÃ n bá» entry khá»p vá»i file trÃªn disk. |
| **Q refs** | KhÃ´ng má» Q má»i â F2 follow-up náº±m trong Q-39 (F2 source discriminator) má» rá»ng. |
| **Version** | Giá»¯ `0.0.8-g0.8-fixes` (F2 follow-up khÃ´ng bump version â schema change tÆ°Æ¡ng thÃ­ch ngÆ°á»£c: cÅ© external cáº§n connectionId â váº«n yÃªu cáº§u; cÅ© reviewer/privileged khÃ´ng provider â váº«n cáº¥m; bá» sung HRP_UI path má»i). |
| **Audit status** | `CHANGES_REQUIRED` â chÆ°a cÃ³ verdict má»i tá»« independent Auditor sau F2 follow-up. |
| **Out-of-scope tá»« chá»i** | KhÃ´ng sá»­a F1/F3/F4/F5; khÃ´ng má» rá»ng quyá»n privileged/reviewer; khÃ´ng yÃªu cáº§u external connection cho HRP_UI; khÃ´ng má» Q má»i ngoÃ i Q-1..Q-43. |

**Diff F2 follow-up** (xem `packages/contracts/src/commands/gateway.ts`):

```
- connectionId: ConnectionIdSchema.optional()
+ connectionId: ConnectionIdSchema.nullable().optional()
- // PROVIDER/CONNECTION chá» há»£p lá» vá»i INBOUND_DEFAULT tier.
- if (val.tier === 'INBOUND_DEFAULT') {
-   if (!val.provider || !val.connectionId) {
-     /* reject: yÃªu cáº§u provider + connectionId */
-   }
- }
+ // INBOUND_DEFAULT tier yÃªu cáº§u provider. HRP_UI (internal) â
+ // connectionId pháº£i null/undefined; integration external â báº¯t buá»c.
+ if (val.tier === 'INBOUND_DEFAULT') {
+   if (!val.provider) {
+     /* reject: thiáº¿u provider */
+     return;
+   }
+   if (val.provider === 'HRP_UI') {
+     if (val.connectionId !== undefined && val.connectionId !== null) {
+       /* reject: HRP_UI khÃ´ng Äi kÃ¨m connectionId */
+     }
+   } else {
+     if (val.connectionId === undefined || val.connectionId === null) {
+       /* reject: external yÃªu cáº§u connectionId */
+     }
+   }
+   return;
+ }
```

**TrÆ°á»c/sau evidence** (fixture `HrpGatewayCallContextSchema`):

| Fixture | TrÆ°á»c sá»­a | Sau sá»­a |
|---|---|---|
| `INBOUND_DEFAULT` + `provider='HRP_UI'` + `connectionId=null` | â FAIL (superRefine reject vÃ¬ thiáº¿u connectionId) | â PASS |
| `INBOUND_DEFAULT` + `provider='CHATWOOT'` + `connectionId='conn-1'` | â PASS | â PASS (regression) |
| `INBOUND_DEFAULT` + `provider='CHATWOOT'` (thiáº¿u connectionId) | â FAIL | â FAIL (regression) |
| `INBOUND_REVIEWER` + khÃ´ng provider | â PASS | â PASS (regression) |
| `PRIVILEGED_MERGE` + khÃ´ng provider | â PASS | â PASS (regression) |
| `PRIVILEGED_MERGE` + provider external | â FAIL | â FAIL (regression) |
| `INBOUND_DEFAULT` + provider khÃ´ng há»£p lá» (`INVALID PROVIDER`) | â FAIL (regex) | â FAIL (regression) |

**Summary**: F2 follow-up ÄÃ³ng finding `HrpGatewayCallContextSchema` HRP_UI path; regression tests cho tier/privileged boundaries giá»¯ nguyÃªn; manifest ÄÆ°á»£c tÃ¡i táº¡o sau má»i sá»­a Äá»i. Audit status váº«n `CHANGES_REQUIRED` cho tá»i verdict má»i.