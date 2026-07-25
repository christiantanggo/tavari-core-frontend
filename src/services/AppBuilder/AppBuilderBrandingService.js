// Step 52: Create AppBuilderBrandingService.js
// Service for branding operations (upload, generation, etc.)
import { supabase } from '../../supabaseClient';

/** Must match storage.buckets.allowed_mime_types for appbuilder-assets */
const LOGO_MIMES = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/gif',
  'image/webp',
  'image/svg+xml'
]);

const FAVICON_MIMES = new Set([
  ...LOGO_MIMES,
  'image/x-icon',
  'image/vnd.microsoft.icon'
]);

const LOGO_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg']);
const FAVICON_EXT = new Set([...LOGO_EXT, 'ico']);

function assertBrandingFileAllowed(file, kind) {
  const allowedMime = kind === 'favicon' ? FAVICON_MIMES : LOGO_MIMES;
  const allowedExt = kind === 'favicon' ? FAVICON_EXT : LOGO_EXT;
  const mime = (file?.type || '').toLowerCase().trim();
  const ext = (file?.name?.split('.').pop() || '').toLowerCase();

  if (mime.includes('tiff') || ext === 'tif' || ext === 'tiff') {
    throw new Error(
      'TIFF is not supported for this upload. Please use PNG, JPEG, WebP, GIF, or SVG.'
    );
  }
  if (mime && allowedMime.has(mime)) return;
  if (!mime && ext && allowedExt.has(ext)) return;
  const label = kind === 'favicon' ? 'favicon' : 'logo';
  throw new Error(
    mime
      ? `This file type is not allowed for ${label} uploads. Use a format supported by storage (PNG, JPEG, WebP, GIF, SVG${kind === 'favicon' ? ', or ICO' : ''}).`
      : `Could not detect a supported image type. Use PNG, JPEG, WebP, GIF, or SVG${kind === 'favicon' ? ', or ICO' : ''}.`
  );
}

class AppBuilderBrandingService {
  constructor() {
    this.businessId = null;
  }

  setBusinessId(businessId) {
    this.businessId = businessId;
  }

  // Get branding configuration
  async getBranding() {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    const { data, error } = await supabase
      .rpc('appbuilder_get_branding_config', {
        business_uuid: this.businessId
      });

    if (error) {
      console.error('Error fetching branding:', error);
      throw error;
    }

    return data;
  }

  // Update branding configuration
  async updateBranding(brandingData) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    const { data, error } = await supabase
      .from('app_branding')
      .upsert({
        business_id: this.businessId,
        ...brandingData,
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'business_id'
      })
      .select()
      .single();

    if (error) {
      console.error('Error updating branding:', error);
      throw error;
    }

    return data;
  }

  // Upload logo
  async uploadLogo(file, businessId) {
    if (!businessId) businessId = this.businessId;
    if (!businessId) throw new Error('Business ID is required');
    assertBrandingFileAllowed(file, 'logo');

    const fileExt = file.name.split('.').pop();
    const fileName = `${businessId}/logo-${Date.now()}.${fileExt}`;
    const filePath = `${fileName}`;

    // Upload to storage
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('appbuilder-assets')
      .upload(filePath, file, {
        cacheControl: '3600',
        upsert: false
      });

    if (uploadError) {
      console.error('Error uploading logo:', uploadError);
      throw uploadError;
    }

    // Get public URL
    const { data: urlData } = supabase.storage
      .from('appbuilder-assets')
      .getPublicUrl(filePath);

    // Save to app_assets table
    const { data: assetData, error: assetError } = await supabase
      .from('app_assets')
      .insert({
        business_id: businessId,
        asset_type: 'logo',
        asset_url: urlData.publicUrl,
        storage_path: filePath,
        file_size: file.size,
        mime_type: file.type
      })
      .select()
      .single();

    if (assetError) {
      console.error('Error saving asset:', assetError);
      throw assetError;
    }

    // Update branding with logo URL
    await this.updateBranding({ logo_url: urlData.publicUrl });

    return { url: urlData.publicUrl, asset: assetData };
  }

  // Upload icon
  async uploadIcon(file, businessId) {
    if (!businessId) businessId = this.businessId;
    if (!businessId) throw new Error('Business ID is required');

    const fileExt = file.name.split('.').pop();
    const fileName = `${businessId}/icon-${Date.now()}.${fileExt}`;
    const filePath = `${fileName}`;

    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('appbuilder-assets')
      .upload(filePath, file);

    if (uploadError) {
      console.error('Error uploading icon:', uploadError);
      throw uploadError;
    }

    const { data: urlData } = supabase.storage
      .from('appbuilder-assets')
      .getPublicUrl(filePath);

    const { data: assetData, error: assetError } = await supabase
      .from('app_assets')
      .insert({
        business_id: businessId,
        asset_type: 'icon',
        asset_url: urlData.publicUrl,
        storage_path: filePath,
        file_size: file.size,
        mime_type: file.type
      })
      .select()
      .single();

    if (assetError) {
      console.error('Error saving asset:', assetError);
      throw assetError;
    }

    return { url: urlData.publicUrl, asset: assetData };
  }

  // Upload favicon
  async uploadFavicon(file, businessId) {
    if (!businessId) businessId = this.businessId;
    if (!businessId) throw new Error('Business ID is required');
    assertBrandingFileAllowed(file, 'favicon');

    const fileExt = file.name.split('.').pop();
    const fileName = `${businessId}/favicon-${Date.now()}.${fileExt}`;
    const filePath = `${fileName}`;

    // Upload to storage
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('appbuilder-assets')
      .upload(filePath, file, {
        cacheControl: '3600',
        upsert: false
      });

    if (uploadError) {
      console.error('Error uploading favicon:', uploadError);
      throw uploadError;
    }

    // Get public URL
    const { data: urlData } = supabase.storage
      .from('appbuilder-assets')
      .getPublicUrl(filePath);

    // Save to app_assets table
    const { data: assetData, error: assetError } = await supabase
      .from('app_assets')
      .insert({
        business_id: businessId,
        asset_type: 'favicon',
        asset_url: urlData.publicUrl,
        storage_path: filePath,
        file_size: file.size,
        mime_type: file.type
      })
      .select()
      .single();

    if (assetError) {
      console.error('Error saving asset:', assetError);
      throw assetError;
    }

    // Update branding with favicon URL
    await this.updateBranding({ favicon_url: urlData.publicUrl });

    return { url: urlData.publicUrl, asset: assetData };
  }

  // Upload splash screen
  async uploadSplash(file, businessId) {
    if (!businessId) businessId = this.businessId;
    if (!businessId) throw new Error('Business ID is required');
    assertBrandingFileAllowed(file, 'logo');

    const fileExt = file.name.split('.').pop();
    const fileName = `${businessId}/splash-${Date.now()}.${fileExt}`;
    const filePath = `${fileName}`;

    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('appbuilder-assets')
      .upload(filePath, file);

    if (uploadError) {
      console.error('Error uploading splash:', uploadError);
      throw uploadError;
    }

    const { data: urlData } = supabase.storage
      .from('appbuilder-assets')
      .getPublicUrl(filePath);

    const { data: assetData, error: assetError } = await supabase
      .from('app_assets')
      .insert({
        business_id: businessId,
        asset_type: 'splash',
        asset_url: urlData.publicUrl,
        storage_path: filePath,
        file_size: file.size,
        mime_type: file.type
      })
      .select()
      .single();

    if (assetError) {
      console.error('Error saving asset:', assetError);
      throw assetError;
    }

    return { url: urlData.publicUrl, asset: assetData };
  }

  // Generate PWA manifest
  async generatePWAManifest() {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    const branding = await this.getBranding();

    const manifest = {
      name: branding.app_name || 'Tavari App',
      short_name: branding.app_name || 'Tavari',
      description: `${branding.app_name || 'Tavari'} App`,
      start_url: '/',
      display: 'standalone',
      background_color: branding.primary_color || '#ffffff',
      theme_color: branding.primary_color || '#3B82F6',
      icons: [
        {
          src: branding.logo_url || '/logo.png',
          sizes: '192x192',
          type: 'image/png'
        },
        {
          src: branding.favicon_url || '/favicon.png',
          sizes: '512x512',
          type: 'image/png'
        }
      ]
    };

    // Update PWA settings in branding
    await this.updateBranding({
      pwa_settings: manifest
    });

    return manifest;
  }
}

export default new AppBuilderBrandingService();

