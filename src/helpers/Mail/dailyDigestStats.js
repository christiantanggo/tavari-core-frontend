/**
 * Mail daily digest: RPC wrapper + CSV builder (matches mail_daily_digest_stats).
 */

export const DIGEST_SECTION_IDS = {
  total_sent: 'total_sent',
  metrics_guide: 'metrics_guide',
  campaigns_breakdown: 'campaigns_breakdown',
  rollout_batches: 'rollout_batches',
  open_rate: 'open_rate',
  click_rate: 'click_rate',
  last_seven_days: 'last_seven_days',
  unsubs: 'unsubs',
  bounces: 'bounces',
  failures: 'failures',
  suppression: 'suppression',
  pending: 'pending',
  extra_counts: 'extra_counts'
};

export const DEFAULT_DIGEST_SECTIONS = {
  [DIGEST_SECTION_IDS.total_sent]: true,
  [DIGEST_SECTION_IDS.metrics_guide]: true,
  [DIGEST_SECTION_IDS.campaigns_breakdown]: true,
  [DIGEST_SECTION_IDS.rollout_batches]: true,
  [DIGEST_SECTION_IDS.open_rate]: true,
  [DIGEST_SECTION_IDS.click_rate]: true,
  [DIGEST_SECTION_IDS.last_seven_days]: true,
  [DIGEST_SECTION_IDS.unsubs]: true,
  [DIGEST_SECTION_IDS.bounces]: true,
  [DIGEST_SECTION_IDS.failures]: true,
  [DIGEST_SECTION_IDS.suppression]: true,
  [DIGEST_SECTION_IDS.pending]: true,
  [DIGEST_SECTION_IDS.extra_counts]: true
};

export function mergeDigestSections(stored) {
  if (!stored || typeof stored !== 'object') return { ...DEFAULT_DIGEST_SECTIONS };
  const next = { ...stored };
  if (next.last_six_days !== undefined && next.last_seven_days === undefined) {
    next.last_seven_days = next.last_six_days;
  }
  return { ...DEFAULT_DIGEST_SECTIONS, ...next };
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} businessId
 * @param {string} timezone IANA
 * @param {string} rangeStartIso timestamptz ISO
 * @param {string} rangeEndIso timestamptz ISO
 */
export async function fetchDailyDigestStats(supabase, businessId, timezone, rangeStartIso, rangeEndIso) {
  const { data, error } = await supabase.rpc('mail_daily_digest_stats', {
    p_business_id: businessId,
    p_range_start: rangeStartIso,
    p_range_end: rangeEndIso,
    p_timezone: timezone || 'America/Toronto'
  });
  if (error) throw error;
  return data;
}

function csvEscape(value) {
  const s = value === null || value === undefined ? '' : String(value);
  return `"${s.replace(/"/g, '""')}"`;
}

function sectionEnabled(sections, id) {
  return sections[id] !== false;
}

/**
 * @param {object} stats RPC payload
 * @param {Record<string, boolean>} sections
 * @param {{ businessName?: string, rangeLabel?: string }} meta
 */
export function buildDailyDigestCsv(stats, sections, meta = {}) {
  const tz = stats?.timezone || '';
  const sb = [];

  sb.push(['Daily email stats export']);
  sb.push(['Business', meta.businessName || '']);
  sb.push(['Timezone', tz]);
  sb.push(['Range start (UTC)', stats?.range_start || '']);
  sb.push(['Range end (UTC)', stats?.range_end || '']);
  if (stats?.anchor_local_date != null) {
    sb.push(['7-day campaign anchor (local date)', stats.anchor_local_date]);
  }
  sb.push(['Generated', new Date().toISOString()]);
  sb.push([]);

  if (sectionEnabled(sections, DIGEST_SECTION_IDS.total_sent)) {
    sb.push(['Summary']);
    sb.push(['Emails sent (delivered)', stats?.sent_count ?? 0]);
    sb.push([]);
  }

  if (sectionEnabled(sections, DIGEST_SECTION_IDS.metrics_guide)) {
    sb.push(['How to read these numbers']);
    sb.push([
      'Rates use sent-status rows in this window as the denominator (one row per recipient delivery).'
    ]);
    sb.push([
      'Open rate = deliveries with at least one open ÷ sent; click rate = deliveries with at least one tracked click ÷ sent.'
    ]);
    sb.push([
      'Compare campaigns using the campaigns table; rollout batches compare staged audience slices when rollouts are used.'
    ]);
    sb.push([]);
  }

  if (sectionEnabled(sections, DIGEST_SECTION_IDS.open_rate) || sectionEnabled(sections, DIGEST_SECTION_IDS.click_rate)) {
    sb.push(['Engagement (sent rows in range)']);
    if (sectionEnabled(sections, DIGEST_SECTION_IDS.open_rate)) {
      sb.push(['Open rate (opens ÷ sent deliveries) %', stats?.open_rate_pct ?? 0]);
      sb.push(['Opens counted (unique deliveries)', stats?.opened_count ?? 0]);
    }
    if (sectionEnabled(sections, DIGEST_SECTION_IDS.click_rate)) {
      sb.push(['Click rate (clicks ÷ sent deliveries) %', stats?.click_rate_pct ?? 0]);
      sb.push(['Clicks counted (unique deliveries)', stats?.clicked_count ?? 0]);
    }
    sb.push([]);
  }

  if (sectionEnabled(sections, DIGEST_SECTION_IDS.campaigns_breakdown)) {
    const perCamp = Array.isArray(stats?.campaigns_seven_day) ? stats.campaigns_seven_day : [];
    if (perCamp.length > 0) {
      sb.push(['Per-campaign last 7 local days (see anchor_local_date above)']);
      for (const camp of perCamp) {
        sb.push([]);
        sb.push(['Campaign', camp.name || '']);
        sb.push(['Campaign ID', camp.campaign_id || '']);
        sb.push(['Local date', 'Sent', 'Open rate %', 'Click rate %', 'Opens', 'Clicks']);
        const days = Array.isArray(camp.days) ? camp.days : [];
        for (const row of days) {
          sb.push([
            row.local_date ? String(row.local_date) : '',
            row.sent ?? 0,
            row.open_rate_pct ?? 0,
            row.click_rate_pct ?? 0,
            row.opened ?? 0,
            row.clicked ?? 0
          ]);
        }
      }
      sb.push([]);
    } else {
      sb.push(['Campaigns with sends in digest window only']);
      sb.push(['Campaign', 'Sent', 'Opens', 'Open rate %', 'Clicks', 'Click rate %']);
      const camps = Array.isArray(stats?.campaigns) ? stats.campaigns : [];
      for (const c of camps) {
        sb.push([
          c.name || '',
          c.sent_count ?? 0,
          c.opened_count ?? 0,
          c.open_rate_pct ?? 0,
          c.clicked_count ?? 0,
          c.click_rate_pct ?? 0
        ]);
      }
      sb.push([]);
    }
  }

  if (sectionEnabled(sections, DIGEST_SECTION_IDS.rollout_batches)) {
    const batches = Array.isArray(stats?.rollout_batches) ? stats.rollout_batches : [];
    if (batches.length > 0) {
      sb.push(['Rollout batches (staged sends in range)']);
      sb.push(['Campaign', 'Batch #', 'Sent', 'Open rate %', 'Click rate %']);
      for (const b of batches) {
        sb.push([
          b.campaign_name || '',
          b.batch_number ?? '',
          b.sent_count ?? 0,
          b.open_rate_pct ?? 0,
          b.click_rate_pct ?? 0
        ]);
      }
      sb.push([]);
    }
  }

  if (sectionEnabled(sections, DIGEST_SECTION_IDS.last_seven_days)) {
    sb.push(['Rolling 7 local days ending on anchor date (range end in timezone)']);
    sb.push(['Local date', 'Sent', 'Opens', 'Open rate %', 'Clicks', 'Click rate %']);
    const six = Array.isArray(stats?.last_seven_days)
      ? stats.last_seven_days
      : Array.isArray(stats?.last_six_days)
        ? stats.last_six_days
        : [];
    for (const row of six) {
      sb.push([
        row.local_date ? String(row.local_date) : '',
        row.sent ?? 0,
        row.opened ?? 0,
        row.open_rate_pct ?? 0,
        row.clicked ?? 0,
        row.click_rate_pct ?? 0
      ]);
    }
    sb.push([]);
  }

  if (sectionEnabled(sections, DIGEST_SECTION_IDS.unsubs)) {
    sb.push(['Unsubscribes (mail_unsubscribes in range)', stats?.unsubscribes_count ?? 0]);
    sb.push([]);
  }

  if (sectionEnabled(sections, DIGEST_SECTION_IDS.bounces)) {
    sb.push(['Bounces (mail_bounces table in range)', stats?.bounces_table_count ?? 0]);
    sb.push(['Bounced status rows (mail_campaign_sends)', stats?.bounced_status_count ?? 0]);
    sb.push([]);
  }

  if (sectionEnabled(sections, DIGEST_SECTION_IDS.failures)) {
    sb.push(['Failures (mail_campaign_sends status failed)', stats?.failures_count ?? 0]);
    sb.push([]);
  }

  if (sectionEnabled(sections, DIGEST_SECTION_IDS.suppression)) {
    sb.push(['Suppressed sends', stats?.suppressed_count ?? 0]);
    sb.push(['Blocked unsubscribed sends', stats?.unsubscribed_send_count ?? 0]);
    sb.push([]);
  }

  if (sectionEnabled(sections, DIGEST_SECTION_IDS.pending)) {
    sb.push(['Pending rows (mail_campaign_sends)', stats?.pending_count ?? 0]);
    sb.push([]);
  }

  if (sectionEnabled(sections, DIGEST_SECTION_IDS.extra_counts)) {
    sb.push(['Other']);
    sb.push(['Note', 'Rolling 7-day block uses the local calendar date of range_end in your timezone.']);
    sb.push([
      'Unsubscribes',
      'Counted by unsubscribed_at (when the person unsubscribed), not by original send date.'
    ]);
    sb.push([]);
  }

  const csvLines = [];
  for (const line of sb) {
    if (Array.isArray(line)) {
      csvLines.push(line.map(csvEscape).join(','));
    }
  }

  return csvLines.join('\n');
}
