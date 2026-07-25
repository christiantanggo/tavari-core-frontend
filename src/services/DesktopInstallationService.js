// src/services/DesktopInstallationService.js
// Service to automatically register desktop installations when downloaded from business account
import { supabase } from '../supabaseClient';

class DesktopInstallationService {
  constructor() {
    this.isElectron = !!window.electronAPI;
    this.registrationAttempted = false;
    this.installationId = null;
    this.lastSeenInterval = null;
  }

  /**
   * Auto-register installation if:
   * 1. Running in Electron
   * 2. Has business ID from session
   * 3. No existing installation found
   */
  async autoRegisterInstallation(businessId) {
    if (!this.isElectron || !businessId) {
      console.log('🔍 [DesktopInstallationService] Skipping auto-registration:', {
        isElectron: this.isElectron,
        hasBusinessId: !!businessId
      });
      return null;
    }

    if (this.registrationAttempted) {
      console.log('🔍 [DesktopInstallationService] Registration already attempted, skipping');
      return null;
    }

    this.registrationAttempted = true;

    try {
      console.log('🔍 [DesktopInstallationService] Starting auto-registration for business:', businessId);
      
      // Get device info
      const systemInfo = await window.electronAPI.getSystemInfo();
      console.log('📡 [DesktopInstallationService] System info received:', systemInfo);
      
      if (!systemInfo?.fingerprint) {
        console.warn('⚠️ [DesktopInstallationService] No fingerprint available in system info');
        console.warn('⚠️ [DesktopInstallationService] This usually means the desktop app needs to be rebuilt');
        console.warn('⚠️ [DesktopInstallationService] System info keys:', systemInfo ? Object.keys(systemInfo) : 'null');
        return null;
      }

      console.log('✅ [DesktopInstallationService] Device fingerprint found:', systemInfo.fingerprint);

      // Check if already registered
      const { data: existing, error: checkError } = await supabase
        .from('music_installations')
        .select('id, device_name, business_id, status')
        .eq('device_fingerprint', systemInfo.fingerprint)
        .eq('business_id', businessId)
        .eq('status', 'active')
        .maybeSingle();

      if (checkError && checkError.code !== 'PGRST116') {
        console.error('❌ [DesktopInstallationService] Error checking existing installation:', checkError);
        return null;
      }

      if (existing) {
        console.log('✅ [DesktopInstallationService] Installation already exists:', existing.id);
        // Start periodic last_seen updates
        this.installationId = existing.id;
        this.startLastSeenUpdates(existing.id);
        return existing.id;
      }

      console.log('🆕 [DesktopInstallationService] No existing installation found, creating new one...');

      // Generate device name
      const deviceName = systemInfo.device_name || 
                        systemInfo.computer_name || 
                        `Desktop Kiosk (${systemInfo.fingerprint.substring(0, 8)})`;

      // Create installation record
      const installationData = {
        business_id: businessId,
        device_fingerprint: systemInfo.fingerprint,
        device_name: deviceName,
        windows_version: systemInfo.windows_version || null,
        app_version: systemInfo.app_version || '1.0.0',
        license_type: 'free', // Auto-registered from business account
        status: 'active',
        installed_at: new Date().toISOString(),
        last_seen: new Date().toISOString()
      };

      console.log('📝 [DesktopInstallationService] Creating installation:', installationData);

      const { data: installation, error: createError } = await supabase
        .from('music_installations')
        .insert(installationData)
        .select()
        .single();

      if (createError) {
        console.error('❌ [DesktopInstallationService] Error creating installation:', createError);
        
        // If it's a duplicate key error, try to find it
        if (createError.code === '23505') {
          console.log('🔄 [DesktopInstallationService] Duplicate key - installation may have been created by another process');
          const { data: found } = await supabase
            .from('music_installations')
            .select('id')
            .eq('device_fingerprint', systemInfo.fingerprint)
            .eq('business_id', businessId)
            .maybeSingle();
          
          if (found) {
            console.log('✅ [DesktopInstallationService] Found existing installation:', found.id);
            return found.id;
          }
        }
        
        return null;
      }

      console.log('✅ [DesktopInstallationService] Installation created successfully:', installation.id);
      console.log('🎉 [DesktopInstallationService] Desktop kiosk is now registered and will appear in device dropdown!');

      // Start periodic last_seen updates
      this.installationId = installation.id;
      this.startLastSeenUpdates(installation.id);

      return installation.id;
    } catch (error) {
      console.error('❌ [DesktopInstallationService] Error in auto-registration:', error);
      return null;
    }
  }

  /**
   * Start periodic last_seen updates (every 5 minutes)
   */
  startLastSeenUpdates(installationId) {
    if (!this.isElectron || !installationId) return;

    // Clear any existing interval
    if (this.lastSeenInterval) {
      clearInterval(this.lastSeenInterval);
    }

    // Update immediately
    this.updateLastSeen(installationId);

    // Then update every 5 minutes
    this.lastSeenInterval = setInterval(() => {
      this.updateLastSeen(installationId);
    }, 5 * 60 * 1000); // 5 minutes

    console.log('🔄 [DesktopInstallationService] Started periodic last_seen updates (every 5 minutes)');
  }

  /**
   * Stop periodic last_seen updates
   */
  stopLastSeenUpdates() {
    if (this.lastSeenInterval) {
      clearInterval(this.lastSeenInterval);
      this.lastSeenInterval = null;
      console.log('🛑 [DesktopInstallationService] Stopped periodic last_seen updates');
    }
  }

  /**
   * Update last_seen timestamp for this installation
   */
  async updateLastSeen(installationId) {
    if (!this.isElectron || !installationId) return;

    try {
      await supabase
        .from('music_installations')
        .update({ last_seen: new Date().toISOString() })
        .eq('id', installationId);
    } catch (error) {
      // Silent fail - not critical
      console.warn('⚠️ [DesktopInstallationService] Failed to update last_seen:', error);
    }
  }

  /**
   * Mark inactive installations (devices not seen in X days)
   * @param {number} daysInactive - Number of days without activity to mark as inactive (default: 30)
   */
  async markInactiveInstallations(businessId, daysInactive = 30) {
    if (!businessId) return { marked: 0, error: 'No business ID provided' };

    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysInactive);

      const { data, error } = await supabase
        .from('music_installations')
        .update({ status: 'inactive' })
        .eq('business_id', businessId)
        .eq('status', 'active')
        .or(`last_seen.is.null,last_seen.lt.${cutoffDate.toISOString()}`)
        .select('id');

      if (error) {
        console.error('❌ [DesktopInstallationService] Error marking inactive installations:', error);
        return { marked: 0, error: error.message };
      }

      const count = data?.length || 0;
      console.log(`✅ [DesktopInstallationService] Marked ${count} installations as inactive (not seen in ${daysInactive} days)`);
      return { marked: count, error: null };
    } catch (error) {
      console.error('❌ [DesktopInstallationService] Error in markInactiveInstallations:', error);
      return { marked: 0, error: error.message };
    }
  }
}

export const desktopInstallationService = new DesktopInstallationService();
export default desktopInstallationService;

