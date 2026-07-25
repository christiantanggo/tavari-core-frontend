// services/socialMedia/MultiBusinessSocialService.js
// Main service for posting to social media platforms
import { ConfigService } from './ConfigService';
import { SocialContentGenerator } from './SocialContentGenerator';
import { supabase } from '../../supabaseClient';

export class MultiBusinessSocialService {
  constructor() {
    this.configService = new ConfigService();
    this.contentGenerator = new SocialContentGenerator();
  }

  /**
   * Post content to social media platforms
   */
  async postContent(businessId, contentSource, platforms = null) {
    try {
      const configs = await this.configService.getBusinessConfig(businessId);
      const results = {};

      const platformsToPost = platforms || configs.map(c => c.platform);

      for (const config of configs) {
        if (!platformsToPost.includes(config.platform)) continue;
        if (!config.preferences.postingEnabled) continue;

        // Check if posting is allowed
        const canPost = await this.configService.checkPostingAllowed(businessId, config.platform);
        if (!canPost) {
          results[config.platform] = {
            success: false,
            error: 'Posting limit reached or too soon since last post',
          };
          continue;
        }

        try {
          // Generate content
          const generatedContent = await this.contentGenerator.generateContent(
            contentSource,
            config.platform,
            config.preferences
          );

          // Post to platform
          const postResult = await this.postToPlatform(config, contentSource, generatedContent);

          // Save to database
          await this.savePost(businessId, contentSource, config.platform, generatedContent, postResult);

          // Update posting stats
          if (postResult.success) {
            await this.configService.updatePostingStats(businessId, config.platform);
          }

          results[config.platform] = postResult;
        } catch (error) {
          results[config.platform] = {
            success: false,
            error: error.message || 'Unknown error',
          };
        }
      }

      return results;
    } catch (error) {
      console.error('Error posting content:', error);
      throw error;
    }
  }

  /**
   * Post to specific platform
   */
  async postToPlatform(config, source, content) {
    switch (config.platform) {
      case 'instagram':
        return await this.postToInstagram(config, source, content);
      case 'facebook':
        return await this.postToFacebook(config, source, content);
      case 'twitter':
        return await this.postToTwitter(config, source, content);
      case 'tiktok':
        return await this.postToTikTok(config, source, content);
      default:
        throw new Error(`Unsupported platform: ${config.platform}`);
    }
  }

  /**
   * Post to Instagram
   */
  async postToInstagram(config, source, content) {
    const imageUrl = source.imageUrls?.[0];
    if (!imageUrl) {
      throw new Error('Instagram requires an image');
    }

    // Instagram caption limit is 2200 characters
    const caption = `${content.caption}\n\n${content.hashtags.join(' ')}\n\n🔗 Link in bio`.substring(0, 2200);

    try {
      const pageId = config.credentials.pageId || config.credentials.accountId;
      const accessToken = config.credentials.accessToken;
      
      if (!pageId || !accessToken) {
        throw new Error('Instagram credentials not configured. Please check your Page ID and Access Token in settings.');
      }
      
      // Validate token format (Facebook tokens are typically 200+ characters)
      if (accessToken.length < 100) {
        console.error('⚠️ Access token is too short!', {
          length: accessToken.length,
          expected: '200+ characters',
          tokenPreview: accessToken.substring(0, 50)
        });
        throw new Error(`Access token is too short (${accessToken.length} chars, expected 200+). The token may be incomplete or corrupted. Please re-enter your full access token in Instagram settings.`);
      }
      
      console.log('Posting to Instagram:', {
        pageId,
        imageUrl,
        captionLength: caption.length,
        hasAccessToken: !!accessToken,
        tokenLength: accessToken?.length || 0,
        tokenPreview: accessToken ? `${accessToken.substring(0, 10)}...${accessToken.substring(accessToken.length - 5)}` : 'none'
      });

      // Step 1: Create media container
      const containerResponse = await fetch(
        `https://graph.facebook.com/v18.0/${pageId}/media`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            image_url: imageUrl,
            caption: caption,
            access_token: accessToken,
          }),
        }
      );

      const containerData = await containerResponse.json();
      
      console.log('Instagram container response:', {
        status: containerResponse.status,
        ok: containerResponse.ok,
        data: containerData
      });
      
      if (!containerResponse.ok) {
        const errorMsg = containerData.error?.message || JSON.stringify(containerData);
        const errorCode = containerData.error?.code || containerResponse.status;
        const errorType = containerData.error?.type || 'Unknown';
        const errorSubcode = containerData.error?.error_subcode || '';
        console.error('Instagram API Error Details:', {
          code: errorCode,
          type: errorType,
          subcode: errorSubcode,
          message: errorMsg,
          fullError: containerData
        });
        throw new Error(`Instagram API Error (${errorCode}): ${errorMsg}${errorSubcode ? ` [Subcode: ${errorSubcode}]` : ''}`);
      }
      
      if (!containerData.id) {
        throw new Error(`Failed to create container: ${JSON.stringify(containerData)}`);
      }

      // Step 2: Publish
      const publishResponse = await fetch(
        `https://graph.facebook.com/v18.0/${pageId}/media_publish`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            creation_id: containerData.id,
            access_token: accessToken,
          }),
        }
      );

      const publishData = await publishResponse.json();
      
      if (!publishResponse.ok) {
        const errorMsg = publishData.error?.message || JSON.stringify(publishData);
        const errorCode = publishData.error?.code || publishResponse.status;
        throw new Error(`Instagram Publish Error (${errorCode}): ${errorMsg}`);
      }
      
      if (publishData.id) {
        return {
          success: true,
          postUrl: `https://www.instagram.com/p/${publishData.id}/`,
          postId: publishData.id,
        };
      }

      throw new Error(`Failed to publish: ${JSON.stringify(publishData)}`);
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Post to Facebook
   */
  async postToFacebook(config, source, content) {
    const message = `${content.caption}\n\n${content.hashtags.join(' ')}`;

    try {
      if (!config.credentials.pageId || !config.credentials.accessToken) {
        throw new Error('Facebook credentials not configured');
      }

      const response = await fetch(
        `https://graph.facebook.com/v18.0/${config.credentials.pageId}/feed`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: message,
            link: source.url,
            access_token: config.credentials.accessToken,
          }),
        }
      );

      const data = await response.json();
      if (data.id) {
        return {
          success: true,
          postUrl: `https://www.facebook.com/${data.id}`,
          postId: data.id,
        };
      }

      throw new Error(`Failed to post: ${JSON.stringify(data)}`);
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Post to Twitter/X
   */
  async postToTwitter(config, source, content) {
    // Twitter API v2 requires OAuth 1.0a signing
    // For now, return content for manual posting or use a library
    const text = `${content.caption} ${content.hashtags.slice(0, 3).join(' ')} ${source.url}`;
    
    // TODO: Implement full Twitter API v2 posting with proper OAuth
    // For MVP, return manual post URL
    return {
      success: true,
      postUrl: `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`,
      note: 'Manual posting required - Twitter API integration pending',
    };
  }

  /**
   * Post to TikTok
   */
  async postToTikTok(config, source, content) {
    // TikTok API is complex and requires business account approval
    // For MVP, return content for manual posting
    const caption = `${content.caption}\n\n${content.hashtags.join(' ')}\n\n${source.url}`;
    
    return {
      success: true,
      postUrl: 'Manual posting required',
      caption: caption,
      note: 'TikTok API integration requires business account approval',
    };
  }

  /**
   * Save post to database
   */
  async savePost(businessId, source, platform, content, result) {
    try {
      // Find or create content source in database
      let contentSourceId = null;
      
      if (source.metadata?.sourceType && source.metadata?.sourceId) {
        const { data: existingSource } = await supabase
          .from('content_sources')
          .select('id')
          .eq('business_id', businessId)
          .eq('source_type', source.metadata.sourceType)
          .eq('source_id', source.metadata.sourceId)
          .single();

        if (existingSource) {
          contentSourceId = existingSource.id;
        }
      }

      const { error } = await supabase.from('social_posts').insert({
        business_id: businessId,
        content_source_id: contentSourceId,
        platform: platform,
        caption: content.caption,
        hashtags: content.hashtags,
        image_url: source.imageUrls?.[0],
        post_url: result.postUrl,
        post_id: result.postId,
        status: result.success ? 'posted' : 'failed',
        posted_at: result.success ? new Date().toISOString() : null,
        error_message: result.error,
      });

      if (error) throw error;
    } catch (error) {
      console.error('Error saving post:', error);
      // Don't throw - post might have succeeded even if save failed
    }
  }
}

export default MultiBusinessSocialService;

