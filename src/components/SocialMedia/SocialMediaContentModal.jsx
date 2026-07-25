// components/SocialMedia/SocialMediaContentModal.jsx
// Modal for adding/editing content sources
import React, { useState, useEffect } from 'react';
import { X, Save, Upload, Image as ImageIcon, Trash2 } from 'lucide-react';
import { supabase } from '../../supabaseClient';
import { TavariStyles } from '../../utils/TavariStyles';
import TavariCheckbox from '../UI/TavariCheckbox';
import toast from 'react-hot-toast';

const SocialMediaContentModal = ({ isOpen, onClose, onSave, businessId, content }) => {
  const [saving, setSaving] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [formData, setFormData] = useState({
    sourceType: 'product',
    sourceId: '',
    title: '',
    description: '',
    imageUrls: [],
    url: '',
    canPost: true,
    priority: 0,
    status: 'active',
  });

  useEffect(() => {
    if (content) {
      setFormData({
        sourceType: content.source_type,
        sourceId: content.source_id,
        title: content.title,
        description: content.description || '',
        imageUrls: content.image_urls || [],
        url: content.url || '',
        canPost: content.can_post,
        priority: content.priority || 0,
        status: content.status || 'active',
      });
    } else {
      setFormData({
        sourceType: 'product',
        sourceId: '',
        title: '',
        description: '',
        imageUrls: [],
        url: '',
        canPost: true,
        priority: 0,
        status: 'active',
      });
    }
  }, [content, isOpen]);

  const handleSave = async () => {
    if (!formData.title || !formData.sourceId) {
      toast.error('Title and Source ID are required');
      return;
    }

    setSaving(true);
    try {
      const dataToSave = {
        business_id: businessId,
        source_type: formData.sourceType,
        source_id: formData.sourceId,
        title: formData.title,
        description: formData.description || null,
        image_urls: formData.imageUrls.filter(url => url.trim()),
        url: formData.url || null,
        can_post: formData.canPost,
        priority: formData.priority || 0,
        status: formData.status,
        updated_at: new Date().toISOString(),
      };

      if (content) {
        const { error } = await supabase
          .from('content_sources')
          .update(dataToSave)
          .eq('id', content.id);

        if (error) throw error;
        toast.success('Content source updated');
      } else {
        const { error } = await supabase
          .from('content_sources')
          .insert(dataToSave);

        if (error) throw error;
        toast.success('Content source created');
      }

      if (onSave) onSave();
    } catch (error) {
      console.error('Error saving content source:', error);
      toast.error('Failed to save content source: ' + (error.message || 'Unknown error'));
    } finally {
      setSaving(false);
    }
  };

  const addImageUrl = () => {
    setFormData({
      ...formData,
      imageUrls: [...formData.imageUrls, ''],
    });
  };

  const updateImageUrl = (index, value) => {
    const newUrls = [...formData.imageUrls];
    newUrls[index] = value;
    setFormData({ ...formData, imageUrls: newUrls });
  };

  const removeImageUrl = (index) => {
    const newUrls = formData.imageUrls.filter((_, i) => i !== index);
    setFormData({ ...formData, imageUrls: newUrls });
  };

  const handleImageUpload = async (file) => {
    if (!file.type.startsWith('image/')) {
      toast.error('Please select an image file.');
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      toast.error('Image must be smaller than 10MB.');
      return;
    }

    setUploadingImage(true);
    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `social-media/${businessId}/${Date.now()}-${Math.random().toString(36).substring(2)}.${fileExt}`;

      // Upload to Supabase Storage (using 'social-media-images' bucket)
      const { data, error } = await supabase.storage
        .from('social-media-images')
        .upload(fileName, file, {
          cacheControl: '3600',
          upsert: false
        });

      if (error) throw error;

      // Get public URL
      const { data: urlData } = supabase.storage
        .from('social-media-images')
        .getPublicUrl(fileName);

      const imageUrl = urlData.publicUrl;

      // Add to imageUrls array
      setFormData({
        ...formData,
        imageUrls: [...formData.imageUrls, imageUrl]
      });

      toast.success('Image uploaded successfully');
    } catch (error) {
      console.error('Error uploading image:', error);
      toast.error('Failed to upload image: ' + (error.message || 'Unknown error'));
    } finally {
      setUploadingImage(false);
    }
  };

  const handleFileSelect = (event) => {
    const file = event.target.files[0];
    if (file) {
      handleImageUpload(file);
    }
  };

  const handleDrop = (event) => {
    event.preventDefault();
    const files = event.dataTransfer.files;
    if (files.length > 0) {
      handleImageUpload(files[0]);
    }
  };

  const handleDragOver = (event) => {
    event.preventDefault();
  };

  if (!isOpen) return null;

  const styles = {
    overlay: {
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000,
      padding: TavariStyles.spacing.lg,
    },
    modal: {
      backgroundColor: TavariStyles.colors.white,
      borderRadius: TavariStyles.borderRadius?.lg || '12px',
      width: '100%',
      maxWidth: '600px',
      maxHeight: '90vh',
      overflowY: 'auto',
      boxShadow: TavariStyles.shadows?.xl || '0 20px 25px -5px rgba(0,0,0,0.1)',
    },
    header: {
      padding: TavariStyles.spacing.xl,
      borderBottom: `1px solid ${TavariStyles.colors.gray200}`,
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    title: {
      fontSize: TavariStyles.typography.fontSize.xl,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.gray900,
    },
    closeButton: {
      background: 'none',
      border: 'none',
      cursor: 'pointer',
      padding: '4px',
      color: TavariStyles.colors.gray600,
    },
    content: {
      padding: TavariStyles.spacing.xl,
    },
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
    textarea: {
      width: '100%',
      padding: `${TavariStyles.spacing.sm} ${TavariStyles.spacing.md}`,
      border: `1px solid ${TavariStyles.colors.gray300}`,
      borderRadius: TavariStyles.borderRadius?.md || '8px',
      fontSize: TavariStyles.typography.fontSize.base,
      boxSizing: 'border-box',
      minHeight: '100px',
      resize: 'vertical',
      fontFamily: 'inherit',
    },
    checkbox: {
      display: 'flex',
      alignItems: 'center',
      gap: TavariStyles.spacing.sm,
    },
    checkboxInput: {
      width: '18px',
      height: '18px',
      cursor: 'pointer',
    },
    imageUrlRow: {
      display: 'flex',
      gap: TavariStyles.spacing.sm,
      marginBottom: TavariStyles.spacing.xs,
    },
    addImageButton: {
      padding: `${TavariStyles.spacing.xs} ${TavariStyles.spacing.sm}`,
      border: `1px solid ${TavariStyles.colors.gray300}`,
      borderRadius: TavariStyles.borderRadius?.md || '8px',
      backgroundColor: TavariStyles.colors.white,
      color: TavariStyles.colors.gray700,
      cursor: 'pointer',
      fontSize: TavariStyles.typography.fontSize.sm,
    },
    removeButton: {
      padding: `${TavariStyles.spacing.xs} ${TavariStyles.spacing.sm}`,
      border: `1px solid ${TavariStyles.colors.red || '#dc2626'}`,
      borderRadius: TavariStyles.borderRadius?.md || '8px',
      backgroundColor: 'transparent',
      color: TavariStyles.colors.red || '#dc2626',
      cursor: 'pointer',
      fontSize: TavariStyles.typography.fontSize.sm,
    },
    uploadArea: {
      border: `2px dashed ${TavariStyles.colors.gray300}`,
      borderRadius: TavariStyles.borderRadius?.md || '8px',
      padding: TavariStyles.spacing.lg,
      textAlign: 'center',
      cursor: 'pointer',
      transition: 'all 0.2s ease',
      backgroundColor: TavariStyles.colors.gray50 || '#f9fafb',
      marginBottom: TavariStyles.spacing.md,
    },
    uploading: {
      opacity: 0.7,
      cursor: 'not-allowed',
    },
    fileInput: {
      display: 'none',
    },
    uploadLabel: {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: TavariStyles.spacing.xs,
      cursor: 'pointer',
      color: TavariStyles.colors.gray700,
    },
    uploadSubtext: {
      fontSize: TavariStyles.typography.fontSize.xs,
      color: TavariStyles.colors.gray500,
    },
    spinningIcon: {
      animation: 'spin 1s linear infinite',
    },
    imagePreviewGrid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
      gap: TavariStyles.spacing.sm,
      marginTop: TavariStyles.spacing.md,
    },
    imagePreviewContainer: {
      position: 'relative',
      borderRadius: TavariStyles.borderRadius?.md || '8px',
      overflow: 'hidden',
      border: `1px solid ${TavariStyles.colors.gray200}`,
      aspectRatio: '1',
    },
    imagePreview: {
      width: '100%',
      height: '100%',
      objectFit: 'cover',
    },
    removeImageButton: {
      position: 'absolute',
      top: '4px',
      right: '4px',
      backgroundColor: 'rgba(0, 0, 0, 0.7)',
      color: TavariStyles.colors.white,
      border: 'none',
      borderRadius: '50%',
      width: '24px',
      height: '24px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      cursor: 'pointer',
      padding: 0,
    },
    footer: {
      padding: TavariStyles.spacing.xl,
      borderTop: `1px solid ${TavariStyles.colors.gray200}`,
      display: 'flex',
      justifyContent: 'flex-end',
      gap: TavariStyles.spacing.md,
    },
    cancelButton: {
      padding: `${TavariStyles.spacing.md} ${TavariStyles.spacing.xl}`,
      border: `1px solid ${TavariStyles.colors.gray300}`,
      borderRadius: TavariStyles.borderRadius?.md || '8px',
      backgroundColor: TavariStyles.colors.white,
      color: TavariStyles.colors.gray700,
      cursor: 'pointer',
      fontSize: TavariStyles.typography.fontSize.base,
      fontWeight: TavariStyles.typography.fontWeight.medium,
    },
    saveButton: {
      padding: `${TavariStyles.spacing.md} ${TavariStyles.spacing.xl}`,
      border: 'none',
      borderRadius: TavariStyles.borderRadius?.md || '8px',
      backgroundColor: TavariStyles.colors.primary,
      color: TavariStyles.colors.white,
      cursor: saving ? 'not-allowed' : 'pointer',
      fontSize: TavariStyles.typography.fontSize.base,
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      opacity: saving ? 0.6 : 1,
      display: 'flex',
      alignItems: 'center',
      gap: TavariStyles.spacing.sm,
    },
  };

  return (
    <div style={styles.overlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={styles.header}>
          <h2 style={styles.title}>
            {content ? 'Edit Content Source' : 'Add Content Source'}
          </h2>
          <button onClick={onClose} style={styles.closeButton}>
            <X size={24} />
          </button>
        </div>

        <div style={styles.content}>
          <div style={styles.formGroup}>
            <label style={styles.label}>Source Type *</label>
            <select
              value={formData.sourceType}
              onChange={(e) => setFormData({ ...formData, sourceType: e.target.value })}
              style={styles.input}
            >
              <option value="product">Product</option>
              <option value="deal">Deal</option>
              <option value="blog_post">Blog Post</option>
              <option value="event">Event</option>
              <option value="announcement">Announcement</option>
              <option value="other">Other</option>
            </select>
          </div>

          <div style={styles.formGroup}>
            <label style={styles.label}>Source ID *</label>
            <input
              type="text"
              value={formData.sourceId}
              onChange={(e) => setFormData({ ...formData, sourceId: e.target.value })}
              style={styles.input}
              placeholder="Unique identifier from source system"
            />
          </div>

          <div style={styles.formGroup}>
            <label style={styles.label}>Title *</label>
            <input
              type="text"
              value={formData.title}
              onChange={(e) => setFormData({ ...formData, title: e.target.value })}
              style={styles.input}
              placeholder="Content title"
            />
          </div>

          <div style={styles.formGroup}>
            <label style={styles.label}>Description</label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              style={styles.textarea}
              placeholder="Content description"
            />
          </div>

          <div style={styles.formGroup}>
            <label style={styles.label}>Images *</label>
            <p style={{ fontSize: '13px', color: TavariStyles.colors.gray500, marginBottom: '8px' }}>
              Instagram requires at least one image. Upload images or add image URLs.
            </p>
            
            {/* Image Upload Area */}
            <div
              style={{
                ...styles.uploadArea,
                ...(uploadingImage ? styles.uploading : {})
              }}
              onDrop={handleDrop}
              onDragOver={handleDragOver}
            >
              <input
                type="file"
                accept="image/*"
                onChange={handleFileSelect}
                style={styles.fileInput}
                id="image-upload-input"
                disabled={uploadingImage}
              />
              <label htmlFor="image-upload-input" style={styles.uploadLabel}>
                {uploadingImage ? (
                  <>
                    <Upload size={20} style={styles.spinningIcon} />
                    <span>Uploading...</span>
                  </>
                ) : (
                  <>
                    <ImageIcon size={20} />
                    <span>Click to upload or drag & drop</span>
                    <span style={styles.uploadSubtext}>PNG, JPG, GIF up to 10MB</span>
                  </>
                )}
              </label>
            </div>

            {/* Image Previews */}
            {formData.imageUrls.length > 0 && (
              <div style={styles.imagePreviewGrid}>
                {formData.imageUrls.map((url, index) => (
                  <div key={index} style={styles.imagePreviewContainer}>
                    <img src={url} alt={`Preview ${index + 1}`} style={styles.imagePreview} />
                    <button
                      type="button"
                      onClick={() => removeImageUrl(index)}
                      style={styles.removeImageButton}
                      title="Remove image"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Manual URL Input */}
            <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: `1px solid ${TavariStyles.colors.gray200}` }}>
              <button
                type="button"
                onClick={addImageUrl}
                style={styles.addImageButton}
              >
                + Add Image URL Manually
              </button>
              {formData.imageUrls.some((url, idx) => !url || url.trim() === '') && (
                <div style={{ marginTop: '8px' }}>
                  {formData.imageUrls.map((url, index) => {
                    if (url && url.trim() !== '') return null;
                    return (
                      <div key={`url-${index}`} style={styles.imageUrlRow}>
                        <input
                          type="url"
                          value={url || ''}
                          onChange={(e) => updateImageUrl(index, e.target.value)}
                          style={{ ...styles.input, flex: 1 }}
                          placeholder="https://example.com/image.jpg"
                        />
                        <button
                          type="button"
                          onClick={() => removeImageUrl(index)}
                          style={styles.removeButton}
                        >
                          Remove
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <div style={styles.formGroup}>
            <label style={styles.label}>URL</label>
            <input
              type="url"
              value={formData.url}
              onChange={(e) => setFormData({ ...formData, url: e.target.value })}
              style={styles.input}
              placeholder="https://example.com/content"
            />
          </div>

          <div style={styles.formGroup}>
            <label style={styles.label}>Priority</label>
            <input
              type="number"
              value={formData.priority}
              onChange={(e) => setFormData({ ...formData, priority: parseInt(e.target.value) || 0 })}
              style={styles.input}
              placeholder="0"
            />
            <div style={{ fontSize: '13px', color: TavariStyles.colors.gray500, marginTop: '4px' }}>
              Higher priority content is posted first
            </div>
          </div>

          <div style={styles.formGroup}>
            <TavariCheckbox
              checked={formData.canPost}
              onChange={(checked) => setFormData({ ...formData, canPost: checked })}
              label="Can Post to Social Media"
              disabled={saving}
            />
          </div>

          <div style={styles.formGroup}>
            <label style={styles.label}>Status</label>
            <select
              value={formData.status}
              onChange={(e) => setFormData({ ...formData, status: e.target.value })}
              style={styles.input}
            >
              <option value="active">Active</option>
              <option value="archived">Archived</option>
              <option value="hidden">Hidden</option>
            </select>
          </div>
        </div>

        <div style={styles.footer}>
          <button onClick={onClose} style={styles.cancelButton}>
            Cancel
          </button>
          <button onClick={handleSave} disabled={saving} style={styles.saveButton}>
            <Save size={18} />
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default SocialMediaContentModal;

// Add spinner animation
if (typeof document !== 'undefined' && !document.querySelector('#social-media-upload-styles')) {
  const styleSheet = document.createElement('style');
  styleSheet.id = 'social-media-upload-styles';
  styleSheet.textContent = `
    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
  `;
  document.head.appendChild(styleSheet);
}

