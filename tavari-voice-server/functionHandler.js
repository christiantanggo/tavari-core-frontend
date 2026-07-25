// functionHandler.js
// Separate module for handling AI function calls
// This keeps function calling logic separate from conversation flow

import axios from 'axios';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

/**
 * Handle function calls from AI
 * Returns the result to be passed back to OpenAI
 */
export async function handleFunctionCall(toolCall, session) {
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
 * Call the Edge Function to book an appointment
 */
async function handleBookAppointment(parameters, session) {
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

    // Return user-friendly message
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
export function getFunctionDefinitions() {
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
