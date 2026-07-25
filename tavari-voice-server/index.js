// tavari-voice-server/index.js
// Tavari Voice Server - Programmable Voice (NOT Call Control) for Canadian numbers
import express from 'express';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import axios from 'axios';
import OpenAI from 'openai';
import { getFunctionDefinitions, handleFunctionCall } from './functionHandler.js';

dotenv.config();

const PORT = process.env.PORT || 3000;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const TELNYX_API_KEY = process.env.TELNYX_API_KEY;
const SERVER_URL = process.env.SERVER_URL || process.env.TAVARI_VOICE_SERVER_URL || `http://localhost:${PORT}`;

// Validate required environment variables
if (!SUPABASE_URL) {
  console.error('❌ ERROR: SUPABASE_URL environment variable is required');
  process.exit(1);
}
if (!SUPABASE_SERVICE_KEY) {
  console.error('❌ ERROR: SUPABASE_SERVICE_ROLE_KEY environment variable is required');
  process.exit(1);
}
if (!OPENAI_API_KEY) {
  console.error('❌ ERROR: OPENAI_API_KEY environment variable is required');
  process.exit(1);
}
if (!TELNYX_API_KEY) {
  console.error('❌ ERROR: TELNYX_API_KEY environment variable is required');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

// Store active call sessions
const activeSessions = new Map();

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true })); // For Telnyx webhook form data

// Health check route (REQUIRED for Railway/AWS)
app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

// Root route
app.get('/', (req, res) => {
  res.json({ 
    service: 'Tavari Voice Server',
    status: 'running',
    mode: 'Programmable Voice',
    timestamp: new Date().toISOString()
  });
});

// Programmable Voice webhook - handles incoming calls
app.post('/webhook/telnyx', handleProgrammableVoiceWebhook);
app.post('/telnyx-webhook', handleProgrammableVoiceWebhook);

async function handleProgrammableVoiceWebhook(req, res) {
  try {
    // Telnyx Programmable Voice sends form-encoded data
    const payload = req.body;
    
    // Log full payload for debugging
    console.log('📞 Full webhook payload:', JSON.stringify(payload, null, 2));
    
    // Handle different webhook formats
    const eventType = payload?.event_type || payload?.event || payload?.type;
    const callId = payload?.call_id || payload?.callId || payload?.call_session_id;
    const fromNumber = payload?.from || payload?.from_number || payload?.caller_id_number;
    const toNumber = payload?.to || payload?.to_number || payload?.called_number;
    const direction = payload?.direction || 'inbound';

    console.log(`📞 Programmable Voice webhook: ${eventType} for call ${callId}`);
    console.log(`   From: ${fromNumber}, To: ${toNumber}`);

    // Handle incoming call - Telnyx Programmable Voice sends this on call initiation
    // The webhook is called when call comes in, we respond with XML
    if (!eventType || eventType === 'call.initiated' || direction === 'inbound') {
      console.log(`📞 Incoming call: ${fromNumber} -> ${toNumber}`);
      
      // Find agent by phone number
      let agent = null;
      if (toNumber) {
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
      }

      if (!agent) {
        console.log(`⚠️ No agent found for phone number: ${toNumber}`);
        // Still answer the call but with default message
        const xmlResponse = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="female">Sorry, no agent is configured for this number.</Say>
  <Hangup/>
</Response>`;
        console.log(`📤 Sending XML response (no agent)`);
        return res.type('application/xml').send(xmlResponse);
      }

      // Start call session (async, don't wait)
      startCallSession(agent, callId || toNumber, payload).catch(err => {
        console.error('Error starting session:', err);
      });

      // Get greeting message
      const greeting = agent.first_message || 'Hello, thank you for calling. How can I help you today?';

      // Escape XML special characters in greeting
      const escapedGreeting = greeting
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');

      // Respond with XML to answer call and play greeting
      // For now, use <Say> for TTS, streaming can be added later
      const xmlResponse = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="female">${escapedGreeting}</Say>
</Response>`;

      console.log(`✅ Responding with XML for call ${callId || toNumber}`);
      console.log(`📤 XML Response:`, xmlResponse);
      return res.type('application/xml').send(xmlResponse);
    }

    // Handle call status updates
    if (eventType === 'voice_call.answered' || eventType === 'call.answered') {
      console.log(`✅ Call answered: ${callId}`);
      const session = activeSessions.get(callId);
      if (session) {
        session.status = 'answered';
      }
    }

    // Handle call hangup
    if (eventType === 'voice_call.hangup' || eventType === 'call.hangup') {
      console.log(`🔚 Call hangup: ${callId}`);
      activeSessions.delete(callId);
    }

    // Return empty response for other events
    res.status(200).send('');
  } catch (error) {
    console.error('Error handling Programmable Voice webhook:', error);
    res.status(500).send('Error');
  }
}

// Audio stream endpoint - receives audio from Telnyx
app.post('/stream/:callId', async (req, res) => {
  const callId = req.params.callId;
  console.log(`🎵 Audio stream received for call ${callId}`);

  // Set up streaming response
  res.setHeader('Content-Type', 'audio/x-raw');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const session = activeSessions.get(callId);
  if (!session) {
    console.log(`⚠️ No session found for stream: ${callId}`);
    return res.status(404).send('Session not found');
  }

  // Handle incoming audio stream
  // Note: This is a simplified version - in production you'd need proper audio processing
  // For now, we'll use a different approach: webhook-based transcription
  
  res.status(200).send('');
});

// Webhook for stream events (when Telnyx sends transcription)
app.post('/stream-event/:callId', async (req, res) => {
  const callId = req.params.callId;
  const payload = req.body;
  
  console.log(`📝 Stream event for call ${callId}:`, payload);

  const session = activeSessions.get(callId);
  if (session && session.messages) {
    // Extract transcript from stream event
    const transcript = payload?.transcript || payload?.text || payload?.data?.transcript;
    
    if (transcript && transcript.trim()) {
      console.log(`📝 Transcript from stream: "${transcript}"`);
      
      // Process user speech
      if (!session.isSpeaking) {
        await processUserSpeech(callId, transcript.trim(), session);
      }
    }
  }

  res.status(200).send('');
});

// Start a new call session
async function startCallSession(agent, callId, telnyxPayload) {
  try {
    console.log(`🚀 Starting call session for agent ${agent.id}, call ${callId}`);

    // Create call record in database
    const { data: callRecord } = await supabase
      .from('custom_voice_agent_calls')
      .insert({
        business_id: agent.business_id,
        agent_id: agent.id,
        telnyx_call_id: callId,
        phone_number: telnyxPayload?.from || telnyxPayload?.from_number,
        direction: 'inbound',
        status: 'ringing',
        metadata: telnyxPayload,
      })
      .select()
      .single();

    // Load knowledge base for the agent
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

    // Build system prompt with knowledge base
    let systemPrompt = agent.system_prompt || '';
    if (knowledgeBase?.knowledge_base_text) {
      systemPrompt += `\n\nKnowledge Base:\n${knowledgeBase.knowledge_base_text}`;
    }
    if (faqs && faqs.length > 0) {
      const faqText = faqs.map(f => `Q: ${f.question}\nA: ${f.answer}`).join('\n\n');
      systemPrompt += `\n\nFAQs:\n${faqText}`;
    }
    
    // Add booking instructions (for function calling)
    systemPrompt += `\n\nIMPORTANT: When a caller wants to book an appointment, make a reservation, or schedule something, you MUST use the book_appointment function. Collect the customer's name, phone number, preferred date and time, and any other relevant details, then call the book_appointment function to save it to the calendar. Always confirm the booking details with the caller before calling the function.`;

    // Store session
    activeSessions.set(callId, {
      agent,
      callRecord,
      callId,
      systemPrompt,
      messages: [{ role: 'assistant', content: agent.first_message || 'Hello, thank you for calling. How can I help you today?' }],
      startedAt: new Date(),
      isSpeaking: false,
      status: 'active',
    });

    console.log(`✅ Call session started: ${callId}`);
  } catch (error) {
    console.error('Error starting call session:', error);
  }
}

// Process user speech with AI
async function processUserSpeech(callId, userText, session) {
  try {
    console.log(`\n👤 PROCESSING USER SPEECH`);
    console.log(`User said: "${userText}"`);

    // Add user message to conversation
    session.messages.push({ role: 'user', content: userText });

    // Get AI response from OpenAI with function calling
    console.log(`🤖 Getting AI response...`);
    let completion = await openai.chat.completions.create({
      model: session.agent.model_name || 'gpt-4o-mini',
      messages: [
        { role: 'system', content: session.systemPrompt },
        ...session.messages,
      ],
      temperature: session.agent.temperature || 0.7,
      max_tokens: session.agent.max_tokens || 250,
      tools: getFunctionDefinitions(),
      tool_choice: 'auto',
    });

    const message = completion.choices[0]?.message;
    
    // Check if AI wants to call a function
    if (message.tool_calls && message.tool_calls.length > 0) {
      console.log(`🔧 AI wants to call function: ${message.tool_calls[0].function.name}`);
      
      // Handle function calls
      for (const toolCall of message.tool_calls) {
        const functionResult = await handleFunctionCall(toolCall, session);
        console.log(`📅 Function result:`, functionResult);
        
        // Add function call and result to conversation
        session.messages.push({
          role: 'assistant',
          content: null,
          tool_calls: [toolCall]
        });
        
        session.messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify(functionResult)
        });
        
        // Get AI's response to the function result (NO tools on second call to prevent loops)
        completion = await openai.chat.completions.create({
          model: session.agent.model_name || 'gpt-4o-mini',
          messages: [
            { role: 'system', content: session.systemPrompt },
            ...session.messages,
          ],
          temperature: session.agent.temperature || 0.7,
          max_tokens: session.agent.max_tokens || 250,
        });
      }
    }

    const aiResponse = completion.choices[0]?.message?.content || 'I apologize, I did not understand that.';
    console.log(`🤖 AI response: "${aiResponse}"`);

    // Add AI response to conversation
    session.messages.push({ role: 'assistant', content: aiResponse });

    // Speak the response using Telnyx Programmable Voice
    await speakToCaller(callId, aiResponse, session);

  } catch (error) {
    console.error('❌ Error processing user speech:', error);
    console.error('Stack:', error.stack);
    await speakToCaller(callId, 'I apologize, I encountered an error. Please try again.', session);
  }
}

// Speak text to caller using Telnyx Programmable Voice
async function speakToCaller(callId, text, session) {
  if (!text || !text.trim()) {
    return;
  }
  
  if (session) {
    session.isSpeaking = true;
  }
  
  try {
    // Use Telnyx Programmable Voice API to send audio
    // Generate TTS audio with OpenAI
    const audioResponse = await openai.audio.speech.create({
      model: 'tts-1',
      voice: 'alloy',
      input: text,
      response_format: 'mp3',
    });
    
    const audioBuffer = Buffer.from(await audioResponse.arrayBuffer());
    
    // Upload audio to a temporary URL or use Telnyx TTS
    // For now, use Telnyx Programmable Voice <Say> command via API
    // This requires making a call update request
    
    // Alternative: Use Telnyx TTS API if available
    // Or stream audio directly to the call
    
    console.log(`✅ Generated TTS for: "${text.substring(0, 50)}..."`);
    
    // For Programmable Voice, we need to send XML with <Say> or stream audio
    // This is a simplified version - you may need to adjust based on your Telnyx setup
    
    // Wait a bit then mark as not speaking
    setTimeout(() => {
      if (session) {
        session.isSpeaking = false;
      }
    }, 3000);
    
  } catch (error) {
    console.error('Error speaking:', error.response?.data || error.message);
    if (session) {
      session.isSpeaking = false;
    }
  }
}

// Start HTTP server
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Tavari Voice Server running on port ${PORT}`);
  console.log(`🔗 Webhook: POST /webhook/telnyx or /telnyx-webhook`);
  console.log(`🎵 Stream: POST /stream/:callId`);
  console.log(`💚 Health: GET /health`);
  console.log(`📡 Mode: Programmable Voice (NOT Call Control)`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  server.close(() => {
    process.exit(0);
  });
});
