// AWS Lambda handler for Tavari Voice Agent
// Handles Amazon Connect calls and integrates with OpenAI

import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import axios from 'axios';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// Initialize clients
const supabase = SUPABASE_URL && SUPABASE_SERVICE_KEY 
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
  : null;
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

// Store active sessions (in production, use DynamoDB)
const activeSessions = new Map();

/**
 * Main Lambda handler for Amazon Connect
 * Receives events from Connect Contact Flow
 */
export const handler = async (event) => {
  console.log('📞 Lambda received event:', JSON.stringify(event, null, 2));

  try {
    // Extract Connect event data
    const connectEvent = event.Details || event;
    const contactId = connectEvent.ContactId || connectEvent.contactId;
    const phoneNumber = connectEvent.CustomerEndpoint?.Address || connectEvent.calledNumber;
    const callerNumber = connectEvent.SystemEndpoint?.Address || connectEvent.callerNumber;
    const action = connectEvent.InvocationEventType || connectEvent.action;
    
    console.log(`📞 Contact ID: ${contactId}, Phone: ${phoneNumber}, Action: ${action}`);

    // Handle different Connect event types
    if (action === 'INITIATE_CALL' || action === 'NEW_INBOUND') {
      return await handleInboundCall(contactId, phoneNumber, callerNumber, connectEvent);
    }
    
    if (action === 'INVOKE' || action === 'AUDIO_STREAM') {
      return await handleAudioStream(contactId, connectEvent);
    }

    // Default response
    return {
      statusCode: 200,
      result: 'success',
      message: 'Event processed'
    };
  } catch (error) {
    console.error('❌ Lambda error:', error);
    return {
      statusCode: 500,
      result: 'error',
      message: error.message
    };
  }
};

/**
 * Handle inbound call initialization
 */
async function handleInboundCall(contactId, phoneNumber, callerNumber, event) {
  console.log(`🚀 Initializing call: ${contactId} for number ${phoneNumber}`);

  // Find agent by phone number
  let agent = null;
  if (phoneNumber && supabase) {
    try {
      const { data: agents, error } = await supabase
        .from('custom_voice_agents')
        .select('*')
        .eq('phone_number', phoneNumber)
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
    console.log(`⚠️ No agent found for phone number: ${phoneNumber}`);
    return {
      statusCode: 200,
      result: 'no_agent',
      greeting: 'Sorry, no agent is configured for this number.'
    };
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
          telnyx_call_id: contactId, // Reusing field name for Connect contact ID
          phone_number: callerNumber,
          direction: 'inbound',
          status: 'ringing',
          metadata: event,
        })
        .select()
        .single();
      
      callRecord = data;
    } catch (error) {
      console.error('Error creating call record:', error);
    }
  }

  // Store session
  const greeting = agent.first_message || 'Hello, thank you for calling. How can I help you today?';
  activeSessions.set(contactId, {
    agent,
    callRecord,
    contactId,
    systemPrompt,
    messages: [{ role: 'assistant', content: greeting }],
    startedAt: new Date(),
    isSpeaking: false,
  });

  console.log(`✅ Call session initialized: ${contactId}`);

  return {
    statusCode: 200,
    result: 'success',
    greeting: greeting,
    agentId: agent.id,
    contactId: contactId
  };
}

/**
 * Handle audio stream from Connect
 * This processes user speech and returns AI response
 */
async function handleAudioStream(contactId, event) {
  const session = activeSessions.get(contactId);
  
  if (!session) {
    console.log(`⚠️ No session found for contact: ${contactId}`);
    return {
      statusCode: 200,
      result: 'no_session',
      message: 'Session not found'
    };
  }

  // Extract transcript from Connect event
  // Connect can send audio stream or transcribed text
  const transcript = event.Transcript || event.transcript || event.text;
  
  if (!transcript || !transcript.trim()) {
    // If no transcript, return greeting or wait
    return {
      statusCode: 200,
      result: 'waiting',
      message: session.messages[0]?.content || 'How can I help you?'
    };
  }

  console.log(`📝 Processing transcript: "${transcript}"`);

  // Process user speech with AI
  try {
    const aiResponse = await processUserSpeech(contactId, transcript.trim(), session);
    
    return {
      statusCode: 200,
      result: 'success',
      message: aiResponse.text,
      audioUrl: aiResponse.audioUrl, // Optional: pre-generated audio URL
      ssml: aiResponse.ssml // SSML for Amazon Polly
    };
  } catch (error) {
    console.error('Error processing speech:', error);
    return {
      statusCode: 200,
      result: 'error',
      message: 'I apologize, I encountered an error. Please try again.'
    };
  }
}

/**
 * Process user speech with OpenAI
 */
async function processUserSpeech(contactId, userText, session) {
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

  // Generate SSML for Amazon Polly
  const ssml = `<speak>${aiResponse}</speak>`;

  return {
    text: aiResponse,
    ssml: ssml,
    audioUrl: null // Can be pre-generated and stored in S3
  };
}

/**
 * Handle function calls from AI
 */
async function handleFunctionCall(toolCall, session) {
  const functionName = toolCall.function.name;
  const parameters = JSON.parse(toolCall.function.arguments);

  console.log(`🔧 Handling function call: ${functionName}`, parameters);

  switch (functionName) {
    case 'book_appointment':
      return await handleBookAppointment(parameters, session);
    
    default:
      return {
        success: false,
        error: `Unknown function: ${functionName}`
      };
  }
}

/**
 * Book appointment via Supabase Edge Function
 */
async function handleBookAppointment(parameters, session) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return {
      success: false,
      error: 'Supabase not configured'
    };
  }

  try {
    const edgeFunctionUrl = `${SUPABASE_URL}/functions/v1/custom-voice-agent-functions`;
    
    const response = await axios.post(
      edgeFunctionUrl,
      {
        function_name: 'book_appointment',
        parameters,
        business_id: session.agent.business_id,
        agent_id: session.agent.id,
        call_id: session.callRecord?.id || null,
      },
      {
        headers: {
          'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
          'Content-Type': 'application/json',
        },
      }
    );

    if (response.data.success) {
      return {
        success: true,
        message: response.data.message || 'Your appointment has been booked successfully!'
      };
    } else {
      return {
        success: false,
        error: response.data.error || 'Failed to book appointment'
      };
    }
  } catch (error) {
    console.error('❌ Error calling booking function:', error.response?.data || error.message);
    return {
      success: false,
      error: error.response?.data?.error || error.message || 'Failed to book appointment'
    };
  }
}

/**
 * Get function definitions for OpenAI
 */
function getFunctionDefinitions() {
  return [
    {
      type: 'function',
      function: {
        name: 'book_appointment',
        description: 'Book an appointment or reservation for a customer. Use this when a caller wants to schedule an appointment, make a reservation, or book a time slot.',
        parameters: {
          type: 'object',
          properties: {
            customer_name: {
              type: 'string',
              description: 'The customer\'s full name'
            },
            customer_phone: {
              type: 'string',
              description: 'The customer\'s phone number'
            },
            customer_email: {
              type: 'string',
              description: 'The customer\'s email address (optional)'
            },
            booking_date: {
              type: 'string',
              description: 'The date for the appointment in YYYY-MM-DD format'
            },
            booking_time: {
              type: 'string',
              description: 'The time for the appointment in HH:MM format (24-hour, e.g., "14:30")'
            },
            service_type: {
              type: 'string',
              description: 'Type of service (e.g., "haircut", "consultation", "dinner reservation")'
            },
            party_size: {
              type: 'number',
              description: 'Number of people (for reservations, default is 1)'
            },
            duration_minutes: {
              type: 'number',
              description: 'Duration of the appointment in minutes (default is 30)'
            },
            notes: {
              type: 'string',
              description: 'Any special notes or requests from the customer'
            }
          },
          required: ['customer_name', 'customer_phone', 'booking_date', 'booking_time']
        }
      }
    }
  ];
}


