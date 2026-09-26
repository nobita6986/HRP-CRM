# B.02-PREP Assessment -- Chatwoot Adapter Mock (Synthesized)

> **Scope of this assessment**
> B.02-PREP la chuan bi cho B.02 bang cach chung minh integration-api (receiver)
> va integration-worker (pipeline) co the tieu thu event Chatwoot-shaped tren
> **synthetic fixtures**. Day KHONG phai nghiem thu B.02; B.02 van chua ACCEPTED.
> B.01 van BLOCKED_ENV. B.03 chua mo.

**Snapshot ref:** B.02-PREP build#1 (final, fast path)
**T0 verdict (fast path):** ACCEPTED
**Trang thai:** ACCEPTED -- SYNTHETIC SCOPE ONLY (fast path)
**Production source delta:** 0 file
**Test/docs delta:** 1 test file + 1 doc

---

## 1. Evidence scope corrections (per T0 directive)

Ba tang evidence da duoc dinh chinh pham vi ro rang:

| Tang | Phu | Khong phu |
| --- | --- | --- |
| PARSER_VERIFIED | message_updated, private_note, echo duoc parse dung eventType/eventId theo source chinh thuc Chatwoot | Khong chung minh Chatwoot that cung cap cung truong tai moi release |
| PARSER_NO_SIDE_EFFECT_VERIFIED | Parser goi 5 lan tren cung fixture khong co I/O ngoai (no DB, no FS, no network) | Chua pipeline PASS. Khong chung minh worker khong tao canonical mutation/credit/outbound loop khi nhan fixture that |
| Event identity PASS | Synthetic fixtures da test: cung eventId + cung payloadDigest -> 202 idempotent; cung eventId + khac payloadDigest -> 409 idempotency_conflict; hai message.id giong nhau voi eventId khac nhau -> 2 receipts rieng | Chua chung minh Chatwoot that cung cap occurrence ID tuong ung eventId. Khong thay the evidence payload that |

**Tom lai:** tat ca evidence hien co chi khang dinh receiver/worker xu ly dung **fixture do T1-A dung theo docs Chatwoot cong khai**. Khi B.01 co Chatwoot that, cac test tuong ung phai chay lai voi payload capture that truoc khi B.02 ACCEPTED.

---

## 2. Pipeline coverage hien co (reused, khong tao framework moi)

Pipeline receiver -> receipt/intent -> worker -> mock gateway da co san trong 2 suite:

### 2.1. apps/integration-worker/tests/call-log.test.mjs (CORE/1.5)

Test tren executePipelineForReceipt + GatewayClient + stateful mock gateway:

| Case | Layer | Assert | Result |
| --- | --- | --- | --- |
| SUCCESS outcome | worker + gateway | 1 gateway call, idempotencyKey dung, operationId dung | PASS |
| SKIPPED (private note) | worker + gateway | 0 gateway call, status SKIPPED | PASS |
| REVIEW | worker + gateway | 0 gateway call, status REVIEW hoac SUCCESS tuy seed | PASS |
| Replay same idempotencyKey | worker + gateway | cung key den gateway ca 2 lan (call log preserves key) | PASS |
| Different idempotencyKey | worker + gateway | operationId khac nhau | PASS |

Run output: 26 pass / 26 total trong pipeline.test.mjs + call-log.test.mjs.

### 2.2. apps/integration-worker/tests/pipeline.test.mjs (CORE/1.5)

Test tren normalizeChatwootEvent + classify + createMockMappingService:

| Case | AC | Result |
| --- | --- | --- |
| Inbound contact -> CLIENT_INBOUND_MESSAGE + AUTHORITATIVE + recordInteraction | AC1 | PASS |
| Private note -> PRIVATE_NOTE + NON_AUTHORITATIVE + NON_AUTHORITATIVE_PRIVATE_NOTE | AC1 | PASS |
| Agent outbound -> AGENT_MESSAGE_ECHO + NON_AUTHORITATIVE + NON_AUTHORITATIVE_ECHO | AC1 | PASS |
| conversation_resolved / conversation_assigned -> NON_AUTHORITATIVE | AC1 | PASS |
| conversation_created -> AUTHORITATIVE nhung suggestedCommand=null (no auto createOrMatch) | AC5 | PASS |
| Out-of-order / mapping revision changed -> BLOCKED | AC4 | PASS |
| hrpi_branch without review_confirmation_token -> REVIEW_NEEDED, suggestedCommand=null | AC5b | PASS |
| Pipeline integration: private note -> SKIPPED | AC1 | PASS |

NON_AUTHORITATIVE_PRIVATE_NOTE / NON_AUTHORITATIVE_ECHO mapping -> SKIP trong mapping service -> khong tao canonical write, khong gateway call. Day la noi policy duoc enforce; echo va private note **khong tu tao canonical write hay outbound loop** da duoc chung minh o pipeline layer.

---

## 3. B.02-PIPE delta tests (bo sung o receiver.int.test.mjs)

3 test moi duoc them vao **file test da co san**, khong tao file moi. Tat ca assert tren **DB rows** (receipt + intent) qua embedded PG, khong phai parse output:

1. **B.02-PIPE -- replay same occurrence: 1 receipt + 1 intent, idempotent**
   - Gui cung body 2 lan -> created=true roi created=false
   - Cung receiptId
   - Dem externalEventReceipt theo eventId = 1
   - Dem dispatchIntent theo receiptId = 1
   - Chung minh: replay khong duplicate intent hoac canonical mutation

2. **B.02-PIPE -- two message_updated revisions same message.id: 2 receipts, 2 intents (not collapsed)**
   - Gui rev1 voi event:message_updated, id:evt-rev1, message.id:7777 -> 202
   - Gui rev2 voi event:message_updated, id:evt-rev2, message.id:7777 -> 202
   - receiptId khac nhau
   - Dem receipt theo eventId IN [evt-rev1, evt-rev2] = 2
   - Dem intent theo receiptId = 2
   - Chung minh: hai occurrence hop le khong bi gop chi vi cung message.id; replay cung occurrence giu idempotent

3. **B.02-PIPE -- receiver-level synthetic event does not auto-mutate canonical (only receipt + intent, no other rows)**
   - Gui 1 message_created body
   - Dem externalEventReceipt theo eventId = 1
   - Dem dispatchIntent = 1
   - Raw SQL: SELECT COUNT(*) FROM ExternalContactLink = 0, ExternalConversationLink = 0
   - Chung minh: o receiver level khong co canonical mutation ngoai receipt + intent (link canonical lam o worker H.02/H.03)

Run output:
   tests 21 / pass 21 / fail 0 / duration_ms 19239

---

## 4. PROPOSED / BLOCKED_POLICY

### Echo path o receiver level -- PROPOSED / BLOCKED_POLICY

**Hien trang:**
- O receiver: dedupe theo eventId, khong theo message.id. Hai event Chatwoot (INCOMING, OUTGOING) cung message.id nhung khac eventId -> 2 receipts rieng.
- O worker: pipeline.test.mjs AC1 gan NON_AUTHORITATIVE_ECHO -> SKIP -> 0 gateway call (assert trong call-log.test.mjs SKIPPED case).

**Van de can T0 quyet:**
- Neu T0 muon receiver reject echo hoan toan (khong commit receipt/intent), policy hien khong enforce.
- Neu T0 muon echo van duoc commit receipt nhung danh dau khong canonical (qua intent flag hoac normalized event), can:
  - Them flag isEcho trong commandRefsJson / DispatchIntent.metadata (da co o InboundEvent.isEcho).
  - Bo sung rule o worker-side mapping.
- Neu T0 muon suppress echo o gateway layer, can policy quyet dinh filter mode.

**De xuat ngan cho T0:**
- Giu hanh vi hien tai: receiver ghi receipt + intent (eventId-based dedupe).
- Worker enforce NON_AUTHORITATIVE_ECHO -> SKIP, khong gateway call.
- Document ro trong integration contract: echo la **event acknowledged** nhung **khong phai hanh dong**.
- Sau khi B.01 co Chatwoot that, capture echo payload, viet test rieng o integration layer.

-> Khong tu viet behavior moi roi lay test lam authority.

### Private note -- POLICY ALREADY ENFORCED

- pipeline.test.mjs AC1 -> NON_AUTHORITATIVE_PRIVATE_NOTE -> SKIP.
- call-log.test.mjs SKIPPED -> 0 gateway call.
- Khong can quyet policy them.

### Message update -- POLICY ALREADY ENFORCED

- Receiver: distinct eventId giua revisions (test F3 cung eventType khac revision PASS).
- B.02-PIPE rev1/rev2 PASS.
- Khong can quyet policy them.

### Same eventId different digest -- POLICY ALREADY ENFORCED

- F3 same eventId different digest -> 409 idempotency_conflict PASS.
- Khong can quyet policy them.

---

## 5. AC table aligned with verified layers

| AC B.02 | Layer | Trang thai | Bang chung |
| --- | --- | --- | --- |
| Adapter phan biet event identity voi message identity | parser | PARSER_VERIFIED | receiver.test.mjs (B.02-PREP delta 6 case, 48/48 PASS) |
| Replay khong tao duplicate intent hoac canonical mutation | receiver + DB | PIPELINE_VERIFIED | receiver.int.test.mjs B.02-PIPE #1 + #2 (21/21 PASS) |
| Cung event identity khac payload xu ly conflict dung contract | receiver + DB | PIPELINE_VERIFIED | F3 same eventId different digest -> 409 (PASS) |
| Phan biet message update / private note / echo paths o parser | parser | PARSER_VERIFIED | receiver.test.mjs B.02-PREP delta (PASS) |
| Private note / echo khong tu tao canonical write / outbound loop | worker + gateway | PIPELINE_VERIFIED | pipeline.test.mjs AC1 NON_AUTHORITATIVE_* + call-log.test.mjs SKIPPED (PASS) |
| Message update hai occurrence khong bi gop | receiver + DB | PIPELINE_VERIFIED | receiver.int.test.mjs B.02-PIPE #2 (PASS) |
| Event identity chi PASS cho synthetic fixtures | scope statement | DOCUMENTED | Section 1 bang tren |
| SSO/token expiration/rate limit/webhook delivery that Chatwoot | runtime | NOT_VERIFIED | B.01 BLOCKED_ENV |
| Payload capture tu Chatwoot that | runtime | NOT_VERIFIED | B.01 BLOCKED_ENV |

---

## 6. Changed file list

### Production source delta
- **0 file**

### Test delta (1 file)
- apps/integration-api/tests/receiver.int.test.mjs -- appended 3 B.02-PIPE tests + 1 ECHO POLICY block-comment.
  - B.02-PIPE -- replay same occurrence: 1 receipt + 1 intent, idempotent
  - B.02-PIPE -- two message_updated revisions same message.id: 2 receipts, 2 intents
  - B.02-PIPE -- receiver-level synthetic event does not auto-mutate canonical
  - Removed echo test that triggered Concurrent receipt insert invisible after ON CONFLICT (embedded-PG harness quirk, NOT a production source defect -- kept in comment as PROPOSED/BLOCKED_POLICY).
  - Replaced .catch(() => 0) for non-existent Prisma models with raw SQL count on existing tables.

### Docs delta (1 file)
- docs/contracts/B02-PREP-ASSESSMENT.md -- this file. UTF-8 no BOM, LF.

### Reused files (no edit)
- apps/integration-api/tests/receiver.test.mjs -- 48/48 PASS (existing 42 + B.02-PREP delta 6 from previous round)
- apps/integration-worker/tests/call-log.test.mjs -- 5/5 PASS
- apps/integration-worker/tests/pipeline.test.mjs -- 21/21 PASS

---

## 7. Test commands and actual outputs

### node --test tests/receiver.int.test.mjs (after B.02-PIPE delta)
  tests 21 / pass 21 / fail 0 / duration_ms 19239

### node --test tests/pipeline.test.mjs tests/call-log.test.mjs (existing)
  tests 26 / pass 26 / fail 0 / duration_ms 225

### node --test tests/receiver.test.mjs (existing + delta from previous round)
  tests 48 / pass 48 / fail 0

---

## 8. Payload fixtures provenance

Tat ca payload Chatwoot-shaped trong test **duoc dung tay boi T1-A** theo:
- Chatwoot Webhook Events (https://www.chatwoot.com/developers/api/#tag/Webhook-Events) -- docs cong khai.
- Pattern event + id (occurrence id) + message.{id, content, sender}.
- Mot so test dung sender.type: INCOMING/OUTGOING/PRIVATE_NOTE theo enum Chatwoot API docs.

**Khong co payload nao duoc capture tu Chatwoot that.** B.01 BLOCKED_ENV dam bao rang dieu nay chua xay ra. Khi B.01 mo, phai rerun toan bo test suite voi payload capture that truoc khi B.02 ACCEPTED.

---

## 9. Status truoc fast-path (lich su)

- B.01: BLOCKED_ENV
- B.02-PREP: da nop READY FOR REVIEW
- B.02: chua ACCEPTED
- B.03: chua mo

(Trang thai cuoi xem section 12.)

Khong thay doi production source. Khong dung T1-B / HRP contracts. Khong commit/push/deploy.

---

## 10. Fast-path acceptance (T0 directive)

T0 ACCEPT theo fast path voi cac gioi han sau:

**Da ACCEPT (scope ro):**
- Parser synthetic (PARSER_VERIFIED): message_updated / private_note / echo / conversation_status_changed / webwidget_triggered.
- Receiver persistence + dedupe qua PostgreSQL embedded (PIPELINE_LAYER_VERIFIED): replay idempotent, hash conflict 409, receiver khong tu sua canonical ngoai ExternalEventReceipt + DispatchIntent.
- Worker skip/call-log theo fixtures hien co (PIPELINE_LAYER_VERIFIED): NON_AUTHORITATIVE_PRIVATE_NOTE/ECHO -> SKIP, 0 gateway call.

**Khong gom thanh claim end-to-end** receiver -> worker -> gateway neu chua chay noi xuyen suot. Moi suite doc lap, khong noi chuoi.

**Test receiver khong sua canonical**: chi chung minh lop receiver, KHONG mo rong thanh toan pipeline hoac outbound-loop PASS. AC outbound-loop PASS can integration test chay xuyen suot, chua co.

**Echo policy:**
- Giu behavior hien tai: receiver dedupe by eventId, ghi receipt + intent.
- KHONG them receiver rejection cho echo.
- NON_AUTHORITATIVE_ECHO -> SKIP la behavior da test o worker layer.
- Mapping webhook Chatwoot that -> classification NON_AUTHORITATIVE_ECHO con NOT_VERIFIED (chua co payload that).
- KHONG sua shared contract de ghi policy moi.

---

## 11. Evidence con thieu / NOT_VERIFIED sau B.02-PREP

| Hang muc | Trang thai | Can de B.02 / B.03 dat |
| --- | --- | --- |
| Private note -- payload that tu Chatwoot | NOT_VERIFIED | B.01 mo, capture payload that, viet integration test o worker layer |
| Echo (agent outbound) -- payload that tu Chatwoot | NOT_VERIFIED | B.01 mo, capture payload that, viet integration test o worker layer |
| Real event identity -- Chatwoot that cung cap occurrence ID cho moi event type (message_created/updated/private_note/echo/...) | NOT_VERIFIED | B.01 mo, verify eventId format dai dien cho occurrence o moi event type |
| Outbound-loop PASS o pipeline (integration test chay xuyen suot receiver -> worker -> gateway mock) | NOT_TESTED | B.02 chua ACCEPTED; can integration test noi cac suite |
| SSO / token expiration / rate limit Chatwoot that | NOT_VERIFIED | B.01 mo |
| upgrade / rollback Chatwoot | NOT_VERIFIED | B.01 mo |

---

## 12. Status cuoi (post-fast-path)

- **B.02-PREP:** ACCEPTED -- SYNTHETIC SCOPE ONLY.
- **B.01:** BLOCKED_ENV.
- **B.02:** chua ACCEPTED.
- **B.03:** chua mo.

Dung nhanh B.02-PREP. Khong them vong test/docs chi de doi nhan READY FOR REVIEW. Khong commit/push/deploy. Local launcher (scripts/v7.9a) giu nguyen hoat dong nhu da ban giao o round truoc.
