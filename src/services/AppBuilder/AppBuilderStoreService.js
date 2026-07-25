// Step 60: Create AppBuilderStoreService.js
// Service for store listing management operations
import { supabase } from '../../supabaseClient';

class AppBuilderStoreService {
  constructor() {
    this.businessId = null;
  }

  setBusinessId(businessId) {
    this.businessId = businessId;
  }

  // Get listing
  async getListing(platform) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    const { data, error } = await supabase
      .from('app_store_listings')
      .select('*')
      .eq('business_id', this.businessId)
      .eq('platform', platform)
      .single();

    if (error && error.code !== 'PGRST116') { // PGRST116 = no rows returned
      console.error('Error fetching listing:', error);
      throw error;
    }

    return data;
  }

  // Update listing
  async updateListing(platform, listingData) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    const { data, error } = await supabase
      .from('app_store_listings')
      .upsert({
        business_id: this.businessId,
        platform: platform,
        ...listingData,
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'business_id,platform'
      })
      .select()
      .single();

    if (error) {
      console.error('Error updating listing:', error);
      throw error;
    }

    return data;
  }

  // Validate listing
  validateListing(listingData, platform) {
    const errors = [];

    if (!listingData.title || listingData.title.length < 3) {
      errors.push('Title must be at least 3 characters');
    }

    if (listingData.title && listingData.title.length > 50) {
      errors.push('Title must be less than 50 characters');
    }

    if (!listingData.description || listingData.description.length < 10) {
      errors.push('Description must be at least 10 characters');
    }

    if (listingData.description && listingData.description.length > 4000) {
      errors.push('Description must be less than 4000 characters');
    }

    if (platform === 'ios' && listingData.subtitle && listingData.subtitle.length > 30) {
      errors.push('iOS subtitle must be less than 30 characters');
    }

    if (listingData.keywords && listingData.keywords.length > 100) {
      errors.push('Keywords must be less than 100 characters total');
    }

    if (listingData.screenshots && listingData.screenshots.length < 1) {
      errors.push('At least one screenshot is required');
    }

    if (listingData.screenshots && listingData.screenshots.length > 10) {
      errors.push('Maximum 10 screenshots allowed');
    }

    return {
      valid: errors.length === 0,
      errors: errors
    };
  }

  // Get store guidelines
  getStoreGuidelines(platform) {
    const guidelines = {
      ios: {
        title: {
          min: 3,
          max: 50,
          required: true
        },
        subtitle: {
          min: 0,
          max: 30,
          required: false
        },
        description: {
          min: 10,
          max: 4000,
          required: true
        },
        keywords: {
          max: 100,
          required: false
        },
        screenshots: {
          min: 1,
          max: 10,
          required: true
        }
      },
      android: {
        title: {
          min: 3,
          max: 50,
          required: true
        },
        description: {
          min: 10,
          max: 4000,
          required: true
        },
        keywords: {
          max: 100,
          required: false
        },
        screenshots: {
          min: 2,
          max: 8,
          required: true
        }
      }
    };

    return guidelines[platform] || {};
  }
}

export default new AppBuilderStoreService();




