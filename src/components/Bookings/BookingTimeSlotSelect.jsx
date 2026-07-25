import React, { useMemo } from 'react';
import { TavariStyles } from '../../utils/TavariStyles';
import {
  buildFifteenMinuteTimeOptions,
  DEFAULT_OPERATING_HOURS
} from '../../helpers/Bookings/operatingHoursTimeOptions';

/**
 * 15-minute time dropdown scoped to operating hours ±3 hours (from business settings).
 */
const BookingTimeSlotSelect = ({
  value,
  onChange,
  operatingHours = DEFAULT_OPERATING_HOURS,
  dayKey = 'monday',
  format = 'display',
  disabled = false,
  placeholder = 'Select time…',
  style = {},
  id
}) => {
  const options = useMemo(
    () =>
      buildFifteenMinuteTimeOptions(operatingHours, dayKey, {
        format,
        includeValue: value
      }),
    [operatingHours, dayKey, format, value]
  );

  return (
    <select
      id={id}
      value={value || ''}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      style={{
        width: '100%',
        padding: '12px',
        border: '1px solid #e5e7eb',
        borderRadius: '8px',
        fontSize: '16px',
        boxSizing: 'border-box',
        backgroundColor: disabled ? '#f3f4f6' : 'white',
        color: TavariStyles.colors.gray900,
        ...style
      }}
    >
      <option value="">{placeholder}</option>
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
};

export default BookingTimeSlotSelect;
