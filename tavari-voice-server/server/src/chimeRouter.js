// chimeRouter.js
// AWS Chime SIP Media App event handlers

import { createClient } from '@supabase/supabase-js';
import { 
  startSession, 
  getSession, 
  endSession, 
  addMessage 
} from './sessionManager.js';
import { 
  decodeBase64PCM, 
  formatChimeAnswerResponse, 
  formatChimeSpeakResponse,
  formatChimeContinueResponse,
  formatChimeEndResponse 
} from './audioUtils.js';
import { initializeOpenAISession, sendAudioToOpenAI } from './openaiRealtime.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = SUPABASE_URL && SUPABASE_SERVICE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
  : null;

// Store audio ready callbacks
const audioReadyCallbacks = new Map();

// Store audio buffers per call
const audioBuffers = new Map();

/**
 * Handle AWS Chime SIP Media App webhook
 * @param {object} req - Express request
 * @param {object} res - Express response
 */
export async function handleChimeWebhook(req, res) {
  try {
    const event = req.body;
    const eventType = event.EventType;
    const callId = event.CallId;
    const fromNumber = event.FromNumber;
    const toNumber = event.ToNumber;

    console.log(`📞 Chime event: ${eventType} for call ${callId}`);

    switch (eventType) {
      case 'CALL_RECEIVED':
        return await handleCallReceived(callId, fromNumber, toNumber, res);

      case 'CALL_ANSWERED':
        return await handleCallAnswered(callId, res);

      case 'AUDIO_RECEIVED':
        return await handleAudioReceived(callId, event.AudioChunk, res);

      case 'CALL_ENDED':
        return await handleCallEnded(callId, res);

      default:
        console.log(`⚠️ Unknown event type: ${eventType}`);
        return res.status(200).json(formatChimeContinueResponse());
    }
  } catch (error) {
    console.error('❌ Error handling Chime webhook:', error);
    return res.status(500).json({
      SchemaVersion: '1.0',
      Actions: [{ Type: 'End' }]
    });
  }
}

/**
 * Handle CALL_RECEIVED event
 */
async function handleCallReceived(callId, fromNumber, toNumber, res) {
  console.log(`📞 Call received: ${fromNumber} -> ${toNumber}`);

  // Find agent by phone number
  let agent = null;
  if (toNumber && supabase) {
    try {
      const { data: agents, error } = await supabase
        .from('custom_voice_agents')
        .select('*')
        .eq('phone_number', toNumber)
        .eq('is_active', true)
        .limit(1);

      agent = agents && agents.length > 0 ? agents[0] : null;

      if (error) {
        console.error('Error finding agent:', error);
      }
    } catch (error) {
      console.error('Supabase error:', error);
    }
  }

  if (!agent) {
    console.log(`⚠️ No agent found for phone number: ${toNumber}`);
    return res.status(200).json({
      SchemaVersion: '1.0',
      Actions: [
        {
          Type: 'Speak',
          Parameters: {
            Audio: '' // Empty audio - will end call
          }
        },
        { Type: 'End' }
      ]
    });
  }

  // Load knowledge base and FAQs
  let systemPrompt = agent.system_prompt || '';
  
  if (supabase) {
    try {
      const { data: knowledgeBase } = await supabase
        .from('custom_voice_agent_knowledge_base')
        .select('*')
        .eq('business_id', agent.business_id)
        .single();

      const { data: faqs } = await supabase
        .from('custom_voice_agent_faqs')
        .select('*')
        .eq('business_id', agent.business_id)
        .is('agent_id', null)
        .eq('is_active', true)
        .order('display_order', { ascending: true });

      if (knowledgeBase?.knowledge_base_text) {
        systemPrompt += `\n\nKnowledge Base:\n${knowledgeBase.knowledge_base_text}`;
      }
      if (faqs && faqs.length > 0) {
        const faqText = faqs.map(f => `Q: ${f.question}\nA: ${f.answer}`).join('\n\n');
        systemPrompt += `\n\nFAQs:\n${faqText}`;
      }
    } catch (error) {
      console.error('Error loading knowledge base:', error);
    }
  }

  // Add booking instructions
  systemPrompt += `\n\nIMPORTANT: When a caller wants to book an appointment, make a reservation, or schedule something, you MUST use the book_appointment function. Collect the customer's name, phone number, preferred date and time, and any other relevant details, then call the book_appointment function to save it to the calendar. Always confirm the booking details with the caller before calling the function.`;

  // Create call record
  let callRecord = null;
  if (supabase) {
    try {
      const { data } = await supabase
        .from('custom_voice_agent_calls')
        .insert({
          business_id: agent.business_id,
          agent_id: agent.id,
          telnyx_call_id: callId, // Reusing field name
          phone_number: fromNumber,
          direction: 'inbound',
          status: 'ringing',
          metadata: { from: fromNumber, to: toNumber },
        })
        .select()
        .single();

      callRecord = data;
    } catch (error) {
      console.error('Error creating call record:', error);
    }
  }

  // Start session
  const session = startSession(callId, agent, systemPrompt);
  session.callRecord = callRecord;

  // Set up audio ready callback
  audioReadyCallbacks.set(callId, (base64Audio) => {
    // This will be called when OpenAI audio is ready
    // We'll handle it in handleAudioReceived
  });

  // Return Answer action
  return res.status(200).json(formatChimeAnswerResponse());
}

/**
 * Handle CALL_ANSWERED event
 */
async function handleCallAnswered(callId, res) {
  console.log(`✅ Call answered: ${callId}`);

  const session = getSession(callId);
  if (!session) {
    console.log(`⚠️ No session found for call: ${callId}`);
    return res.status(200).json(formatChimeEndResponse());
  }

  // Update call status
  if (supabase && session.callRecord) {
    try {
      await supabase
        .from('custom_voice_agent_calls')
        .update({ status: 'in_progress' })
        .eq('id', session.callRecord.id);
    } catch (error) {
      console.error('Error updating call status:', error);
    }
  }

  // Initialize OpenAI Realtime session
  try {
    // Set up audio ready callback before initializing
    audioReadyCallbacks.set(callId, (base64Audio) => {
      // Store audio for next AUDIO_RECEIVED response
      if (!audioBuffers.has(callId)) {
        audioBuffers.set(callId, []);
      }
      audioBuffers.get(callId).push(base64Audio);
    });

    await initializeOpenAISession(callId, session.systemPrompt, (callId, base64Audio) => {
      // Call the stored callback
      const callback = audioReadyCallbacks.get(callId);
      if (callback) {
        callback(base64Audio);
      }
    });

    // Return Continue to wait for audio
    return res.status(200).json(formatChimeContinueResponse());
  } catch (error) {
    console.error(`❌ Error initializing OpenAI session for ${callId}:`, error);
    return res.status(200).json(formatChimeEndResponse());
  }
}

/**
 * Handle AUDIO_RECEIVED event
 */
async function handleAudioReceived(callId, audioChunk, res) {
  const session = getSession(callId);
  if (!session) {
    return res.status(200).json(formatChimeContinueResponse());
  }

  // Decode incoming audio
  if (audioChunk) {
    const audioBuffer = decodeBase64PCM(audioChunk);
    
    // Send to OpenAI
    sendAudioToOpenAI(callId, audioBuffer);
  }

  // Check if we have AI audio ready
  if (audioBuffers.has(callId) && audioBuffers.get(callId).length > 0) {
    const aiAudio = audioBuffers.get(callId).shift();
    
    // Return Speak action with AI audio
    return res.status(200).json(formatChimeSpeakResponse(aiAudio));
  }

  // No AI audio yet, continue
  return res.status(200).json(formatChimeContinueResponse());
}

/**
 * Handle CALL_ENDED event
 */
async function handleCallEnded(callId, res) {
  console.log(`🔚 Call ended: ${callId}`);

  const session = getSession(callId);
  if (session && session.callRecord && supabase) {
    try {
      const duration = (new Date() - session.startedAt) / 1000;
      
      await supabase
        .from('custom_voice_agent_calls')
        .update({
          status: 'ended',
          ended_at: new Date().toISOString(),
          duration_seconds: Math.floor(duration),
          was_answered: true,
        })
        .eq('id', session.callRecord.id);
    } catch (error) {
      console.error('Error updating call record:', error);
    }
  }

  // Cleanup
  endSession(callId);
  audioBuffers.delete(callId);
  audioReadyCallbacks.delete(callId);

  return res.status(200).json(formatChimeEndResponse());
}

