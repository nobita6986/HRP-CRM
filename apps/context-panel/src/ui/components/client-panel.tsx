/**
 * context-panel/src/ui/components/client-panel.tsx — Client context panel wrapper.
 *
 * AC:
 *  - Client domain chưa có contract → UNAVAILABLE (no fake success).
 *  - Branding hiển thị như đề xuất, chưa xác minh.
 */

import * as React from 'react';
import { UnavailableState } from './states.js';

export function ClientPanel() {
  return (
    <section aria-label="Client Context Panel">
      <h2 style={{ fontSize: '1rem', marginBottom: '0.75rem' }}>Hồ sơ khách hàng</h2>
      <UnavailableState
        message="Giao diện Client đang trong quá trình phát triển."
        detail="Contract cho ClientContact/SalesOpportunity chưa hoàn thiện."
      />
    </section>
  );
}
