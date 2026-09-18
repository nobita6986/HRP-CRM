/**
 * context-panel/src/ui/components/talent-panel.tsx — Talent context panel wrapper (CORE/1.9).
 *
 * B3: Uses mockApi.queryContext with X-HRP-Staff-Id header (authorization server-side).
 * Error codes map to Vietnamese user messages.
 */

import * as React from 'react';
import type { ContextPanelResult } from '@hrp-engagement/contracts';
import { queryContext, describeError, PanelApiError } from '../mock-api.js';
import { ContextPanel } from './context-panel.js';
import {
  LoadingState,
  ErrorState,
  ForbiddenState,
  UnresolvedState,
  StaleState,
  TimeoutState,
  PartialSuccessState,
  EmptyState,
} from './states.js';

interface TalentPanelProps {
  isNarrow: boolean;
  laborProfileId?: string;
}

type TalentState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'forbidden' }
  | { status: 'unresolved' }
  | { status: 'stale' }
  | { status: 'timeout' }
  | { status: 'partial'; data: ContextPanelResult }
  | { status: 'success'; data: ContextPanelResult }
  | { status: 'empty' };

export function TalentPanel({ isNarrow, laborProfileId = 'lp-001' }: TalentPanelProps) {
  const [state, setState] = React.useState<TalentState>({ status: 'loading' });

  const load = React.useCallback(async () => {
    setState({ status: 'loading' });
    try {
      const data = await queryContext({ target: 'talent', laborProfileId });
      if (!data.identitySummary && !data.placementCase && !data.availability) {
        setState({ status: 'empty' });
        return;
      }
      if (data.unavailableFields && data.unavailableFields.length > 0) {
        setState({ status: 'partial', data });
        return;
      }
      setState({ status: 'success', data });
    } catch (err) {
      if (err instanceof PanelApiError) {
        switch (err.code) {
          case 'FORBIDDEN':
            setState({ status: 'forbidden' });
            break;
          case 'UNAUTHORIZED':
            setState({ status: 'error', message: 'Không có quyền truy cập. Vui lòng đăng nhập.' });
            break;
          default:
            setState({ status: 'error', message: err.userMessage });
        }
      } else {
        const { message } = describeError(err);
        setState({ status: 'error', message });
      }
    }
  }, [laborProfileId]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const retry = React.useCallback(() => { void load(); }, [load]);

  return (
    <section aria-label="Talent Context Panel">
      <h2 style={{ fontSize: '1rem', marginBottom: '0.75rem' }}>Hồ sơ ứng viên</h2>
      {state.status === 'loading' && <LoadingState message="Đang tải hồ sơ..." />}
      {state.status === 'error' && <ErrorState message={state.message} onRetry={retry} />}
      {state.status === 'forbidden' && <ForbiddenState />}
      {state.status === 'unresolved' && <UnresolvedState />}
      {state.status === 'stale' && <StaleState />}
      {state.status === 'timeout' && <TimeoutState />}
      {state.status === 'empty' && <EmptyState message="Không có hồ sơ ứng viên." />}
      {state.status === 'partial' && (
        <PartialSuccessState
          title="Kết quả một phần"
          detail={`Một số thông tin không khả dụng: ${state.data.unavailableFields?.join(', ') ?? ''}`}
        >
          <ContextPanel data={state.data} isTalent={true} isNarrow={isNarrow} />
        </PartialSuccessState>
      )}
      {state.status === 'success' && (
        <ContextPanel data={state.data} isTalent={true} isNarrow={isNarrow} />
      )}
    </section>
  );
}
