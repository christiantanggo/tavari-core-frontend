import { supabase } from '../supabaseClient';

export const FORMS_ESCALATION_MEDIA_BUCKET = 'forms-escalation-media';

export const URGENCY_OPTIONS = [
  { value: 'immediate', label: 'Immediate' },
  { value: 'moderate', label: 'Moderate' },
  { value: 'cautionary', label: 'Cautionary' }
];

export const MAINTENANCE_REQUEST_OPTIONS = [
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' }
];

export const createEmptyEscalation = () => ({
  location: '',
  urgency: '',
  submit_maintenance_request: '',
  action_taken: '',
  photo_urls: [],
  video_urls: []
});

export const formatUrgencyLabel = (value) =>
  URGENCY_OPTIONS.find((option) => option.value === value)?.label || value || '—';

export const formatMaintenanceLabel = (value) =>
  MAINTENANCE_REQUEST_OPTIONS.find((option) => option.value === value)?.label || value || '—';

export const isEscalationComplete = (details) => {
  if (!details) return false;
  return Boolean(
    String(details.location || '').trim()
    && String(details.urgency || '').trim()
    && String(details.submit_maintenance_request || '').trim()
    && String(details.action_taken || '').trim()
  );
};

export const getEscalationValidationMessage = (fieldLabel, details) => {
  if (isEscalationComplete(details)) return null;
  if (!String(details?.location || '').trim()) return `${fieldLabel}: enter the location.`;
  if (!String(details?.urgency || '').trim()) return `${fieldLabel}: choose an urgency level.`;
  if (!String(details?.submit_maintenance_request || '').trim()) return `${fieldLabel}: choose whether to submit a maintenance request.`;
  if (!String(details?.action_taken || '').trim()) return `${fieldLabel}: describe the action taken.`;
  return `${fieldLabel}: complete the follow-up details.`;
};

export const buildFormResponsesPayload = (values, escalations = {}) => {
  const payload = { ...values };
  const cleanedEscalations = Object.fromEntries(
    Object.entries(escalations || {}).filter(([, details]) => details && isEscalationComplete(details))
  );
  if (Object.keys(cleanedEscalations).length) {
    payload._escalations = cleanedEscalations;
  }
  return payload;
};

export async function uploadFormsEscalationMedia({ businessId, uploadSessionId, file, kind }) {
  if (!businessId || !uploadSessionId || !file) {
    throw new Error('Missing upload details');
  }

  const safeName = String(file.name || `${kind}-${Date.now()}`).replace(/[^\w.-]+/g, '_');
  const path = `${businessId}/${uploadSessionId}/${kind}-${Date.now()}-${safeName}`;

  const { error } = await supabase.storage
    .from(FORMS_ESCALATION_MEDIA_BUCKET)
    .upload(path, file, {
      upsert: false,
      contentType: file.type || undefined
    });

  if (error) throw error;

  const { data } = supabase.storage.from(FORMS_ESCALATION_MEDIA_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}
