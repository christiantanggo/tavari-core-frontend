// openaiRealtime.js
// OpenAI Realtime API WebSocket integration
// Uses gpt-4o-mini-realtime-preview for cost optimization

import WebSocket from 'ws';
import { getSession, setOpenAISession, addMessage, setFunctionCallInProgress } from './sessionManager.js';
import { bookAppointment } from './booking.js';
import { sendEmailSES } from './email.js';
import { sendSMS } from './sms.js';
import { encodePCMToBase64 } from './audioUtils.js';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_REALTIME_URL = 'wss://api.openai.com/v1/realtime?model=gpt-4o-mini-realtime-preview-2024-12-17';

// Store audio buffers per call
const audioBuffers = new Map();

/**
 * Initialize OpenAI Realtime session for a call
 * @param {string} callId - Call ID
 * @param {string} systemPrompt - System prompt
 * @param {function} onAudioReady - Callback when audio is ready (callId, base64Audio)
 * @returns {Promise<WebSocket>} - OpenAI WebSocket connection
 */
export async function initializeOpenAISession(callId, systemPrompt, onAudioReady) {
  if (!OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY not configured');
  }

  const session = getSession(callId);
  if (!session) {
    throw new Error(`Session not found for call: ${callId}`);
  }

  console.log(`🤖 Initializing OpenAI Realtime session for call: ${callId}`);

  // Create WebSocket connection
  const ws = new WebSocket(OPENAI_REALTIME_URL, {
    headers: {
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
      'OpenAI-Beta': 'realtime=v1'
    }
  });

  return new Promise((resolve, reject) => {
    ws.on('open', () => {
      console.log(`✅ OpenAI WebSocket connected: ${callId}`);
      
      // Store session ID
      const sessionId = `session_${callId}_${Date.now()}`;
      setOpenAISession(callId, ws, sessionId);
      
      // Initialize session with system prompt
      ws.send(JSON.stringify({
        type: 'session.update',
        session: {
          modalities: ['text', 'audio'],
          instructions: systemPrompt,
          voice: 'alloy', // Default voice
          temperature: 0.7,
          max_response_output_tokens: 4096,
          tools: getFunctionDefinitions()
        }
      }));

      // Send conversation item to start
      ws.send(JSON.stringify({
        type: 'conversation.item.create',
        item: {
          type: 'message',
          role: 'user',
          content: []
        }
      }));

      resolve(ws);
    });

    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        handleOpenAIMessage(callId, message, onAudioReady);
      } catch (error) {
        console.error(`❌ Error parsing OpenAI message for ${callId}:`, error);
      }
    });

    ws.on('error', (error) => {
      console.error(`❌ OpenAI WebSocket error for ${callId}:`, error);
      reject(error);
    });

    ws.on('close', () => {
      console.log(`🔌 OpenAI WebSocket closed: ${callId}`);
      audioBuffers.delete(callId);
    });
  });
}

/**
 * Handle messages from OpenAI Realtime API
 */
function handleOpenAIMessage(callId, message, onAudioReady) {
  const session = getSession(callId);
  if (!session) {
    return;
  }

  switch (message.type) {
    case 'session.created':
      console.log(`📝 OpenAI session created: ${message.session.id}`);
      break;

    case 'conversation.item.input_audio_buffer.committed':
      // User audio was processed
      console.log(`🎤 User audio committed for ${callId}`);
      break;

    case 'conversation.item.output_audio_buffer.committed':
      // AI audio is ready
      if (message.audio) {
        const audioBase64 = message.audio;
        console.log(`🔊 AI audio ready for ${callId} (${audioBase64.length} bytes)`);
        onAudioReady(callId, audioBase64);
      }
      break;

    case 'response.audio_transcript.delta':
      // Text transcript delta
      if (message.delta) {
        // Can be used for logging/debugging
        process.stdout.write(message.delta);
      }
      break;

    case 'response.audio_transcript.done':
      // Full transcript available
      if (message.transcript) {
        const transcript = message.transcript;
        console.log(`📝 AI transcript: "${transcript}"`);
        addMessage(callId, { role: 'assistant', content: transcript });
      }
      break;

    case 'response.function_call_arguments_completed':
      // Function call arguments received
      handleFunctionCall(callId, message.function_call);
      break;

    case 'response.done':
      // Response complete
      console.log(`✅ OpenAI response done for ${callId}`);
      setFunctionCallInProgress(callId, false);
      break;

    case 'error':
      console.error(`❌ OpenAI error for ${callId}:`, message.error);
      break;

    default:
      // Ignore other event types
      break;
  }
}

/**
 * Send audio to OpenAI Realtime
 * @param {string} callId - Call ID
 * @param {Buffer} audioBuffer - PCM audio buffer
 */
export function sendAudioToOpenAI(callId, audioBuffer) {
  const session = getSession(callId);
  if (!session || !session.openaiWs || session.openaiWs.readyState !== WebSocket.OPEN) {
    return;
  }

  // Convert buffer to base64
  const audioBase64 = encodePCMToBase64(audioBuffer);

  // Send audio to OpenAI
  session.openaiWs.send(JSON.stringify({
    type: 'input_audio_buffer.append',
    audio: audioBase64
  }));

  // Commit the audio buffer
  session.openaiWs.send(JSON.stringify({
    type: 'input_audio_buffer.commit'
  }));
}

/**
 * Handle function calls from OpenAI
 */
async function handleFunctionCall(callId, functionCall) {
  const session = getSession(callId);
  if (!session || !session.openaiWs) {
    return;
  }

  setFunctionCallInProgress(callId, true);

  const functionName = functionCall.name;
  const parameters = functionCall.arguments || {};

  console.log(`🔧 OpenAI function call: ${functionName}`, parameters);

  let result;
  
  try {
    switch (functionName) {
      case 'book_appointment':
        result = await bookAppointment(parameters, session);
        break;

      case 'send_email':
        result = await sendEmailSES(parameters, session);
        break;

      case 'send_sms':
        result = await sendSMS(parameters, session);
        break;

      default:
        result = {
          success: false,
          error: `Unknown function: ${functionName}`
        };
    }

    // Send function result back to OpenAI
    session.openaiWs.send(JSON.stringify({
      type: 'response.function_call_arguments_completed',
      function_call_id: functionCall.id,
      result: JSON.stringify(result)
    }));

    // Create a new response to get AI's follow-up
    session.openaiWs.send(JSON.stringify({
      type: 'response.create',
      response: {
        modalities: ['text', 'audio'],
        instructions: 'Respond naturally to the function result.'
      }
    }));

  } catch (error) {
    console.error(`❌ Error handling function call ${functionName}:`, error);
    
    session.openaiWs.send(JSON.stringify({
      type: 'response.function_call_arguments_completed',
      function_call_id: functionCall.id,
      result: JSON.stringify({
        success: false,
        error: error.message
      })
    }));
  }
}

/**
 * Get function definitions for OpenAI Realtime
 */
function getFunctionDefinitions() {
  return [
    {
      type: 'function',
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
    },
    {
      type: 'function',
      name: 'send_email',
      description: 'Send an email to a customer. Use this when the caller requests email confirmation, wants information sent via email, or needs to receive documents.',
      parameters: {
        type: 'object',
        properties: {
          to: {
            type: 'string',
            description: 'Recipient email address'
          },
          subject: {
            type: 'string',
            description: 'Email subject line'
          },
          htmlBody: {
            type: 'string',
            description: 'Email body in HTML format'
          },
          textBody: {
            type: 'string',
            description: 'Email body in plain text (optional)'
          }
        },
        required: ['to', 'subject', 'htmlBody']
      }
    },
    {
      type: 'function',
      name: 'send_sms',
      description: 'Send an SMS text message to a customer. Use this when the caller requests SMS confirmation or wants to receive information via text message.',
      parameters: {
        type: 'object',
        properties: {
          to: {
            type: 'string',
            description: 'Recipient phone number (E.164 format, e.g., +1234567890)'
          },
          message: {
            type: 'string',
            description: 'SMS message text'
          }
        },
        required: ['to', 'message']
      }
    }
  ];
}

