/**
 * context-panel/src/ui/components/context-panel.tsx — Context panel display (CORE/1.9).
 *
 * Displays ContextPanelResult from contracts:
 *  - Talent/Client layout separate.
 *  - PlacementCase / Availability controls separate.
 *  - CurrentRelationship read-only badge.
 *  - Close reason uses exactly 9 values from contracts.
 */

import * as React from 'react';
import type { ContextPanelResult } from '@hrp-engagement/contracts';
import {
  CURRENT_RELATIONSHIP_LABELS_VI,
} from '@hrp-engagement/contracts';
import type { CurrentRelationship } from '@hrp-engagement/contracts';
import { CurrentRelationshipBadge } from './current-relationship.js';
import { PlacementCaseCard } from './placement-case.js';
import { AvailabilityCard } from './availability.js';
import { StatusBadge } from './badge.js';
import type { CaseCloseReason } from '@hrp-engagement/contracts';

interface ContextPanelProps {
  data: ContextPanelResult;
  isTalent?: boolean;
  isNarrow?: boolean;
}

export function ContextPanel({ data, isTalent = true, isNarrow = false }: ContextPanelProps) {
  const colStyle: React.CSSProperties = isNarrow
    ? { display: 'flex', flexDirection: 'column', gap: '0.75rem' }
    : { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' };

  return (
    <div
      style={{
        ...colStyle,
        maxWidth: '100%',
      }}
      data-testid="context-panel"
    >
      {/* Identity summary */}
      {data.identitySummary && (
        <section
          aria-label="Thông tin ứng viên"
          style={{
            border: '1px solid #e5e5e5',
            borderRadius: '8px',
            padding: '1rem',
            background: '#fff',
          }}
        >
          <h3 style={{ margin: '0 0 0.75rem', fontSize: '0.9rem', fontWeight: 600 }}>
            Thông tin cơ bản
          </h3>
          <dl style={{ margin: 0 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '0.25rem 0.75rem' }}>
              <dt style={{ fontSize: '0.8rem', color: '#666' }}>Tên</dt>
              <dd style={{ margin: 0, fontSize: '0.875rem', fontWeight: 500 }}>
                {data.identitySummary.fullNameRedacted ?? '—'}
                {data.identitySummary.displayOnly && (
                  <span style={{ fontSize: '0.7rem', color: '#999', marginLeft: '0.25rem' }}>
                    (ẩn một phần)
                  </span>
                )}
              </dd>
              <dt style={{ fontSize: '0.8rem', color: '#666' }}>Điện thoại</dt>
              <dd style={{ margin: 0, fontSize: '0.875rem' }}>
                {data.identitySummary.phoneRedacted ?? '—'}
              </dd>
            </div>
          </dl>
        </section>
      )}

      {/* CurrentRelationship — READ-ONLY */}
      {data.currentRelationship && (
        <section
          aria-label="Quan hệ với HRP"
          style={{
            border: '1px solid #e5e5e5',
            borderRadius: '8px',
            padding: '1rem',
            background: '#fff',
          }}
        >
          <h3 style={{ margin: '0 0 0.75rem', fontSize: '0.9rem', fontWeight: 600 }}>
            Quan hệ với HRP
          </h3>
          <CurrentRelationshipBadge value={data.currentRelationship.currentRelationship as CurrentRelationship} />
        </section>
      )}

      {/* Placement case */}
      {data.placementCase && (
        <PlacementCaseCard
          data={data.placementCase}
          isNarrow={isNarrow}
          onClose={(reason, note) => {
            // Mock close handler — real impl calls integration-api endpoint.
            console.log('[mock] close case:', data.placementCase!.placementCaseId, reason, note);
          }}
          onUpdateStage={(stage) => {
            // Mock update handler.
            console.log('[mock] update stage:', data.placementCase!.placementCaseId, stage);
          }}
        />
      )}

      {/* Availability */}
      {data.availability && (
        <AvailabilityCard
          data={data.availability}
          isNarrow={isNarrow}
          onUpdate={(avail, fromDate) => {
            // Mock update handler.
            const lpId = data.target?.kind === 'TALENT' ? data.target.laborProfileId : undefined;
            console.log('[mock] update availability:', lpId, avail, fromDate);
          }}
        />
      )}

      {/* Next action */}
      {data.nextAction && (
        <section
          aria-label="Hành động tiếp theo"
          style={{
            border: '1px solid #e5e5e5',
            borderRadius: '8px',
            padding: '1rem',
            background: '#fff',
            gridColumn: isNarrow ? undefined : '1 / -1',
          }}
        >
          <h3 style={{ margin: '0 0 0.75rem', fontSize: '0.9rem', fontWeight: 600 }}>
            Hành động tiếp theo
          </h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
            <StatusBadge
              label={data.nextAction.status}
              variant={data.nextAction.status === 'OPEN' ? 'warning' : 'neutral'}
            />
            {data.nextAction.snoozeMode && data.nextAction.snoozeMode !== 'ACTIVE' && (
              <StatusBadge
                label={
                  data.nextAction.snoozeMode === 'SNOOZED'
                    ? 'Tạm hoãn'
                    : 'Đã bỏ qua'
                }
                variant="neutral"
              />
            )}
            {data.nextAction.scheduledAt && (
              <span style={{ fontSize: '0.8rem', color: '#666' }}>
                Lên lịch: {new Date(data.nextAction.scheduledAt).toLocaleString('vi-VN')}
              </span>
            )}
            {data.nextAction.dueAt && (
              <span style={{ fontSize: '0.8rem', color: '#666' }}>
                Hạn: {new Date(data.nextAction.dueAt).toLocaleString('vi-VN')}
              </span>
            )}
          </div>
        </section>
      )}

      {/* Recent interactions */}
      {data.recentInteractions && data.recentInteractions.length > 0 && (
        <section
          aria-label="Tương tác gần đây"
          style={{
            border: '1px solid #e5e5e5',
            borderRadius: '8px',
            padding: '1rem',
            background: '#fff',
            gridColumn: isNarrow ? undefined : '1 / -1',
          }}
        >
          <h3 style={{ margin: '0 0 0.75rem', fontSize: '0.9rem', fontWeight: 600 }}>
            Tương tác gần đây
          </h3>
          <ul style={{ margin: 0, paddingLeft: '1.25rem' }}>
            {data.recentInteractions.slice(0, 5).map((ixn) => (
              <li
                key={ixn.interactionId}
                style={{
                  marginBottom: '0.5rem',
                  fontSize: '0.8rem',
                  display: 'flex',
                  gap: '0.5rem',
                  alignItems: 'flex-start',
                }}
              >
                <StatusBadge
                  label={ixn.direction === 'INBOUND' ? '📥' : '📤'}
                  variant="neutral"
                />
                <div>
                  <div style={{ fontWeight: 500 }}>
                    {ixn.channel} — {ixn.outcome}
                  </div>
                  <div style={{ color: '#666', marginTop: '0.125rem' }}>
                    {ixn.summaryRedacted}
                  </div>
                  <div style={{ color: '#999', fontSize: '0.7rem', marginTop: '0.125rem' }}>
                    {new Date(ixn.occurredAt).toLocaleString('vi-VN')}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Contactability */}
      {data.contactability && (
        <section
          aria-label="Khả năng liên lạc"
          style={{
            border: '1px solid #e5e5e5',
            borderRadius: '8px',
            padding: '1rem',
            background: '#fff',
          }}
        >
          <h3 style={{ margin: '0 0 0.75rem', fontSize: '0.9rem', fontWeight: 600 }}>
            Khả năng liên lạc
          </h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <StatusBadge
              label={
                data.contactability.dispatchOutcome === 'AUTHORIZED'
                  ? '✅ Có thể liên hệ'
                  : data.contactability.dispatchOutcome === 'SUPPRESSED'
                  ? '⛔ Không liên hệ'
                  : '❓ Chưa rõ'
              }
              variant={
                data.contactability.dispatchOutcome === 'AUTHORIZED'
                  ? 'success'
                  : data.contactability.dispatchOutcome === 'SUPPRESSED'
                  ? 'error'
                  : 'warning'
              }
            />
            <span style={{ fontSize: '0.75rem', color: '#999' }}>
              {data.contactability.reasonCode}
            </span>
          </div>
        </section>
      )}

      {/* Suppression summary */}
      {data.suppressionSummary && (
        <section
          aria-label="Yêu cầu không liên hệ"
          style={{
            border: '1px solid #e5e5e5',
            borderRadius: '8px',
            padding: '1rem',
            background: '#fff8f8',
          }}
        >
          <h3 style={{ margin: '0 0 0.75rem', fontSize: '0.9rem', fontWeight: 600, color: '#c00' }}>
            Không liên hệ
          </h3>
          <div style={{ fontSize: '0.8rem' }}>
            <p style={{ margin: '0 0 0.25rem' }}>Lý do: {data.suppressionSummary.reason}</p>
            <p style={{ margin: 0, color: '#999' }}>
              Từ: {new Date(data.suppressionSummary.committedAt).toLocaleDateString('vi-VN')}
            </p>
          </div>
        </section>
      )}

      {/* Unavailable fields */}
      {data.unavailableFields && data.unavailableFields.length > 0 && (
        <div
          role="status"
          style={{
            gridColumn: '1 / -1',
            padding: '0.5rem 0.75rem',
            background: '#f5f5f5',
            borderRadius: '4px',
            fontSize: '0.8rem',
            color: '#666',
            fontStyle: 'italic',
          }}
        >
          Một số thông tin không khả dụng: {data.unavailableFields.join(', ')}
        </div>
      )}
    </div>
  );
}
