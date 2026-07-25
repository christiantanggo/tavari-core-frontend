// supabase/functions/custom-voice-agent-webhook/index.ts
// Handles Telnyx webhooks for custom voice agents (call events, media streams)
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Logging helper
async function logCustomVoiceAgentEvent(
  supabase: any,
  businessId: string | null,
  agentId: string | null,
  logType: string,
  message: string,
  details: any = null,
  logLevel: 'info' | 'warning' | 'error' | 'debug' = 'info',
  callId: string | null = null
) {
  const logPrefix = `[${logLevel.toUpperCase()}] [${logType}]`;
  console.log(`${logPrefix} ${message}`);
  if (details) {
    console.log(`${logPrefix} Details:`, JSON.stringify(details, null, 2));
  }

  try {
    const logEntry = {
      business_id: businessId,
      agent_id: agentId,
      call_id: callId,
      log_type: logType,
      message: message.substring(0, 500),
      details: details ? JSON.stringify(details).substring(0, 5000) : null,
      log_level: logLevel,
      created_at: new Date().toISOString(),
    };

    const { error } = await supabase
      .from('custom_voice_agent_logs')
      .insert(logEntry);

    if (error) {
      console.error('❌ Failed to log event to database:', error);
    }
  } catch (error: any) {
    console.error('❌ Error in logCustomVoiceAgentEvent:', error);
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    // Parse webhook payload from Telnyx
    const payload = await req.json();
    console.log('📞 Custom voice agent webhook received:', JSON.stringify(payload, null, 2));
    
    const eventType = payload?.data?.event_type || payload?.event_type || 'unknown';
    const callId = payload?.data?.payload?.call_control_id || payload?.call_control_id || null;
    const phoneNumber = payload?.data?.payload?.to || payload?.to || null;
    const fromNumber = payload?.data?.payload?.from || payload?.from || null;

    // Find the agent by phone number
    let agentId = null;
    let businessId = null;

    if (phoneNumber) {
      const { data: agent } = await supabase
        .from('custom_voice_agents')
        .select('id, business_id')
        .eq('phone_number', phoneNumber)
        .eq('is_active', true)
        .single();

      if (agent) {
        agentId = agent.id;
        businessId = agent.business_id;
      }
    }

    // Handle different event types
    switch (eventType) {
      case 'call.initiated':
      case 'call.answered':
      case 'call.hangup':
      case 'call.machine.detection.ended':
        // Create or update call record
        if (callId && businessId && agentId) {
          const callData = {
            business_id: businessId,
            agent_id: agentId,
            telnyx_call_id: callId,
            phone_number: fromNumber,
            direction: 'inbound',
            status: eventType === 'call.initiated' ? 'queued' : 
                   eventType === 'call.answered' ? 'in-progress' :
                   eventType === 'call.hangup' ? 'completed' : 'ringing',
            started_at: eventType === 'call.answered' ? new Date().toISOString() : null,
            ended_at: eventType === 'call.hangup' ? new Date().toISOString() : null,
            metadata: payload,
          };

          await supabase
            .from('custom_voice_agent_calls')
            .upsert(callData, { onConflict: 'telnyx_call_id' });

          await logCustomVoiceAgentEvent(
            supabase,
            businessId,
            agentId,
            'call_event',
            `Call ${eventType}: ${fromNumber}`,
            { eventType, callId, phoneNumber },
            'info',
            callId
          );
        }
        break;

      case 'call.recording.saved':
        // Update call with recording URL
        if (callId) {
          const recordingUrl = payload?.data?.payload?.recording_urls?.mp3 || 
                             payload?.recording_urls?.mp3 || null;
          
          if (recordingUrl) {
            await supabase
              .from('custom_voice_agent_calls')
              .update({ recording_url: recordingUrl })
              .eq('telnyx_call_id', callId);
          }
        }
        break;

      default:
        await logCustomVoiceAgentEvent(
          supabase,
          businessId,
          agentId,
          'webhook_event',
          `Unhandled event: ${eventType}`,
          payload,
          'info',
          callId
        );
    }

    return new Response(
      JSON.stringify({ success: true, received: true }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error: any) {
    console.error('❌ Error processing custom voice agent webhook:', error);
    return new Response(
      JSON.stringify({
        error: 'Internal server error',
        message: error.message,
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});

