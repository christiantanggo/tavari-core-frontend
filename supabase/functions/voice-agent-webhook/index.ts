// supabase/functions/voice-agent-webhook/index.ts
// Handles Vapi webhooks (call events, function calls)
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { SESv2Client, SendEmailCommand } from 'npm:@aws-sdk/client-sesv2@3.654.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Logging helper function - MUST be defined before serve()
async function logVoiceAgentEvent(
  supabase: any,
  businessId: string | null,
  agentId: string | null,
  eventType: string,
  message: string,
  details: any = null,
  severity: 'info' | 'warning' | 'error' = 'info',
  callId: string | null = null
) {
  // Always log to console first (critical for debugging)
  const logPrefix = `[${severity.toUpperCase()}] [${eventType}]`;
  console.log(`${logPrefix} ${message}`);
  if (details) {
    console.log(`${logPrefix} Details:`, JSON.stringify(details, null, 2));
  }

  try {
    const logEntry = {
      business_id: businessId,
      agent_id: agentId,
      call_id: callId,
      event_type: eventType,
      message: message.substring(0, 500), // Limit message length
      details: details ? JSON.stringify(details).substring(0, 5000) : null,
      severity: severity,
      source: 'webhook',
      created_at: new Date().toISOString(),
    };

    const { error } = await supabase
      .from('voice_agent_logs')
      .insert(logEntry);

    if (error) {
      // Check if table doesn't exist
      if (error.code === '42P01' || error.message?.includes('does not exist')) {
        console.error(`❌ CRITICAL: voice_agent_logs table does not exist! Run the migration: voice_agent_create_logs_table.sql`);
        console.error(`[${severity.toUpperCase()}] ${eventType}: ${message}`, details || '');
      } else {
        console.error('❌ Failed to log event to database:', error);
        console.error(`[${severity.toUpperCase()}] ${eventType}: ${message}`, details || '');
      }
    } else {
      console.log(`✅ Logged to database [${severity}]: ${eventType} - ${message}`);
    }
  } catch (error: any) {
    console.error('❌ Error in logVoiceAgentEvent:', error);
    // Always log to console as fallback
    console.log(`[${severity.toUpperCase()}] ${eventType}: ${message}`, details || '');
  }
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    // Create Supabase client with service role (webhooks don't have user auth)
    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    // Parse webhook payload
    const payload = await req.json();
    console.log('📞 Voice agent webhook received:', JSON.stringify(payload, null, 2));
    
    // Vapi webhook structure: Can be wrapped in { message: { type: "...", ... } } or direct
    // Check for wrapped format first (most common based on logs)
    const messageWrapper = payload?.message;
    const type = payload?.type || messageWrapper?.type || null;
    
    // Extract call data - can be in payload.call, messageWrapper.call, or messageWrapper.artifact
    const call = payload?.call || messageWrapper?.call || messageWrapper?.artifact?.call || messageWrapper || null;
    const functionCall = payload?.functionCall || payload?.function_call || messageWrapper?.functionCall || messageWrapper?.function_call || null;
    
    console.log('📋 Webhook type:', type || 'NOT FOUND');
    console.log('📋 Has message wrapper:', !!payload?.message);
    console.log('📋 Message wrapper type:', messageWrapper?.type || 'NOT FOUND');
    console.log('📋 Message wrapper status:', messageWrapper?.status || 'NOT FOUND');
    console.log('📋 Message wrapper endedReason:', messageWrapper?.endedReason || 'NOT FOUND');
    console.log('📋 Function call:', functionCall?.name || 'NOT FOUND');
    console.log('📋 Call ID:', call?.id || 'NOT FOUND');
    console.log('📋 Call status:', call?.status || messageWrapper?.status || 'NOT FOUND');
    console.log('📋 Payload keys:', Object.keys(payload || {}));
    if (messageWrapper) {
      console.log('📋 Message wrapper keys:', Object.keys(messageWrapper));
      console.log('📋 Message wrapper has analysis:', !!messageWrapper?.analysis);
      console.log('📋 Message wrapper has artifact:', !!messageWrapper?.artifact);
    }
    
    // Use the type directly if found, otherwise infer from structure
    let inferredType = type || 'unknown';
    
    // Special handling: if type is "status-update" but status is "ended", treat as end-of-call-report
    if (type === 'status-update' && (messageWrapper?.status === 'ended' || call?.status === 'ended' || messageWrapper?.endedReason)) {
      inferredType = 'end-of-call-report';
      console.log('✅ Converting status-update to end-of-call-report (status is ended)');
    }
    // If type is missing but we have clues, infer it
    else if (!type) {
      if (functionCall) {
        inferredType = 'function-call';
        console.log('✅ Inferred type: function-call (from functionCall presence)');
      } else if (messageWrapper) {
        // Check messageWrapper for type indicators
        if (messageWrapper.status === 'ended' || messageWrapper.endedReason) {
          inferredType = 'end-of-call-report';
          console.log('✅ Inferred type: end-of-call-report (from messageWrapper.status=ended)');
        } else if (messageWrapper.status) {
          inferredType = 'status-update';
          console.log('✅ Inferred type: status-update (from messageWrapper.status)');
        } else if (messageWrapper.type === 'conversation-update' || messageWrapper.type === 'speech-update') {
          inferredType = 'info-update';
          console.log('✅ Inferred type: info-update (conversation/speech update)');
        }
      } else if (call?.status === 'ended' && (call?.endedAt || call?.duration || call?.analysis)) {
        inferredType = 'end-of-call-report';
        console.log('✅ Inferred type: end-of-call-report (from call.status=ended)');
      } else if (call?.status && call?.status !== 'ended') {
        inferredType = 'status-update';
        console.log('✅ Inferred type: status-update (from call.status)');
      } else {
        inferredType = 'unknown';
        console.log('⚠️ Could not infer webhook type - logging full payload structure');
        console.log('📦 Full payload structure:', {
          hasType: !!payload?.type,
          typeValue: payload?.type,
          messageWrapperType: messageWrapper?.type,
          messageWrapperStatus: messageWrapper?.status,
          hasCall: !!call,
          callStatus: call?.status,
          hasFunctionCall: !!functionCall,
          topLevelKeys: Object.keys(payload || {}),
          messageWrapperKeys: messageWrapper ? Object.keys(messageWrapper) : null,
        });
      }
    } else {
      console.log('✅ Webhook type detected:', type);
    }

    // Extract business/agent IDs early for logging
    // Vapi can send assistantId in multiple places - check all
    let businessId: string | null = null;
    let agentId: string | null = null;
    
    const vapiAssistantId = 
      call?.assistantId || 
      call?.assistant?.id ||
      messageWrapper?.assistantId ||
      messageWrapper?.assistant?.id ||
      messageWrapper?.artifact?.assistantId ||
      payload?.assistantId ||
      payload?.assistant?.id ||
      functionCall?.assistantId ||
      null;
    
    if (vapiAssistantId) {
      console.log('🔍 Looking up agent by Vapi ID:', vapiAssistantId);
      const { data: agent, error: agentError } = await supabase
        .from('voice_agents')
        .select('id, business_id, name')
        .eq('vapi_assistant_id', vapiAssistantId)
        .single();
      
      if (agentError) {
        console.error('❌ Error finding agent:', agentError);
        await logVoiceAgentEvent(
          supabase,
          null,
          null,
          'webhook_error',
          `Agent lookup failed: ${agentError.message}`,
          { vapiAssistantId, error: agentError.message, errorCode: agentError.code },
          'error'
        );
      } else if (agent) {
        agentId = agent.id;
        businessId = agent.business_id;
        console.log('✅ Found agent:', agent.name, 'Business:', businessId);
      } else {
        console.error('❌ Agent not found for Vapi ID:', vapiAssistantId);
        await logVoiceAgentEvent(
          supabase,
          null,
          null,
          'webhook_error',
          `Agent not found for Vapi assistant ID: ${vapiAssistantId}`,
          { vapiAssistantId, searchedFields: ['call.assistantId', 'call.assistant.id', 'payload.assistantId'] },
          'error'
        );
      }
    } else {
      console.warn('⚠️ No assistantId found in webhook payload');
      console.warn('📦 Payload structure:', {
        hasCall: !!call,
        hasPayload: !!payload,
        callKeys: call ? Object.keys(call).slice(0, 10) : null,
        payloadKeys: Object.keys(payload || {}).slice(0, 10),
      });
    }

    // Log webhook receipt
    await logVoiceAgentEvent(
      supabase,
      businessId,
      agentId,
      'webhook_received',
      `Webhook received: ${inferredType}${functionCall ? ` - Function: ${functionCall.name}` : ''}`,
      { 
        originalType: type,
        inferredType: inferredType,
        vapiCallId: call?.id || call?.vapiCallId, 
        functionName: functionCall?.name,
        hasCall: !!call,
        hasFunctionCall: !!functionCall,
        hasMessageWrapper: !!messageWrapper,
        payloadKeys: Object.keys(payload || {}),
        messageWrapperKeys: messageWrapper ? Object.keys(messageWrapper) : null,
        payloadSample: JSON.stringify(payload).substring(0, 500) // First 500 chars for debugging
      },
      'info',
      null
    );

    // Handle different webhook types - use inferred type
    const webhookType = inferredType;
    
    console.log('🎯 Processing webhook type:', webhookType);
    console.log('🎯 Original type from payload:', type);
    console.log('🎯 Has functionCall:', !!functionCall);
    console.log('🎯 Has call:', !!call);
    
    // Process function calls
    if (webhookType === 'function-call' && functionCall) {
      console.log('🎯 Processing function call:', functionCall.name);
      try {
        const result = await handleFunctionCall(supabase, functionCall, call);
        console.log('✅ Function call processed successfully');
        return result;
      } catch (error: any) {
        console.error('❌ Error in handleFunctionCall:', error);
        console.error('Error stack:', error.stack);
        await logVoiceAgentEvent(
          supabase,
          businessId,
          agentId,
          'function_call_error',
          `Function call failed: ${functionCall.name} - ${error.message}`,
          { functionName: functionCall.name, error: error.message, stack: error.stack?.substring(0, 1000) },
          'error'
        );
        // Return error response so it's visible in Supabase logs
        return new Response(
          JSON.stringify({ 
            success: false, 
            error: error.message,
            functionName: functionCall.name,
            stack: error.stack?.substring(0, 500)
          }),
          {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 500,
          }
        );
      }
    } else if (webhookType === 'end-of-call-report' || type === 'end-of-call-report') {
      console.log('📋 Processing end of call report - creating records from analysis');
      // For end-of-call-report, the call data is in messageWrapper or call
      const endCallData = call || messageWrapper?.artifact?.call || messageWrapper || null;
      if (endCallData) {
        // Ensure we pass the full messageWrapper structure for proper extraction
        return await handleEndOfCall(supabase, endCallData);
      } else {
        console.warn('⚠️ End of call report received but no call data found');
      }
    } else if (webhookType === 'status-update' || type === 'status-update') {
      console.log('📞 Processing status update');
      // For status-update, the call data is in messageWrapper or call
      // messageWrapper itself might be the call data, or it might have call/artifact properties
      const statusCallData = call || messageWrapper?.artifact?.call || messageWrapper || null;
      if (statusCallData) {
        // Ensure we pass the full messageWrapper structure for proper extraction
        return await handleCallStatusUpdate(supabase, statusCallData);
      } else {
        console.warn('⚠️ Status update received but no call data found');
      }
    } else if (webhookType === 'assistant.started' || type === 'assistant.started') {
      // Assistant started speaking - create call record
      console.log('🤖 Processing assistant.started - creating call record');
      const assistantCallData = call || messageWrapper?.artifact?.call || messageWrapper || null;
      if (assistantCallData) {
        const vapiCallId = assistantCallData?.id || assistantCallData?.callId || null;
        const assistantId = assistantCallData?.assistantId || assistantCallData?.assistant?.id || messageWrapper?.newAssistant?.id || null;
        
        if (vapiCallId && assistantId && agentId && businessId) {
          const phoneNumber = assistantCallData?.customer?.number || assistantCallData?.phoneNumber || null;
          const callData = {
            business_id: businessId,
            agent_id: agentId,
            vapi_call_id: vapiCallId,
            phone_number: phoneNumber,
            direction: 'inbound',
            status: 'in-progress',
            started_at: new Date().toISOString(),
            was_answered: true,
            metadata: assistantCallData,
          };
          
          // Upsert call record
          await supabase
            .from('voice_agent_calls')
            .upsert(callData, { onConflict: 'vapi_call_id' });
          
          await logVoiceAgentEvent(
            supabase,
            businessId,
            agentId,
            'call_started',
            `Call started: ${vapiCallId}`,
            { vapiCallId, phoneNumber },
            'info',
            vapiCallId
          );
        }
      }
      return new Response(JSON.stringify({ success: true, message: 'Assistant started acknowledged' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      });
    } else if (webhookType === 'user-interrupted' || type === 'user-interrupted') {
      // User interrupted the AI - informational, just log
      console.log('👤 User interrupted assistant - informational');
      await logVoiceAgentEvent(
        supabase,
        businessId,
        agentId,
        'user_interrupted',
        'User interrupted assistant',
        { callId: call?.id || null },
        'info',
        call?.id || null
      );
      return new Response(JSON.stringify({ success: true, message: 'User interrupted acknowledged' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      });
    } else if (webhookType === 'hang' || type === 'hang') {
      // Call hung up - update call record
      console.log('📞 Processing hang - updating call record');
      const hangCallData = call || messageWrapper?.artifact?.call || messageWrapper || null;
      if (hangCallData) {
        const vapiCallId = hangCallData?.id || hangCallData?.callId || null;
        if (vapiCallId) {
          await supabase
            .from('voice_agent_calls')
            .update({
              status: 'completed',
              ended_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq('vapi_call_id', vapiCallId);
          
          await logVoiceAgentEvent(
            supabase,
            businessId,
            agentId,
            'call_ended',
            `Call ended: ${vapiCallId}`,
            { vapiCallId },
            'info',
            vapiCallId
          );
        }
      }
      return new Response(JSON.stringify({ success: true, message: 'Call hang acknowledged' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      });
    } else if (webhookType === 'info-update' || type === 'conversation-update' || type === 'speech-update') {
      // Informational updates (conversation-update, speech-update) - just log and acknowledge
      console.log('ℹ️ Informational webhook received (conversation/speech update) - acknowledging');
      await logVoiceAgentEvent(
        supabase,
        businessId,
        agentId,
        'webhook_info_update',
        `Informational webhook: ${type || 'unknown'}`,
        { type: type || webhookType, messageWrapper: JSON.stringify(messageWrapper).substring(0, 500) },
        'info'
      );
      return new Response(JSON.stringify({ success: true, message: 'Informational webhook acknowledged' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      });
    } else {
      // Log unhandled webhook types
      console.log('⚠️ Unhandled webhook type:', inferredType);
      console.log('📦 Full payload:', JSON.stringify(payload, null, 2));
      await logVoiceAgentEvent(
        supabase,
        businessId,
        agentId,
        'webhook_unhandled',
        `Unhandled webhook type: ${inferredType} (original: ${type})`,
        { 
          originalType: type,
          inferredType: inferredType,
          hasCall: !!call, 
          hasFunctionCall: !!functionCall, 
          hasMessageWrapper: !!messageWrapper,
          payloadStructure: {
            topLevelKeys: Object.keys(payload || {}),
            callKeys: call ? Object.keys(call) : null,
            functionCallKeys: functionCall ? Object.keys(functionCall) : null,
          },
          payloadSample: JSON.stringify(payload).substring(0, 2000)
        },
        'warning'
      );
    }

    // Return success for any webhook we receive
    return new Response(
      JSON.stringify({ success: true, message: 'Webhook processed' }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );
  } catch (error: any) {
    console.error('❌ CRITICAL ERROR processing voice agent webhook:', error);
    console.error('Error stack:', error.stack);
    console.error('Error details:', {
      message: error.message,
      name: error.name,
      code: error.code,
    });
    
    // Try to log the error (may fail if DB is issue)
    try {
      // Re-initialize supabase client in case it wasn't available in the catch block
      const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
      const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
      const errorSupabase = createClient(supabaseUrl, supabaseServiceKey);
      
      await logVoiceAgentEvent(
        errorSupabase,
        null,
        null,
        'webhook_critical_error',
        `Critical webhook error: ${error.message}`,
        { 
          error: error.message, 
          stack: error.stack?.substring(0, 1000),
          name: error.name,
          code: error.code
        },
        'error'
      );
    } catch (logError) {
      console.error('❌ Failed to log error to database:', logError);
    }
    
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || 'Failed to process webhook',
        details: error.stack?.substring(0, 500),
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      }
    );
  }
});

// Handle function calls from AI agent
async function handleFunctionCall(
  supabase: any,
  functionCall: any,
  call: any
) {
  const { name, parameters } = functionCall;

  console.log('🎯 FUNCTION CALL RECEIVED:', {
    functionName: name,
    parameters: JSON.stringify(parameters, null, 2),
    callId: call?.id,
    assistantId: call?.assistantId || call?.assistant?.id,
    timestamp: new Date().toISOString(),
  });
  console.log('📋 Parameters:', parameters);
  
  // Log function call - will update with IDs after we fetch them
  let logCallId: string | null = null;

  // Get agent and business from call metadata or assistant ID
  let agentId = call?.assistantId || call?.assistant?.id;
  let businessId = null;

  if (agentId) {
    // Find agent by Vapi assistant ID
    const { data: agent } = await supabase
      .from('voice_agents')
      .select('id, business_id')
      .eq('vapi_assistant_id', agentId)
      .single();

    if (agent) {
      agentId = agent.id;
      businessId = agent.business_id;
      
      // Get or create call ID for logging
      if (call?.id) {
        logCallId = await getOrCreateCallId(supabase, call, businessId, agentId);
      }
      
      // Log function call received
      await logVoiceAgentEvent(
        supabase,
        businessId,
        agentId,
        'function_call_received',
        `Function call: ${name}`,
        { functionName: name, parameters: JSON.stringify(parameters).substring(0, 1000) },
        'info',
        logCallId
      );
    }
  }

  if (!businessId) {
    console.error('Could not determine business ID from function call');
    await logVoiceAgentEvent(
      supabase,
      null,
      null,
      'function_call_error',
      `Could not determine business ID from function call: ${name}`,
      { functionName: name, assistantId: call?.assistantId || call?.assistant?.id },
      'error'
    );
    return new Response(
      JSON.stringify({ error: 'Business ID not found' }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      }
    );
  }

  let result: any = { success: true };

  switch (name) {
    case 'take_message_for_callback':
      // Handle message-taking when AI confidence is low
      try {
        const { caller_name, caller_phone, caller_message, confidence_level } = parameters;

        if (!caller_name || !caller_phone || !caller_message) {
          result = {
            success: false,
            message: "I need your name, phone number, and message to proceed.",
          };
          break;
        }

        // Get or create call ID
        const callId = call?.id ? await getOrCreateCallId(supabase, call, businessId, agentId) : null;

        // Save message to database
        const { data: message, error: messageError } = await supabase
          .from('voice_agent_messages')
          .insert({
            agent_id: agentId,
            business_id: businessId,
            call_id: callId,
            caller_name: caller_name.trim(),
            caller_phone: caller_phone.trim(),
            caller_message: caller_message.trim(),
            confidence_level: confidence_level || null,
            reason_for_message: confidence_level 
              ? `AI confidence level ${confidence_level}% is below threshold`
              : 'AI requested message collection',
            status: 'new',
          })
          .select()
          .single();

        if (messageError) {
          console.error('❌ Error saving message:', messageError);
          throw messageError;
        }

        console.log('✅ Message saved:', message.id);
        
        // Update call record - message means lead was captured
        if (callId) {
          await supabase
            .from('voice_agent_calls')
            .update({ lead_captured: true })
            .eq('id', callId);
        }
        
        // Log message saved
        await logVoiceAgentEvent(
          supabase,
          businessId,
          agentId,
          'message_saved',
          `Message saved from ${caller_name}`,
          { messageId: message.id, callerPhone: caller_phone, confidenceLevel: confidence_level },
          'info',
          callId
        );

        // Send email notification
        try {
          await sendMessageNotificationEmail(supabase, businessId, agentId, message, callId);
          await logVoiceAgentEvent(
            supabase,
            businessId,
            agentId,
            'email_sent',
            `Message notification email sent for ${caller_name}`,
            { messageId: message.id },
            'info',
            callId
          );
        } catch (emailError: any) {
          await logVoiceAgentEvent(
            supabase,
            businessId,
            agentId,
            'email_failed',
            `Failed to send message notification email: ${emailError.message}`,
            { messageId: message.id, error: emailError.message },
            'error',
            callId
          );
          // Don't fail the whole operation if email fails
        }

        result = {
          success: true,
          message: "Perfect! I've got all your information. Someone from our team will call you back soon. Thank you for calling!",
          confirmation: "Message recorded successfully",
        };
      } catch (error) {
        console.error('❌ Error in take_message_for_callback:', error);
        result = {
          success: false,
          message: "I'm sorry, I'm having trouble recording your message. Could you please call back or leave your phone number and we'll contact you?",
        };
      }
      break;

    case 'check_availability':
      // Check availability for date/time
      try {
        const { date, time, booking_type, service_type, duration_minutes, party_size } = parameters;
        
        if (!date || !time) {
          result = {
            success: false,
            available: false,
            message: "I need a date and time to check availability.",
          };
          break;
        }

        // Get agent configuration
        const { data: agent } = await supabase
          .from('voice_agents')
          .select('booking_slot_duration, booking_buffer_minutes, booking_advance_days, max_party_size')
          .eq('id', agentId)
          .single();

        const slotDuration = duration_minutes || agent?.booking_slot_duration || 30;
        const bufferMinutes = agent?.booking_buffer_minutes || 0;
        const maxAdvanceDays = agent?.booking_advance_days || 90;
        const maxParty = agent?.max_party_size || 10;

        // Parse date and time
        const requestedDate = new Date(date);
        const [timeHour, timeMinute] = time.split(':').map(Number);
        const requestedDateTime = new Date(requestedDate);
        requestedDateTime.setHours(timeHour, timeMinute, 0, 0);

        // Check if date is too far in advance
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const daysDiff = Math.floor((requestedDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
        
        if (daysDiff < 0) {
          result = {
            success: false,
            available: false,
            message: "I can't book dates in the past. Please choose a future date.",
          };
          break;
        }

        if (daysDiff > maxAdvanceDays) {
          result = {
            success: false,
            available: false,
            message: `We can only accept bookings up to ${maxAdvanceDays} days in advance.`,
          };
          break;
        }

        // Check party size for reservations
        if (booking_type === 'reservation' && party_size && party_size > maxParty) {
          result = {
            success: false,
            available: false,
            message: `We can only accommodate parties up to ${maxParty} people.`,
          };
          break;
        }

        // Check business hours (using business table)
        const { data: business } = await supabase
          .from('businesses')
          .select('operating_hours, timezone, name')
          .eq('id', businessId)
          .single();

        const timezone = business?.timezone || 'America/Toronto';
        const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
        const dayOfWeek = dayNames[requestedDate.getDay()];
        const operatingHours = business?.operating_hours || {};
        const dayHours = operatingHours[dayOfWeek];

        if (!dayHours || dayHours.closed === true) {
          result = {
            success: true,
            available: false,
            message: `We're closed on ${dayOfWeek}. Would you like to choose a different day?`,
            alternative_dates: [],
          };
          break;
        }

        const [openHour, openMin] = (dayHours.open || '09:00').split(':').map(Number);
        const [closeHour, closeMin] = (dayHours.close || '17:00').split(':').map(Number);
        const openTime = openHour * 60 + openMin;
        const closeTime = closeHour * 60 + closeMin;
        const requestedTime = timeHour * 60 + timeMinute;
        const endTime = requestedTime + slotDuration;

        if (requestedTime < openTime || endTime > closeTime) {
          result = {
            success: true,
            available: false,
            message: `That time is outside our business hours. We're open ${dayHours.open} to ${dayHours.close} on ${dayOfWeek}.`,
            alternative_times: [],
          };
          break;
        }

        // Check for existing bookings that conflict
        const bookingEndTime = new Date(requestedDateTime);
        bookingEndTime.setMinutes(bookingEndTime.getMinutes() + slotDuration + bufferMinutes);
        
        const bookingStartTime = new Date(requestedDateTime);
        bookingStartTime.setMinutes(bookingStartTime.getMinutes() - bufferMinutes);

        // Format times as HH:MM for database comparison (booking_time is stored as TIME type)
        const formatTimeForDB = (date: Date) => {
          const hours = date.getHours().toString().padStart(2, '0');
          const minutes = date.getMinutes().toString().padStart(2, '0');
          return `${hours}:${minutes}`;
        };

        const startTimeStr = formatTimeForDB(bookingStartTime);
        const endTimeStr = formatTimeForDB(bookingEndTime);

        const { data: conflictingBookings, error: conflictCheckError } = await supabase
          .from('voice_agent_bookings')
          .select('booking_time, duration_minutes')
          .eq('business_id', businessId)
          .eq('booking_date', date)
          .in('status', ['confirmed', 'pending']) // Check both confirmed and pending
          .gte('booking_time', startTimeStr)
          .lte('booking_time', endTimeStr);

        if (conflictCheckError) {
          console.error('❌ Error checking for conflicts:', conflictCheckError);
          // Don't block availability check - assume available if we can't check
        }

        if (conflictingBookings && conflictingBookings.length > 0) {
          // Generate alternative times
          const alternatives: string[] = [];
          for (let offset = 30; offset <= 180; offset += 30) {
            const altTime = requestedTime + offset;
            if (altTime + slotDuration <= closeTime) {
              const altHour = Math.floor(altTime / 60);
              const altMin = altTime % 60;
              const altTimeStr = `${altHour.toString().padStart(2, '0')}:${altMin.toString().padStart(2, '0')}`;
              
              // Quick check if this alternative conflicts
              const altDateTime = new Date(requestedDate);
              altDateTime.setHours(altHour, altMin, 0, 0);
              alternatives.push(altTimeStr);
              if (alternatives.length >= 3) break;
            }
          }

          result = {
            success: true,
            available: false,
            message: "I'm sorry, that time slot is already booked. Would any of these times work for you?",
            alternative_times: alternatives,
            requested_date: date,
            requested_time: time,
          };
          break;
        }

        // Available!
        result = {
          success: true,
          available: true,
          message: `Great! ${time} on ${date} is available. Would you like me to book that for you?`,
          requested_date: date,
          requested_time: time,
        };
      } catch (error) {
        console.error('❌ Error checking availability:', error);
        result = {
          success: false,
          available: false,
          message: "I'm having trouble checking availability right now. Could you try again?",
        };
      }
      break;

    case 'book_appointment':
    case 'book_reservation':
      // Book an appointment or reservation
      try {
        console.log('📞 BOOKING REQUEST RECEIVED:', {
          functionName: name,
          parameters: JSON.stringify(parameters, null, 2),
          agentId,
          businessId,
        });

        const { 
          customer_name, 
          customer_phone, 
          customer_email,
          date, 
          time, 
          booking_type,
          service_type,
          duration_minutes,
          party_size,
          notes
        } = parameters;

        console.log('📋 Parsed parameters:', {
          customer_name,
          customer_phone,
          customer_email,
          date,
          time,
          booking_type,
          service_type,
        });

        if (!customer_name || !customer_phone || !date || !time) {
          console.error('❌ Missing required parameters:', {
            hasName: !!customer_name,
            hasPhone: !!customer_phone,
            hasDate: !!date,
            hasTime: !!time,
          });
          result = {
            success: false,
            message: "I need your name, phone number, date, and time to book this.",
          };
          break;
        }

        // Determine booking type
        const finalBookingType = booking_type || (name === 'book_reservation' ? 'reservation' : 'appointment');
        console.log('📝 Final booking type:', finalBookingType);

        // Get agent configuration
        const { data: agent } = await supabase
          .from('voice_agents')
          .select('booking_slot_duration, booking_buffer_minutes, booking_advance_days, max_party_size')
          .eq('id', agentId)
          .single();

        const slotDuration = duration_minutes || agent?.booking_slot_duration || 30;

        // Verify availability first (reuse check_availability logic)
        const { data: business } = await supabase
          .from('businesses')
          .select('operating_hours, timezone, name')
          .eq('id', businessId)
          .single();

        const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
        const requestedDate = new Date(date);
        const dayOfWeek = dayNames[requestedDate.getDay()];
        const operatingHours = business?.operating_hours || {};
        const dayHours = operatingHours[dayOfWeek];

        if (!dayHours || dayHours.closed === true) {
          result = {
            success: false,
            message: `I'm sorry, we're closed on ${dayOfWeek}. Would you like to choose a different day?`,
          };
          break;
        }

        // Check for conflicts
        // Handle time format: could be "HH:MM" or "HH:MM:SS"
        const timeParts = time.split(':');
        const timeHour = parseInt(timeParts[0], 10);
        const timeMinute = parseInt(timeParts[1], 10);
        
        if (isNaN(timeHour) || isNaN(timeMinute) || timeHour < 0 || timeHour > 23 || timeMinute < 0 || timeMinute > 59) {
          result = {
            success: false,
            message: "I'm sorry, I received an invalid time format. Could you please provide the time again?",
          };
          break;
        }

        const requestedDateTime = new Date(date + 'T' + time + ':00');
        if (isNaN(requestedDateTime.getTime())) {
          result = {
            success: false,
            message: "I'm sorry, I received an invalid date or time. Could you please provide the date and time again?",
          };
          break;
        }

        const bookingEndTime = new Date(requestedDateTime);
        bookingEndTime.setMinutes(bookingEndTime.getMinutes() + slotDuration + (agent?.booking_buffer_minutes || 0));
        
        const bookingStartTime = new Date(requestedDateTime);
        bookingStartTime.setMinutes(bookingStartTime.getMinutes() - (agent?.booking_buffer_minutes || 0));

        // Format times as HH:MM for database comparison (booking_time is stored as TIME type)
        const formatTimeForDB = (date: Date) => {
          const hours = date.getHours().toString().padStart(2, '0');
          const minutes = date.getMinutes().toString().padStart(2, '0');
          return `${hours}:${minutes}`;
        };

        const startTimeStr = formatTimeForDB(bookingStartTime);
        const endTimeStr = formatTimeForDB(bookingEndTime);

        const { data: conflictingBookings, error: conflictCheckError } = await supabase
          .from('voice_agent_bookings')
          .select('id')
          .eq('business_id', businessId)
          .eq('booking_date', date)
          .in('status', ['confirmed', 'pending']) // Check both confirmed and pending
          .gte('booking_time', startTimeStr)
          .lte('booking_time', endTimeStr);

        if (conflictCheckError) {
          console.error('❌ Error checking for conflicts:', conflictCheckError);
          // Don't block booking on conflict check error, but log it
        }

        if (conflictingBookings && conflictingBookings.length > 0) {
          result = {
            success: false,
            message: "I'm sorry, that time slot was just booked. Could you choose a different time?",
          };
          break;
        }

        // Get or create call ID
        const callId = call?.id ? await getOrCreateCallId(supabase, call, businessId, agentId) : null;

        // Create booking
        const bookingData = {
          business_id: businessId,
          agent_id: agentId,
          call_id: callId,
          customer_name: customer_name.trim(),
          customer_phone: customer_phone.trim(),
          customer_email: customer_email?.trim() || null,
          booking_type: finalBookingType,
          service_type: service_type || null,
          booking_date: date,
          booking_time: time,
          party_size: party_size || 1,
          duration_minutes: slotDuration,
          status: 'confirmed',
          notes: notes || null,
          confirmed_at: new Date().toISOString(),
          source_data: parameters,
        };

        console.log('💾 Attempting to create booking with data:', JSON.stringify(bookingData, null, 2));

        const { data: booking, error: bookingError } = await supabase
          .from('voice_agent_bookings')
          .insert(bookingData)
          .select()
          .single();

        if (bookingError) {
          console.error('❌ ERROR CREATING BOOKING:', {
            error: bookingError,
            message: bookingError.message,
            code: bookingError.code,
            details: bookingError.details,
            hint: bookingError.hint,
            bookingData: JSON.stringify(bookingData, null, 2),
          });
          throw bookingError;
        }

        console.log('✅ BOOKING CREATED SUCCESSFULLY:', {
          bookingId: booking?.id,
          customerName: booking?.customer_name,
          bookingDate: booking?.booking_date,
          bookingTime: booking?.booking_time,
          bookingType: booking?.booking_type,
        });
        
        // Log booking creation
        await logVoiceAgentEvent(
          supabase,
          businessId,
          agentId,
          'booking_created',
          `Booking created: ${booking.customer_name} - ${booking.booking_type} on ${booking.booking_date} at ${booking.booking_time}`,
          { 
            bookingId: booking.id, 
            customerName: booking.customer_name,
            bookingType: booking.booking_type,
            bookingDate: booking.booking_date,
            bookingTime: booking.booking_time,
            confirmationCode: booking.confirmation_code
          },
          'info',
          callId
        );

        // Update call record - booking also means lead was captured
        if (callId) {
          await supabase
            .from('voice_agent_calls')
            .update({ 
              booking_captured: true,
              lead_captured: true  // Booking means we captured a lead
            })
            .eq('id', callId);
        }

        // Send email notification for callback bookings
        // IMPORTANT: Don't fail the booking if email fails - booking is more important
        if (finalBookingType === 'callback') {
          try {
            await sendCallbackBookingEmail(supabase, businessId, agentId, booking);
          } catch (emailError) {
            // Log but don't fail - booking was created successfully
            console.error('⚠️ Callback booking created but email notification failed:', emailError);
          }
        }

        // Verify confirmation code was generated (should be auto-generated by trigger)
        if (!booking.confirmation_code) {
          console.error('⚠️ WARNING: Booking created but confirmation_code is missing. This should be auto-generated by database trigger.');
          // Generate a fallback code
          const fallbackCode = Math.random().toString(36).substring(2, 10).toUpperCase();
          console.log('📝 Using fallback confirmation code:', fallbackCode);
          // Update booking with fallback code
          await supabase
            .from('voice_agent_bookings')
            .update({ confirmation_code: fallbackCode })
            .eq('id', booking.id);
          booking.confirmation_code = fallbackCode;
        }

        // Generate confirmation message
        const confirmationCode = booking.confirmation_code || 'N/A';
        const confirmationMsg = finalBookingType === 'reservation' 
          ? `Perfect! Your reservation for ${party_size || 1} ${party_size === 1 ? 'person' : 'people'} on ${date} at ${time} is confirmed. Your confirmation code is ${confirmationCode}. We look forward to seeing you!`
          : finalBookingType === 'callback'
          ? `Perfect! I've scheduled a callback for you on ${date} at ${time}. We'll call you back at ${customer_phone}. Your confirmation code is ${confirmationCode}.`
          : `Perfect! Your ${service_type || 'appointment'} on ${date} at ${time} is confirmed. Your confirmation code is ${confirmationCode}. We'll see you then!`;

        result = {
          success: true,
          booking_id: booking.id,
          confirmation_code: confirmationCode,
          message: confirmationMsg,
          booking_date: date,
          booking_time: time,
        };
      } catch (error: any) {
        console.error('❌ Error booking appointment:', error);
        result = {
          success: false,
          message: "I'm sorry, I'm having trouble booking that right now. Could you call back or would you like me to take a message?",
        };
      }
      break;

    case 'capture_lead':
      // Save lead to database
      try {
        const { data: lead, error: leadError } = await supabase
          .from('voice_agent_leads')
          .insert({
            business_id: businessId,
            agent_id: agentId,
            call_id: call?.id ? await getOrCreateCallId(supabase, call, businessId, agentId) : null,
            name: parameters.name,
            phone: parameters.phone,
            email: parameters.email,
            event_type: parameters.event_type,
            preferred_date: parameters.preferred_date,
            preferred_time: parameters.preferred_time,
            guest_count: parameters.guest_count,
            notes: parameters.notes,
            status: 'new',
            source_data: parameters,
          })
          .select()
          .single();

        if (leadError) {
          console.error('Error saving lead:', leadError);
        } else {
          // Send notification if configured
          await sendNewLeadNotification(supabase, businessId, lead);
        }

        result = {
          success: true,
          confirmation_number: `BK${Math.floor(Math.random() * 10000)}`,
          message: "Perfect! I've got all your information. Someone will call you within 2 hours to confirm.",
        };
      } catch (error) {
        console.error('Error in capture_lead:', error);
        result = {
          success: true,
          message: "I've noted your information. Someone will call you soon.",
        };
      }
      break;

    case 'transfer_to_human':
      result = {
        success: true,
        message: 'Let me transfer you to our specialist right away.',
      };
      break;

    case 'check_if_business_is_open':
      // Handle checking if business is currently open
      try {
        console.log('🔍 Starting business hours check for business:', businessId);
        
        // Get business info including operating hours and timezone
        const { data: businessData, error: businessError } = await supabase
          .from('businesses')
          .select('id, name, operating_hours, holiday_hours, timezone')
          .eq('id', businessId)
          .single();

        if (businessError || !businessData) {
          console.error('❌ Error fetching business data:', businessError);
          result = {
            success: true,
            message: "I'm having trouble checking our hours right now. Please call back during our regular business hours.",
          };
          break;
        }

        console.log('✅ Business data fetched:', businessData.name);

        // Get current time in business timezone
        const timezone = businessData.timezone || 'America/Toronto';
        const now = new Date();
        
        // Use Intl.DateTimeFormat to get time in business timezone
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
        const currentTime = currentHour * 60 + currentMinute; // Minutes since midnight

        console.log(`⏰ Current time in ${timezone}: ${currentHour}:${currentMinute.toString().padStart(2, '0')} on ${dayName}`);

        // Check regular operating hours
        const operatingHours = businessData.operating_hours || {};
        const dayHours = operatingHours[dayName];

        if (!dayHours || dayHours.closed === true) {
          result = {
            success: true,
            message: "We're closed today. Please check our regular business hours.",
          };
          break;
        }

        // Parse opening and closing times
        const openTimeStr = dayHours.open || '';
        const closeTimeStr = dayHours.close || '';

        if (!openTimeStr || !closeTimeStr) {
          result = {
            success: true,
            message: "I'm unable to check our hours right now. Please call back during our regular business hours.",
          };
          break;
        }

        const [openHour, openMin] = openTimeStr.split(':').map(Number);
        const [closeHour, closeMin] = closeTimeStr.split(':').map(Number);
        const openTime = openHour * 60 + openMin;
        const closeTime = closeHour * 60 + closeMin;

        // Format times for display
        const formatTime = (hours: number, minutes: number) => {
          const h12 = hours % 12 || 12;
          const ampm = hours >= 12 ? 'PM' : 'AM';
          return `${h12}:${minutes.toString().padStart(2, '0')} ${ampm}`;
        };

        console.log(`📅 Hours: ${openTimeStr} - ${closeTimeStr}, Current: ${currentHour}:${currentMinute.toString().padStart(2, '0')}`);

        if (currentTime >= openTime && currentTime < closeTime) {
          result = {
            success: true,
            message: `Yes, we're open! We're open until ${formatTime(closeHour, closeMin)} today.`,
          };
        } else if (currentTime < openTime) {
          result = {
            success: true,
            message: `We're closed right now. We open today at ${formatTime(openHour, openMin)}.`,
          };
        } else {
          result = {
            success: true,
            message: `We're closed now. We were open today from ${formatTime(openHour, openMin)} to ${formatTime(closeHour, closeMin)}.`,
          };
        }
      } catch (error: any) {
        console.error('❌ Error checking business hours:', error);
        result = {
          success: true,
          message: "I'm having trouble checking our hours right now. Please call back during our regular business hours.",
        };
      }
      break;

    case 'report_issue':
      // Handle AI reporting issues or knowledge gaps
      try {
        const { issue_type, description, caller_question, suggested_fix, confidence_level } = parameters;

        if (!issue_type || !description) {
          result = {
            success: false,
            message: "I need an issue type and description to report this issue.",
          };
          break;
        }

        // Get or create call ID
        const callId = call?.id ? await getOrCreateCallId(supabase, call, businessId, agentId) : null;

        // Save issue to database
        const { data: issue, error: issueError } = await supabase
          .from('voice_agent_issues')
          .insert({
            agent_id: agentId,
            business_id: businessId,
            call_id: callId,
            issue_type: issue_type.trim(),
            description: description.trim(),
            caller_question: caller_question?.trim() || null,
            suggested_fix: suggested_fix?.trim() || null,
            confidence_level: confidence_level || null,
            status: 'open',
            source_data: parameters,
          })
          .select()
          .single();

        if (issueError) {
          console.error('❌ Error saving issue to database:', issueError);
          // Continue anyway to send email
        } else {
          console.log('✅ Issue saved to database:', issue.id);
        }

        // Send issue report email
        await sendIssueReportEmail(supabase, businessId, agentId, {
          issue_type: issue_type.trim(),
          description: description.trim(),
          caller_question: caller_question?.trim() || undefined,
          suggested_fix: suggested_fix?.trim() || undefined,
          confidence_level: confidence_level || undefined,
          call_id: callId || undefined,
        });

        result = {
          success: true,
          message: "Thank you for reporting this. I've noted the issue and someone will review it.",
        };
      } catch (error) {
        console.error('❌ Error in report_issue:', error);
        result = {
          success: false,
          message: "I'm sorry, I'm having trouble reporting this issue. Please try again.",
        };
      }
      break;

    default:
      result = {
        success: true,
        message: 'I understand. Let me help you with that.',
      };
  }

  return new Response(JSON.stringify(result), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status: 200,
  });
}

// Handle call status updates
async function handleCallStatusUpdate(supabase: any, call: any) {
  console.log('📞 handleCallStatusUpdate called with call:', JSON.stringify(call, null, 2));
  
  // Extract data - call might be the full message object, artifact, or just call data
  const statusArtifact = call?.artifact || null;
  const status = call?.status || statusArtifact?.status || null;
  const vapiCallId = call?.id || statusArtifact?.id || call?.callId || statusArtifact?.callId || null;
  const assistantId = call?.assistantId || statusArtifact?.assistantId || call?.assistant?.id || statusArtifact?.assistant?.id || null;
  
  console.log('📞 Extracted - Status:', status, 'CallId:', vapiCallId, 'AssistantId:', assistantId);

  // Find agent by Vapi assistant ID
  const { data: agent } = await supabase
    .from('voice_agents')
    .select('id, business_id')
    .eq('vapi_assistant_id', assistantId)
    .single();

  if (!agent) {
    console.error('Agent not found for call:', assistantId);
    return new Response(JSON.stringify({ success: false }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });
  }

  // Update or create call record
  const callArtifact = call?.artifact || null;
  const phoneNumber = call?.customer?.number || call?.phoneNumber || callArtifact?.customer?.number || callArtifact?.phoneNumber || null;
  const direction = call?.direction || callArtifact?.direction || 'inbound';
  const startedAt = call?.startedAt || callArtifact?.startedAt || null;
  
  const callData = {
    business_id: agent.business_id,
    agent_id: agent.id,
    vapi_call_id: vapiCallId,
    phone_number: phoneNumber,
    direction: direction,
    status: status,
    started_at: startedAt ? new Date(startedAt).toISOString() : null,
    metadata: call, // Store full call object
    updated_at: new Date().toISOString(),
  };

  // Check if call exists
  const { data: existingCall } = await supabase
    .from('voice_agent_calls')
    .select('id')
    .eq('vapi_call_id', vapiCallId)
    .single();

  if (existingCall) {
    // Update existing call
    await supabase
      .from('voice_agent_calls')
      .update(callData)
      .eq('id', existingCall.id);
  } else {
    // Create new call
    await supabase.from('voice_agent_calls').insert({
      ...callData,
      created_at: new Date().toISOString(),
    });
  }

  return new Response(JSON.stringify({ success: true }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status: 200,
  });
}

// Handle end of call
async function handleEndOfCall(supabase: any, call: any) {
  console.log('📋 handleEndOfCall called with call:', JSON.stringify(call, null, 2));
  
  // Extract data - call might be the full message object or just call data
  // Check both direct properties and nested artifact
  const artifact = call?.artifact || call;
  const vapiCallId = call?.id || artifact?.id || call?.callId || null;
  const assistantId = call?.assistantId || artifact?.assistantId || call?.assistant?.id || artifact?.assistant?.id || null;
  const endedAt = call?.endedAt || artifact?.endedAt || null;
  const duration = call?.duration || artifact?.duration || null;
  const transcript = call?.transcript || artifact?.transcript || null;
  const recordingUrl = call?.recordingUrl || artifact?.recordingUrl || null;
  const analysis = call?.analysis || artifact?.analysis || null;
  
  console.log('📋 Extracted - CallId:', vapiCallId, 'AssistantId:', assistantId, 'Has analysis:', !!analysis);

  // Find agent
  const { data: agent } = await supabase
    .from('voice_agents')
    .select('id, business_id, name')
    .eq('vapi_assistant_id', assistantId)
    .single();

  if (!agent) {
    console.error('❌ Agent not found for assistant ID:', assistantId);
    return new Response(JSON.stringify({ success: false, error: 'Agent not found' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });
  }

  // Update call record
  const { data: callRecord } = await supabase
    .from('voice_agent_calls')
    .select('id')
    .eq('vapi_call_id', vapiCallId)
    .single();

  if (callRecord) {
    await supabase
      .from('voice_agent_calls')
      .update({
        status: 'completed',
        ended_at: endedAt ? new Date(endedAt).toISOString() : null,
        duration_seconds: duration || null,
        transcript: transcript || null,
        recording_url: recordingUrl || null,
        was_answered: duration > 0,
        updated_at: new Date().toISOString(),
      })
      .eq('id', callRecord.id);
  }

  // FALLBACK: Parse analysis for callback/booking requests that AI didn't handle
  console.log('🔍 Checking for callback/booking requests in analysis...');
  console.log('🔍 Has analysis:', !!analysis);
  console.log('🔍 Analysis summary:', analysis?.summary?.substring(0, 200) || 'NONE');
  console.log('🔍 Transcript length:', transcript?.length || 0);
  
  if (analysis?.summary) {
    const summary = analysis.summary.toLowerCase();
    const transcriptText = transcript?.toLowerCase() || '';
    const fullText = (summary + ' ' + transcriptText).toLowerCase();
    
    console.log('🔍 Full text search length:', fullText.length);
    
    // Check if callback was requested
    const callbackKeywords = ['callback', 'call back', 'call me back', 'call back later', 'manager call', 'call from manager', 'contact me', 'reach out'];
    const bookingKeywords = ['book', 'booking', 'appointment', 'schedule', 'reservation', 'available time', 'book a time', 'make an appointment'];
    
    const requestedCallback = callbackKeywords.some(keyword => {
      const found = fullText.includes(keyword);
      if (found) console.log(`✅ Found callback keyword: "${keyword}"`);
      return found;
    });
    const requestedBooking = bookingKeywords.some(keyword => {
      const found = fullText.includes(keyword);
      if (found) console.log(`✅ Found booking keyword: "${keyword}"`);
      return found;
    });
    
    console.log('🔍 Callback requested:', requestedCallback);
    console.log('🔍 Booking requested:', requestedBooking);
    
    if (requestedCallback || requestedBooking) {
      console.log('🔔 CALLBACK/BOOKING REQUESTED IN CALL - Creating fallback record');
      await logVoiceAgentEvent(
        supabase,
        agent.business_id,
        agent.id,
        'callback_request_detected',
        `Callback/booking requested in call analysis but no function was called. Summary: ${analysis.summary.substring(0, 200)}`,
        { 
          vapiCallId, 
          analysis: analysis.summary,
          requestedCallback,
          requestedBooking,
          transcript: transcript?.substring(0, 1000)
        },
        'warning',
        callRecord?.id || null
      );
      
      // Try to extract customer info from transcript, analysis, or call data
      const phoneMatch = transcript?.match(/(\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/);
      const nameMatch = transcript?.match(/(?:my name is|i'm|this is|i am)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i);
      
      // Get phone from transcript match, or fall back to call/artifact customer number
      const callerPhoneFromTranscript = phoneMatch ? phoneMatch[0].replace(/\D/g, '') : null;
      const callerPhoneFromCall = call?.customer?.number || artifact?.customer?.number || null;
      const callerPhone = callerPhoneFromTranscript 
        ? `+${callerPhoneFromTranscript}` 
        : callerPhoneFromCall || null;
      
      // Get name from transcript match, or use default
      const callerName = nameMatch ? nameMatch[1] : 'Customer';
      
      // Always create message if callback/booking detected (don't require phone/name in transcript)
      // Create a message record for follow-up
      try {
        const { data: message, error: msgError } = await supabase
          .from('voice_agent_messages')
          .insert({
            agent_id: agent.id,
            business_id: agent.business_id,
            call_id: callRecord?.id || null,
            caller_name: callerName || 'Unknown',
            caller_phone: callerPhone,
            caller_message: `[AUTO-DETECTED] Customer requested callback/booking during call. Summary: ${analysis.summary.substring(0, 500)}`,
            confidence_level: null,
            reason_for_message: 'Callback/booking requested but AI did not use function call. Auto-detected from call analysis.',
            status: 'new',
          })
          .select()
          .single();

        if (!msgError && message) {
          console.log('✅ Created fallback message record:', message.id);
          
          // Update call record - message means lead was captured
          if (callRecord?.id) {
            await supabase
              .from('voice_agent_calls')
              .update({ lead_captured: true })
              .eq('id', callRecord.id);
          }
          
          // Send email notification
          try {
            await sendMessageNotificationEmail(supabase, agent.business_id, agent.id, message, callRecord?.id || null);
          } catch (emailError) {
            console.error('❌ Failed to send fallback email:', emailError);
          }
        } else if (msgError) {
          console.error('❌ Error creating fallback message:', msgError);
        }
      } catch (error) {
        console.error('❌ Error creating fallback message:', error);
      }
    }
  }

  return new Response(JSON.stringify({ success: true }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status: 200,
  });
}

// Helper: Get or create call ID
async function getOrCreateCallId(
  supabase: any,
  call: any,
  businessId: string,
  agentId: string
): Promise<string | null> {
  if (!call?.id) return null;

  const { data: existing } = await supabase
    .from('voice_agent_calls')
    .select('id')
    .eq('vapi_call_id', call.id)
    .single();

  if (existing) return existing.id;

  // Create call record
  const { data: newCall } = await supabase
    .from('voice_agent_calls')
    .insert({
      business_id: businessId,
      agent_id: agentId,
      vapi_call_id: call.id,
      status: 'in-progress',
    })
    .select('id')
    .single();

  return newCall?.id || null;
}

// Send email notification for new message
async function sendMessageNotificationEmail(
  supabase: any,
  businessId: string,
  agentId: string,
  message: any,
  callId: string | null = null
) {
  try {
    // Get agent and notification email
    const { data: agent } = await supabase
      .from('voice_agents')
      .select('name, message_notification_email')
      .eq('id', agentId)
      .single();

    // Get business info for email
    const { data: business } = await supabase
      .from('businesses')
      .select('name, business_email')
      .eq('id', businessId)
      .single();

    // Determine recipient email (agent setting takes priority, then business email)
    const recipientEmail = agent?.message_notification_email 
      || business?.business_email 
      || null;

    if (!recipientEmail) {
      console.error('❌ CRITICAL: No email configured for message notifications:', {
        agentId,
        businessId,
        agentEmail: agent?.message_notification_email,
        businessEmail: business?.business_email,
      });
      // Update message record to show email failed
      await supabase
        .from('voice_agent_messages')
        .update({
          email_sent: false,
          email_error: 'No notification email configured. Please set message_notification_email on the agent or business_email on the business.',
        })
        .eq('id', message.id);
      // Don't silently fail - throw error so it's visible in logs
      throw new Error(`No email configured for message notifications. Agent: ${agentId}, Business: ${businessId}`);
    }

    // Build email content
    const subject = `URGENT: New Message from ${message.caller_name} - ${agent?.name || 'Voice Agent'}`;
    const emailHtml = `
      <html>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
          <h2 style="color: #2563eb;">New Message from Voice Agent</h2>
          <div style="background: #f3f4f6; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <p><strong>Caller Name:</strong> ${message.caller_name}</p>
            <p><strong>Caller Phone:</strong> <a href="tel:${message.caller_phone}">${message.caller_phone}</a></p>
            ${message.caller_message ? `<p><strong>Message:</strong><br>${message.caller_message.replace(/\n/g, '<br>')}</p>` : ''}
            ${message.confidence_level ? `<p><strong>AI Confidence:</strong> ${message.confidence_level}%</p>` : ''}
          </div>
          <p><strong>Agent:</strong> ${agent?.name || 'Voice Agent'}</p>
          <p><strong>Business:</strong> ${business?.name || 'Business'}</p>
          <p><strong>Time:</strong> ${new Date().toLocaleString('en-US', { timeZone: 'America/Toronto' })}</p>
          <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;">
          <p style="color: #666; font-size: 12px;">This message was taken because the AI was not confident enough to answer the caller's question. Please call them back at your earliest convenience.</p>
          ${message.confidence_level && message.confidence_level < 98 ? `
          <div style="background: #fef3c7; border-left: 4px solid #f59e0b; padding: 15px; margin: 20px 0; border-radius: 4px;">
            <p style="margin: 0; font-weight: bold; color: #92400e;">💡 Suggestion:</p>
            <p style="margin: 5px 0 0 0; color: #78350f;">Consider adding this question to your FAQ section to help the AI answer it automatically in the future.</p>
            <p style="margin: 5px 0 0 0; color: #78350f; font-size: 14px;">Question: "${message.caller_message}"</p>
          </div>
          ` : ''}
        </body>
      </html>
    `;
    
    const emailText = `
New Message from Voice Agent

Caller Name: ${message.caller_name}
Caller Phone: ${message.caller_phone}
${message.caller_message ? `Message: ${message.caller_message}` : ''}
${message.confidence_level ? `AI Confidence: ${message.confidence_level}%` : ''}
Agent: ${agent?.name || 'Voice Agent'}
Business: ${business?.name || 'Business'}
Time: ${new Date().toLocaleString('en-US', { timeZone: 'America/Toronto' })}

This message was taken because the AI was not confident enough to answer the caller's question. Please call them back at your earliest convenience.
${message.confidence_level && message.confidence_level < 98 ? `

💡 Suggestion: Consider adding this question to your FAQ section to help the AI answer it automatically in the future.
Question: "${message.caller_message}"
` : ''}
    `.trim();

    // Send email directly using AWS SES
    try {
      const AWS_REGION = Deno.env.get('AWS_REGION') || 'us-east-1';
      const SES_ACCESS_KEY_ID = Deno.env.get('SES_ACCESS_KEY_ID');
      const SES_SECRET_ACCESS_KEY = Deno.env.get('SES_SECRET_ACCESS_KEY');

      if (!SES_ACCESS_KEY_ID || !SES_SECRET_ACCESS_KEY) {
        console.error('❌ CRITICAL: AWS SES credentials not configured. Email cannot be sent.');
        await supabase
          .from('voice_agent_messages')
          .update({
            email_sent: false,
            email_error: 'AWS SES credentials not configured',
          })
          .eq('id', message.id);
        // Don't silently fail - throw error so it's visible
        throw new Error('AWS SES credentials not configured. Please set SES_ACCESS_KEY_ID and SES_SECRET_ACCESS_KEY in Supabase Edge Function secrets.');
      }

      const sesClient = new SESv2Client({
        region: AWS_REGION,
        credentials: {
          accessKeyId: SES_ACCESS_KEY_ID,
          secretAccessKey: SES_SECRET_ACCESS_KEY,
        },
      });

      const fromEmail = business?.business_email || 'noreply@tavari.com';
      const fromName = business?.name || 'Tavari Voice Agent';

      const sendCommand = new SendEmailCommand({
        FromEmailAddress: fromEmail,
        Destination: {
          ToAddresses: [recipientEmail],
        },
        Content: {
          Simple: {
            Subject: {
              Data: subject,
              Charset: 'UTF-8',
            },
            Body: {
              Html: {
                Data: emailHtml,
                Charset: 'UTF-8',
              },
              Text: {
                Data: emailText,
                Charset: 'UTF-8',
              },
            },
          },
        },
      });

      console.log('📧 Sending email notification to:', recipientEmail);
      const sendResult = await sesClient.send(sendCommand);
      const messageId = sendResult.MessageId;

      console.log('✅ Email sent successfully:', messageId);

      // Mark email as sent
      await supabase
        .from('voice_agent_messages')
        .update({
          email_sent: true,
          email_sent_at: new Date().toISOString(),
        })
        .eq('id', message.id);
      
      console.log('✅ Email notification sent successfully:', {
        messageId,
        recipientEmail,
        subject,
      });
      
      // Log successful email
      await logVoiceAgentEvent(
        supabase,
        businessId,
        agentId,
        'email_sent',
        `Message notification email sent successfully to ${recipientEmail}`,
        { messageId: message.id, emailMessageId: messageId, recipientEmail, subject },
        'info',
        callId
      );

    } catch (emailError: any) {
      console.error('❌ Error sending email:', emailError);
      
      // Mark as failed with error details
      await supabase
        .from('voice_agent_messages')
        .update({
          email_sent: false,
          email_error: emailError?.message?.substring(0, 500) || 'Unknown error',
        })
        .eq('id', message.id);
      
      // Log email failure
      await logVoiceAgentEvent(
        supabase,
        businessId,
        agentId,
        'email_failed',
        `Failed to send message notification email: ${emailError?.message || 'Unknown error'}`,
        { messageId: message.id, error: emailError?.message, recipientEmail },
        'error',
        callId
      );

      // Store failed email for retry
      await storeFailedEmail(
        supabase,
        businessId,
        agentId,
        'message_notification',
        recipientEmail,
        subject,
        emailHtml,
        emailText,
        emailError?.message || 'Unknown error',
        { messageId: message.id, callerName: message.caller_name, callerPhone: message.caller_phone },
        callId,
        message.id
      );
    }
  } catch (error) {
    console.error('❌ Error sending message notification email:', error);
  }
}

// Send notification for new lead
async function sendNewLeadNotification(supabase: any, businessId: string, lead: any) {
  try {
    // Get configuration
    const { data: config } = await supabase
      .from('voice_agent_configurations')
      .select('notify_on_new_lead, notification_email, notification_sms')
      .eq('business_id', businessId)
      .single();

    if (!config?.notify_on_new_lead) return;

    // TODO: Integrate with Tavari SMS/email services
    // For now, just log
    console.log('New lead notification:', {
      businessId,
      leadId: lead.id,
      name: lead.name,
      phone: lead.phone,
      email: lead.email,
      notificationEmail: config.notification_email,
      notificationSms: config.notification_sms,
    });

    // In the future, call Tavari notification services here
  } catch (error) {
    console.error('Error sending lead notification:', error);
  }
}

// Send email notification for callback bookings
async function sendCallbackBookingEmail(
  supabase: any,
  businessId: string,
  agentId: string,
  booking: any
) {
  try {
    // Get agent and notification email
    const { data: agent } = await supabase
      .from('voice_agents')
      .select('name, message_notification_email')
      .eq('id', agentId)
      .single();

    // Get business info for email
    const { data: business } = await supabase
      .from('businesses')
      .select('name, business_email')
      .eq('id', businessId)
      .single();

    // Determine recipient email (agent setting takes priority, then business email)
    const recipientEmail = agent?.message_notification_email 
      || business?.business_email 
      || null;

    if (!recipientEmail) {
      console.error('❌ CRITICAL: No email configured for callback booking notifications:', {
        agentId,
        businessId,
        agentEmail: agent?.message_notification_email,
        businessEmail: business?.business_email,
      });
      // Don't silently fail - throw error so it's visible in logs
      throw new Error(`No email configured for callback notifications. Agent: ${agentId}, Business: ${businessId}`);
    }

    // Format date and time for display
    const bookingDate = new Date(booking.booking_date + 'T00:00:00');
    const formattedDate = bookingDate.toLocaleDateString('en-US', { 
      weekday: 'long', 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    });
    const [timeHour, timeMinute] = booking.booking_time.split(':');
    const hour12 = parseInt(timeHour) % 12 || 12;
    const ampm = parseInt(timeHour) >= 12 ? 'PM' : 'AM';
    const formattedTime = `${hour12}:${timeMinute} ${ampm}`;

    // Build email content
    const subject = `URGENT: New Callback Scheduled - ${booking.customer_name} - ${agent?.name || 'Voice Agent'}`;
    const emailHtml = `
      <html>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
          <h2 style="color: #2563eb;">New Callback Scheduled</h2>
          <div style="background: #f3f4f6; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <p><strong>Customer Name:</strong> ${booking.customer_name}</p>
            <p><strong>Customer Phone:</strong> <a href="tel:${booking.customer_phone}">${booking.customer_phone}</a></p>
            ${booking.customer_email ? `<p><strong>Customer Email:</strong> <a href="mailto:${booking.customer_email}">${booking.customer_email}</a></p>` : ''}
            <p><strong>Callback Scheduled For:</strong> ${formattedDate} at ${formattedTime}</p>
            <p><strong>Confirmation Code:</strong> ${booking.confirmation_code || 'N/A'}</p>
            ${booking.notes ? `<p><strong>Notes:</strong><br>${booking.notes.replace(/\n/g, '<br>')}</p>` : ''}
          </div>
          <p><strong>Agent:</strong> ${agent?.name || 'Voice Agent'}</p>
          <p><strong>Business:</strong> ${business?.name || 'Business'}</p>
          <p><strong>Time Scheduled:</strong> ${new Date().toLocaleString('en-US', { timeZone: 'America/Toronto' })}</p>
          <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;">
          <p style="color: #666; font-size: 12px;">Please call back the customer at ${booking.customer_phone} on ${formattedDate} at ${formattedTime}.</p>
        </body>
      </html>
    `;
    
    const emailText = `
New Callback Scheduled

Customer Name: ${booking.customer_name}
Customer Phone: ${booking.customer_phone}
${booking.customer_email ? `Customer Email: ${booking.customer_email}` : ''}
Callback Scheduled For: ${formattedDate} at ${formattedTime}
Confirmation Code: ${booking.confirmation_code || 'N/A'}
${booking.notes ? `Notes: ${booking.notes}` : ''}

Agent: ${agent?.name || 'Voice Agent'}
Business: ${business?.name || 'Business'}
Time Scheduled: ${new Date().toLocaleString('en-US', { timeZone: 'America/Toronto' })}

Please call back the customer at ${booking.customer_phone} on ${formattedDate} at ${formattedTime}.
    `.trim();

    // Send email directly using AWS SES
    try {
      const AWS_REGION = Deno.env.get('AWS_REGION') || 'us-east-1';
      const SES_ACCESS_KEY_ID = Deno.env.get('SES_ACCESS_KEY_ID');
      const SES_SECRET_ACCESS_KEY = Deno.env.get('SES_SECRET_ACCESS_KEY');

      if (!SES_ACCESS_KEY_ID || !SES_SECRET_ACCESS_KEY) {
        console.error('❌ CRITICAL: AWS SES credentials not configured. Email cannot be sent.');
        throw new Error('AWS SES credentials not configured. Please set SES_ACCESS_KEY_ID and SES_SECRET_ACCESS_KEY in Supabase Edge Function secrets.');
      }

      const sesClient = new SESv2Client({
        region: AWS_REGION,
        credentials: {
          accessKeyId: SES_ACCESS_KEY_ID,
          secretAccessKey: SES_SECRET_ACCESS_KEY,
        },
      });

      const fromEmail = business?.business_email || 'noreply@tavari.com';
      const fromName = business?.name || 'Tavari Voice Agent';

      const sendCommand = new SendEmailCommand({
        FromEmailAddress: fromEmail,
        Destination: {
          ToAddresses: [recipientEmail],
        },
        Content: {
          Simple: {
            Subject: {
              Data: subject,
              Charset: 'UTF-8',
            },
            Body: {
              Html: {
                Data: emailHtml,
                Charset: 'UTF-8',
              },
              Text: {
                Data: emailText,
                Charset: 'UTF-8',
              },
            },
          },
        },
      });

      console.log('📧 Sending callback booking email notification to:', recipientEmail);
      const sendResult = await sesClient.send(sendCommand);
      const messageId = sendResult.MessageId;

      console.log('✅ Callback booking email sent successfully:', {
        messageId,
        recipientEmail,
        subject,
        bookingId: booking.id,
      });
    } catch (emailError: any) {
      console.error('❌ Error sending callback booking email:', emailError);
      
      // Store failed email for retry
      await storeFailedEmail(
        supabase,
        businessId,
        agentId,
        'callback_booking',
        recipientEmail,
        subject,
        emailHtml,
        emailText,
        emailError?.message || 'Unknown error',
        { bookingId: booking.id, customerName: booking.customer_name, customerPhone: booking.customer_phone },
        null, // callId
        null, // messageId
        booking.id // bookingId
      );
      
      // Log the failure but don't fail the booking
      await logVoiceAgentEvent(
        supabase,
        businessId,
        agentId,
        'email_failed',
        `Failed to send callback booking email: ${emailError?.message || 'Unknown error'}`,
        { bookingId: booking.id, recipientEmail, error: emailError?.message },
        'error'
      );
      
      // Don't throw - booking was created successfully
    }
  } catch (error: any) {
    console.error('❌ Error in sendCallbackBookingEmail:', error);
  }
}

// Send issue report email when AI identifies problems or knowledge gaps
async function sendIssueReportEmail(
  supabase: any,
  businessId: string,
  agentId: string,
  issueData: {
    issue_type: string;
    description: string;
    caller_question?: string;
    suggested_fix?: string;
    confidence_level?: number;
    call_id?: string;
  }
) {
  try {
    // Get agent and notification email (can use separate issue_notification_email if configured)
    const { data: agent } = await supabase
      .from('voice_agents')
      .select('name, message_notification_email, issue_notification_email')
      .eq('id', agentId)
      .single();

    // Get business info for email
    const { data: business } = await supabase
      .from('businesses')
      .select('name, business_email')
      .eq('id', businessId)
      .single();

    // Determine recipient email (issue_notification_email takes priority, then message_notification_email, then business email)
    const recipientEmail = agent?.issue_notification_email
      || agent?.message_notification_email 
      || business?.business_email 
      || null;

    if (!recipientEmail) {
      console.warn('⚠️ No email configured for issue notifications:', {
        agentId,
        businessId,
        issueEmail: agent?.issue_notification_email,
        agentEmail: agent?.message_notification_email,
        businessEmail: business?.business_email,
      });
      return;
    }

    // Build email content
    const subject = `URGENT: AI Agent Issue Report - ${issueData.issue_type} - ${agent?.name || 'Voice Agent'}`;
    const emailHtml = `
      <html>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
          <h2 style="color: #dc2626;">AI Agent Issue Report</h2>
          <div style="background: #fee2e2; border-left: 4px solid #dc2626; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <p style="margin: 0 0 10px 0;"><strong>Issue Type:</strong> ${issueData.issue_type}</p>
            <p style="margin: 0 0 10px 0;"><strong>Description:</strong><br>${issueData.description.replace(/\n/g, '<br>')}</p>
            ${issueData.caller_question ? `<p style="margin: 0 0 10px 0;"><strong>Caller's Question:</strong><br>${issueData.caller_question.replace(/\n/g, '<br>')}</p>` : ''}
            ${issueData.confidence_level ? `<p style="margin: 0;"><strong>AI Confidence Level:</strong> ${issueData.confidence_level}%</p>` : ''}
          </div>
          ${issueData.suggested_fix ? `
          <div style="background: #fef3c7; border-left: 4px solid #f59e0b; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <p style="margin: 0 0 10px 0; font-weight: bold; color: #92400e;">💡 Suggested Fix:</p>
            <p style="margin: 0; color: #78350f;">${issueData.suggested_fix.replace(/\n/g, '<br>')}</p>
          </div>
          ` : ''}
          <div style="background: #f3f4f6; padding: 15px; border-radius: 8px; margin: 20px 0;">
            <p><strong>Agent:</strong> ${agent?.name || 'Voice Agent'}</p>
            <p><strong>Business:</strong> ${business?.name || 'Business'}</p>
            <p><strong>Time:</strong> ${new Date().toLocaleString('en-US', { timeZone: 'America/Toronto' })}</p>
          </div>
          <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;">
          <p style="color: #666; font-size: 12px;">This issue was automatically detected by the AI agent. Please review and update your FAQs, knowledge base, or agent configuration to address this issue.</p>
        </body>
      </html>
    `;
    
    const emailText = `
AI Agent Issue Report

Issue Type: ${issueData.issue_type}
Description: ${issueData.description}
${issueData.caller_question ? `Caller's Question: ${issueData.caller_question}` : ''}
${issueData.confidence_level ? `AI Confidence Level: ${issueData.confidence_level}%` : ''}

${issueData.suggested_fix ? `💡 Suggested Fix:\n${issueData.suggested_fix}\n` : ''}

Agent: ${agent?.name || 'Voice Agent'}
Business: ${business?.name || 'Business'}
Time: ${new Date().toLocaleString('en-US', { timeZone: 'America/Toronto' })}

This issue was automatically detected by the AI agent. Please review and update your FAQs, knowledge base, or agent configuration to address this issue.
    `.trim();

    // Send email directly using AWS SES
    try {
      const AWS_REGION = Deno.env.get('AWS_REGION') || 'us-east-1';
      const SES_ACCESS_KEY_ID = Deno.env.get('SES_ACCESS_KEY_ID');
      const SES_SECRET_ACCESS_KEY = Deno.env.get('SES_SECRET_ACCESS_KEY');

      if (!SES_ACCESS_KEY_ID || !SES_SECRET_ACCESS_KEY) {
        console.warn('⚠️ AWS SES credentials not configured. Issue report email will not be sent.');
        return;
      }

      const sesClient = new SESv2Client({
        region: AWS_REGION,
        credentials: {
          accessKeyId: SES_ACCESS_KEY_ID,
          secretAccessKey: SES_SECRET_ACCESS_KEY,
        },
      });

      const fromEmail = business?.business_email || 'noreply@tavari.com';
      const fromName = business?.name || 'Tavari Voice Agent';

      const sendCommand = new SendEmailCommand({
        FromEmailAddress: fromEmail,
        Destination: {
          ToAddresses: [recipientEmail],
        },
        Content: {
          Simple: {
            Subject: {
              Data: subject,
              Charset: 'UTF-8',
            },
            Body: {
              Html: {
                Data: emailHtml,
                Charset: 'UTF-8',
              },
              Text: {
                Data: emailText,
                Charset: 'UTF-8',
              },
            },
          },
        },
      });

      console.log('📧 Sending issue report email to:', recipientEmail);
      const sendResult = await sesClient.send(sendCommand);
      const messageId = sendResult.MessageId;

      console.log('✅ Issue report email sent successfully:', {
        messageId,
        recipientEmail,
        subject,
        issueType: issueData.issue_type,
      });
    } catch (emailError: any) {
      console.error('❌ Error sending issue report email:', emailError);
    }
  } catch (error: any) {
    console.error('❌ Error in sendIssueReportEmail:', error);
  }
}


