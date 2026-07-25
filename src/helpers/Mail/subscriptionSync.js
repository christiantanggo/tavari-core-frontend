import { supabase } from '../../supabaseClient';

export async function logConsentAction({
  businessId,
  contactId,
  emailAddress,
  action,
  source = 'manual',
  method = 'app_action',
  consentText = null,
  ipAddress = null,
  userAgent = navigator.userAgent || null,
  additionalData = null
}) {
  const normalizedEmail = String(emailAddress || '').trim().toLowerCase();

  if (!businessId || !contactId || !normalizedEmail || !action) {
    throw new Error('Missing required consent action fields');
  }

  const { data, error } = await supabase.functions.invoke('mail-consent-action', {
    body: {
      businessId,
      contactId,
      emailAddress: normalizedEmail,
      action,
      consentSource: source,
      consentMethod: method,
      consentText,
      ipAddress,
      userAgent,
      additionalData
    }
  });

  if (error || data?.ok === false) {
    throw error || new Error(data?.error || 'Failed to log consent action');
  }
}

export async function syncResubscribeState({
  businessId,
  contactId,
  emailAddress,
  source = 'manual'
}) {
  const normalizedEmail = String(emailAddress || '').trim().toLowerCase();

  if (!businessId || !contactId || !normalizedEmail) {
    throw new Error('Missing required resubscribe fields');
  }

  await logConsentAction({
    businessId,
    contactId,
    emailAddress: normalizedEmail,
    action: 'resubscribe',
    source
  });
}
