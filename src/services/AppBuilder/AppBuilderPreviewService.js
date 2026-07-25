// Step 56: Create AppBuilderPreviewService.js
// Service for app preview operations
import { supabase } from '../../supabaseClient';
import QRCode from 'qrcode';

class AppBuilderPreviewService {
  constructor() {
    this.businessId = null;
  }

  setBusinessId(businessId) {
    this.businessId = businessId;
  }

  // Create preview
  async createPreview(expiresInDays = 7) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    // Generate share token
    const shareToken = this.generateShareToken();

    // Calculate expiration
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + expiresInDays);

    // Create preview config
    const { data, error } = await supabase
      .from('app_preview_configs')
      .insert({
        business_id: this.businessId,
        share_token: shareToken,
        preview_url: `${window.location.origin}/preview/${shareToken}`,
        expires_at: expiresAt.toISOString()
      })
      .select()
      .single();

    if (error) {
      console.error('Error creating preview:', error);
      throw error;
    }

    // Generate QR code
    const qrCodeDataURL = await this.generateQRCode(data.preview_url);

    // Update with QR code URL
    const { data: updatedData, error: updateError } = await supabase
      .from('app_preview_configs')
      .update({
        qr_code_url: qrCodeDataURL
      })
      .eq('id', data.id)
      .select()
      .single();

    if (updateError) {
      console.error('Error updating QR code:', updateError);
      // Return data without QR code if update fails
      return data;
    }

    return updatedData;
  }

  // Get preview URL
  async getPreviewUrl(shareToken) {
    const { data, error } = await supabase
      .from('app_preview_configs')
      .select('*')
      .eq('share_token', shareToken)
      .gt('expires_at', new Date().toISOString())
      .single();

    if (error) {
      console.error('Error fetching preview:', error);
      throw error;
    }

    return data;
  }

  // Generate QR code
  async generateQRCode(url) {
    try {
      const qrCodeDataURL = await QRCode.toDataURL(url, {
        width: 300,
        margin: 2
      });
      return qrCodeDataURL;
    } catch (error) {
      console.error('Error generating QR code:', error);
      throw error;
    }
  }

  // Share preview
  async sharePreview(shareToken) {
    const preview = await this.getPreviewUrl(shareToken);
    return {
      url: preview.preview_url,
      qrCode: preview.qr_code_url,
      expiresAt: preview.expires_at
    };
  }

  // Validate share token
  async validateShareToken(shareToken) {
    const { data, error } = await supabase
      .from('app_preview_configs')
      .select('id, business_id, expires_at')
      .eq('share_token', shareToken)
      .gt('expires_at', new Date().toISOString())
      .single();

    if (error || !data) {
      return false;
    }

    return true;
  }

  // Generate share token
  generateShareToken() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let token = '';
    for (let i = 0; i < 32; i++) {
      token += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return token;
  }
}

export default new AppBuilderPreviewService();




