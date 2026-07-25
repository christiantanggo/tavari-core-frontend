import { supabase } from '../../supabaseClient';

export const sendSchedulingNotification = async ({
  businessId,
  eventKey,
  employeeId,
  employeeIds,
  context = {},
  /** Defaults to shared app client (JWT when present). Punch clock passes this for edge fn auth. */
  supabaseClient = supabase,
}) => {
  if (!businessId || !eventKey) return null;

  const { data, error } = await supabaseClient.functions.invoke('scheduling-send-notification', {
    body: {
      businessId,
      eventKey,
      employeeId,
      employeeIds,
      context
    }
  });

  if (error) {
    console.warn('[Scheduling Notifications] Failed to send notification:', eventKey, error);
    return { ok: false, error };
  }

  return data;
};
