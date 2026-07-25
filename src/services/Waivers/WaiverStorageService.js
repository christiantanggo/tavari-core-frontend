// Step 78: Create WaiverStorageService.js
// Service for paper waiver uploads and storage
import { supabase } from '../../supabaseClient';

class WaiverStorageService {
  constructor() {
    this.businessId = null;
  }

  setBusinessId(businessId) {
    this.businessId = businessId;
  }

  // Upload paper waiver
  async uploadPaperWaiver(file, participantData) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    // Upload file to Supabase Storage
    const filePath = `paper-waivers/${this.businessId}/${Date.now()}-${file.name}`;
    
    const { data: uploadData, error: uploadError } = await supabase
      .storage
      .from('waivers')
      .upload(filePath, file, {
        contentType: file.type,
        upsert: false
      });

    if (uploadError) {
      throw uploadError;
    }

    // Don't store public URL - files are private and will use signed URLs
    // Store file_path only for secure access

    // Generate a placeholder URL (actual access will use signed URLs)
    // The file_url column is NOT NULL, so we store a placeholder
    const placeholderUrl = `waivers://${filePath}`;

    // Create upload record
    const { data: uploadRecord, error: recordError } = await supabase
      .from('waiver_uploads')
      .insert({
        business_id: this.businessId,
        upload_type: 'paper_waiver',
        file_path: filePath,
        file_url: placeholderUrl, // Placeholder - actual access uses signed URLs via file_path
        file_size: file.size,
        mime_type: file.type,
        first_name: participantData.firstName,
        last_name: participantData.lastName,
        date_of_birth: participantData.dateOfBirth || null,
        phone_number: participantData.phoneNumber || null,
        email: participantData.email || null,
        waiver_filled_date: participantData.waiverFilledDate || null,
        uploaded_by: (await supabase.auth.getUser()).data.user?.id,
        notes: file.name ? `Original filename: ${file.name}` : null
      })
      .select()
      .single();

    if (recordError) {
      throw recordError;
    }

    return uploadRecord;
  }

  // Link upload to waiver
  async linkUploadToWaiver(uploadId, waiverId) {
    const { data, error } = await supabase
      .from('waiver_uploads')
      .update({
        waiver_id: waiverId,
        linked_at: new Date().toISOString()
      })
      .eq('id', uploadId)
      .select()
      .single();

    if (error) {
      throw error;
    }

    return data;
  }

  // Get uploaded waivers
  async getUploadedWaivers(filters = {}) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    let query = supabase
      .from('waiver_uploads')
      .select('*')
      .eq('business_id', this.businessId)
      .order('uploaded_at', { ascending: false });

    if (filters.linked !== undefined) {
      if (filters.linked) {
        query = query.not('waiver_id', 'is', null);
      } else {
        query = query.is('waiver_id', null);
      }
    }

    const { data, error } = await query;

    if (error) {
      throw error;
    }

    return data || [];
  }

  // Get signed URL for secure access to waiver file
  // Valid for 1 hour
  async getSignedUrl(filePath, expiresIn = 3600) {
    if (!filePath) {
      return null;
    }

    try {
      const { data, error } = await supabase
        .storage
        .from('waivers')
        .createSignedUrl(filePath, expiresIn);

      if (error) {
        console.error('Error creating signed URL:', error);
        throw error;
      }

      return data?.signedUrl || null;
    } catch (error) {
      console.error('Error generating signed URL:', error);
      throw error;
    }
  }

  // Delete upload
  async deleteUpload(uploadId) {
    // Get upload record
    const { data: upload } = await supabase
      .from('waiver_uploads')
      .select('file_path')
      .eq('id', uploadId)
      .single();

    if (upload?.file_path) {
      // Delete from storage
      await supabase
        .storage
        .from('waivers')
        .remove([upload.file_path]);
    }

    // Delete record
    const { error } = await supabase
      .from('waiver_uploads')
      .delete()
      .eq('id', uploadId);

    if (error) {
      throw error;
    }

    return true;
  }
}

const waiverStorageService = new WaiverStorageService();
export default waiverStorageService;




