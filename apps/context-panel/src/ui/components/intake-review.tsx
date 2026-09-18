/**
 * context-panel/src/ui/components/intake-review.tsx — Intake review panel (CORE/1.9).
 *
 * B1 FIXED:
 *  - handlePreview: calls mockApi.previewIntake → gets { reviewSnapshotId, digest, candidates }.
 *  - handleSubmit: calls mockApi.runIntake with reviewSnapshotId.
 *  - Server validates: snapshotId match + digest match + actor match.
 *  - No snapshot = MISSING_REVIEW (HTTP 400); digest mismatch = DIGEST_MISMATCH (HTTP 409).
 *  - Edit after preview: digest changes → server rejects with DIGEST_MISMATCH.
 *
 * AC:
 *  - Confirmation checkbox NOT prechecked.
 *  - Edit after confirm invalidates (server-side, not just UI state).
 *  - Preview is read-only (orchestrator.preview()).
 *  - Loading/empty/forbidden/unresolved/stale/partial error messages in Vietnamese.
 */

import * as React from 'react';
import {
  AVAILABILITIES,
  AVAILABILITY_LABELS_VI,
  PLACEMENT_CASE_STAGES,
  PLACEMENT_CASE_STAGE_LABELS_VI,
} from '@hrp-engagement/contracts';
import { StatusBadge } from './badge.js';
import { previewIntake, runIntake, PanelApiError, describeError } from '../mock-api.js';
import type { IntakeRunResult } from '../types.js';

interface IntakeReviewPanelProps {
  isNarrow?: boolean;
}

interface MockEvidence {
  id: string;
  kind: 'CCCD_FRONT' | 'CCCD_BACK';
  status: 'ready' | 'pending' | 'quarantined' | 'rejected';
}

interface DraftData {
  fullName: string;
  phone: string;
  cccdNumber: string;
  cccdAddress: string;
  contactAddress: string;
  intent: {
    stage: string;
    availability: string;
    availableFromDate?: string;
  };
  evidenceRefs: MockEvidence[];
}

type IntakeReviewState =
  | { kind: 'idle' }
  | { kind: 'previewing' }
  | { kind: 'preview-success'; reviewSnapshotId: string; digest: string; candidates: Array<{ id: string; label: string; strength: string }> }
  | { kind: 'preview-error'; message: string }
  | { kind: 'submitting' }
  | { kind: 'success'; result: IntakeRunResult; digest: string }
  | { kind: 'partial'; result: IntakeRunResult; digest: string }
  | { kind: 'error'; message: string; code?: string };

const DEFAULT_ORG_ID = 'org-001';

export function IntakeReviewPanel({ isNarrow = false }: IntakeReviewPanelProps) {
  const [state, setState] = React.useState<IntakeReviewState>({ kind: 'idle' });

  // Draft data
  const [draft, setDraft] = React.useState<DraftData>({
    fullName: 'Nguyễn Văn A',
    phone: '0909123456',
    cccdNumber: '079123456789',
    cccdAddress: '123 Đường ABC, Quận 1, TP.HCM',
    contactAddress: '456 Đường XYZ, Quận 2, TP.HCM',
    intent: {
      stage: 'CONTACTING',
      availability: 'AVAILABLE_NOW',
    },
    evidenceRefs: [
      { id: 'ev-001', kind: 'CCCD_FRONT', status: 'ready' },
      { id: 'ev-002', kind: 'CCCD_BACK', status: 'ready' },
    ],
  });

  // B1: Confirmation state — tracks if user has a valid server snapshot.
  const [confirmationChecked, setConfirmationChecked] = React.useState(false);
  // B1: digestAfterPreview — stored at preview time; compared against server at submit.
  const [digestAfterPreview, setDigestAfterPreview] = React.useState<string | null>(null);
  // B1: snapshotId — from preview response, required for submit.
  const [snapshotId, setSnapshotId] = React.useState<string | null>(null);
  // R1: revisionId stored from preview; submit MUST reuse the SAME revisionId
  // (otherwise server returns MISSING_REVIEW — snapshot keyed by orgId+revisionId).
  const [revisionId, setRevisionId] = React.useState<string | null>(null);
  const [confirmAttempted, setConfirmAttempted] = React.useState(false);

  // B1: Confirmation is valid only if:
  //   1. Checkbox is checked AND
  //   2. We have a valid snapshotId from preview AND
  //   3. Draft hasn't changed since preview (checked at submit time by server digest).
  // Note: We don't invalidate the checkbox UI when draft changes — server handles that.
  const confirmationValid = confirmationChecked && snapshotId !== null;

  // R1: Track whether the user has edited the draft after confirming.
  // When true, confirmation is invalidated and they must re-preview.
  const [editedAfterConfirm, setEditedAfterConfirm] = React.useState(false);

  const handleFieldChange = (key: keyof DraftData, value: unknown) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
    // R1: Any draft edit after the user has confirmed invalidates the
    // confirmation because the digest bound to the snapshot no longer matches
    // the new draft. Reset checkbox + flag so submit is disabled until the
    // user re-confirms (and re-previews, which produces a fresh digest).
    if (confirmationChecked) {
      setConfirmationChecked(false);
      setConfirmAttempted(false);
      setEditedAfterConfirm(true);
    }
  };

  const handleIntentChange = (key: keyof DraftData['intent'], value: string) => {
    setDraft((prev) => ({
      ...prev,
      intent: { ...prev.intent, [key]: value },
    }));
    if (confirmationChecked) {
      setConfirmationChecked(false);
      setConfirmAttempted(false);
      setEditedAfterConfirm(true);
    }
  };

  // B1: Preview — creates server-side snapshot with digest bound.
  const handlePreview = async () => {
    setState({ kind: 'previewing' });
    try {
      // R1: Generate revisionId ONCE here, store it, and reuse on submit.
      // Server keys ReviewSnapshot by `${orgId}:${revisionId}`; if submit sends
      // a different revisionId, server cannot find the snapshot → MISSING_REVIEW.
      const newRevisionId = `rev-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const result = await previewIntake({
        organizationId: DEFAULT_ORG_ID,
        intakeRevisionId: newRevisionId,
        signal: {
          phone: draft.phone,
          fullName: draft.fullName,
          citizenId: draft.cccdNumber,
        },
        // R1: Pass full draft so preview↔run digests match (contactAddress,
        // intent, citizenIdentity, evidenceRefs). Edits invalidate confirmation
        // because the digest recomputes and snapshot.digest becomes stale.
        contactAddress: draft.contactAddress,
        citizenIdentity: { number: draft.cccdNumber, address: draft.cccdAddress },
        intent: draft.intent,
        evidenceRefs: draft.evidenceRefs.map((e) => ({ evidenceId: e.id, kind: e.kind })),
      });

      // B1: Store snapshotId and digest from server response.
      setRevisionId(newRevisionId);
      setSnapshotId(result.reviewSnapshotId);
      setDigestAfterPreview(result.digest);
      setConfirmationChecked(false);
      setConfirmAttempted(false);
      // R1: New preview re-synchronizes revision/snapshot binding; clear edit flag.
      setEditedAfterConfirm(false);

      setState({
        kind: 'preview-success',
        reviewSnapshotId: result.reviewSnapshotId,
        digest: result.digest,
        candidates: result.candidates,
      });
    } catch (err) {
      const { message } = describeError(err);
      setState({ kind: 'preview-error', message });
    }
  };

  const handleConfirmChange = (checked: boolean) => {
    setConfirmAttempted(true);
    setConfirmationChecked(checked);
  };

  // B1: Submit — server validates reviewSnapshotId + digest + actor.
  const handleSubmit = async () => {
    if (!confirmationValid || !snapshotId || !revisionId) return;

    // R1: Reuse the SAME revisionId captured at preview time. Server keys its
    // ReviewSnapshot by `${orgId}:${revisionId}`, so a new revisionId here would
    // yield MISSING_REVIEW (snapshot lookup misses). snapshotId alone is not
    // enough — server cross-checks revisionId+digest against the stored snapshot.
    setState({ kind: 'submitting' });
    try {
      const result = await runIntake({
        organizationId: DEFAULT_ORG_ID,
        intakeRevisionId: revisionId,
        reviewSnapshotId: snapshotId,
        fullName: draft.fullName,
        phone: draft.phone,
        citizenIdentity: {
          number: draft.cccdNumber,
          address: draft.cccdAddress,
        },
        contactAddress: draft.contactAddress,
        intent: draft.intent,
        evidenceRefs: draft.evidenceRefs.map((e) => ({ id: e.id, kind: e.kind })),
      });

      if (result.state === 'COMPLETED') {
        setState({ kind: 'success', result, digest: digestAfterPreview ?? '' });
      } else if (result.state === 'PARTIAL' || result.state === 'REVIEW_PENDING') {
        setState({ kind: 'partial', result, digest: digestAfterPreview ?? '' });
      } else {
        setState({
          kind: 'error',
          message: result.partialFailure?.errorMessage ?? 'Đã xảy ra lỗi khi xử lý hồ sơ.',
          code: result.partialFailure?.errorCode,
        });
      }
    } catch (err) {
      if (err instanceof PanelApiError) {
        // B1: Digest mismatch → user must preview again.
        if (err.code === 'DIGEST_MISMATCH' || err.code === 'MISSING_REVIEW' || err.code === 'SNAPSHOT_EXPIRED') {
          setState({
            kind: 'error',
            message: `${err.userMessage} Vui lòng xem trước lại.`,
            code: err.code,
          });
          setSnapshotId(null);
          setDigestAfterPreview(null);
        } else {
          setState({ kind: 'error', message: err.userMessage, code: err.code });
        }
      } else {
        const { message } = describeError(err);
        setState({ kind: 'error', message });
      }
    }
  };

  const handleReset = () => {
    setState({ kind: 'idle' });
    setSnapshotId(null);
    setDigestAfterPreview(null);
    setConfirmationChecked(false);
    setConfirmAttempted(false);
  };

  return (
    <section aria-label="Intake Review" style={{ maxWidth: isNarrow ? '100%' : 640 }}>
      <h2 style={{ fontSize: '1rem', marginBottom: '1rem' }}>
        Nộp hồ sơ ứng viên
      </h2>

      {/* Mock form */}
      <fieldset
        style={{
          border: '1px solid #ddd',
          borderRadius: '8px',
          padding: '1rem',
          marginBottom: '1rem',
          background: '#fff',
        }}
      >
        <legend style={{ fontWeight: 600, padding: '0 0.25rem' }}>
          Thông tin ứng viên
        </legend>

        {/* Full name */}
        <div style={{ marginBottom: '0.75rem' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
            <span style={{ fontSize: '0.8rem', color: '#666' }}>Họ tên</span>
            <input
              type="text"
              value={draft.fullName}
              onChange={(e) => handleFieldChange('fullName', e.target.value)}
              style={{ padding: '0.5rem', border: '1px solid #ccc', borderRadius: '4px', fontSize: '0.875rem' }}
              aria-label="Họ tên ứng viên"
            />
          </label>
        </div>

        {/* Phone */}
        <div style={{ marginBottom: '0.75rem' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
            <span style={{ fontSize: '0.8rem', color: '#666' }}>Điện thoại</span>
            <input
              type="tel"
              value={draft.phone}
              onChange={(e) => handleFieldChange('phone', e.target.value)}
              style={{ padding: '0.5rem', border: '1px solid #ccc', borderRadius: '4px', fontSize: '0.875rem' }}
              aria-label="Số điện thoại"
            />
          </label>
        </div>

        {/* CCCD */}
        <div style={{ marginBottom: '0.75rem' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
            <span style={{ fontSize: '0.8rem', color: '#666' }}>Số CCCD</span>
            <input
              type="text"
              value={draft.cccdNumber}
              onChange={(e) => handleFieldChange('cccdNumber', e.target.value)}
              style={{ padding: '0.5rem', border: '1px solid #ccc', borderRadius: '4px', fontSize: '0.875rem' }}
              aria-label="Số CCCD"
            />
          </label>
        </div>

        {/* Intent stage */}
        <div style={{ marginBottom: '0.75rem' }}>
          <span style={{ fontSize: '0.8rem', color: '#666', display: 'block', marginBottom: '0.25rem' }}>
            Giai đoạn
          </span>
          <select
            value={draft.intent.stage}
            onChange={(e) => handleIntentChange('stage', e.target.value)}
            style={{ padding: '0.5rem', border: '1px solid #ccc', borderRadius: '4px', fontSize: '0.875rem', width: '100%' }}
            aria-label="Giai đoạn nhu cầu"
          >
            {PLACEMENT_CASE_STAGES.map((s) => (
              <option key={s} value={s}>
                {PLACEMENT_CASE_STAGE_LABELS_VI[s as keyof typeof PLACEMENT_CASE_STAGE_LABELS_VI]}
              </option>
            ))}
          </select>
        </div>

        {/* Intent availability */}
        <div style={{ marginBottom: '0.75rem' }}>
          <span style={{ fontSize: '0.8rem', color: '#666', display: 'block', marginBottom: '0.25rem' }}>
            Tình trạng sẵn sàng
          </span>
          <select
            value={draft.intent.availability}
            onChange={(e) => handleIntentChange('availability', e.target.value)}
            style={{ padding: '0.5rem', border: '1px solid #ccc', borderRadius: '4px', fontSize: '0.875rem', width: '100%' }}
            aria-label="Tình trạng sẵn sàng"
          >
            {AVAILABILITIES.map((a) => (
              <option key={a} value={a}>
                {AVAILABILITY_LABELS_VI[a as keyof typeof AVAILABILITY_LABELS_VI]}
              </option>
            ))}
          </select>
        </div>

        {/* Evidence mock display */}
        <div style={{ marginBottom: '0.5rem' }}>
          <span style={{ fontSize: '0.8rem', color: '#666', display: 'block', marginBottom: '0.25rem' }}>
            Giấy tờ (mock)
          </span>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            {draft.evidenceRefs.map((ev) => (
              <div
                key={ev.id}
                style={{
                  padding: '0.5rem',
                  border: '1px solid #ccc',
                  borderRadius: '4px',
                  fontSize: '0.75rem',
                  background: ev.status === 'ready' ? '#f0fff0' : '#fff7e6',
                  minWidth: 100,
                }}
              >
                <div>{ev.kind === 'CCCD_FRONT' ? 'Mặt trước CCCD' : 'Mặt sau CCCD'}</div>
                <div style={{ color: ev.status === 'ready' ? 'green' : '#c60', fontWeight: 500 }}>
                  {ev.status === 'ready' ? '✓ Sẵn sàng' : '⏳ Đang xử lý'}
                </div>
              </div>
            ))}
          </div>
          <p style={{ fontSize: '0.7rem', color: '#888', marginTop: '0.25rem' }}>
            ⚠️ Dữ liệu giả lập. Không nhận CCCD thật ở phase này.
          </p>
        </div>
      </fieldset>

      {/* Preview */}
      {(state.kind === 'idle' || state.kind === 'preview-error') && (
        <button
          onClick={handlePreview}
          style={{
            padding: '0.6rem 1.25rem',
            background: '#0066cc',
            color: '#fff',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '0.9rem',
            fontWeight: 500,
          }}
        >
          Xem trước
        </button>
      )}

      {state.kind === 'previewing' && (
        <div style={{ textAlign: 'center', padding: '1.5rem', color: '#666' }} role="status" aria-live="polite">
          Đang kiểm tra...
        </div>
      )}

      {state.kind === 'preview-error' && (
        <div
          style={{ marginTop: '1rem', padding: '0.75rem', border: '1px solid #dc3545', borderRadius: '4px', background: '#fff5f5', color: '#dc3545', fontSize: '0.875rem' }}
          role="alert"
        >
          ⚠️ {state.message}
        </div>
      )}

      {/* Preview results */}
      {state.kind === 'preview-success' && (
        <div
          style={{ marginTop: '1rem', padding: '1rem', border: '1px solid #ddd', borderRadius: '8px', background: '#fff' }}
        >
          <h3 style={{ margin: '0 0 0.75rem', fontSize: '0.9rem' }}>Kết quả tìm kiếm</h3>
          {state.candidates.length === 0 ? (
            <p style={{ color: '#666', fontSize: '0.875rem' }}>
              Không tìm thấy hồ sơ trùng khớp.
            </p>
          ) : (
            <ul style={{ paddingLeft: '1.25rem', margin: '0.5rem 0' }}>
              {state.candidates.map((c) => (
                <li key={c.id} style={{ marginBottom: '0.5rem', fontSize: '0.875rem' }}>
                  <StatusBadge label={c.label} variant={c.strength === 'STRONG' ? 'success' : 'warning'} />
                  <span style={{ marginLeft: '0.5rem', color: '#666' }}>
                    {c.strength === 'STRONG' ? 'Khớp mạnh' : 'Khớp yếu'}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {/* B1: Confirmation checkbox — NOT prechecked */}
          <div
            style={{ marginTop: '1rem', padding: '0.75rem', border: '1px solid #e5e5e5', borderRadius: '4px', background: '#f9f9f9' }}
          >
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={confirmationChecked}
                onChange={(e) => handleConfirmChange(e.target.checked)}
                style={{ marginTop: '0.2rem' }}
                aria-describedby="confirm-hint"
              />
              <div>
                <div style={{ fontWeight: 500 }}>
                  Tôi đã xem xét và xác nhận thông tin trên là chính xác
                </div>
                {editedAfterConfirm && (
                  <div
                    id="edit-invalidation-warning"
                    style={{ color: '#c00', fontSize: '0.8rem', marginTop: '0.25rem' }}
                    role="alert"
                  >
                    Bạn đã chỉnh sửa sau khi xác nhận. Vui lòng xem trước lại để đồng bộ xác nhận.
                  </div>
                )}
                {confirmAttempted && !confirmationValid && (
                  <div style={{ color: '#c00', fontSize: '0.8rem', marginTop: '0.25rem' }}>
                    Vui lòng xác nhận bạn đã kiểm tra thông tin.
                  </div>
                )}
                <div id="confirm-hint" style={{ fontSize: '0.75rem', color: '#888', marginTop: '0.25rem' }}>
                  Xác nhận rằng thông tin đã được nhân viên kiểm tra và đúng với giấy tờ gốc.
                  Việc chỉnh sửa sau bước này sẽ làm mất hiệu lực xác nhận.
                </div>
              </div>
            </label>
          </div>

          <button
            onClick={handleSubmit}
            disabled={!confirmationValid}
            style={{
              marginTop: '1rem',
              padding: '0.6rem 1.25rem',
              background: confirmationValid ? '#28a745' : '#ccc',
              color: '#fff',
              border: 'none',
              borderRadius: '4px',
              cursor: confirmationValid ? 'pointer' : 'not-allowed',
              fontSize: '0.9rem',
              fontWeight: 500,
            }}
          >
            Nộp hồ sơ
          </button>
        </div>
      )}

      {/* Submitting */}
      {state.kind === 'submitting' && (
        <div style={{ textAlign: 'center', padding: '1.5rem', color: '#666' }} role="status" aria-live="polite">
          Đang xử lý hồ sơ...
        </div>
      )}

      {/* Success */}
      {state.kind === 'success' && (
        <div
          style={{ marginTop: '1rem', padding: '1rem', border: '1px solid #28a745', borderRadius: '8px', background: '#f0fff0' }}
          role="alert"
        >
          <strong style={{ color: '#28a745' }}>✓ Nộp hồ sơ thành công</strong>
          <p style={{ margin: '0.5rem 0 0', fontSize: '0.875rem' }}>
            Checkpoint ID: <code>{state.result.checkpointId}</code>
          </p>
          <p style={{ margin: '0.25rem 0 0', fontSize: '0.8rem', color: '#666' }}>
            Đã hoàn thành {state.result.appliedSteps.length} bước: {state.result.appliedSteps.join(' → ')}
          </p>
          <button
            onClick={handleReset}
            style={{ marginTop: '0.75rem', padding: '0.4rem 0.75rem', border: '1px solid #28a745', borderRadius: '4px', background: '#fff', color: '#28a745', cursor: 'pointer', fontSize: '0.875rem' }}
          >
            Nộp hồ sơ mới
          </button>
        </div>
      )}

      {/* Partial */}
      {state.kind === 'partial' && (
        <div
          style={{ marginTop: '1rem', padding: '1rem', border: '1px solid #ffc107', borderRadius: '8px', background: '#fffbf0' }}
          role="alert"
        >
          <strong style={{ color: '#856404' }}>⚠️ Nộp hồ sơ một phần</strong>
          <p style={{ margin: '0.5rem 0 0', fontSize: '0.875rem' }}>
            Checkpoint ID: <code>{state.result.checkpointId}</code>
          </p>
          <p style={{ margin: '0.25rem 0 0', fontSize: '0.8rem' }}>
            Đã hoàn thành: {state.result.appliedSteps.join(' → ')}
          </p>
          {state.result.partialFailure && (
            <div style={{ marginTop: '0.5rem', fontSize: '0.8rem', color: '#856404' }}>
              <strong>Bước thất bại:</strong> {state.result.partialFailure.failedStep}<br />
              <strong>Mã lỗi:</strong> {state.result.partialFailure.errorCode}<br />
              <strong>Thông báo:</strong> {state.result.partialFailure.errorMessage}
              {state.result.partialFailure.retryable && (
                <span style={{ display: 'block', marginTop: '0.25rem' }}>(Có thể thử lại)</span>
              )}
            </div>
          )}
        </div>
      )}

      {/* Error */}
      {state.kind === 'error' && (
        <div
          style={{ marginTop: '1rem', padding: '1rem', border: '1px solid #dc3545', borderRadius: '8px', background: '#fff5f5', color: '#dc3545' }}
          role="alert"
        >
          <strong>❌ Đã xảy ra lỗi</strong>
          <p style={{ margin: '0.5rem 0 0', fontSize: '0.875rem', color: '#333' }}>
            {state.message}
          </p>
          {state.code && (
            <p style={{ margin: '0.25rem 0 0', fontSize: '0.75rem', color: '#999' }}>
              Mã: {state.code}
            </p>
          )}
          <button
            onClick={handleReset}
            style={{ marginTop: '0.75rem', padding: '0.4rem 0.75rem', border: '1px solid #dc3545', borderRadius: '4px', background: '#fff', color: '#dc3545', cursor: 'pointer', fontSize: '0.875rem' }}
          >
            Thử lại
          </button>
        </div>
      )}
    </section>
  );
}
