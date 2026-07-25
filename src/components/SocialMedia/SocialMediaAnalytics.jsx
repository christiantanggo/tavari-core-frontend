// components/SocialMedia/SocialMediaAnalytics.jsx
// Analytics dashboard for social media performance
import React, { useState, useEffect } from 'react';
import { BarChart3, TrendingUp, Eye, Heart, MessageCircle, Share2 } from 'lucide-react';
import { supabase } from '../../supabaseClient';
import { TavariStyles } from '../../utils/TavariStyles';
import toast from 'react-hot-toast';

const SocialMediaAnalytics = ({ businessId }) => {
  const [analytics, setAnalytics] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dateRange, setDateRange] = useState(30); // days

  useEffect(() => {
    if (businessId) {
      loadAnalytics();
    }
  }, [businessId, dateRange]);

  const loadAnalytics = async () => {
    try {
      setLoading(true);
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - dateRange);

      // Load analytics summary
      const { data: analyticsData, error: analyticsError } = await supabase
        .from('social_analytics')
        .select('*')
        .eq('business_id', businessId)
        .gte('date', startDate.toISOString().split('T')[0])
        .order('date', { ascending: false });

      if (analyticsError) throw analyticsError;

      // Also get recent posts for real-time stats
      const { data: postsData, error: postsError } = await supabase
        .from('social_posts')
        .select('platform, views, likes, comments, shares, clicks')
        .eq('business_id', businessId)
        .eq('status', 'posted')
        .gte('posted_at', startDate.toISOString());

      if (postsError) throw postsError;

      // Aggregate by platform
      const platformStats = {};
      (postsData || []).forEach(post => {
        if (!platformStats[post.platform]) {
          platformStats[post.platform] = {
            posts: 0,
            views: 0,
            likes: 0,
            comments: 0,
            shares: 0,
            clicks: 0,
          };
        }
        platformStats[post.platform].posts++;
        platformStats[post.platform].views += post.views || 0;
        platformStats[post.platform].likes += post.likes || 0;
        platformStats[post.platform].comments += post.comments || 0;
        platformStats[post.platform].shares += post.shares || 0;
        platformStats[post.platform].clicks += post.clicks || 0;
      });

      setAnalytics({
        summary: analyticsData || [],
        platformStats,
      });
    } catch (error) {
      console.error('Error loading analytics:', error);
      toast.error('Failed to load analytics');
    } finally {
      setLoading(false);
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
    statsGrid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
      gap: TavariStyles.spacing.md,
      marginBottom: TavariStyles.spacing.xl,
    },
    statCard: {
      backgroundColor: TavariStyles.colors.gray50,
      borderRadius: TavariStyles.borderRadius?.md || '8px',
      padding: TavariStyles.spacing.md,
      border: `1px solid ${TavariStyles.colors.gray200}`,
    },
    statValue: {
      fontSize: TavariStyles.typography.fontSize['2xl'],
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.gray900,
      marginBottom: TavariStyles.spacing.xs,
    },
    statLabel: {
      fontSize: TavariStyles.typography.fontSize.sm,
      color: TavariStyles.colors.gray600,
      display: 'flex',
      alignItems: 'center',
      gap: TavariStyles.spacing.xs,
    },
    platformSection: {
      marginBottom: TavariStyles.spacing.xl,
    },
    platformTitle: {
      fontSize: TavariStyles.typography.fontSize.base,
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      color: TavariStyles.colors.gray900,
      marginBottom: TavariStyles.spacing.md,
      textTransform: 'capitalize',
    },
  };

  if (loading) {
    return (
      <div style={styles.container}>
        <div style={{ textAlign: 'center', padding: '48px' }}>Loading analytics...</div>
      </div>
    );
  }

  const totalStats = Object.values(analytics.platformStats || {}).reduce(
    (acc, stats) => ({
      posts: acc.posts + stats.posts,
      views: acc.views + stats.views,
      likes: acc.likes + stats.likes,
      comments: acc.comments + stats.comments,
      shares: acc.shares + stats.shares,
      clicks: acc.clicks + stats.clicks,
    }),
    { posts: 0, views: 0, likes: 0, comments: 0, shares: 0, clicks: 0 }
  );

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h2 style={styles.title}>Social Media Analytics</h2>
        <select
          value={dateRange}
          onChange={(e) => setDateRange(parseInt(e.target.value))}
          style={{
            padding: `${TavariStyles.spacing.sm} ${TavariStyles.spacing.md}`,
            border: `1px solid ${TavariStyles.colors.gray300}`,
            borderRadius: TavariStyles.borderRadius?.md || '8px',
          }}
        >
          <option value={7}>Last 7 days</option>
          <option value={30}>Last 30 days</option>
          <option value={90}>Last 90 days</option>
        </select>
      </div>

      <div style={styles.statsGrid}>
        <div style={styles.statCard}>
          <div style={styles.statValue}>{totalStats.posts}</div>
          <div style={styles.statLabel}>
            <BarChart3 size={16} />
            Total Posts
          </div>
        </div>
        <div style={styles.statCard}>
          <div style={styles.statValue}>{totalStats.views}</div>
          <div style={styles.statLabel}>
            <Eye size={16} />
            Total Views
          </div>
        </div>
        <div style={styles.statCard}>
          <div style={styles.statValue}>{totalStats.likes}</div>
          <div style={styles.statLabel}>
            <Heart size={16} />
            Total Likes
          </div>
        </div>
        <div style={styles.statCard}>
          <div style={styles.statValue}>{totalStats.comments}</div>
          <div style={styles.statLabel}>
            <MessageCircle size={16} />
            Total Comments
          </div>
        </div>
        <div style={styles.statCard}>
          <div style={styles.statValue}>{totalStats.shares}</div>
          <div style={styles.statLabel}>
            <Share2 size={16} />
            Total Shares
          </div>
        </div>
        <div style={styles.statCard}>
          <div style={styles.statValue}>{totalStats.clicks}</div>
          <div style={styles.statLabel}>
            <TrendingUp size={16} />
            Total Clicks
          </div>
        </div>
      </div>

      {Object.keys(analytics.platformStats || {}).length > 0 && (
        <div>
          <h3 style={{ marginBottom: TavariStyles.spacing.md }}>By Platform</h3>
          {Object.entries(analytics.platformStats).map(([platform, stats]) => (
            <div key={platform} style={styles.platformSection}>
              <div style={styles.platformTitle}>{platform}</div>
              <div style={styles.statsGrid}>
                <div style={styles.statCard}>
                  <div style={styles.statValue}>{stats.posts}</div>
                  <div style={styles.statLabel}>Posts</div>
                </div>
                <div style={styles.statCard}>
                  <div style={styles.statValue}>{stats.views}</div>
                  <div style={styles.statLabel}>Views</div>
                </div>
                <div style={styles.statCard}>
                  <div style={styles.statValue}>{stats.likes}</div>
                  <div style={styles.statLabel}>Likes</div>
                </div>
                <div style={styles.statCard}>
                  <div style={styles.statValue}>
                    {stats.posts > 0 ? ((stats.likes / stats.posts).toFixed(1)) : 0}
                  </div>
                  <div style={styles.statLabel}>Avg Likes/Post</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default SocialMediaAnalytics;


