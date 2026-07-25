import { supabase } from '../../supabaseClient';
import toast from 'react-hot-toast';

let lastAuditFailureToastAt = 0;

export async function logAccountingEvent({ businessId, action, entityType, entityId = null, details = {} }) {
  if (!businessId || !action || !entityType) {
    return { success: false, error: 'Missing accounting audit log fields.' };
  }
  try {
    const { data } = await supabase.auth.getUser();
    const userId = data?.user?.id || null;
    const { error } = await supabase.from('accounting_audit_logs').insert({
      business_id: businessId,
      user_id: userId,
      action,
      entity_type: entityType,
      entity_id: entityId,
      details
    });
    if (error) {
      throw error;
    }
    return { success: true };
  } catch (error) {
    console.error('Failed to log accounting event:', error?.message || error, {
      businessId,
      action,
      entityType,
      entityId
    });
    if (typeof window !== 'undefined') {
      const now = Date.now();
      if (now - lastAuditFailureToastAt > 30000) {
        lastAuditFailureToastAt = now;
        toast.error('Accounting activity logging failed. Recent actions may be missing from the audit log.');
      }
      window.dispatchEvent(new CustomEvent('accounting-audit-log-failed', {
        detail: {
          businessId,
          action,
          entityType,
          entityId,
          error: error?.message || String(error)
        }
      }));
    }
    return { success: false, error: error?.message || String(error) };
  }
}
