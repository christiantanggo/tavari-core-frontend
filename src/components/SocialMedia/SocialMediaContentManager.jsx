// components/SocialMedia/SocialMediaContentManager.jsx
// Manage content sources for social media posting
import React, { useState, useEffect } from 'react';
import { Plus, Image, Link, Trash2, Edit2, Send } from 'lucide-react';
import { supabase } from '../../supabaseClient';
import { TavariStyles } from '../../utils/TavariStyles';
import { MultiBusinessSocialService } from '../../services/socialMedia/MultiBusinessSocialService';
import toast from 'react-hot-toast';
import SocialMediaContentModal from './SocialMediaContentModal';

const SocialMediaContentManager = ({ businessId }) => {
  const [contentSources, setContentSources] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingContent, setEditingContent] = useState(null);

  useEffect(() => {
    if (businessId) {
      loadContentSources();
    }
  }, [businessId]);

  const loadContentSources = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('content_sources')
        .select('*')
        .eq('business_id', businessId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setContentSources(data || []);
    } catch (error) {
      console.error('Error loading content sources:', error);
      toast.error('Failed to load content sources');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Are you sure you want to delete this content source?')) {
      return;
    }

    try {
      const { error } = await supabase
        .from('content_sources')
        .delete()
        .eq('id', id);

      if (error) throw error;
      toast.success('Content source deleted');
      loadContentSources();
    } catch (error) {
      console.error('Error deleting content source:', error);
      toast.error('Failed to delete content source');
    }
  };

  const handlePostNow = async (content) => {
    if (!content.image_urls || content.image_urls.length === 0) {
      toast.error('Instagram requires an image. Please add an image URL to this content.');
      return;
    }

    try {
      toast.loading('Posting to Instagram...');
      const socialService = new MultiBusinessSocialService();
      
      const contentSource = {
        title: content.title,
        description: content.description,
        imageUrls: content.image_urls,
        url: content.url,
        metadata: {
          sourceType: content.source_type,
          sourceId: content.source_id,
        },
      };

      const results = await socialService.postContent(businessId, contentSource, ['instagram']);
      
      toast.dismiss();
      
      if (results.instagram?.success) {
        toast.success(`Posted to Instagram! ${results.instagram.postUrl ? 'View post' : ''}`);
        if (results.instagram.postUrl) {
          window.open(results.instagram.postUrl, '_blank');
        }
      } else {
        toast.error(`Failed to post: ${results.instagram?.error || 'Unknown error'}`);
      }
    } catch (error) {
      toast.dismiss();
      console.error('Error posting:', error);
      toast.error('Failed to post: ' + (error.message || 'Unknown error'));
    }
  };

  const styles = {
    container: {
      backgroundColor: TavariStyles.colors.white,
      borderRadius: TavariStyles.borderRadius?.lg || '12px',
      padding: TavariStyles.spacing.xl,
      boxShadow: TavariStyles.shadows?.sm || '0 1px 3px rgba(0,0,0,0.1)',
    },
    header: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: TavariStyles.spacing.xl,
    },
    title: {
      fontSize: TavariStyles.typography.fontSize.lg,
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      color: TavariStyles.colors.gray900,
    },
    addButton: {
      display: 'flex',
      alignItems: 'center',
      gap: TavariStyles.spacing.sm,
      padding: `${TavariStyles.spacing.sm} ${TavariStyles.spacing.md}`,
      backgroundColor: TavariStyles.colors.primary,
      color: TavariStyles.colors.white,
      border: 'none',
      borderRadius: TavariStyles.borderRadius?.md || '8px',
      fontSize: TavariStyles.typography.fontSize.sm,
      fontWeight: TavariStyles.typography.fontWeight.medium,
      cursor: 'pointer',
    },
    contentGrid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
      gap: TavariStyles.spacing.md,
    },
    contentCard: {
      border: `1px solid ${TavariStyles.colors.gray200}`,
      borderRadius: TavariStyles.borderRadius?.md || '8px',
      padding: TavariStyles.spacing.md,
      backgroundColor: TavariStyles.colors.white,
    },
    contentHeader: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'start',
      marginBottom: TavariStyles.spacing.sm,
    },
    contentTitle: {
      fontSize: TavariStyles.typography.fontSize.base,
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      color: TavariStyles.colors.gray900,
      flex: 1,
    },
    contentActions: {
      display: 'flex',
      gap: TavariStyles.spacing.xs,
    },
    actionButton: {
      background: 'none',
      border: 'none',
      cursor: 'pointer',
      padding: '4px',
      color: TavariStyles.colors.gray600,
    },
    contentDescription: {
      fontSize: TavariStyles.typography.fontSize.sm,
      color: TavariStyles.colors.gray600,
      marginBottom: TavariStyles.spacing.sm,
    },
    contentMeta: {
      display: 'flex',
      gap: TavariStyles.spacing.md,
      fontSize: TavariStyles.typography.fontSize.xs,
      color: TavariStyles.colors.gray500,
    },
    badge: {
      display: 'inline-block',
      padding: '2px 8px',
      borderRadius: '12px',
      fontSize: TavariStyles.typography.fontSize.xs,
      fontWeight: TavariStyles.typography.fontWeight.medium,
    },
    badgeActive: {
      backgroundColor: '#dcfce7',
      color: '#16a34a',
    },
    badgeArchived: {
      backgroundColor: '#f3f4f6',
      color: '#6b7280',
    },
  };

  if (loading) {
    return (
      <div style={styles.container}>
        <div style={{ textAlign: 'center', padding: '48px' }}>Loading content sources...</div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h2 style={styles.title}>Content Sources</h2>
        <button style={styles.addButton} onClick={() => setShowAddModal(true)}>
          <Plus size={18} />
          Add Content
        </button>
      </div>

      {contentSources.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '48px', color: TavariStyles.colors.gray600 }}>
          <p>No content sources yet. Add your first content source to start posting.</p>
        </div>
      ) : (
        <div style={styles.contentGrid}>
          {contentSources.map(content => (
            <div key={content.id} style={styles.contentCard}>
              <div style={styles.contentHeader}>
                <div style={styles.contentTitle}>{content.title}</div>
                <div style={styles.contentActions}>
                  <button
                    style={styles.actionButton}
                    onClick={() => handlePostNow(content)}
                    title="Post Now"
                  >
                    <Send size={16} />
                  </button>
                  <button
                    style={styles.actionButton}
                    onClick={() => setEditingContent(content)}
                    title="Edit"
                  >
                    <Edit2 size={16} />
                  </button>
                  <button
                    style={styles.actionButton}
                    onClick={() => handleDelete(content.id)}
                    title="Delete"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
              {content.description && (
                <div style={styles.contentDescription}>{content.description}</div>
              )}
              <div style={styles.contentMeta}>
                <span style={{
                  ...styles.badge,
                  ...(content.status === 'active' ? styles.badgeActive : styles.badgeArchived)
                }}>
                  {content.status}
                </span>
                <span>Type: {content.source_type}</span>
                {content.priority > 0 && <span>Priority: {content.priority}</span>}
              </div>
            </div>
          ))}
        </div>
      )}

      {showAddModal && (
        <SocialMediaContentModal
          isOpen={showAddModal}
          onClose={() => {
            setShowAddModal(false);
            setEditingContent(null);
          }}
          onSave={() => {
            setShowAddModal(false);
            setEditingContent(null);
            loadContentSources();
          }}
          businessId={businessId}
          content={null}
        />
      )}

      {editingContent && (
        <SocialMediaContentModal
          isOpen={!!editingContent}
          onClose={() => setEditingContent(null)}
          onSave={() => {
            setEditingContent(null);
            loadContentSources();
          }}
          businessId={businessId}
          content={editingContent}
        />
      )}
    </div>
  );
};

export default SocialMediaContentManager;

