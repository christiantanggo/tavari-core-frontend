import { supabase } from '../../supabaseClient';

class LegacyWaiverTemplateService {
  setBusinessId(businessId) {
    this.businessId = businessId;
  }

  async list() {
    if (!this.businessId) throw new Error('Business ID is required');
    const { data, error } = await supabase
      .from('legacy_waiver_templates')
      .select('*')
      .eq('business_id', this.businessId)
      .order('legacy_template_id', { ascending: true });
    if (error) throw error;
    return data || [];
  }

  async listDiscoveredTemplateIds() {
    if (!this.businessId) throw new Error('Business ID is required');
    const { data, error } = await supabase
      .from('legacy_waivers')
      .select('legacy_waiver_template_id')
      .eq('business_id', this.businessId)
      .neq('source_system', 'smartwaiver')
      .not('legacy_waiver_template_id', 'is', null)
      .limit(100000);
    if (error) throw error;

    const byId = new Map();
    (data || []).forEach((row) => {
      const id = Number(row.legacy_waiver_template_id);
      if (!Number.isFinite(id)) return;
      byId.set(id, (byId.get(id) || 0) + 1);
    });

    return Array.from(byId.entries())
      .map(([legacy_template_id, waiver_count]) => ({ legacy_template_id, waiver_count }))
      .sort((a, b) => a.legacy_template_id - b.legacy_template_id);
  }

  async upsert({ legacy_template_id, title, waiver_content, source_system = 'wallkids' }) {
    if (!this.businessId) throw new Error('Business ID is required');
    if (legacy_template_id == null || String(legacy_template_id).trim() === '') {
      throw new Error('legacy_template_id is required');
    }
    const id = Math.floor(Number(legacy_template_id));
    if (!Number.isFinite(id)) throw new Error('Invalid legacy_template_id');
    const row = {
      business_id: this.businessId,
      source_system,
      legacy_template_id: id,
      title: (title || 'Legacy template').trim(),
      waiver_content: waiver_content ?? null,
      updated_at: new Date().toISOString()
    };
    const { data, error } = await supabase
      .from('legacy_waiver_templates')
      .upsert(row, { onConflict: 'business_id,source_system,legacy_template_id' })
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async remove(id) {
    if (!this.businessId) throw new Error('Business ID is required');
    const { error } = await supabase
      .from('legacy_waiver_templates')
      .delete()
      .eq('id', id)
      .eq('business_id', this.businessId);
    if (error) throw error;
  }

  /** Link legacy import rows to pos_loyalty_accounts by phone (server RPC; re-run for large imports). */
  async linkPosCustomers(pMaxRows = 2000) {
    if (!this.businessId) throw new Error('Business ID is required');
    const { data, error } = await supabase.rpc('legacy_waivers_link_or_create_pos_customers', {
      p_business_id: this.businessId,
      p_max_rows: pMaxRows
    });
    if (error) throw error;
    return data;
  }
}

export default new LegacyWaiverTemplateService();
