/**
 * test-helpers.mjs — Transform helpers để test fixtures migrate từ
 * legacy source shape sang CommandSourceSchema discriminator.
 *
 * Lý do tồn tại (G0/0.8 F2 fix):
 *  - Trước F2, IntakeContextRefSchema và InteractionContextRefSchema dùng
 *    `{ provider: ProviderNameSchema, connectionId: ConnectionIdSchema.optional() }`.
 *  - Sau F2, schema yêu cầu `{ source: CommandSourceSchema,
 *    externalConversationId?, externalAccountId?, externalMessageId? }`.
 *  - Source discriminator HRP_UI vs INTEGRATION được primitives provide.
 *  - Test fixtures chuyển sang dùng `src({HRP_UI})` / `ext({provider, connectionId})`
 *    để đồng bộ với public contract.
 */

const HRP_UI_PROVIDER = 'HRP_UI';

/**
 * Tạo `source` cho HRP_UI (staff UI, không có connection ngoài).
 * @returns {{ kind: 'HRP_UI', provider: 'HRP_UI', connectionId: null }}
 */
export function src() {
  return { kind: 'HRP_UI', provider: HRP_UI_PROVIDER, connectionId: null };
}

/**
 * Tạo `source` cho INTEGRATION (Chatwoot/Zalo OA).
 * @param {string} provider — Chatwoot / Zalo OA / etc.
 * @param {string} connectionId
 * @returns {{ kind: 'INTEGRATION', provider: string, connectionId: string }}
 */
export function ext(provider, connectionId) {
  if (typeof provider !== 'string' || provider.length === 0) {
    throw new TypeError('ext(provider, connectionId): provider phải là string khác rỗng');
  }
  if (typeof connectionId !== 'string' || connectionId.length === 0) {
    throw new TypeError('ext(provider, connectionId): connectionId phải là string khác rỗng');
  }
  if (provider === HRP_UI_PROVIDER) {
    throw new RangeError(
      'ext() KHÔNG dùng cho HRP_UI (HRP_UI không có external connectionId). Dùng src() thay.',
    );
  }
  return { kind: 'INTEGRATION', provider, connectionId };
}

/**
 * Translate legacy `{ provider: 'X', connectionId: 'Y' }` sang
 * `{ source: { kind, provider, connectionId } }`. KHÔNG tự ý gọi helper
 * này từ public code — chỉ dùng trong test fixtures tạm.
 *
 * @param {{ provider?: string, connectionId?: string }} legacy
 * @returns {{ kind: 'HRP_UI', provider: 'HRP_UI', connectionId: null }
 *          | { kind: 'INTEGRATION', provider: string, connectionId: string }
 *          | null}
 */
export function sourceFromLegacy(legacy) {
  if (!legacy || typeof legacy !== 'object') return null;
  const { provider, connectionId } = legacy;
  if (provider === HRP_UI_PROVIDER) {
    if (connectionId !== undefined && connectionId !== null) {
      throw new RangeError(
        'legacy HRP_UI source không được có connectionId',
      );
    }
    return src();
  }
  if (typeof connectionId !== 'string' || connectionId.length === 0) {
    throw new RangeError('legacy external source thiếu connectionId');
  }
  return ext(provider, connectionId);
}
