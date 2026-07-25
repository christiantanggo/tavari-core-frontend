// src/services/PartyHostService.js
import { supabase } from '../supabaseClient';
import toast from 'react-hot-toast';

class PartyHostService {
  constructor() {
    this.businessId = null;
    this.isInitialized = false;
    this.cache = new Map();
  }

  initialize(businessId) {
    this.businessId = businessId;
    this.isInitialized = true;
  }

  clearCache() {
    this.cache.clear();
  }

  /**
   * Execute query with retry logic
   */
  async executeWithRetry(queryFn, retries = 3) {
    for (let i = 0; i < retries; i++) {
      try {
        return await queryFn();
      } catch (error) {
        if (i === retries - 1) throw error;
        await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
      }
    }
  }

  /**
   * Load all party hosts
   * @returns {Promise<Array>} Array of party hosts
   */
  async loadPartyHosts() {
    if (!this.businessId) {
      throw new Error('Service not initialized. Call initialize() first.');
    }

    try {
      const { data, error } = await this.executeWithRetry(() =>
        supabase
          .from('digital_signage_party_hosts')
          .select(`
            *,
            screen:digital_signage_screens(screen_name)
          `)
          .eq('business_id', this.businessId)
          .eq('is_active', true)
          .order('created_at', { ascending: false })
      );

      if (error) throw error;
      return data || [];
    } catch (error) {
      console.error('Error loading party hosts:', error);
      toast.error('Failed to load party hosts');
      throw error;
    }
  }

  /**
   * Load party host by ID with sequences and photos
   * @param {string} hostId - Party host ID
   * @returns {Promise<Object>} Party host with sequences and photos
   */
  async loadPartyHost(hostId) {
    if (!this.businessId) {
      throw new Error('Service not initialized. Call initialize() first.');
    }

    try {
      const { data: host, error: hostError } = await supabase
        .from('digital_signage_party_hosts')
        .select('*')
        .eq('id', hostId)
        .eq('business_id', this.businessId)
        .single();

      if (hostError) throw hostError;

      // Load sequences
      const { data: sequences, error: sequencesError } = await supabase
        .from('digital_signage_party_host_sequences')
        .select('*')
        .eq('party_host_id', hostId)
        .eq('is_active', true)
        .order('sequence_order', { ascending: true });

      if (sequencesError) throw sequencesError;

      // Load photos
      const { data: photos, error: photosError } = await supabase
        .from('digital_signage_party_host_photos')
        .select('*')
        .eq('party_host_id', hostId)
        .eq('is_active', true)
        .order('display_order', { ascending: true });

      if (photosError) throw photosError;

      // Load scheduling event if connected
      let event = null;
      if (host.scheduling_event_id) {
        const { data: eventData } = await supabase
          .from('scheduling_events')
          .select('*')
          .eq('id', host.scheduling_event_id)
          .eq('business_id', this.businessId)
          .single();
        event = eventData;
      }

      return {
        ...host,
        sequences: sequences || [],
        photos: photos || [],
        event: event
      };
    } catch (error) {
      console.error('Error loading party host:', error);
      toast.error('Failed to load party host');
      throw error;
    }
  }

  /**
   * Load available scheduling events (parties)
   * @returns {Promise<Array>} Array of scheduling events
   */
  async loadAvailableEvents() {
    if (!this.businessId) {
      throw new Error('Service not initialized. Call initialize() first.');
    }

    try {
      const { data, error } = await this.executeWithRetry(() =>
        supabase
          .from('scheduling_events')
          .select('*')
          .eq('business_id', this.businessId)
          .gte('event_date', new Date().toISOString().split('T')[0])
          .order('event_date', { ascending: true })
          .order('start_time', { ascending: true })
      );

      if (error) throw error;
      return data || [];
    } catch (error) {
      console.error('Error loading events:', error);
      toast.error('Failed to load events');
      throw error;
    }
  }

  /**
   * Create party host
   * @param {Object} hostData - Host data
   * @returns {Promise<Object>} Created host
   */
  async createPartyHost(hostData) {
    if (!this.businessId) {
      throw new Error('Service not initialized. Call initialize() first.');
    }

    try {
      const hostKey = `party_host_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const { data: { user } } = await supabase.auth.getUser();

      const insertData = {
        business_id: this.businessId,
        host_name: hostData.name,
        host_key: hostKey,
        screen_id: hostData.screenId || null,
        scheduling_event_id: hostData.eventId || null,
        theme_color: hostData.themeColor || '#FF6B9D',
        background_color: hostData.backgroundColor || '#FFFFFF',
        background_image_url: hostData.backgroundImageUrl || null,
        font_family: hostData.fontFamily || 'Arial',
        show_countdown: hostData.showCountdown !== undefined ? hostData.showCountdown : true,
        countdown_target_time: hostData.countdownTargetTime || null,
        countdown_label: hostData.countdownLabel || 'Time Remaining',
        allow_photo_uploads: hostData.allowPhotoUploads !== undefined ? hostData.allowPhotoUploads : true,
        max_photos: hostData.maxPhotos || 20,
        photo_display_duration_seconds: hostData.photoDisplayDuration || 5,
        created_by: user?.id || null
      };

      const { data, error } = await supabase
        .from('digital_signage_party_hosts')
        .insert(insertData)
        .select()
        .single();

      if (error) throw error;

      this.clearCache();
      toast.success('Party host created successfully');
      return data;
    } catch (error) {
      console.error('Error creating party host:', error);
      toast.error('Failed to create party host');
      throw error;
    }
  }

  /**
   * Update party host
   * @param {string} hostId - Host ID
   * @param {Object} updates - Update data
   * @returns {Promise<Object>} Updated host
   */
  async updatePartyHost(hostId, updates) {
    if (!this.businessId) {
      throw new Error('Service not initialized. Call initialize() first.');
    }

    try {
      const { data, error } = await supabase
        .from('digital_signage_party_hosts')
        .update(updates)
        .eq('id', hostId)
        .eq('business_id', this.businessId)
        .select()
        .single();

      if (error) throw error;

      this.clearCache();
      toast.success('Party host updated successfully');
      return data;
    } catch (error) {
      console.error('Error updating party host:', error);
      toast.error('Failed to update party host');
      throw error;
    }
  }

  /**
   * Delete party host (soft delete)
   * @param {string} hostId - Host ID
   * @returns {Promise<void>}
   */
  async deletePartyHost(hostId) {
    if (!this.businessId) {
      throw new Error('Service not initialized. Call initialize() first.');
    }

    try {
      const { error } = await supabase
        .from('digital_signage_party_hosts')
        .update({ is_active: false })
        .eq('id', hostId)
        .eq('business_id', this.businessId);

      if (error) throw error;

      this.clearCache();
      toast.success('Party host deleted successfully');
    } catch (error) {
      console.error('Error deleting party host:', error);
      toast.error('Failed to delete party host');
      throw error;
    }
  }

  /**
   * Add sequence to party host
   * @param {string} hostId - Host ID
   * @param {Object} sequenceData - Sequence data
   * @returns {Promise<Object>} Created sequence
   */
  async addSequence(hostId, sequenceData) {
    if (!this.businessId) {
      throw new Error('Service not initialized. Call initialize() first.');
    }

    try {
      const { data: { user } } = await supabase.auth.getUser();

      const insertData = {
        business_id: this.businessId,
        party_host_id: hostId,
        sequence_order: sequenceData.order,
        activity_name: sequenceData.name,
        activity_type: sequenceData.type,
        start_time_offset_minutes: sequenceData.startTimeOffset || 0,
        duration_minutes: sequenceData.duration || null,
        background_color: sequenceData.backgroundColor || null,
        background_image_url: sequenceData.backgroundImageUrl || null,
        display_text: sequenceData.displayText || null,
        show_countdown: sequenceData.showCountdown || false,
        show_photos: sequenceData.showPhotos !== undefined ? sequenceData.showPhotos : true,
        custom_image_url: sequenceData.customImageUrl || null,
        custom_message: sequenceData.customMessage || null,
        created_by: user?.id || null
      };

      const { data, error } = await supabase
        .from('digital_signage_party_host_sequences')
        .insert(insertData)
        .select()
        .single();

      if (error) throw error;

      this.clearCache();
      toast.success('Sequence added successfully');
      return data;
    } catch (error) {
      console.error('Error adding sequence:', error);
      toast.error('Failed to add sequence');
      throw error;
    }
  }

  /**
   * Update sequence
   * @param {string} sequenceId - Sequence ID
   * @param {Object} updates - Update data
   * @returns {Promise<Object>} Updated sequence
   */
  async updateSequence(sequenceId, updates) {
    if (!this.businessId) {
      throw new Error('Service not initialized. Call initialize() first.');
    }

    try {
      const { data, error } = await supabase
        .from('digital_signage_party_host_sequences')
        .update(updates)
        .eq('id', sequenceId)
        .eq('business_id', this.businessId)
        .select()
        .single();

      if (error) throw error;

      this.clearCache();
      toast.success('Sequence updated successfully');
      return data;
    } catch (error) {
      console.error('Error updating sequence:', error);
      toast.error('Failed to update sequence');
      throw error;
    }
  }

  /**
   * Delete sequence
   * @param {string} sequenceId - Sequence ID
   * @returns {Promise<void>}
   */
  async deleteSequence(sequenceId) {
    if (!this.businessId) {
      throw new Error('Service not initialized. Call initialize() first.');
    }

    try {
      const { error } = await supabase
        .from('digital_signage_party_host_sequences')
        .update({ is_active: false })
        .eq('id', sequenceId)
        .eq('business_id', this.businessId);

      if (error) throw error;

      this.clearCache();
      toast.success('Sequence deleted successfully');
    } catch (error) {
      console.error('Error deleting sequence:', error);
      toast.error('Failed to delete sequence');
      throw error;
    }
  }

  /**
   * Upload photo for party host
   * @param {string} hostId - Host ID
   * @param {File} file - Photo file
   * @param {Object} metadata - Photo metadata
   * @param {Function} onProgress - Progress callback
   * @returns {Promise<Object>} Created photo record
   */
  async uploadPhoto(hostId, file, metadata = {}, onProgress) {
    if (!this.businessId) {
      throw new Error('Service not initialized. Call initialize() first.');
    }

    try {
      const { data: { user } } = await supabase.auth.getUser();
      const fileName = `${this.businessId}/${hostId}/${Date.now()}_${file.name}`;

      // Upload to storage
      const { error: uploadError } = await supabase.storage
        .from('digital-signage-content')
        .upload(fileName, file, {
          cacheControl: '3600',
          upsert: false,
          onUploadProgress: (progress) => {
            if (onProgress) {
              const percent = (progress.loaded / progress.total) * 100;
              onProgress(percent);
            }
          }
        });

      if (uploadError) throw uploadError;

      // Get public URL
      const { data: urlData } = supabase.storage
        .from('digital-signage-content')
        .getPublicUrl(fileName);

      // Create photo record
      const insertData = {
        business_id: this.businessId,
        party_host_id: hostId,
        photo_url: urlData.publicUrl,
        photo_path: fileName,
        file_name: file.name,
        file_size: file.size,
        mime_type: file.type,
        display_order: metadata.displayOrder || 0,
        caption: metadata.caption || null,
        child_name: metadata.childName || null,
        uploaded_by: user?.id || null,
        uploaded_by_name: metadata.uploadedByName || null
      };

      const { data, error } = await supabase
        .from('digital_signage_party_host_photos')
        .insert(insertData)
        .select()
        .single();

      if (error) throw error;

      this.clearCache();
      toast.success('Photo uploaded successfully');
      return data;
    } catch (error) {
      console.error('Error uploading photo:', error);
      toast.error(`Photo upload failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Delete photo
   * @param {string} photoId - Photo ID
   * @returns {Promise<void>}
   */
  async deletePhoto(photoId) {
    if (!this.businessId) {
      throw new Error('Service not initialized. Call initialize() first.');
    }

    try {
      // Get photo record first to delete from storage
      const { data: photo, error: fetchError } = await supabase
        .from('digital_signage_party_host_photos')
        .select('photo_path')
        .eq('id', photoId)
        .eq('business_id', this.businessId)
        .single();

      if (fetchError) throw fetchError;

      // Delete from storage
      if (photo.photo_path) {
        await supabase.storage
          .from('digital-signage-content')
          .remove([photo.photo_path]);
      }

      // Delete record
      const { error } = await supabase
        .from('digital_signage_party_host_photos')
        .update({ is_active: false })
        .eq('id', photoId)
        .eq('business_id', this.businessId);

      if (error) throw error;

      this.clearCache();
      toast.success('Photo deleted successfully');
    } catch (error) {
      console.error('Error deleting photo:', error);
      toast.error('Failed to delete photo');
      throw error;
    }
  }

  /**
   * Auto-schedule party host from booking
   * This creates a party host automatically when a party is booked
   * @param {string} eventId - Scheduling event ID
   * @param {string} screenId - Screen ID to display on
   * @returns {Promise<Object>} Created party host
   */
  async autoScheduleFromBooking(eventId, screenId) {
    if (!this.businessId) {
      throw new Error('Service not initialized. Call initialize() first.');
    }

    try {
      // Load event details
      const { data: event, error: eventError } = await supabase
        .from('scheduling_events')
        .select('*')
        .eq('id', eventId)
        .eq('business_id', this.businessId)
        .single();

      if (eventError) throw eventError;

      // Create party host
      const hostData = {
        name: `${event.event_name} - Party Host`,
        screenId: screenId,
        eventId: eventId,
        showCountdown: true,
        countdownTargetTime: event.end_time ? 
          new Date(`${event.event_date}T${event.end_time}`).toISOString() : null,
        allowPhotoUploads: true
      };

      const host = await this.createPartyHost(hostData);

      // Create default sequences based on event timing
      const sequences = [
        { order: 1, name: 'Welcome', type: 'custom', startTimeOffset: 0, duration: 15 },
        { order: 2, name: 'Food Time', type: 'food', startTimeOffset: 15, duration: 30 },
        { order: 3, name: 'Cake Time', type: 'cake', startTimeOffset: 45, duration: 20 },
        { order: 4, name: 'Presents', type: 'presents', startTimeOffset: 65, duration: 20 }
      ];

      for (const seq of sequences) {
        await this.addSequence(host.id, seq);
      }

      toast.success('Party host automatically scheduled');
      return host;
    } catch (error) {
      console.error('Error auto-scheduling party host:', error);
      toast.error('Failed to auto-schedule party host');
      throw error;
    }
  }
}

export default new PartyHostService();



