// src/components/DigitalSignage/PartyHostFormModal.jsx
import React, { useState } from 'react';
import { FiX } from 'react-icons/fi';
import { TavariStyles } from '../../utils/TavariStyles';
import TavariCheckbox from '../UI/TavariCheckbox';
import { getDigitalSignageModalStyles } from './digitalSignageModalStyles';

const PartyHostFormModal = ({ onClose, onSubmit, host = null, screens = [], events = [] }) => {
  const [formData, setFormData] = useState({
    name: host?.host_name || '',
    screenId: host?.screen_id || '',
    eventId: host?.scheduling_event_id || '',
    themeColor: host?.theme_color || '#FF6B9D',
    backgroundColor: host?.background_color || '#FFFFFF',
    backgroundImageUrl: host?.background_image_url || '',
    fontFamily: host?.font_family || 'Arial',
    showCountdown: host?.show_countdown !== undefined ? host.show_countdown : true,
    countdownTargetTime: host?.countdown_target_time || '',
    countdownLabel: host?.countdown_label || 'Time Remaining',
    allowPhotoUploads: host?.allow_photo_uploads !== undefined ? host.allow_photo_uploads : true,
    maxPhotos: host?.max_photos || 20,
    photoDisplayDuration: host?.photo_display_duration_seconds || 5
  });
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);

    try {
      await onSubmit({
        name: formData.name,
        screenId: formData.screenId || null,
        eventId: formData.eventId || null,
        themeColor: formData.themeColor,
        backgroundColor: formData.backgroundColor,
        backgroundImageUrl: formData.backgroundImageUrl || null,
        fontFamily: formData.fontFamily,
        showCountdown: formData.showCountdown,
        countdownTargetTime: formData.countdownTargetTime || null,
        countdownLabel: formData.countdownLabel,
        allowPhotoUploads: formData.allowPhotoUploads,
        maxPhotos: parseInt(formData.maxPhotos),
        photoDisplayDuration: parseInt(formData.photoDisplayDuration)
      });
    } catch (err) {
      console.error('Error submitting form:', err);
    } finally {
      setLoading(false);
    }
  };

  const styles = getDigitalSignageModalStyles({ maxWidth: '700px' });

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={styles.header}>
          <div style={styles.headerText}>
            <h2 style={styles.title}>{host ? 'Edit Party Host' : 'Create Party Host'}</h2>
          </div>
          <button type="button" style={styles.closeButton} onClick={onClose} aria-label="Close">
            <FiX />
          </button>
        </div>

        <div style={styles.body}>
          <form style={styles.form} onSubmit={handleSubmit}>
            <div style={styles.formGroup}>
              <label style={styles.label}>Party Host Name *</label>
              <input
                style={styles.input}
                type="text"
                required
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="Birthday Party Host"
              />
            </div>

            <div style={styles.formGroup}>
              <label style={styles.label}>Screen</label>
              <select
                style={styles.select}
                value={formData.screenId}
                onChange={(e) => setFormData({ ...formData, screenId: e.target.value })}
              >
                <option value="">Select Screen</option>
                {screens.map(screen => (
                  <option key={screen.id} value={screen.id}>
                    {screen.screen_name}
                  </option>
                ))}
              </select>
            </div>

            <div style={styles.formGroup}>
              <label style={styles.label}>Connect to Booking Event</label>
              <select
                style={styles.select}
                value={formData.eventId}
                onChange={(e) => setFormData({ ...formData, eventId: e.target.value })}
              >
                <option value="">No Event (Manual)</option>
                {events.map(event => (
                  <option key={event.id} value={event.id}>
                    {event.event_name} - {new Date(event.event_date).toLocaleDateString()}
                  </option>
                ))}
              </select>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: TavariStyles.spacing.md }}>
              <div style={styles.formGroup}>
                <label style={styles.label}>Theme Color</label>
                <input
                  style={styles.input}
                  type="color"
                  value={formData.themeColor}
                  onChange={(e) => setFormData({ ...formData, themeColor: e.target.value })}
                />
              </div>
              <div style={styles.formGroup}>
                <label style={styles.label}>Background Color</label>
                <input
                  style={styles.input}
                  type="color"
                  value={formData.backgroundColor}
                  onChange={(e) => setFormData({ ...formData, backgroundColor: e.target.value })}
                />
              </div>
            </div>

            <div style={styles.formGroup}>
              <TavariCheckbox
                id="party-host-countdown"
                checked={formData.showCountdown}
                onChange={(checked) => setFormData({ ...formData, showCountdown: checked })}
                label="Show Countdown Timer"
              />
            </div>

            {formData.showCountdown && (
              <>
                <div style={styles.formGroup}>
                  <label style={styles.label}>Countdown Target Time</label>
                  <input
                    style={styles.input}
                    type="datetime-local"
                    value={formData.countdownTargetTime}
                    onChange={(e) => setFormData({ ...formData, countdownTargetTime: e.target.value })}
                  />
                </div>
                <div style={styles.formGroup}>
                  <label style={styles.label}>Countdown Label</label>
                  <input
                    style={styles.input}
                    type="text"
                    value={formData.countdownLabel}
                    onChange={(e) => setFormData({ ...formData, countdownLabel: e.target.value })}
                    placeholder="Time Remaining"
                  />
                </div>
              </>
            )}

            <div style={styles.formGroup}>
              <TavariCheckbox
                id="party-host-photos"
                checked={formData.allowPhotoUploads}
                onChange={(checked) => setFormData({ ...formData, allowPhotoUploads: checked })}
                label="Allow Photo Uploads"
              />
            </div>

            {formData.allowPhotoUploads && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: TavariStyles.spacing.md }}>
                <div style={styles.formGroup}>
                  <label style={styles.label}>Max Photos</label>
                  <input
                    style={styles.input}
                    type="number"
                    min="1"
                    max="100"
                    value={formData.maxPhotos}
                    onChange={(e) => setFormData({ ...formData, maxPhotos: e.target.value })}
                  />
                </div>
                <div style={styles.formGroup}>
                  <label style={styles.label}>Photo Display Duration (seconds)</label>
                  <input
                    style={styles.input}
                    type="number"
                    min="1"
                    max="30"
                    value={formData.photoDisplayDuration}
                    onChange={(e) => setFormData({ ...formData, photoDisplayDuration: e.target.value })}
                  />
                </div>
              </div>
            )}

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
                {loading ? 'Saving...' : (host ? 'Update' : 'Create')}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default PartyHostFormModal;
