/**
 * context-panel/src/ui/components/states.tsx — Shared state components (CORE/1.9).
 *
 * All text in Vietnamese. No raw error codes exposed to user.
 */

import * as React from 'react';

interface LoadingProps {
  message?: string;
}

export function LoadingState({ message = 'Đang tải...' }: LoadingProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        padding: '2rem',
        textAlign: 'center',
        color: '#666',
      }}
    >
      <div
        style={{
          display: 'inline-block',
          width: '24px',
          height: '24px',
          border: '3px solid #e5e5e5',
          borderTopColor: '#0066cc',
          borderRadius: '50%',
          animation: 'spin 0.8s linear infinite',
        }}
      />
      <p style={{ marginTop: '0.75rem', fontSize: '0.875rem' }}>{message}</p>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

interface ErrorProps {
  message: string;
  onRetry?: () => void;
}

export function ErrorState({ message, onRetry }: ErrorProps) {
  return (
    <div
      role="alert"
      style={{
        padding: '1rem',
        border: '1px solid #dc3545',
        borderRadius: '8px',
        background: '#fff5f5',
        color: '#dc3545',
      }}
    >
      <strong style={{ display: 'block', marginBottom: '0.5rem' }}>
        ❌ Đã xảy ra lỗi
      </strong>
      <p style={{ margin: '0 0 0.75rem', fontSize: '0.875rem', color: '#333' }}>
        {message}
      </p>
      {onRetry && (
        <button
          onClick={onRetry}
          style={{
            padding: '0.4rem 0.75rem',
            border: '1px solid #dc3545',
            borderRadius: '4px',
            background: '#fff',
            color: '#dc3545',
            cursor: 'pointer',
            fontSize: '0.875rem',
          }}
        >
          Thử lại
        </button>
      )}
    </div>
  );
}

interface EmptyProps {
  message?: string;
}

export function EmptyState({ message = 'Không có dữ liệu.' }: EmptyProps) {
  return (
    <div
      role="status"
      style={{
        padding: '2rem',
        textAlign: 'center',
        color: '#666',
        border: '1px dashed #ccc',
        borderRadius: '8px',
      }}
    >
      <span style={{ fontSize: '2rem' }}>📭</span>
      <p style={{ marginTop: '0.5rem', fontSize: '0.875rem' }}>{message}</p>
    </div>
  );
}

export function ForbiddenState() {
  return (
    <div
      role="alert"
      style={{
        padding: '1.5rem',
        border: '1px solid #dc3545',
        borderRadius: '8px',
        background: '#fff5f5',
        textAlign: 'center',
      }}
    >
      <span style={{ fontSize: '2rem' }}>🔒</span>
      <p style={{ marginTop: '0.5rem', fontWeight: 600, color: '#333' }}>
        Không có quyền truy cập
      </p>
      <p style={{ marginTop: '0.25rem', fontSize: '0.875rem', color: '#666' }}>
        Bạn không có quyền xem hồ sơ này.
      </p>
    </div>
  );
}

export function UnresolvedState() {
  return (
    <div
      role="status"
      style={{
        padding: '1.5rem',
        border: '1px solid #ffc107',
        borderRadius: '8px',
        background: '#fffbf0',
        textAlign: 'center',
      }}
    >
      <span style={{ fontSize: '2rem' }}>❓</span>
      <p style={{ marginTop: '0.5rem', fontWeight: 600, color: '#856404' }}>
        Chưa xác định được hồ sơ
      </p>
      <p style={{ marginTop: '0.25rem', fontSize: '0.875rem', color: '#856404' }}>
        Không tìm thấy hồ sơ phù hợp với thông tin này.
      </p>
    </div>
  );
}

export function StaleState() {
  return (
    <div
      role="alert"
      style={{
        padding: '1.5rem',
        border: '1px solid #ffc107',
        borderRadius: '8px',
        background: '#fffbf0',
        textAlign: 'center',
      }}
    >
      <span style={{ fontSize: '2rem' }}>⏰</span>
      <p style={{ marginTop: '0.5rem', fontWeight: 600, color: '#856404' }}>
        Dữ liệu đã cũ
      </p>
      <p style={{ marginTop: '0.25rem', fontSize: '0.875rem', color: '#856404' }}>
        Vui lòng tải lại trang để cập nhật thông tin.
      </p>
    </div>
  );
}

export function TimeoutState() {
  return (
    <div
      role="alert"
      style={{
        padding: '1.5rem',
        border: '1px solid #6c757d',
        borderRadius: '8px',
        background: '#f8f9fa',
        textAlign: 'center',
      }}
    >
      <span style={{ fontSize: '2rem' }}>⏳</span>
      <p style={{ marginTop: '0.5rem', fontWeight: 600, color: '#333' }}>
        Hết thời gian phản hồi
      </p>
      <p style={{ marginTop: '0.25rem', fontSize: '0.875rem', color: '#666' }}>
        Máy chủ phản hồi chậm. Vui lòng thử lại sau.
      </p>
    </div>
  );
}

interface PartialSuccessProps {
  title?: string;
  detail?: string;
  children: React.ReactNode;
}

export function PartialSuccessState({ title = 'Kết quả một phần', detail, children }: PartialSuccessProps) {
  return (
    <div
      role="status"
      style={{
        padding: '1rem',
        border: '1px solid #ffc107',
        borderRadius: '8px',
        background: '#fffbf0',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          marginBottom: '0.75rem',
          color: '#856404',
          fontWeight: 600,
        }}
      >
        <span>⚠️</span>
        <span>{title}</span>
      </div>
      {detail && (
        <p style={{ margin: '0 0 0.75rem', fontSize: '0.8rem', color: '#856404' }}>
          {detail}
        </p>
      )}
      {children}
    </div>
  );
}

interface UnavailableProps {
  message: string;
  detail?: string;
}

export function UnavailableState({ message, detail }: UnavailableProps) {
  return (
    <div
      role="status"
      style={{
        padding: '1.5rem',
        border: '1px solid #dee2e6',
        borderRadius: '8px',
        background: '#f8f9fa',
        textAlign: 'center',
      }}
    >
      <span style={{ fontSize: '2rem' }}>🔧</span>
      <p style={{ marginTop: '0.5rem', fontWeight: 600, color: '#666' }}>
        {message}
      </p>
      {detail && (
        <p style={{ marginTop: '0.25rem', fontSize: '0.8rem', color: '#999' }}>
          {detail}
        </p>
      )}
    </div>
  );
}
