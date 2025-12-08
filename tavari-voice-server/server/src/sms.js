// sms.js
// SMS integration (optional - can use existing Tavari SMS service or AWS SNS)

import axios from 'axios';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

/**
 * Send SMS via Supabase Edge Function (uses existing Tavari SMS service)
 * @param {object} parameters - SMS parameters
 * @param {object} session - Call session
 * @returns {object} - Result with success status and message
 */
export async function sendSMS(parameters, session) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return {
      success: false,
      error: 'Supabase not configured'
    };
  }

  try {
    const edgeFunctionUrl = `${SUPABASE_URL}/functions/v1/custom-voice-agent-functions`;
    
    console.log(`📱 Sending SMS:`, parameters);

    const response = await axios.post(
      edgeFunctionUrl,
      {
        function_name: 'send_sms',
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
        timeout: 10000,
      }
    );

    if (response.data.success) {
      return {
        success: true,
        message: response.data.message || 'SMS sent successfully',
        message_id: response.data.message_id
      };
    } else {
      return {
        success: false,
        error: response.data.error || 'Failed to send SMS'
      };
    }
  } catch (error) {
    console.error('❌ Error sending SMS:', error.response?.data || error.message);
    return {
      success: false,
      error: error.response?.data?.error || error.message || 'Failed to send SMS'
    };
  }
}

