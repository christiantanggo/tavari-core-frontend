// services/socialMedia/ConfigService.js
// Configuration management for social media platforms per business
import { supabase } from '../../supabaseClient';
import CryptoJS from 'crypto-js';

export class ConfigService {
  constructor() {
    this.encryptionKey = import.meta.env.VITE_ENCRYPTION_KEY || 'default-key-change-in-production';
  }

  /**
   * Encrypt sensitive data (tokens, keys)
   */
  encrypt(text) {
    if (!text) return null;
    try {
      const encrypted = CryptoJS.AES.encrypt(text, this.encryptionKey).toString();
      // Verify encryption worked by checking length (encrypted should be longer than original)
      if (encrypted && encrypted.length < text.length) {
        console.warn('⚠️ Encryption result is shorter than input - may indicate an issue');
      }
      return encrypted;
    } catch (error) {
      console.error('Encryption error:', error);
      return null;
    }
  }

  /**
   * Decrypt sensitive data
   */
  decrypt(encryptedText) {
    if (!encryptedText) return null;
    try {
      const bytes = CryptoJS.AES.decrypt(encryptedText, this.encryptionKey);
      const decrypted = bytes.toString(CryptoJS.enc.Utf8);
      
      // Log if decryption resulted in empty string (indicates wrong key or corrupted data)
      if (!decrypted && encryptedText) {
        console.warn('Decryption returned empty string. Token may be corrupted or encryption key mismatch.');
      }
      
      return decrypted;
    } catch (error) {
      console.error('Decryption error:', error);
      return null;
    }
  }

  /**
   * Get all social media configurations for a business
   */
  async getBusinessConfig(businessId) {
    try {
      const { data, error } = await supabase
        .from('social_media_configs')
        .select('*')
        .eq('business_id', businessId)
        .eq('is_enabled', true)
        .order('platform');

      if (error) throw error;

      return (data || []).map(config => ({
        businessId: config.business_id,
        platform: config.platform,
        isEnabled: config.is_enabled,
        credentials: {
          accessToken: config.access_token ? this.decrypt(config.access_token) : undefined,
          accessTokenSecret: config.access_token_secret ? this.decrypt(config.access_token_secret) : undefined,
          apiKey: config.api_key ? this.decrypt(config.api_key) : undefined,
          apiSecret: config.api_secret ? this.decrypt(config.api_secret) : undefined,
          pageId: config.page_id,
          accountId: config.account_id,
        },
        preferences: {
          postingEnabled: config.posting_enabled,
          autoPostingEnabled: config.auto_posting_enabled,
          postingFrequencyHours: config.posting_frequency_hours,
          maxPostsPerDay: config.max_posts_per_day,
          preferredPostingTimes: config.preferred_posting_times,
          contentStyle: config.content_style || 'professional',
          includeHashtags: config.include_hashtags,
          hashtagCount: config.hashtag_count,
          includeEmoji: config.include_emoji,
        },
        rateLimiting: {
          lastPostedAt: config.last_posted_at,
          postsToday: config.posts_today,
          dailyPostResetAt: config.daily_post_reset_at,
        },
        id: config.id,
        createdAt: config.created_at,
        updatedAt: config.updated_at,
      }));
    } catch (error) {
      console.error('Error getting business config:', error);
      throw error;
    }
  }

  /**
   * Get configuration for a specific platform
   */
  async getPlatformConfig(businessId, platform) {
    try {
      const { data, error } = await supabase
        .from('social_media_configs')
        .select('*')
        .eq('business_id', businessId)
        .eq('platform', platform)
        .single();

      if (error && error.code !== 'PGRST116') throw error;
      if (!data) return null;

      return {
        businessId: data.business_id,
        platform: data.platform,
        isEnabled: data.is_enabled,
        credentials: {
          accessToken: data.access_token ? this.decrypt(data.access_token) : undefined,
          accessTokenSecret: data.access_token_secret ? this.decrypt(data.access_token_secret) : undefined,
          apiKey: data.api_key ? this.decrypt(data.api_key) : undefined,
          apiSecret: data.api_secret ? this.decrypt(data.api_secret) : undefined,
          pageId: data.page_id,
          accountId: data.account_id,
        },
        preferences: {
          postingEnabled: data.posting_enabled,
          autoPostingEnabled: data.auto_posting_enabled,
          postingFrequencyHours: data.posting_frequency_hours,
          maxPostsPerDay: data.max_posts_per_day,
          preferredPostingTimes: data.preferred_posting_times,
          contentStyle: data.content_style || 'professional',
          includeHashtags: data.include_hashtags,
          hashtagCount: data.hashtag_count,
          includeEmoji: data.include_emoji,
        },
        id: data.id,
      };
    } catch (error) {
      console.error('Error getting platform config:', error);
      throw error;
    }
  }

  /**
   * Save or update business social media configuration
   */
  async saveBusinessConfig(config) {
    try {
      // Validate access token length before saving (Facebook tokens are 200+ chars)
      if (config.credentials?.accessToken && config.credentials.accessToken.length < 100) {
        console.warn('⚠️ Access token is suspiciously short:', {
          length: config.credentials.accessToken.length,
          platform: config.platform,
          preview: config.credentials.accessToken.substring(0, 20) + '...'
        });
        // Don't throw, but log warning - user might have a valid short token
      }
      
      const encryptedData = {
        business_id: config.businessId,
        platform: config.platform,
        is_enabled: config.isEnabled !== false,
        access_token: config.credentials?.accessToken ? this.encrypt(config.credentials.accessToken) : null,
        access_token_secret: config.credentials?.accessTokenSecret ? this.encrypt(config.credentials.accessTokenSecret) : null,
        api_key: config.credentials?.apiKey ? this.encrypt(config.credentials.apiKey) : null,
        api_secret: config.credentials?.apiSecret ? this.encrypt(config.credentials.apiSecret) : null,
        page_id: config.credentials?.pageId || null,
        account_id: config.credentials?.accountId || null,
        posting_enabled: config.preferences?.postingEnabled !== false,
        auto_posting_enabled: config.preferences?.autoPostingEnabled || false,
        posting_frequency_hours: config.preferences?.postingFrequencyHours || 4,
        max_posts_per_day: config.preferences?.maxPostsPerDay || 6,
        preferred_posting_times: config.preferences?.preferredPostingTimes || null,
        content_style: config.preferences?.contentStyle || 'professional',
        include_hashtags: config.preferences?.includeHashtags !== false,
        hashtag_count: config.preferences?.hashtagCount || 10,
        include_emoji: config.preferences?.includeEmoji !== false,
        updated_at: new Date().toISOString(),
      };

      const { data, error } = await supabase
        .from('social_media_configs')
        .upsert(encryptedData, {
          onConflict: 'business_id,platform',
        })
        .select()
        .single();

      if (error) throw error;

      return data;
    } catch (error) {
      console.error('Error saving business config:', error);
      throw error;
    }
  }

  /**
   * Check if posting is allowed for a business/platform (rate limiting)
   */
  async checkPostingAllowed(businessId, platform) {
    try {
      const { data, error } = await supabase
        .from('social_media_configs')
        .select('last_posted_at, posts_today, max_posts_per_day, daily_post_reset_at, posting_frequency_hours, posting_enabled')
        .eq('business_id', businessId)
        .eq('platform', platform)
        .single();

      if (error && error.code !== 'PGRST116') throw error;
      if (!data || !data.posting_enabled) return false;

      const now = new Date();
      const resetAt = data.daily_post_reset_at ? new Date(data.daily_post_reset_at) : null;

      // Reset daily counter if needed
      if (!resetAt || now > resetAt) {
        const nextReset = new Date(now.getTime() + 24 * 60 * 60 * 1000);
        await supabase
          .from('social_media_configs')
          .update({
            posts_today: 0,
            daily_post_reset_at: nextReset.toISOString(),
          })
          .eq('business_id', businessId)
          .eq('platform', platform);
        return true;
      }

      // Check daily limit
      if (data.posts_today >= data.max_posts_per_day) {
        return false;
      }

      // Check frequency
      if (data.last_posted_at) {
        const lastPosted = new Date(data.last_posted_at);
        const hoursSinceLastPost = (now.getTime() - lastPosted.getTime()) / (1000 * 60 * 60);
        if (hoursSinceLastPost < data.posting_frequency_hours) {
          return false;
        }
      }

      return true;
    } catch (error) {
      console.error('Error checking posting allowed:', error);
      return false;
    }
  }

  /**
   * Update posting statistics after a post
   */
  async updatePostingStats(businessId, platform) {
    try {
      // First get current value
      const { data: current, error: fetchError } = await supabase
        .from('social_media_configs')
        .select('posts_today')
        .eq('business_id', businessId)
        .eq('platform', platform)
        .single();

      if (fetchError) throw fetchError;

      const now = new Date();
      const { error } = await supabase
        .from('social_media_configs')
        .update({
          last_posted_at: now.toISOString(),
          posts_today: (current?.posts_today || 0) + 1,
        })
        .eq('business_id', businessId)
        .eq('platform', platform);

      if (error) throw error;
    } catch (error) {
      console.error('Error updating posting stats:', error);
      throw error;
    }
  }
}

export default ConfigService;

