// supabase/functions/custom-voice-agent-search-numbers/index.ts
// Search available phone numbers from Telnyx API for custom voice agents
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
    const { areaCode, state, countryCode = 'US', limit = 5 } = requestBody;

    if (!areaCode && !state) {
      return new Response(
        JSON.stringify({ error: 'Either areaCode or state is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get Telnyx API key from business configuration or env
    const telnyxApiKey = Deno.env.get('TELNYX_API_KEY');
    if (!telnyxApiKey) {
      return new Response(
        JSON.stringify({ error: 'Telnyx API key not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const params = new URLSearchParams();
    params.append('filter[country_code]', countryCode);
    params.append('page[size]', limit.toString());

    if (areaCode && areaCode.length === 3) {
      params.append('filter[nxx]', areaCode);
    }

    if (state) {
      params.append('filter[administrative_area]', state);
    }

    const telnyxUrl = `https://api.telnyx.com/v2/available_phone_numbers?${params.toString()}`;
    
    console.log('🔍 Searching Telnyx for available numbers:', telnyxUrl);

    const telnyxResponse = await fetch(telnyxUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${telnyxApiKey}`,
        'Content-Type': 'application/json',
      },
    });

    if (!telnyxResponse.ok) {
      const errorText = await telnyxResponse.text();
      console.error('❌ Telnyx API error:', telnyxResponse.status, errorText);
      return new Response(
        JSON.stringify({ 
          error: 'Failed to search phone numbers', 
          details: errorText.substring(0, 500) 
        }),
        { status: telnyxResponse.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const telnyxData = await telnyxResponse.json();
    const availableNumbers = telnyxData?.data || [];

    const formattedNumbers = availableNumbers.slice(0, limit).map((num: any) => ({
      phone_number: num.phone_number,
      region_information: num.region_information,
      features: num.features || [],
      cost: {
        monthly: '15.00',
        setup: '0.00',
      },
    }));

    console.log(`✅ Found ${formattedNumbers.length} available numbers`);

    return new Response(
      JSON.stringify({
        success: true,
        numbers: formattedNumbers,
        search_criteria: { areaCode, state, countryCode },
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error: any) {
    console.error('❌ Error searching phone numbers:', error);
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

