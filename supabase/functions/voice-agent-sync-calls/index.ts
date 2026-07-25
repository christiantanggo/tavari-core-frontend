// supabase/functions/voice-agent-sync-calls/index.ts
// Queries Vapi API directly for call data and syncs to database
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
    // Authentication
    const authHeader = req.headers.get('authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'No authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Verify user authentication
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);

    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: 'Invalid authentication' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Parse request body
    const requestBody = await req.json();
    const { businessId, agentId, days = 7 } = requestBody;

    if (!businessId) {
      return new Response(
        JSON.stringify({ error: 'businessId is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Verify user has access to this business
    const { data: userRole, error: roleError } = await supabase
      .from('user_roles')
      .select('business_id, role')
      .eq('user_id', user.id)
      .eq('business_id', businessId)
      .single();

    if (roleError || !userRole) {
      return new Response(
        JSON.stringify({ error: 'Access denied to this business' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get Vapi API key
    const vapiApiKey = Deno.env.get('VAPI_API_KEY');
    if (!vapiApiKey) {
      return new Response(
        JSON.stringify({ error: 'Vapi API key not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get all agents for this business (or specific agent if agentId provided)
    console.log(`🔍 Querying agents for business: ${businessId}${agentId ? `, agent: ${agentId}` : ''}`);
    
    let agentsQuery = supabase
      .from('voice_agents')
      .select('id, business_id, vapi_assistant_id, phone_number, name')
      .eq('business_id', businessId);

    if (agentId) {
      agentsQuery = agentsQuery.eq('id', agentId);
    }

    const { data: agents, error: agentsError } = await agentsQuery;

    if (agentsError) {
      console.error('❌ Error querying agents:', agentsError);
      return new Response(
        JSON.stringify({ 
          error: 'Failed to query agents', 
          details: agentsError.message || agentsError,
          code: agentsError.code,
          hint: 'Check if voice_agents table exists and RLS policies allow access.'
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`📋 Query result: Found ${agents?.length || 0} agent(s)`);
    if (agents && agents.length > 0) {
      console.log('✅ Agents found:', agents.map(a => ({ id: a.id, name: a.name, has_vapi_id: !!a.vapi_assistant_id })));
    }

    if (!agents || agents.length === 0) {
      console.log('⚠️ No agents found for business:', businessId);
      // Try to count total agents to provide better diagnostics
      const { count } = await supabase
        .from('voice_agents')
        .select('*', { count: 'exact', head: true });
      
      return new Response(
        JSON.stringify({ 
          error: 'No agents found',
          message: 'No voice agents found for this business. Please create an agent first before syncing calls.',
          businessId: businessId,
          agentId: agentId || 'all',
          totalAgentsInSystem: count || 0,
          suggestion: 'Go to the Agents tab and click "Create Agent" to set up your first voice agent.'
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`🔄 Syncing calls for ${agents.length} agent(s)...`);

    // Calculate date range (last N days)
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    const startDateISO = startDate.toISOString();

    let totalCallsSynced = 0;
    let totalCallsUpdated = 0;
    let errors: string[] = [];

    // Query Vapi API for each agent's calls
    for (const agent of agents) {
      if (!agent.vapi_assistant_id) {
        console.log(`⚠️ Agent ${agent.id} has no vapi_assistant_id, skipping...`);
        continue;
      }

      try {
        // Query Vapi API for calls
        // Vapi API: GET /call?assistantId={assistantId}&createdAt={date}
        const vapiUrl = new URL('https://api.vapi.ai/call');
        vapiUrl.searchParams.append('assistantId', agent.vapi_assistant_id);
        // Note: Vapi API might not support createdAt filter, so we'll fetch all and filter
        // Check Vapi docs for exact query params

        console.log(`📞 Fetching calls for agent ${agent.id} (assistant ${agent.vapi_assistant_id})...`);

        const vapiResponse = await fetch(vapiUrl.toString(), {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${vapiApiKey}`,
            'Content-Type': 'application/json',
          },
        });

        if (!vapiResponse.ok) {
          const errorText = await vapiResponse.text();
          console.error(`❌ Vapi API error for agent ${agent.id}:`, errorText);
          errors.push(`Agent ${agent.id}: ${vapiResponse.status} ${errorText}`);
          continue;
        }

        const vapiData = await vapiResponse.json();
        // Vapi API might return { data: [...] } or just an array
        const calls = Array.isArray(vapiData) ? vapiData : (vapiData?.data || []);

        console.log(`✅ Found ${calls.length} calls from Vapi API for agent ${agent.id}`);

        // Process each call
        for (const call of calls) {
          // Filter by date if call has createdAt
          if (call.createdAt) {
            const callDate = new Date(call.createdAt);
            if (callDate < startDate) {
              continue; // Skip calls older than our date range
            }
          }

          // Map Vapi call data to our database schema
          // Vapi API returns duration in seconds, but it might be in different formats
          let durationSeconds = null;
          if (call.duration) {
            // Duration might be in seconds (number) or as a string
            durationSeconds = typeof call.duration === 'number' ? call.duration : parseInt(call.duration);
          } else if (call.endedAt && call.startedAt) {
            // Calculate duration from timestamps if duration not provided
            const startTime = new Date(call.startedAt).getTime();
            const endTime = new Date(call.endedAt).getTime();
            durationSeconds = Math.floor((endTime - startTime) / 1000);
          }

          const callData: any = {
            business_id: agent.business_id,
            agent_id: agent.id,
            vapi_call_id: call.id,
            phone_number: call.customer?.number || call.phoneNumber || call.phone_number || call.from || null,
            direction: call.direction || 'inbound',
            status: call.status || (call.endedAt ? 'completed' : 'unknown'),
            started_at: call.startedAt ? new Date(call.startedAt).toISOString() : null,
            ended_at: call.endedAt ? new Date(call.endedAt).toISOString() : null,
            duration_seconds: durationSeconds,
            recording_url: call.recordingUrl || call.recording_url || call.recording?.url || null,
            transcript: call.transcript || call.summary || null,
            was_answered: durationSeconds > 0 || call.status === 'ended' || call.status === 'completed' || false,
            metadata: call, // Store full Vapi call object
            updated_at: new Date().toISOString(),
          };

          // Check if call already exists
          const { data: existingCall } = await supabase
            .from('voice_agent_calls')
            .select('id')
            .eq('vapi_call_id', call.id)
            .single();

          if (existingCall) {
            // Update existing call
            const { error: updateError } = await supabase
              .from('voice_agent_calls')
              .update(callData)
              .eq('id', existingCall.id);

            if (updateError) {
              console.error(`❌ Error updating call ${call.id}:`, updateError);
              errors.push(`Call ${call.id}: ${updateError.message}`);
            } else {
              totalCallsUpdated++;
            }
          } else {
            // Create new call record
            callData.created_at = call.createdAt 
              ? new Date(call.createdAt).toISOString() 
              : new Date().toISOString();

            const { error: insertError } = await supabase
              .from('voice_agent_calls')
              .insert(callData);

            if (insertError) {
              console.error(`❌ Error inserting call ${call.id}:`, insertError);
              errors.push(`Call ${call.id}: ${insertError.message}`);
            } else {
              totalCallsSynced++;
            }
          }
        }
      } catch (error) {
        console.error(`❌ Error processing agent ${agent.id}:`, error);
        errors.push(`Agent ${agent.id}: ${error.message || 'Unknown error'}`);
      }
    }

    console.log(`✅ Sync complete: ${totalCallsSynced} new calls, ${totalCallsUpdated} updated calls`);

    return new Response(
      JSON.stringify({
        success: true,
        message: `Synced ${totalCallsSynced} new calls, updated ${totalCallsUpdated} existing calls`,
        stats: {
          newCalls: totalCallsSynced,
          updatedCalls: totalCallsUpdated,
          errors: errors.length,
        },
        errors: errors.length > 0 ? errors : undefined,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );
  } catch (error) {
    console.error('❌ Error in voice-agent-sync-calls:', error);
    return new Response(
      JSON.stringify({
        error: error.message || 'Failed to sync calls',
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      }
    );
  }
});

