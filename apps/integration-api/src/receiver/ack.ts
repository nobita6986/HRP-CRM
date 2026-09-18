/**
 * integration-api/src/receiver/ack.ts — CORE/1.2
 *
 * HTTP ACK shape cho inbound webhook receiver.
 *
 * Per Backlog §Task 1.2 AC: "Response ACK của provider thật cần adapter
 * protocol xác minh ở V7.9b/c; không áp đặt 202 nếu provider yêu cầu
 * 200/challenge body. Mock verify không tuyên bố xác thực Zalo thật."
 *
 * CORE/1.2 fixture uses HTTP 202 Accepted by default (provider-agnostic
 * cho synthetic). Adapter per-provider sẽ đến V7.9b/c.
 */

export interface AckAccepted {
  status: 'accepted';
  receiptId: string;
  intentIds: string[];
  /** True lần đầu; false nếu idempotent replay. */
  created: boolean;
  payloadDigest: string;
  eventIdSource: 'primary' | 'fallback';
}

export interface AckError {
  status: 'rejected';
  code: string;
  message: string;
  retryable: boolean;
}

export type AckResponse = AckAccepted | AckError;
