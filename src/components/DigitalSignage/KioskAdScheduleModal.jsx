// Modal: schedule waiver kiosk attract images (business timezone)
import React, { useMemo, useState } from 'react';
import { FiX } from 'react-icons/fi';
import toast from 'react-hot-toast';
import { TavariStyles } from '../../utils/TavariStyles';
import TavariCheckbox from '../UI/TavariCheckbox';
import {
  dbTimeToTimeInput,
  timeInputToDbTime
} from '../../utils/kioskIdleAdSchedule';
import { getDigitalSignageModalStyles } from './digitalSignageModalStyles';

const DAY_OPTIONS = [
  { num: 0, label: 'Sun' },
  { num: 1, label: 'Mon' },
  { num: 2, label: 'Tue' },
  { num: 3, label: 'Wed' },
  { num: 4, label: 'Thu' },
  { num: 5, label: 'Fri' },
  { num: 6, label: 'Sat' }
];

function dateToInput(d) {
  if (!d) return '';
  return String(d).slice(0, 10);
}

/**
 * @param {{ ad: object, businessTimezone: string, onClose: function, onSave: function }} props
 */
const KioskAdScheduleModal = ({ ad, businessTimezone, onClose, onSave }) => {
  const tz = businessTimezone && String(businessTimezone).trim() ? businessTimezone.trim() : 'America/Toronto';

  const initialAllDay = useMemo(() => {
    const st = ad?.start_time;
    const et = ad?.end_time;
    return (st == null || st === '') && (et == null || et === '');
  }, [ad]);

  const [startDate, setStartDate] = useState(dateToInput(ad?.start_date));
  const [endDate, setEndDate] = useState(dateToInput(ad?.end_date));
  const [allDay, setAllDay] = useState(initialAllDay);
  const [startTime, setStartTime] = useState(() => dbTimeToTimeInput(ad?.start_time) || '09:00');
  const [endTime, setEndTime] = useState(() => dbTimeToTimeInput(ad?.end_time) || '17:00');
  const [selectedDays, setSelectedDays] = useState(() => {
    const d = ad?.days_of_week;
    if (!Array.isArray(d) || d.length === 0) return new Set(DAY_OPTIONS.map((x) => x.num));
    return new Set(d);
  });
  const [audience, setAudience] = useState(() => {
    const value = String(ad?.audience || 'venue').trim().toLowerCase();
    return value === 'web' || value === 'both' ? value : 'venue';
  });
  const [saving, setSaving] = useState(false);

  const toggleDay = (num) => {
    setSelectedDays((prev) => {
      const next = new Set(prev);
      if (next.has(num)) next.delete(num);
      else next.add(num);
      return next;
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!allDay) {
      if (!startTime || !endTime) {
        toast.error('Choose a start and end time, or enable all day.');
        return;
      }
    }
    const allSeven = selectedDays.size === 7;
    const daysPayload = allSeven || selectedDays.size === 0 ? null : Array.from(selectedDays).sort((a, b) => a - b);

    const payload = {
      start_date: startDate.trim() ? startDate.trim() : null,
      end_date: endDate.trim() ? endDate.trim() : null,
      start_time: allDay ? null : timeInputToDbTime(startTime),
      end_time: allDay ? null : timeInputToDbTime(endTime),
      days_of_week: daysPayload,
      audience,
    };

    setSaving(true);
    try {
      await onSave(ad.id, payload);
      onClose();
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  const base = getDigitalSignageModalStyles({ maxWidth: '520px' });
  const styles = {
    ...base,
    row: {
      display: 'flex',
      gap: TavariStyles.spacing.md,
      flexWrap: 'wrap',
      alignItems: 'center'
    },
    dayRow: {
      display: 'flex',
      flexWrap: 'wrap',
      gap: TavariStyles.spacing.xs
    },
    dayChip: (on) => ({
      padding: `${TavariStyles.spacing.xs} ${TavariStyles.spacing.sm}`,
      borderRadius: TavariStyles.borderRadius.md,
      border: `1px solid ${on ? TavariStyles.colors.primary : TavariStyles.colors.gray300}`,
      background: on ? `${TavariStyles.colors.primary}18` : TavariStyles.colors.white,
      color: on ? TavariStyles.colors.primary : TavariStyles.colors.gray700,
      cursor: 'pointer',
      fontSize: TavariStyles.typography.fontSize.sm,
      fontWeight: TavariStyles.typography.fontWeight.medium
    })
  };

  return (
    <div style={styles.overlay} role="presentation" onClick={onClose}>
      <div
        style={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby="kiosk-schedule-title"
        onClick={(ev) => ev.stopPropagation()}
      >
        <div style={styles.header}>
          <div style={styles.headerText}>
            <h2 id="kiosk-schedule-title" style={styles.title}>
              Schedule: {ad?.ad_name || 'Image'}
            </h2>
          </div>
          <button type="button" style={styles.closeButton} onClick={onClose} aria-label="Close">
            <FiX size={22} />
          </button>
        </div>

        <div style={styles.body}>
          <p style={styles.subtitle}>
            Dates and times use your business timezone: <strong>{tz}</strong> (from Settings). Guests see this image on
            the waiver kiosk attract screen only when the schedule matches “now” in that zone.
          </p>

          <form style={styles.form} onSubmit={handleSubmit}>
            <div style={styles.formGroup}>
              <label style={styles.label}>Audience</label>
              <select
                value={audience}
                onChange={(e) => setAudience(e.target.value)}
                style={styles.input}
              >
                <option value="venue">In-venue only (screens / kiosk)</option>
                <option value="web">Website only</option>
                <option value="both">In-venue and website</option>
              </select>
            </div>

            <div style={styles.formGroup}>
              <label style={styles.label}>Start date (optional)</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                style={styles.input}
              />
            </div>

            <div style={styles.formGroup}>
              <label style={styles.label}>End date (optional)</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                style={styles.input}
              />
            </div>

            <div style={styles.formGroup}>
              <TavariCheckbox
                checked={allDay}
                onChange={(checked) => setAllDay(checked)}
                label="All day (24 hours)"
              />
            </div>

            {!allDay ? (
              <div style={styles.formGroup}>
                <label style={styles.label}>Time window</label>
                <div style={styles.row}>
                  <input
                    type="time"
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                    style={styles.input}
                  />
                  <span style={{ color: TavariStyles.colors.gray500 }}>to</span>
                  <input
                    type="time"
                    value={endTime}
                    onChange={(e) => setEndTime(e.target.value)}
                    style={styles.input}
                  />
                </div>
              </div>
            ) : null}

            <div style={styles.formGroup}>
              <label style={styles.label}>Days (leave all selected for every day)</label>
              <div style={styles.dayRow}>
                {DAY_OPTIONS.map(({ num, label }) => (
                  <button
                    key={num}
                    type="button"
                    style={styles.dayChip(selectedDays.has(num))}
                    onClick={() => toggleDay(num)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div style={styles.actions}>
              <button type="button" style={styles.buttonSecondary} onClick={onClose} disabled={saving}>
                Cancel
              </button>
              <button type="submit" style={styles.buttonPrimary} disabled={saving}>
                {saving ? 'Saving…' : 'Save schedule'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default KioskAdScheduleModal;
