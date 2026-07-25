// src/components/DigitalSignage/AdFormModal.jsx
import React, { useState } from 'react';
import { FiX } from 'react-icons/fi';
import { TavariStyles } from '../../utils/TavariStyles';
import TavariCheckbox from '../UI/TavariCheckbox';
import { getDigitalSignageModalStyles } from './digitalSignageModalStyles';

const AdFormModal = ({ onClose, onSubmit }) => {
  const [formData, setFormData] = useState({
    name: '',
    isActive: true
  });
  const [selectedFile, setSelectedFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [loading, setLoading] = useState(false);

  const handleFileChange = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setSelectedFile(file);
    setPreviewUrl(URL.createObjectURL(file));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!selectedFile) return;

    setLoading(true);
    try {
      await onSubmit({
        name: formData.name.trim(),
        isActive: formData.isActive,
        file: selectedFile
      });
    } catch (err) {
      console.error('Error submitting form:', err);
    } finally {
      setLoading(false);
    }
  };

  const base = getDigitalSignageModalStyles({ maxWidth: '620px' });
  const styles = {
    ...base,
    fileInput: {
      fontSize: TavariStyles.typography.fontSize.base,
      width: '100%'
    },
    previewWrapper: {
      border: `1px solid ${TavariStyles.colors.gray200}`,
      borderRadius: TavariStyles.borderRadius.md,
      backgroundColor: TavariStyles.colors.gray50,
      padding: TavariStyles.spacing.md
    },
    previewImage: {
      width: '100%',
      maxHeight: '260px',
      objectFit: 'contain',
      borderRadius: TavariStyles.borderRadius.sm,
      backgroundColor: TavariStyles.colors.white
    }
  };

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={styles.header}>
          <div style={styles.headerText}>
            <h2 style={styles.title}>Upload Kiosk Image</h2>
          </div>
          <button type="button" style={styles.closeButton} onClick={onClose} aria-label="Close">
            <FiX />
          </button>
        </div>

        <div style={styles.body}>
          <form style={styles.form} onSubmit={handleSubmit}>
            <div style={styles.formGroup}>
              <label style={styles.label}>Image Name *</label>
              <input
                style={styles.input}
                type="text"
                required
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="Spring Break Promo"
              />
            </div>

            <div style={styles.formGroup}>
              <label style={styles.label}>Image File *</label>
              <input
                style={styles.fileInput}
                type="file"
                accept="image/*"
                required
                onChange={handleFileChange}
              />
              <p style={styles.helpText}>
                Upload the image you want shown on the waiver kiosks between guest uses.
              </p>
            </div>

            {previewUrl ? (
              <div style={styles.previewWrapper}>
                <img src={previewUrl} alt="Preview" style={styles.previewImage} />
              </div>
            ) : null}

            <div style={styles.formGroup}>
              <TavariCheckbox
                id="kiosk-ad-active"
                checked={formData.isActive}
                onChange={(checked) => setFormData({ ...formData, isActive: checked })}
                label="Show this image on kiosks right away"
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
                disabled={loading || !selectedFile}
              >
                {loading ? 'Uploading...' : 'Upload Image'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default AdFormModal;
