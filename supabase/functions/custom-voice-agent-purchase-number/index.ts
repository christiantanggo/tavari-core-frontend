// supabase/functions/custom-voice-agent-purchase-number/index.ts
// Purchase/order a phone number from Telnyx for custom voice agents
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Missing authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);

    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const requestBody = await req.json();
    const { phoneNumber, businessId } = requestBody;

    if (!phoneNumber || !businessId) {
      return new Response(
        JSON.stringify({ error: 'phoneNumber and businessId are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Verify user has access to business
    const { data: userRole, error: roleError } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .eq('business_id', businessId)
      .in('role', ['owner', 'manager', 'admin'])
      .single();

    if (roleError || !userRole) {
      return new Response(
        JSON.stringify({ error: 'Access denied to this business' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get Telnyx API key
    const telnyxApiKey = Deno.env.get('TELNYX_API_KEY');
    if (!telnyxApiKey) {
      return new Response(
        JSON.stringify({ error: 'Telnyx API key not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Format phone number
    let formattedNumber = phoneNumber.trim().replace(/\D/g, '');
    if (!formattedNumber.startsWith('+')) {
      formattedNumber = `+1${formattedNumber}`;
    } else if (!formattedNumber.startsWith('+1')) {
      formattedNumber = `+1${formattedNumber.replace('+', '')}`;
    }

    console.log('📞 Purchasing phone number for custom voice agent:', formattedNumber);

    // Order the phone number from Telnyx
    const telnyxResponse = await fetch('https://api.telnyx.com/v2/phone_numbers', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${telnyxApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        phone_number: formattedNumber,
      }),
    });

    if (!telnyxResponse.ok) {
      const errorText = await telnyxResponse.text();
      console.error('❌ Telnyx purchase error:', telnyxResponse.status, errorText);
      return new Response(
        JSON.stringify({
          error: 'Failed to purchase phone number',
          details: errorText.substring(0, 500),
        }),
        {
          status: telnyxResponse.status,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    const telnyxData = await telnyxResponse.json();
    const purchasedNumber = telnyxData?.data;

    console.log('✅ Phone number purchased:', purchasedNumber?.phone_number);

    return new Response(
      JSON.stringify({
        success: true,
        phone_number: purchasedNumber?.phone_number,
        telnyx_phone_number_id: purchasedNumber?.id,
        status: purchasedNumber?.status,
        message: 'Phone number purchased successfully',
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error: any) {
    console.error('❌ Error purchasing phone number:', error);
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

