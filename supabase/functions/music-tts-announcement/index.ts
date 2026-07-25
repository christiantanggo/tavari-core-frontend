// Generate announcement audio from text using OpenAI TTS, upload to music-files, return path.
// POST body: { business_id, text, title?, voice? }
// Set OPENAI_API_KEY in Supabase Edge Function secrets.
// Deploy: supabase functions deploy music-tts-announcement

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

function corsResponse(body: string | null, status: number) {
  return new Response(body, {
    status,
    headers: { ...corsHeaders, ...(body ? { 'Content-Type': 'application/json' } : {}) }
  });
}

const VALID_VOICES = ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'] as const;
const MAX_TEXT_LENGTH = 4096;

serve(async (req: Request) => {
  try {
    if (req.method === 'OPTIONS') return corsResponse(null, 204);
    if (req.method !== 'POST') return corsResponse(JSON.stringify({ error: 'Method not allowed' }), 405);

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return corsResponse(JSON.stringify({ error: 'Unauthorized' }), 401);

    const body = (await req.json().catch(() => ({}))) as {
      business_id?: string;
      text?: string;
      title?: string;
      voice?: string;
    };

    const businessId = body?.business_id;
    const text = typeof body?.text === 'string' ? body.text.trim() : '';
    const voice = body?.voice && VALID_VOICES.includes(body.voice as (typeof VALID_VOICES)[number])
      ? (body.voice as (typeof VALID_VOICES)[number])
      : 'alloy';

    if (!businessId || !text) {
      return corsResponse(JSON.stringify({ error: 'business_id and text are required' }), 400);
    }
    if (text.length > MAX_TEXT_LENGTH) {
      return corsResponse(JSON.stringify({ error: `text must be ${MAX_TEXT_LENGTH} characters or less` }), 400);
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseAnon = Deno.env.get('SUPABASE_ANON_KEY')!;
    const supabaseService = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const openaiKey = Deno.env.get('OPENAI_API_KEY');
    if (!openaiKey) return corsResponse(JSON.stringify({ error: 'OpenAI TTS not configured' }), 503);

    const supabaseUser = createClient(supabaseUrl, supabaseAnon, {
      global: { headers: { Authorization: authHeader } }
    });

    const { data: bu, error: buErr } = await supabaseUser
      .from('business_users')
      .select('business_id')
      .eq('business_id', businessId)
      .limit(1)
      .single();
    if (buErr || !bu) {
      return corsResponse(JSON.stringify({ error: 'Access denied to this business' }), 403);
    }

    const res = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${openaiKey}`
      },
      body: JSON.stringify({
        model: 'tts-1',
        voice,
        input: text,
        response_format: 'mp3'
      })
    });

    if (!res.ok) {
      const err = await res.text();
      console.error('[music-tts-announcement] OpenAI TTS error:', res.status, err.slice(0, 300));
      return corsResponse(
        JSON.stringify({ error: 'TTS generation failed', detail: err.slice(0, 200) }),
        502
      );
    }

    const audioBytes = new Uint8Array(await res.arrayBuffer());
    const storagePath = `local-ads/${businessId}/${Date.now()}_tts.mp3`;

    const supabaseAdmin = createClient(supabaseUrl, supabaseService);
    const { error: uploadErr } = await supabaseAdmin.storage
      .from('music-files')
      .upload(storagePath, audioBytes, { contentType: 'audio/mpeg', upsert: false });

    if (uploadErr) {
      console.error('[music-tts-announcement] Storage upload error:', uploadErr);
      return corsResponse(JSON.stringify({ error: 'Failed to store audio' }), 500);
    }

    const durationSeconds = Math.max(5, Math.ceil(text.length / 12));

    return corsResponse(
      JSON.stringify({
        file_path: storagePath,
        duration_seconds: durationSeconds,
        title: body?.title?.trim() || 'AI announcement'
      }),
      200
    );
  } catch (e) {
    console.error('[music-tts-announcement]', e);
    return corsResponse(JSON.stringify({ error: 'Internal error' }), 500);
  }
});
