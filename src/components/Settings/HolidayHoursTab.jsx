// src/components/Settings/HolidayHoursTab.jsx
import React from 'react';
import TavariCheckbox from '../UI/TavariCheckbox';

const HolidayHoursTab = ({ 
  businessData, 
  addHoliday, 
  updateHoliday, 
  updateHolidayHours, 
  removeHoliday, 
  styles 
}) => {
  return (
    <div style={styles.section}>
      <div style={holidayStyles.holidayHeader}>
        <h3 style={styles.sectionTitle}>Holiday & Special Hours</h3>
        <button onClick={addHoliday} style={holidayStyles.addButton}>
          + Add Holiday
        </button>
      </div>
      
      {businessData.holiday_hours?.length === 0 && (
        <div style={holidayStyles.emptyState}>
          <p>No holiday hours configured.</p>
          <p>Click "Add Holiday" to set special hours for holidays or events.</p>
        </div>
      )}

      {businessData.holiday_hours?.map((holiday) => (
        <div key={holiday.id} style={holidayStyles.holidayRow}>
          <div style={holidayStyles.holidayGrid}>
            <div style={styles.formGroup}>
              <label style={styles.label}>Date</label>
              <input
                type="date"
                value={holiday.date}
                onChange={(e) => updateHoliday(holiday.id, 'date', e.target.value)}
                style={styles.input}
              />
            </div>
            
            <div style={styles.formGroup}>
              <label style={styles.label}>Holiday Name</label>
              <input
                type="text"
                value={holiday.name}
                onChange={(e) => updateHoliday(holiday.id, 'name', e.target.value)}
                style={styles.input}
                placeholder="Christmas Day, New Year's Eve, etc."
              />
            </div>
          </div>
          
          <div style={holidayStyles.holidayControls}>
            <TavariCheckbox
              checked={!!holiday.closed}
              onChange={(checked) => updateHoliday(holiday.id, 'closed', checked)}
              label="Closed All Day"
              id={`holiday-closed-${holiday.id}`}
            />
            
            {!holiday.closed && (
              <div style={holidayStyles.holidayTimes}>
                <div style={holidayStyles.timeInputGroup}>
                  <label style={holidayStyles.timeLabel}>Open:</label>
                  <input
                    type="time"
                    value={holiday.hours?.open || '10:00'}
                    onChange={(e) => updateHolidayHours(holiday.id, 'open', e.target.value)}
                    style={holidayStyles.timeInput}
                  />
                </div>
                
                <div style={holidayStyles.timeInputGroup}>
                  <label style={holidayStyles.timeLabel}>Close:</label>
                  <input
                    type="time"
                    value={holiday.hours?.close || '14:00'}
                    onChange={(e) => updateHolidayHours(holiday.id, 'close', e.target.value)}
                    style={holidayStyles.timeInput}
                  />
                </div>
              </div>
            )}
          </div>
          
          <button 
            onClick={() => removeHoliday(holiday.id)}
            style={holidayStyles.removeButton}
          >
            Remove
          </button>
        </div>
      ))}
    </div>
  );
};

const holidayStyles = {
  holidayHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '20px'
  },
  addButton: {
    padding: '8px 16px',
    backgroundColor: '#008080',
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    fontSize: '14px',
    fontWeight: 'bold',
    cursor: 'pointer'
  },
  emptyState: {
    textAlign: 'center',
    padding: '40px 20px',
    color: '#6b7280'
  },
  holidayRow: {
    padding: '20px',
    backgroundColor: '#f9fafb',
    borderRadius: '6px',
    border: '1px solid #e5e7eb',
    marginBottom: '15px'
  },
  holidayGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
    gap: '15px',
    marginBottom: '15px'
  },
  holidayControls: {
    display: 'flex',
    alignItems: 'center',
    gap: '20px',
    marginBottom: '15px',
    flexWrap: 'wrap'
  },
  holidayTimes: {
    display: 'flex',
    gap: '15px'
  },
  timeInputGroup: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px'
  },
  timeLabel: {
    fontSize: '14px',
    color: '#374151',
    minWidth: '40px',
    fontWeight: '500'
  },
  timeInput: {
    padding: '8px',
    border: '1px solid #d1d5db',
    borderRadius: '4px',
    fontSize: '14px'
  },
  removeButton: {
    padding: '6px 12px',
    backgroundColor: '#dc2626',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    fontSize: '13px',
    cursor: 'pointer'
  }
};

export default HolidayHoursTab;