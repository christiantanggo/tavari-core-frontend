// src/components/DigitalSignage/ZoneFormModal.jsx
import React, { useEffect, useState } from 'react';
import { FiX } from 'react-icons/fi';
import { TavariStyles } from '../../utils/TavariStyles';
import { getDigitalSignageModalStyles } from './digitalSignageModalStyles';

function buildZoneFormData(zone) {
  return {
    name: zone?.zone_name || '',
    screenId: zone?.screen_id || null,
    positionX: zone?.position_x ?? 0,
    positionY: zone?.position_y ?? 0,
    width: zone?.width ?? 1920,
    height: zone?.height ?? 1080,
    positionUnit: zone?.position_unit || 'pixels',
    zIndex: zone?.z_index ?? 0,
    backgroundColor: zone?.background_color || null
  };
}

const ZoneFormModal = ({ onClose, onSubmit, screens = [], zone = null }) => {
  const isEdit = Boolean(zone?.id);
  const [formData, setFormData] = useState(() => buildZoneFormData(zone));
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setFormData(buildZoneFormData(zone));
  }, [zone?.id]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);

    try {
      await onSubmit({
        name: formData.name,
        screenId: formData.screenId || null,
        positionX: parseFloat(formData.positionX),
        positionY: parseFloat(formData.positionY),
        width: parseFloat(formData.width),
        height: parseFloat(formData.height),
        positionUnit: formData.positionUnit,
        zIndex: parseInt(formData.zIndex),
        backgroundColor: formData.backgroundColor || null
      });
    } catch (err) {
      console.error('Error submitting form:', err);
    } finally {
      setLoading(false);
    }
  };

  const styles = getDigitalSignageModalStyles({ maxWidth: '600px' });

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={styles.header}>
          <div style={styles.headerText}>
            <h2 style={styles.title}>{isEdit ? 'Edit Zone' : 'Create Zone'}</h2>
          </div>
          <button type="button" style={styles.closeButton} onClick={onClose} aria-label="Close">
            <FiX />
          </button>
        </div>

        <div style={styles.body}>
          <form style={styles.form} onSubmit={handleSubmit}>
            <div style={styles.formGroup}>
              <label style={styles.label}>Zone Name *</label>
              <input
                style={styles.input}
                type="text"
                required
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="Main Zone"
              />
            </div>

            <div style={styles.formGroup}>
              <label style={styles.label}>Screen</label>
              <select
                style={styles.select}
                value={formData.screenId || ''}
                onChange={(e) => setFormData({ ...formData, screenId: e.target.value || null })}
              >
                <option value="">No Screen (Global Zone)</option>
                {screens.map(screen => (
                  <option key={screen.id} value={screen.id}>
                    {screen.screen_name}
                  </option>
                ))}
              </select>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: TavariStyles.spacing.md }}>
              <div style={styles.formGroup}>
                <label style={styles.label}>X Position</label>
                <input
                  style={styles.input}
                  type="number"
                  value={formData.positionX}
                  onChange={(e) => setFormData({ ...formData, positionX: e.target.value })}
                  min="0"
                />
              </div>
              <div style={styles.formGroup}>
                <label style={styles.label}>Y Position</label>
                <input
                  style={styles.input}
                  type="number"
                  value={formData.positionY}
                  onChange={(e) => setFormData({ ...formData, positionY: e.target.value })}
                  min="0"
                />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: TavariStyles.spacing.md }}>
              <div style={styles.formGroup}>
                <label style={styles.label}>Width *</label>
                <input
                  style={styles.input}
                  type="number"
                  required
                  value={formData.width}
                  onChange={(e) => setFormData({ ...formData, width: e.target.value })}
                  min="1"
                />
              </div>
              <div style={styles.formGroup}>
                <label style={styles.label}>Height *</label>
                <input
                  style={styles.input}
                  type="number"
                  required
                  value={formData.height}
                  onChange={(e) => setFormData({ ...formData, height: e.target.value })}
                  min="1"
                />
              </div>
            </div>

            <div style={styles.formGroup}>
              <label style={styles.label}>Position Unit</label>
              <select
                style={styles.select}
                value={formData.positionUnit}
                onChange={(e) => setFormData({ ...formData, positionUnit: e.target.value })}
              >
                <option value="pixels">Pixels</option>
                <option value="percent">Percent</option>
              </select>
            </div>

            <div style={styles.formGroup}>
              <label style={styles.label}>Z-Index</label>
              <input
                style={styles.input}
                type="number"
                value={formData.zIndex}
                onChange={(e) => setFormData({ ...formData, zIndex: e.target.value })}
                min="0"
              />
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
                {loading ? 'Saving...' : isEdit ? 'Save Changes' : 'Create Zone'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default ZoneFormModal;
