// Step 56: Create WaiverSettingsService.js
// Service for waiver settings management operations
import { supabase } from '../../supabaseClient';

/** JSONB / API quirks: coerce numeric waiver settings to a finite number or leave as-is. */
function coerceNumericSettingValue(raw) {
  if (raw == null) return raw;
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string') {
    const n = parseInt(raw.trim(), 10);
    return Number.isFinite(n) ? n : raw;
  }
  if (typeof raw === 'object' && raw !== null) {
    if ('value' in raw) return coerceNumericSettingValue(raw.value);
    if ('days' in raw) return coerceNumericSettingValue(raw.days);
    const n = Number(raw);
    if (Number.isFinite(n)) return n;
  }
  return raw;
}

const NUMERIC_SETTING_KEYS = new Set([
  'default_expiry_days',
  'minor_age_threshold',
  'expiry_warning_days',
  'waiver_kiosk_ad_slide_seconds'
]);

class WaiverSettingsService {
  constructor() {
    this.businessId = null;
  }

  setBusinessId(businessId) {
    this.businessId = businessId;
  }

  // Get all settings (global and template-specific)
  async getSettings(templateId = null) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    let query = supabase
      .from('waiver_settings')
      .select('*')
      .eq('business_id', this.businessId);

    if (templateId) {
      query = query.eq('template_id', templateId);
    } else {
      query = query.is('template_id', null).eq('is_global', true);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Error fetching settings:', error);
      throw error;
    }

    // Parse JSONB values (normalize numeric keys for UI + expiry display)
    const settings = {};
    (data || []).forEach(setting => {
      const key = setting.setting_key;
      let val = setting.setting_value;
      if (NUMERIC_SETTING_KEYS.has(key)) {
        val = coerceNumericSettingValue(val);
      }
      settings[key] = val;
    });

    return settings;
  }

  // Get template-specific settings
  async getTemplateSettings(templateId) {
    return this.getSettings(templateId);
  }

  // Get global settings
  async getGlobalSettings() {
    return this.getSettings(null);
  }

  // Update setting
  async updateSetting(settingKey, settingValue, templateId = null) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    const isGlobal = templateId === null;
    const settingData = {
      business_id: this.businessId,
      setting_key: settingKey,
      setting_value: settingValue,
      is_global: isGlobal,
      updated_at: new Date().toISOString()
    };

    if (templateId) {
      settingData.template_id = templateId;
    } else {
      // Ensure template_id is null for global settings
      settingData.template_id = null;
    }

    // First, try to find existing setting
    let query = supabase
      .from('waiver_settings')
      .select('*')
      .eq('business_id', this.businessId)
      .eq('setting_key', settingKey);

    if (templateId) {
      query = query.eq('template_id', templateId);
    } else {
      query = query.is('template_id', null).eq('is_global', true);
    }

    const { data: existing, error: findError } = await query.maybeSingle();

    if (findError && findError.code !== 'PGRST116') { // PGRST116 is "not found"
      console.error('Error finding existing setting:', findError);
      throw findError;
    }

    if (existing) {
      // Update existing setting
      const { data, error } = await supabase
        .from('waiver_settings')
        .update({
          setting_value: settingValue,
          updated_at: new Date().toISOString()
        })
        .eq('id', existing.id)
        .select()
        .single();

      if (error) {
        console.error('Error updating setting:', error);
        throw error;
      }

      return data;
    } else {
      // Insert new setting
      const { data, error } = await supabase
        .from('waiver_settings')
        .insert(settingData)
        .select()
        .single();

      if (error) {
        console.error('Error inserting setting:', error);
        throw error;
      }

      return data;
    }
  }

  // Delete setting
  async deleteSetting(settingKey, templateId = null) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    let query = supabase
      .from('waiver_settings')
      .delete()
      .eq('business_id', this.businessId)
      .eq('setting_key', settingKey);

    if (templateId) {
      query = query.eq('template_id', templateId);
    } else {
      query = query.is('template_id', null).eq('is_global', true);
    }

    const { error } = await query;

    if (error) {
      console.error('Error deleting setting:', error);
      throw error;
    }

    return true;
  }
}

export default new WaiverSettingsService();




