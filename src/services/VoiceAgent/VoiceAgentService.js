// services/VoiceAgent/VoiceAgentService.js
// Service for managing AI voice agents
import { supabase } from '../../supabaseClient';
import CryptoJS from 'crypto-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;

export class VoiceAgentService {
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
   * Get all voice agents for business
   */
  async getAgents() {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    const { data, error } = await supabase
      .from('voice_agents')
      .select('*')
      .eq('business_id', this.businessId)
      .order('created_at', { ascending: false });

    if (error) throw error;
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
      .from('voice_agents')
      .select('*')
      .eq('id', agentId)
      .eq('business_id', this.businessId)
      .single();

    if (error) throw error;
    return data;
  }

  /**
   * Create new voice agent
   */
  async createAgent(agentData) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    const { data: { user } } = await supabase.auth.getUser();

    const { data, error } = await supabase
      .from('voice_agents')
      .insert({
        business_id: this.businessId,
        name: agentData.name,
        description: agentData.description,
        industry_type: agentData.industryType,
        system_prompt: agentData.systemPrompt,
        first_message: agentData.firstMessage,
        voice_provider: agentData.voiceProvider || 'openai',
        voice_id: agentData.voiceId || 'alloy',
        voice_style: agentData.voiceStyle || agentData.voice_style || null,
        model_provider: agentData.modelProvider || 'openai',
        model_name: agentData.modelName || 'gpt-4o-mini',
        temperature: agentData.temperature || 0.7,
        max_tokens: agentData.maxTokens || 250,
        business_name: agentData.businessName,
        business_hours: agentData.businessHours,
        business_address: agentData.businessAddress,
        business_phone: agentData.businessPhone,
        services_config: agentData.servicesConfig || {},
        functions_config: agentData.functionsConfig || {},
        knowledge_base: agentData.knowledge_base || agentData.knowledgeBase || '',
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
   * Update voice agent
   */
  async updateAgent(agentId, updates) {
    console.log('🔧 ========== UPDATE AGENT SERVICE CALLED ==========');
    console.log('🕐 Timestamp:', new Date().toISOString());
    console.log('📋 Parameters:', {
      agentId,
      businessId: this.businessId,
      updatesKeys: Object.keys(updates),
      updates
    });

    if (!this.businessId) {
      console.error('❌ Business ID is missing!');
      throw new Error('Business ID is required');
    }
    console.log('✅ Business ID validated:', this.businessId);

    console.log('📝 Updating agent:', agentId, 'with updates:', JSON.stringify(updates, null, 2));
    console.log('📝 Update includes voice_id:', updates.voice_id, 'voice_style:', updates.voice_style);

    // Ensure voice_id and voice_style are explicitly included
    const updatePayload = {
      ...updates,
      updated_at: new Date().toISOString(),
    };

    // Explicitly set voice_id and voice_style to ensure they're included
    if (updates.voice_id !== undefined) {
      updatePayload.voice_id = updates.voice_id;
      console.log('✅ voice_id explicitly set:', updatePayload.voice_id);
    }
    if (updates.voice_style !== undefined) {
      updatePayload.voice_style = updates.voice_style;
      console.log('✅ voice_style explicitly set:', updatePayload.voice_style);
    }

    console.log('📤 Final update payload:', JSON.stringify(updatePayload, null, 2));
    console.log('📤 Payload keys:', Object.keys(updatePayload));

    console.log('🔍 Executing Supabase update query...');
    console.log('🔍 Table: voice_agents');
    console.log('🔍 Where clause: id =', agentId, ', business_id =', this.businessId);
    
    const queryStartTime = Date.now();
    const { data, error } = await supabase
      .from('voice_agents')
      .update(updatePayload)
      .eq('id', agentId)
      .eq('business_id', this.businessId)
      .select()
      .single();
    const queryDuration = Date.now() - queryStartTime;

    console.log(`⏱️ Supabase query completed in ${queryDuration}ms`);

    if (error) {
      console.error('❌ ========== DATABASE UPDATE ERROR ==========');
      console.error('❌ Database update error:', error);
      console.error('❌ Error code:', error.code);
      console.error('❌ Error message:', error.message);
      console.error('❌ Error details:', error.details);
      console.error('❌ Error hint:', error.hint);
      console.error('❌ Full error object:', JSON.stringify(error, Object.getOwnPropertyNames(error), 2));
      
      // If error is about missing column, try updating without that column
      if (error.code === 'PGRST204' && error.message && error.message.includes('knowledge_base')) {
        console.warn('⚠️ knowledge_base column does not exist. Retrying update without it...');
        console.log('💡 Run migration: ALTER TABLE voice_agents ADD COLUMN IF NOT EXISTS knowledge_base text;');
        console.log('💡 See DATABASE_MIGRATIONS_NEEDED.md for full instructions');
        
        // Remove knowledge_base from update payload and retry
        const { knowledge_base, ...updateWithoutKnowledgeBase } = updatePayload;
        console.log('🔄 Retrying update without knowledge_base column...');
        
        const { data: retryData, error: retryError } = await supabase
          .from('voice_agents')
          .update(updateWithoutKnowledgeBase)
          .eq('id', agentId)
          .eq('business_id', this.businessId)
          .select()
          .single();
        
        if (retryError) {
          console.error('❌ Retry also failed:', retryError);
          throw new Error(`Failed to update agent: ${retryError.message}`);
        }
        
        console.warn('⚠️ Agent updated successfully, but knowledge_base was skipped (column does not exist)');
        console.warn('⚠️ To save knowledge base, run: ALTER TABLE voice_agents ADD COLUMN IF NOT EXISTS knowledge_base text;');
        return retryData;
      }
      
      throw new Error(error.message || 'Failed to update agent in database');
    }

    console.log('✅ ========== DATABASE UPDATE SUCCESSFUL ==========');
    console.log('✅ Agent updated successfully:', data);
    console.log('✅ Updated voice_id:', data?.voice_id);
    console.log('✅ Updated voice_style:', data?.voice_style);
    console.log('✅ Full returned data:', JSON.stringify(data, null, 2));
    console.log('✅ ========== UPDATE AGENT SERVICE COMPLETED ==========');
    return data;
  }

  /**
   * Delete voice agent
   */
  async deleteAgent(agentId) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    const { error } = await supabase
      .from('voice_agents')
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
      .from('voice_agent_configurations')
      .select('*')
      .eq('business_id', this.businessId)
      .maybeSingle();

    if (error) throw error;
    
    if (data) {
      // Decrypt Telnyx API key (Vapi is centralized, not stored per customer)
      return {
        ...data,
        vapi_api_key: null, // Managed by Tavari centrally
        telnyx_api_key: data.telnyx_api_key_encrypted ? this.decrypt(data.telnyx_api_key_encrypted) : null,
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
      // Vapi API key is now centralized - not stored per customer
      vapi_api_key_encrypted: null,
      telnyx_api_key_encrypted: config.telnyx_api_key ? this.encrypt(config.telnyx_api_key) : null,
      webhook_url: null, // Auto-generated by Edge Function
      default_voice_provider: config.default_voice_provider || '11labs',
      default_voice_id: config.default_voice_id || 'jennifer',
      default_model: config.default_model || 'gpt-4',
      notify_on_new_lead: config.notify_on_new_lead !== false,
      notify_on_call_failed: config.notify_on_call_failed || false,
      notification_email: config.notification_email,
      notification_sms: config.notification_sms,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from('voice_agent_configurations')
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
      .from('voice_agent_calls')
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
      .from('voice_agent_leads')
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
   * Create a booking manually (for in-person customers)
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
   * Create agent via Vapi API (calls Edge Function)
   */
  async createVapiAgent(agentId, phoneNumber) {
    console.log('📞 createVapiAgent called:', { agentId, phoneNumber, businessId: this.businessId });
    
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();

    if (sessionError || !session || !session.access_token) {
      console.error('❌ Authentication error:', sessionError);
      throw new Error('Not authenticated');
    }

    const agent = await this.getAgent(agentId);
    console.log('📋 Agent config:', agent);

    const requestBody = {
      agentId,
      businessId: this.businessId,
      phoneNumber,
    };

    console.log('🌐 Calling Edge Function:', `${SUPABASE_URL}/functions/v1/voice-agent-create`);
    console.log('📦 Request body:', requestBody);

    const response = await fetch(
      `${SUPABASE_URL}/functions/v1/voice-agent-create`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(requestBody),
      }
    );

    console.log('📡 Response status:', response.status, response.statusText);

    const responseText = await response.text();
    console.log('📄 Response text:', responseText);

    let data;
    try {
      data = JSON.parse(responseText);
    } catch (e) {
      console.error('❌ Failed to parse response:', e);
      throw new Error(`Invalid response from server: ${responseText}`);
    }

    if (!response.ok) {
      console.error('❌ Edge Function error:', data);
      throw new Error(data.error || `Failed to create Vapi agent: ${response.status}`);
    }

    console.log('✅ Edge Function success:', data);

    // Update agent with Vapi IDs
    await this.updateAgent(agentId, {
      vapi_assistant_id: data.assistantId,
      vapi_phone_number_id: data.phoneNumberId,
      phone_number: phoneNumber,
      is_active: true,
    });

    console.log('✅ Agent updated in database');
    return data;
  }

  /**
   * Get FAQs for an agent
   */
  async getFAQs(agentId) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    console.log('📋 Fetching FAQs for agent:', agentId);
    
    const { data, error } = await supabase
      .from('voice_agent_faqs')
      .select('*')
      .eq('agent_id', agentId)
      .order('display_order', { ascending: true });

    if (error) {
      console.error('❌ Error fetching FAQs:', error);
      throw error;
    }

    console.log('✅ FAQs fetched:', data?.length || 0);
    return data || [];
  }

  /**
   * Create a new FAQ
   */
  async createFAQ(agentId, faqData) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    console.log('📝 Creating FAQ for agent:', agentId);

    // Get current max display_order
    const { data: existingFAQs } = await supabase
      .from('voice_agent_faqs')
      .select('display_order')
      .eq('agent_id', agentId)
      .order('display_order', { ascending: false })
      .limit(1)
      .maybeSingle();

    const nextOrder = existingFAQs?.display_order != null 
      ? (existingFAQs.display_order + 1) 
      : 0;

    const { data, error } = await supabase
      .from('voice_agent_faqs')
      .insert({
        agent_id: agentId,
        business_id: this.businessId,
        question: faqData.question,
        answer: faqData.answer,
        display_order: nextOrder,
        is_active: faqData.is_active !== false,
      })
      .select()
      .single();

    if (error) {
      console.error('❌ Error creating FAQ:', error);
      throw error;
    }

    console.log('✅ FAQ created:', data.id);
    return data;
  }

  /**
   * Update an existing FAQ
   */
  async updateFAQ(faqId, faqData) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    console.log('📝 Updating FAQ:', faqId);

    const updatePayload = {
      updated_at: new Date().toISOString(),
    };

    if (faqData.question !== undefined) updatePayload.question = faqData.question;
    if (faqData.answer !== undefined) updatePayload.answer = faqData.answer;
    if (faqData.display_order !== undefined) updatePayload.display_order = faqData.display_order;
    if (faqData.is_active !== undefined) updatePayload.is_active = faqData.is_active;

    const { data, error } = await supabase
      .from('voice_agent_faqs')
      .update(updatePayload)
      .eq('id', faqId)
      .eq('business_id', this.businessId)
      .select()
      .single();

    if (error) {
      console.error('❌ Error updating FAQ:', error);
      throw error;
    }

    console.log('✅ FAQ updated:', data.id);
    return data;
  }

  /**
   * Delete an FAQ
   */
  async deleteFAQ(faqId) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    console.log('🗑️ Deleting FAQ:', faqId);

    const { error } = await supabase
      .from('voice_agent_faqs')
      .delete()
      .eq('id', faqId)
      .eq('business_id', this.businessId);

    if (error) {
      console.error('❌ Error deleting FAQ:', error);
      throw error;
    }

    console.log('✅ FAQ deleted');
  }

  /**
   * Get business information (for display in modal)
   */
  async getBusinessInfo() {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    console.log('🏢 Fetching business info for:', this.businessId);

    const { data, error } = await supabase
      .from('businesses')
      .select('name, business_address, business_city, business_state, business_postal, business_phone, business_email, business_website, operating_hours, holiday_hours, timezone')
      .eq('id', this.businessId)
      .single();

    if (error) {
      console.error('❌ Error fetching business info:', error);
      throw error;
    }

    console.log('✅ Business info fetched');
    return data;
  }

  /**
   * Get business-scoped FAQs (shared across all agents)
   */
  async getBusinessFAQs(businessId = null) {
    const targetBusinessId = businessId || this.businessId;
    if (!targetBusinessId) {
      throw new Error('Business ID is required');
    }

    console.log('📋 Fetching business-scoped FAQs for business:', targetBusinessId);
    
    const { data, error } = await supabase
      .from('voice_agent_faqs')
      .select('*')
      .eq('business_id', targetBusinessId)
      .eq('is_active', true)
      .order('display_order', { ascending: true });

    if (error) {
      console.error('❌ Error fetching business FAQs:', error);
      throw error;
    }

    console.log('✅ Business FAQs fetched:', data?.length || 0);
    return data || [];
  }

  /**
   * Create a new business-scoped FAQ
   */
  async createBusinessFAQ(businessId, faqData) {
    const targetBusinessId = businessId || this.businessId;
    if (!targetBusinessId) {
      throw new Error('Business ID is required');
    }

    console.log('📝 Creating business-scoped FAQ for business:', targetBusinessId);

    // Get current max display_order
    const { data: existingFAQs } = await supabase
      .from('voice_agent_faqs')
      .select('display_order')
      .eq('business_id', targetBusinessId)
      .order('display_order', { ascending: false })
      .limit(1)
      .maybeSingle();

    const nextOrder = existingFAQs?.display_order != null 
      ? (existingFAQs.display_order + 1) 
      : 0;

    const { data, error } = await supabase
      .from('voice_agent_faqs')
      .insert({
        business_id: targetBusinessId,
        question: faqData.question,
        answer: faqData.answer,
        display_order: nextOrder,
        is_active: faqData.is_active !== false,
      })
      .select()
      .single();

    if (error) {
      console.error('❌ Error creating business FAQ:', error);
      throw error;
    }

    console.log('✅ Business FAQ created:', data.id);
    return data;
  }

  /**
   * Update a business-scoped FAQ
   */
  async updateBusinessFAQ(faqId, faqData) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    console.log('📝 Updating business FAQ:', faqId);

    const updatePayload = {
      updated_at: new Date().toISOString(),
    };

    if (faqData.question !== undefined) updatePayload.question = faqData.question;
    if (faqData.answer !== undefined) updatePayload.answer = faqData.answer;
    if (faqData.display_order !== undefined) updatePayload.display_order = faqData.display_order;
    if (faqData.is_active !== undefined) updatePayload.is_active = faqData.is_active;

    const { data, error } = await supabase
      .from('voice_agent_faqs')
      .update(updatePayload)
      .eq('id', faqId)
      .eq('business_id', this.businessId)
      .select()
      .single();

    if (error) {
      console.error('❌ Error updating business FAQ:', error);
      throw error;
    }

    console.log('✅ Business FAQ updated:', data.id);
    return data;
  }

  /**
   * Delete a business-scoped FAQ
   */
  async deleteBusinessFAQ(faqId) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    console.log('🗑️ Deleting business FAQ:', faqId);

    const { error } = await supabase
      .from('voice_agent_faqs')
      .delete()
      .eq('id', faqId)
      .eq('business_id', this.businessId);

    if (error) {
      console.error('❌ Error deleting business FAQ:', error);
      throw error;
    }

    console.log('✅ Business FAQ deleted');
  }

  /**
   * Get knowledge base configuration for a business
   */
  async getKnowledgeBase(businessId = null) {
    const targetBusinessId = businessId || this.businessId;
    if (!targetBusinessId) {
      throw new Error('Business ID is required');
    }

    console.log('📚 Fetching knowledge base for business:', targetBusinessId);

    const { data, error } = await supabase
      .from('voice_agent_knowledge_base')
      .select('*')
      .eq('business_id', targetBusinessId)
      .maybeSingle();

    if (error) {
      console.error('❌ Error fetching knowledge base:', error);
      throw error;
    }

    console.log('✅ Knowledge base fetched:', data ? 'found' : 'not found');
    return data || null;
  }

  /**
   * Save knowledge base configuration for a business
   */
  async saveKnowledgeBase(businessId, knowledgeBaseData) {
    const targetBusinessId = businessId || this.businessId;
    if (!targetBusinessId) {
      throw new Error('Business ID is required');
    }

    console.log('💾 Saving knowledge base for business:', targetBusinessId);

    // Check if knowledge base exists
    const { data: existing } = await supabase
      .from('voice_agent_knowledge_base')
      .select('id')
      .eq('business_id', targetBusinessId)
      .maybeSingle();

    const payload = {
      business_id: targetBusinessId,
      first_message: knowledgeBaseData.first_message || null,
      last_message: knowledgeBaseData.last_message || null,
      personality_prompt: knowledgeBaseData.personality_prompt || null,
      knowledge_base_text: knowledgeBaseData.knowledge_base_text || null,
      updated_at: new Date().toISOString(),
    };

    let data, error;

    if (existing) {
      // Update existing
      const result = await supabase
        .from('voice_agent_knowledge_base')
        .update(payload)
        .eq('id', existing.id)
        .select()
        .single();
      data = result.data;
      error = result.error;
    } else {
      // Insert new
      const result = await supabase
        .from('voice_agent_knowledge_base')
        .insert(payload)
        .select()
        .single();
      data = result.data;
      error = result.error;
    }

    if (error) {
      console.error('❌ Error saving knowledge base:', error);
      throw error;
    }

    console.log('✅ Knowledge base saved:', data.id);
    return data;
  }

  /**
   * Rebuild all active agents for a business
   */
  async rebuildAllAgents(businessId = null) {
    const targetBusinessId = businessId || this.businessId;
    if (!targetBusinessId) {
      throw new Error('Business ID is required');
    }

    console.log('🔄 Rebuilding all active agents for business:', targetBusinessId);

    // Get all active agents for this business
    const { data: agents, error: agentsError } = await supabase
      .from('voice_agents')
      .select('id, name, vapi_assistant_id')
      .eq('business_id', targetBusinessId)
      .eq('is_active', true);

    if (agentsError) {
      console.error('❌ Error fetching agents:', agentsError);
      throw agentsError;
    }

    if (!agents || agents.length === 0) {
      console.log('ℹ️ No active agents found to rebuild');
      return {
        successCount: 0,
        failedCount: 0,
        total: 0,
        results: [],
      };
    }

    console.log(`🔄 Found ${agents.length} active agent(s) to rebuild`);

    const results = [];
    let successCount = 0;
    let failedCount = 0;

    // Rebuild each agent sequentially (to avoid overwhelming the API)
    for (const agent of agents) {
      if (!agent.vapi_assistant_id) {
        console.log(`⏭️ Skipping agent ${agent.name} (no Vapi assistant ID)`);
        results.push({
          agentId: agent.id,
          agentName: agent.name,
          success: false,
          error: 'No Vapi assistant ID',
        });
        failedCount++;
        continue;
      }

      try {
        console.log(`🔄 Rebuilding agent: ${agent.name} (${agent.id})`);
        await this.rebuildVapiAssistant(agent.id);
        console.log(`✅ Successfully rebuilt agent: ${agent.name}`);
        results.push({
          agentId: agent.id,
          agentName: agent.name,
          success: true,
        });
        successCount++;
      } catch (error) {
        console.error(`❌ Failed to rebuild agent ${agent.name}:`, error);
        results.push({
          agentId: agent.id,
          agentName: agent.name,
          success: false,
          error: error.message || 'Unknown error',
        });
        failedCount++;
      }
    }

    console.log(`✅ Rebuild complete: ${successCount} succeeded, ${failedCount} failed`);

    return {
      successCount,
      failedCount,
      total: agents.length,
      results,
    };
  }

  /**
   * Rebuild Vapi assistant with latest data (system prompt, FAQs, business info, etc.)
   */
  async rebuildVapiAssistant(agentId) {
    console.log('🔄 ========== REBUILD VAPI ASSISTANT SERVICE CALLED ==========');
    console.log('🕐 Timestamp:', new Date().toISOString());
    console.log('🔄 rebuildVapiAssistant called:', { 
      agentId, 
      businessId: this.businessId 
    });

    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    if (!agentId) {
      throw new Error('Agent ID is required');
    }

    const { data: { session }, error: sessionError } = await supabase.auth.getSession();
    if (sessionError || !session || !session.access_token) {
      throw new Error('Not authenticated');
    }

    const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
    const response = await fetch(`${SUPABASE_URL}/functions/v1/voice-agent-update`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        agentId,
        businessId: this.businessId,
        rebuildAssistant: true, // Flag to rebuild full assistant
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('❌ Rebuild assistant error:', data);
      throw new Error(data.error || 'Failed to rebuild Vapi assistant');
    }

    console.log('✅ Vapi assistant rebuilt successfully:', data);
    return data;
  }

  /**
   * Update Vapi assistant configuration (voice settings, etc.)
   */
  async updateVapiAssistant(agentId, voiceSettings) {
    console.log('🔄 ========== UPDATE VAPI ASSISTANT SERVICE CALLED ==========');
    console.log('🕐 Timestamp:', new Date().toISOString());
    console.log('🔄 updateVapiAssistant called:', { 
      agentId, 
      voiceSettings,
      businessId: this.businessId 
    });
    
    console.log('🔍 Step 1: Getting auth session...');
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();

    if (sessionError || !session || !session.access_token) {
      console.error('❌ Authentication error:', sessionError);
      console.error('❌ Session:', session);
      throw new Error('Not authenticated');
    }
    console.log('✅ Authentication validated');

    console.log('🔍 Step 2: Getting agent from database...');
    const agent = await this.getAgent(agentId);
    console.log('📋 Agent config:', {
      id: agent.id,
      name: agent.name,
      vapi_assistant_id: agent.vapi_assistant_id,
      voice_id: agent.voice_id,
      voice_style: agent.voice_style
    });

    if (!agent.vapi_assistant_id) {
      console.error('❌ Agent does not have a Vapi assistant ID');
      throw new Error('Agent does not have a Vapi assistant ID. Please connect a phone number first.');
    }
    console.log('✅ Vapi assistant ID found:', agent.vapi_assistant_id);

    console.log('🔍 Step 3: Building request body...');
    const requestBody = {
      agentId,
      businessId: this.businessId,
      voiceSettings: {
        voice_id: voiceSettings.voice_id || agent.voice_id,
        voice_style: voiceSettings.voice_style || agent.voice_style,
      },
    };

    console.log('🌐 Calling Edge Function to update Vapi assistant:', `${SUPABASE_URL}/functions/v1/voice-agent-update`);
    console.log('📦 Request body:', JSON.stringify(requestBody, null, 2));
    console.log('📦 Voice settings being sent:', requestBody.voiceSettings);

    console.log('🔍 Step 4: Making HTTP request to edge function...');
    const fetchStartTime = Date.now();
    const response = await fetch(
      `${SUPABASE_URL}/functions/v1/voice-agent-update`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(requestBody),
      }
    );
    const fetchDuration = Date.now() - fetchStartTime;
    console.log(`⏱️ HTTP request completed in ${fetchDuration}ms`);

    console.log('📡 Response status:', response.status, response.statusText);
    console.log('📡 Response headers:', Object.fromEntries(response.headers.entries()));

    const responseText = await response.text();
    console.log('📄 Response text (raw):', responseText);

    let data;
    try {
      data = JSON.parse(responseText);
      console.log('✅ Response parsed successfully:', JSON.stringify(data, null, 2));
    } catch (e) {
      console.error('❌ Failed to parse response:', e);
      console.error('❌ Response text that failed to parse:', responseText);
      throw new Error(`Invalid response from server: ${responseText}`);
    }

    if (!response.ok) {
      console.error('❌ ========== EDGE FUNCTION ERROR ==========');
      console.error('❌ Edge Function error:', data);
      console.error('❌ Response status:', response.status);
      console.error('❌ Full error object:', JSON.stringify(data, null, 2));
      throw new Error(data.error || `Failed to update Vapi assistant: ${response.status}`);
    }

    console.log('✅ ========== VAPI ASSISTANT UPDATE SUCCESSFUL ==========');
    console.log('✅ Vapi assistant updated successfully:', data);
    console.log('✅ ========== UPDATE VAPI ASSISTANT SERVICE COMPLETED ==========');
    return data;
  }

  /**
   * Get analytics/stats
   */
  async getAnalytics(agentId = null, dateRange = {}) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    console.log('📊 Fetching analytics for business:', this.businessId, 'agentId:', agentId);

    let callsQuery = supabase
      .from('voice_agent_calls')
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
      console.error('❌ Error fetching calls:', callsError);
      throw callsError;
    }

    console.log('📞 Found calls:', calls?.length || 0, calls);

    // Get call IDs that have messages (callback requests)
    const callIds = calls?.map(c => c.id).filter(Boolean) || [];
    let callsWithMessages = new Set();
    
    if (callIds.length > 0) {
      const { data: messages } = await supabase
        .from('voice_agent_messages')
        .select('call_id')
        .eq('business_id', this.businessId)
        .in('call_id', callIds);
      
      if (messages) {
        callsWithMessages = new Set(messages.map(m => m.call_id).filter(Boolean));
      }
    }

    const totalCalls = calls?.length || 0;
    const answeredCalls = calls?.filter(c => c.was_answered).length || 0;
    // Count leads from voice_agent_calls table where lead_captured = true
    const leadsCaptured = calls?.filter(c => c.lead_captured === true).length || 0;
    const bookingsCaptured = calls?.filter(c => c.booking_captured).length || 0;
    
    // Calculate "Calls Handled Automatically" - answered calls that didn't require callback or booking
    // These are calls where the AI successfully handled the request without human intervention
    const callsHandledAutomatically = calls?.filter(c => {
      const wasAnswered = c.was_answered === true;
      const endedSuccessfully = c.status === 'ended' || c.status === 'completed';
      const noMessageNeeded = !callsWithMessages.has(c.id);
      const noBookingNeeded = !c.booking_captured;
      
      return wasAnswered && endedSuccessfully && noMessageNeeded && noBookingNeeded;
    }).length || 0;
    
    // Update conversion rate to show automated handling rate (more meaningful metric)
    // Shows what percentage of answered calls were fully handled by AI
    const automatedHandlingRate = answeredCalls > 0
      ? ((callsHandledAutomatically / answeredCalls) * 100).toFixed(1)
      : '0.0';
    
    // Also keep lead conversion rate (leads per total calls)
    const leadConversionRate = totalCalls > 0
      ? ((leadsCaptured / totalCalls) * 100).toFixed(1)
      : '0.0';

    const stats = {
      totalCalls,
      answeredCalls,
      totalDuration: calls?.reduce((sum, c) => sum + (c.duration_seconds || 0), 0) || 0,
      averageDuration: totalCalls > 0 
        ? Math.round((calls.reduce((sum, c) => sum + (c.duration_seconds || 0), 0) / totalCalls))
        : 0,
      leadsCaptured,
      bookingsCaptured,
      callsHandledAutomatically, // New metric: calls fully handled by AI
      automatedHandlingRate, // Percentage of answered calls handled automatically
      leadConversionRate, // Lead conversion rate (leads per total calls)
      conversionRate: automatedHandlingRate, // Keep for backward compatibility but use new metric
    };

    console.log('📊 Calculated stats:', stats);
    return stats;
  }

  /**
   * Sync calls from Vapi API (queries Vapi directly as backup to webhooks)
   */
  async syncCalls(agentId = null, days = 7) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    console.log('🔄 ========== SYNC CALLS FROM VAPI API ==========');
    console.log('🕐 Timestamp:', new Date().toISOString());
    console.log('🔄 syncCalls called:', {
      agentId,
      businessId: this.businessId,
      days
    });

    const { data: { session }, error: sessionError } = await supabase.auth.getSession();
    if (sessionError || !session || !session.access_token) {
      throw new Error('Not authenticated');
    }

    const response = await fetch(`${SUPABASE_URL}/functions/v1/voice-agent-sync-calls`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        businessId: this.businessId,
        agentId: agentId || null,
        days: days || 7,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('❌ Sync calls error:', data);
      
      // Handle different error cases
      if (response.status === 404) {
        throw new Error('Sync function not found. Please ensure the function is deployed.');
      }
      
      if (data.error === 'No agents found') {
        throw new Error('No voice agents found. Please create an agent first before syncing calls.');
      }
      
      throw new Error(data.error || data.message || 'Failed to sync calls from Vapi API');
    }

    console.log('✅ Calls synced successfully:', data);
    return data;
  }

  /**
   * Search available phone numbers from Telnyx
   */
  async searchPhoneNumbers(areaCode = null, state = null, countryCode = 'US') {
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();
    if (sessionError || !session || !session.access_token) {
      throw new Error('Not authenticated');
    }

    const response = await fetch(`${SUPABASE_URL}/functions/v1/voice-agent-search-numbers`, {
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

    const response = await fetch(`${SUPABASE_URL}/functions/v1/voice-agent-purchase-number`, {
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
   * Configure call forwarding for a phone number
   */
  async configureCallForwarding(phoneNumberId, forwardToPhone, ringCount = 3, enabled = true) {
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();
    if (sessionError || !session || !session.access_token) {
      throw new Error('Not authenticated');
    }

    const response = await fetch(`${SUPABASE_URL}/functions/v1/voice-agent-configure-forwarding`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        phoneNumberId,
        forwardToPhone,
        ringCount,
        enabled,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Failed to configure call forwarding');
    }

    return data;
  }
}

export default VoiceAgentService;

