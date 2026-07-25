// src/services/Bookings/TicketCategoryService.js
import { supabase } from '../../supabaseClient';

class TicketCategoryService {
  constructor() {
    this.businessId = null;
  }

  setBusinessId(businessId) {
    this.businessId = businessId;
  }

  // Get all ticket categories
  async getTicketCategories(includeInactive = false) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    let query = supabase
      .from('booking_ticket_categories')
      .select('*')
      .eq('business_id', this.businessId)
      .order('display_order', { ascending: true })
      .order('category_name', { ascending: true });

    if (!includeInactive) {
      query = query.eq('is_active', true);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Error fetching ticket categories:', error);
      throw error;
    }

    return data || [];
  }

  // Get single ticket category by ID
  async getTicketCategoryById(categoryId) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    const { data, error } = await supabase
      .from('booking_ticket_categories')
      .select('*')
      .eq('id', categoryId)
      .eq('business_id', this.businessId)
      .single();

    if (error) {
      console.error('Error fetching ticket category:', error);
      throw error;
    }

    return data;
  }

  // Create ticket category
  async createTicketCategory(categoryData) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    const { data, error } = await supabase
      .from('booking_ticket_categories')
      .insert({
        business_id: this.businessId,
        category_name: categoryData.category_name || categoryData.name,
        description: categoryData.description || null,
        display_order: categoryData.display_order || 0,
        is_active: categoryData.is_active !== false
      })
      .select()
      .single();

    if (error) {
      console.error('Error creating ticket category:', error);
      throw error;
    }

    return data;
  }

  // Update ticket category
  async updateTicketCategory(categoryId, updates) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    const { data, error } = await supabase
      .from('booking_ticket_categories')
      .update({
        ...updates,
        updated_at: new Date().toISOString()
      })
      .eq('id', categoryId)
      .eq('business_id', this.businessId)
      .select()
      .single();

    if (error) {
      console.error('Error updating ticket category:', error);
      throw error;
    }

    return data;
  }

  // Delete ticket category (hard delete - permanently removes from database)
  async deleteTicketCategory(categoryId) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    const { error } = await supabase
      .from('booking_ticket_categories')
      .delete()
      .eq('id', categoryId)
      .eq('business_id', this.businessId);

    if (error) {
      console.error('Error deleting ticket category:', error);
      throw error;
    }
  }

  // Toggle ticket category active/inactive status
  async toggleTicketCategoryStatus(categoryId, isActive) {
    return this.updateTicketCategory(categoryId, { is_active: isActive });
  }
}

export default new TicketCategoryService();
