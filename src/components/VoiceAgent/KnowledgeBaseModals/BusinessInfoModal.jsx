// components/VoiceAgent/KnowledgeBaseModals/BusinessInfoModal.jsx
// Modal for editing Business Information with holiday hours
import React, { useState, useEffect } from 'react';
import { Save, Plus, Trash2 } from 'lucide-react';
import { TavariStyles } from '../../../utils/TavariStyles';
import toast from 'react-hot-toast';
import BaseKnowledgeModal from './BaseKnowledgeModal';

const BusinessInfoModal = ({ isOpen, onClose, businessId, voiceAgentService, businessInfo: initialBusinessInfo, onSave }) => {
  const [businessData, setBusinessData] = useState({
    name: '',
    business_address: '',
    business_city: '',
    business_state: 'ON',
    business_postal: '',
    business_phone: '',
    business_email: '',
    business_website: '',
    timezone: 'America/Toronto',
    holiday_hours: [],
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isOpen && initialBusinessInfo) {
      setBusinessData({
        name: initialBusinessInfo.name || '',
        business_address: initialBusinessInfo.business_address || '',
        business_city: initialBusinessInfo.business_city || '',
        business_state: initialBusinessInfo.business_state || 'ON',
        business_postal: initialBusinessInfo.business_postal || '',
        business_phone: initialBusinessInfo.business_phone || '',
        business_email: initialBusinessInfo.business_email || '',
        business_website: initialBusinessInfo.business_website || '',
        timezone: initialBusinessInfo.timezone || 'America/Toronto',
        holiday_hours: Array.isArray(initialBusinessInfo.holiday_hours) ? initialBusinessInfo.holiday_hours : [],
      });
      setLoading(false);
    }
  }, [isOpen, initialBusinessInfo]);

  const handleChange = (field, value) => {
    setBusinessData(prev => ({ ...prev, [field]: value }));
  };

  const handleSave = async () => {
    if (!businessData.name?.trim()) {
      toast.error('Business name is required');
      return;
    }

    setSaving(true);
    try {
      await voiceAgentService.updateBusinessInfo(businessId, businessData);
      toast.success('Business information saved successfully');
      if (onSave) onSave();
      onClose();
    } catch (error) {
      console.error('Error saving business info:', error);
      toast.error('Failed to save: ' + (error.message || 'Unknown error'));
    } finally {
      setSaving(false);
    }
  };

  const addHoliday = () => {
    const newHoliday = {
      id: Date.now(),
      date: '',
      name: '',
      closed: true,
      hours: { open: '10:00', close: '14:00' }
    };
    setBusinessData(prev => ({
      ...prev,
      holiday_hours: [...(prev.holiday_hours || []), newHoliday]
    }));
  };

  const updateHoliday = (holidayId, field, value) => {
    setBusinessData(prev => ({
      ...prev,
      holiday_hours: (prev.holiday_hours || []).map(holiday =>
        holiday.id === holidayId ? { ...holiday, [field]: value } : holiday
      )
    }));
  };

  const updateHolidayHours = (holidayId, timeField, value) => {
    setBusinessData(prev => ({
      ...prev,
      holiday_hours: (prev.holiday_hours || []).map(holiday =>
        holiday.id === holidayId
          ? { ...holiday, hours: { ...holiday.hours, [timeField]: value } }
          : holiday
      )
    }));
  };

  const removeHoliday = (holidayId) => {
    setBusinessData(prev => ({
      ...prev,
      holiday_hours: (prev.holiday_hours || []).filter(h => h.id !== holidayId)
    }));
  };

  const timezones = [
    { value: 'America/Toronto', label: 'Eastern Time (Toronto)' },
    { value: 'America/Winnipeg', label: 'Central Time (Winnipeg)' },
    { value: 'America/Edmonton', label: 'Mountain Time (Edmonton)' },
    { value: 'America/Vancouver', label: 'Pacific Time (Vancouver)' },
    { value: 'America/St_Johns', label: 'Newfoundland Time (St. Johns)' },
    { value: 'America/Halifax', label: 'Atlantic Time (Halifax)' }
  ];

  const provinces = [
    { value: 'ON', label: 'Ontario' },
    { value: 'BC', label: 'British Columbia' },
    { value: 'AB', label: 'Alberta' },
    { value: 'SK', label: 'Saskatchewan' },
    { value: 'MB', label: 'Manitoba' },
    { value: 'QC', label: 'Quebec' },
    { value: 'NB', label: 'New Brunswick' },
    { value: 'NS', label: 'Nova Scotia' },
    { value: 'PE', label: 'Prince Edward Island' },
    { value: 'NL', label: 'Newfoundland and Labrador' },
    { value: 'YT', label: 'Yukon' },
    { value: 'NT', label: 'Northwest Territories' },
    { value: 'NU', label: 'Nunavut' }
  ];

  const styles = {
    formGroup: {
      marginBottom: TavariStyles.spacing.md,
    },
    label: {
      display: 'block',
      marginBottom: TavariStyles.spacing.xs,
      fontSize: TavariStyles.typography.fontSize.sm,
      fontWeight: TavariStyles.typography.fontWeight.medium,
      color: TavariStyles.colors.gray700,
    },
    input: {
      width: '100%',
      padding: `${TavariStyles.spacing.sm} ${TavariStyles.spacing.md}`,
      border: `1px solid ${TavariStyles.colors.gray300}`,
      borderRadius: TavariStyles.borderRadius?.md || '8px',
      fontSize: TavariStyles.typography.fontSize.base,
      boxSizing: 'border-box',
    },
    select: {
      width: '100%',
      padding: `${TavariStyles.spacing.sm} ${TavariStyles.spacing.md}`,
      border: `1px solid ${TavariStyles.colors.gray300}`,
      borderRadius: TavariStyles.borderRadius?.md || '8px',
      fontSize: TavariStyles.typography.fontSize.base,
      backgroundColor: TavariStyles.colors.white,
      boxSizing: 'border-box',
    },
    formGrid: {
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: TavariStyles.spacing.md,
    },
    section: {
      marginBottom: TavariStyles.spacing.xl,
      paddingTop: TavariStyles.spacing.lg,
      borderTop: `1px solid ${TavariStyles.colors.gray200}`,
    },
    sectionTitle: {
      fontSize: TavariStyles.typography.fontSize.lg,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.gray900,
      marginBottom: TavariStyles.spacing.md,
    },
    holidayItem: {
      backgroundColor: TavariStyles.colors.gray50,
      padding: TavariStyles.spacing.md,
      borderRadius: TavariStyles.borderRadius?.md || '8px',
      border: `1px solid ${TavariStyles.colors.gray300}`,
      marginBottom: TavariStyles.spacing.sm,
    },
    checkboxGroup: {
      display: 'flex',
      alignItems: 'center',
      gap: TavariStyles.spacing.sm,
      marginBottom: TavariStyles.spacing.sm,
    },
    footer: {
      padding: TavariStyles.spacing.xl,
      borderTop: `1px solid ${TavariStyles.colors.gray200}`,
      display: 'flex',
      justifyContent: 'flex-end',
      gap: TavariStyles.spacing.md,
      marginTop: TavariStyles.spacing.xl,
    },
    saveButton: {
      padding: `${TavariStyles.spacing.md} ${TavariStyles.spacing.xl}`,
      border: 'none',
      borderRadius: TavariStyles.borderRadius?.md || '8px',
      backgroundColor: saving ? TavariStyles.colors.gray400 : (TavariStyles.colors.primary || '#008080'),
      color: TavariStyles.colors.white,
      cursor: saving ? 'not-allowed' : 'pointer',
      fontSize: TavariStyles.typography.fontSize.base,
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      display: 'flex',
      alignItems: 'center',
      gap: TavariStyles.spacing.sm,
    },
  };

  if (loading) {
    return (
      <BaseKnowledgeModal isOpen={isOpen} onClose={onClose} title="Business Information">
        <div style={{ textAlign: 'center', padding: '48px' }}>
          <div>Loading business information...</div>
        </div>
      </BaseKnowledgeModal>
    );
  }

  return (
    <BaseKnowledgeModal isOpen={isOpen} onClose={onClose} title="Business Information" width="900px">
      {/* Basic Information */}
      <div>
        <h3 style={styles.sectionTitle}>Basic Information</h3>
        <div style={styles.formGrid}>
          <div style={styles.formGroup}>
            <label style={styles.label}>Business Name *</label>
            <input
              type="text"
              value={businessData.name}
              onChange={(e) => handleChange('name', e.target.value)}
              style={styles.input}
            />
          </div>
          <div style={styles.formGroup}>
            <label style={styles.label}>Business Email</label>
            <input
              type="email"
              value={businessData.business_email}
              onChange={(e) => handleChange('business_email', e.target.value)}
              style={styles.input}
            />
          </div>
          <div style={styles.formGroup}>
            <label style={styles.label}>Business Phone</label>
            <input
              type="tel"
              value={businessData.business_phone}
              onChange={(e) => handleChange('business_phone', e.target.value)}
              style={styles.input}
            />
          </div>
          <div style={styles.formGroup}>
            <label style={styles.label}>Website</label>
            <input
              type="url"
              value={businessData.business_website}
              onChange={(e) => handleChange('business_website', e.target.value)}
              style={styles.input}
            />
          </div>
        </div>
      </div>

      {/* Address */}
      <div style={styles.section}>
        <h3 style={styles.sectionTitle}>Address</h3>
        <div style={styles.formGroup}>
          <label style={styles.label}>Street Address</label>
          <input
            type="text"
            value={businessData.business_address}
            onChange={(e) => handleChange('business_address', e.target.value)}
            style={styles.input}
          />
        </div>
        <div style={styles.formGrid}>
          <div style={styles.formGroup}>
            <label style={styles.label}>City</label>
            <input
              type="text"
              value={businessData.business_city}
              onChange={(e) => handleChange('business_city', e.target.value)}
              style={styles.input}
            />
          </div>
          <div style={styles.formGroup}>
            <label style={styles.label}>Province/State</label>
            <select
              value={businessData.business_state}
              onChange={(e) => handleChange('business_state', e.target.value)}
              style={styles.select}
            >
              {provinces.map(p => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>
          </div>
          <div style={styles.formGroup}>
            <label style={styles.label}>Postal Code</label>
            <input
              type="text"
              value={businessData.business_postal}
              onChange={(e) => handleChange('business_postal', e.target.value)}
              style={styles.input}
            />
          </div>
        </div>
      </div>

      {/* Timezone */}
      <div style={styles.section}>
        <h3 style={styles.sectionTitle}>Timezone</h3>
        <div style={styles.formGroup}>
          <label style={styles.label}>Timezone</label>
          <select
            value={businessData.timezone}
            onChange={(e) => handleChange('timezone', e.target.value)}
            style={styles.select}
          >
            {timezones.map(tz => (
              <option key={tz.value} value={tz.value}>{tz.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Holiday Hours */}
      <div style={styles.section}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: TavariStyles.spacing.md }}>
          <h3 style={{ ...styles.sectionTitle, marginBottom: 0 }}>Holiday Hours</h3>
          <button
            onClick={addHoliday}
            style={{
              padding: `${TavariStyles.spacing.sm} ${TavariStyles.spacing.md}`,
              border: 'none',
              borderRadius: TavariStyles.borderRadius?.md || '8px',
              backgroundColor: TavariStyles.colors.primary || '#008080',
              color: TavariStyles.colors.white,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: TavariStyles.spacing.xs,
            }}
          >
            <Plus size={16} />
            Add Holiday
          </button>
        </div>

        {businessData.holiday_hours?.map((holiday) => (
          <div key={holiday.id} style={styles.holidayItem}>
            <div style={styles.formGrid}>
              <div style={styles.formGroup}>
                <label style={styles.label}>Holiday Name</label>
                <input
                  type="text"
                  value={holiday.name}
                  onChange={(e) => updateHoliday(holiday.id, 'name', e.target.value)}
                  style={styles.input}
                  placeholder="e.g., Christmas Day"
                />
              </div>
              <div style={styles.formGroup}>
                <label style={styles.label}>Date</label>
                <input
                  type="date"
                  value={holiday.date}
                  onChange={(e) => updateHoliday(holiday.id, 'date', e.target.value)}
                  style={styles.input}
                />
              </div>
            </div>
            <div style={styles.checkboxGroup}>
              <input
                type="checkbox"
                checked={holiday.closed}
                onChange={(e) => updateHoliday(holiday.id, 'closed', e.target.checked)}
                id={`closed-${holiday.id}`}
              />
              <label htmlFor={`closed-${holiday.id}`} style={styles.label}>Closed</label>
            </div>
            {!holiday.closed && (
              <div style={styles.formGrid}>
                <div style={styles.formGroup}>
                  <label style={styles.label}>Open Time</label>
                  <input
                    type="time"
                    value={holiday.hours?.open || '10:00'}
                    onChange={(e) => updateHolidayHours(holiday.id, 'open', e.target.value)}
                    style={styles.input}
                  />
                </div>
                <div style={styles.formGroup}>
                  <label style={styles.label}>Close Time</label>
                  <input
                    type="time"
                    value={holiday.hours?.close || '14:00'}
                    onChange={(e) => updateHolidayHours(holiday.id, 'close', e.target.value)}
                    style={styles.input}
                  />
                </div>
              </div>
            )}
            <button
              onClick={() => removeHoliday(holiday.id)}
              style={{
                padding: `${TavariStyles.spacing.xs} ${TavariStyles.spacing.sm}`,
                border: 'none',
                borderRadius: TavariStyles.borderRadius?.sm || '4px',
                backgroundColor: '#ef4444',
                color: 'white',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                marginTop: TavariStyles.spacing.sm,
              }}
            >
              <Trash2 size={14} />
              Remove
            </button>
          </div>
        ))}

        {(!businessData.holiday_hours || businessData.holiday_hours.length === 0) && (
          <div style={{ textAlign: 'center', padding: '24px', color: TavariStyles.colors.gray500 }}>
            No holiday hours set. Click "Add Holiday" to add one.
          </div>
        )}
      </div>

      <div style={styles.footer}>
        <button
          onClick={handleSave}
          disabled={saving}
          style={styles.saveButton}
        >
          <Save size={18} />
          {saving ? 'Saving...' : 'Save Business Information'}
        </button>
      </div>
    </BaseKnowledgeModal>
  );
};

export default BusinessInfoModal;

