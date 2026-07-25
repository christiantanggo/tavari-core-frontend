// src/services/Bookings/BookingActivityService.js
import { supabase } from '../../supabaseClient';

class BookingActivityService {
  constructor() {
    this.businessId = null;
  }

  setBusinessId(businessId) {
    this.businessId = businessId;
  }

  _isMissingColumnError(error, columnName) {
    if (!error) return false;
    const code = String(error.code || '');
    const message = String(error.message || '').toLowerCase();
    const col = String(columnName || '').toLowerCase();
    if (!col || !message.includes(col)) return false;
    return (
      code === '42703'
      || code === 'PGRST204'
      || message.includes('schema cache')
      || message.includes('does not exist')
    );
  }

  // Get all booking activities
  async getActivities(filters = {}) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    const runActivitiesQuery = async ({
      includeDisplayOrder,
      includeImages,
      includeCamperRegistration,
      includePortalVisible,
    }) => {
      const optionalFields = [
        includeCamperRegistration ? 'requires_camper_registration' : null,
        includeImages ? 'images' : null,
        includeDisplayOrder ? 'display_order' : null,
        includePortalVisible ? 'portal_visible' : null,
      ].filter(Boolean);

      const selectFields = `
        id,
        business_id,
        type_id,
        activity_name,
        description,
        duration_minutes,
        max_capacity,
        location_id,
        resource_requirements,
        requires_waiver,
        ${optionalFields.length ? `${optionalFields.join(',')},` : ''}
        pricing_rules,
        addon_settings,
        ticket_settings,
        is_active,
        created_at,
        updated_at,
        booking_types:type_id (
          id,
          type_name,
          type_key,
          display_name
        )
      `;

      let query = supabase
        .from('booking_activities')
        .select(selectFields)
        .eq('business_id', this.businessId);

      if (flags.includeDisplayOrder) {
        query = query
          .order('display_order', { ascending: true })
          .order('activity_name', { ascending: true });
      } else {
        query = query.order('activity_name', { ascending: true });
      }

      if (filters.typeId) {
        query = query.eq('type_id', filters.typeId);
      }

      if (filters.activeOnly !== false) {
        query = query.eq('is_active', true);
      }

      if (filters.portalOnly) {
        query = query.eq('portal_visible', true);
      }

      return query;
    };

    let flags = {
      includeDisplayOrder: true,
      includeImages: false,
      includeCamperRegistration: true,
      includePortalVisible: true,
    };
    let { data, error } = await runActivitiesQuery(flags);

    while (error) {
      const previousFlags = { ...flags };
      let changed = false;

      if (flags.includeImages && this._isMissingColumnError(error, 'images')) {
        flags.includeImages = false;
        changed = true;
      } else if (flags.includeDisplayOrder && this._isMissingColumnError(error, 'display_order')) {
        flags.includeDisplayOrder = false;
        changed = true;
      } else if (
        flags.includeCamperRegistration
        && this._isMissingColumnError(error, 'requires_camper_registration')
      ) {
        flags.includeCamperRegistration = false;
        changed = true;
      } else if (flags.includePortalVisible && this._isMissingColumnError(error, 'portal_visible')) {
        flags.includePortalVisible = false;
        if (filters.portalOnly) delete filters.portalOnly;
        changed = true;
      } else {
        break;
      }

      if (!changed) break;
      if (
        previousFlags.includeImages === flags.includeImages
        && previousFlags.includeDisplayOrder === flags.includeDisplayOrder
        && previousFlags.includeCamperRegistration === flags.includeCamperRegistration
        && previousFlags.includePortalVisible === flags.includePortalVisible
      ) {
        break;
      }

      ({ data, error } = await runActivitiesQuery(flags));
    }

    if (data && !error) {
      data = data.map((activity) => ({
        ...activity,
        display_order: activity.display_order ?? 0,
        requires_camper_registration: activity.requires_camper_registration ?? false,
        portal_visible: activity.portal_visible !== false,
        images: activity.images ?? [],
      }));
    }

    if (error) {
      console.error('Error fetching activities:', error);
      throw error;
    }

    return data || [];
  }

  // Get single activity by ID
  async getActivityById(activityId) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    const { data, error } = await supabase
      .from('booking_activities')
      .select(`
        *,
        booking_types:type_id (*)
      `)
      .eq('id', activityId)
      .eq('business_id', this.businessId)
      .single();

    if (error) {
      console.error('Error fetching activity:', error);
      throw error;
    }

    return data;
  }

  // Create activity
  async createActivity(activityData) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    const insertData = {
      business_id: this.businessId,
      type_id: activityData.typeId || null,
      activity_name: activityData.activityName,
      description: activityData.description || null,
      duration_minutes: activityData.durationMinutes || 60,
      max_capacity: activityData.maxCapacity || 10,
      location_id: activityData.locationId || null,
      resource_requirements: activityData.resourceRequirements || {},
      requires_waiver: activityData.requiresWaiver || false,
      requires_camper_registration: activityData.requiresCamperRegistration || false,
      party_included_kids: activityData.partyIncludedKids ?? null,
      party_included_adults: activityData.partyIncludedAdults ?? null,
      party_one_adult_per_child: activityData.partyOneAdultPerChild ?? null,
      images: Array.isArray(activityData.images) ? activityData.images : [],
      pricing_rules: activityData.pricingRules || {},
      addon_settings: activityData.addonSettings || {},
      ticket_settings: activityData.ticketSettings || {},
      is_active: activityData.isActive !== false,
      portal_visible: activityData.portalVisible !== false,
    };

    // Only include display_order if it's provided (column may not exist yet)
    if (activityData.displayOrder !== undefined) {
      insertData.display_order = activityData.displayOrder;
    }

    const { data, error } = await supabase
      .from('booking_activities')
      .insert(insertData)
      .select()
      .single();

    // If display_order column doesn't exist, retry without it
    if (error && (error.code === '42703' || error.code === 'PGRST204') && error.message.includes('display_order')) {
      delete insertData.display_order;
      const retryResult = await supabase
        .from('booking_activities')
        .insert(insertData)
        .select()
        .single();
      
      if (retryResult.error) {
        console.error('Error creating activity:', retryResult.error);
        throw retryResult.error;
      }
      
      return { ...retryResult.data, display_order: activityData.displayOrder || 0 };
    }

    if (error && (error.code === '42703' || error.code === 'PGRST204') && error.message.includes('images')) {
      delete insertData.images;
      const retryWithoutImages = await supabase
        .from('booking_activities')
        .insert(insertData)
        .select()
        .single();

      if (retryWithoutImages.error) {
        console.error('Error creating activity:', retryWithoutImages.error);
        throw retryWithoutImages.error;
      }

      return retryWithoutImages.data;
    }

    if (error) {
      console.error('Error creating activity:', error);
      throw error;
    }

    return data;
  }

  // Update activity
  async updateActivity(activityId, updates) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    // Convert camelCase to snake_case for database columns
    const updateData = {
      updated_at: new Date().toISOString()
    };

    // Map camelCase fields to snake_case database columns
    if ('typeId' in updates) updateData.type_id = updates.typeId;
    if ('activityName' in updates) updateData.activity_name = updates.activityName;
    if ('description' in updates) updateData.description = updates.description;
    if ('durationMinutes' in updates) updateData.duration_minutes = updates.durationMinutes;
    if ('maxCapacity' in updates) updateData.max_capacity = updates.maxCapacity;
    if ('locationId' in updates) updateData.location_id = updates.locationId;
    if ('resourceRequirements' in updates) updateData.resource_requirements = updates.resourceRequirements;
    if ('requiresWaiver' in updates) updateData.requires_waiver = updates.requiresWaiver;
    if ('requiresCamperRegistration' in updates) updateData.requires_camper_registration = updates.requiresCamperRegistration;
    if ('partyIncludedKids' in updates) updateData.party_included_kids = updates.partyIncludedKids;
    if ('partyIncludedAdults' in updates) updateData.party_included_adults = updates.partyIncludedAdults;
    if ('partyOneAdultPerChild' in updates) updateData.party_one_adult_per_child = updates.partyOneAdultPerChild;
    if ('images' in updates) updateData.images = Array.isArray(updates.images) ? updates.images : [];
    if ('pricingRules' in updates) updateData.pricing_rules = updates.pricingRules;
    if ('addonSettings' in updates) updateData.addon_settings = updates.addonSettings;
    if ('ticketSettings' in updates) updateData.ticket_settings = updates.ticketSettings;
    if ('isActive' in updates) updateData.is_active = updates.isActive;
    if ('portalVisible' in updates) updateData.portal_visible = updates.portalVisible;
    if ('displayOrder' in updates) updateData.display_order = updates.displayOrder;

    // Also include any snake_case fields directly (for backward compatibility)
    if ('type_id' in updates) updateData.type_id = updates.type_id;
    if ('activity_name' in updates) updateData.activity_name = updates.activity_name;
    if ('duration_minutes' in updates) updateData.duration_minutes = updates.duration_minutes;
    if ('max_capacity' in updates) updateData.max_capacity = updates.max_capacity;
    if ('location_id' in updates) updateData.location_id = updates.location_id;
    if ('resource_requirements' in updates) updateData.resource_requirements = updates.resource_requirements;
    if ('requires_waiver' in updates) updateData.requires_waiver = updates.requires_waiver;
    if ('requires_camper_registration' in updates) updateData.requires_camper_registration = updates.requires_camper_registration;
    if ('images' in updates) updateData.images = Array.isArray(updates.images) ? updates.images : [];
    if ('pricing_rules' in updates) updateData.pricing_rules = updates.pricing_rules;
    if ('addon_settings' in updates) updateData.addon_settings = updates.addon_settings;
    if ('ticket_settings' in updates) updateData.ticket_settings = updates.ticket_settings;
    if ('is_active' in updates) updateData.is_active = updates.is_active;
    if ('display_order' in updates) updateData.display_order = updates.display_order;

    // Include any other fields that are already in snake_case (like advanced booking fields)
    Object.keys(updates).forEach(key => {
      // Skip updated_at (we set it above)
      if (key === 'updated_at') return;
      // Include snake_case fields (contain underscore) that we haven't explicitly mapped
      if (key.includes('_') && !(key in updateData)) {
        updateData[key] = updates[key];
      }
    });

    // Check if display_order is being updated
    const hasDisplayOrder = 'display_order' in updateData;

    console.log('[BookingActivityService] updateActivity: requires_waiver', {
      activityId,
      hasRequiresWaiverInUpdates: 'requiresWaiver' in updates,
      updatesRequiresWaiver: updates.requiresWaiver,
      hasRequiresWaiverInUpdateData: 'requires_waiver' in updateData,
      updateDataRequiresWaiver: updateData.requires_waiver,
    });

    const { data, error } = await supabase
      .from('booking_activities')
      .update(updateData)
      .eq('id', activityId)
      .eq('business_id', this.businessId)
      .select()
      .single();

    // If display_order column doesn't exist, retry without it
    if (error && (error.code === '42703' || error.code === 'PGRST204') && error.message.includes('display_order')) {
      delete updateData.display_order;
      const retryResult = await supabase
        .from('booking_activities')
        .update(updateData)
        .eq('id', activityId)
        .eq('business_id', this.businessId)
        .select()
        .single();
      
      if (retryResult.error) {
        console.error('Error updating activity:', retryResult.error);
        throw retryResult.error;
      }
      
      // Return data with display_order from updates if it was provided
      return { ...retryResult.data, display_order: hasDisplayOrder ? updates.display_order : retryResult.data.display_order || 0 };
    }

    if (error && (error.code === '42703' || error.code === 'PGRST204') && error.message.includes('images')) {
      delete updateData.images;
      const retryWithoutImages = await supabase
        .from('booking_activities')
        .update(updateData)
        .eq('id', activityId)
        .eq('business_id', this.businessId)
        .select()
        .single();

      if (retryWithoutImages.error) {
        console.error('Error updating activity:', retryWithoutImages.error);
        throw retryWithoutImages.error;
      }

      return retryWithoutImages.data;
    }

    if (error) {
      console.error('Error updating activity:', error);
      throw error;
    }

    console.log('[BookingActivityService] updateActivity result: requires_waiver in DB', {
      activityId,
      returnedRequiresWaiver: data?.requires_waiver,
    });
    return data;
  }

  // Delete activity (hard delete - permanently removes from database)
  async deleteActivity(activityId) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    const { error } = await supabase
      .from('booking_activities')
      .delete()
      .eq('id', activityId)
      .eq('business_id', this.businessId);

    if (error) {
      console.error('Error deleting activity:', error);
      throw error;
    }
  }

  // Toggle activity active/inactive status
  async toggleActivityStatus(activityId, isActive) {
    return this.updateActivity(activityId, { is_active: isActive });
  }
}

export default new BookingActivityService();












