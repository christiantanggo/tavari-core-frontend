// twilioRouter.js
// Twilio webhook handlers for voice agent

import { createClient } from '@supabase/supabase-js';
import { startSession, getSession, endSession, addMessage } from './sessionManager.js';
import { handleBookAppointment } from './booking.js';
import { handleSendEmail } from './email.js';
import { handleSendSMS } from './sms.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const supabase = SUPABASE_URL && SUPABASE_SERVICE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
  : null;

/**
 * Handle incoming call from Twilio
 * This is called when a call comes in
 */
export async function handleIncomingCall(req, res) {
  try {
    const fromNumber = req.body.From;
    const toNumber = req.body.To;
    const callSid = req.body.CallSid;

    console.log(`📞 Incoming call: ${fromNumber} -> ${toNumber} (${callSid})`);

    // Find agent by phone number
    let agent = null;
    if (supabase) {
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
      return res.type('text/xml').send(`
        <?xml version="1.0" encoding="UTF-8"?>
        <Response>
          <Say voice="alice">Sorry, no agent is configured for this number. Goodbye.</Say>
          <Hangup/>
        </Response>
      `);
    }

    // Check if call forwarding is enabled
    const forwardToPhone = agent.forward_to_phone;
    const ringCount = agent.ring_count || 3;

    if (forwardToPhone) {
      // Forward to cell phone first
      console.log(`📱 Forwarding to ${forwardToPhone} (ring ${ringCount} times)`);
      return res.type('text/xml').send(`
        <?xml version="1.0" encoding="UTF-8"?>
        <Response>
          <Dial timeout="${ringCount * 6}" action="/twilio/call-status" method="POST">
            <Number>${forwardToPhone}</Number>
          </Dial>
          <!-- If forwarding fails or times out, continue to AI -->
          <Redirect>/twilio/ai-handler?CallSid=${callSid}</Redirect>
        </Response>
      `);
    } else {
      // Go straight to AI
      return res.redirect(`/twilio/ai-handler?CallSid=${callSid}`);
    }
  } catch (error) {
    console.error('❌ Error handling incoming call:', error);
    return res.type('text/xml').send(`
      <?xml version="1.0" encoding="UTF-8"?>
      <Response>
        <Say voice="alice">I apologize, an error occurred. Please try again later.</Say>
        <Hangup/>
      </Response>
    `);
  }
}

/**
 * Handle call status after forwarding attempt
 */
export async function handleCallStatus(req, res) {
  const callSid = req.body.CallSid;
  const dialCallStatus = req.body.DialCallStatus; // completed, busy, no-answer, failed, canceled

  console.log(`📱 Call forwarding status: ${dialCallStatus} for ${callSid}`);

  // If call was answered, user took it - we're done
  if (dialCallStatus === 'completed') {
    return res.type('text/xml').send(`
      <?xml version="1.0" encoding="UTF-8"?>
      <Response>
        <Hangup/>
      </Response>
    `);
  }

  // If not answered (no-answer, busy, failed), route to AI
  return res.redirect(`/twilio/ai-handler?CallSid=${callSid}`);
}

/**
 * Handle AI conversation
 * Uses Twilio's <Gather> with speech recognition
 */
export async function handleAIConversation(req, res) {
  try {
    const callSid = req.body.CallSid || req.query.CallSid;
    const speechResult = req.body.SpeechResult; // User's speech transcript
    const confidence = req.body.Confidence;

    console.log(`🤖 AI handler for ${callSid}, speech: ${speechResult || '(none)'}`);

    // Get or create session
    let session = getSession(callSid);
    if (!session) {
      // First time - initialize session
      const fromNumber = req.body.From || req.query.From;
      const toNumber = req.body.To || req.query.To;

      // Find agent
      let agent = null;
      if (supabase) {
        const { data: agents } = await supabase
          .from('custom_voice_agents')
          .select('*')
          .eq('phone_number', toNumber)
          .eq('is_active', true)
          .limit(1);
        agent = agents && agents.length > 0 ? agents[0] : null;
      }

      if (!agent) {
        return res.type('text/xml').send(`
          <?xml version="1.0" encoding="UTF-8"?>
          <Response>
            <Say voice="alice">Sorry, no agent found. Goodbye.</Say>
            <Hangup/>
          </Response>
        `);
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
              telnyx_call_id: callSid, // Reusing field name
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

      session = startSession(callSid, agent, systemPrompt);
      session.callRecord = callRecord;

      // Add greeting
      const greeting = agent.first_message || 'Hello, thank you for calling. How can I help you today?';
      addMessage(callSid, { role: 'assistant', content: greeting });

      // Return greeting and wait for user input
      return res.type('text/xml').send(`
        <?xml version="1.0" encoding="UTF-8"?>
        <Response>
          <Say voice="alice">${greeting}</Say>
          <Gather 
            input="speech" 
            action="/twilio/ai-handler" 
            method="POST"
            speechTimeout="auto"
            language="en-CA"
            hints="appointment, booking, schedule, reservation, hours, open, closed, contact, email, phone, address">
            <Say voice="alice">Please speak your request.</Say>
          </Gather>
          <Say voice="alice">I didn't hear anything. Please call back. Goodbye.</Say>
          <Hangup/>
        </Response>
      `);
    }

    // Process user speech
    if (speechResult) {
      console.log(`👤 User said: "${speechResult}" (confidence: ${confidence})`);
      addMessage(callSid, { role: 'user', content: speechResult });

      // Get AI response
      const aiResponse = await getAIResponse(callSid, speechResult, session);
      
      if (aiResponse.functionCall) {
        // Handle function call
        const functionResult = await handleFunctionCall(aiResponse.functionCall, session);
        console.log(`📅 Function result:`, functionResult);

        // Get AI response after function call
        const followUpResponse = await getAIResponse(callSid, null, session, functionResult);
        const message = followUpResponse.message || 'I have processed your request. Is there anything else I can help you with?';

        return res.type('text/xml').send(`
          <?xml version="1.0" encoding="UTF-8"?>
          <Response>
            <Say voice="alice">${escapeXml(message)}</Say>
            <Gather 
              input="speech" 
              action="/twilio/ai-handler" 
              method="POST"
              speechTimeout="auto"
              language="en-CA">
              <Say voice="alice">How else can I help you?</Say>
            </Gather>
            <Say voice="alice">Thank you for calling. Goodbye.</Say>
            <Hangup/>
          </Response>
        `);
      } else {
        // Regular AI response
        const message = aiResponse.message || 'I apologize, I did not understand. Can you please repeat?';

        return res.type('text/xml').send(`
          <?xml version="1.0" encoding="UTF-8"?>
          <Response>
            <Say voice="alice">${escapeXml(message)}</Say>
            <Gather 
              input="speech" 
              action="/twilio/ai-handler" 
              method="POST"
              speechTimeout="auto"
              language="en-CA">
              <Say voice="alice">What else can I help you with?</Say>
            </Gather>
            <Say voice="alice">Thank you for calling. Goodbye.</Say>
            <Hangup/>
          </Response>
        `);
      }
    } else {
      // No speech detected, ask again
      return res.type('text/xml').send(`
        <?xml version="1.0" encoding="UTF-8"?>
        <Response>
          <Gather 
            input="speech" 
            action="/twilio/ai-handler" 
            method="POST"
            speechTimeout="auto"
            language="en-CA">
            <Say voice="alice">I didn't catch that. Please speak your request.</Say>
          </Gather>
          <Say voice="alice">I'm having trouble hearing you. Please call back. Goodbye.</Say>
          <Hangup/>
        </Response>
      `);
    }
  } catch (error) {
    console.error('❌ Error in AI handler:', error);
    return res.type('text/xml').send(`
      <?xml version="1.0" encoding="UTF-8"?>
      <Response>
        <Say voice="alice">I apologize, an error occurred. Please try again later.</Say>
        <Hangup/>
      </Response>
    `);
  }
}

/**
 * Get AI response from OpenAI
 */
async function getAIResponse(callSid, userMessage, session, functionResult = null) {
  try {
    const messages = session.messages || [];
    
    // Add user message if provided
    if (userMessage) {
      messages.push({ role: 'user', content: userMessage });
    }

    // Add function result if provided
    if (functionResult) {
      messages.push({
        role: 'function',
        name: functionResult.name,
        content: JSON.stringify(functionResult.result)
      });
    }

    // Prepare OpenAI request
    const requestBody = {
      model: 'gpt-4o-mini', // Cheaper model
      messages: messages,
      temperature: 0.7,
      max_tokens: 500,
    };

    // Add function definitions if this is the first turn or after function call
    if (!functionResult) {
      requestBody.tools = [
        {
          type: 'function',
          function: {
            name: 'book_appointment',
            description: 'Book an appointment or reservation for a customer',
            parameters: {
              type: 'object',
              properties: {
                customer_name: { type: 'string', description: 'Customer\'s full name' },
                customer_phone: { type: 'string', description: 'Customer\'s phone number' },
                customer_email: { type: 'string', description: 'Customer\'s email address (optional)' },
                booking_date: { type: 'string', description: 'Date in YYYY-MM-DD format' },
                booking_time: { type: 'string', description: 'Time in HH:MM format (24-hour)' },
                service_type: { type: 'string', description: 'Type of service or appointment' },
                notes: { type: 'string', description: 'Additional notes or special requests' },
              },
              required: ['customer_name', 'customer_phone', 'booking_date', 'booking_time']
            }
          }
        }
      ];
    }

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    const data = await response.json();

    if (data.error) {
      console.error('OpenAI error:', data.error);
      return { message: 'I apologize, I encountered an error processing your request.' };
    }

    const choice = data.choices[0];
    const message = choice.message;

    // Check for function call
    if (message.tool_calls && message.tool_calls.length > 0) {
      const toolCall = message.tool_calls[0];
      return {
        functionCall: {
          id: toolCall.id,
          name: toolCall.function.name,
          arguments: JSON.parse(toolCall.function.arguments)
        }
      };
    }

    // Regular response
    const content = message.content || 'I apologize, I did not understand.';
    addMessage(callSid, { role: 'assistant', content });
    return { message: content };

  } catch (error) {
    console.error('Error getting AI response:', error);
    return { message: 'I apologize, I encountered an error. Please try again.' };
  }
}

/**
 * Handle function calls
 */
async function handleFunctionCall(functionCall, session) {
  const { name, arguments: args } = functionCall;
  const agent = session.agent;
  const callId = session.callId;

  console.log(`🔧 Handling function call: ${name}`, args);

  switch (name) {
    case 'book_appointment':
      return {
        name: 'book_appointment',
        result: await handleBookAppointment(args, agent?.business_id, agent?.id, callId)
      };
    case 'send_email':
      return {
        name: 'send_email',
        result: await handleSendEmail(args, agent?.business_id, agent?.id, callId)
      };
    case 'send_sms':
      return {
        name: 'send_sms',
        result: await handleSendSMS(args, agent?.business_id, agent?.id, callId)
      };
    default:
      return {
        name: name,
        result: { success: false, error: `Unknown function: ${name}` }
      };
  }
}

/**
 * Escape XML special characters
 */
function escapeXml(text) {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}


