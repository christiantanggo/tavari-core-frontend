// supabase/functions/custom-voice-agent-functions/index.ts
// Backend function endpoints for custom voice agents (send_email, send_sms, book_appointment, etc.)
// Called by OpenAI Realtime API function calling
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { SESv2Client, SendEmailCommand } from 'npm:@aws-sdk/client-sesv2@3.654.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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

    const payload = await req.json();
    const { function_name, parameters, business_id, agent_id, call_id } = payload;

    console.log(`🔧 Custom voice agent function call: ${function_name}`, parameters);

    let result: any = { success: false };

    switch (function_name) {
      case 'send_email':
        result = await handleSendEmail(supabase, parameters, business_id, agent_id, call_id);
        break;

      case 'send_sms':
        result = await handleSendSMS(supabase, parameters, business_id, agent_id, call_id);
        break;

      case 'book_appointment':
        result = await handleBookAppointment(supabase, parameters, business_id, agent_id, call_id);
        break;

      case 'take_message':
        result = await handleTakeMessage(supabase, parameters, business_id, agent_id, call_id);
        break;

      case 'capture_lead':
        result = await handleCaptureLead(supabase, parameters, business_id, agent_id, call_id);
        break;

      default:
        result = { success: false, error: `Unknown function: ${function_name}` };
    }

    // Log the function call
    await supabase
      .from('custom_voice_agent_logs')
      .insert({
        business_id,
        agent_id,
        call_id,
        log_type: 'function_call',
        message: `Function ${function_name} ${result.success ? 'succeeded' : 'failed'}`,
        details: { function_name, parameters, result },
        log_level: result.success ? 'info' : 'error',
      });

    return new Response(
      JSON.stringify(result),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error: any) {
    console.error('❌ Error in custom voice agent function:', error);
    return new Response(
      JSON.stringify({
        success: false,
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

async function handleSendEmail(
  supabase: any,
  parameters: any,
  businessId: string | null,
  agentId: string | null,
  callId: string | null
) {
  try {
    const { to, subject, body } = parameters;

    if (!to || !subject || !body) {
      return { success: false, error: 'Missing required fields: to, subject, body' };
    }

    // Get AWS SES credentials from environment (using Supabase Edge Function variable names)
    const awsAccessKeyId = Deno.env.get('SES_ACCESS_KEY_ID');
    const awsSecretAccessKey = Deno.env.get('SES_SECRET_ACCESS_KEY');
    const awsRegion = Deno.env.get('AWS_REGION') || 'us-east-1';
    const fromEmail = Deno.env.get('AWS_SES_FROM_EMAIL') || Deno.env.get('EMAIL_FROM_ADDRESS') || 'noreply@tavari.com';

    if (!awsAccessKeyId || !awsSecretAccessKey) {
      return { success: false, error: 'AWS SES credentials not configured. Please set SES_ACCESS_KEY_ID and SES_SECRET_ACCESS_KEY in Supabase Edge Function secrets.' };
    }

    const sesClient = new SESv2Client({
      region: awsRegion,
      credentials: {
        accessKeyId: awsAccessKeyId,
        secretAccessKey: awsSecretAccessKey,
      },
    });

    const command = new SendEmailCommand({
      FromEmailAddress: fromEmail,
      Destination: {
        ToAddresses: [to],
      },
      Content: {
        Simple: {
          Subject: { Data: subject },
          Body: {
            Text: { Data: body },
            Html: { Data: body.replace(/\n/g, '<br>') },
          },
        },
      },
    });

    const response = await sesClient.send(command);

    return {
      success: true,
      message_id: response.MessageId,
      message: 'Email sent successfully',
    };
  } catch (error: any) {
    console.error('Error sending email:', error);
    return { success: false, error: error.message };
  }
}

async function handleSendSMS(
  supabase: any,
  parameters: any,
  businessId: string | null,
  agentId: string | null,
  callId: string | null
) {
  try {
    const { to, message } = parameters;

    if (!to || !message) {
      return { success: false, error: 'Missing required fields: to, message' };
    }

    // Get Telnyx API key
    const telnyxApiKey = Deno.env.get('TELNYX_API_KEY');
    if (!telnyxApiKey) {
      return { success: false, error: 'Telnyx API key not configured' };
    }

    // Get agent's phone number for sending SMS
    let fromNumber = null;
    if (agentId) {
      const { data: agent } = await supabase
        .from('custom_voice_agents')
        .select('phone_number')
        .eq('id', agentId)
        .single();
      fromNumber = agent?.phone_number;
    }

    if (!fromNumber) {
      return { success: false, error: 'No phone number configured for agent' };
    }

    const response = await fetch('https://api.telnyx.com/v2/messages', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${telnyxApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: fromNumber,
        to: to,
        text: message,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(errorText);
    }

    const data = await response.json();

    return {
      success: true,
      message_id: data.data?.id,
      message: 'SMS sent successfully',
    };
  } catch (error: any) {
    console.error('Error sending SMS:', error);
    return { success: false, error: error.message };
  }
}

async function handleBookAppointment(
  supabase: any,
  parameters: any,
  businessId: string | null,
  agentId: string | null,
  callId: string | null
) {
  try {
    const { customer_name, customer_phone, customer_email, booking_date, booking_time, service_type, notes } = parameters;

    if (!customer_name || !customer_phone || !booking_date || !booking_time) {
      return { success: false, error: 'Missing required fields: customer_name, customer_phone, booking_date, booking_time' };
    }

    // Get max capacity configuration
    const { data: config } = await supabase
      .from('custom_voice_agent_configurations')
      .select('max_capacity_per_slot')
      .eq('business_id', businessId)
      .maybeSingle();

    const maxCapacity = config?.max_capacity_per_slot || 1;

    // Check current bookings for this time slot
    if (maxCapacity > 1) {
      const { data: existingBookings, error: checkError } = await supabase
        .from('voice_agent_bookings')
        .select('id')
        .eq('business_id', businessId)
        .eq('booking_date', booking_date)
        .eq('booking_time', booking_time)
        .neq('status', 'cancelled')
        .limit(maxCapacity + 1); // Get one extra to check if full

      if (checkError) {
        console.error('Error checking capacity:', checkError);
      } else if (existingBookings && existingBookings.length >= maxCapacity) {
        return {
          success: false,
          error: `This time slot is full (${existingBookings.length}/${maxCapacity} bookings). Please suggest an alternative time.`,
        };
      }
    }

    const { data, error } = await supabase
      .from('voice_agent_bookings')
      .insert({
        business_id: businessId,
        agent_id: agentId,
        call_id: callId,
        customer_name,
        customer_phone,
        customer_email: customer_email || null,
        booking_type: 'appointment',
        service_type: service_type || null,
        booking_date,
        booking_time,
        party_size: parameters.party_size || 1,
        duration_minutes: parameters.duration_minutes || 30,
        notes: notes || null,
        status: 'confirmed',
        confirmed_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) throw error;

    return {
      success: true,
      booking_id: data.id,
      message: 'Appointment booked successfully',
    };
  } catch (error: any) {
    console.error('Error booking appointment:', error);
    return { success: false, error: error.message };
  }
}

async function handleTakeMessage(
  supabase: any,
  parameters: any,
  businessId: string | null,
  agentId: string | null,
  callId: string | null
) {
  try {
    const { customer_name, customer_phone, customer_email, message, priority } = parameters;

    if (!customer_phone || !message) {
      return { success: false, error: 'Missing required fields: customer_phone, message' };
    }

    const { data, error } = await supabase
      .from('custom_voice_agent_messages')
      .insert({
        business_id: businessId,
        agent_id: agentId,
        call_id: callId,
        customer_name: customer_name || null,
        customer_phone,
        customer_email: customer_email || null,
        message,
        priority: priority || 'normal',
        status: 'new',
      })
      .select()
      .single();

    if (error) throw error;

    return {
      success: true,
      message_id: data.id,
      message: 'Message saved successfully',
    };
  } catch (error: any) {
    console.error('Error taking message:', error);
    return { success: false, error: error.message };
  }
}

async function handleCaptureLead(
  supabase: any,
  parameters: any,
  businessId: string | null,
  agentId: string | null,
  callId: string | null
) {
  try {
    const { name, phone, email, event_type, preferred_date, preferred_time, guest_count, notes } = parameters;

    if (!name || !phone) {
      return { success: false, error: 'Missing required fields: name, phone' };
    }

    const { data, error } = await supabase
      .from('custom_voice_agent_leads')
      .insert({
        business_id: businessId,
        agent_id: agentId,
        call_id: callId,
        name,
        phone,
        email: email || null,
        event_type: event_type || null,
        preferred_date: preferred_date || null,
        preferred_time: preferred_time || null,
        guest_count: guest_count || null,
        notes: notes || null,
        status: 'new',
      })
      .select()
      .single();

    if (error) throw error;

    return {
      success: true,
      lead_id: data.id,
      message: 'Lead captured successfully',
    };
  } catch (error: any) {
    console.error('Error capturing lead:', error);
    return { success: false, error: error.message };
  }
}

