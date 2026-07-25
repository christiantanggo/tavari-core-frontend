// src/components/DigitalSignage/ScheduleFormModal.jsx
import React, { useEffect, useState } from 'react';
import { FiX } from 'react-icons/fi';
import { TavariStyles } from '../../utils/TavariStyles';
import TavariCheckbox from '../UI/TavariCheckbox';
import { getDigitalSignageModalStyles } from './digitalSignageModalStyles';

const DEFAULT_FORM = {
  name: '',
  type: 'playlist',
  startDate: '',
  endDate: '',
  startTime: '',
  endTime: '',
  daysOfWeek: [],
  screenIds: [],
  priority: 1
};

function buildScheduleFormData(schedule) {
  if (!schedule) return { ...DEFAULT_FORM };
  return {
    name: schedule.schedule_name || '',
    type: schedule.schedule_type || 'playlist',
    startDate: schedule.start_date ? String(schedule.start_date).slice(0, 10) : '',
    endDate: schedule.end_date ? String(schedule.end_date).slice(0, 10) : '',
    startTime: schedule.start_time ? String(schedule.start_time).slice(0, 5) : '',
    endTime: schedule.end_time ? String(schedule.end_time).slice(0, 5) : '',
    daysOfWeek: Array.isArray(schedule.days_of_week) ? schedule.days_of_week : [],
    screenIds: Array.isArray(schedule.apply_to_screens) ? schedule.apply_to_screens : [],
    priority: schedule.priority || 1
  };
}

const ScheduleFormModal = ({ onClose, onSubmit, screens = [], checkConflicts, schedule = null }) => {
  const isEdit = Boolean(schedule?.id);
  const [formData, setFormData] = useState(() => buildScheduleFormData(schedule));
  const [loading, setLoading] = useState(false);
  const [conflicts, setConflicts] = useState([]);
  const [validationError, setValidationError] = useState('');

  useEffect(() => {
    setFormData(buildScheduleFormData(schedule));
    setConflicts([]);
    setValidationError('');
  }, [schedule?.id]);

  const days = [
    { value: 0, label: 'Sunday' },
    { value: 1, label: 'Monday' },
    { value: 2, label: 'Tuesday' },
    { value: 3, label: 'Wednesday' },
    { value: 4, label: 'Thursday' },
    { value: 5, label: 'Friday' },
    { value: 6, label: 'Saturday' }
  ];

  const handleDayToggle = (dayValue) => {
    setFormData(prev => ({
      ...prev,
      daysOfWeek: prev.daysOfWeek.includes(dayValue)
        ? prev.daysOfWeek.filter(d => d !== dayValue)
        : [...prev.daysOfWeek, dayValue]
    }));
  };

  const handleScreenToggle = (screenId) => {
    setFormData(prev => ({
      ...prev,
      screenIds: prev.screenIds.includes(screenId)
        ? prev.screenIds.filter(id => id !== screenId)
        : [...prev.screenIds, screenId]
    }));
  };

  const handleCheckConflicts = async () => {
    if (!formData.startTime || !formData.endTime || formData.screenIds.length === 0) {
      return;
    }

    try {
      const conflictsFound = await checkConflicts({
        screenIds: formData.screenIds,
        startTime: formData.startTime,
        endTime: formData.endTime,
        daysOfWeek: formData.daysOfWeek,
        excludeScheduleId: schedule?.id || null
      });
      setConflicts(conflictsFound);
    } catch (err) {
      console.error('Error checking conflicts:', err);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setValidationError('');

    try {
      if (formData.screenIds.length === 0) {
        setValidationError('Select at least one screen so this schedule can play.');
        return;
      }
      if ((formData.startTime && !formData.endTime) || (!formData.startTime && formData.endTime)) {
        setValidationError('Set both start and end time, or leave both blank for all day.');
        return;
      }

      let conflictsFound = [];
      if (formData.startTime && formData.endTime && formData.screenIds.length > 0) {
        conflictsFound = await checkConflicts({
          screenIds: formData.screenIds,
          startTime: formData.startTime,
          endTime: formData.endTime,
          daysOfWeek: formData.daysOfWeek,
          excludeScheduleId: schedule?.id || null
        });
        setConflicts(conflictsFound);
      }

      if (conflictsFound.length > 0) {
        setValidationError('This schedule conflicts with another schedule on the selected screen(s).');
        return;
      }

      await onSubmit(formData);
    } catch (err) {
      console.error('Error submitting form:', err);
    } finally {
      setLoading(false);
    }
  };

  const base = getDigitalSignageModalStyles({ maxWidth: '700px' });
  const styles = {
    ...base,
    checkboxGroup: {
      display: 'flex',
      flexWrap: 'wrap',
      gap: TavariStyles.spacing.md
    },
    conflictWarning: {
      padding: TavariStyles.spacing.md,
      backgroundColor: TavariStyles.colors.warningBg,
      color: TavariStyles.colors.warningText,
      borderRadius: TavariStyles.borderRadius.md
    }
  };

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={styles.header}>
          <div style={styles.headerText}>
            <h2 style={styles.title}>{isEdit ? 'Edit Schedule' : 'Create Schedule'}</h2>
          </div>
          <button type="button" style={styles.closeButton} onClick={onClose} aria-label="Close">
            <FiX />
          </button>
        </div>

        <div style={styles.body}>
          <form style={styles.form} onSubmit={handleSubmit}>
            <div style={styles.formGroup}>
              <label style={styles.label}>Schedule Name *</label>
              <input
                style={styles.input}
                type="text"
                required
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="Morning Schedule"
              />
            </div>

            <div style={styles.formGroup}>
              <label style={styles.label}>Schedule Type</label>
              <select
                style={styles.select}
                value={formData.type}
                onChange={(e) => setFormData({ ...formData, type: e.target.value })}
              >
                <option value="playlist">Playlist</option>
                <option value="time_based">Time Based</option>
                <option value="event_based">Event Based</option>
              </select>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: TavariStyles.spacing.md }}>
              <div style={styles.formGroup}>
                <label style={styles.label}>Start Date</label>
                <input
                  style={styles.input}
                  type="date"
                  value={formData.startDate}
                  onChange={(e) => setFormData({ ...formData, startDate: e.target.value })}
                />
              </div>
              <div style={styles.formGroup}>
                <label style={styles.label}>End Date</label>
                <input
                  style={styles.input}
                  type="date"
                  value={formData.endDate}
                  onChange={(e) => setFormData({ ...formData, endDate: e.target.value })}
                />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: TavariStyles.spacing.md }}>
              <div style={styles.formGroup}>
                <label style={styles.label}>Start Time</label>
                <input
                  style={styles.input}
                  type="time"
                  value={formData.startTime}
                  onChange={(e) => {
                    setFormData({ ...formData, startTime: e.target.value });
                    setTimeout(handleCheckConflicts, 500);
                  }}
                />
              </div>
              <div style={styles.formGroup}>
                <label style={styles.label}>End Time</label>
                <input
                  style={styles.input}
                  type="time"
                  value={formData.endTime}
                  onChange={(e) => {
                    setFormData({ ...formData, endTime: e.target.value });
                    setTimeout(handleCheckConflicts, 500);
                  }}
                />
              </div>
            </div>

            <div style={styles.formGroup}>
              <label style={styles.label}>Days of Week</label>
              <div style={styles.checkboxGroup}>
                {days.map(day => (
                  <TavariCheckbox
                    key={day.value}
                    id={`schedule-day-${day.value}`}
                    checked={formData.daysOfWeek.includes(day.value)}
                    onChange={() => handleDayToggle(day.value)}
                    label={day.label}
                    size="sm"
                  />
                ))}
              </div>
            </div>

            <div style={styles.formGroup}>
              <label style={styles.label}>Screens</label>
              <div style={styles.checkboxGroup}>
                {screens.map(screen => (
                  <TavariCheckbox
                    key={screen.id}
                    id={`schedule-screen-${screen.id}`}
                    checked={formData.screenIds.includes(screen.id)}
                    onChange={() => {
                      handleScreenToggle(screen.id);
                      setTimeout(handleCheckConflicts, 500);
                    }}
                    label={screen.screen_name}
                    size="sm"
                  />
                ))}
              </div>
            </div>

            {conflicts.length > 0 && (
              <div style={styles.conflictWarning}>
                <strong>⚠️ Conflicts detected:</strong>
                <ul style={{ marginTop: TavariStyles.spacing.xs, paddingLeft: TavariStyles.spacing.lg }}>
                  {conflicts.map((conflict, idx) => (
                    <li key={idx}>{conflict.conflict_schedule_name}</li>
                  ))}
                </ul>
              </div>
            )}

            {validationError ? (
              <div style={styles.conflictWarning}>
                <strong>{validationError}</strong>
              </div>
            ) : null}

            <div style={styles.actions}>
              <button
                type="button"
                style={styles.buttonSecondary}
                onClick={onClose}
                disabled={loading}
              >
                Cancel
              </button>
              <button
                type="submit"
                style={styles.buttonPrimary}
                disabled={loading || conflicts.length > 0}
              >
                {loading ? 'Saving...' : isEdit ? 'Save Changes' : 'Create Schedule'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default ScheduleFormModal;
