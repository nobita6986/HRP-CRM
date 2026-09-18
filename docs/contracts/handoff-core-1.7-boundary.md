# CORE/1.7 - Review Service HTTP Boundary Hardening

## 0. Auditor F1 Fix — Mock Boundary Guard

### Finding (from independent Auditor)

**F1 — Mock boundary guard**: `/mock/review/*` routes không bị chặn khi `mockMode=off`. Guard chỉ tồn tại ở cấp handler (actor header) nhưng không ở server routing level. Actor header có thể bị bypass vì nó là client-supplied.

### Fix Applied

Added server-level guard in `handleRequest()` (server.ts), BEFORE calling `reviewHandler.handle()`:

```typescript
const segments = path.split('/').filter(Boolean);
if (segments[0] === 'mock' && segments[1] === 'review') {
  if (config.mockMode === 'off') {
    return respondJson(res, 404, {
      error: 'mock_disabled',
      path,
      message: '/mock/review/* chặn khi HRP_MOCK_MODE=off. ' +
        'Review routes chỉ có hiệu lực ở HRP_MOCK_MODE=deterministic.',
    });
  }
  // Mock mode enabled: delegate to review handler.
  return reviewHandler.handle(req, res);
}
```

**Consistent với** CORE/1.2 gateway guard pattern (`isMockGatewayRoute` block).

### F1 Test Coverage (23 tests)

| Category | Tests | Pass |
|----------|-------|------|
| T1: mockMode=off blocks all 6 endpoints | 6 | ✅ |
| T2: Valid actor header bypasses guard | 3 | ✅ |
| T3: Spy proves service NOT called | 3 | ✅ |
| T4: Mock enabled flows work | 7 | ✅ |
| T5: Regression (gateway/health/unknown) | 4 | ✅ |
| **Total** | **23** | **✅ 23**

## 1. Root cause analysis (đính chính)

### 1.1 Luồng thực tế server ↔ handler

`integration-api/src/server.ts` gọi `reviewHandler.handle(req, res)` cho mọi request đến `/mock/review/*`. Handler class `ReviewHttpHandler` chứa:

- `handle()` - router, synchronous, wrap try/catch cho GET handlers (service throws sync).
- `handleDecide()`, `handleLink()`, `handleUnlink()`, `handleReplay()` - POST handlers, dùng `.then()` pattern cho `parseBody()`.

### 1.2 Vấn đề

**Async error propagation trong `.then()` callback**:

```javascript
// Code cũ (BUG)
private async handleDecide(req, res) {
  this.parseBody(req).then((raw) => {
    // ...
    const result = this.opts.service.submitDecision(...); // throws ReviewServiceError
    respondJson(res, 200, result); // KHÔNG chạy khi throw
  }).catch((err) => {
    // Chỉ catch parse errors, KHÔNG catch service errors
  });
}
```

`ReviewServiceError` được throw bên trong `.then()` callback → promise reject → `.catch()` chỉ catch JSON parse errors từ `parseBody()` → unhandled promise rejection → response không được gửi hoặc gửi sai.

### 1.3 Fix đã áp dụng

1. **Wrap service calls trong `try/catch` bên trong `.then()`**:

```javascript
// Code mới (FIXED)
private handleDecide(req, res) {
  this.parseBody(req).then((raw) => {
    // ...
    try {
      const result = this.opts.service.submitDecision(...);
      respondJson(res, 200, result);
    } catch (err) {
      // Catch ReviewServiceError → map sang HTTP status
    }
  }).catch((err) => {
    // Catch parse errors only
  });
}
```

2. **Error format chuẩn**:
   - `error`: human-readable message kèm code prefix (e.g. `"VALIDATION_ERROR: Invalid targetKind: BOGUS"`)
   - `code`: machine-readable code (`NOT_FOUND`, `FORBIDDEN`, `VALIDATION_ERROR`, `VERSION_CONFLICT`, `UNAUTHORIZED`, `INTERNAL_ERROR`)
   - HTTP status mapping:
     - NOT_FOUND → 404
     - FORBIDDEN, VALIDATION_ERROR, VERSION_CONFLICT → 403
     - UNAUTHORIZED → 401
     - INTERNAL_ERROR → 500

## 2. HTTP boundary self-check

15 tests (`tests/http-boundary.test.mjs`) verify:

| ID | Test | Status |
|----|------|--------|
| B1.1 | Valid route không rơi vào fallback 404 | ✅ |
| B1.2 | Valid detail (existing/nonexistent) | ✅ |
| B1.3 | Unknown route → 404 route_not_found | ✅ |
| B2.1 | POST success → 200, chỉ một response | ✅ |
| B2.2 | POST VERSION_CONFLICT → 403, không unhandled | ✅ |
| B2.3 | POST VALIDATION_ERROR → 403 | ✅ |
| B3.1 | Error không lộ stack trace | ✅ |
| B3.2 | Invalid JSON → 400, không lộ chi tiết | ✅ |
| B3.3 | Error response có đầy đủ fields | ✅ |
| B4.1 | NOT_FOUND → 404 | ✅ |
| B4.2 | VALIDATION_ERROR → 403 | ✅ |
| B4.3 | VERSION_CONFLICT → 403 | ✅ |
| B4.4 | Invalid JSON → 400 | ✅ |
| B5.1 | GET/POST không nhầm lẫn | ✅ |
| B5.2 | Missing fields → 400 | ✅ |

## 3. AC Coverage

18 tests (`tests/ac-coverage.test.mjs`) verify CORE/1.7 acceptance criteria:

### AC1: Permissions + scope + PII guard
| ID | Test | Status |
|----|------|--------|
| AC1.1 | Cross-org access bị reject (403/404) | ✅ |
| AC1.2 | Audit detail bị strip (PII guard) | ✅ |
| AC1.3 | List output không lộ PII | ✅ |
| AC1.4 | USER actor tier INBOUND_REVIEWER | ✅ |
| AC1.5 | SERVICE actor tier PRIVILEGED_REVIEWER | ✅ |

### AC2: Decision + version conflict không overwrite
| ID | Test | Status |
|----|------|--------|
| AC2.1 | Decision ghi reviewer/reason/version/audit | ✅ |
| AC2.2 | Stale version không overwrite | ✅ |
| AC2.3 | Version mismatch → VERSION_CONFLICT | ✅ |

### AC3: Link/unlink ≠ merge
| ID | Test | Status |
|----|------|--------|
| AC3.1 | Link thêm anchor nhưng không merge | ✅ |
| AC3.2 | Unlink không affect canonical | ✅ |
| AC3.3 | Không có mergeLaborProfiles | ✅ |
| AC3.4 | Link target kinds giới hạn | ✅ |

### AC4: Replay revalidate, không lặp mutation
| ID | Test | Status |
|----|------|--------|
| AC4.1 | COMPLETED → ALREADY_APPLIED | ✅ |
| AC4.2 | Digest drift → DRAFT_DIGEST_CHANGED | ✅ |
| AC4.3 | PARTIAL → canProceed=true | ✅ |
| AC4.4 | CanonicalId drift → CANONICAL_TARGET_CHANGED | ✅ |
| AC4.5 | CanonicalVersion drift → VERSION_CONFLICT | ✅ |
| AC4.6 | Replay read-only (không thêm audit) | ✅ |

## 4. Test results

### Review-specific
```
tests/review-http.test.mjs       : 13/13 ✅
tests/review-service.test.mjs    : 29/29 ✅
tests/http-boundary.test.mjs     : 15/15 ✅
tests/ac-coverage.test.mjs       : 18/18 ✅
tests/f1-mock-guard.test.mjs     : 23/23 ✅  (F1: Auditor fix)
```

### Full regression
| Module | Tests | Pass |
|--------|-------|------|
| integration-api | 248 | ✅ 248 |
| integration-worker | 56 | ✅ 56 |
| contracts | 398 | ✅ 398 |
| config | 16 | ✅ 16 |
| context-panel | 11 | ✅ 11 |
| **Tổng** | **729** | **✅ 729** |

## 5. Limitations

1. **In-memory store**: `reviewStore` là singleton in-memory, restart process mất entries. Đây là intentional cho synthetic testing.
2. **Mock routes only**: `/mock/review/*` chỉ hoạt động khi `HRP_MOCK_MODE=deterministic`. Server-level guard (F1) chặn ở routing trước khi gọi service.
3. **No merge capability**: ReviewService không có `mergeLaborProfiles`, `merge`, hay `union` — đây là intentional AC3 boundary.
4. **Frozen contracts**: `packages/contracts/src/commands/merge-review.ts` không được sửa.
5. **Actor extraction**: Default actor là `SERVICE` kind nếu không có `x-review-actor` header. Production cần auth middleware riêng. F1 guard chặn ở server-level nhưng không thay thế auth.
6. **Deterministic IDs**: `nextDecisionId`/`nextLinkId` dùng counter (reset per test). Production nên dùng `crypto.randomUUID()`.

## 6. Files changed

| File | SHA-256 | Change |
|------|---------|--------|
| `apps/integration-api/src/server.ts` | `4B9F167B...` | F1: Mock boundary guard for /mock/review/* |
| `apps/integration-api/src/review/http-handler.ts` | `BE01E907...` | DRY refactor (respondServiceError helper) |
| `apps/integration-api/src/review/review-service.ts` | `DC896BA9...` | Deterministic IDs (nextDecisionId/nextLinkId) |
| `apps/integration-api/src/review/review-store.ts` | `7EC0CEE3...` | Counter helpers for deterministic IDs |
| `apps/integration-api/tests/f1-mock-guard.test.mjs` | `1DC91D5E...` | New: 23 F1 tests |
| `apps/integration-api/tests/http-boundary.test.mjs` | `39724AC7...` | New: 15 boundary tests |
| `apps/integration-api/tests/ac-coverage.test.mjs` | `7049E54C...` | New: 18 AC tests |

## 7. Status: READY FOR AUDIT (F1+F2 FIXED)
