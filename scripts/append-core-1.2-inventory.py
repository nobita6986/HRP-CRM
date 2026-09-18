"""
Append CORE/1.2 section to docs/contracts/inventory.md.
"""
import sys
from pathlib import Path

INV = Path("docs/contracts/inventory.md")
if not INV.exists():
    print("MISSING inventory.md", file=sys.stderr)
    sys.exit(1)

section = """
## CORE/1.2 — Webhook Receiver & Idempotency (2026-09-14)

**Status**: READY FOR AUDIT (T1 self-check PASS; 71/71 API + 24/24 store int + 15/15 config + 398/398 contracts).

### Files

| File | Approx LOC | Purpose |
|---|---|---|
| `apps/integration-api/src/receiver/protocol-fixture.ts` | 230 | Parse CHATWOOT/ZALO_OA/GENERIC shape + documented stable eventId fallback |
| `apps/integration-api/src/receiver/hmac-verify.ts` | 130 | HMAC SHA-256/512 + constant-time compare |
| `apps/integration-api/src/receiver/scope-verify.ts` | 110 | URL-path scope (NEVER body) + body scope-spoof detection |
| `apps/integration-api/src/receiver/dedupe.ts` | 130 | Orchestrate `commitReceiptWithIntents` (CORE/1.3) |
| `apps/integration-api/src/receiver/handler.ts` | 270 | HTTP pipeline + token bucket rate limit |
| `apps/integration-api/src/receiver/ack.ts` | 30 | Typed ACK shape |
| `apps/integration-api/src/server.ts` | +30 LOC | Wire `/webhooks/:org/:provider/:connectionId` route |
| `packages/config/src/types.ts` | +30 LOC | `ReceiverConfigSchema` extend `ApiConfigSchema` |
| `packages/config/src/loader.ts` | +12 LOC | `parseReceiverConfig` từ env |

### Tests

| File | Tests | Coverage |
|---|---|---|
| `apps/integration-api/tests/receiver.test.mjs` | 26 | Unit: protocol fixture, HMAC verify, scope, body spoof |
| `apps/integration-api/tests/receiver.int.test.mjs` | 10 | PG integration: HTTP 202, idempotent replay, hash conflict, scope spoof, malformed JSON, HMAC mismatch, missing eventId, payload too large, recovery, DB unavailable |
| `packages/config/tests/loader.test.mjs` | +2 | Receiver defaults + env override + min body size |

### Boundaries

- NO CORE/1.1 dependency (deliberate; gateway mock vẫn CHANGES_REQUIRED).
- NO CORE/1.5 normalize / domain orchestration (deferred).
- NO shared contracts delta (Gate 0 frozen 0.0.8-g0.8-fixes).
- NO HRP/provider/model thật, production DB, deploy.

### Open

- Q-48 fixture scope (synthetic HMAC, no real Zalo/Chatwoot verification).
- Q-49 eventId fallback policy (CHATWOOT/ZALO_OA/GENERIC documented).
- Q-50 in-memory rate limit (production Redis/edge deferred V7.9b/c).
- Provider adapter per-provider (Zalo challenge, Chatwoot handshake) deferred V7.9b/c.
"""

if "CORE/1.2" in INV.read_text(encoding="utf-8"):
    print("CORE/1.2 already in inventory.md, skipping")
    sys.exit(0)

with INV.open("a", encoding="utf-8", newline="\n") as f:
    f.write(section)

print("Appended CORE/1.2 section to inventory.md")
