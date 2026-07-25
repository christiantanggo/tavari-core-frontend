// src/components/Settings/OperatingHoursTab.jsx
import React from 'react';
import TavariCheckbox from '../UI/TavariCheckbox';

const OperatingHoursTab = ({ 
  businessData, 
  handleChange, 
  handleHoursChange, 
  handleDayClosedToggle, 
  styles,
  defaultHours 
}) => {
  const daysOfWeek = [
    { key: 'monday', label: 'Monday' },
    { key: 'tuesday', label: 'Tuesday' },
    { key: 'wednesday', label: 'Wednesday' },
    { key: 'thursday', label: 'Thursday' },
    { key: 'friday', label: 'Friday' },
    { key: 'saturday', label: 'Saturday' },
    { key: 'sunday', label: 'Sunday' }
  ];

  const timezones = [
    { value: 'America/Toronto', label: 'Eastern Time (Toronto)' },
    { value: 'America/Winnipeg', label: 'Central Time (Winnipeg)' },
    { value: 'America/Edmonton', label: 'Mountain Time (Edmonton)' },
    { value: 'America/Vancouver', label: 'Pacific Time (Vancouver)' },
    { value: 'America/St_Johns', label: 'Newfoundland Time (St. Johns)' },
    { value: 'America/Halifax', label: 'Atlantic Time (Halifax)' }
  ];

  return (
    <div style={styles.section}>
      <h3 style={styles.sectionTitle}>Regular Operating Hours</h3>
      
      <div style={styles.formGroup}>
        <label style={styles.label}>Timezone</label>
        <select
          name="timezone"
          value={businessData.timezone || 'America/Toronto'}
          onChange={handleChange}
          style={styles.select}
        >
          {timezones.map(tz => (
            <option key={tz.value} value={tz.value}>{tz.label}</option>
          ))}
        </select>
      </div>

      <div style={hoursStyles.hoursGrid}>
        {daysOfWeek.map(({ key, label }) => {
          const dayHours = businessData.operating_hours?.[key] || defaultHours[key];
          
          return (
            <div key={key} style={hoursStyles.dayRow}>
              <div style={hoursStyles.dayLabel}>{label}</div>
              
              <div style={hoursStyles.hoursControls}>
                <div style={hoursStyles.closedToggle}>
                  <TavariCheckbox
                    id={`closed-${key}`}
                    checked={dayHours.closed}
                    onChange={() => handleDayClosedToggle(key)}
                    label="Closed"
                    size="md"
                  />
                </div>
                
                {!dayHours.closed && (
                  <div style={hoursStyles.timeControls}>
                    <div style={hoursStyles.timeInputGroup}>
                      <label style={hoursStyles.timeLabel}>Open:</label>
                      <input
                        type="time"
                        value={dayHours.open}
                        onChange={(e) => handleHoursChange(key, 'open', e.target.value)}
                        style={hoursStyles.timeInput}
                      />
                    </div>
                    
                    <div style={hoursStyles.timeInputGroup}>
                      <label style={hoursStyles.timeLabel}>Close:</label>
                      <input
                        type="time"
                        value={dayHours.close}
                        onChange={(e) => handleHoursChange(key, 'close', e.target.value)}
                        style={hoursStyles.timeInput}
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

const hoursStyles = {
  hoursGrid: {
    display: 'flex',
    flexDirection: 'column',
    gap: '15px',
    marginTop: '20px'
  },
  dayRow: {
    display: 'flex',
    alignItems: 'center',
    padding: '15px',
    backgroundColor: '#f9fafb',
    borderRadius: '6px',
    border: '1px solid #e5e7eb'
  },
  dayLabel: {
    fontSize: '16px',
    fontWeight: 'bold',
    color: '#374151',
    minWidth: '120px'
  },
  hoursControls: {
    display: 'flex',
    alignItems: 'center',
    gap: '25px',
    flex: 1
  },
  closedToggle: {
    display: 'flex',
    alignItems: 'center',
    minWidth: '80px'
  },
  timeControls: {
    display: 'flex',
    alignItems: 'center',
    gap: '20px'
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
  }
};

export default OperatingHoursTab;