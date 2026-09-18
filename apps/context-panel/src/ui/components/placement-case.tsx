/**
 * context-panel/src/ui/components/placement-case.tsx — Placement case card (CORE/1.9).
 *
 * Displays:
 *  - stage (OPEN) or closedStatus + closeReason (CLOSED).
 *  - Close reason uses exactly 9 values from CASE_CLOSE_REASONS (contracts).
 *  - Controls (update/close) are separate from Availability.
 */

import * as React from 'react';
import type { ContextPanelResult } from '@hrp-engagement/contracts';
import {
  PLACEMENT_CASE_STAGES,
  PLACEMENT_CASE_STAGE_LABELS_VI,
  CASE_CLOSE_REASONS,
  CASE_CLOSE_REASON_LABELS_VI,
} from '@hrp-engagement/contracts';
import { StatusBadge } from './badge.js';
import { CloseReasonSelect } from './close-reason-select.js';
import type { CaseCloseReason } from '@hrp-engagement/contracts';

interface PlacementCaseCardProps {
  data: NonNullable<ContextPanelResult['placementCase']>;
  isNarrow?: boolean;
  onClose?: (reason: CaseCloseReason, note?: string) => void;
  onUpdateStage?: (stage: string) => void;
}

export function PlacementCaseCard({ data, isNarrow = false, onClose, onUpdateStage }: PlacementCaseCardProps) {
  const isClosed = data.closedStatus === 'CLOSED';
  const stageLabel = data.stage
    ? (PLACEMENT_CASE_STAGE_LABELS_VI[data.stage as keyof typeof PLACEMENT_CASE_STAGE_LABELS_VI] ?? data.stage)
    : null;
  const reasonLabel = data.closeReason
    ? (CASE_CLOSE_REASON_LABELS_VI[data.closeReason as keyof typeof CASE_CLOSE_REASON_LABELS_VI] ?? data.closeReason)
    : null;

  // Close form state
  const [showCloseForm, setShowCloseForm] = React.useState(false);
  const [closeReason, setCloseReason] = React.useState<CaseCloseReason | ''>('');
  const [closeNote, setCloseNote] = React.useState('');

  const handleClose = () => {
    if (!closeReason) return;
    onClose?.(closeReason as CaseCloseReason, closeNote || undefined);
    setShowCloseForm(false);
    setCloseReason('');
    setCloseNote('');
  };

  return (
    <section
      aria-label="Đợt tìm việc"
      style={{
        border: '1px solid #e5e5e5',
        borderRadius: '8px',
        padding: '1rem',
        background: '#fff',
      }}
    >
      <h3
        style={{
          margin: '0 0 0.75rem',
          fontSize: '0.9rem',
          fontWeight: 600,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <span>Đợt tìm việc</span>
        {data.aggregateVersion && (
          <span style={{ fontSize: '0.7rem', color: '#999', fontWeight: 400 }}>
            v{data.aggregateVersion}
          </span>
        )}
      </h3>

      {/* Stage or Closed status */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        {isClosed ? (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <StatusBadge label="Đã đóng" variant="neutral" />
              {reasonLabel && (
                <StatusBadge label={reasonLabel} variant="warning" />
              )}
            </div>
            {reasonLabel && (
              <p style={{ fontSize: '0.8rem', color: '#666', margin: 0 }}>
                Lý do: {reasonLabel}
              </p>
            )}
          </>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            {stageLabel && <StatusBadge label={stageLabel} variant="success" />}
            <span style={{ fontSize: '0.8rem', color: '#666' }}>
              Mã: {data.placementCaseId}
            </span>
          </div>
        )}
      </div>

      {/* Close form — shown when not closed */}
      {!isClosed && (onClose || onUpdateStage) && (
        <div style={{ marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: '1px solid #f0f0f0' }}>
          {!showCloseForm ? (
            <button
              onClick={() => setShowCloseForm(true)}
              style={{
                padding: '0.35rem 0.75rem',
                border: '1px solid #dc3545',
                borderRadius: '4px',
                background: '#fff',
                color: '#dc3545',
                cursor: 'pointer',
                fontSize: '0.8rem',
              }}
            >
              Đóng đợt
            </button>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <CloseReasonSelect
                value={closeReason}
                onChange={(v) => setCloseReason(v)}
                label="Lý do đóng"
                required
              />
              <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                <span style={{ fontSize: '0.8rem', color: '#666' }}>Ghi chú (tùy chọn)</span>
                <textarea
                  value={closeNote}
                  onChange={(e) => setCloseNote(e.target.value)}
                  maxLength={500}
                  rows={2}
                  style={{
                    padding: '0.5rem',
                    border: '1px solid #ccc',
                    borderRadius: '4px',
                    fontSize: '0.8rem',
                    resize: 'vertical',
                  }}
                  placeholder="Nhập ghi chú..."
                  aria-label="Ghi chú đóng đợt"
                />
              </label>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button
                  onClick={handleClose}
                  disabled={!closeReason}
                  style={{
                    padding: '0.35rem 0.75rem',
                    border: 'none',
                    borderRadius: '4px',
                    background: closeReason ? '#dc3545' : '#ccc',
                    color: '#fff',
                    cursor: closeReason ? 'pointer' : 'not-allowed',
                    fontSize: '0.8rem',
                  }}
                >
                  Xác nhận đóng
                </button>
                <button
                  onClick={() => {
                    setShowCloseForm(false);
                    setCloseReason('');
                    setCloseNote('');
                  }}
                  style={{
                    padding: '0.35rem 0.75rem',
                    border: '1px solid #ccc',
                    borderRadius: '4px',
                    background: '#fff',
                    cursor: 'pointer',
                    fontSize: '0.8rem',
                  }}
                >
                  Hủy
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
