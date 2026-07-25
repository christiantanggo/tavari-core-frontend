// C:\TAVARI-FULL-PROJECT\tavari-core-frontend\src\helpers\finixApi.js

/**
 * Finix API Helper
 * Calls Supabase Edge Functions which securely communicate with Finix API
 */

import { supabase } from '../supabaseClient';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;

/**
 * Call Supabase Edge Function
 */
const callEdgeFunction = async (functionName, body) => {
  try {
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();

    console.log('Session:', session ? 'Found' : 'Not found');
    console.log('Access token:', session?.access_token ? 'Present' : 'Missing');

    if (sessionError || !session || !session.access_token) {
      console.error('Session error:', sessionError);
      throw new Error('Not authenticated - please log in again');
    }

    const response = await fetch(
      `${SUPABASE_URL}/functions/v1/${functionName}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(body),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || `Edge Function Error: ${response.status}`);
    }

    return data;
  } catch (error) {
    console.error(`Edge Function ${functionName} Failed:`, error);
    throw error;
  }
};

/**
 * Create a new onboarding form for a merchant
 * @param {Object} businessData - Business information to prefill
 * @param {string} returnUrl - URL to redirect after completion
 * @param {string} businessId - Business ID for authorization check
 * @returns {Object} Onboarding form data with link_url
 */
export const createOnboardingForm = async (businessData = {}, returnUrl, businessId, cancelUrl) => {
  const data = await callEdgeFunction('create-onboarding-form', {
    businessData,
    returnUrl,
    cancelUrl,
    businessId
  });

  return data;
};

/**
 * Get onboarding form status
 * @param {string} formId - Onboarding form ID
 * @param {string} businessId - Business ID for authorization check
 * @returns {Object} Form status and details
 */
export const getOnboardingFormStatus = async (formId, businessId) => {
  const data = await callEdgeFunction('get-onboarding-status', {
    formId,
    businessId
  });

  return data;
};

/**
 * Create a new link for an existing onboarding form
 * NOT IMPLEMENTED YET - Will add if needed
 */
export const createOnboardingFormLink = async (formId, businessId, options = {}) => {
  const data = await callEdgeFunction('create-onboarding-form-link', {
    formId,
    businessId,
    returnUrl: options.returnUrl,
    cancelUrl: options.cancelUrl
  });

  return data;
};

/**
 * Get merchant account details
 * @param {string} merchantId - Merchant ID
 * @param {string} businessId - Business ID for authorization check
 * @returns {Object} Merchant details
 */
export const getMerchantDetails = async (merchantId, businessId) => {
  const data = await callEdgeFunction('get-merchant-details', {
    merchantId,
    businessId
  });

  return data;
};

/**
 * Check if Finix is configured (always true with Edge Functions)
 * @returns {boolean}
 */
export const isFinixConfigured = () => {
  // Always return true since credentials are stored securely in Supabase
  // The Edge Functions will handle checking if credentials exist
  return !!SUPABASE_URL;
};

/**
 * Get configuration status
 * @returns {Object}
 */
export const getFinixConfig = () => {
  return {
    configured: isFinixConfigured(),
    environment: 'Edge Functions (Secure)',
    note: 'Credentials stored securely in Supabase Secrets'
  };
};