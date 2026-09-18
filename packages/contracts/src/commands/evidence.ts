/**
 * evidence.ts — Evidence references cho CCCD và các tệp đính kèm intake.
 *
 * Ràng buộc (Master §10.3.1, §8 connector):
 *  - EvidenceRef chỉ chứa opaque ID + kind; KHÔNG base64, KHÔNG raw URL,
 *    KHÔNG public URL, KHÔNG cờ scan client-side.
 *  - Quyết định scan/hash/provenance do server (HRP hoặc evidence gateway
 *    nội địa) xác minh; client không được khai "đã quét".
 *  - Cross-organization refs bị chặn ở runtime; schema chỉ ràng buộc
 *    opaque shape + ownership scope do caller cung cấp.
 *  - Evidence ID KHÔNG tự nó chứng minh quyền đọc file.
 */
import { z } from 'zod';
import {
  ConnectionIdSchema,
  EvidenceIdSchema,
  OrganizationIdSchema,
} from '../primitives.js';
import { EvidenceKindSchema } from '../enums.js';

/**
 * Evidence reference opaque cho command layer.
 * Mở rộng `EvidenceRefSchema` (primitive) bằng organizationId + connectionId
 * để runtime có thể cross-check ownership/scope. Tách primitive vs command
 * để envelope primitives giữ shape tối thiểu, command có đủ scope.
 *
 *  - evidenceId: id do evidence service cấp, opaque.
 *  - kind: chỉ một trong EVIDENCE_KINDS (CCCD_FRONT|CCCD_BACK).
 *  - organizationId: organization sở hữu evidence; runtime chặn
 *    cross-org refs.
 *  - connectionId optional: provider/connection liên quan (Zalo OA, …).
 */
export const CommandEvidenceRefSchema = z
  .object({
    evidenceId: EvidenceIdSchema,
    kind: EvidenceKindSchema,
    organizationId: OrganizationIdSchema,
    connectionId: ConnectionIdSchema.optional(),
  })
  .strict();

/**
 * Alias giữ tên cũ cho backward-compat với code trước — định nghĩa trùng
 * primitive + command layer. Module `commands/evidence` re-export
 * `EvidenceRefSchema` từ primitives ở cuối file để caller dùng primitive
 * cho envelope, command cho DTO chi tiết.
 */
export type CommandEvidenceRef = z.infer<typeof CommandEvidenceRefSchema>;

/**
 * List of evidence refs.
 * - Min 1 cho intake CCCD (front + back); 0 cho actions không cần
 *   attachment (vd: DNC).
 * - Cờ min/max đặt ở wrapper schema theo từng use-case.
 */
export const EvidenceRefListSchema = z.array(CommandEvidenceRefSchema).max(8);

/**
 * Forbidden flags client KHÔNG ĐƯỢC set.
 * Server đọc metadata scan/provenance từ evidence service; nếu client
 * cố chèn, schema reject trước khi tới backend.
 */
export const EVIDENCE_FORBIDDEN_CLIENT_FLAGS = Object.freeze([
  'scanPassed',
  'scanStatus',
  'scanResult',
  'malwareDetected',
  'publicUrl',
  'rawUrl',
  'signedUrl',
  'base64',
  'dataUri',
  'sha256',
  'ownershipVerified',
  'ownerVerified',
] as const);

/**
 * Helper: strip mọi field cấm khỏi payload trước khi đưa vào canonical
 * command. Vẫn trả về object đã strip; nếu field cấm còn, schema cuối
 * cùng sẽ reject do strict mode.
 */
export const FORBIDDEN_FIELDS_EVIDENCE = new Set(EVIDENCE_FORBIDDEN_CLIENT_FLAGS);

/**
 * Evidence claim payload do intake form / worker gửi.
 * KHÔNG chứa scan flags / public URL / base64. Mọi thông tin provenance
 * do server xác minh và đính vào canonical command ở layer HRP-owned.
 */
export const EvidenceClaimSchema = z
  .object({
    /** Opaque refs; runtime cross-check với evidence service. */
    evidenceRefs: EvidenceRefListSchema,
    /** Mô tả ngắn do staff nhập (không phải PII). */
    note: z.string().max(500).optional(),
  })
  .strict()
  .superRefine((val, ctx) => {
    if (val.evidenceRefs.length === 0 && !val.note) {
      // Empty claim không có evidence và cả note thì vô nghĩa.
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'evidenceClaim phải có evidenceRefs hoặc note',
      });
    }
  });

export type EvidenceClaim = z.infer<typeof EvidenceClaimSchema>;
/**
 * Re-export `EvidenceRefSchema` (primitive) để caller dùng primitive shape
 * cho envelope; command layer dùng `CommandEvidenceRefSchema`.
 */
export { EvidenceRefSchema } from '../primitives.js';
