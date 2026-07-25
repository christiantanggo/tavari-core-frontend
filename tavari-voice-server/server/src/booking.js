// booking.js
// Appointment booking integration with Supabase Edge Function

import axios from 'axios';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

/**
 * Book an appointment via Supabase Edge Function
 * @param {object} parameters - Booking parameters
 * @param {object} session - Call session
 * @returns {object} - Result with success status and message
 */
export async function bookAppointment(parameters, session) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return {
      success: false,
      error: 'Supabase not configured'
    };
  }

  try {
    const edgeFunctionUrl = `${SUPABASE_URL}/functions/v1/custom-voice-agent-functions`;
    
    console.log(`📅 Booking appointment:`, parameters);

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
        timeout: 10000, // 10 second timeout
      }
    );

    if (response.data.success) {
      return {
        success: true,
        message: response.data.message || 'Your appointment has been booked successfully!',
        booking_id: response.data.booking_id
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


