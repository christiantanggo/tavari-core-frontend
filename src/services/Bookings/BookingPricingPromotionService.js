// src/services/Bookings/BookingPricingPromotionService.js
import { supabase } from '../../supabaseClient';
import { serializeBookingPricingPromotionForSave } from '../../utils/bookingPricingPromotions';

class BookingPricingPromotionService {
  constructor() {
    this.businessId = null;
  }

  setBusinessId(businessId) {
    this.businessId = businessId;
  }

  async getPromotions({ includeInactive = true } = {}) {
    if (!this.businessId) throw new Error('Business ID is required');

    let query = supabase
      .from('booking_pricing_promotions')
      .select('*')
      .eq('business_id', this.businessId)
      .order('priority', { ascending: false })
      .order('created_at', { ascending: false });

    if (!includeInactive) {
      query = query.eq('is_active', true);
    }

    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  }

  async getActivePromotions() {
    return this.getPromotions({ includeInactive: false });
  }

  async createPromotion(form) {
    if (!this.businessId) throw new Error('Business ID is required');
    const payload = serializeBookingPricingPromotionForSave(form);

    const { data, error } = await supabase
      .from('booking_pricing_promotions')
      .insert({
        business_id: this.businessId,
        ...payload,
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  async updatePromotion(promotionId, form) {
    if (!this.businessId) throw new Error('Business ID is required');
    const payload = serializeBookingPricingPromotionForSave(form);

    const { data, error } = await supabase
      .from('booking_pricing_promotions')
      .update({
        ...payload,
        updated_at: new Date().toISOString(),
      })
      .eq('id', promotionId)
      .eq('business_id', this.businessId)
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  async deletePromotion(promotionId) {
    if (!this.businessId) throw new Error('Business ID is required');

    const { error } = await supabase
      .from('booking_pricing_promotions')
      .delete()
      .eq('id', promotionId)
      .eq('business_id', this.businessId);

    if (error) throw error;
  }

  async togglePromotionStatus(promotionId, isActive) {
    if (!this.businessId) throw new Error('Business ID is required');

    const { data, error } = await supabase
      .from('booking_pricing_promotions')
      .update({
        is_active: isActive,
        updated_at: new Date().toISOString(),
      })
      .eq('id', promotionId)
      .eq('business_id', this.businessId)
      .select()
      .single();

    if (error) throw error;
    return data;
  }
}

export default new BookingPricingPromotionService();
