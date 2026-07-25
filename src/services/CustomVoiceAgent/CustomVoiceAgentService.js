// services/CustomVoiceAgent/CustomVoiceAgentService.js
// Service for managing Custom AI Voice Agents (Telnyx + OpenAI Realtime, no VAPI)
import { supabase } from '../../supabaseClient';
import CryptoJS from 'crypto-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;

export class CustomVoiceAgentService {
  constructor() {
    this.businessId = null;
    this.encryptionKey = import.meta.env.VITE_ENCRYPTION_KEY || 'default-key-change-in-production';
  }

  setBusinessId(businessId) {
    this.businessId = businessId;
  }

  /**
   * Encrypt sensitive data
   */
  encrypt(text) {
    if (!text) return null;
    try {
      return CryptoJS.AES.encrypt(text, this.encryptionKey).toString();
    } catch (error) {
      console.error('Encryption error:', error);
      return null;
    }
  }

  /**
   * Decrypt sensitive data
   */
  decrypt(encryptedText) {
    if (!encryptedText) return null;
    try {
      const bytes = CryptoJS.AES.decrypt(encryptedText, this.encryptionKey);
      return bytes.toString(CryptoJS.enc.Utf8);
    } catch (error) {
      console.error('Decryption error:', error);
      return null;
    }
  }

  /**
   * Get all custom voice agents for business
   */
  async getAgents() {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    console.log('🔍 Fetching agents for business:', this.businessId);
    
    const { data, error } = await supabase
      .from('custom_voice_agents')
      .select('*')
      .eq('business_id', this.businessId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('❌ Error fetching agents:', error);
      throw error;
    }
    
    console.log(`✅ Found ${data?.length || 0} agents:`, data?.map(a => ({ id: a.id, name: a.name, is_active: a.is_active, phone_number: a.phone_number })));
    
    return data || [];
  }

  /**
   * Get single agent by ID
   */
  async getAgent(agentId) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    const { data, error } = await supabase
      .from('custom_voice_agents')
      .select('*')
      .eq('id', agentId)
      .eq('business_id', this.businessId)
      .single();

    if (error) throw error;
    return data;
  }

  /**
   * Create new custom voice agent
   */
  async createAgent(agentData) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    const { data: { user } } = await supabase.auth.getUser();

    const { data, error } = await supabase
      .from('custom_voice_agents')
      .insert({
        business_id: this.businessId,
        name: agentData.name,
        description: agentData.description,
        industry_type: agentData.industryType,
        system_prompt: agentData.systemPrompt,
        first_message: agentData.firstMessage,
        voice_provider: agentData.voiceProvider || 'openai',
        voice_id: agentData.voiceId || 'alloy',
        model_provider: agentData.modelProvider || 'openai',
        model_name: agentData.modelName || 'gpt-4o-realtime-preview-2024-10-01',
        temperature: agentData.temperature || 0.7,
        max_tokens: agentData.maxTokens || 250,
        business_name: agentData.businessName,
        business_hours: agentData.businessHours,
        business_address: agentData.businessAddress,
        business_phone: agentData.businessPhone,
        services_config: agentData.servicesConfig || {},
        functions_config: agentData.functionsConfig || {},
        forward_to_phone: agentData.forwardToPhone,
        ring_count: agentData.ringCount || 3,
        is_active: false,
        is_enabled: true,
        created_by: user?.id || null,
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  /**
   * Update custom voice agent
   */
  async updateAgent(agentId, updates) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    const updatePayload = {
      ...updates,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from('custom_voice_agents')
      .update(updatePayload)
      .eq('id', agentId)
      .eq('business_id', this.businessId)
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  /**
   * Delete custom voice agent
   */
  async deleteAgent(agentId) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    const { error } = await supabase
      .from('custom_voice_agents')
      .delete()
      .eq('id', agentId)
      .eq('business_id', this.businessId);

    if (error) throw error;
  }

  /**
   * Get business configuration
   */
  async getConfiguration() {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    const { data, error } = await supabase
      .from('custom_voice_agent_configurations')
      .select('*')
      .eq('business_id', this.businessId)
      .maybeSingle();

    if (error) throw error;
    
    if (data) {
      return {
        ...data,
        telnyx_api_key: data.telnyx_api_key_encrypted ? this.decrypt(data.telnyx_api_key_encrypted) : null,
        openai_api_key: data.openai_api_key_encrypted ? this.decrypt(data.openai_api_key_encrypted) : null,
      };
    }
    
    return null;
  }

  /**
   * Save business configuration
   */
  async saveConfiguration(config) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    const configData = {
      business_id: this.businessId,
      telnyx_api_key_encrypted: config.telnyx_api_key ? this.encrypt(config.telnyx_api_key) : null,
      openai_api_key_encrypted: config.openai_api_key ? this.encrypt(config.openai_api_key) : null,
      webhook_url: config.webhook_url || null,
      default_voice_provider: config.default_voice_provider || 'openai',
      default_voice_id: config.default_voice_id || 'alloy',
      default_model: config.default_model || 'gpt-4o-realtime-preview-2024-10-01',
      notify_on_new_lead: config.notify_on_new_lead !== false,
      notify_on_call_failed: config.notify_on_call_failed || false,
      notify_on_booking: config.notify_on_booking !== false,
      notification_email: config.notification_email,
      notification_sms: config.notification_sms,
      max_capacity_per_slot: config.max_capacity_per_slot || 1,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from('custom_voice_agent_configurations')
      .upsert(configData, {
        onConflict: 'business_id',
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  /**
   * Get calls for agent
   */
  async getCalls(agentId, filters = {}) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    let query = supabase
      .from('custom_voice_agent_calls')
      .select('*')
      .eq('business_id', this.businessId);

    if (agentId) {
      query = query.eq('agent_id', agentId);
    }

    if (filters.status) {
      query = query.eq('status', filters.status);
    }

    if (filters.startDate) {
      query = query.gte('created_at', filters.startDate);
    }

    if (filters.endDate) {
      query = query.lte('created_at', filters.endDate);
    }

    query = query.order('created_at', { ascending: false })
      .limit(filters.limit || 100);

    const { data, error } = await query;

    if (error) throw error;
    return data || [];
  }

  /**
   * Get leads for agent
   */
  async getLeads(agentId, filters = {}) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    let query = supabase
      .from('custom_voice_agent_leads')
      .select('*')
      .eq('business_id', this.businessId);

    if (agentId) {
      query = query.eq('agent_id', agentId);
    }

    if (filters.status) {
      query = query.eq('status', filters.status);
    }

    query = query.order('created_at', { ascending: false })
      .limit(filters.limit || 100);

    const { data, error } = await query;

    if (error) throw error;
    return data || [];
  }

  /**
   * Get bookings/reservations
   */
  async getBookings(agentId, filters = {}) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    let query = supabase
      .from('voice_agent_bookings')
      .select('*')
      .eq('business_id', this.businessId);

    if (agentId) {
      query = query.eq('agent_id', agentId);
    }

    if (filters.status) {
      query = query.eq('status', filters.status);
    }

    if (filters.start_date) {
      query = query.gte('booking_date', filters.start_date);
    }

    if (filters.end_date) {
      query = query.lte('booking_date', filters.end_date);
    }

    query = query.order('booking_date', { ascending: true })
      .order('booking_time', { ascending: true })
      .limit(filters.limit || 200);

    const { data, error } = await query;

    if (error) throw error;
    return data || [];
  }

  /**
   * Get messages/callback requests
   */
  async getMessages(agentId, filters = {}) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    let query = supabase
      .from('custom_voice_agent_messages')
      .select('*')
      .eq('business_id', this.businessId);

    if (agentId) {
      query = query.eq('agent_id', agentId);
    }

    if (filters.status) {
      query = query.eq('status', filters.status);
    }

    query = query.order('created_at', { ascending: false })
      .limit(filters.limit || 100);

    const { data, error } = await query;

    if (error) throw error;
    return data || [];
  }

  /**
   * Update booking status
   */
  async updateBookingStatus(bookingId, status) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    const updateData = {
      status,
      updated_at: new Date().toISOString(),
    };

    if (status === 'cancelled') {
      updateData.cancelled_at = new Date().toISOString();
    }

    const { data, error } = await supabase
      .from('voice_agent_bookings')
      .update(updateData)
      .eq('id', bookingId)
      .eq('business_id', this.businessId)
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  /**
   * Create a booking manually
   */
  async createBooking(agentId, bookingData) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    if (!agentId) {
      throw new Error('Agent ID is required');
    }

    const { data, error } = await supabase
      .from('voice_agent_bookings')
      .insert({
        business_id: this.businessId,
        agent_id: agentId,
        customer_name: bookingData.customer_name,
        customer_phone: bookingData.customer_phone,
        customer_email: bookingData.customer_email || null,
        booking_type: bookingData.booking_type || 'appointment',
        service_type: bookingData.service_type || null,
        booking_date: bookingData.booking_date,
        booking_time: bookingData.booking_time,
        party_size: bookingData.party_size || 1,
        duration_minutes: bookingData.duration_minutes || 30,
        status: bookingData.status || 'confirmed',
        notes: bookingData.notes || null,
        confirmed_at: bookingData.status === 'confirmed' ? new Date().toISOString() : null,
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  /**
   * Update a booking
   */
  async updateBooking(bookingId, bookingData) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    const updateData = {
      customer_name: bookingData.customer_name,
      customer_phone: bookingData.customer_phone,
      customer_email: bookingData.customer_email || null,
      booking_type: bookingData.booking_type || 'appointment',
      service_type: bookingData.service_type || null,
      booking_date: bookingData.booking_date,
      booking_time: bookingData.booking_time,
      party_size: bookingData.party_size || 1,
      duration_minutes: bookingData.duration_minutes || 30,
      status: bookingData.status || 'confirmed',
      notes: bookingData.notes || null,
      updated_at: new Date().toISOString(),
    };

    // Update confirmed_at if status changed to confirmed
    if (bookingData.status === 'confirmed' && updateData.confirmed_at === undefined) {
      updateData.confirmed_at = new Date().toISOString();
    }

    // Update cancelled_at if status changed to cancelled
    if (bookingData.status === 'cancelled') {
      updateData.cancelled_at = new Date().toISOString();
    } else {
      updateData.cancelled_at = null;
    }

    const { data, error } = await supabase
      .from('voice_agent_bookings')
      .update(updateData)
      .eq('id', bookingId)
      .eq('business_id', this.businessId)
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  /**
   * Delete a booking
   */
  async deleteBooking(bookingId) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    const { error } = await supabase
      .from('voice_agent_bookings')
      .delete()
      .eq('id', bookingId)
      .eq('business_id', this.businessId);

    if (error) throw error;
    return true;
  }

  /**
   * Connect agent to Telnyx phone number (replaces VAPI createAgent)
   */
  async connectPhoneNumber(agentId, phoneNumber) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    const { data: { session }, error: sessionError } = await supabase.auth.getSession();

    if (sessionError || !session || !session.access_token) {
      throw new Error('Not authenticated');
    }

    const response = await fetch(
      `${SUPABASE_URL}/functions/v1/custom-voice-agent-connect-phone`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          agentId,
          businessId: this.businessId,
          phoneNumber,
        }),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || `Failed to connect phone number: ${response.status}`);
    }

    // Update agent with Telnyx phone number ID
    await this.updateAgent(agentId, {
      telnyx_phone_number_id: data.phoneNumberId,
      phone_number: phoneNumber,
      is_active: true,
    });

    return data;
  }

  /**
   * Get analytics/stats
   */
  async getAnalytics(agentId = null, dateRange = {}) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    let callsQuery = supabase
      .from('custom_voice_agent_calls')
      .select('*')
      .eq('business_id', this.businessId);

    if (agentId) {
      callsQuery = callsQuery.eq('agent_id', agentId);
    }

    if (dateRange.start) {
      callsQuery = callsQuery.gte('created_at', dateRange.start);
    }

    if (dateRange.end) {
      callsQuery = callsQuery.lte('created_at', dateRange.end);
    }

    const { data: calls, error: callsError } = await callsQuery;

    if (callsError) {
      throw callsError;
    }

    // Get call IDs that have messages
    const callIds = calls?.map(c => c.id).filter(Boolean) || [];
    let callsWithMessages = new Set();
    
    if (callIds.length > 0) {
      const { data: messages } = await supabase
        .from('custom_voice_agent_messages')
        .select('call_id')
        .eq('business_id', this.businessId)
        .in('call_id', callIds);
      
      if (messages) {
        callsWithMessages = new Set(messages.map(m => m.call_id).filter(Boolean));
      }
    }

    const totalCalls = calls?.length || 0;
    const answeredCalls = calls?.filter(c => c.was_answered).length || 0;
    const leadsCaptured = calls?.filter(c => c.lead_captured === true).length || 0;
    const bookingsCaptured = calls?.filter(c => c.booking_captured).length || 0;
    
    const callsHandledAutomatically = calls?.filter(c => {
      const wasAnswered = c.was_answered === true;
      const endedSuccessfully = c.status === 'ended' || c.status === 'completed';
      const noMessageNeeded = !callsWithMessages.has(c.id);
      const noBookingNeeded = !c.booking_captured;
      
      return wasAnswered && endedSuccessfully && noMessageNeeded && noBookingNeeded;
    }).length || 0;
    
    const automatedHandlingRate = answeredCalls > 0
      ? ((callsHandledAutomatically / answeredCalls) * 100).toFixed(1)
      : '0.0';
    
    const leadConversionRate = totalCalls > 0
      ? ((leadsCaptured / totalCalls) * 100).toFixed(1)
      : '0.0';

    return {
      totalCalls,
      answeredCalls,
      totalDuration: calls?.reduce((sum, c) => sum + (c.duration_seconds || 0), 0) || 0,
      averageDuration: totalCalls > 0 
        ? Math.round((calls.reduce((sum, c) => sum + (c.duration_seconds || 0), 0) / totalCalls))
        : 0,
      leadsCaptured,
      bookingsCaptured,
      callsHandledAutomatically,
      automatedHandlingRate,
      leadConversionRate,
      conversionRate: automatedHandlingRate,
    };
  }

  /**
   * Search available phone numbers from Telnyx
   */
  async searchPhoneNumbers(areaCode = null, state = null, countryCode = 'US') {
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();
    if (sessionError || !session || !session.access_token) {
      throw new Error('Not authenticated');
    }

    const response = await fetch(`${SUPABASE_URL}/functions/v1/custom-voice-agent-search-numbers`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        areaCode: areaCode || null,
        state: state || null,
        countryCode,
        limit: 5,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Failed to search phone numbers');
    }

    return data;
  }

  /**
   * Purchase a phone number from Telnyx
   */
  async purchasePhoneNumber(phoneNumber) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    const { data: { session }, error: sessionError } = await supabase.auth.getSession();
    if (sessionError || !session || !session.access_token) {
      throw new Error('Not authenticated');
    }

    const response = await fetch(`${SUPABASE_URL}/functions/v1/custom-voice-agent-purchase-number`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        phoneNumber,
        businessId: this.businessId,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Failed to purchase phone number');
    }

    return data;
  }

  /**
   * Get business-scoped FAQs
   */
  async getBusinessFAQs(businessId = null) {
    const targetBusinessId = businessId || this.businessId;
    if (!targetBusinessId) {
      throw new Error('Business ID is required');
    }
    
    const { data, error } = await supabase
      .from('custom_voice_agent_faqs')
      .select('*')
      .eq('business_id', targetBusinessId)
      .is('agent_id', null) // Business-scoped FAQs have null agent_id
      .eq('is_active', true)
      .order('display_order', { ascending: true });

    if (error) throw error;
    return data || [];
  }

  /**
   * Get knowledge base configuration
   */
  async getKnowledgeBase(businessId = null) {
    const targetBusinessId = businessId || this.businessId;
    if (!targetBusinessId) {
      throw new Error('Business ID is required');
    }

    const { data, error } = await supabase
      .from('custom_voice_agent_knowledge_base')
      .select('*')
      .eq('business_id', targetBusinessId)
      .maybeSingle();

    if (error) throw error;
    return data || null;
  }

  /**
   * Save knowledge base configuration
   */
  async saveKnowledgeBase(businessId, knowledgeBaseData) {
    const targetBusinessId = businessId || this.businessId;
    if (!targetBusinessId) {
      throw new Error('Business ID is required');
    }

    const { data: existing } = await supabase
      .from('custom_voice_agent_knowledge_base')
      .select('id')
      .eq('business_id', targetBusinessId)
      .maybeSingle();

    const payload = {
      business_id: targetBusinessId,
      first_message: knowledgeBaseData.first_message || null,
      last_message: knowledgeBaseData.last_message || null,
      personality_prompt: knowledgeBaseData.personality_prompt || null,
      personality_type: knowledgeBaseData.personality_type || null,
      knowledge_base_text: knowledgeBaseData.knowledge_base_text || null,
      products_pricing: knowledgeBaseData.products_pricing || null,
      layout_answer_message: knowledgeBaseData.layout_answer_message || null,
      layout_end_message: knowledgeBaseData.layout_end_message || null,
      updated_at: new Date().toISOString(),
    };

    let data, error;

    if (existing) {
      const result = await supabase
        .from('custom_voice_agent_knowledge_base')
        .update(payload)
        .eq('id', existing.id)
        .select()
        .single();
      data = result.data;
      error = result.error;
    } else {
      const result = await supabase
        .from('custom_voice_agent_knowledge_base')
        .insert(payload)
        .select()
        .single();
      data = result.data;
      error = result.error;
    }

    if (error) throw error;
    return data;
  }

  /**
   * Get business information
   */
  async getBusinessInfo() {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    const { data, error } = await supabase
      .from('businesses')
      .select('name, business_address, business_city, business_state, business_postal, business_phone, business_email, business_website, operating_hours, holiday_hours, timezone')
      .eq('id', this.businessId)
      .single();

    if (error) throw error;
    return data;
  }
}

export default CustomVoiceAgentService;

