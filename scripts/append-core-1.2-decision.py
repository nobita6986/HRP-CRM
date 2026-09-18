"""
Append CORE/1.2 decisions (Q-48, Q-49, Q-50) to docs/contracts/decision-register.md.
"""
import sys
from pathlib import Path

DR = Path("docs/contracts/decision-register.md")
if not DR.exists():
    print("MISSING decision-register.md", file=sys.stderr)
    sys.exit(1)

section = """
### CORE/1.2 — Webhook Receiver (2026-09-14)

**Q-48** (CORE/1.2 fixture scope): Protocol fixture CHATWOOT / ZALO_OA / GENERIC dùng synthetic HMAC secret từ env. **KHÔNG tuyên bố provider authenticity** — fixture chỉ phục vụ dev/test pipeline verify shape + signature. Real provider adapter (Zalo challenge handshake, Chatwoot webhook verify URL) đến V7.9b/c.
- Status: PROPOSED, đã ghi rõ trong `handoff-core-1.2.md` §9 + protocol-fixture.ts header.
- Blocked paths: KHÔNG (chỉ fixtures).
- Backlog AC: §Task 1.2 ("Mock verify không tuyên bố xác thực Zalo thật").

**Q-49** (eventId fallback policy): Documented stable fallback order per provider:
- CHATWOOT: `event_id` → `message.id`
- ZALO_OA: `event_id` → `message_id`
- GENERIC: `event_id` → `id` → `eventId` → `message_id` → `trace_id`

Thiếu stable id → reject 400 `missing_event_id`. **KHÔNG dùng timestamp nhận làm key** (Backlog §Task 1.2 AC rõ).
- Status: PROPOSED, đã align với brief, code có test cover (`missing eventId + missing fallback → 400`).
- Backlog AC: §Task 1.2.

**Q-50** (rate limit in-memory): Token bucket per `(org, provider, connectionId)` với 60s window, default 600 req/min/connection. **In-memory only** cho CORE/1.2 — production rate limit cần Redis/edge proxy, deferred to V7.9b/c. Restart process mất state.
- Status: PROPOSED, đã ghi rõ trong handoff §11.
- Blocked paths: KHÔNG (chỉ CORE/1.2 runtime).
- Production hardening: V7.9b/c edge rate limit.

### CORE/1.2 — Pre/post snapshot (2026-09-14)

Pre-coding snapshot:
- `packages/integration-store/src/worker/retry.ts` (Q-46 post-audit fix from CORE/1.4): `maxAttempts=8`, `jitterFraction=0.2` (đã verified trong `handoff-core-1.4.md` §13).
- All other CORE/1.4 / 1.3 / 1.0 / contracts files unchanged.

Post-coding (CORE/1.2):
- 7 new files in `apps/integration-api/src/receiver/` + 2 modified `packages/config/src/{types,loader}.ts` + 1 modified `apps/integration-api/src/server.ts`.
- 0 contract delta (frozen Gate 0 `0.0.8-g0.8-fixes`).
- 0 CORE/1.3 / CORE/1.4 delta.
"""

if "Q-48" in DR.read_text(encoding="utf-8"):
    print("Q-48 already in decision-register.md, skipping")
    sys.exit(0)

with DR.open("a", encoding="utf-8", newline="\n") as f:
    f.write(section)

print("Appended CORE/1.2 decisions to decision-register.md")
