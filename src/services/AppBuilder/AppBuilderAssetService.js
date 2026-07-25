// Step 59: Create AppBuilderAssetService.js
// Service for asset management operations
import { supabase } from '../../supabaseClient';

class AppBuilderAssetService {
  constructor() {
    this.businessId = null;
  }

  setBusinessId(businessId) {
    this.businessId = businessId;
  }

  // Upload asset
  async uploadAsset(file, assetType, businessId) {
    if (!businessId) businessId = this.businessId;
    if (!businessId) throw new Error('Business ID is required');

    const fileExt = file.name.split('.').pop();
    const fileName = `${businessId}/${assetType}-${Date.now()}.${fileExt}`;
    const filePath = `${fileName}`;

    // Upload to storage
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('appbuilder-assets')
      .upload(filePath, file, {
        cacheControl: '3600',
        upsert: false
      });

    if (uploadError) {
      console.error('Error uploading asset:', uploadError);
      throw uploadError;
    }

    // Get public URL
    const { data: urlData } = supabase.storage
      .from('appbuilder-assets')
      .getPublicUrl(filePath);

    // Get image dimensions if it's an image
    let dimensions = null;
    if (file.type.startsWith('image/')) {
      dimensions = await this.getImageDimensions(file);
    }

    // Save to app_assets table
    const { data: assetData, error: assetError } = await supabase
      .from('app_assets')
      .insert({
        business_id: businessId,
        asset_type: assetType,
        asset_url: urlData.publicUrl,
        storage_path: filePath,
        file_size: file.size,
        mime_type: file.type,
        dimensions: dimensions
      })
      .select()
      .single();

    if (assetError) {
      console.error('Error saving asset:', assetError);
      throw assetError;
    }

    return assetData;
  }

  // Delete asset
  async deleteAsset(assetId) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    // Get asset info
    const { data: asset, error: fetchError } = await supabase
      .from('app_assets')
      .select('storage_path')
      .eq('id', assetId)
      .eq('business_id', this.businessId)
      .single();

    if (fetchError || !asset) {
      throw new Error('Asset not found or access denied');
    }

    // Delete from storage
    if (asset.storage_path) {
      const { error: storageError } = await supabase.storage
        .from('appbuilder-assets')
        .remove([asset.storage_path]);

      if (storageError) {
        console.error('Error deleting from storage:', storageError);
        // Continue with database delete even if storage delete fails
      }
    }

    // Delete from database
    const { error } = await supabase
      .from('app_assets')
      .delete()
      .eq('id', assetId)
      .eq('business_id', this.businessId);

    if (error) {
      console.error('Error deleting asset:', error);
      throw error;
    }

    return true;
  }

  // Get assets
  async getAssets(filters = {}) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    let query = supabase
      .from('app_assets')
      .select('*')
      .eq('business_id', this.businessId)
      .order('created_at', { ascending: false });

    if (filters.asset_type) {
      query = query.eq('asset_type', filters.asset_type);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Error fetching assets:', error);
      throw error;
    }

    return data || [];
  }

  // Validate asset
  validateAsset(file, assetType) {
    const maxSize = 50 * 1024 * 1024; // 50MB
    const allowedTypes = {
      logo: ['image/png', 'image/jpeg', 'image/jpg', 'image/svg+xml'],
      icon: ['image/png', 'image/jpeg', 'image/jpg', 'image/x-icon'],
      splash: ['image/png', 'image/jpeg', 'image/jpg'],
      screenshot: ['image/png', 'image/jpeg', 'image/jpg'],
      favicon: ['image/x-icon', 'image/png']
    };

    if (file.size > maxSize) {
      throw new Error('File size exceeds 50MB limit');
    }

    if (allowedTypes[assetType] && !allowedTypes[assetType].includes(file.type)) {
      throw new Error(`Invalid file type for ${assetType}. Allowed: ${allowedTypes[assetType].join(', ')}`);
    }

    return true;
  }

  // Get image dimensions
  getImageDimensions(file) {
    return new Promise((resolve) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve({
          width: img.width,
          height: img.height
        });
      };
      
      img.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(null);
      };
      
      img.src = url;
    });
  }
}

export default new AppBuilderAssetService();




