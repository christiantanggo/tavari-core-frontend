// passwordReset.js - Custom password reset utility
// Uses custom email service instead of Supabase's default email

import { supabase } from '../supabaseClient';

/**
 * Request a password reset and send custom email
 * @param {string} email - User's email address
 * @returns {Promise<{success: boolean, message: string}>}
 */
export async function requestPasswordReset(email) {
  try {
    // Call RPC function to generate token
    const { data, error } = await supabase.rpc('request_password_reset', {
      p_email: email.trim().toLowerCase()
    });

    if (error) {
      console.error('Error generating reset token:', error);
      // Don't reveal if user exists (security best practice)
      return {
        success: true,
        message: 'If an account exists with this email, a password reset link has been sent'
      };
    }

    // If no user found, RPC returns success anyway (to prevent email enumeration)
    if (!data || !data.success || !data.token) {
      return {
        success: true,
        message: 'If an account exists with this email, a password reset link has been sent'
      };
    }

    // Send custom email via mail-send edge function
    const resetLink = `${window.location.origin}/portal/reset-password?token=${data.token}`;
    
    // Get business info for email (try to find user's business)
    let businessId = null;
    // Use verified email address (same as contracts)
    let fromEmail = 'noreply@tavarios.ca';
    let fromName = 'Tavari Employee Portal';

    try {
      // Try to get user's business_id first
      const { data: businessUsers } = await supabase
        .from('business_users')
        .select('business_id')
        .eq('user_id', data.user_id)
        .limit(1)
        .maybeSingle();

      if (businessUsers?.business_id) {
        businessId = businessUsers.business_id;
        
        // Get business details separately
        const { data: business } = await supabase
          .from('businesses')
          .select('name, business_email')
          .eq('id', businessId)
          .maybeSingle();

        if (business) {
          if (business.business_email) {
            fromEmail = business.business_email;
          }
          if (business.name) {
            fromName = `${business.name} - Employee Portal`;
          }
        }
      }
    } catch (err) {
      console.warn('Could not fetch business info for email:', err);
      // Continue with defaults
    }

    // Build email HTML
    const emailHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .button { display: inline-block; padding: 12px 24px; background-color: #2563eb; color: white; text-decoration: none; border-radius: 6px; margin: 20px 0; }
          .footer { margin-top: 30px; font-size: 13px; color: #666; }
          .warning { background-color: #FEF3C7; padding: 15px; border-radius: 6px; margin: 20px 0; border-left: 4px solid #F59E0B; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>Reset Your Password</h1>
          <p>You requested to reset your password for your Employee Portal account.</p>
          <p>
            <a href="${resetLink}" class="button">Reset Password</a>
          </p>
          <p>Or copy and paste this link into your browser:</p>
          <p style="word-break: break-all; color: #666; background: #f3f4f6; padding: 10px; border-radius: 4px;">${resetLink}</p>
          <div class="warning">
            <p><strong>⚠️ Security Notice:</strong></p>
            <p>This link will expire in 1 hour. If you didn't request this, please ignore this email and your password will remain unchanged.</p>
          </div>
          <div class="footer">
            <p>For security reasons, never share this link with anyone.</p>
            <p>If you have any questions, please contact your HR department.</p>
          </div>
        </div>
      </body>
      </html>
    `;

    const emailText = `Reset your Employee Portal password by visiting: ${resetLink}\n\nThis link expires in 1 hour. If you didn't request this, please ignore this email.`;

    // Call mail-send edge function (using same pattern as SendContractModal)
    const emailPayload = {
      businessId: businessId || '00000000-0000-0000-0000-000000000000', // Dummy UUID if no business
      campaignId: `password-reset-${data.user_id}-${Date.now()}`,
      contactId: data.user_id,
      to: data.email,
      fromEmail: fromEmail,
      fromName: fromName,
      subject: 'Reset Your Employee Portal Password',
      html: emailHtml,
      text: emailText
    };

    try {
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/mail-send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`
        },
        body: JSON.stringify(emailPayload)
      });

      if (!response.ok) {
        const errorBody = await response.text();
        console.error('Error sending password reset email:', response.status, errorBody);
        // Still return success to user (don't reveal email sending failure)
        return {
          success: true,
          message: 'If an account exists with this email, a password reset link has been sent'
        };
      }

      // Response should be ok if we get here, but verify
      const mailData = await response.json().catch(() => ({}));
      console.log('Password reset email sent successfully:', mailData);
    } catch (err) {
      console.error('Error sending password reset email:', err);
      // Still return success to user (don't reveal email sending failure)
      return {
        success: true,
        message: 'If an account exists with this email, a password reset link has been sent'
      };
    }

    return {
      success: true,
      message: 'If an account exists with this email, a password reset link has been sent'
    };
  } catch (err) {
    console.error('Error in requestPasswordReset:', err);
    // Always return success to prevent email enumeration
    return {
      success: true,
      message: 'If an account exists with this email, a password reset link has been sent'
    };
  }
}

/**
 * Verify a password reset token
 * @param {string} token - Reset token from URL
 * @returns {Promise<{success: boolean, user_id?: string, email?: string, error?: string}>}
 */
export async function verifyPasswordResetToken(token) {
  try {
    const { data, error } = await supabase.rpc('verify_password_reset_token', {
      p_token: token
    });

    if (error) {
      console.error('Error verifying reset token:', error);
      return {
        success: false,
        error: 'Invalid or expired reset token'
      };
    }

    if (!data || !data.success) {
      return {
        success: false,
        error: data?.error || 'Invalid or expired reset token'
      };
    }

    return {
      success: true,
      user_id: data.user_id,
      email: data.email
    };
  } catch (err) {
    console.error('Error in verifyPasswordResetToken:', err);
    return {
      success: false,
      error: 'Failed to verify reset token'
    };
  }
}

