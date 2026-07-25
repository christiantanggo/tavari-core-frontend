// supabase/functions/tiktok-webhook/index.ts
// TikTok Webhook Handler for receiving events from TikTok API
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
    // Only accept POST requests
    if (req.method !== 'POST') {
      return new Response(
        JSON.stringify({ error: 'Method not allowed' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 405 }
      );
    }

    // Get TikTok webhook secret from environment
    const webhookSecret = Deno.env.get('TIKTOK_WEBHOOK_SECRET');
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    if (!webhookSecret) {
      console.error('TikTok webhook secret not configured');
      return new Response(
        JSON.stringify({ error: 'Webhook secret not configured' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
      );
    }

    // Get request body and signature
    const body = await req.text();
    const signature = req.headers.get('X-TikTok-Signature') || req.headers.get('x-tiktok-signature');

    // Verify webhook signature (TikTok uses HMAC-SHA256)
    if (signature && webhookSecret) {
      // Import crypto for HMAC verification
      const encoder = new TextEncoder();
      const key = encoder.encode(webhookSecret);
      const data = encoder.encode(body);
      
      const cryptoKey = await crypto.subtle.importKey(
        'raw',
        key,
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
      );
      
      const signatureBuffer = await crypto.subtle.sign('HMAC', cryptoKey, data);
      const calculatedSignature = Array.from(new Uint8Array(signatureBuffer))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
      
      // Compare signatures (TikTok sends signature as hex string)
      const receivedSignature = signature.replace('sha256=', '').toLowerCase();
      if (calculatedSignature.toLowerCase() !== receivedSignature) {
        console.error('Invalid webhook signature');
        return new Response(
          JSON.stringify({ error: 'Invalid signature' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 401 }
        );
      }
    }

    // Parse webhook payload
    let payload: any;
    try {
      payload = JSON.parse(body);
    } catch (error) {
      console.error('Failed to parse webhook payload:', error);
      return new Response(
        JSON.stringify({ error: 'Invalid JSON payload' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      );
    }

    // Create Supabase client
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Handle different event types
    const eventType = payload.event || payload.event_type;
    const eventData = payload.data || payload;

    console.log('TikTok webhook event received:', eventType, eventData);

    switch (eventType) {
      case 'authorization.removed':
      case 'authorization_revoked':
        // User revoked access - update social_media_configs
        await handleAuthorizationRemoved(supabase, eventData);
        break;

      case 'video.upload':
      case 'video_upload':
        // Video upload status update
        await handleVideoUpload(supabase, eventData);
        break;

      case 'video.publish':
      case 'video_publish':
        // Video published
        await handleVideoPublish(supabase, eventData);
        break;

      case 'comment.create':
      case 'comment_create':
        // New comment on video
        await handleCommentCreate(supabase, eventData);
        break;

      default:
        console.log('Unhandled TikTok webhook event type:', eventType);
        // Log unknown events for debugging
        await supabase
          .from('social_media_webhook_logs')
          .insert({
            platform: 'tiktok',
            event_type: eventType,
            payload: payload,
            processed: false,
            created_at: new Date().toISOString(),
          })
          .catch(err => console.error('Failed to log webhook:', err));
    }

    // Always return 200 to acknowledge receipt
    return new Response(
      JSON.stringify({ success: true, message: 'Webhook received' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    );
  } catch (error) {
    console.error('TikTok webhook error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error', message: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});

/**
 * Handle authorization removed event
 * User revoked access to TikTok account
 */
async function handleAuthorizationRemoved(supabase: any, eventData: any) {
  try {
    const openId = eventData.open_id || eventData.openId || eventData.user_id;
    
    if (!openId) {
      console.error('No open_id in authorization removed event');
      return;
    }

    // Find and disable TikTok configs for this account
    const { data: configs, error } = await supabase
      .from('social_media_configs')
      .select('id, business_id, account_id')
      .eq('platform', 'tiktok')
      .eq('account_id', openId)
      .eq('is_enabled', true);

    if (error) {
      console.error('Error finding TikTok configs:', error);
      return;
    }

    // Disable all matching configs
    if (configs && configs.length > 0) {
      const configIds = configs.map(c => c.id);
      const { error: updateError } = await supabase
        .from('social_media_configs')
        .update({ 
          is_enabled: false,
          posting_enabled: false,
          updated_at: new Date().toISOString(),
        })
        .in('id', configIds);

      if (updateError) {
        console.error('Error disabling TikTok configs:', updateError);
      } else {
        console.log(`Disabled ${configs.length} TikTok config(s) for account ${openId}`);
      }
    }
  } catch (error) {
    console.error('Error handling authorization removed:', error);
  }
}

/**
 * Handle video upload event
 * Video upload status update
 */
async function handleVideoUpload(supabase: any, eventData: any) {
  try {
    const videoId = eventData.video_id || eventData.videoId;
    const status = eventData.status || eventData.upload_status;
    const businessId = eventData.business_id || eventData.businessId;

    if (!videoId) {
      console.error('No video_id in upload event');
      return;
    }

    // Update video status in your posts table or content_sources
    // This depends on your database schema
    console.log(`Video ${videoId} upload status: ${status} for business ${businessId}`);
    
    // You can add logic here to update your posts/content table
    // Example:
    // await supabase
    //   .from('social_media_posts')
    //   .update({ status, updated_at: new Date().toISOString() })
    //   .eq('external_id', videoId)
    //   .eq('platform', 'tiktok');
  } catch (error) {
    console.error('Error handling video upload:', error);
  }
}

/**
 * Handle video publish event
 * Video was successfully published
 */
async function handleVideoPublish(supabase: any, eventData: any) {
  try {
    const videoId = eventData.video_id || eventData.videoId;
    const videoUrl = eventData.video_url || eventData.videoUrl;
    const businessId = eventData.business_id || eventData.businessId;

    if (!videoId) {
      console.error('No video_id in publish event');
      return;
    }

    console.log(`Video ${videoId} published for business ${businessId}`);
    
    // Update post status to published
    // Example:
    // await supabase
    //   .from('social_media_posts')
    //   .update({ 
    //     status: 'published',
    //     published_url: videoUrl,
    //     published_at: new Date().toISOString(),
    //     updated_at: new Date().toISOString()
    //   })
    //   .eq('external_id', videoId)
    //   .eq('platform', 'tiktok');
  } catch (error) {
    console.error('Error handling video publish:', error);
  }
}

/**
 * Handle comment create event
 * New comment on a video
 */
async function handleCommentCreate(supabase: any, eventData: any) {
  try {
    const commentId = eventData.comment_id || eventData.commentId;
    const videoId = eventData.video_id || eventData.videoId;
    const text = eventData.text || eventData.comment_text;

    if (!commentId || !videoId) {
      console.error('Missing comment_id or video_id in comment event');
      return;
    }

    console.log(`New comment ${commentId} on video ${videoId}: ${text}`);
    
    // Store comment in database if needed
    // Example:
    // await supabase
    //   .from('social_media_comments')
    //   .insert({
    //     platform: 'tiktok',
    //     external_id: commentId,
    //     video_id: videoId,
    //     text: text,
    //     created_at: new Date().toISOString(),
    //   });
  } catch (error) {
    console.error('Error handling comment create:', error);
  }
}


