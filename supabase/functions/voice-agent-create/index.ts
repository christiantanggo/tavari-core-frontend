// supabase/functions/voice-agent-create/index.ts
// Creates Vapi assistant and connects phone number
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import CryptoJS from 'npm:crypto-js@4.2.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Decrypt function
function decrypt(encryptedText: string, key: string): string | null {
  if (!encryptedText) return null;
  try {
    const bytes = CryptoJS.AES.decrypt(encryptedText, key);
    return bytes.toString(CryptoJS.enc.Utf8);
  } catch (error) {
    console.error('Decryption error:', error);
    return null;
  }
}

serve(async (req) => {
  // Handle CORS preflight - MUST be first and must not throw any errors
  // This MUST be checked before ANY other code runs
  if (req.method === 'OPTIONS') {
    return new Response('ok', { 
      status: 200,
      headers: corsHeaders 
    });
  }

  console.log('🚀 voice-agent-create Edge Function called');
  console.log('📥 Request method:', req.method);

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const encryptionKey = Deno.env.get('VITE_ENCRYPTION_KEY') || 'default-key-change-in-production';
    
    console.log('✅ Environment variables loaded');

    // Create Supabase client with service role
    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    // Verify user authentication
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('No authorization header');
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);

    if (userError || !user) {
      throw new Error('Invalid authentication');
    }

    // Parse request body
    const requestBody = await req.json();
    console.log('📦 Request body received:', JSON.stringify(requestBody, null, 2));
    
    const { agentId, businessId, phoneNumber } = requestBody;

    if (!agentId || !businessId || !phoneNumber) {
      console.error('❌ Missing required parameters:', { agentId, businessId, phoneNumber });
      throw new Error('Missing required parameters: agentId, businessId, phoneNumber');
    }

    console.log('✅ Parameters validated:', { agentId, businessId, phoneNumber });

    // Get Tavari's Vapi API key from environment (centralized - all customers use same key)
    const vapiApiKey = Deno.env.get('VAPI_API_KEY');
    if (!vapiApiKey) {
      throw new Error('Vapi API key not configured. Please set VAPI_API_KEY in Supabase secrets.');
    }

    // Get Tavari's Telnyx API key from environment (centralized - all customers use same key)
    const telnyxApiKey = Deno.env.get('TELNYX_API_KEY');
    if (!telnyxApiKey) {
      console.error('❌ TELNYX_API_KEY not found in environment');
      throw new Error('Telnyx API key not configured. Please set TELNYX_API_KEY in Supabase secrets.');
    }
    
    console.log('✅ Telnyx API key loaded from environment');

    // Try to get or create Telnyx credential in Vapi (do this once at the top)
    // First, check if we have a credentialId in environment
    let telnyxCredentialId = Deno.env.get('VAPI_TELNYX_CREDENTIAL_ID');
    
    // If no credentialId, try to list existing credentials or create one
    if (!telnyxCredentialId) {
      console.log('🔍 No VAPI_TELNYX_CREDENTIAL_ID found, attempting to find/create Telnyx credential...');
      
      // List existing credentials to find Telnyx one
      try {
        const credentialsResponse = await fetch('https://api.vapi.ai/credential', {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${vapiApiKey}`,
            'Content-Type': 'application/json',
          },
        });

        if (credentialsResponse.ok) {
          const credentials = await credentialsResponse.json();
          console.log('📋 Available credentials:', JSON.stringify(credentials, null, 2));
          
          // Find Telnyx credential
          const telnyxCredential = Array.isArray(credentials) 
            ? credentials.find((c: any) => c.provider === 'telnyx')
            : credentials?.data?.find((c: any) => c.provider === 'telnyx');
          
          if (telnyxCredential?.id) {
            telnyxCredentialId = telnyxCredential.id;
            console.log('✅ Found existing Telnyx credential:', telnyxCredentialId);
          } else {
            // Try to create Telnyx credential
            console.log('📝 Creating new Telnyx credential in Vapi...');
            const createCredentialResponse = await fetch('https://api.vapi.ai/credential', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${vapiApiKey}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                provider: 'telnyx',
                credentials: {
                  apiKey: telnyxApiKey,
                },
              }),
            });

            if (createCredentialResponse.ok) {
              const newCredential = await createCredentialResponse.json();
              telnyxCredentialId = newCredential.id;
              console.log('✅ Created new Telnyx credential:', telnyxCredentialId);
            } else {
              const errorText = await createCredentialResponse.text();
              console.error('❌ Failed to create credential:', errorText);
            }
          }
        }
      } catch (error) {
        console.error('❌ Error checking/creating credentials:', error);
      }
    } else {
      console.log('✅ Using Telnyx credentialId from environment:', telnyxCredentialId);
    }

    // Get agent configuration
    const { data: agent, error: agentError } = await supabase
      .from('voice_agents')
      .select('*')
      .eq('id', agentId)
      .eq('business_id', businessId)
      .single();

    if (agentError || !agent) {
      throw new Error('Agent not found');
    }

    // If agent already has a Vapi assistant ID, reuse it instead of creating new one
    if (agent.vapi_assistant_id) {
      console.log('♻️ Reusing existing Vapi assistant:', agent.vapi_assistant_id);
      
      // Just connect/update phone number
      let formattedPhone = phoneNumber.trim();
      if (!formattedPhone.startsWith('+')) {
        if (formattedPhone.length === 10) {
          formattedPhone = `+1${formattedPhone}`;
        } else if (formattedPhone.length === 11 && formattedPhone.startsWith('1')) {
          formattedPhone = `+${formattedPhone}`;
        } else {
          formattedPhone = `+${formattedPhone}`;
        }
      } else {
        // Fix double country code (e.g., +115484880543 -> +15484880543)
        if (formattedPhone.startsWith('+11') && formattedPhone.length === 13) {
          formattedPhone = `+1${formattedPhone.substring(2)}`;
          console.log('⚠️ Fixed double country code:', phoneNumber, '->', formattedPhone);
        }
      }

      const phoneNumberPayload: any = {
        provider: 'telnyx',
        number: formattedPhone,
        name: `${agent.name} - Phone`,
        assistantId: agent.vapi_assistant_id,
      };

      // Use the telnyxCredentialId we found/created earlier
      if (telnyxCredentialId) {
        phoneNumberPayload.credentialId = telnyxCredentialId;
        console.log('✅ Using Telnyx credentialId:', telnyxCredentialId);
      } else {
        console.warn('⚠️ No Telnyx credentialId available. Phone number connection will fail.');
      }

      console.log('📞 Connecting phone number to existing assistant:', formattedPhone);

      // First, try to get existing phone number if it exists
      console.log('🔍 Checking if phone number already exists in Vapi...');
      const existingPhoneResponse = await fetch('https://api.vapi.ai/phone-number', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${vapiApiKey}`,
        },
      });

      let phoneData = null;
      let phoneError = null;

      if (existingPhoneResponse.ok) {
        const existingPhones = await existingPhoneResponse.json();
        const phoneList = Array.isArray(existingPhones) ? existingPhones : (existingPhones?.data || []);
        const existingPhone = phoneList.find((p: any) => p.number === formattedPhone);
        
        if (existingPhone) {
          console.log('✅ Found existing phone number in Vapi:', existingPhone.id);
          // Update existing phone number to point to this assistant
          console.log('🔄 Updating existing phone number to point to assistant:', agent.vapi_assistant_id);
          const updatePhoneResponse = await fetch(`https://api.vapi.ai/phone-number/${existingPhone.id}`, {
            method: 'PATCH',
            headers: {
              'Authorization': `Bearer ${vapiApiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              assistantId: agent.vapi_assistant_id,
            }),
          });

          if (updatePhoneResponse.ok) {
            phoneData = await updatePhoneResponse.json();
            console.log('✅ Existing phone number updated successfully:', phoneData.id);
          } else {
            const errorText = await updatePhoneResponse.text();
            phoneError = errorText;
            console.error('❌ Failed to update existing phone number:', {
              status: updatePhoneResponse.status,
              error: errorText,
            });
          }
        }
      }

      // If we didn't find or couldn't update existing phone, try to create new one
      if (!phoneData) {
        console.log('📞 Creating new phone number connection...');
        const phoneResponse = await fetch('https://api.vapi.ai/phone-number', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${vapiApiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(phoneNumberPayload),
        });

        if (!phoneResponse.ok) {
          const errorText = await phoneResponse.text();
          phoneError = errorText;
          console.error('❌ Phone number connection error:', {
            status: phoneResponse.status,
            statusText: phoneResponse.statusText,
            error: errorText,
            phoneNumber: formattedPhone,
          });
        } else {
          phoneData = await phoneResponse.json();
          console.log('✅ Phone number connected:', phoneData.id);
        }
      }

      // Update agent with phone number
      await supabase
        .from('voice_agents')
        .update({
          vapi_phone_number_id: phoneData?.id || null,
          phone_number: formattedPhone,
          is_active: true,
          updated_at: new Date().toISOString(),
        })
        .eq('id', agentId);

      return new Response(
        JSON.stringify({
          success: true,
          assistantId: agent.vapi_assistant_id,
          phoneNumberId: phoneData?.id || null,
          message: phoneData ? 'Phone number connected successfully' : `Assistant exists, but phone number connection failed: ${phoneError || 'Unknown error'}`,
          error: phoneError || null,
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200,
        }
      );
    }

    // Get webhook URL - construct it automatically
    const webhookUrl = `${supabaseUrl}/functions/v1/voice-agent-webhook`;

    // Fetch business information from businesses table
    console.log('🔍 Fetching business information from businesses table...');
    const { data: business, error: businessError } = await supabase
      .from('businesses')
      .select('name, business_address, business_city, business_state, business_postal, business_phone, business_email, business_website, operating_hours, holiday_hours, timezone')
      .eq('id', businessId)
      .single();

    if (businessError) {
      console.error('❌ Error fetching business info:', businessError);
      // Continue without business info rather than failing
    }
    console.log('✅ Business info fetched:', business ? 'Found' : 'Not found');

    // Fetch FAQs for this agent
    console.log('🔍 Fetching FAQs for agent...');
    const { data: faqs, error: faqsError } = await supabase
      .from('voice_agent_faqs')
      .select('question, answer, display_order')
      .eq('agent_id', agentId)
      .eq('is_active', true)
      .order('display_order', { ascending: true });

    if (faqsError) {
      console.error('❌ Error fetching FAQs:', faqsError);
      // Continue without FAQs
    }
    console.log('✅ FAQs fetched:', faqs?.length || 0, 'active FAQs');

    // Build enhanced system prompt with business info, FAQs, knowledge base
    let enhancedSystemPrompt = agent.system_prompt || '';

    // Helper function to format operating hours
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

    // Helper function to format holiday hours
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

    // Add business information section
    if (business) {
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
      
      enhancedSystemPrompt += `\n\n=== BUSINESS INFORMATION ===\n`;
      enhancedSystemPrompt += `Business Name: ${business.name}\n`;
      
      // Build full address
      const addressParts: string[] = [];
      if (business.business_address) addressParts.push(business.business_address);
      if (business.business_city) addressParts.push(business.business_city);
      if (business.business_state) addressParts.push(business.business_state);
      if (business.business_postal) addressParts.push(business.business_postal);
      if (addressParts.length > 0) {
        enhancedSystemPrompt += `Address: ${addressParts.join(', ')}\n`;
      }
      
      if (business.business_phone) {
        enhancedSystemPrompt += `Phone: ${business.business_phone}\n`;
      }
      if (business.business_email) {
        enhancedSystemPrompt += `Email: ${business.business_email}\n`;
      }
      if (business.business_website) {
        enhancedSystemPrompt += `Website: ${business.business_website}\n`;
      }
      if (business.timezone) {
        enhancedSystemPrompt += `Timezone: ${business.timezone}\n`;
      }
      enhancedSystemPrompt += `=== END BUSINESS INFORMATION ===\n`;
      
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
=== END CURRENT DATE AND TIME ===\n`;

      // Add operating hours
      if (business.operating_hours) {
        enhancedSystemPrompt += `\n=== OPERATING HOURS ===\n`;
        enhancedSystemPrompt += `${formatOperatingHours(business.operating_hours)}\n`;
        enhancedSystemPrompt += `=== END OPERATING HOURS ===\n`;
      }

      // Add holiday hours
      if (business.holiday_hours && Array.isArray(business.holiday_hours) && business.holiday_hours.length > 0) {
        enhancedSystemPrompt += `\n=== HOLIDAY HOURS ===\n`;
        enhancedSystemPrompt += `${formatHolidayHours(business.holiday_hours)}\n`;
        enhancedSystemPrompt += `=== END HOLIDAY HOURS ===\n`;
      }
      
      // Calculate current open/closed status and include it in prompt (reuse variables from above)
      const currentStatus = business.operating_hours 
        ? checkIfOpenNow(business.operating_hours, timezoneStr)
        : { isOpen: false, message: 'Hours not available.' };
      
      enhancedSystemPrompt += `\n=== CURRENT BUSINESS STATUS (MAY BE STALE) ===
When this assistant was created, the business status was: ${currentStatus.isOpen ? 'OPEN' : 'CLOSED'}

${currentStatus.message}

IMPORTANT: This status is calculated when the assistant is created and may not reflect the current time.
When asked "Are you open?", "Are you open right now?", or similar questions:
1. Check the CURRENT TIME against the OPERATING HOURS shown above
2. Use the operating hours table to determine if the business is currently open based on:
   - Today's day of the week (from the current date above)
   - Current time in the business timezone (${timezoneStr})
   - The open/close times for today

Example calculation:
- Look up today's day (e.g., "Monday") in the operating hours
- Check if that day is marked as "Closed"
- If not closed, check if current time is between the open and close times
- Answer based on this calculation, NOT the status shown above

Example responses:
- If CURRENTLY OPEN: "Yes, we're open! We're open until [close time] today."
- If CURRENTLY CLOSED: "No, we're currently closed. ${currentStatus.message} Would you like me to take a message?"

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

    // Add knowledge base
    if (agent.knowledge_base && agent.knowledge_base.trim()) {
      enhancedSystemPrompt += `\n\n=== KNOWLEDGE BASE ===\n`;
      enhancedSystemPrompt += `The following information is the ONLY information you should use to answer questions:\n\n${agent.knowledge_base}\n\n`;
      enhancedSystemPrompt += `=== END KNOWLEDGE BASE ===\n`;
    }

    // Get confidence threshold
    const confidenceThreshold = agent.confidence_threshold || 98.0;

    // Add confidence scoring instructions
    enhancedSystemPrompt += `\n\n=== CONFIDENCE SCORING RULES ===
🚨 CRITICAL: Before answering ANY question, you MUST assess your confidence level FIRST.

**${confidenceThreshold}%+ Confidence Required to Answer**
- You may ONLY answer if you are ${confidenceThreshold}% or more confident your answer is:
  - Complete and accurate
  - Found EXACTLY in the business information, FAQs, knowledge base, or system prompt above
  - Appropriate for the caller's needs
  - You have ALL the information needed to fully answer

**If Confidence < ${confidenceThreshold}% (MANDATORY ACTION):**
- STOP immediately - DO NOT attempt to answer
- DO NOT guess or provide partial information
- Say: "I want to make sure I give you the most accurate information about that. Let me take a message and have one of our team members call you back."
- IMMEDIATELY call the 'take_message_for_callback' function with:
  - caller_name: The caller's name (ask if you don't have it)
  - caller_phone: The caller's phone number (ask if you don't have it)
  - caller_message: The exact question they asked
  - confidence_level: Your estimated confidence (0-100)

**Common scenarios requiring take_message_for_callback:**
- Question is not in FAQs or knowledge base
- You're unsure about specific details (pricing, policies, procedures)
- Question requires current/realtime information you don't have
- You're less than ${confidenceThreshold}% certain about any part of the answer

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

3. **For Callback Scheduling (CRITICAL - MUST ADD TO CALENDAR):**
   - When a customer requests a callback, you MUST schedule it in the calendar
   - Use 'book_appointment' with booking_type: 'callback'
   - Collect: name, phone, preferred callback date/time
   - **MANDATORY**: If you don't add callbacks to the calendar, staff will never know a customer called and wanted a callback - this is a CRITICAL business requirement
   - ALWAYS confirm: "I've scheduled your callback for [date] at [time]. We'll call you back at [phone]. Your confirmation code is [code]."

4. **Important Rules (CRITICAL):**
   - ALWAYS check availability BEFORE booking
   - If the requested time is unavailable, suggest alternative times from the response
   - Be friendly and helpful - offer to book immediately when caller is ready
   - Confirm all details (date, time, name, phone) before booking
   - Provide the confirmation code after successful booking
   - **MANDATORY**: ALL appointments, reservations, and callbacks MUST be saved to the calendar using 'book_appointment' or 'book_reservation'. If you don't save them, staff will have no record and customers will be forgotten.
   - **NEVER** tell a customer you'll "take a note" or "pass along the message" for booking requests - you MUST use the booking functions to save it to the calendar.

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
1. **CONFIDENCE CHECK FIRST**: Before answering ANY question, assess if you're ${confidenceThreshold}%+ confident. If not, IMMEDIATELY use 'take_message_for_callback'. The email will be sent automatically - you don't need to do anything else.

2. **DO NOT GUESS**: If you don't know with ${confidenceThreshold}%+ certainty, use 'take_message_for_callback'. It's better to let a human help than give wrong information.

3. **ONLY answer if**: You can find the COMPLETE answer in the business information, FAQs, knowledge base, or system prompt above.

4. **When in doubt**: Always take a message for callback using 'take_message_for_callback'. This automatically sends an email - you just call the function.

5. **BOOKING/APPOINTMENT REQUESTS (CRITICAL)**: 
   - If customer wants an appointment, reservation, or callback, you MUST use 'book_appointment' or 'book_reservation' 
   - NEVER just take a message for booking requests - they MUST be saved to the calendar
   - If you don't save bookings to the calendar, staff will never know about them

6. **CALLBACK REQUESTS (CRITICAL)**: 
   - When customer wants a callback, use 'book_appointment' with booking_type: 'callback'
   - This saves it to the calendar AND sends an email automatically
   - If you don't do this, the callback will be forgotten and staff won't know to call back

7. **EMAIL NOTIFICATIONS**: 
   - 'take_message_for_callback' automatically sends email - you just call the function
   - 'book_appointment' with booking_type: 'callback' automatically sends email - you just call the function
   - You don't need to worry about emails - they happen automatically when you call these functions

8. **Be friendly and professional**: Even when taking a message, be warm and reassuring.

9. **Audio issues**: If unclear or noisy, ask once for clarification, then take a message if still unclear.

10. **Knowledge gaps**: Use 'report_issue' to notify the business when you identify knowledge gaps or problems.

11. **REMEMBER**: Your job is to help callers. If you can't help confidently, get a human to help them properly. The email/notification system works automatically - you just need to call the right functions.

=== END CRITICAL INSTRUCTIONS ===`;

    // Create Vapi assistant
    // Vapi API base URL: https://api.vapi.ai
    const assistantPayload: any = {
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
      voice: {
        // Always use OpenAI (no credentials needed, works out of the box)
        // Override any stored 11labs settings
        provider: 'openai',
        voiceId: agent.voice_id && ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'].includes(agent.voice_id) 
          ? agent.voice_id 
          : 'alloy', // Default to alloy if invalid voice
        // Add voice style if provided (Vapi may support this for future providers)
        ...(agent.voice_style && { style: agent.voice_style }),
        // Remove stability and similarityBoost for OpenAI provider
      },
      firstMessage: agent.first_message || 'Hello! How can I help you today?',
      recordingEnabled: true,
      // hipaaCompliant removed - not accepted by Vapi API
      backgroundSound: 'office', // Ambient background sound for natural call experience
      backchannelingEnabled: true,
      silenceTimeoutSeconds: 45, // Increased to allow more time for speech recognition in noisy environments
      responseDelaySeconds: 0.4,
      llmRequestDelaySeconds: 0.1,
      numWordsToInterruptAssistant: 6, // Increased from 2 to 6 to prevent background noise from interrupting the AI
      serverUrl: webhookUrl,
    };

    // Add message-taking function for low confidence scenarios
    const messageTakingFunction = {
      name: 'take_message_for_callback',
      description: `🚨 MANDATORY & AUTOMATIC: Use this function when you cannot answer a question with ${confidenceThreshold}%+ confidence. This function AUTOMATICALLY:
1. Saves the message to the database
2. Sends an email notification to the business (you don't need to worry about email - it happens automatically)
3. Ensures a human will call the customer back

Use this whenever you are unsure, don't have complete information, or cannot find the answer in the provided information. The email sending is automatic - you just need to call this function.`,
      parameters: {
        type: 'object',
        properties: {
          caller_name: {
            type: 'string',
            description: 'The full name of the caller',
          },
          caller_phone: {
            type: 'string',
            description: 'The phone number of the caller (include area code)',
          },
          caller_message: {
            type: 'string',
            description: 'The question or message from the caller that the AI could not answer with sufficient confidence',
          },
          confidence_level: {
            type: 'number',
            description: 'The AI confidence level (0-100) for this query',
          },
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
          date: {
            type: 'string',
            description: 'Date in YYYY-MM-DD format (e.g., "2025-12-15")',
          },
          time: {
            type: 'string',
            description: 'Time in HH:MM format (24-hour, e.g., "14:30" for 2:30 PM)',
          },
          booking_type: {
            type: 'string',
            enum: ['appointment', 'reservation', 'callback'],
            description: 'Type of booking: appointment (services), reservation (restaurant), or callback',
          },
          service_type: {
            type: 'string',
            description: 'Service type (e.g., "haircut", "consultation", "dinner", "lunch")',
          },
          duration_minutes: {
            type: 'number',
            description: 'Duration in minutes (optional, defaults to agent setting)',
          },
          party_size: {
            type: 'number',
            description: 'Number of people for restaurant reservations',
          },
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
          customer_name: {
            type: 'string',
            description: 'Full name of the customer',
          },
          customer_phone: {
            type: 'string',
            description: 'Phone number with area code',
          },
          customer_email: {
            type: 'string',
            description: 'Email address (optional)',
          },
          date: {
            type: 'string',
            description: 'Date in YYYY-MM-DD format',
          },
          time: {
            type: 'string',
            description: 'Time in HH:MM format (24-hour)',
          },
          booking_type: {
            type: 'string',
            enum: ['appointment', 'reservation', 'callback'],
            description: 'Type of booking',
          },
          service_type: {
            type: 'string',
            description: 'Service type (e.g., "haircut", "consultation")',
          },
          duration_minutes: {
            type: 'number',
            description: 'Duration in minutes (optional)',
          },
          notes: {
            type: 'string',
            description: 'Special requests or notes',
          },
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
          customer_name: {
            type: 'string',
            description: 'Full name for the reservation',
          },
          customer_phone: {
            type: 'string',
            description: 'Phone number with area code',
          },
          customer_email: {
            type: 'string',
            description: 'Email address (optional)',
          },
          date: {
            type: 'string',
            description: 'Date in YYYY-MM-DD format',
          },
          time: {
            type: 'string',
            description: 'Time in HH:MM format (24-hour)',
          },
          party_size: {
            type: 'number',
            description: 'Number of people for the reservation',
          },
          notes: {
            type: 'string',
            description: 'Special requests, dietary restrictions, etc.',
          },
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
      // Validate and format existing functions
      const validFunctions = agent.functions_config.filter((func: any) => {
        if (!func || typeof func !== 'object') return false;
        if (!func.name || typeof func.name !== 'string') return false;
        // Skip if it's the message-taking function (we're adding it separately)
        if (func.name === 'take_message_for_callback') return false;
        // Validate name matches regex: /^[a-zA-Z0-9_-]{1,64}$/
        if (!/^[a-zA-Z0-9_-]{1,64}$/.test(func.name)) return false;
        return true;
      });
      
      functions.push(...validFunctions);
    }
    
    assistantPayload.functions = functions;

    console.log('Creating Vapi assistant with payload:', JSON.stringify(assistantPayload, null, 2));

    const assistantResponse = await fetch('https://api.vapi.ai/assistant', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${vapiApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(assistantPayload),
    });

    if (!assistantResponse.ok) {
      const errorText = await assistantResponse.text();
      console.error('❌ Vapi assistant creation error:', {
        status: assistantResponse.status,
        statusText: assistantResponse.statusText,
        error: errorText,
        requestPayload: JSON.stringify(assistantPayload, null, 2),
      });
      throw new Error(`Failed to create Vapi assistant: ${assistantResponse.status} - ${errorText}`);
    }

    const assistantData = await assistantResponse.json();

    // Format phone number to E.164 format if needed
    let formattedPhone = phoneNumber.trim();
    if (!formattedPhone.startsWith('+')) {
      // Assume US number if no country code
      if (formattedPhone.length === 10) {
        formattedPhone = `+1${formattedPhone}`;
      } else if (formattedPhone.length === 11 && formattedPhone.startsWith('1')) {
        formattedPhone = `+${formattedPhone}`;
      } else {
        formattedPhone = `+${formattedPhone}`;
      }
    } else {
      // Fix double country code (e.g., +115484880543 -> +15484880543)
      if (formattedPhone.startsWith('+11') && formattedPhone.length === 13) {
        formattedPhone = `+1${formattedPhone.substring(2)}`;
        console.log('⚠️ Fixed double country code:', phoneNumber, '->', formattedPhone);
      }
    }

    // Create/connect phone number in Vapi
    // Vapi REQUIRES credentialId (UUID) for Telnyx phone numbers
    // You must configure Telnyx credentials in Vapi dashboard first, then add the credentialId as a Supabase secret
    const phoneNumberPayload: any = {
      provider: 'telnyx',
      number: formattedPhone,
      name: `${agent.name} - Phone`,
      assistantId: assistantData.id,
    };

    // Use the telnyxCredentialId we found/created earlier
    if (telnyxCredentialId) {
      phoneNumberPayload.credentialId = telnyxCredentialId;
      console.log('✅ Using Telnyx credentialId:', telnyxCredentialId);
    } else {
      console.warn('⚠️ No Telnyx credentialId available. Phone number connection will fail.');
      console.warn('💡 The system tried to find/create a credential automatically.');
    }

    console.log('📞 Connecting phone number to Vapi:', formattedPhone);
    
    // First, try to get existing phone number if it exists
    console.log('🔍 Checking if phone number already exists in Vapi...');
    const existingPhoneResponse = await fetch('https://api.vapi.ai/phone-number', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${vapiApiKey}`,
      },
    });

    let phoneData = null;
    let phoneError = null;

    if (existingPhoneResponse.ok) {
      const existingPhones = await existingPhoneResponse.json();
      const phoneList = Array.isArray(existingPhones) ? existingPhones : (existingPhones?.data || []);
      const existingPhone = phoneList.find((p: any) => p.number === formattedPhone);
      
      if (existingPhone) {
        console.log('✅ Found existing phone number in Vapi:', existingPhone.id);
        // Update existing phone number to point to this assistant
        console.log('🔄 Updating existing phone number to point to assistant:', assistantData.id);
        const updatePhoneResponse = await fetch(`https://api.vapi.ai/phone-number/${existingPhone.id}`, {
          method: 'PATCH',
          headers: {
            'Authorization': `Bearer ${vapiApiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            assistantId: assistantData.id,
          }),
        });

        if (updatePhoneResponse.ok) {
          phoneData = await updatePhoneResponse.json();
          console.log('✅ Existing phone number updated successfully:', phoneData.id);
        } else {
          const errorText = await updatePhoneResponse.text();
          phoneError = errorText;
          console.error('❌ Failed to update existing phone number:', {
            status: updatePhoneResponse.status,
            error: errorText,
          });
        }
      }
    }

    // If we didn't find or couldn't update existing phone, try to create new one
    if (!phoneData) {
      console.log('📞 Creating new phone number connection...');
      console.log('📦 Phone number payload:', JSON.stringify(phoneNumberPayload, null, 2));
      const phoneResponse = await fetch('https://api.vapi.ai/phone-number', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${vapiApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(phoneNumberPayload),
      });

      if (!phoneResponse.ok) {
        const errorText = await phoneResponse.text();
        phoneError = errorText;
        console.error('❌ Vapi phone number creation error:', {
          status: phoneResponse.status,
          statusText: phoneResponse.statusText,
          error: errorText,
          phoneNumber: formattedPhone,
          payload: JSON.stringify(phoneNumberPayload, null, 2),
        });
        // Don't fail completely - assistant was created
        console.warn('⚠️ Phone number connection failed, but assistant was created');
        console.warn('💡 You can connect the phone number later in the Vapi dashboard or try again');
      } else {
        phoneData = await phoneResponse.json();
        console.log('✅ Phone number connected successfully:', phoneData.id);
      }
    }

    // Update agent with Vapi IDs
    const { error: updateError } = await supabase
      .from('voice_agents')
      .update({
        vapi_assistant_id: assistantData.id,
        vapi_phone_number_id: phoneData?.id || null,
        phone_number: phoneNumber,
        is_active: true,
        updated_at: new Date().toISOString(),
      })
      .eq('id', agentId);

    if (updateError) {
      console.error('Error updating agent:', updateError);
      // Don't fail - assistant was created
    }

    return new Response(
      JSON.stringify({
        success: true,
        assistantId: assistantData.id,
        phoneNumberId: phoneData?.id || null,
        message: phoneData ? 'Voice agent created and activated successfully' : `Voice agent created, but phone number connection failed: ${phoneError || 'Unknown error'}`,
        error: phoneError || null,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );
  } catch (error) {
    console.error('Error creating voice agent:', error);
    return new Response(
      JSON.stringify({
        error: error.message || 'Failed to create voice agent',
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      }
    );
  }
});

