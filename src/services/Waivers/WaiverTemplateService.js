// Step 52: Create WaiverTemplateService.js
// Service for waiver template management operations
import { supabase } from '../../supabaseClient';

class WaiverTemplateService {
  constructor() {
    this.businessId = null;
  }

  setBusinessId(businessId) {
    this.businessId = businessId;
  }

  async enrichTemplatesWithLockStatus(templates) {
    const rows = templates || [];
    const templateIds = rows.map((template) => template.id).filter(Boolean);

    if (templateIds.length === 0) {
      return rows;
    }

    const { data, error } = await supabase
      .from('waiver_signatures')
      .select('template_id')
      .in('template_id', templateIds);

    if (error) {
      console.warn('Could not load waiver template lock status:', error);
      return rows.map((template) => ({
        ...template,
        signature_count: 0,
        is_locked: false
      }));
    }

    const counts = new Map();
    (data || []).forEach((row) => {
      if (!row.template_id) return;
      counts.set(row.template_id, (counts.get(row.template_id) || 0) + 1);
    });

    return rows.map((template) => {
      const signatureCount = counts.get(template.id) || 0;
      return {
        ...template,
        signature_count: signatureCount,
        is_locked: signatureCount > 0
      };
    });
  }

  // Get all templates for business
  async getTemplates(filters = {}) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    let query = supabase
      .from('waiver_templates')
      .select('*')
      .eq('business_id', this.businessId)
      .order('created_at', { ascending: false });

    if (filters.isActive !== undefined) {
      query = query.eq('is_active', filters.isActive);
    }

    if (filters.templateKey) {
      query = query.eq('template_key', filters.templateKey);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Error fetching templates:', error);
      throw error;
    }

    return this.enrichTemplatesWithLockStatus(data || []);
  }

  // Get template by ID
  async getTemplateById(templateId) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    const { data, error } = await supabase
      .from('waiver_templates')
      .select(`
        *,
        waiver_fields (*),
        waiver_versions (*)
      `)
      .eq('id', templateId)
      .eq('business_id', this.businessId)
      .single();

    if (error) {
      console.error('Error fetching template:', error);
      throw error;
    }

    const [enriched] = await this.enrichTemplatesWithLockStatus([data]);
    return enriched || data;
  }

  // Get active template by key
  async getActiveTemplate(templateKey) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    const { data, error } = await supabase
      .from('waiver_templates')
      .select('*')
      .eq('business_id', this.businessId)
      .eq('template_key', templateKey)
      .eq('is_active', true)
      .order('version', { ascending: false })
      .limit(1)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        // No template found
        return null;
      }
      console.error('Error fetching active template:', error);
      throw error;
    }

    return data;
  }

  // Create template
  async createTemplate(templateData) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    const { data: user } = await supabase.auth.getUser();

    const { data, error } = await supabase
      .from('waiver_templates')
      .insert({
        business_id: this.businessId,
        template_name: templateData.templateName,
        template_key: templateData.templateKey,
        waiver_title: templateData.waiverTitle,
        waiver_content: templateData.waiverContent,
        version: templateData.version || 1,
        is_active: templateData.isActive !== undefined ? templateData.isActive : true,
        requires_digital_signature: templateData.requiresDigitalSignature !== undefined ? templateData.requiresDigitalSignature : true,
        requires_guardian_signature: templateData.requiresGuardianSignature || false,
        minor_age_threshold: templateData.minorAgeThreshold || 18,
        fields_config: templateData.fieldsConfig || null,
        signature_config: templateData.signatureConfig || null,
        expiry_days: templateData.expiryDays || null,
        created_by: user?.user?.id || null
      })
      .select()
      .single();

    if (error) {
      console.error('Error creating template:', error);
      throw error;
    }

    return data;
  }

  // Update template
  async updateTemplate(templateId, templateData) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    const updateData = {
      updated_at: new Date().toISOString()
    };

    if (templateData.templateName !== undefined) updateData.template_name = templateData.templateName;
    if (templateData.waiverTitle !== undefined) updateData.waiver_title = templateData.waiverTitle;
    if (templateData.waiverContent !== undefined) updateData.waiver_content = templateData.waiverContent;
    if (templateData.isActive !== undefined) updateData.is_active = templateData.isActive;
    if (templateData.requiresDigitalSignature !== undefined) updateData.requires_digital_signature = templateData.requiresDigitalSignature;
    if (templateData.requiresGuardianSignature !== undefined) updateData.requires_guardian_signature = templateData.requiresGuardianSignature;
    if (templateData.minorAgeThreshold !== undefined) updateData.minor_age_threshold = templateData.minorAgeThreshold;
    if (templateData.fieldsConfig !== undefined) updateData.fields_config = templateData.fieldsConfig;
    if (templateData.signatureConfig !== undefined) updateData.signature_config = templateData.signatureConfig;
    if (templateData.expiryDays !== undefined) updateData.expiry_days = templateData.expiryDays;

    const { data, error } = await supabase
      .from('waiver_templates')
      .update(updateData)
      .eq('id', templateId)
      .eq('business_id', this.businessId)
      .select()
      .single();

    if (error) {
      console.error('Error updating template:', error);
      throw error;
    }

    return data;
  }

  async createTemplateVersion(templateId, templateData) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    const { data, error } = await supabase
      .rpc('waivers_create_template_version', {
        source_template_id: templateId,
        new_template_name: templateData.templateName ?? null,
        new_waiver_title: templateData.waiverTitle ?? null,
        new_waiver_content: templateData.waiverContent ?? null,
        new_requires_digital_signature: templateData.requiresDigitalSignature ?? null,
        new_requires_guardian_signature: templateData.requiresGuardianSignature ?? null,
        new_minor_age_threshold: templateData.minorAgeThreshold ?? null,
        new_fields_config: templateData.fieldsConfig ?? null,
        new_signature_config: templateData.signatureConfig ?? null,
        new_expiry_days: templateData.expiryDays ?? null,
        changes_summary: templateData.changesSummary ?? null
      });

    if (error) {
      console.error('Error creating template version:', error);
      throw error;
    }

    const [enriched] = await this.enrichTemplatesWithLockStatus(data ? [data] : []);
    return enriched || data;
  }

  // Delete template
  async deleteTemplate(templateId) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    const { error } = await supabase
      .from('waiver_templates')
      .delete()
      .eq('id', templateId)
      .eq('business_id', this.businessId);

    if (error) {
      console.error('Error deleting template:', error);
      throw error;
    }

    return true;
  }
}

export default new WaiverTemplateService();




