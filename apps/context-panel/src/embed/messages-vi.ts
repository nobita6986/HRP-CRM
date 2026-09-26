/**
 * context-panel/src/embed/messages-vi.ts — B.03-PREP allowlisted Vietnamese copy.
 *
 * Every user-visible string in the embed panel UI is sourced from this object.
 * Tests assert that NO raw internal error code, raw exception message, stack
 * trace, or parser detail is rendered as visible text. The keys below are the
 * full allowlist for user-visible copy.
 *
 * All Vietnamese diacritics are composed UTF-8 NFC (no BOM).
 */
export const MESSAGES_VI = Object.freeze({
  idle: 'Đang chờ yêu cầu từ embed host...',
  loading: 'Đang tải ngữ cảnh...',
  deniedHeader: 'Không thể hiển thị ngữ cảnh.',
  hidden: '(ẩn)',
  sourceInvalid: 'Nguồn không hợp lệ.',
  payloadTooLarge: 'Yêu cầu quá lớn. Vui lòng thử lại.',
  requestInvalid: 'Yêu cầu không hợp lệ.',
  requestTimeout: 'Yêu cầu quá thời gian. Vui lòng thử lại.',
  sessionInvalid: 'Vui lòng đăng nhập lại.',
  crossOrgDenied: 'Bạn không có quyền truy cập tổ chức này.',
  objectDenied: 'Bạn không có quyền xem hồ sơ này.',
  projectionUnsupported: 'Trường dữ liệu không được hỗ trợ.',
  stale: 'Dữ liệu đã cũ. Vui lòng tải lại.',
  unavailable: 'Dịch vụ tạm thời không khả dụng.',
  dataInvalid: 'Dữ liệu không hợp lệ.',
} as const);
export type MessageKey = keyof typeof MESSAGES_VI;
