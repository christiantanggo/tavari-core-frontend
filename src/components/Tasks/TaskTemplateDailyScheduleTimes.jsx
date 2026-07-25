import React, { useMemo, useState } from 'react';
import { FiPlus, FiTrash2 } from 'react-icons/fi';
import toast from 'react-hot-toast';
import BookingTimeSlotSelect from '../Bookings/BookingTimeSlotSelect';
import {
  DEFAULT_OPERATING_HOURS,
  parseTimeToMinutes
} from '../../helpers/Bookings/operatingHoursTimeOptions';
import { TavariStyles } from '../../utils/TavariStyles';

/**
 * Daily recurring template times — 15-minute dropdown (same as Bookings activity schedules).
 */
const TaskTemplateDailyScheduleTimes = ({
  label = 'Daily schedule times',
  hint = 'Times every 15 minutes, from 3 hours before open until 3 hours after close (Settings → Operating Hours), same as Bookings activities.',
  scheduleTimes = [],
  onChange,
  operatingHours = DEFAULT_OPERATING_HOURS
}) => {
  const [pendingTime, setPendingTime] = useState('');

  const sortedTimes = useMemo(
    () =>
      [...scheduleTimes].sort((a, b) => {
        const ma = parseTimeToMinutes(a);
        const mb = parseTimeToMinutes(b);
        if (ma == null && mb == null) return 0;
        if (ma == null) return 1;
        if (mb == null) return -1;
        return ma - mb;
      }),
    [scheduleTimes]
  );

  const addTime = () => {
    const trimmed = (pendingTime || '').trim();
    if (!trimmed) {
      toast.error('Select a time first');
      return;
    }
    const exists = scheduleTimes.some(
      (t) => parseTimeToMinutes(t) === parseTimeToMinutes(trimmed)
    );
    if (exists) {
      toast.error('That time is already in the list');
      return;
    }
    const next = [...scheduleTimes, trimmed].sort((a, b) => {
      const ma = parseTimeToMinutes(a) ?? 0;
      const mb = parseTimeToMinutes(b) ?? 0;
      return ma - mb;
    });
    onChange(next);
    setPendingTime('');
  };

  const removeTime = (time) => {
    onChange(scheduleTimes.filter((t) => t !== time));
  };

  return (
    <div style={styles.wrap}>
      <span style={styles.label}>{label}</span>
      <p style={styles.hint}>
        {hint}
      </p>
      <div style={styles.addRow}>
        <div style={styles.selectWrap}>
          <BookingTimeSlotSelect
            value={pendingTime}
            onChange={setPendingTime}
            operatingHours={operatingHours}
            dayKey="monday"
            format="display"
            placeholder="Select time…"
            style={styles.select}
          />
        </div>
        <button type="button" style={styles.addButton} onClick={addTime}>
          <FiPlus size={16} />
          Add time
        </button>
      </div>
      <div style={styles.list}>
        {sortedTimes.length === 0 ? (
          <p style={styles.empty}>No times added yet. Add at least one time when the task should appear each day.</p>
        ) : (
          sortedTimes.map((time) => (
            <div key={time} style={styles.chip}>
              <span style={styles.chipLabel}>{time}</span>
              <button
                type="button"
                style={styles.removeButton}
                onClick={() => removeTime(time)}
                title="Remove time"
                aria-label={`Remove ${time}`}
              >
                <FiTrash2 size={14} />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

const styles = {
  wrap: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    width: '100%',
    minWidth: 0,
    boxSizing: 'border-box'
  },
  label: { fontWeight: 700, color: '#374151', fontSize: 13 },
  hint: {
    margin: 0,
    color: TavariStyles.colors.gray600,
    fontSize: 13,
    lineHeight: 1.5
  },
  addRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 10,
    alignItems: 'flex-end'
  },
  selectWrap: { flex: '1 1 200px', minWidth: 0 },
  select: { padding: '10px 12px', fontSize: 14 },
  addButton: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    border: 'none',
    borderRadius: 10,
    padding: '10px 14px',
    background: '#008080',
    color: 'white',
    fontWeight: 700,
    fontSize: 14,
    cursor: 'pointer',
    whiteSpace: 'nowrap'
  },
  list: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    border: '1px solid #e5e7eb',
    borderRadius: 10,
    padding: 10,
    minHeight: 48,
    background: '#fafafa'
  },
  empty: { margin: 0, color: '#6b7280', fontSize: 13 },
  chip: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    padding: '8px 10px',
    background: 'white',
    border: '1px solid #e5e7eb',
    borderRadius: 8
  },
  chipLabel: { fontWeight: 600, color: '#111827', fontSize: 14 },
  removeButton: {
    border: 'none',
    background: 'transparent',
    color: '#ef4444',
    cursor: 'pointer',
    padding: 4,
    borderRadius: 4,
    display: 'flex',
    alignItems: 'center'
  }
};

export default TaskTemplateDailyScheduleTimes;
