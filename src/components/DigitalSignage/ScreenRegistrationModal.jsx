// src/components/DigitalSignage/ScreenRegistrationModal.jsx
import React, { useEffect, useState } from 'react';
import { FiX } from 'react-icons/fi';
import { TavariStyles } from '../../utils/TavariStyles';
import useDigitalSignage from '../../hooks/useDigitalSignage';
import { getDigitalSignageModalStyles } from './digitalSignageModalStyles';
import { SIGNAGE_CONTENT_FIT_OPTIONS, contentFitFromScreenSettings } from '../../utils/signageContentFit';
import bookingSettingsService from '../../services/Bookings/BookingSettingsService';
import { useBusiness } from '../../contexts/BusinessContext';

function buildScreenFormData(screen) {
  const settings = screen?.settings && typeof screen.settings === 'object' ? screen.settings : {};
  return {
    name: screen?.screen_name || '',
    type: screen?.screen_type || 'standard',
    locationName: screen?.location_name || '',
    resolutionWidth: screen?.resolution_width ? String(screen.resolution_width) : '',
    resolutionHeight: screen?.resolution_height ? String(screen.resolution_height) : '',
    orientation: screen?.orientation || 'landscape',
    groupId: screen?.group_id || null,
    contentFit: contentFitFromScreenSettings(settings),
    bookingResourceCategoryId: settings.bookingResourceCategoryId || '',
    bookingResourceId: settings.bookingResourceId || '',
    bookingOverrideScheduleId: settings.bookingOverrideScheduleId || '',
    settings
  };
}

const ScreenRegistrationModal = ({ onClose, onSubmit, screen = null }) => {
  const isEdit = Boolean(screen?.id);
  const { business } = useBusiness();
  const { screenGroups, schedules, loadScreenGroups, loadSchedules } = useDigitalSignage();
  const [formData, setFormData] = useState(() => buildScreenFormData(screen));
  const [bookingResources, setBookingResources] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadScreenGroups();
    loadSchedules();
  }, []);

  useEffect(() => {
    if (!business?.id) return;
    bookingSettingsService.setBusinessId(business.id);
    bookingSettingsService.getBookingResources()
      .then((rows) => setBookingResources(rows || []))
      .catch(() => setBookingResources([]));
  }, [business?.id]);

  useEffect(() => {
    setFormData(buildScreenFormData(screen));
  }, [screen?.id]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);

    try {
      await onSubmit({
        name: formData.name,
        type: formData.type,
        locationName: formData.locationName || null,
        resolutionWidth: formData.resolutionWidth ? parseInt(formData.resolutionWidth) : null,
        resolutionHeight: formData.resolutionHeight ? parseInt(formData.resolutionHeight) : null,
        orientation: formData.orientation,
        groupId: formData.groupId || null,
        settings: {
          ...formData.settings,
          contentFit: formData.contentFit,
          bookingResourceCategoryId: formData.bookingResourceCategoryId || null,
          bookingResourceId: formData.bookingResourceId || null,
          bookingOverrideScheduleId: formData.bookingOverrideScheduleId || null
        }
      });
    } catch (err) {
      console.error('Error submitting form:', err);
    } finally {
      setLoading(false);
    }
  };

  const styles = getDigitalSignageModalStyles({ maxWidth: '520px' });

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={styles.header}>
          <div style={styles.headerText}>
            <h2 style={styles.title}>{isEdit ? 'Edit Screen' : 'Register New Screen'}</h2>
          </div>
          <button type="button" style={styles.closeButton} onClick={onClose} aria-label="Close">
            <FiX />
          </button>
        </div>

        <div style={styles.body}>
          <form style={styles.form} onSubmit={handleSubmit}>
            <div style={styles.formGroup}>
              <label style={styles.label}>Screen Name *</label>
              <input
                style={styles.input}
                type="text"
                required
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="Main Display"
              />
            </div>

            <div style={styles.formGroup}>
              <label style={styles.label}>Screen Type</label>
              <select
                style={styles.select}
                value={formData.type}
                onChange={(e) => setFormData({ ...formData, type: e.target.value })}
              >
                <option value="standard">Standard</option>
                <option value="kiosk">Kiosk</option>
                <option value="video_wall">Video Wall</option>
              </select>
            </div>

            <div style={styles.formGroup}>
              <label style={styles.label}>Location Name</label>
              <input
                style={styles.input}
                type="text"
                value={formData.locationName}
                onChange={(e) => setFormData({ ...formData, locationName: e.target.value })}
                placeholder="Front Entrance"
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: TavariStyles.spacing.md }}>
              <div style={styles.formGroup}>
                <label style={styles.label}>Width (px)</label>
                <input
                  style={styles.input}
                  type="number"
                  value={formData.resolutionWidth}
                  onChange={(e) => setFormData({ ...formData, resolutionWidth: e.target.value })}
                  placeholder="1920"
                />
              </div>
              <div style={styles.formGroup}>
                <label style={styles.label}>Height (px)</label>
                <input
                  style={styles.input}
                  type="number"
                  value={formData.resolutionHeight}
                  onChange={(e) => setFormData({ ...formData, resolutionHeight: e.target.value })}
                  placeholder="1080"
                />
              </div>
            </div>

            <div style={styles.formGroup}>
              <label style={styles.label}>Orientation</label>
              <select
                style={styles.select}
                value={formData.orientation}
                onChange={(e) => setFormData({ ...formData, orientation: e.target.value })}
              >
                <option value="landscape">Landscape</option>
                <option value="portrait">Portrait</option>
              </select>
            </div>

            <div style={styles.formGroup}>
              <label style={styles.label}>Image / video fit</label>
              <select
                style={styles.select}
                value={formData.contentFit}
                onChange={(e) => setFormData({ ...formData, contentFit: e.target.value })}
              >
                {SIGNAGE_CONTENT_FIT_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <p style={styles.helpText}>
                Use “Fit entire image” when your content resolution does not match the display — the full image scales to fit without cropping.
              </p>
            </div>

            <div style={styles.formGroup}>
              <label style={styles.label}>Screen Group</label>
              <select
                style={styles.select}
                value={formData.groupId || ''}
                onChange={(e) => setFormData({ ...formData, groupId: e.target.value || null })}
              >
                <option value="">None</option>
                {screenGroups.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.group_name}
                  </option>
                ))}
              </select>
            </div>

            <div style={styles.formGroup}>
              <label style={styles.label}>Booking room/resource</label>
              <select
                style={styles.select}
                value={
                  formData.bookingResourceCategoryId && formData.bookingResourceId
                    ? `${formData.bookingResourceCategoryId}::${formData.bookingResourceId}`
                    : ''
                }
                onChange={(e) => {
                  const [categoryId = '', resourceId = ''] = e.target.value.split('::');
                  setFormData({
                    ...formData,
                    bookingResourceCategoryId: categoryId,
                    bookingResourceId: resourceId
                  });
                }}
              >
                <option value="">No booking room mapping</option>
                {bookingResources.flatMap((category) => (
                  (category.resources || []).map((resource) => (
                    <option
                      key={`${category.categoryId}-${resource.id}`}
                      value={`${category.categoryId}::${resource.id}`}
                    >
                      {(category.name || category.categoryName || 'Resource')} - {resource.name}
                    </option>
                  ))
                ))}
              </select>
              <p style={styles.helpText}>
                When a booking assigned to this room is active, this screen can switch to the party host playlist and countdown.
              </p>
            </div>

            <div style={styles.formGroup}>
              <label style={styles.label}>Booking override playlist</label>
              <select
                style={styles.select}
                value={formData.bookingOverrideScheduleId || ''}
                onChange={(e) => setFormData({ ...formData, bookingOverrideScheduleId: e.target.value })}
              >
                <option value="">Use normal schedule during bookings</option>
                {schedules
                  .filter((schedule) => schedule.schedule_type !== 'waiver_kiosk')
                  .map((schedule) => (
                    <option key={schedule.id} value={schedule.id}>
                      {schedule.schedule_name}
                    </option>
                  ))}
              </select>
              <p style={styles.helpText}>
                When this screen's room has an active booking, this playlist overrides lower priority room/default signage.
              </p>
            </div>

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
                disabled={loading}
              >
                {loading ? 'Saving...' : isEdit ? 'Save Changes' : 'Register Screen'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default ScreenRegistrationModal;
