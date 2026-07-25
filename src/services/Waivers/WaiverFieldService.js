// Step 55: Create WaiverFieldService.js
// Service for waiver field management operations
import { supabase } from '../../supabaseClient';

class WaiverFieldService {
  constructor() {
    this.businessId = null;
  }

  setBusinessId(businessId) {
    this.businessId = businessId;
  }

  // Get fields for a template
  async getFields(templateId) {
    const { data, error } = await supabase
      .from('waiver_fields')
      .select('*')
      .eq('template_id', templateId)
      .order('display_order', { ascending: true });

    if (error) {
      console.error('Error fetching fields:', error);
      throw error;
    }

    return data || [];
  }

  // Create field
  async createField(templateId, fieldData) {
    const { data, error } = await supabase
      .from('waiver_fields')
      .insert({
        template_id: templateId,
        field_key: fieldData.fieldKey,
        field_label: fieldData.fieldLabel,
        field_type: fieldData.fieldType,
        field_options: fieldData.fieldOptions || null,
        is_required: fieldData.isRequired !== undefined ? fieldData.isRequired : false,
        display_order: fieldData.displayOrder || 0,
        validation_rules: fieldData.validationRules || null
      })
      .select()
      .single();

    if (error) {
      console.error('Error creating field:', error);
      throw error;
    }

    return data;
  }

  // Update field
  async updateField(fieldId, fieldData) {
    const updateData = {};

    if (fieldData.fieldLabel !== undefined) updateData.field_label = fieldData.fieldLabel;
    if (fieldData.fieldType !== undefined) updateData.field_type = fieldData.fieldType;
    if (fieldData.fieldOptions !== undefined) updateData.field_options = fieldData.fieldOptions;
    if (fieldData.isRequired !== undefined) updateData.is_required = fieldData.isRequired;
    if (fieldData.displayOrder !== undefined) updateData.display_order = fieldData.displayOrder;
    if (fieldData.validationRules !== undefined) updateData.validation_rules = fieldData.validationRules;

    const { data, error } = await supabase
      .from('waiver_fields')
      .update(updateData)
      .eq('id', fieldId)
      .select()
      .single();

    if (error) {
      console.error('Error updating field:', error);
      throw error;
    }

    return data;
  }

  // Delete field
  async deleteField(fieldId) {
    const { error } = await supabase
      .from('waiver_fields')
      .delete()
      .eq('id', fieldId);

    if (error) {
      console.error('Error deleting field:', error);
      throw error;
    }

    return true;
  }

  // Validate field response
  async validateFieldResponse(fieldId, responseValue) {
    const { data, error } = await supabase
      .rpc('waivers_validate_field_response', {
        field_uuid: fieldId,
        response_value: responseValue
      });

    if (error) {
      console.error('Error validating field response:', error);
      throw error;
    }

    return data;
  }

  // Get field responses for a waiver
  async getFieldResponses(waiverId) {
    const { data, error } = await supabase
      .from('waiver_field_responses')
      .select(`
        *,
        waiver_fields:field_id (
          id,
          field_key,
          field_label,
          field_type
        )
      `)
      .eq('waiver_id', waiverId);

    if (error) {
      console.error('Error fetching field responses:', error);
      throw error;
    }

    return data || [];
  }

  // Save field response
  async saveFieldResponse(waiverId, fieldId, responseValue, responseData = null) {
    // Validate response first
    const isValid = await this.validateFieldResponse(fieldId, responseValue);
    if (!isValid) {
      throw new Error('Field response validation failed');
    }

    const { data, error } = await supabase
      .from('waiver_field_responses')
      .upsert({
        waiver_id: waiverId,
        field_id: fieldId,
        response_value: responseValue,
        response_data: responseData
      }, {
        onConflict: 'waiver_id,field_id'
      })
      .select()
      .single();

    if (error) {
      console.error('Error saving field response:', error);
      throw error;
    }

    return data;
  }
}

export default new WaiverFieldService();




