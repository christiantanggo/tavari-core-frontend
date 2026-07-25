import React from 'react';
import { TavariStyles } from '../../utils/TavariStyles';
import { formatTicketLimitsSummary } from '../../utils/bookingTicketAssignment';
import TavariCheckbox from '../UI/TavariCheckbox';

/**
 * Shows activity ticket min/max for staff bookings and optional manager override.
 */
const StaffBookingTicketLimitsPanel = ({
  limits,
  participantCount = 0,
  overrideActive = false,
  onOverrideChange,
  canOverride = false,
  style = {}
}) => {
  const summary = formatTicketLimitsSummary(limits);
  if (!summary) return null;

  const limitCheckFailed =
    (limits?.maxTickets != null && participantCount > limits.maxTickets) ||
    (limits?.minTickets != null && participantCount > 0 && participantCount < limits.minTickets);

  return (
    <div
      style={{
        padding: '12px 14px',
        borderRadius: '8px',
        border: `1px solid ${limitCheckFailed && !overrideActive ? '#fecaca' : TavariStyles.colors.gray200}`,
        backgroundColor: limitCheckFailed && !overrideActive ? '#fef2f2' : '#f9fafb',
        fontSize: '13px',
        color: TavariStyles.colors.gray700,
        ...style
      }}
    >
      <div style={{ fontWeight: 600, color: TavariStyles.colors.gray900, marginBottom: canOverride ? 8 : 0 }}>
        Ticket limits: {summary}
      </div>
      {canOverride && (
        <TavariCheckbox
          checked={overrideActive}
          onChange={(checked) => onOverrideChange?.(!!checked)}
          label="Manager override (allow booking outside ticket limits)"
          size="md"
        />
      )}
      {!canOverride && limitCheckFailed && (
        <div style={{ marginTop: 6, color: '#b91c1c', fontSize: '13px' }}>
          Adjust participants to meet limits, or ask a manager to create this booking.
        </div>
      )}
    </div>
  );
};

export default StaffBookingTicketLimitsPanel;
