// src/services/DigitalSignageService.js
import { supabase } from '../supabaseClient';
import toast from 'react-hot-toast';
import { generateReadableScreenKey } from '../utils/signageScreenKey';
import {
  WAIVER_KIOSK_SCHEDULE_NAME,
  WAIVER_KIOSK_SCHEDULE_TYPE
} from '../constants/digitalSignageSchedules';

const LEGACY_KIOSK_AD_FOLDER = 'waiver-kiosk-ads';
const LEGACY_KIOSK_AD_TAG = 'waiver-kiosk-ad';

/**
 * DigitalSignageService - Central service for digital signage operations
 * Pattern: Matches GlobalMusicService structure
 */
class DigitalSignageService {
  constructor() {
    this.businessId = null;
    this.isInitialized = false;
    this.cache = new Map();
    this.cacheTimeout = 5 * 60 * 1000; // 5 minutes
  }

  /**
   * Initialize service with business ID
   * @param {string} businessId - UUID of business
   */
  initialize(businessId) {
    if (!businessId) {
      throw new Error('Service initialization failed: businessId is required');
    }
    this.businessId = businessId;
    this.isInitialized = true;
    this.clearCache();
    // DigitalSignageService initialized
  }

  /**
   * Clear cache for business
   */
  clearCache() {
    this.cache.clear();
  }

  /**
   * Execute with retry logic
   * @param {Function} operation - Operation to retry
   * @param {number} maxRetries - Maximum retries
   * @returns {Promise} Operation result
   */
  async executeWithRetry(operation, maxRetries = 3) {
    let lastError;
    const baseDelay = 1000; // 1 second
    
    for (let i = 0; i <= maxRetries; i++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        
        // Don't retry on validation or permission errors
        if (error.code === '23505' || error.code === '42501' || error.code === '23503') {
          throw error;
        }
        
        if (i < maxRetries) {
          const delayMs = Math.min(
            baseDelay * Math.pow(2, i),
            10000 // Max 10 seconds
          );
          await new Promise(resolve => setTimeout(resolve, delayMs));
        }
      }
    }
    
    throw lastError;
  }

  /**
   * Load all screens for business
   * @returns {Promise<Array>} Array of screen objects
   */
  async loadScreens() {
    if (!this.businessId) {
      throw new Error('Service not initialized. Call initialize() first.');
    }

    const cacheKey = `screens_${this.businessId}`;
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
      return cached.data;
    }

    try {
      const { data, error } = await this.executeWithRetry(() =>
        supabase
          .from('digital_signage_screens')
          .select(`
            *,
            group:digital_signage_screen_groups(group_name, color_code),
            current_schedule:digital_signage_schedules(schedule_name, schedule_type)
          `)
          .eq('business_id', this.businessId)
          .eq('is_active', true)
          .order('screen_name', { ascending: true })
      );

      if (error) throw error;
      
      const result = data || [];
      this.cache.set(cacheKey, { data: result, timestamp: Date.now() });
      return result;
    } catch (error) {
      console.error('Error loading screens:', error);
      toast.error('Failed to load screens');
      throw error;
    }
  }

  /**
   * Load content library with filters
   * @param {Object} filters - Filter options
   * @returns {Promise<Array>} Array of content objects
   */
  async loadContent(filters = {}) {
    if (!this.businessId) {
      throw new Error('Service not initialized. Call initialize() first.');
    }

    try {
      let query = supabase
        .from('digital_signage_content')
        .select('*')
        .eq('business_id', this.businessId)
        .eq('is_active', true);

      if (filters.contentType) {
        query = query.eq('content_type', filters.contentType);
      }

      if (filters.folderPath) {
        query = query.eq('folder_path', filters.folderPath);
      }

      if (filters.tags && filters.tags.length > 0) {
        query = query.contains('tags', filters.tags);
      }

      if (filters.search) {
        query = query.ilike('content_name', `%${filters.search}%`);
      }

      query = query.order('created_at', { ascending: false });

      const { data, error } = await this.executeWithRetry(() => query);

      if (error) throw error;
      return data || [];
    } catch (error) {
      console.error('Error loading content:', error);
      toast.error('Failed to load content');
      throw error;
    }
  }

  /**
   * Upload content file to storage
   * @param {File} file - File to upload
   * @param {Object} metadata - Content metadata
   * @param {Function} onProgress - Progress callback
   * @returns {Promise<Object>} Upload result
   */
  async uploadContent(file, metadata = {}, onProgress = null) {
    if (!this.businessId) {
      throw new Error('Service not initialized. Call initialize() first.');
    }

    let fileName = null;
    try {
      // Validate file
      const maxSize = 500 * 1024 * 1024; // 500MB
      if (file.size > maxSize) {
        throw new Error('File size exceeds 500MB limit');
      }

      // Sanitize filename
      const sanitizedFileName = file.name
        .replace(/[^a-zA-Z0-9._-]/g, '_')
        .replace(/\s+/g, '_')
        .toLowerCase();

      fileName = `${this.businessId}/${Date.now()}_${sanitizedFileName}`;

      // Upload to storage
      const { error: uploadError } = await supabase.storage
        .from('digital-signage-content')
        .upload(fileName, file, {
          cacheControl: '3600',
          upsert: false,
          onUploadProgress: onProgress ? (progress) => {
            const percent = (progress.loaded / progress.total) * 100;
            onProgress(percent);
          } : undefined
        });

      if (uploadError) throw uploadError;

      // Get public URL
      const { data: urlData } = supabase.storage
        .from('digital-signage-content')
        .getPublicUrl(fileName);

      // Detect content type
      let contentType = 'image';
      if (file.type.startsWith('video/')) {
        contentType = 'video';
      } else if (file.type === 'text/html') {
        contentType = 'html';
      }

      // Get current user
      const { data: { user } } = await supabase.auth.getUser();

      // Get image dimensions if image
      let width = null;
      let height = null;
      if (contentType === 'image') {
        const dimensions = await this.getImageDimensions(file);
        width = dimensions.width;
        height = dimensions.height;
      }

      // Create content record
      const contentData = {
        business_id: this.businessId,
        content_name: metadata.name || file.name.replace(/\.[^/.]+$/, ''),
        content_type: metadata.contentType || contentType,
        file_url: urlData.publicUrl,
        file_path: fileName,
        file_size: file.size,
        mime_type: file.type,
        width: width,
        height: height,
        tags: metadata.tags || [],
        folder_path: metadata.folderPath || null,
        description: metadata.description || null,
        play_start_date: metadata.play_start_date ?? null,
        play_end_date: metadata.play_end_date ?? null,
        created_by: user?.id || null
      };

      const { data: contentRecord, error: dbError } = await supabase
        .from('digital_signage_content')
        .insert(contentData)
        .select()
        .single();

      if (dbError) {
        await supabase.storage
          .from('digital-signage-content')
          .remove([fileName])
          .catch(() => {});
        throw dbError;
      }

      // Clear cache
      this.clearCache();

      toast.success('Content uploaded successfully');
      return contentRecord;
    } catch (error) {
      console.error('Error uploading content:', error);
      toast.error(`Upload failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get image dimensions
   * @param {File} file - Image file
   * @returns {Promise<Object>} Dimensions object
   */
  async getImageDimensions(file) {
    return new Promise((resolve) => {
      const img = new Image();
      const objectUrl = URL.createObjectURL(file);
      const cleanup = () => URL.revokeObjectURL(objectUrl);
      img.onload = () => {
        cleanup();
        resolve({ width: img.width, height: img.height });
      };
      img.onerror = () => {
        cleanup();
        resolve({ width: null, height: null });
      };
      img.src = objectUrl;
    });
  }

  /**
   * Generate a unique readable screen key (xxxx-xxxx).
   * @returns {Promise<string>}
   */
  async generateUniqueScreenKey(maxAttempts = 12) {
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const candidate = generateReadableScreenKey();
      const { data, error } = await supabase
        .from('digital_signage_screens')
        .select('id')
        .eq('screen_key', candidate)
        .maybeSingle();

      if (error) throw error;
      if (!data) return candidate;
    }
    throw new Error('Could not generate a unique screen key. Please try again.');
  }

  /**
   * Create screen
   * @param {Object} screenData - Screen data
   * @returns {Promise<Object>} Created screen
   */
  async createScreen(screenData) {
    if (!this.businessId) {
      throw new Error('Service not initialized. Call initialize() first.');
    }

    try {
      const screenKey = await this.generateUniqueScreenKey();
      const { data: { user } } = await supabase.auth.getUser();

      const insertData = {
        business_id: this.businessId,
        screen_name: screenData.name,
        screen_key: screenKey,
        screen_type: screenData.type || 'standard',
        location_name: screenData.locationName || null,
        resolution_width: screenData.resolutionWidth || null,
        resolution_height: screenData.resolutionHeight || null,
        orientation: screenData.orientation || 'landscape',
        group_id: screenData.groupId || null,
        settings: screenData.settings || {},
        created_by: user?.id || null
      };

      const { data, error } = await supabase
        .from('digital_signage_screens')
        .insert(insertData)
        .select()
        .single();

      if (error) throw error;

      this.clearCache();
      toast.success('Screen created successfully');
      return data;
    } catch (error) {
      console.error('Error creating screen:', error);
      toast.error('Failed to create screen');
      throw error;
    }
  }

  /**
   * Update screen
   * @param {string} screenId - Screen ID
   * @param {Object} updates - Update data
   * @returns {Promise<Object>} Updated screen
   */
  async updateScreen(screenId, updates) {
    if (!this.businessId) {
      throw new Error('Service not initialized. Call initialize() first.');
    }

    try {
      const { data, error } = await supabase
        .from('digital_signage_screens')
        .update(updates)
        .eq('id', screenId)
        .eq('business_id', this.businessId)
        .select()
        .single();

      if (error) throw error;

      this.clearCache();
      toast.success('Screen updated successfully');
      return data;
    } catch (error) {
      console.error('Error updating screen:', error);
      toast.error('Failed to update screen');
      throw error;
    }
  }

  /**
   * Delete screen (soft delete)
   * @param {string} screenId - Screen ID
   * @returns {Promise<void>}
   */
  async deleteScreen(screenId) {
    if (!this.businessId) {
      throw new Error('Service not initialized. Call initialize() first.');
    }

    try {
      const { error } = await supabase
        .from('digital_signage_screens')
        .update({ is_active: false })
        .eq('id', screenId)
        .eq('business_id', this.businessId);

      if (error) throw error;

      this.clearCache();
      toast.success('Screen deleted successfully');
    } catch (error) {
      console.error('Error deleting screen:', error);
      toast.error('Failed to delete screen');
      throw error;
    }
  }

  /**
   * Update screen heartbeat
   * @param {string} screenKey - Screen key
   * @returns {Promise<void>}
   */
  async updateScreenHeartbeat(screenKey) {
    try {
      const { error } = await supabase.rpc('update_screen_heartbeat', {
        screen_key_param: screenKey
      });

      if (error) {
        console.error('Error updating heartbeat:', error);
        // Don't show toast for heartbeat errors (too frequent)
      }
    } catch (error) {
      console.error('Error updating heartbeat:', error);
    }
  }

  /**
   * Ensure the built-in Waiver Kiosks schedule exists for this business.
   * @returns {Promise<object|null>}
   */
  async ensureWaiverKioskSchedule() {
    if (!this.businessId) {
      throw new Error('Service not initialized. Call initialize() first.');
    }

    const { data: existing, error: existingError } = await supabase
      .from('digital_signage_schedules')
      .select('id, schedule_name, schedule_type')
      .eq('business_id', this.businessId)
      .eq('schedule_type', WAIVER_KIOSK_SCHEDULE_TYPE)
      .eq('is_active', true)
      .maybeSingle();

    if (existingError) throw existingError;
    if (existing?.id) {
      await this.migrateLegacyKioskAdsToSchedule(existing.id);
      return existing;
    }

    const { data: bizRow } = await supabase
      .from('businesses')
      .select('timezone')
      .eq('id', this.businessId)
      .maybeSingle();

    const { data: { user } } = await supabase.auth.getUser();

    const { data: created, error: createError } = await supabase
      .from('digital_signage_schedules')
      .insert({
        business_id: this.businessId,
        schedule_name: WAIVER_KIOSK_SCHEDULE_NAME,
        schedule_type: WAIVER_KIOSK_SCHEDULE_TYPE,
        priority: 999,
        timezone: bizRow?.timezone || 'America/Toronto',
        is_active: true,
        created_by: user?.id || null
      })
      .select('id, schedule_name, schedule_type')
      .maybeSingle();

    if (createError) {
      const { data: raced } = await supabase
        .from('digital_signage_schedules')
        .select('id, schedule_name, schedule_type')
        .eq('business_id', this.businessId)
        .eq('schedule_type', WAIVER_KIOSK_SCHEDULE_TYPE)
        .eq('is_active', true)
        .maybeSingle();
      if (raced?.id) {
        await this.migrateLegacyKioskAdsToSchedule(raced.id);
        return raced;
      }
      throw createError;
    }

    if (created?.id) {
      await this.migrateLegacyKioskAdsToSchedule(created.id);
    }
    return created;
  }

  /**
   * One-time import of legacy waiver-kiosk ad rows into the Waiver Kiosks playlist.
   * @param {string} scheduleId
   */
  async migrateLegacyKioskAdsToSchedule(scheduleId) {
    if (!this.businessId || !scheduleId) return;

    const { count, error: countError } = await supabase
      .from('digital_signage_schedule_items')
      .select('id', { count: 'exact', head: true })
      .eq('schedule_id', scheduleId);

    if (countError) throw countError;
    if ((count ?? 0) > 0) return;

    const { data: ads, error: adsError } = await supabase
      .from('digital_signage_ads')
      .select(`
        id,
        content_id,
        created_at,
        content:digital_signage_content (
          id,
          folder_path,
          tags,
          is_active
        )
      `)
      .eq('business_id', this.businessId)
      .eq('is_active', true)
      .order('created_at', { ascending: true });

    if (adsError) throw adsError;

    const kioskAds = (ads || []).filter((row) => {
      const content = row.content;
      if (!content?.id || content.is_active === false) return false;
      const folder = content.folder_path;
      const tags = Array.isArray(content.tags) ? content.tags : [];
      return folder === LEGACY_KIOSK_AD_FOLDER || tags.includes(LEGACY_KIOSK_AD_TAG);
    });

    if (kioskAds.length === 0) return;

    const rows = kioskAds.map((row, index) => ({
      schedule_id: scheduleId,
      content_id: row.content_id,
      display_order: index,
      transition_type: 'fade',
      transition_duration_ms: 500
    }));

    const { error: insertError } = await supabase
      .from('digital_signage_schedule_items')
      .insert(rows);

    if (insertError) throw insertError;
  }

  /**
   * Load schedules
   * @param {Object} filters - Filter options
   * @returns {Promise<Array>} Array of schedules
   */
  async loadSchedules(filters = {}) {
    if (!this.businessId) {
      throw new Error('Service not initialized. Call initialize() first.');
    }

    try {
      await this.ensureWaiverKioskSchedule();

      let query = supabase
        .from('digital_signage_schedules')
        .select(`
          *,
          digital_signage_schedule_items ( count )
        `)
        .eq('business_id', this.businessId)
        .eq('is_active', true);

      if (filters.search) {
        query = query.ilike('schedule_name', `%${filters.search}%`);
      }

      query = query.order('created_at', { ascending: false });

      const { data, error } = await this.executeWithRetry(() => query);

      if (error) throw error;
      const list = data || [];
      list.sort((a, b) => {
        const aWaiver = a.schedule_type === WAIVER_KIOSK_SCHEDULE_TYPE ? 0 : 1;
        const bWaiver = b.schedule_type === WAIVER_KIOSK_SCHEDULE_TYPE ? 0 : 1;
        if (aWaiver !== bWaiver) return aWaiver - bWaiver;
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      });
      return list;
    } catch (error) {
      console.error('Error loading schedules:', error);
      toast.error('Failed to load schedules');
      throw error;
    }
  }

  /**
   * Create schedule
   * @param {Object} scheduleData - Schedule data
   * @returns {Promise<Object>} Created schedule
   */
  async createSchedule(scheduleData) {
    if (!this.businessId) {
      throw new Error('Service not initialized. Call initialize() first.');
    }

    try {
      if (scheduleData.type === WAIVER_KIOSK_SCHEDULE_TYPE) {
        throw new Error('The Waiver Kiosks schedule is created automatically.');
      }

      if (!Array.isArray(scheduleData.screenIds) || scheduleData.screenIds.length === 0) {
        throw new Error('Select at least one screen for this schedule.');
      }

      if ((scheduleData.startTime && !scheduleData.endTime) || (!scheduleData.startTime && scheduleData.endTime)) {
        throw new Error('Set both start and end time, or leave both blank for all day.');
      }

      // Check for conflicts
      if (scheduleData.startTime && scheduleData.endTime && scheduleData.screenIds) {
        const conflicts = await this.checkScheduleConflicts({
          screenIds: scheduleData.screenIds,
          startTime: scheduleData.startTime,
          endTime: scheduleData.endTime,
          daysOfWeek: scheduleData.daysOfWeek || []
        });

        if (conflicts.length > 0) {
          throw new Error(`Schedule conflicts detected`);
        }
      }

      const { data: { user } } = await supabase.auth.getUser();

      const insertData = {
        business_id: this.businessId,
        schedule_name: scheduleData.name,
        schedule_type: scheduleData.type,
        start_date: scheduleData.startDate || null,
        end_date: scheduleData.endDate || null,
        start_time: scheduleData.startTime || null,
        end_time: scheduleData.endTime || null,
        days_of_week: scheduleData.daysOfWeek || null,
        timezone: scheduleData.timezone || 'America/Toronto',
        priority: scheduleData.priority || 1,
        apply_to_screens: scheduleData.screenIds || null,
        apply_to_groups: scheduleData.groupIds || null,
        holiday_rules: scheduleData.holidayRules || {},
        created_by: user?.id || null
      };

      const { data, error } = await supabase
        .from('digital_signage_schedules')
        .insert(insertData)
        .select()
        .single();

      if (error) throw error;

      // Create schedule items if provided
      if (scheduleData.items && scheduleData.items.length > 0) {
        const items = scheduleData.items.map((item, index) => ({
          schedule_id: data.id,
          content_id: item.contentId,
          zone_id: item.zoneId || null,
          display_order: item.displayOrder || index,
          duration_seconds: item.durationSeconds || null,
          transition_type: item.transitionType || 'fade',
          transition_duration_ms: item.transitionDurationMs || 500
        }));

        const { error: itemsError } = await supabase
          .from('digital_signage_schedule_items')
          .insert(items);

        if (itemsError) throw itemsError;
      }

      this.clearCache();
      toast.success('Schedule created successfully');
      return data;
    } catch (error) {
      console.error('Error creating schedule:', error);
      toast.error(`Failed to create schedule: ${error.message}`);
      throw error;
    }
  }

  /**
   * Update schedule
   * @param {string} scheduleId - Schedule ID
   * @param {Object} updates - Update data
   * @returns {Promise<Object>} Updated schedule
   */
  async updateSchedule(scheduleId, updates) {
    if (!this.businessId) {
      throw new Error('Service not initialized. Call initialize() first.');
    }

    try {
      const { data: existing, error: existingError } = await supabase
        .from('digital_signage_schedules')
        .select('schedule_type, apply_to_screens, start_time, end_time, days_of_week')
        .eq('id', scheduleId)
        .eq('business_id', this.businessId)
        .maybeSingle();

      if (existingError) throw existingError;
      if (existing?.schedule_type === WAIVER_KIOSK_SCHEDULE_TYPE) {
        throw new Error('The Waiver Kiosks schedule cannot be edited. Use Manage Playlist.');
      }

      if (Object.prototype.hasOwnProperty.call(updates, 'apply_to_screens')) {
        if (!Array.isArray(updates.apply_to_screens) || updates.apply_to_screens.length === 0) {
          throw new Error('Select at least one screen for this schedule.');
        }
      }

      const nextStartTime = Object.prototype.hasOwnProperty.call(updates, 'start_time')
        ? updates.start_time
        : existing?.start_time;
      const nextEndTime = Object.prototype.hasOwnProperty.call(updates, 'end_time')
        ? updates.end_time
        : existing?.end_time;
      if ((nextStartTime && !nextEndTime) || (!nextStartTime && nextEndTime)) {
        throw new Error('Set both start and end time, or leave both blank for all day.');
      }

      const nextScreens = Object.prototype.hasOwnProperty.call(updates, 'apply_to_screens')
        ? updates.apply_to_screens
        : existing?.apply_to_screens;
      if (nextStartTime && nextEndTime && Array.isArray(nextScreens) && nextScreens.length > 0) {
        const conflicts = await this.checkScheduleConflicts({
          screenIds: nextScreens,
          startTime: nextStartTime,
          endTime: nextEndTime,
          daysOfWeek: Object.prototype.hasOwnProperty.call(updates, 'days_of_week')
            ? updates.days_of_week || []
            : existing?.days_of_week || [],
          excludeScheduleId: scheduleId
        });
        if (conflicts.length > 0) {
          throw new Error('Schedule conflicts detected');
        }
      }

      const { data, error } = await supabase
        .from('digital_signage_schedules')
        .update(updates)
        .eq('id', scheduleId)
        .eq('business_id', this.businessId)
        .select()
        .single();

      if (error) throw error;

      this.clearCache();
      toast.success('Schedule updated successfully');
      return data;
    } catch (error) {
      console.error('Error updating schedule:', error);
      toast.error('Failed to update schedule');
      throw error;
    }
  }

  /**
   * Load playlist items for a schedule (with content details).
   * @param {string} scheduleId
   * @returns {Promise<Array>}
   */
  async loadScheduleItems(scheduleId) {
    if (!this.businessId) {
      throw new Error('Service not initialized. Call initialize() first.');
    }

    try {
      const { data, error } = await supabase
        .from('digital_signage_schedule_items')
        .select(`
          id,
          schedule_id,
          content_id,
          zone_id,
          display_order,
          duration_seconds,
          transition_type,
          transition_duration_ms,
          content:digital_signage_content (
            id,
            content_name,
            content_type,
            duration_seconds,
            play_start_date,
            play_end_date,
            is_active
          )
        `)
        .eq('schedule_id', scheduleId)
        .order('display_order', { ascending: true });

      if (error) throw error;
      return (data || []).filter((row) => row.content?.id && row.content?.is_active !== false);
    } catch (error) {
      console.error('Error loading schedule items:', error);
      toast.error('Failed to load playlist');
      throw error;
    }
  }

  /**
   * Replace all playlist items for a schedule.
   * @param {string} scheduleId
   * @param {Array<{ contentId: string, durationSeconds?: number|null, zoneId?: string|null, transitionType?: string, transitionDurationMs?: number }>} items
   */
  async replaceScheduleItems(scheduleId, items = [], { shufflePlaylist = false } = {}) {
    if (!this.businessId) {
      throw new Error('Service not initialized. Call initialize() first.');
    }

    try {
      const rows = items.map((item) => ({
        contentId: item.contentId,
        zoneId: item.zoneId || null,
        durationSeconds: item.durationSeconds ?? null,
        transitionType: item.transitionType || 'fade',
        transitionDurationMs: item.transitionDurationMs ?? 500
      }));

      const { error: rpcError } = await supabase.rpc('replace_digital_signage_schedule_items', {
        schedule_uuid: scheduleId,
        business_uuid: this.businessId,
        items: rows,
        shuffle_playlist_param: !!shufflePlaylist
      });

      if (rpcError) throw rpcError;

      this.clearCache();
      toast.success('Playlist saved');
    } catch (error) {
      console.error('Error saving schedule items:', error);
      toast.error('Failed to save playlist');
      throw error;
    }
  }

  /**
   * Delete schedule (soft delete)
   * @param {string} scheduleId - Schedule ID
   * @returns {Promise<void>}
   */
  async deleteSchedule(scheduleId) {
    if (!this.businessId) {
      throw new Error('Service not initialized. Call initialize() first.');
    }

    try {
      const { data: schedule, error: scheduleError } = await supabase
        .from('digital_signage_schedules')
        .select('schedule_type')
        .eq('id', scheduleId)
        .eq('business_id', this.businessId)
        .maybeSingle();

      if (scheduleError) throw scheduleError;
      if (schedule?.schedule_type === WAIVER_KIOSK_SCHEDULE_TYPE) {
        throw new Error('The Waiver Kiosks schedule cannot be deleted.');
      }

      const { error } = await supabase
        .from('digital_signage_schedules')
        .update({ is_active: false })
        .eq('id', scheduleId)
        .eq('business_id', this.businessId);

      if (error) throw error;

      this.clearCache();
      toast.success('Schedule deleted successfully');
    } catch (error) {
      console.error('Error deleting schedule:', error);
      toast.error(error?.message || 'Failed to delete schedule');
      throw error;
    }
  }

  /**
   * Check for schedule conflicts
   * @param {Object} params - Conflict check parameters
   * @returns {Promise<Array>} Array of conflicts
   */
  async checkScheduleConflicts(params) {
    if (!this.businessId) {
      throw new Error('Service not initialized. Call initialize() first.');
    }

    try {
      const { data, error } = await supabase.rpc('check_schedule_conflicts', {
        business_uuid: this.businessId,
        screen_ids: params.screenIds || [],
        start_time_param: params.startTime || null,
        end_time_param: params.endTime || null,
        days_param: params.daysOfWeek || [],
        exclude_schedule_id: params.excludeScheduleId || null
      });

      if (error) throw error;
      return data || [];
    } catch (error) {
      console.error('Error checking conflicts:', error);
      throw error;
    }
  }

  /**
   * Load screen groups
   * @returns {Promise<Array>} Array of screen groups
   */
  async loadScreenGroups() {
    if (!this.businessId) {
      throw new Error('Service not initialized. Call initialize() first.');
    }

    try {
      const { data, error } = await this.executeWithRetry(() =>
        supabase
          .from('digital_signage_screen_groups')
          .select('*')
          .eq('business_id', this.businessId)
          .eq('is_active', true)
          .order('group_name', { ascending: true })
      );

      if (error) throw error;
      return data || [];
    } catch (error) {
      console.error('Error loading screen groups:', error);
      throw error;
    }
  }

  /**
   * Load zones
   * @param {Object} filters - Filter options
   * @returns {Promise<Array>} Array of zones
   */
  async loadZones(filters = {}) {
    if (!this.businessId) {
      throw new Error('Service not initialized. Call initialize() first.');
    }

    try {
      let query = supabase
        .from('digital_signage_zones')
        .select(`
          *,
          screen:digital_signage_screens(screen_name),
          template:digital_signage_templates(template_name)
        `)
        .eq('business_id', this.businessId)
        .eq('is_active', true);

      if (filters.screenId) {
        query = query.eq('screen_id', filters.screenId);
      }

      query = query.order('created_at', { ascending: false });

      const { data, error } = await this.executeWithRetry(() => query);

      if (error) throw error;
      return data || [];
    } catch (error) {
      console.error('Error loading zones:', error);
      toast.error('Failed to load zones');
      throw error;
    }
  }

  /**
   * Create zone
   * @param {Object} zoneData - Zone data
   * @returns {Promise<Object>} Created zone
   */
  async createZone(zoneData) {
    if (!this.businessId) {
      throw new Error('Service not initialized. Call initialize() first.');
    }

    try {
      const { data: { user } } = await supabase.auth.getUser();
      const zoneKey = `zone_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

      const insertData = {
        business_id: this.businessId,
        zone_name: zoneData.name,
        zone_key: zoneKey,
        screen_id: zoneData.screenId || null,
        template_id: zoneData.templateId || null,
        position_x: zoneData.positionX ?? 0,
        position_y: zoneData.positionY ?? 0,
        width: zoneData.width ?? 100,
        height: zoneData.height ?? 100,
        position_unit: zoneData.positionUnit || 'percent',
        z_index: zoneData.zIndex ?? 0,
        background_color: zoneData.backgroundColor || null,
        border_style: zoneData.borderStyle || {},
        created_by: user?.id || null
      };

      const { data, error } = await supabase
        .from('digital_signage_zones')
        .insert(insertData)
        .select()
        .single();

      if (error) throw error;

      this.clearCache();
      toast.success('Zone created successfully');
      return data;
    } catch (error) {
      console.error('Error creating zone:', error);
      toast.error('Failed to create zone');
      throw error;
    }
  }

  /**
   * Update zone
   * @param {string} zoneId - Zone ID
   * @param {Object} updates - Update data
   * @returns {Promise<Object>} Updated zone
   */
  async updateZone(zoneId, updates) {
    if (!this.businessId) {
      throw new Error('Service not initialized. Call initialize() first.');
    }

    try {
      const { data, error } = await supabase
        .from('digital_signage_zones')
        .update(updates)
        .eq('id', zoneId)
        .eq('business_id', this.businessId)
        .select()
        .single();

      if (error) throw error;

      this.clearCache();
      toast.success('Zone updated successfully');
      return data;
    } catch (error) {
      console.error('Error updating zone:', error);
      toast.error('Failed to update zone');
      throw error;
    }
  }

  /**
   * Delete zone (soft delete)
   * @param {string} zoneId - Zone ID
   * @returns {Promise<void>}
   */
  async deleteZone(zoneId) {
    if (!this.businessId) {
      throw new Error('Service not initialized. Call initialize() first.');
    }

    try {
      const { error } = await supabase
        .from('digital_signage_zones')
        .update({ is_active: false })
        .eq('id', zoneId)
        .eq('business_id', this.businessId);

      if (error) throw error;

      this.clearCache();
      toast.success('Zone deleted successfully');
    } catch (error) {
      console.error('Error deleting zone:', error);
      toast.error('Failed to delete zone');
      throw error;
    }
  }

  /**
   * Load ads
   * @param {Object} filters - Filter options
   * @returns {Promise<Array>} Array of ads
   */
  async loadAds(filters = {}) {
    if (!this.businessId) {
      throw new Error('Service not initialized. Call initialize() first.');
    }

    try {
      let query = supabase
        .from('digital_signage_ads')
        .select(`
          *,
          content:digital_signage_content(id, content_name, file_url, file_path, folder_path, tags, content_type),
          campaign:digital_signage_ad_campaigns(campaign_name)
        `)
        .eq('business_id', this.businessId)
        .eq('is_active', true);

      if (filters.status) {
        query = query.eq('status', filters.status);
      }

      query = query.order('created_at', { ascending: false });

      const { data, error } = await this.executeWithRetry(() => query);

      if (error) throw error;
      return data || [];
    } catch (error) {
      console.error('Error loading ads:', error);
      toast.error('Failed to load ads');
      throw error;
    }
  }

  /**
   * Create ad
   * @param {Object} adData - Ad data
   * @returns {Promise<Object>} Created ad
   */
  async createAd(adData) {
    if (!this.businessId) {
      throw new Error('Service not initialized. Call initialize() first.');
    }

    try {
      const { data: { user } } = await supabase.auth.getUser();

      const insertData = {
        business_id: this.businessId,
        ad_name: adData.name,
        ad_type: adData.type || 'local',
        content_id: adData.contentId,
        advertiser_name: adData.advertiserName || null,
        start_date: adData.startDate || null,
        end_date: adData.endDate || null,
        start_time: adData.startTime || null,
        end_time: adData.endTime || null,
        days_of_week: adData.daysOfWeek || null,
        max_impressions: adData.maxImpressions || null,
        max_clicks: adData.maxClicks || null,
        cpm_rate: adData.cpmRate || null,
        cpc_rate: adData.cpcRate || null,
        click_url: adData.clickUrl || null,
        audience: adData.audience || 'venue',
        status: adData.status || 'draft',
        created_by: user?.id || null
      };

      const { data, error } = await supabase
        .from('digital_signage_ads')
        .insert(insertData)
        .select()
        .single();

      if (error) throw error;

      this.clearCache();
      toast.success('Ad created successfully');
      return data;
    } catch (error) {
      console.error('Error creating ad:', error);
      toast.error(`Failed to create ad: ${error.message}`);
      throw error;
    }
  }

  /**
   * Update ad
   * @param {string} adId - Ad ID
   * @param {Object} updates - Update data
   * @returns {Promise<Object>} Updated ad
   */
  async updateAd(adId, updates) {
    if (!this.businessId) {
      throw new Error('Service not initialized. Call initialize() first.');
    }

    try {
      const { data, error } = await supabase
        .from('digital_signage_ads')
        .update(updates)
        .eq('id', adId)
        .eq('business_id', this.businessId)
        .select()
        .single();

      if (error) throw error;

      this.clearCache();
      toast.success('Ad updated successfully');
      return data;
    } catch (error) {
      console.error('Error updating ad:', error);
      toast.error('Failed to update ad');
      throw error;
    }
  }

  /**
   * Delete ad (soft delete)
   * @param {string} adId - Ad ID
   * @returns {Promise<void>}
   */
  async deleteAd(adId) {
    if (!this.businessId) {
      throw new Error('Service not initialized. Call initialize() first.');
    }

    try {
      const { error } = await supabase
        .from('digital_signage_ads')
        .update({ is_active: false })
        .eq('id', adId)
        .eq('business_id', this.businessId);

      if (error) throw error;

      this.clearCache();
      toast.success('Ad deleted successfully');
    } catch (error) {
      console.error('Error deleting ad:', error);
      toast.error('Failed to delete ad');
      throw error;
    }
  }

  /**
   * Load templates
   * @param {Object} filters - Filter options
   * @returns {Promise<Array>} Array of templates
   */
  async loadTemplates(filters = {}) {
    if (!this.businessId) {
      throw new Error('Service not initialized. Call initialize() first.');
    }

    try {
      let query = supabase
        .from('digital_signage_templates')
        .select('*')
        .eq('business_id', this.businessId)
        .eq('is_active', true);

      if (filters.templateType) {
        query = query.eq('template_type', filters.templateType);
      }

      if (filters.isPublic) {
        query = query.eq('is_public', true);
      }

      query = query.order('created_at', { ascending: false });

      const { data, error } = await this.executeWithRetry(() => query);

      if (error) throw error;
      return data || [];
    } catch (error) {
      console.error('Error loading templates:', error);
      toast.error('Failed to load templates');
      throw error;
    }
  }

  /**
   * Create screen group
   * @param {Object} groupData - Group data
   * @returns {Promise<Object>} Created group
   */
  async createScreenGroup(groupData) {
    if (!this.businessId) {
      throw new Error('Service not initialized. Call initialize() first.');
    }

    try {
      const groupKey = `group_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const { data: { user } } = await supabase.auth.getUser();

      const insertData = {
        business_id: this.businessId,
        group_name: groupData.name,
        group_key: groupKey,
        description: groupData.description || null,
        color_code: groupData.colorCode || '#3B82F6',
        created_by: user?.id || null
      };

      const { data, error } = await supabase
        .from('digital_signage_screen_groups')
        .insert(insertData)
        .select()
        .single();

      if (error) throw error;

      this.clearCache();
      toast.success('Screen group created successfully');
      return data;
    } catch (error) {
      console.error('Error creating screen group:', error);
      toast.error('Failed to create screen group');
      throw error;
    }
  }

  /**
   * Delete content (soft delete)
   * @param {string} contentId - Content ID
   * @returns {Promise<void>}
   */
  async deleteContent(contentId) {
    if (!this.businessId) {
      throw new Error('Service not initialized. Call initialize() first.');
    }

    try {
      const { error } = await supabase
        .from('digital_signage_content')
        .update({ is_active: false })
        .eq('id', contentId)
        .eq('business_id', this.businessId);

      if (error) throw error;

      this.clearCache();
      toast.success('Content deleted successfully');
    } catch (error) {
      console.error('Error deleting content:', error);
      toast.error('Failed to delete content');
      throw error;
    }
  }

  /**
   * Update content
   * @param {string} contentId - Content ID
   * @param {Object} updates - Update data
   * @returns {Promise<Object>} Updated content
   */
  async updateContent(contentId, updates) {
    if (!this.businessId) {
      throw new Error('Service not initialized. Call initialize() first.');
    }

    try {
      const { data, error } = await supabase
        .from('digital_signage_content')
        .update(updates)
        .eq('id', contentId)
        .eq('business_id', this.businessId)
        .select()
        .single();

      if (error) throw error;

      this.clearCache();
      toast.success('Content updated successfully');
      return data;
    } catch (error) {
      console.error('Error updating content:', error);
      toast.error('Failed to update content');
      throw error;
    }
  }
}

// Export singleton instance
const digitalSignageService = new DigitalSignageService();
export default digitalSignageService;

