// src/components/DigitalSignage/ContentPreviewModal.jsx
import React, { useEffect, useState } from 'react';
import { FiX } from 'react-icons/fi';
import { TavariStyles } from '../../utils/TavariStyles';
import { resolveDigitalSignagePreviewUrl } from '../../utils/digitalSignageContentUrl';
import { getDigitalSignagePreviewModalStyles } from './digitalSignageModalStyles';

const ContentPreviewModal = ({ content, onClose }) => {
  const [previewUrl, setPreviewUrl] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setPreviewUrl(null);
    if (!content) return undefined;

    (async () => {
      const url = await resolveDigitalSignagePreviewUrl(content);
      if (!cancelled) setPreviewUrl(url);
    })();

    return () => {
      cancelled = true;
    };
  }, [content?.id, content?.file_path, content?.file_url]);

  if (!content) return null;

  const styles = getDigitalSignagePreviewModalStyles();

  const renderPreview = () => {
    if (!previewUrl) {
      return (
        <div style={{ padding: TavariStyles.spacing['4xl'], textAlign: 'center', color: TavariStyles.colors.gray600 }}>
          Loading preview…
        </div>
      );
    }
    if (content.content_type === 'image') {
      return <img src={previewUrl} alt={content.content_name} style={styles.preview} />;
    }
    if (content.content_type === 'video') {
      return (
        <video controls style={styles.video}>
          <source src={previewUrl} type={content.mime_type} />
        </video>
      );
    }
    if (content.content_type === 'html') {
      return (
        <iframe
          src={previewUrl}
          style={{ width: '100%', height: '600px', border: 'none', borderRadius: TavariStyles.borderRadius.md }}
          title={content.content_name}
        />
      );
    }
    return (
      <div style={{ padding: TavariStyles.spacing['4xl'], textAlign: 'center', color: TavariStyles.colors.gray600 }}>
        Preview not available
      </div>
    );
  };

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <button type="button" style={styles.closeButton} onClick={onClose} aria-label="Close">
          <FiX />
        </button>
        <div style={styles.body}>
          <h2 style={styles.title}>{content.content_name}</h2>
          {renderPreview()}
          <div style={styles.meta}>
            <div style={styles.metaRow}><strong>Type:</strong> {content.content_type}</div>
            {content.file_size && (
              <div style={styles.metaRow}><strong>Size:</strong> {(content.file_size / 1024 / 1024).toFixed(2)} MB</div>
            )}
            {content.width && content.height && (
              <div style={styles.metaRow}><strong>Dimensions:</strong> {content.width} × {content.height}</div>
            )}
            {content.description && (
              <div style={styles.metaRow}><strong>Description:</strong> {content.description}</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ContentPreviewModal;
