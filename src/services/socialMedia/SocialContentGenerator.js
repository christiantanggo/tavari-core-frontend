// services/socialMedia/SocialContentGenerator.js
// AI-powered content generation for social media posts
import OpenAI from 'openai';

export class SocialContentGenerator {
  constructor() {
    const apiKey = import.meta.env.VITE_OPENAI_API_KEY;
    if (!apiKey) {
      console.warn('OpenAI API key not found. AI content generation will use fallback.');
    }
    
    this.openai = apiKey ? new OpenAI({ 
      apiKey, 
      dangerouslyAllowBrowser: true // Required for browser environment
    }) : null;
    this.model = import.meta.env.VITE_OPENAI_MODEL || 'gpt-3.5-turbo';
  }

  /**
   * Generate social media content using AI
   */
  async generateContent(source, platform, businessStyle = {}) {
    if (!this.openai) {
      return this.generateFallbackContent(source, platform, businessStyle);
    }

    const platformPrompts = {
      instagram: this.getInstagramPrompt(businessStyle),
      facebook: this.getFacebookPrompt(businessStyle),
      twitter: this.getTwitterPrompt(businessStyle),
      tiktok: this.getTikTokPrompt(businessStyle),
    };

    const prompt = `${platformPrompts[platform]}

Content to promote:
Title: ${source.title}
Description: ${source.description || 'N/A'}
URL: ${source.url || 'N/A'}

${businessStyle.includeHashtags ? `Generate ${businessStyle.hashtagCount || 10} relevant hashtags.` : 'Do not include hashtags.'}
${businessStyle.includeEmoji ? 'Use emojis appropriately.' : 'Do not use emojis.'}

Return JSON in this format:
{
  "caption": "...",
  "hashtags": ["#tag1", "#tag2", ...]
}`;

    try {
      const response = await this.openai.chat.completions.create({
        model: this.model,
        messages: [
          {
            role: 'system',
            content: `You are a social media content creator specializing in ${platform}. Create engaging, authentic content that matches the ${businessStyle.style || 'professional'} style.`,
          },
          { role: 'user', content: prompt },
        ],
        max_tokens: 500,
        temperature: 0.7,
      });

      const content = response.choices[0]?.message?.content || '';
      const cleaned = content.replace(/```json\n?/g, '').replace(/```/g, '').trim();
      const parsed = JSON.parse(cleaned);

      return {
        caption: parsed.caption || source.title,
        hashtags: Array.isArray(parsed.hashtags) ? parsed.hashtags : [],
        suggestedImageUrl: source.imageUrls?.[0],
      };
    } catch (error) {
      console.error('AI content generation error:', error);
      return this.generateFallbackContent(source, platform, businessStyle);
    }
  }

  /**
   * Generate fallback content when AI is unavailable
   */
  generateFallbackContent(source, platform, businessStyle) {
    const caption = source.description || source.title;
    const hashtags = businessStyle.includeHashtags 
      ? this.generateFallbackHashtags(source, businessStyle.hashtagCount || 10)
      : [];

    return {
      caption,
      hashtags,
      suggestedImageUrl: source.imageUrls?.[0],
    };
  }

  /**
   * Generate basic hashtags as fallback
   */
  generateFallbackHashtags(source, count) {
    const tags = [];
    
    // Add category-based tags
    if (source.metadata?.category) {
      tags.push(`#${source.metadata.category.toLowerCase().replace(/\s+/g, '')}`);
    }

    // Add common tags
    const commonTags = ['#business', '#deals', '#savings', '#discount', '#special', '#offer'];
    tags.push(...commonTags);

    // Add title-based tags (extract keywords)
    if (source.title) {
      const words = source.title.toLowerCase().split(/\s+/).filter(w => w.length > 3);
      words.slice(0, 3).forEach(word => {
        tags.push(`#${word.replace(/[^a-z0-9]/g, '')}`);
      });
    }

    return tags.slice(0, count);
  }

  /**
   * Platform-specific prompts
   */
  getInstagramPrompt(style) {
    return `Create an engaging Instagram caption (max 2200 characters) in a ${style.style || 'professional'} tone. 
Make it visually appealing and encourage engagement. Include a call-to-action.`;
  }

  getFacebookPrompt(style) {
    return `Create a Facebook post (max 500 characters) in a ${style.style || 'professional'} tone. 
Be informative and encourage sharing.`;
  }

  getTwitterPrompt(style) {
    return `Create a Twitter/X post (max 280 characters) in a ${style.style || 'professional'} tone. 
Be concise and engaging.`;
  }

  getTikTokPrompt(style) {
    return `Create a short, energetic TikTok caption (max 150 characters) in a ${style.style || 'energetic'} tone. 
Use trending language and encourage interaction.`;
  }
}

export default SocialContentGenerator;

