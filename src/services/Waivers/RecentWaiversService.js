/**
 * Lightweight recent waivers for admission counter — no signature blobs, small limit.
 */
import { supabase } from '../../supabaseClient';
import {
  WAIVER_PARTICIPANT_LIST_COLUMNS,
  WAIVER_SIGNATURE_LIST_COLUMNS,
  WAIVER_SIGNATURE_LIST_TEMPLATE_EMBED
} from '../../constants/waiverListColumns';
import { applyWaiverArchiveFilter } from '../../utils/waiverArchiveQuery';

const RECENT_WAIVER_PARTICIPANT_COLUMNS = `${WAIVER_PARTICIPANT_LIST_COLUMNS}, is_required`;

const DEFAULT_HOURS = 8;
const DEFAULT_LIMIT = 100;

class RecentWaiversService {
  constructor() {
    this.businessId = null;
  }

  setBusinessId(businessId) {
    this.businessId = businessId;
  }

  async fetchRecentWaivers({ hours = DEFAULT_HOURS, limit = DEFAULT_LIMIT } = {}) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    const windowHours = Math.max(1, Math.min(48, Number(hours) || DEFAULT_HOURS));
    const rowLimit = Math.max(10, Math.min(200, Number(limit) || DEFAULT_LIMIT));
    const since = new Date(Date.now() - windowHours * 60 * 60 * 1000).toISOString();

    const { data: rows, error } = await applyWaiverArchiveFilter(
      supabase
        .from('waiver_signatures')
        .select(`${WAIVER_SIGNATURE_LIST_COLUMNS}, ${WAIVER_SIGNATURE_LIST_TEMPLATE_EMBED}`)
        .eq('business_id', this.businessId)
        .gte('signed_at', since)
        .order('signed_at', { ascending: false, nullsFirst: false })
        .limit(rowLimit)
    );

    if (error) {
      throw error;
    }

    const signatures = rows || [];
    const waiverIds = signatures.map((r) => r.id).filter(Boolean);
    if (waiverIds.length === 0) {
      return [];
    }

    const participantsByWaiver = new Map();
    const CHUNK = 150;
    for (let i = 0; i < waiverIds.length; i += CHUNK) {
      const chunk = waiverIds.slice(i, i + CHUNK);
      const { data: partRows, error: partErr } = await supabase
        .from('waiver_participants')
        .select(RECENT_WAIVER_PARTICIPANT_COLUMNS)
        .in('waiver_id', chunk);

      if (partErr) {
        console.warn('[RecentWaiversService] participants load failed:', partErr);
        continue;
      }
      for (const p of partRows || []) {
        if (!p?.waiver_id) continue;
        const list = participantsByWaiver.get(p.waiver_id) || [];
        list.push(p);
        participantsByWaiver.set(p.waiver_id, list);
      }
    }

    return signatures.map((row) => ({
      ...row,
      waiver_participants: participantsByWaiver.get(row.id) || []
    }));
  }
}

export default new RecentWaiversService();
