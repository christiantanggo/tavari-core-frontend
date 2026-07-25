// src/services/Bookings/BookingTypeService.js
import { supabase } from '../../supabaseClient';
import {
  BIRTHDAY_PARTY_TYPE_KEY,
  defaultPartyCategorySessionRules,
  serializePartyCategorySessionRules,
} from '../../utils/bookingPartySettings';

class BookingTypeService {
  constructor() {
    this.businessId = null;
  }

  setBusinessId(businessId) {
    this.businessId = businessId;
  }

  // Get all booking types
  async getBookingTypes(includeInactive = false) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    let query = supabase
      .from('booking_types')
      .select('*')
      .eq('business_id', this.businessId)
      .order('display_order', { ascending: true })
      .order('type_name', { ascending: true });

    if (!includeInactive) {
      query = query.eq('is_active', true);
    }

    const { data, error } = await query;

    if (error) {
      // Older DBs without display_order still work alphabetically.
      if (error.code === '42703' || error.code === 'PGRST204' || String(error.message || '').includes('display_order')) {
        let fallback = supabase
          .from('booking_types')
          .select('*')
          .eq('business_id', this.businessId)
          .order('type_name', { ascending: true });
        if (!includeInactive) {
          fallback = fallback.eq('is_active', true);
        }
        const retry = await fallback;
        if (retry.error) {
          console.error('Error fetching booking types:', retry.error);
          throw retry.error;
        }
        return retry.data || [];
      }
      console.error('Error fetching booking types:', error);
      throw error;
    }

    return data || [];
  }

  // Get single booking type by ID
  async getBookingTypeById(typeId) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    const { data, error } = await supabase
      .from('booking_types')
      .select('*')
      .eq('id', typeId)
      .eq('business_id', this.businessId)
      .single();

    if (error) {
      console.error('Error fetching booking type:', error);
      throw error;
    }

    return data;
  }

  // Create booking type
  async createBookingType(typeData) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    const insertData = {
      business_id: this.businessId,
      type_name: typeData.typeName,
      type_key: typeData.typeKey,
      display_name: typeData.displayName || typeData.typeName,
      description: typeData.description || null,
      requires_waiver: typeData.requiresWaiver || false,
      requires_payment: typeData.requiresPayment !== false,
      custom_fields: typeData.customFields || {},
      session_rules: typeData.sessionRules || {},
      cancellation_rules: typeData.cancellationRules || {},
      is_active: typeData.isActive !== false,
    };

    if (typeData.displayOrder !== undefined || typeData.display_order !== undefined) {
      insertData.display_order = typeData.displayOrder ?? typeData.display_order ?? 0;
    }

    let { data, error } = await supabase
      .from('booking_types')
      .insert(insertData)
      .select()
      .single();

    if (error && (error.code === '42703' || error.code === 'PGRST204' || String(error.message || '').includes('display_order'))) {
      delete insertData.display_order;
      const retry = await supabase
        .from('booking_types')
        .insert(insertData)
        .select()
        .single();
      data = retry.data;
      error = retry.error;
    }

    if (error) {
      console.error('Error creating booking type:', error);
      throw error;
    }

    return data;
  }

  // Update booking type (maps camelCase to DB columns)
  async updateBookingType(typeId, updates) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    const snake = {};
    if (updates.type_name !== undefined) snake.type_name = updates.type_name;
    else if (updates.typeName !== undefined) snake.type_name = updates.typeName;
    if (updates.type_key !== undefined) snake.type_key = updates.type_key;
    else if (updates.typeKey !== undefined) snake.type_key = updates.typeKey;
    if (updates.display_name !== undefined) snake.display_name = updates.display_name;
    else if (updates.displayName !== undefined) snake.display_name = updates.displayName;
    if (updates.description !== undefined) snake.description = updates.description;
    if (updates.requires_waiver !== undefined) snake.requires_waiver = updates.requires_waiver;
    else if (updates.requiresWaiver !== undefined) snake.requires_waiver = updates.requiresWaiver;
    if (updates.requires_payment !== undefined) snake.requires_payment = updates.requires_payment;
    else if (updates.requiresPayment !== undefined) snake.requires_payment = updates.requiresPayment;
    if (updates.custom_fields !== undefined) snake.custom_fields = updates.custom_fields;
    else if (updates.customFields !== undefined) snake.custom_fields = updates.customFields;
    if (updates.session_rules !== undefined) snake.session_rules = updates.session_rules;
    else if (updates.sessionRules !== undefined) snake.session_rules = updates.sessionRules;
    if (updates.cancellation_rules !== undefined) snake.cancellation_rules = updates.cancellation_rules;
    else if (updates.cancellationRules !== undefined) snake.cancellation_rules = updates.cancellationRules;
    if (updates.is_active !== undefined) snake.is_active = updates.is_active;
    else if (updates.isActive !== undefined) snake.is_active = updates.isActive;
    if (updates.display_order !== undefined) snake.display_order = updates.display_order;
    else if (updates.displayOrder !== undefined) snake.display_order = updates.displayOrder;

    let { data, error } = await supabase
      .from('booking_types')
      .update({
        ...snake,
        updated_at: new Date().toISOString()
      })
      .eq('id', typeId)
      .eq('business_id', this.businessId)
      .select()
      .single();

    if (error && 'display_order' in snake && (error.code === '42703' || error.code === 'PGRST204' || String(error.message || '').includes('display_order'))) {
      delete snake.display_order;
      const retry = await supabase
        .from('booking_types')
        .update({
          ...snake,
          updated_at: new Date().toISOString()
        })
        .eq('id', typeId)
        .eq('business_id', this.businessId)
        .select()
        .single();
      data = retry.data;
      error = retry.error;
      if (!error && data) {
        return { ...data, display_order: updates.display_order ?? updates.displayOrder ?? 0 };
      }
    }

    if (error) {
      console.error('Error updating booking type:', error);
      throw error;
    }

    return data;
  }

  // Delete booking type (hard delete - permanently removes from database)
  async deleteBookingType(typeId) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    const { error } = await supabase
      .from('booking_types')
      .delete()
      .eq('id', typeId)
      .eq('business_id', this.businessId);

    if (error) {
      console.error('Error deleting booking type:', error);
      throw error;
    }
  }

  // Toggle booking type active/inactive status
  async toggleBookingTypeStatus(typeId, isActive) {
    return this.updateBookingType(typeId, { is_active: isActive });
  }

  /** Ensure every business has a Birthday Party category (idempotent). */
  async ensureBirthdayPartyCategory() {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    const { data: existing, error: fetchError } = await supabase
      .from('booking_types')
      .select('id')
      .eq('business_id', this.businessId)
      .eq('type_key', BIRTHDAY_PARTY_TYPE_KEY)
      .maybeSingle();

    if (fetchError) {
      console.error('Error checking birthday party category:', fetchError);
      throw fetchError;
    }

    if (existing?.id) {
      return existing;
    }

    const sessionRules = serializePartyCategorySessionRules(defaultPartyCategorySessionRules());
    return this.createBookingType({
      typeName: 'Birthday Party',
      typeKey: BIRTHDAY_PARTY_TYPE_KEY,
      displayName: 'Birthday Party',
      description: 'Party room bookings — one space per time slot with host and birthday child roles.',
      requiresWaiver: true,
      requiresPayment: true,
      sessionRules,
      isActive: true,
      displayOrder: 0,
    });
  }
}

export default new BookingTypeService();
