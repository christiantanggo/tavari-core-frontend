// components/SocialMedia/SocialMediaPostsList.jsx
// List of all social media posts
import React, { useState, useEffect } from 'react';
import { ExternalLink, Calendar, BarChart3 } from 'lucide-react';
import { supabase } from '../../supabaseClient';
import { TavariStyles } from '../../utils/TavariStyles';
import toast from 'react-hot-toast';

const SocialMediaPostsList = ({ businessId }) => {
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all'); // all, posted, failed, scheduled

  useEffect(() => {
    if (businessId) {
      loadPosts();
    }
  }, [businessId, filter]);

  const loadPosts = async () => {
    try {
      setLoading(true);
      let query = supabase
        .from('social_posts')
        .select('*')
        .eq('business_id', businessId)
        .order('created_at', { ascending: false })
        .limit(100);

      if (filter !== 'all') {
        query = query.eq('status', filter);
      }

      const { data, error } = await query;

      if (error) throw error;
      setPosts(data || []);
    } catch (error) {
      console.error('Error loading posts:', error);
      toast.error('Failed to load posts');
    } finally {
      setLoading(false);
    }
  };

  const getStatusBadgeStyle = (status) => {
    const styles = {
      posted: { backgroundColor: '#dcfce7', color: '#16a34a' },
      failed: { backgroundColor: '#fee2e2', color: '#dc2626' },
      scheduled: { backgroundColor: '#fef3c7', color: '#d97706' },
      draft: { backgroundColor: '#f3f4f6', color: '#6b7280' },
    };
    return styles[status] || styles.draft;
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
    filters: {
      display: 'flex',
      gap: TavariStyles.spacing.sm,
    },
    filterButton: {
      padding: `${TavariStyles.spacing.xs} ${TavariStyles.spacing.md}`,
      border: `1px solid ${TavariStyles.colors.gray300}`,
      borderRadius: TavariStyles.borderRadius?.md || '8px',
      backgroundColor: TavariStyles.colors.white,
      color: TavariStyles.colors.gray700,
      cursor: 'pointer',
      fontSize: TavariStyles.typography.fontSize.sm,
    },
    filterButtonActive: {
      backgroundColor: TavariStyles.colors.primary,
      color: TavariStyles.colors.white,
      borderColor: TavariStyles.colors.primary,
    },
    postsList: {
      display: 'flex',
      flexDirection: 'column',
      gap: TavariStyles.spacing.md,
    },
    postCard: {
      border: `1px solid ${TavariStyles.colors.gray200}`,
      borderRadius: TavariStyles.borderRadius?.md || '8px',
      padding: TavariStyles.spacing.md,
      backgroundColor: TavariStyles.colors.white,
    },
    postHeader: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'start',
      marginBottom: TavariStyles.spacing.sm,
    },
    postPlatform: {
      fontSize: TavariStyles.typography.fontSize.sm,
      fontWeight: TavariStyles.typography.fontWeight.medium,
      textTransform: 'capitalize',
    },
    postStatus: {
      display: 'inline-block',
      padding: '2px 8px',
      borderRadius: '12px',
      fontSize: TavariStyles.typography.fontSize.xs,
      fontWeight: TavariStyles.typography.fontWeight.medium,
    },
    postCaption: {
      fontSize: TavariStyles.typography.fontSize.sm,
      color: TavariStyles.colors.gray700,
      marginBottom: TavariStyles.spacing.sm,
      whiteSpace: 'pre-wrap',
    },
    postMeta: {
      display: 'flex',
      gap: TavariStyles.spacing.md,
      fontSize: TavariStyles.typography.fontSize.xs,
      color: TavariStyles.colors.gray500,
      alignItems: 'center',
    },
    postLink: {
      display: 'flex',
      alignItems: 'center',
      gap: '4px',
      color: TavariStyles.colors.primary,
      textDecoration: 'none',
      fontSize: TavariStyles.typography.fontSize.xs,
    },
  };

  if (loading) {
    return (
      <div style={styles.container}>
        <div style={{ textAlign: 'center', padding: '48px' }}>Loading posts...</div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h2 style={styles.title}>Social Media Posts</h2>
        <div style={styles.filters}>
          {['all', 'posted', 'failed', 'scheduled'].map(f => (
            <button
              key={f}
              style={{
                ...styles.filterButton,
                ...(filter === f ? styles.filterButtonActive : {}),
              }}
              onClick={() => setFilter(f)}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {posts.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '48px', color: TavariStyles.colors.gray600 }}>
          No posts found
        </div>
      ) : (
        <div style={styles.postsList}>
          {posts.map(post => (
            <div key={post.id} style={styles.postCard}>
              <div style={styles.postHeader}>
                <div>
                  <div style={styles.postPlatform}>{post.platform}</div>
                  <span style={{ ...styles.postStatus, ...getStatusBadgeStyle(post.status) }}>
                    {post.status}
                  </span>
                </div>
                {post.post_url && (
                  <a
                    href={post.post_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={styles.postLink}
                  >
                    <ExternalLink size={14} />
                    View Post
                  </a>
                )}
              </div>
              <div style={styles.postCaption}>{post.caption}</div>
              {post.hashtags && post.hashtags.length > 0 && (
                <div style={{ marginBottom: TavariStyles.spacing.xs }}>
                  {post.hashtags.join(' ')}
                </div>
              )}
              <div style={styles.postMeta}>
                {post.posted_at && (
                  <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <Calendar size={12} />
                    {new Date(post.posted_at).toLocaleString()}
                  </span>
                )}
                {(post.likes > 0 || post.views > 0) && (
                  <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <BarChart3 size={12} />
                    {post.likes} likes, {post.views} views
                  </span>
                )}
                {post.error_message && (
                  <span style={{ color: '#dc2626' }}>Error: {post.error_message}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default SocialMediaPostsList;


