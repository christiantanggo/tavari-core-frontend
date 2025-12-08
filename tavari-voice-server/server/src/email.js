// email.js
// Email sending via Supabase Edge Function (uses existing SES credentials in Supabase)

import axios from 'axios';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

/**
 * Send email via Supabase Edge Function (uses AWS SES credentials stored in Supabase)
 * @param {object} options - Email options
 * @param {string} options.to - Recipient email address
 * @param {string} options.subject - Email subject
 * @param {string} options.htmlBody - HTML email body
 * @param {string} options.textBody - Plain text email body (optional)
 * @param {object} session - Call session (optional, for logging)
 * @returns {object} - Result with success status and message ID
 */
export async function sendEmailSES({ to, subject, htmlBody, textBody }, session = null) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return {
      success: false,
      error: 'Supabase not configured'
    };
  }

  if (!to || !subject || !htmlBody) {
    return {
      success: false,
      error: 'Missing required fields: to, subject, htmlBody'
    };
  }

  try {
    const edgeFunctionUrl = `${SUPABASE_URL}/functions/v1/custom-voice-agent-functions`;
    
    console.log(`📧 Sending email to: ${to}`);

    const response = await axios.post(
      edgeFunctionUrl,
      {
        function_name: 'send_email',
        parameters: {
          to,
          subject,
          body: htmlBody, // Edge Function expects 'body' field
        },
        business_id: session?.agent?.business_id || null,
        agent_id: session?.agent?.id || null,
        call_id: session?.callRecord?.id || null,
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
        messageId: response.data.message_id,
        message: response.data.message || 'Email sent successfully'
      };
    } else {
      return {
        success: false,
        error: response.data.error || 'Failed to send email'
      };
    }
  } catch (error) {
    console.error('❌ Error sending email:', error.response?.data || error.message);
    return {
      success: false,
      error: error.response?.data?.error || error.message || 'Failed to send email'
    };
  }
}

