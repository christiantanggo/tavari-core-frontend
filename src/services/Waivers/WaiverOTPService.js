// src/services/Waivers/WaiverOTPService.js
// OTP Authentication Service for Waiver Signing
// Phone number lookup → OTP sent to email on file → Verify OTP

import { supabase } from '../../supabaseClient';
import { normalizePhoneDigits } from '../../utils/waiverExistingViewerAccess';

class WaiverOTPService {
  constructor() {
    this.otpExpiryMinutes = 10;
    this.maxAttempts = 5;
  }

  /**
   * Generate and send OTP for waiver signing
   * @param {string} businessId - Business ID
   * @param {string} phoneNumber - Customer phone number (normalized)
   * @param {string} email - Customer email (if customer doesn't exist yet)
   * @param {string} customerId - Customer ID (if exists)
   * @returns {Promise<{success: boolean, email?: string, customerId?: string, error?: string}>}
   */
  /**
   * If `email` is non-empty, the OTP is always sent there — never replaced by another email for the same phone.
   * (Additional adults vs primary on loyalty.) Optional `options` kept for callers; ignored.
   */
  async generateOTP(businessId, phoneNumber, email = null, customerId = null) {
    const trimmedProvided =
      email != null && String(email).trim() !== '' ? String(email).trim() : '';

    try {
      const normalizedPhone = normalizePhoneDigits(phoneNumber);

      if (!normalizedPhone || normalizedPhone.length < 10) {
        return { success: false, error: 'Invalid phone number' };
      }

      // Get IP address and user agent for security tracking
      const ipAddress = await this.getClientIP();
      const userAgent = navigator.userAgent;

      // Call RPC function to generate OTP
      const { data, error } = await supabase.rpc('waivers_generate_otp', {
        p_business_id: businessId,
        p_phone_number: normalizedPhone,
        p_email: trimmedProvided || null,
        p_customer_id: customerId,
        p_ip_address: ipAddress,
        p_user_agent: userAgent
      });

      if (error) {
        return { success: false, error: error.message };
      }

      let customerEmail = null;
      let finalCustomerId = customerId;

      const normPhone = (p) => normalizePhoneDigits(p);

      if (trimmedProvided) {
        customerEmail = trimmedProvided;
        if (!finalCustomerId) {
          const { data: rows, error: rowErr } = await supabase
            .from('pos_loyalty_accounts')
            .select('id, customer_email, customer_phone')
            .eq('business_id', businessId)
            .eq('is_active', true);
          if (!rowErr && rows?.length) {
            const hit = rows.find(
              (r) =>
                normPhone(r.customer_phone) === normalizedPhone &&
                String(r.customer_email || '')
                  .trim()
                  .toLowerCase() === trimmedProvided.toLowerCase()
            );
            if (hit) finalCustomerId = hit.id;
          }
        }
      } else if (!customerId) {
        const { data: rows, error: customerError } = await supabase
          .from('pos_loyalty_accounts')
          .select('id, customer_email, customer_phone')
          .eq('business_id', businessId)
          .eq('is_active', true);

        const hit =
          rows?.find((r) => normPhone(r.customer_phone) === normalizedPhone) || null;

        if (hit) {
          finalCustomerId = hit.id;
          customerEmail = String(hit.customer_email || '').trim() || null;
        } else if (customerError) {
          console.warn('[WaiverOTPService] Loyalty lookup failed during OTP generation:', customerError);
        }
      } else {
        const { data: customer, error: customerError } = await supabase
          .from('pos_loyalty_accounts')
          .select('customer_email')
          .eq('id', customerId)
          .single();

        if (customer?.customer_email) {
          customerEmail = String(customer.customer_email).trim();
        } else if (customerError) {
          console.warn('[WaiverOTPService] Customer email lookup failed during OTP generation:', customerError);
        }
      }

      // Send OTP via email (using existing mail system)
      if (customerEmail) {
        await this.sendOTPEmail(businessId, customerEmail, data, normalizedPhone);
      } else {
        console.warn('[WaiverOTPService] OTP generated but no delivery email was available.');
      }

      return {
        success: true,
        email: customerEmail,
        customerId: finalCustomerId
      };
    } catch (error) {
      console.error('[WaiverOTPService] Error generating OTP:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Verify OTP code
   * @param {string} phoneNumber - Customer phone number
   * @param {string} otpCode - OTP code to verify
   * @param {string} businessId - Business ID
   * @returns {Promise<{valid: boolean, customerId?: string, email?: string, phoneNumber?: string, error?: string}>}
   */
  async verifyOTP(phoneNumber, otpCode, businessId) {
    try {
      const normalizedPhone = normalizePhoneDigits(phoneNumber);

      // Call RPC function to verify OTP
      const { data, error } = await supabase.rpc('waivers_verify_otp', {
        p_phone_number: normalizedPhone,
        p_otp_code: otpCode,
        p_business_id: businessId
      });

      if (error) {
        return { valid: false, error: error.message };
      }
      return data;
    } catch (error) {
      console.error('[WaiverOTPService] Error verifying OTP:', error);
      return { valid: false, error: error.message };
    }
  }

  /**
   * Send OTP email using existing mail system - EXACT SAME SETUP AS PAY STATEMENTS
   * @param {string} businessId - Business ID
   * @param {string} email - Recipient email
   * @param {string} otpCode - OTP code
   * @param {string} phoneNumber - Phone number (for logging)
   * @returns {Promise<void>}
   */
  async sendOTPEmail(businessId, email, otpCode, phoneNumber) {
    try {
      const { data: business, error: businessError } = await supabase
        .from('businesses')
        .select('name')
        .eq('id', businessId)
        .single();

      const n = business?.name != null ? String(business.name).trim() : '';
      let businessName = n;

      if (!businessName && businessError) {
        const { data: businessData } = await supabase
          .from('businesses')
          .select('name')
          .eq('id', businessId)
          .single();
        const n2 = businessData?.name != null ? String(businessData.name).trim() : '';
        businessName = n2;
      }

      if (!businessName) {
        businessName = 'Tavari';
      }

      const sanitizeFromDisplay = (s) =>
        Array.from(String(s || '').trim())
          .filter((ch) => {
            const code = ch.charCodeAt(0);
            return code >= 32 && code !== 127 && ch !== '"';
          })
          .join('')
          .replace(/\s+/g, ' ')
          .slice(0, 78);

      // Create email content - EXACT SAME PATTERN AS PAY STATEMENTS
      const emailSubject = `Your Waiver OTP Code - ${businessName}`;
      const emailBody = `Your OTP code for waiver signing is: ${otpCode}

This code will expire in 10 minutes.

If you did not request this code, please ignore this email.

Thank you,
${businessName}`;

      const emailHTML = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <style>
            body {
              font-family: Arial, sans-serif;
              line-height: 1.6;
              color: #000;
              max-width: 800px;
              margin: 0 auto;
              padding: 20px;
            }
            .otp-code {
              font-size: 33px;
              font-weight: bold;
              text-align: center;
              padding: 20px;
              background-color: #f5f5f5;
              border: 2px solid #333;
              border-radius: 8px;
              margin: 20px 0;
              letter-spacing: 8px;
            }
            .email-message {
              white-space: pre-wrap;
              margin-bottom: 20px;
            }
          </style>
        </head>
        <body>
          <div class="email-message">${emailBody.replace(/\n/g, '<br>')}</div>
          <div class="otp-code">${otpCode}</div>
          <p style="font-size: 13px; color: #666; margin-top: 20px;">
            This code will expire in 10 minutes.
          </p>
        </body>
        </html>
      `;

      // Send email via mail-send edge function - EXACT SAME AS PAY STATEMENTS
      const senderEmail = 'noreply@tavarios.ca';
      const emailPayload = {
        businessId: businessId,
        campaignId: `waiver-otp-${phoneNumber}-${Date.now()}`,
        contactId: null,
        emailType: 'transactional',
        to: email,
        fromEmail: senderEmail,
        fromName: sanitizeFromDisplay(`${businessName} - Waiver Verification`),
        subject: emailSubject,
        html: emailHTML,
        text: emailBody
      };

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
        console.error('[WaiverOTPService] Email send failed:', errorBody);
        throw new Error(errorBody || 'Failed to send email');
      }

      const data = await response.json();

      if (!data?.ok) {
        console.error('[WaiverOTPService] Email send returned error:', data?.error);
        throw new Error(data?.error || 'Failed to send email');
      }
    } catch (error) {
      console.error('[WaiverOTPService] Error sending OTP email:', error);
      // Don't throw - OTP is still valid even if email fails
      // But log it so we can see the issue
    }
  }

  /**
   * Get client IP address (for security tracking)
   * @returns {Promise<string>}
   */
  async getClientIP() {
    try {
      // Try to get IP from service
      const response = await fetch('https://api.ipify.org?format=json');
      const data = await response.json();
      return data.ip || 'unknown';
    } catch (error) {
      console.warn('[WaiverOTPService] Could not get IP address:', error);
      return 'unknown';
    }
  }

  /**
   * Create customer account if doesn't exist (one of many doors)
   * @param {string} businessId - Business ID
   * @param {string} phoneNumber - Phone number
   * @param {string} email - Email address
   * @param {string} firstName - First name
   * @param {string} lastName - Last name
   * @returns {Promise<{success: boolean, customerId?: string, created?: boolean, error?: string}>}
   */
  async createOrGetCustomer(businessId, phoneNumber, email, firstName, lastName) {
    try {
      const normalizedPhone = String(phoneNumber || '').replace(/\D/g, '');
      const normalizedEmail = String(email || '').trim().toLowerCase();

      if (!businessId) {
        return { success: false, error: 'Business ID is required' };
      }

      if (!normalizedPhone && !normalizedEmail) {
        return { success: false, error: 'Phone or email is required to create a customer account' };
      }

      // Use the SECURITY DEFINER helper created for public booking/portal flows so
      // waiver signing can safely create/link the customer account without direct
      // anon inserts on pos_loyalty_accounts.
      const { data: customerRows, error } = await supabase.rpc(
        'bookings_create_or_get_portal_customer',
        {
          p_business_id: businessId,
          p_phone_number: normalizedPhone || null,
          p_email: normalizedEmail || null,
          p_first_name: firstName || '',
          p_last_name: lastName || '',
          p_city: null
        }
      );

      if (error) {
        console.error('[WaiverOTPService] Error creating customer via RPC:', error);
        return { success: false, error: error.message };
      }

      const customer = Array.isArray(customerRows) ? customerRows[0] : customerRows;
      if (!customer?.id) {
        return { success: false, error: 'Unable to create or link a customer account' };
      }

      return { success: true, customerId: customer.id, created: true };
    } catch (error) {
      console.error('[WaiverOTPService] Error in createOrGetCustomer:', error);
      return { success: false, error: error.message };
    }
  }
}

export const waiverOTPService = new WaiverOTPService();
export default waiverOTPService;


