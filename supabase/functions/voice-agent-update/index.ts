// supabase/functions/voice-agent-update/index.ts
// Updates existing Vapi assistant configuration (voice settings, etc.)
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  console.log('🔄 ========== VOICE AGENT UPDATE EDGE FUNCTION CALLED ==========');
  console.log('🕐 Timestamp:', new Date().toISOString());
  console.log('📥 Request method:', req.method);
  console.log('📥 Request URL:', req.url);

  try {
    console.log('🔍 Step 1: Loading environment variables...');
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    console.log('✅ Environment variables loaded');
    console.log('🔗 Supabase URL:', supabaseUrl);
    
    // Create Supabase client with service role
    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    console.log('🔍 Step 2: Verifying user authentication...');
    // Verify user authentication
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      console.error('❌ No authorization header found');
      throw new Error('No authorization header');
    }
    console.log('✅ Authorization header found');

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);

    if (userError || !user) {
      console.error('❌ Authentication failed:', userError);
      throw new Error('Invalid authentication');
    }
    console.log('✅ User authenticated:', user.id);

    console.log('🔍 Step 3: Parsing request body...');
    // Parse request body
    const requestBody = await req.json();
    console.log('📦 Request body received:', JSON.stringify(requestBody, null, 2));
    
    const { agentId, businessId, voiceSettings, rebuildAssistant } = requestBody;

    if (!agentId || !businessId) {
      console.error('❌ Missing required parameters:', { agentId, businessId });
      throw new Error('Missing required parameters: agentId, businessId');
    }
    
    // If rebuildAssistant is true, we need to rebuild the full assistant
    // Otherwise, just update voice settings if provided
    if (rebuildAssistant && !voiceSettings) {
      console.log('ℹ️ Rebuild assistant requested, will fetch latest agent data');
    } else if (!rebuildAssistant && !voiceSettings) {
      console.error('❌ Missing voiceSettings or rebuildAssistant flag');
      throw new Error('Missing voiceSettings or rebuildAssistant flag');
    }
    console.log('✅ All required parameters present');

    console.log('🔍 Step 4: Fetching agent from database...');
    // Get agent configuration
    const { data: agent, error: agentError } = await supabase
      .from('voice_agents')
      .select('*')
      .eq('id', agentId)
      .eq('business_id', businessId)
      .single();

    if (agentError || !agent) {
      console.error('❌ Agent not found:', agentError);
      throw new Error('Agent not found');
    }
    console.log('✅ Agent found:', {
      id: agent.id,
      name: agent.name,
      vapi_assistant_id: agent.vapi_assistant_id,
      voice_id: agent.voice_id,
      voice_style: agent.voice_style
    });

    if (!agent.vapi_assistant_id) {
      console.error('❌ Agent does not have Vapi assistant ID');
      throw new Error('Agent does not have a Vapi assistant. Please connect a phone number first.');
    }
    console.log('✅ Vapi assistant ID found:', agent.vapi_assistant_id);

    console.log('🔍 Step 5: Getting Vapi API key...');
    // Get Vapi API key
    const vapiApiKey = Deno.env.get('VAPI_API_KEY');
    if (!vapiApiKey) {
      console.error('❌ Vapi API key not configured');
      throw new Error('Vapi API key not configured');
    }
    console.log('✅ Vapi API key loaded');

    // Use the supabaseUrl already declared at the top
    const webhookUrl = `${supabaseUrl}/functions/v1/voice-agent-webhook`;

    // If rebuildAssistant is true, rebuild the full assistant with latest data
    if (rebuildAssistant) {
      console.log('🔄 Rebuilding full assistant with latest data...');
      
      // Fetch business information
      console.log('🔍 Fetching business information...');
      const { data: business, error: businessError } = await supabase
        .from('businesses')
        .select('name, business_address, business_city, business_state, business_postal, business_phone, business_email, business_website, operating_hours, holiday_hours, timezone')
        .eq('id', businessId)
        .single();

      if (businessError) {
        console.error('❌ Error fetching business info:', businessError);
      } else {
        console.log('✅ Business info fetched');
      }

      // Fetch Knowledge Base (business-scoped)
      console.log('🔍 Fetching knowledge base...');
      const { data: knowledgeBase, error: kbError } = await supabase
        .from('voice_agent_knowledge_base')
        .select('first_message, last_message, personality_prompt, knowledge_base_text')
        .eq('business_id', businessId)
        .maybeSingle();

      if (kbError) {
        console.error('❌ Error fetching knowledge base:', kbError);
      } else {
        console.log('✅ Knowledge base fetched:', knowledgeBase ? 'found' : 'not found');
      }

      // Fetch FAQs (business-scoped, shared across all agents)
      console.log('🔍 Fetching business-scoped FAQs...');
      const { data: faqs, error: faqsError } = await supabase
        .from('voice_agent_faqs')
        .select('question, answer, display_order')
        .eq('business_id', businessId)
        .eq('is_active', true)
        .order('display_order', { ascending: true });

      if (faqsError) {
        console.error('❌ Error fetching FAQs:', faqsError);
      } else {
        console.log('✅ FAQs fetched:', faqs?.length || 0);
      }

      // Helper functions to format hours
      const formatOperatingHours = (hoursJsonb: any): string => {
        if (!hoursJsonb || typeof hoursJsonb !== 'object') return 'Hours not available.';
        const dayNames: { [key: string]: string } = {
          monday: 'Monday', tuesday: 'Tuesday', wednesday: 'Wednesday', thursday: 'Thursday',
          friday: 'Friday', saturday: 'Saturday', sunday: 'Sunday'
        };
        const dayKeys = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
        const result: string[] = [];
        for (const dayKey of dayKeys) {
          const dayData = hoursJsonb[dayKey];
          if (dayData) {
            if (dayData.closed === true) {
              result.push(`${dayNames[dayKey]}: Closed`);
            } else {
              result.push(`${dayNames[dayKey]}: ${dayData.open || ''} - ${dayData.close || ''}`);
            }
          }
        }
        return result.join('\n') || 'Hours not available.';
      };

      const formatHolidayHours = (holidaysJsonb: any): string => {
        if (!holidaysJsonb || !Array.isArray(holidaysJsonb) || holidaysJsonb.length === 0) {
          return 'No special holiday hours.';
        }
        const result: string[] = [];
        for (const holiday of holidaysJsonb) {
          if (holiday && typeof holiday === 'object') {
            const name = holiday.name || 'Holiday';
            const date = holiday.date || '';
            const hours = holiday.hours || '';
            result.push(`${name}: ${date}${hours ? ' - ' + hours : ''}`);
          }
        }
        return result.join('\n') || 'No special holiday hours.';
      };

      // Helper function to check if business is currently open
      const checkIfOpenNow = (hoursJsonb: any, timezone: string): { isOpen: boolean; message: string } => {
        try {
          const now = new Date();
          const formatter = new Intl.DateTimeFormat('en-US', {
            timeZone: timezone,
            weekday: 'long',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
          });
          
          const parts = formatter.formatToParts(now);
          const dayName = parts.find(p => p.type === 'weekday')?.value.toLowerCase() || '';
          const currentHour = parseInt(parts.find(p => p.type === 'hour')?.value || '0');
          const currentMinute = parseInt(parts.find(p => p.type === 'minute')?.value || '0');
          const currentTime = currentHour * 60 + currentMinute;
          
          const operatingHours = hoursJsonb || {};
          const dayHours = operatingHours[dayName];
          
          if (!dayHours || dayHours.closed === true) {
            return {
              isOpen: false,
              message: `Closed today (${dayName.charAt(0).toUpperCase() + dayName.slice(1)}).`
            };
          }
          
          const openTimeStr = dayHours.open || '';
          const closeTimeStr = dayHours.close || '';
          
          if (!openTimeStr || !closeTimeStr) {
            return {
              isOpen: false,
              message: 'Unable to determine hours for today.'
            };
          }
          
          const [openHour, openMin] = openTimeStr.split(':').map(Number);
          const [closeHour, closeMin] = closeTimeStr.split(':').map(Number);
          const openTime = openHour * 60 + openMin;
          const closeTime = closeHour * 60 + closeMin;
          
          const formatTime = (hours: number, minutes: number) => {
            const h12 = hours % 12 || 12;
            const ampm = hours >= 12 ? 'PM' : 'AM';
            return `${h12}:${minutes.toString().padStart(2, '0')} ${ampm}`;
          };
          
          if (currentTime >= openTime && currentTime < closeTime) {
            return {
              isOpen: true,
              message: `Open until ${formatTime(closeHour, closeMin)} today.`
            };
          } else if (currentTime < openTime) {
            return {
              isOpen: false,
              message: `Closed now. Opens at ${formatTime(openHour, openMin)} today.`
            };
          } else {
            return {
              isOpen: false,
              message: `Closed now. Was open ${formatTime(openHour, openMin)} - ${formatTime(closeHour, closeMin)} today.`
            };
          }
        } catch (error) {
          return {
            isOpen: false,
            message: 'Unable to check current status.'
          };
        }
      };

      // Build enhanced system prompt
      // Use personality_prompt from knowledge base, fallback to agent.system_prompt
      let enhancedSystemPrompt = knowledgeBase?.personality_prompt || agent.system_prompt || '';

      // Add business information
      if (business) {
        enhancedSystemPrompt += `\n\n=== BUSINESS INFORMATION ===\n`;
        enhancedSystemPrompt += `Business Name: ${business.name}\n`;
        
        const addressParts: string[] = [];
        if (business.business_address) addressParts.push(business.business_address);
        if (business.business_city) addressParts.push(business.business_city);
        if (business.business_state) addressParts.push(business.business_state);
        if (business.business_postal) addressParts.push(business.business_postal);
        if (addressParts.length > 0) {
          enhancedSystemPrompt += `Address: ${addressParts.join(', ')}\n`;
        }
        
        if (business.business_phone) enhancedSystemPrompt += `Phone: ${business.business_phone}\n`;
        if (business.business_email) enhancedSystemPrompt += `Email: ${business.business_email}\n`;
        if (business.business_website) enhancedSystemPrompt += `Website: ${business.business_website}\n`;
        if (business.timezone) enhancedSystemPrompt += `Timezone: ${business.timezone}\n`;
        enhancedSystemPrompt += `=== END BUSINESS INFORMATION ===\n`;

        if (business.operating_hours) {
          enhancedSystemPrompt += `\n=== OPERATING HOURS ===\n`;
          enhancedSystemPrompt += `${formatOperatingHours(business.operating_hours)}\n`;
          enhancedSystemPrompt += `=== END OPERATING HOURS ===\n`;
        }

        if (business.holiday_hours && Array.isArray(business.holiday_hours) && business.holiday_hours.length > 0) {
          enhancedSystemPrompt += `\n=== HOLIDAY HOURS ===\n`;
          enhancedSystemPrompt += `${formatHolidayHours(business.holiday_hours)}\n`;
          enhancedSystemPrompt += `=== END HOLIDAY HOURS ===\n`;
        }

        // Calculate current date and time in business timezone
        const timezoneStr = business.timezone || 'America/Toronto';
        const now = new Date();
        const dateFormatter = new Intl.DateTimeFormat('en-US', {
          timeZone: timezoneStr,
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
          hour12: true,
        });
        const currentDateTime = dateFormatter.format(now);
        const dateFormatterShort = new Intl.DateTimeFormat('en-US', {
          timeZone: timezoneStr,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        });
        const currentDateShort = dateFormatterShort.format(now);
        
        // Calculate current open/closed status and include it in prompt
        const currentStatus = business.operating_hours 
          ? checkIfOpenNow(business.operating_hours, timezoneStr)
          : { isOpen: false, message: 'Hours not available.' };
        
        // Add current date and time section
        enhancedSystemPrompt += `\n=== CURRENT DATE AND TIME ===
CRITICAL: The current date and time in ${timezoneStr} is: ${currentDateTime}
Today's date in YYYY-MM-DD format is: ${currentDateShort.split('/').reverse().join('-')}

You MUST use this date when answering questions about:
- "What day is it?" → Answer with: ${currentDateTime.split(',')[0]}, ${currentDateTime.split(',')[1]}
- "What's today's date?" → Answer with: ${currentDateTime.split(',')[1]}
- "What date is it?" → Answer with: ${currentDateTime}
- Scheduling appointments → Use ${currentDateShort.split('/').reverse().join('-')} as today's date
- Comparing dates → Use this as the reference point

DO NOT use your training data cutoff date or guess the date. Always use the date shown above: ${currentDateTime}
=== END CURRENT DATE AND TIME ===

=== CURRENT BUSINESS STATUS ===
As of right now (${timezoneStr} timezone), the business is: ${currentStatus.isOpen ? 'OPEN' : 'CLOSED'}

${currentStatus.message}

When asked "Are you open?", "Are you open right now?", or similar questions, answer IMMEDIATELY using the status above. 
Do NOT call any functions or try to calculate - just use the status shown above.

Example responses:
- If OPEN: "Yes, we're open! ${currentStatus.message}"
- If CLOSED: "No, we're currently closed. ${currentStatus.message} Would you like me to take a message?"

=== END CURRENT BUSINESS STATUS ===\n`;
      }

      // Add FAQs
      if (faqs && faqs.length > 0) {
        enhancedSystemPrompt += `\n=== FREQUENTLY ASKED QUESTIONS ===\n`;
        faqs.forEach((faq: any, index: number) => {
          enhancedSystemPrompt += `Q${index + 1}: ${faq.question}\n`;
          enhancedSystemPrompt += `A${index + 1}: ${faq.answer}\n\n`;
        });
        enhancedSystemPrompt += `=== END FREQUENTLY ASKED QUESTIONS ===\n`;
      }

      // Add knowledge base text (from knowledge base table or agent table)
      const knowledgeBaseText = knowledgeBase?.knowledge_base_text || agent.knowledge_base || '';
      if (knowledgeBaseText && knowledgeBaseText.trim()) {
        enhancedSystemPrompt += `\n\n=== KNOWLEDGE BASE ===\n`;
        enhancedSystemPrompt += `The following information is the ONLY information you should use to answer questions:\n\n${knowledgeBaseText}\n\n`;
        enhancedSystemPrompt += `=== END KNOWLEDGE BASE ===\n`;
      }

      // Add confidence scoring instructions
      const confidenceThreshold = agent.confidence_threshold || 98.0;
      enhancedSystemPrompt += `\n\n=== CONFIDENCE SCORING RULES ===
IMPORTANT: Before answering ANY question, assess your confidence level.

**${confidenceThreshold}%+ Confidence Required**
- Only answer if you are ${confidenceThreshold}% or more confident your answer is:
  - Complete and accurate
  - Found in the business information, FAQs, knowledge base, or system prompt above
  - Appropriate for the caller's needs

**If Confidence < ${confidenceThreshold}%:**
- DO NOT attempt to answer
- Politely say: "I want to make sure I give you the most accurate information about that. Let me take a message and have one of our team members call you back."
- Call the 'take_message_for_callback' function to collect caller information

=== END CONFIDENCE SCORING RULES ===

=== BOOKING & RESERVATION INSTRUCTIONS ===
When callers ask about booking appointments, making reservations, or scheduling callbacks:

1. **For Appointments (haircuts, consultations, services):**
   - First, call 'check_availability' to verify the requested date/time is available
   - If available, collect: name, phone, email (optional), service type, preferred date/time
   - Then call 'book_appointment' to confirm the booking
   - Always provide the confirmation code to the caller

2. **For Restaurant Reservations:**
   - First, call 'check_availability' with the date, time, and party size
   - If available, collect: name, phone, email (optional), date, time, party size, special requests
   - Then call 'book_reservation' to confirm the reservation
   - Always provide the confirmation code to the caller

3. **For Callback Scheduling:**
   - Use 'book_appointment' with booking_type: 'callback'
   - Collect: name, phone, preferred callback date/time

4. **Important Rules:**
   - ALWAYS check availability BEFORE booking
   - If the requested time is unavailable, suggest alternative times from the response
   - Be friendly and helpful - offer to book immediately when caller is ready
   - Confirm all details (date, time, name, phone) before booking
   - Provide the confirmation code after successful booking

=== END BOOKING & RESERVATION INSTRUCTIONS ===

=== HANDLING NOISY ENVIRONMENTS ===
Background noise (TV, music, etc.) may interfere with conversations. The system is configured to ignore brief background sounds:

1. **Ignore brief background sounds:**
   - The system requires clear speech (6+ words) before interrupting you
   - Brief background noise should NOT interrupt your responses
   - Continue speaking even if you hear brief background sounds
   - Only stop if you clearly hear the caller speaking multiple words

2. **If you have trouble understanding the caller:**
   - Ask for clarification ONCE: "I'm having trouble hearing you clearly. Could you repeat that?"
   - If still unclear: "I'm having difficulty understanding you. Let me take a message and someone will call you back."
   - Use the 'take_message_for_callback' function

3. **Important Rules:**
   - Don't let background noise interrupt your responses - the system filters it out
   - Be patient and continue your responses even with background noise present
   - If you can't understand the caller after asking once, take a message

=== END HANDLING NOISY ENVIRONMENTS ===

=== ISSUE REPORTING ===
If you notice any of the following issues, use the 'report_issue' function to notify the business:

1. **Knowledge Gaps:**
   - Caller asks a question you cannot answer from the provided information
   - Caller asks about something not in your knowledge base or FAQs
   - You identify a topic that should be added to FAQs

2. **Conflicting Information:**
   - Information from different sources contradicts each other
   - You notice outdated or incorrect information in your knowledge base
   - Business hours or other critical info seems inconsistent

3. **Repeated Problems:**
   - Multiple callers ask the same question you cannot answer
   - You notice a pattern of questions you struggle with

4. **System Issues:**
   - Functions are not working as expected
   - You encounter errors when trying to help callers

When reporting issues, include:
- Clear description of what happened
- The caller's question (if applicable)
- Suggested fix (e.g., "Add FAQ about X", "Update hours information")

This helps the business improve your knowledge base and capabilities.

=== END ISSUE REPORTING ===

=== CRITICAL INSTRUCTIONS ===
1. ONLY answer questions if you can find the answer in the information provided above.
2. If confidence < ${confidenceThreshold}%, use the message-taking function - DO NOT guess.
3. Be friendly, professional, and helpful.
4. When in doubt, take a message for callback.
5. For booking/reservation requests, use the booking functions above - do not just take a message.
6. If the audio is unclear or noisy, ask once for clarification, then take a message if still unclear.
7. Use 'report_issue' to notify the business when you identify knowledge gaps or problems that need fixing.
=== END CRITICAL INSTRUCTIONS ===`;

      // Build voice configuration
      const voiceConfig: any = {
        provider: 'openai',
        voiceId: agent.voice_id && ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'].includes(agent.voice_id) 
          ? agent.voice_id 
          : 'alloy',
      };

      // Add message-taking function
      const messageTakingFunction = {
        name: 'take_message_for_callback',
        description: 'Collect caller information (name, phone, message) when AI confidence is below threshold and send email notification to business',
        parameters: {
          type: 'object',
          properties: {
            caller_name: { type: 'string', description: 'The full name of the caller' },
            caller_phone: { type: 'string', description: 'The phone number of the caller (include area code)' },
            caller_message: { type: 'string', description: 'The question or message from the caller that the AI could not answer with sufficient confidence' },
            confidence_level: { type: 'number', description: 'The AI confidence level (0-100) for this query' },
          },
          required: ['caller_name', 'caller_phone', 'caller_message'],
        },
      };

      // Add booking functions
      const checkAvailabilityFunction = {
        name: 'check_availability',
        description: 'Check if a specific date and time is available for booking. Use this BEFORE booking to verify availability.',
        parameters: {
          type: 'object',
          properties: {
            date: { type: 'string', description: 'Date in YYYY-MM-DD format (e.g., "2025-12-15")' },
            time: { type: 'string', description: 'Time in HH:MM format (24-hour, e.g., "14:30" for 2:30 PM)' },
            booking_type: { type: 'string', enum: ['appointment', 'reservation', 'callback'], description: 'Type of booking' },
            service_type: { type: 'string', description: 'Service type (e.g., "haircut", "consultation", "dinner", "lunch")' },
            duration_minutes: { type: 'number', description: 'Duration in minutes (optional)' },
            party_size: { type: 'number', description: 'Number of people for restaurant reservations' },
          },
          required: ['date', 'time'],
        },
      };

      const bookAppointmentFunction = {
        name: 'book_appointment',
        description: 'Book an appointment (haircuts, consultations, services, callbacks). Use AFTER checking availability.',
        parameters: {
          type: 'object',
          properties: {
            customer_name: { type: 'string', description: 'Full name of the customer' },
            customer_phone: { type: 'string', description: 'Phone number with area code' },
            customer_email: { type: 'string', description: 'Email address (optional)' },
            date: { type: 'string', description: 'Date in YYYY-MM-DD format' },
            time: { type: 'string', description: 'Time in HH:MM format (24-hour)' },
            booking_type: { type: 'string', enum: ['appointment', 'reservation', 'callback'], description: 'Type of booking' },
            service_type: { type: 'string', description: 'Service type (e.g., "haircut", "consultation")' },
            duration_minutes: { type: 'number', description: 'Duration in minutes (optional)' },
            notes: { type: 'string', description: 'Special requests or notes' },
          },
          required: ['customer_name', 'customer_phone', 'date', 'time'],
        },
      };

      const bookReservationFunction = {
        name: 'book_reservation',
        description: 'Book a restaurant reservation. Use AFTER checking availability with party size.',
        parameters: {
          type: 'object',
          properties: {
            customer_name: { type: 'string', description: 'Full name for the reservation' },
            customer_phone: { type: 'string', description: 'Phone number with area code' },
            customer_email: { type: 'string', description: 'Email address (optional)' },
            date: { type: 'string', description: 'Date in YYYY-MM-DD format' },
            time: { type: 'string', description: 'Time in HH:MM format (24-hour)' },
            party_size: { type: 'number', description: 'Number of people for the reservation' },
            notes: { type: 'string', description: 'Special requests, dietary restrictions, etc.' },
          },
          required: ['customer_name', 'customer_phone', 'date', 'time', 'party_size'],
        },
      };

      // Add issue reporting function
      const reportIssueFunction = {
        name: 'report_issue',
        description: 'Report issues, knowledge gaps, or problems encountered during the call. Use this when you notice the AI cannot answer a question, encounters conflicting information, or identifies a gap in the knowledge base.',
        parameters: {
          type: 'object',
          properties: {
            issue_type: {
              type: 'string',
              description: 'Type of issue: "knowledge_gap", "conflicting_information", "unclear_request", "system_error", or "other"',
            },
            description: {
              type: 'string',
              description: 'Detailed description of the issue or problem encountered',
            },
            caller_question: {
              type: 'string',
              description: 'The question or request from the caller that caused the issue (if applicable)',
            },
            suggested_fix: {
              type: 'string',
              description: 'Suggested solution or improvement (e.g., "Add FAQ about X", "Update hours in database")',
            },
            confidence_level: {
              type: 'number',
              description: 'AI confidence level when the issue occurred (0-100)',
            },
          },
          required: ['issue_type', 'description'],
        },
      };

      // Combine existing functions with message-taking, booking, and issue reporting functions
      // NOTE: Removed check_if_business_is_open function - status is now calculated and included in system prompt
      const functions = [messageTakingFunction, checkAvailabilityFunction, bookAppointmentFunction, bookReservationFunction, reportIssueFunction];
      if (agent.functions_config && Array.isArray(agent.functions_config) && agent.functions_config.length > 0) {
        const validFunctions = agent.functions_config.filter((func: any) => {
          if (!func || typeof func !== 'object') return false;
          if (!func.name || typeof func.name !== 'string') return false;
          if (func.name === 'take_message_for_callback') return false;
          if (!/^[a-zA-Z0-9_-]{1,64}$/.test(func.name)) return false;
          return true;
        });
        functions.push(...validFunctions);
      }

      // Build full assistant update payload
      const assistantUpdatePayload: any = {
        name: agent.name,
        model: {
          provider: agent.model_provider || 'openai',
          model: agent.model_name || 'gpt-4o-mini',
          temperature: agent.temperature || 0.7,
          maxTokens: agent.max_tokens || 250,
          messages: [
            {
              role: 'system',
              content: enhancedSystemPrompt,
            },
          ],
        },
        voice: voiceConfig,
        firstMessage: knowledgeBase?.first_message || agent.first_message || 'Hello! How can I help you today?',
        functions: functions,
        recordingEnabled: true,
        backgroundSound: 'office', // Ambient background sound for natural call experience
        backchannelingEnabled: true,
        silenceTimeoutSeconds: 45, // Increased to allow more time for speech recognition in noisy environments
        responseDelaySeconds: 0.4,
        llmRequestDelaySeconds: 0.1,
        numWordsToInterruptAssistant: 6, // Increased from 2 to 6 to prevent background noise from interrupting the AI
        serverUrl: webhookUrl,
      };

      console.log('🔍 Step 6: Updating full assistant configuration...');
      console.log('📞 Vapi API URL:', `https://api.vapi.ai/assistant/${agent.vapi_assistant_id}`);
      console.log('📞 System prompt length:', enhancedSystemPrompt.length);
      console.log('📞 FAQs included:', faqs?.length || 0);
      
      // First, check if assistant exists
      const vapiStartTime = Date.now();
      const checkResponse = await fetch(`https://api.vapi.ai/assistant/${agent.vapi_assistant_id}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${vapiApiKey}`,
        },
      });
      
      if (!checkResponse.ok) {
        const errorText = await checkResponse.text();
        console.error('❌ ========== VAPI ASSISTANT NOT FOUND ==========');
        console.error('❌ Vapi assistant does not exist:', {
          status: checkResponse.status,
          statusText: checkResponse.statusText,
          error: errorText,
          assistantId: agent.vapi_assistant_id,
        });
        throw new Error(`Couldn't get assistant: Assistant ID ${agent.vapi_assistant_id} not found in Vapi. The assistant may have been deleted. Please reconnect a phone number to create a new assistant.`);
      }
      
      // Assistant exists, proceed with update
      const updateResponse = await fetch(`https://api.vapi.ai/assistant/${agent.vapi_assistant_id}`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${vapiApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(assistantUpdatePayload),
      });
      const vapiDuration = Date.now() - vapiStartTime;
      console.log(`⏱️ Vapi API call completed in ${vapiDuration}ms`);

      console.log('📡 Vapi API response status:', updateResponse.status, updateResponse.statusText);

      if (!updateResponse.ok) {
        const errorText = await updateResponse.text();
        console.error('❌ ========== VAPI API ERROR ==========');
        console.error('❌ Vapi assistant update error:', {
          status: updateResponse.status,
          statusText: updateResponse.statusText,
          error: errorText,
        });
        throw new Error(`Failed to update Vapi assistant: ${updateResponse.status} - ${errorText}`);
      }

      const updatedAssistant = await updateResponse.json();
      console.log('✅ ========== VAPI ASSISTANT FULL REBUILD SUCCESSFUL ==========');
      console.log('✅ Vapi assistant rebuilt successfully:', updatedAssistant.id);
      
      // Reconnect phone number if agent has one
      let phoneNumberReconnected = false;
      if (agent.phone_number && agent.phone_number.trim()) {
        try {
          console.log('📞 Reconnecting phone number after rebuild:', agent.phone_number);
          
          // Get Telnyx credential ID
          let telnyxCredentialId = Deno.env.get('VAPI_TELNYX_CREDENTIAL_ID');
          const telnyxApiKey = Deno.env.get('TELNYX_API_KEY');
          
          if (!telnyxCredentialId && telnyxApiKey) {
            try {
              const credentialsResponse = await fetch('https://api.vapi.ai/credential', {
                method: 'GET',
                headers: { 'Authorization': `Bearer ${vapiApiKey}` },
              });
              if (credentialsResponse.ok) {
                const credentials = await credentialsResponse.json();
                const telnyxCredential = Array.isArray(credentials) 
                  ? credentials.find((c: any) => c.provider === 'telnyx')
                  : credentials;
                if (telnyxCredential?.id) {
                  telnyxCredentialId = telnyxCredential.id;
                }
              }
            } catch (error) {
              console.warn('⚠️ Could not fetch credentials:', error);
            }
          }
          
          let formattedPhone = agent.phone_number.trim();
          if (!formattedPhone.startsWith('+')) {
            if (formattedPhone.length === 10) {
              formattedPhone = `+1${formattedPhone}`;
            } else if (formattedPhone.length === 11 && formattedPhone.startsWith('1')) {
              formattedPhone = `+${formattedPhone}`;
            }
          }
          
          // First, try to find existing phone number connection
          let existingPhoneNumberId = null;
          try {
            console.log('🔍 Checking for existing phone number connection...');
            const existingPhoneResponse = await fetch('https://api.vapi.ai/phone-number', {
              method: 'GET',
              headers: { 'Authorization': `Bearer ${vapiApiKey}` },
            });
            
            if (existingPhoneResponse.ok) {
              const existingPhones = await existingPhoneResponse.json();
              const phoneArray = Array.isArray(existingPhones) ? existingPhones : (existingPhones.phoneNumbers || []);
              const matchingPhone = phoneArray.find((p: any) => p.number === formattedPhone);
              
              if (matchingPhone) {
                existingPhoneNumberId = matchingPhone.id;
                console.log('✅ Found existing phone number connection:', existingPhoneNumberId);
              } else {
                console.log('ℹ️ No existing phone number connection found, will create new one');
              }
            }
          } catch (error) {
            console.warn('⚠️ Could not check for existing phone numbers:', error);
          }
          
          // Prepare phone number payload
          const phoneNumberPayload: any = {
            provider: 'telnyx',
            number: formattedPhone,
            name: `${agent.name} - Phone`,
            assistantId: updatedAssistant.id,
          };
          
          if (telnyxCredentialId) {
            phoneNumberPayload.credentialId = telnyxCredentialId;
          }
          
          // If we have an existing phone number ID, update it; otherwise create new
          let phoneResponse;
          if (existingPhoneNumberId) {
            console.log('🔄 Updating existing phone number connection:', existingPhoneNumberId);
            phoneResponse = await fetch(`https://api.vapi.ai/phone-number/${existingPhoneNumberId}`, {
              method: 'PATCH',
              headers: {
                'Authorization': `Bearer ${vapiApiKey}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                assistantId: updatedAssistant.id,
                name: phoneNumberPayload.name,
              }),
            });
          } else {
            console.log('➕ Creating new phone number connection');
            phoneResponse = await fetch('https://api.vapi.ai/phone-number', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${vapiApiKey}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify(phoneNumberPayload),
            });
          }
          
          if (phoneResponse.ok) {
            const phoneData = await phoneResponse.json();
            const phoneId = existingPhoneNumberId || phoneData.id;
            await supabase
              .from('voice_agents')
              .update({ vapi_phone_number_id: phoneId })
              .eq('id', agentId);
            phoneNumberReconnected = true;
            console.log('✅ Phone number reconnected successfully:', phoneId);
          } else {
            const errorText = await phoneResponse.text();
            console.error('❌ Phone number reconnection failed:', {
              status: phoneResponse.status,
              statusText: phoneResponse.statusText,
              error: errorText,
              method: existingPhoneNumberId ? 'PATCH' : 'POST',
            });
          }
        } catch (error) {
          console.error('❌ Error reconnecting phone number:', error);
        }
      }
      
      return new Response(
        JSON.stringify({
          success: true,
          assistantId: updatedAssistant.id,
          phoneNumberReconnected,
          message: 'Vapi assistant rebuilt successfully with latest data',
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200,
        }
      );
    }

    // Otherwise, just update voice settings
    console.log('🔍 Step 6: Building voice configuration...');
    const voiceConfig: any = {
      provider: 'openai',
      voiceId: voiceSettings.voice_id && ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'].includes(voiceSettings.voice_id) 
        ? voiceSettings.voice_id 
        : agent.voice_id || 'alloy',
    };

    if (voiceSettings.voice_style) {
      console.log('ℹ️ Voice style provided:', voiceSettings.voice_style, 'but Vapi API does not support style property for OpenAI voices');
    }

    console.log('🔊 Final voice configuration:', JSON.stringify(voiceConfig, null, 2));

    console.log('🔍 Step 7: Checking if assistant exists in Vapi...');
    console.log('📞 Vapi API URL:', `https://api.vapi.ai/assistant/${agent.vapi_assistant_id}`);
    
    // First, check if assistant exists
    const vapiStartTime = Date.now();
    const checkResponse = await fetch(`https://api.vapi.ai/assistant/${agent.vapi_assistant_id}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${vapiApiKey}`,
      },
    });
    
    if (!checkResponse.ok) {
      const errorText = await checkResponse.text();
      console.error('❌ ========== VAPI ASSISTANT NOT FOUND ==========');
      console.error('❌ Vapi assistant does not exist:', {
        status: checkResponse.status,
        statusText: checkResponse.statusText,
        error: errorText,
        assistantId: agent.vapi_assistant_id,
      });
      throw new Error(`Couldn't get assistant: Assistant ID ${agent.vapi_assistant_id} not found in Vapi. The assistant may have been deleted. Please reconnect a phone number to create a new assistant.`);
    }
    
    // Assistant exists, proceed with update
    console.log('✅ Assistant found in Vapi, proceeding with voice update...');
    console.log('📞 Request payload:', JSON.stringify({ voice: voiceConfig }, null, 2));
    
    const updateResponse = await fetch(`https://api.vapi.ai/assistant/${agent.vapi_assistant_id}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${vapiApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        voice: voiceConfig,
      }),
    });
    const vapiDuration = Date.now() - vapiStartTime;
    console.log(`⏱️ Vapi API call completed in ${vapiDuration}ms`);

    console.log('📡 Vapi API response status:', updateResponse.status, updateResponse.statusText);

    if (!updateResponse.ok) {
      const errorText = await updateResponse.text();
      console.error('❌ ========== VAPI API ERROR ==========');
      console.error('❌ Vapi assistant update error:', {
        status: updateResponse.status,
        statusText: updateResponse.statusText,
        error: errorText,
      });
      throw new Error(`Failed to update Vapi assistant: ${updateResponse.status} - ${errorText}`);
    }

    const updatedAssistant = await updateResponse.json();
    console.log('✅ ========== VAPI ASSISTANT UPDATE SUCCESSFUL ==========');
    console.log('✅ Vapi assistant updated successfully:', updatedAssistant.id);

    return new Response(
      JSON.stringify({
        success: true,
        assistantId: updatedAssistant.id,
        message: 'Vapi assistant updated successfully',
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );
  } catch (error) {
    console.error('❌ ========== EDGE FUNCTION ERROR ==========');
    console.error('❌ Error updating Vapi assistant:', error);
    console.error('❌ Error message:', error.message);
    console.error('❌ Error stack:', error.stack);
    console.error('❌ Error name:', error.name);
    return new Response(
      JSON.stringify({
        error: error.message || 'Failed to update Vapi assistant',
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      }
    );
  }
});

