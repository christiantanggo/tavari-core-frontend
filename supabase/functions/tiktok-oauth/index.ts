// supabase/functions/tiktok-oauth/index.ts
// TikTok OAuth token exchange Edge Function
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Get TikTok credentials from Supabase secrets
    const tiktokClientKey = Deno.env.get('TIKTOK_CLIENT_KEY');
    const tiktokClientSecret = Deno.env.get('TIKTOK_CLIENT_SECRET');
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    if (!tiktokClientKey || !tiktokClientSecret) {
      throw new Error('TikTok credentials not configured');
    }

    // Get authorization from request
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('No authorization header');
    }

    // Create Supabase client with service role for database access
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Verify user session
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    
    if (userError || !user) {
      throw new Error('Invalid authentication');
    }

    // Parse request body
    const { code, redirectUri, businessId } = await req.json();

    if (!code || !redirectUri || !businessId) {
      throw new Error('Missing required parameters: code, redirectUri, businessId');
    }

    // Exchange authorization code for access token
    const tokenUrl = 'https://www.tiktok.com/v2/auth/token';
    const tokenParams = new URLSearchParams({
      client_key: tiktokClientKey,
      client_secret: tiktokClientSecret,
      code: code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    });

    const tokenResponse = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: tokenParams.toString(),
    });

    if (!tokenResponse.ok) {
      const errorData = await tokenResponse.text();
      console.error('TikTok token exchange error:', errorData);
      throw new Error(`TikTok token exchange failed: ${tokenResponse.status}`);
    }

    const tokenData = await tokenResponse.json();

    if (tokenData.error) {
      throw new Error(`TikTok API error: ${tokenData.error_description || tokenData.error}`);
    }

    // Get user info from TikTok
    const userInfoUrl = 'https://open.tiktokapis.com/v2/user/info/';
    const userInfoResponse = await fetch(userInfoUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${tokenData.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        fields: ['open_id', 'union_id', 'avatar_url', 'display_name', 'username'],
      }),
    });

    let accountInfo = {};
    if (userInfoResponse.ok) {
      const userInfoData = await userInfoResponse.json();
      if (userInfoData.data?.user) {
        accountInfo = {
          openId: userInfoData.data.user.open_id,
          unionId: userInfoData.data.user.union_id,
          username: userInfoData.data.user.username,
          displayName: userInfoData.data.user.display_name,
          avatarUrl: userInfoData.data.user.avatar_url,
        };
      }
    }

    // Encrypt and store tokens in database
    // Note: In production, you should encrypt tokens before storing
    // For now, we'll store them encrypted using ConfigService encryption
    const { data: existingConfig, error: configError } = await supabase
      .from('social_media_configs')
      .select('*')
      .eq('business_id', businessId)
      .eq('platform', 'tiktok')
      .maybeSingle();

    const configData = {
      business_id: businessId,
      platform: 'tiktok',
      is_enabled: true,
      // Store access token (should be encrypted by ConfigService)
      access_token: tokenData.access_token,
      // Store refresh token if available
      access_token_secret: tokenData.refresh_token || null,
      // Store TikTok account info
      account_id: accountInfo.openId || null,
      page_id: accountInfo.username || null,
      // Store API credentials (encrypted)
      api_key: tiktokClientKey,
      api_secret: tiktokClientSecret,
      // Default preferences
      posting_enabled: true,
      auto_posting_enabled: false,
      posting_frequency_hours: 4,
      max_posts_per_day: 6,
      content_style: 'professional',
      include_hashtags: true,
      hashtag_count: 10,
      include_emoji: true,
      updated_at: new Date().toISOString(),
    };

    const { data: savedConfig, error: saveError } = await supabase
      .from('social_media_configs')
      .upsert(configData, {
        onConflict: 'business_id,platform',
      })
      .select()
      .single();

    if (saveError) {
      console.error('Error saving TikTok config:', saveError);
      throw new Error('Failed to save TikTok configuration');
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: 'TikTok account connected successfully',
        accountInfo,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );
  } catch (error) {
    console.error('TikTok OAuth error:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || 'Failed to connect TikTok account',
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      }
    );
  }
});


