// Step 80: Create WaiverVersionService.js
// Service for waiver template versioning
import { supabase } from '../../supabaseClient';

class WaiverVersionService {
  constructor() {
    this.businessId = null;
  }

  setBusinessId(businessId) {
    this.businessId = businessId;
  }

  // Create new version
  async createVersion(templateId, versionData) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    // Get next version number
    const { data: nextVersion } = await supabase
      .rpc('waivers_get_next_version', {
        template_uuid: templateId
      });

    // Create version record
    const { data, error } = await supabase
      .from('waiver_versions')
      .insert({
        template_id: templateId,
        version_number: nextVersion || 1,
        waiver_content: versionData.waiverContent,
        fields_config: versionData.fieldsConfig,
        signature_config: versionData.signatureConfig,
        changes_summary: versionData.changesSummary,
        created_by: (await supabase.auth.getUser()).data.user?.id
      })
      .select()
      .single();

    if (error) {
      throw error;
    }

    return data;
  }

  // Get version history
  async getVersionHistory(templateId) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    const { data, error } = await supabase
      .from('waiver_versions')
      .select('*')
      .eq('template_id', templateId)
      .order('version_number', { ascending: false });

    if (error) {
      throw error;
    }

    return data || [];
  }

  // Rollback to version
  async rollbackVersion(templateId, versionNumber) {
    throw new Error(
      `Rollback is disabled for legal waiver templates. Create a new active version from version ${versionNumber} instead of overwriting template ${templateId}.`
    );
  }

  // Compare versions
  async compareVersions(templateId, version1, version2) {
    const { data: versions } = await supabase
      .from('waiver_versions')
      .select('*')
      .eq('template_id', templateId)
      .in('version_number', [version1, version2]);

    if (versions?.length !== 2) {
      throw new Error('One or both versions not found');
    }

    const v1 = versions.find(v => v.version_number === version1);
    const v2 = versions.find(v => v.version_number === version2);

    return {
      version1: v1,
      version2: v2,
      differences: {
        content: v1.waiver_content !== v2.waiver_content,
        fields: JSON.stringify(v1.fields_config) !== JSON.stringify(v2.fields_config),
        signature: JSON.stringify(v1.signature_config) !== JSON.stringify(v2.signature_config)
      }
    };
  }
}

export default new WaiverVersionService();




