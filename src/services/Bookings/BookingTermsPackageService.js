// src/services/Bookings/BookingTermsPackageService.js
import { supabase } from '../../supabaseClient';

class BookingTermsPackageService {
  constructor() {
    this.businessId = null;
  }

  setBusinessId(businessId) {
    this.businessId = businessId;
  }

  async listPackages({ includeInactive = true } = {}) {
    if (!this.businessId) throw new Error('Business ID is required');

    let query = supabase
      .from('booking_terms_packages')
      .select('*, booking_terms_steps(*)')
      .eq('business_id', this.businessId)
      .order('name', { ascending: true });

    if (!includeInactive) query = query.eq('is_active', true);

    const { data, error } = await query;
    if (error) throw error;

    return (data || []).map((pkg) => ({
      ...pkg,
      steps: (pkg.booking_terms_steps || [])
        .slice()
        .sort((a, b) => (a.step_order ?? 0) - (b.step_order ?? 0)),
      booking_terms_steps: undefined,
    }));
  }

  async createPackage({ name, description = '', is_active = true, steps = [] }) {
    if (!this.businessId) throw new Error('Business ID is required');
    const trimmedName = String(name || '').trim();
    if (!trimmedName) throw new Error('Package name is required');

    const { data: pkg, error } = await supabase
      .from('booking_terms_packages')
      .insert({
        business_id: this.businessId,
        name: trimmedName,
        description: description ? String(description).trim() : null,
        is_active: is_active !== false,
      })
      .select()
      .single();
    if (error) throw error;

    if (Array.isArray(steps) && steps.length > 0) {
      await this.replaceSteps(pkg.id, steps);
    }

    const packages = await this.listPackages({ includeInactive: true });
    return packages.find((row) => row.id === pkg.id) || pkg;
  }

  async updatePackage(packageId, { name, description, is_active, steps }) {
    if (!this.businessId) throw new Error('Business ID is required');

    const updates = { updated_at: new Date().toISOString() };
    if (name !== undefined) updates.name = String(name || '').trim();
    if (description !== undefined) updates.description = description ? String(description).trim() : null;
    if (is_active !== undefined) updates.is_active = is_active !== false;

    const { error } = await supabase
      .from('booking_terms_packages')
      .update(updates)
      .eq('id', packageId)
      .eq('business_id', this.businessId);
    if (error) throw error;

    if (Array.isArray(steps)) {
      await this.replaceSteps(packageId, steps);
    }

    const packages = await this.listPackages({ includeInactive: true });
    return packages.find((row) => row.id === packageId) || null;
  }

  async replaceSteps(packageId, steps = []) {
    if (!this.businessId) throw new Error('Business ID is required');

    const { error: deleteError } = await supabase
      .from('booking_terms_steps')
      .delete()
      .eq('package_id', packageId)
      .eq('business_id', this.businessId);
    if (deleteError) throw deleteError;

    const rows = (steps || [])
      .map((step, index) => ({
        package_id: packageId,
        business_id: this.businessId,
        step_order: index,
        title: String(step.title || `Step ${index + 1}`).trim() || `Step ${index + 1}`,
        body: String(step.body || '').trim(),
        require_acknowledge: step.require_acknowledge !== false,
      }))
      .filter((step) => step.title);

    if (rows.length === 0) return [];

    const { data, error } = await supabase
      .from('booking_terms_steps')
      .insert(rows)
      .select();
    if (error) throw error;
    return data || [];
  }

  async deletePackage(packageId) {
    if (!this.businessId) throw new Error('Business ID is required');
    const { error } = await supabase
      .from('booking_terms_packages')
      .delete()
      .eq('id', packageId)
      .eq('business_id', this.businessId);
    if (error) throw error;
  }

  async setActivityPackage(activityId, packageId) {
    if (!this.businessId) throw new Error('Business ID is required');
    const updates = {
      terms_package_id: packageId || null,
      updated_at: new Date().toISOString(),
    };
    // Clearing the package also turns off confirmation CTA (nothing to acknowledge).
    if (!packageId) {
      updates.terms_show_on_confirmation = false;
    }
    const { data, error } = await supabase
      .from('booking_activities')
      .update(updates)
      .eq('id', activityId)
      .eq('business_id', this.businessId)
      .select('id, terms_package_id, terms_show_on_confirmation')
      .single();
    if (error) throw error;
    return data;
  }

  async setActivityTermsShowOnConfirmation(activityId, enabled) {
    if (!this.businessId) throw new Error('Business ID is required');
    const { data, error } = await supabase
      .from('booking_activities')
      .update({
        terms_show_on_confirmation: enabled === true,
        updated_at: new Date().toISOString(),
      })
      .eq('id', activityId)
      .eq('business_id', this.businessId)
      .select('id, terms_package_id, terms_show_on_confirmation')
      .single();
    if (error) throw error;
    return data;
  }
}

export default new BookingTermsPackageService();
