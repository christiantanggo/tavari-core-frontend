// src/screens/DigitalSignage/ContentLibraryScreen.jsx
import React, { useState, useEffect } from 'react';
import { FiUpload, FiImage, FiVideo, FiFileText, FiSearch, FiFilter, FiTrash2, FiEdit, FiEye } from 'react-icons/fi';
import { TavariStyles } from '../../utils/TavariStyles';
import POSAuthWrapper from '../../components/Auth/POSAuthWrapper';
import { SecurityWrapper } from '../../Security';
import { usePOSAuth } from '../../hooks/usePOSAuth';
import { usePermissions } from '../../hooks/usePermissions';
import PermissionGate from '../../components/Auth/PermissionGate';
import toast from 'react-hot-toast';
import useDigitalSignage from '../../hooks/useDigitalSignage';
import ContentUploadModal from '../../components/DigitalSignage/ContentUploadModal';
import ContentPreviewModal from '../../components/DigitalSignage/ContentPreviewModal';
import ContentEditModal from '../../components/DigitalSignage/ContentEditModal';
import { resolveDigitalSignagePreviewUrlMap } from '../../utils/digitalSignageContentUrl';
import {
  formatContentPlayDateLabel,
  getContentPlayDateStatus,
  toDateInputValue
} from '../../utils/signageContentDates';

const ContentLibraryScreen = ({ embedded = false }) => {
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [selectedContent, setSelectedContent] = useState(null);
  const [previewContent, setPreviewContent] = useState(null);
  const [thumbByContentId, setThumbByContentId] = useState({});
  const [filters, setFilters] = useState({
    contentType: '',
    search: '',
    tags: []
  });

  const auth = usePOSAuth({
    requiredRoles: ['manager', 'owner'],
    requireBusiness: true,
    componentName: 'ContentLibraryScreen'
  });

  const { hasPermission, hasElevatedPrivileges } = usePermissions();

  const {
    content,
    loading,
    error,
    loadContent,
    uploadContent,
    deleteContent,
    updateContent
  } = useDigitalSignage();

  useEffect(() => {
    if (auth.selectedBusinessId) {
      loadContent(filters);
    }
  }, [auth.selectedBusinessId, filters]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const next = await resolveDigitalSignagePreviewUrlMap(content);
      if (!cancelled) setThumbByContentId(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [content]);

  const canUpload = hasPermission('digital_signage.content.edit') || hasElevatedPrivileges();
  const canEdit = hasPermission('digital_signage.content.edit') || hasElevatedPrivileges();
  const canDelete = hasPermission('digital_signage.content.edit') || hasElevatedPrivileges();

  const handleUpload = async (file, metadata) => {
    try {
      await uploadContent(file, metadata, (progress) => {
        console.log(`Upload progress: ${progress}%`);
      });
      setShowUploadModal(false);
      toast.success('Content uploaded successfully');
    } catch (err) {
      toast.error(`Upload failed: ${err.message}`);
    }
  };

  const handleDelete = async (contentId) => {
    if (!window.confirm('Are you sure you want to delete this content?')) {
      return;
    }

    try {
      await deleteContent(contentId);
      toast.success('Content deleted successfully');
    } catch (err) {
      toast.error(`Failed to delete content: ${err.message}`);
    }
  };

  const handleUpdateContent = async (updates) => {
    if (!selectedContent?.id) return;
    try {
      await updateContent(selectedContent.id, {
        content_name: updates.name,
        description: updates.description,
        play_start_date: updates.play_start_date ?? null,
        play_end_date: updates.play_end_date ?? null
      });
      setSelectedContent(null);
    } catch (err) {
      toast.error(`Failed to update content: ${err.message}`);
    }
  };

  const getContentIcon = (contentType) => {
    switch (contentType) {
      case 'image':
        return <FiImage />;
      case 'video':
        return <FiVideo />;
      case 'html':
        return <FiFileText />;
      default:
        return <FiFileText />;
    }
  };

  const formatFileSize = (bytes) => {
    if (!bytes) return 'N/A';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  const todayLocal = toDateInputValue(new Date().toISOString());

  const getPlayDateStatusStyle = (status) => {
    if (status === 'active') return { color: TavariStyles.colors.success || '#059669' };
    if (status === 'scheduled') return { color: TavariStyles.colors.warning || '#d97706' };
    return { color: TavariStyles.colors.gray500 };
  };

  const styles = {
    container: {
      ...TavariStyles.layouts.container,
      padding: embedded ? 0 : TavariStyles.spacing.xl,
      paddingTop: embedded ? 0 : undefined
    },
    header: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: TavariStyles.spacing.xl
    },
    title: {
      ...TavariStyles.typography.heading.h1
    },
    button: {
      ...TavariStyles.components.button.primary,
      display: 'flex',
      alignItems: 'center',
      gap: TavariStyles.spacing.sm
    },
    filters: {
      display: 'flex',
      gap: TavariStyles.spacing.md,
      marginBottom: TavariStyles.spacing.lg,
      padding: TavariStyles.spacing.md,
      backgroundColor: TavariStyles.colors.gray50,
      borderRadius: TavariStyles.borderRadius.md
    },
    filterInput: {
      ...TavariStyles.components.input,
      flex: 1,
      padding: TavariStyles.spacing.sm
    },
    filterSelect: {
      ...TavariStyles.components.input,
      padding: TavariStyles.spacing.sm,
      minWidth: '150px'
    },
    grid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))',
      gap: TavariStyles.spacing.lg
    },
    card: {
      ...TavariStyles.components.card,
      padding: TavariStyles.spacing.md,
      cursor: 'pointer',
      transition: 'transform 0.2s, box-shadow 0.2s'
    },
    cardImage: {
      width: '100%',
      height: '150px',
      objectFit: 'cover',
      borderRadius: TavariStyles.borderRadius.sm,
      marginBottom: TavariStyles.spacing.sm,
      backgroundColor: TavariStyles.colors.gray100
    },
    cardTitle: {
      ...TavariStyles.typography.heading.h4,
      marginBottom: TavariStyles.spacing.xs,
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap'
    },
    cardMeta: {
      ...TavariStyles.typography.body,
      fontSize: TavariStyles.typography.fontSize.sm,
      color: TavariStyles.colors.gray600,
      marginBottom: TavariStyles.spacing.xs
    },
    cardActions: {
      display: 'flex',
      gap: TavariStyles.spacing.sm,
      marginTop: TavariStyles.spacing.md
    },
    actionButton: {
      ...TavariStyles.components.button.secondary,
      padding: `${TavariStyles.spacing.xs} ${TavariStyles.spacing.sm}`,
      fontSize: TavariStyles.typography.fontSize.sm
    },
    emptyState: {
      textAlign: 'center',
      padding: TavariStyles.spacing['4xl'],
      color: TavariStyles.colors.gray600
    }
  };

  const contentView = (
    <div style={styles.container}>
            <div style={styles.header}>
              <h1 style={styles.title}>
                <FiImage style={{ marginRight: TavariStyles.spacing.sm, verticalAlign: 'middle' }} />
                Content Library
              </h1>
              {canUpload && (
                <button
                  style={styles.button}
                  onClick={() => setShowUploadModal(true)}
                >
                  <FiUpload /> Upload Content
                </button>
              )}
            </div>

            <div style={styles.filters}>
              <input
                style={styles.filterInput}
                type="text"
                placeholder="Search content..."
                value={filters.search}
                onChange={(e) => setFilters({ ...filters, search: e.target.value })}
              />
              <select
                style={styles.filterSelect}
                value={filters.contentType}
                onChange={(e) => setFilters({ ...filters, contentType: e.target.value })}
              >
                <option value="">All Types</option>
                <option value="image">Images</option>
                <option value="video">Videos</option>
                <option value="html">HTML</option>
                <option value="widget">Widgets</option>
              </select>
            </div>

            {loading && <div>Loading content...</div>}
            {error && <div style={{ color: TavariStyles.colors.danger }}>Error: {error}</div>}

            {!loading && content.length === 0 && (
              <div style={styles.emptyState}>
                <FiImage size={64} style={{ marginBottom: TavariStyles.spacing.lg, opacity: 0.3 }} />
                <h3>No content uploaded</h3>
                <p>Upload your first content item to get started</p>
                {canUpload && (
                  <button
                    style={{ ...styles.button, marginTop: TavariStyles.spacing.lg }}
                    onClick={() => setShowUploadModal(true)}
                  >
                    <FiUpload /> Upload Content
                  </button>
                )}
              </div>
            )}

            {!loading && content.length > 0 && (
              <div style={styles.grid}>
                {content.map((item) => (
                  <div key={item.id} style={styles.card}>
                    {item.content_type === 'image' && thumbByContentId[item.id] ? (
                      <img
                        src={thumbByContentId[item.id]}
                        alt={item.content_name}
                        style={styles.cardImage}
                      />
                    ) : null}
                    {item.content_type === 'video' && (
                      <div style={{ ...styles.cardImage, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <FiVideo size={48} style={{ color: TavariStyles.colors.gray400 }} />
                      </div>
                    )}
                    {item.content_type !== 'video' &&
                    !(item.content_type === 'image' && thumbByContentId[item.id]) ? (
                      <div style={{ ...styles.cardImage, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        {getContentIcon(item.content_type)}
                      </div>
                    ) : null}

                    <h3 style={styles.cardTitle}>{item.content_name}</h3>
                    <div style={styles.cardMeta}>
                      <div>{item.content_type}</div>
                      <div style={getPlayDateStatusStyle(getContentPlayDateStatus(item, todayLocal))}>
                        {formatContentPlayDateLabel(item)}
                        {getContentPlayDateStatus(item, todayLocal) === 'scheduled' ? ' (upcoming)' : ''}
                        {getContentPlayDateStatus(item, todayLocal) === 'expired' ? ' (expired)' : ''}
                      </div>
                      {item.file_size && <div>{formatFileSize(item.file_size)}</div>}
                      {item.width && item.height && (
                        <div>{item.width} × {item.height}</div>
                      )}
                    </div>

                    {(canEdit || canDelete) && (
                      <div style={styles.cardActions}>
                        {canEdit && (
                          <button
                            style={styles.actionButton}
                            onClick={() => setSelectedContent(item)}
                          >
                            <FiEdit /> Edit
                          </button>
                        )}
                        {canDelete && (
                          <button
                            style={{ ...styles.actionButton, color: TavariStyles.colors.danger }}
                            onClick={() => handleDelete(item.id)}
                          >
                            <FiTrash2 /> Delete
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {showUploadModal && (
              <ContentUploadModal
                onClose={() => setShowUploadModal(false)}
                onSubmit={handleUpload}
              />
            )}

            {selectedContent && (
              <ContentEditModal
                content={selectedContent}
                onClose={() => setSelectedContent(null)}
                onSubmit={handleUpdateContent}
              />
            )}

            {previewContent && (
              <ContentPreviewModal
                content={previewContent}
                onClose={() => setPreviewContent(null)}
              />
            )}
    </div>
  );

  if (embedded) {
    return contentView;
  }

  return (
    <SecurityWrapper>
      <POSAuthWrapper>
        <PermissionGate permission="digital_signage.content.view">
          {contentView}
        </PermissionGate>
      </POSAuthWrapper>
    </SecurityWrapper>
  );
};

export default ContentLibraryScreen;

