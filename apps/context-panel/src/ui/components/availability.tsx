/**
 * context-panel/src/ui/components/availability.tsx — Availability card (CORE/1.9).
 *
 * Displays availability + availableFromDate. Controls are separate from PlacementCase.
 * No mutation of CurrentRelationship here.
 */

import * as React from 'react';
import type { ContextPanelResult } from '@hrp-engagement/contracts';
import {
  AVAILABILITIES,
  AVAILABILITY_LABELS_VI,
} from '@hrp-engagement/contracts';
import type { Availability } from '@hrp-engagement/contracts';
import { StatusBadge } from './badge.js';

interface AvailabilityCardProps {
  data: NonNullable<ContextPanelResult['availability']>;
  isNarrow?: boolean;
  onUpdate?: (availability: Availability, availableFromDate?: string) => void;
}

function getAvailabilityVariant(a: Availability): 'success' | 'warning' | 'neutral' | 'error' {
  switch (a) {
    case 'AVAILABLE_NOW': return 'success';
    case 'AVAILABLE_FROM_DATE': return 'warning';
    case 'NOT_AVAILABLE': return 'neutral';
    case 'DO_NOT_CONTACT': return 'error';
    default: return 'neutral';
  }
}

export function AvailabilityCard({ data, isNarrow = false, onUpdate }: AvailabilityCardProps) {
  const label = AVAILABILITY_LABELS_VI[data.availability as keyof typeof AVAILABILITY_LABELS_VI] ?? data.availability;
  const variant = getAvailabilityVariant(data.availability as Availability);

  // Update form state
  const [showForm, setShowForm] = React.useState(false);
  const [selected, setSelected] = React.useState<Availability>(data.availability as Availability);
  const [fromDate, setFromDate] = React.useState(data.availableFromDate ?? '');

  const handleSubmit = () => {
    if (selected === 'AVAILABLE_FROM_DATE' && !fromDate) return;
    onUpdate?.(selected, selected === 'AVAILABLE_FROM_DATE' ? fromDate : undefined);
    setShowForm(false);
  };

  return (
    <section
      aria-label="Tình trạng sẵn sàng"
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
        <span>Tình trạng sẵn sàng</span>
        {data.aggregateVersion && (
          <span style={{ fontSize: '0.7rem', color: '#999', fontWeight: 400 }}>
            v{data.aggregateVersion}
          </span>
        )}
      </h3>

      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
        <StatusBadge label={label} variant={variant} />
        {data.availableFromDate && (
          <span style={{ fontSize: '0.8rem', color: '#666' }}>
            từ {data.availableFromDate}
          </span>
        )}
        {data.contactabilityVersion && (
          <span style={{ fontSize: '0.7rem', color: '#999' }}>
            (contactability v{data.contactabilityVersion})
          </span>
        )}
      </div>

      {/* Update form */}
      {onUpdate && (
        <div style={{ marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: '1px solid #f0f0f0' }}>
          {!showForm ? (
            <button
              onClick={() => setShowForm(true)}
              style={{
                padding: '0.35rem 0.75rem',
                border: '1px solid #0066cc',
                borderRadius: '4px',
                background: '#fff',
                color: '#0066cc',
                cursor: 'pointer',
                fontSize: '0.8rem',
              }}
            >
              Cập nhật
            </button>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <select
                value={selected}
                onChange={(e) => {
                  setSelected(e.target.value as Availability);
                  if (e.target.value !== 'AVAILABLE_FROM_DATE') {
                    setFromDate('');
                  }
                }}
                style={{
                  padding: '0.5rem',
                  border: '1px solid #ccc',
                  borderRadius: '4px',
                  fontSize: '0.875rem',
                }}
                aria-label="Tình trạng sẵn sàng mới"
              >
                {AVAILABILITIES.map((a) => (
                  <option key={a} value={a}>
                    {AVAILABILITY_LABELS_VI[a as keyof typeof AVAILABILITY_LABELS_VI]}
                  </option>
                ))}
              </select>

              {selected === 'AVAILABLE_FROM_DATE' && (
                <input
                  type="date"
                  value={fromDate}
                  onChange={(e) => setFromDate(e.target.value)}
                  min={new Date().toISOString().split('T')[0]}
                  style={{
                    padding: '0.5rem',
                    border: '1px solid #ccc',
                    borderRadius: '4px',
                    fontSize: '0.875rem',
                  }}
                  aria-label="Ngày bắt đầu"
                />
              )}

              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button
                  onClick={handleSubmit}
                  disabled={selected === 'AVAILABLE_FROM_DATE' && !fromDate}
                  style={{
                    padding: '0.35rem 0.75rem',
                    border: 'none',
                    borderRadius: '4px',
                    background: selected === 'AVAILABLE_FROM_DATE' && !fromDate ? '#ccc' : '#0066cc',
                    color: '#fff',
                    cursor: selected === 'AVAILABLE_FROM_DATE' && !fromDate ? 'not-allowed' : 'pointer',
                    fontSize: '0.8rem',
                  }}
                >
                  Lưu
                </button>
                <button
                  onClick={() => {
                    setShowForm(false);
                    setSelected(data.availability as Availability);
                    setFromDate(data.availableFromDate ?? '');
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
