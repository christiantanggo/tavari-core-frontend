// Step 75: Create WaiverAnalyticsService.js
// Service for waiver analytics
// Uses existing app_analytics table pattern
import { supabase } from '../../supabaseClient';
import { WAIVER_AUDIT_CONSENT_TYPES } from '../../constants/waiverConsentTypes';
import WaiverSettingsService from './WaiverSettingsService';

/** Aligned with WaiversDashboard: global default, then 365. */
const FALLBACK_LEGACY_EXPIRY_DAYS = 365;

function positiveExpiryDaysFromSettings(globalSettings) {
  const raw = globalSettings?.default_expiry_days;
  if (raw == null) return null;
  const n = typeof raw === 'number' ? raw : parseInt(String(raw), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

class WaiverAnalyticsService {
  constructor() {
    this.businessId = null;
  }

  setBusinessId(businessId) {
    this.businessId = businessId;
  }

  async _fetchAllRows(buildQuery, label) {
    const pageSize = 1000; // Supabase/PostgREST default page cap.
    const all = [];
    let from = 0;

    for (;;) {
      const { data, error } = await buildQuery().range(from, from + pageSize - 1);
      if (error) {
        console.error(`[WaiverAnalyticsService] ${label}:`, error);
        return all;
      }

      const chunk = data || [];
      all.push(...chunk);
      if (chunk.length < pageSize) break;
      from += pageSize;
    }

    return all;
  }

  async _countRows(buildQuery, label) {
    const { count, error } = await buildQuery();
    if (error) {
      console.error(`[WaiverAnalyticsService] ${label}:`, error);
      return 0;
    }
    return count || 0;
  }

  // Get waiver stats
  async getWaiverStats(dateRange = {}) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    let query = supabase
      .from('app_analytics')
      .select('*')
      .eq('business_id', this.businessId)
      .like('event_type', 'waiver.%');

    if (dateRange.start) {
      query = query.gte('timestamp', dateRange.start);
    }

    if (dateRange.end) {
      query = query.lte('timestamp', dateRange.end);
    }

    const { data, error } = await query;

    if (error) {
      throw error;
    }

    // Aggregate stats
    const stats = {
      totalWaivers: 0,
      signedWaivers: 0,
      expiredWaivers: 0,
      pendingWaivers: 0,
      byTemplate: {}
    };

    data?.forEach(event => {
      if (event.event_type === 'waiver.created') stats.totalWaivers++;
      if (event.event_type === 'waiver.signed') stats.signedWaivers++;
      if (event.event_type === 'waiver.expired') stats.expiredWaivers++;
      if (event.event_type === 'waiver.pending') stats.pendingWaivers++;

      const templateId = event.event_data?.template_id;
      if (templateId) {
        stats.byTemplate[templateId] = (stats.byTemplate[templateId] || 0) + 1;
      }
    });

    return stats;
  }

  // Get expiry stats
  async getExpiryStats() {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    const now = new Date();
    const thirtyDaysFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    const globalSettings = await (async () => {
      try {
        WaiverSettingsService.setBusinessId(this.businessId);
        return await WaiverSettingsService.getGlobalSettings();
      } catch (e) {
        console.warn('[WaiverAnalyticsService] getGlobalSettings failed, using default expiry for legacy', e);
        return {};
      }
    })();

    const defaultExpiryDays =
      positiveExpiryDaysFromSettings(globalSettings) || FALLBACK_LEGACY_EXPIRY_DAYS;
    const expiryMs = defaultExpiryDays * 24 * 60 * 60 * 1000;
    const legacyExpiredBaseCutoff = new Date(now.getTime() - expiryMs).toISOString();
    const legacyExpiringBaseCutoff = new Date(thirtyDaysFromNow.getTime() - expiryMs).toISOString();

    const [
      modernTotal,
      modernExpired,
      modernExpiringSoon,
      legacyTotal,
      legacyExpired,
      legacyExpiringSoon,
      legacyArchived,
      modernArchived
    ] = await Promise.all([
      this._countRows(
        () =>
          supabase
            .from('waiver_signatures')
            .select('id', { count: 'exact', head: true })
            .eq('business_id', this.businessId)
            .is('archived_at', null),
        'getExpiryStats modern total'
      ),
      this._countRows(
        () =>
          supabase
            .from('waiver_signatures')
            .select('id', { count: 'exact', head: true })
            .eq('business_id', this.businessId)
            .is('archived_at', null)
            .or(`is_valid.eq.false,expires_at.lte.${now.toISOString()}`),
        'getExpiryStats modern expired'
      ),
      this._countRows(
        () =>
          supabase
            .from('waiver_signatures')
            .select('id', { count: 'exact', head: true })
            .eq('business_id', this.businessId)
            .or('is_valid.is.null,is_valid.eq.true')
            .gt('expires_at', now.toISOString())
            .lte('expires_at', thirtyDaysFromNow.toISOString()),
        'getExpiryStats modern expiring soon'
      ),
      this._countRows(
        () =>
          supabase
            .from('legacy_waivers')
            .select('id', { count: 'exact', head: true })
            .eq('business_id', this.businessId)
            .is('deleted_at', null)
            .is('archived_at', null),
        'getExpiryStats legacy total'
      ),
      this._countRows(
        () =>
          supabase
            .from('legacy_waivers')
            .select('id', { count: 'exact', head: true })
            .eq('business_id', this.businessId)
            .is('deleted_at', null)
            .is('archived_at', null)
            .or(
              `signed_at.lte.${legacyExpiredBaseCutoff},and(signed_at.is.null,created_at.lte.${legacyExpiredBaseCutoff})`
            ),
        'getExpiryStats legacy expired'
      ),
      this._countRows(
        () =>
          supabase
            .from('legacy_waivers')
            .select('id', { count: 'exact', head: true })
            .eq('business_id', this.businessId)
            .is('deleted_at', null)
            .is('archived_at', null)
            .or(
              `and(signed_at.gt.${legacyExpiredBaseCutoff},signed_at.lte.${legacyExpiringBaseCutoff}),and(signed_at.is.null,created_at.gt.${legacyExpiredBaseCutoff},created_at.lte.${legacyExpiringBaseCutoff})`
            ),
        'getExpiryStats legacy expiring soon'
      ),
      this._countRows(
        () =>
          supabase
            .from('legacy_waivers')
            .select('id', { count: 'exact', head: true })
            .eq('business_id', this.businessId)
            .is('deleted_at', null)
            .not('archived_at', 'is', null),
        'getExpiryStats legacy archived'
      ),
      this._countRows(
        () =>
          supabase
            .from('waiver_signatures')
            .select('id', { count: 'exact', head: true })
            .eq('business_id', this.businessId)
            .not('archived_at', 'is', null),
        'getExpiryStats modern archived'
      )
    ]);

    const total = modernTotal + legacyTotal;
    const archivedTotal = modernArchived + legacyArchived;
    const expired = modernExpired + legacyExpired;
    const expiringSoon = modernExpiringSoon + legacyExpiringSoon;
    const stats = {
      total,
      archivedTotal,
      allRecordsTotal: total + archivedTotal,
      expired,
      expiringSoon,
      valid: Math.max(0, total - expired - expiringSoon)
    };
    return stats;
  }

  // Get signature stats
  async getSignatureStats(dateRange = {}) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    let query = supabase
      .from('waiver_signatures')
      .select('signed_at, guardian_signature_url')
      .eq('business_id', this.businessId)
      .not('signed_at', 'is', null);

    if (dateRange.start) {
      query = query.gte('signed_at', dateRange.start);
    }

    if (dateRange.end) {
      query = query.lte('signed_at', dateRange.end);
    }

    const { data, error } = await query;

    if (error) {
      throw error;
    }

    return {
      totalSignatures: data?.length || 0,
      guardianSignatures: data?.filter(w => w.guardian_signature_url).length || 0,
      byDate: {} // Would group by date
    };
  }

  // Get consent stats (waiver_consents has no business_id — scope via waiver_signatures)
  async getConsentStats() {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    const pageSize = 1000;
    let from = 0;
    const waiverIds = [];
    for (;;) {
      const { data: page, error: wErr } = await supabase
        .from('waiver_signatures')
        .select('id')
        .eq('business_id', this.businessId)
        .range(from, from + pageSize - 1);
      if (wErr) throw wErr;
      const chunk = page || [];
      waiverIds.push(...chunk.map((r) => r.id));
      if (chunk.length < pageSize) break;
      from += pageSize;
    }

    const stats = {};
    for (const t of WAIVER_AUDIT_CONSENT_TYPES) {
      stats[t] = { given: 0, declined: 0 };
    }

    if (waiverIds.length === 0) {
      return stats;
    }

    const allConsents = [];
    const chunkSize = 500;
    for (let i = 0; i < waiverIds.length; i += chunkSize) {
      const slice = waiverIds.slice(i, i + chunkSize);
      const { data: consents, error: cErr } = await supabase
        .from('waiver_consents')
        .select('consent_type, consent_given')
        .in('waiver_id', slice);
      if (cErr) throw cErr;
      allConsents.push(...(consents || []));
    }

    allConsents.forEach((consent) => {
      const type = consent.consent_type || 'other';
      if (!stats[type]) stats[type] = { given: 0, declined: 0 };
      if (consent.consent_given) {
        stats[type].given++;
      } else {
        stats[type].declined++;
      }
    });

    return stats;
  }
}

export default new WaiverAnalyticsService();




