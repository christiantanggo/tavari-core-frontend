import { supabase } from '../../supabaseClient';

export const CAMPAIGN_QUEUE_STALL_DAYS = 3;

/**
 * Stall = still has queued/processing rows but no queue activity (sent/failed/processing) in N days.
 * Long multi-day gradual sends are OK; only flags when the pipe appears dead.
 */
export async function getCampaignQueueHealth(campaignId) {
  if (!campaignId) {
    return { stalled: false, queued: 0, processing: 0, sent: 0, failed: 0, lastActivityAt: null };
  }

  const { data: rows, error } = await supabase
    .from('mail_sending_queue')
    .select('status, processed_at')
    .eq('campaign_id', campaignId);

  if (error) throw error;

  const summary = (rows || []).reduce(
    (acc, row) => {
      const status = String(row.status || '');
      if (status === 'queued') acc.queued += 1;
      else if (status === 'processing') acc.processing += 1;
      else if (status === 'sent') acc.sent += 1;
      else if (status === 'failed') acc.failed += 1;

      if (row.processed_at && ['sent', 'failed', 'processing'].includes(status)) {
        const ts = new Date(row.processed_at).getTime();
        if (!Number.isNaN(ts) && (!acc.lastActivityAt || ts > acc.lastActivityAt)) {
          acc.lastActivityAt = ts;
        }
      }
      return acc;
    },
    { queued: 0, processing: 0, sent: 0, failed: 0, lastActivityAt: null },
  );

  const pending = summary.queued + summary.processing;
  const stallMs = CAMPAIGN_QUEUE_STALL_DAYS * 24 * 60 * 60 * 1000;
  const stalled =
    pending > 0 &&
    (summary.lastActivityAt === null || Date.now() - summary.lastActivityAt > stallMs);

  return {
    ...summary,
    pending,
    stalled,
    lastActivityAt: summary.lastActivityAt ? new Date(summary.lastActivityAt).toISOString() : null,
  };
}
