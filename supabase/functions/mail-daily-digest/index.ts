/**
 * Daily mail digest: HTTP cron (x-mail-digest-cron-secret) or authenticated test send.
 *
 * Reliability model (not a fragile single-minute window):
 * - After the configured local send time, every cron tick may attempt until the day's digest is marked sent.
 * - Duplicate prevention: atomic claim on mail_settings.daily_digest_last_sent_on; rolled back on send failure.
 * - Dual triggers: 15-min digest cron + every-minute mail-process-schedules kick (fire-and-forget).
 * Auth: Bearer service role OR x-mail-digest-cron-secret (env or system_runtime_secrets).
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

/**
 * Digest is a platform-operational email (like HR/booking system mail): always use the verified
 * Tavari sender. Display name still comes from mail_settings / business so it reads as the venue.
 */
const DIGEST_FROM_EMAIL = "noreply@tavarios.ca";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-mail-digest-cron-secret, prefer, accept",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

function escapeHtml(s: string) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const FALLBACK_TZ = "America/Toronto";

/** Match app `getValidBusinessTimezone`: invalid or empty IANA → Toronto. */
function normalizeIanaTimeZone(raw: string | null | undefined): string {
  const s = String(raw ?? "").trim();
  if (!s) return FALLBACK_TZ;
  try {
    Intl.DateTimeFormat("en-CA", { timeZone: s }).format(new Date());
    return s;
  } catch {
    console.warn("[mail-daily-digest] invalid timezone, using fallback:", raw);
    return FALLBACK_TZ;
  }
}

/** Shown in email intro: IANA + browser-friendly zone name. */
function formatTimezoneForEmail(tz: string): string {
  const t = normalizeIanaTimeZone(tz);
  try {
    const d = new Date();
    const longName = new Intl.DateTimeFormat("en-CA", {
      timeZone: t,
      timeZoneName: "long",
    })
      .formatToParts(d)
      .find((p) => p.type === "timeZoneName")?.value;
    return longName ? `${t} (${longName})` : t;
  } catch {
    return t;
  }
}

type Sections = Record<string, boolean>;

function sectionOn(sections: Sections, key: string): boolean {
  return sections[key] !== false;
}

/** Prefer new key; legacy digest sections may still use last_six_days */
function sectionTrendOn(sections: Sections): boolean {
  return sectionOn(sections, "last_seven_days") || sectionOn(sections, "last_six_days");
}

function trendRows(stats: Record<string, unknown>): Record<string, unknown>[] {
  if (Array.isArray(stats.last_seven_days)) return stats.last_seven_days as Record<string, unknown>[];
  if (Array.isArray(stats.last_six_days)) return stats.last_six_days as Record<string, unknown>[];
  return [];
}

function buildMetricsGuideHtml(sections: Sections): string {
  if (!sectionOn(sections, "metrics_guide")) return "";
  return (
    `<h3 style="font-size:15px;margin:20px 0 8px 0;color:#0f172a;">How to read these numbers</h3>` +
    `<ul style="margin:0 0 16px 18px;padding:0;color:#334155;font-size:13px;line-height:1.55;">` +
    `<li style="margin-bottom:6px;"><strong>Denominator:</strong> Open and click rates use <strong>sent</strong> rows in this report window ` +
    `(one row per recipient delivery with status sent). That is your &quot;delivered&quot; base for the day or range.</li>` +
    `<li style="margin-bottom:6px;"><strong>Unique engagement per delivery:</strong> <strong>Open rate</strong> = deliveries with at least one open ÷ sent; ` +
    `<strong>click rate</strong> = deliveries with at least one tracked click ÷ sent (not total link clicks across the email).</li>` +
    `<li style="margin-bottom:6px;"><strong>Compare campaigns:</strong> Each campaign has its own 7-day table below — compare sends and engagement day by day (automations may fire only on some days).</li>` +
    `<li style="margin-bottom:0;"><strong>Segments / batches:</strong> When you use staged rollouts, the rollout batch table compares each batch; list-level segments otherwise show up as separate campaigns or exports.</li>` +
    `</ul>`
  );
}

function buildSummaryMetricsTable(stats: Record<string, unknown>, sections: Sections): string {
  const rows: { label: string; value: string }[] = [];
  if (sectionOn(sections, "total_sent")) {
    rows.push({ label: "Emails sent (delivered)", value: String(stats.sent_count ?? 0) });
  }
  if (sectionOn(sections, "open_rate")) {
    rows.push({ label: "Open rate (opens ÷ sent deliveries)", value: `${stats.open_rate_pct ?? 0}%` });
    rows.push({ label: "Opens counted (unique deliveries)", value: String(stats.opened_count ?? 0) });
  }
  if (sectionOn(sections, "click_rate")) {
    rows.push({ label: "Click rate (clicks ÷ sent deliveries)", value: `${stats.click_rate_pct ?? 0}%` });
    rows.push({ label: "Clicks counted (unique deliveries)", value: String(stats.clicked_count ?? 0) });
  }
  if (sectionOn(sections, "unsubs")) {
    rows.push({
      label: "Unsubscribes (withdrawals logged in this period — not tied to original send date)",
      value: String(stats.unsubscribes_count ?? 0),
    });
  }
  if (sectionOn(sections, "bounces")) {
    rows.push({ label: "Bounces (SES / notification table)", value: String(stats.bounces_table_count ?? 0) });
    rows.push({ label: "Bounced status (send log)", value: String(stats.bounced_status_count ?? 0) });
  }
  if (sectionOn(sections, "failures")) {
    rows.push({ label: "Failed sends", value: String(stats.failures_count ?? 0) });
  }
  if (sectionOn(sections, "suppression")) {
    rows.push({ label: "Suppressed at send", value: String(stats.suppressed_count ?? 0) });
    rows.push({
      label: "Blocked (already unsubscribed / consent)",
      value: String(stats.unsubscribed_send_count ?? 0),
    });
  }
  if (sectionOn(sections, "pending")) {
    rows.push({ label: "Pending rows", value: String(stats.pending_count ?? 0) });
  }
  if (rows.length === 0) return "";

  let html =
    `<h3 style="font-size:15px;margin:16px 0 8px 0;color:#0f172a;">Summary</h3>` +
    `<table role="presentation" style="border-collapse:collapse;width:100%;max-width:560px;font-size:13px;">` +
    `<thead><tr>` +
    `<th align="left" style="padding:8px 10px;border-bottom:1px solid #cbd5e1;color:#64748b;font-weight:700;">Metric</th>` +
    `<th align="right" style="padding:8px 10px;border-bottom:1px solid #cbd5e1;color:#64748b;font-weight:700;width:104px;">Qty</th>` +
    `</tr></thead><tbody>`;
  for (const r of rows) {
    html +=
      `<tr>` +
      `<td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;color:#334155;">${escapeHtml(r.label)}</td>` +
      `<td align="right" style="padding:8px 10px;border-bottom:1px solid #e2e8f0;font-weight:700;color:#0f172a;">${escapeHtml(r.value)}</td>` +
      `</tr>`;
  }
  html += `</tbody></table>`;
  return html;
}

function buildDigestHtml(
  stats: Record<string, unknown>,
  sections: Sections,
  businessName: string,
  localDate: string,
): string {
  const blocks: string[] = [];
  blocks.push(`<h2 style="margin:0 0 12px 0;font-size:18px;color:#0f172a;">Daily mail stats</h2>`);
  blocks.push(
    `<p style="margin:0 0 16px 0;color:#475569;font-size:14px;line-height:1.5;">${escapeHtml(businessName)} · Local date ${escapeHtml(localDate)} · Report timezone: ${escapeHtml(formatTimezoneForEmail(String(stats.timezone || "")))}</p>`,
  );

  const summaryTable = buildSummaryMetricsTable(stats, sections);
  if (summaryTable) blocks.push(summaryTable);

  const metricsGuide = buildMetricsGuideHtml(sections);
  if (metricsGuide) blocks.push(metricsGuide);

  if (sectionOn(sections, "campaigns_breakdown")) {
    const perCamp = Array.isArray(stats.campaigns_seven_day) ? stats.campaigns_seven_day : [];
    const digestDayById = new Map<string, Record<string, unknown>>();
    for (const c of Array.isArray(stats.campaigns) ? stats.campaigns : []) {
      digestDayById.set(String((c as Record<string, unknown>).campaign_id ?? ""), c as Record<string, unknown>);
    }
    const anchorStr = String(stats.anchor_local_date ?? localDate);

    if (perCamp.length > 0) {
      blocks.push(
        `<h3 style="font-size:15px;margin:16px 0 8px 0;">Campaigns — last 7 local days (ending ${escapeHtml(anchorStr)})</h3>` +
          `<p style="margin:0 0 14px 0;color:#64748b;font-size:12px;line-height:1.45;">` +
          `Each block is one campaign. Rows are calendar days in your timezone; days with no sends show zeros. ` +
          `The line under the title is <strong>today&apos;s digest window only</strong> (not the full week).</p>`,
      );
      for (const camp of perCamp) {
        const cid = String((camp as Record<string, unknown>).campaign_id ?? "");
        const snap = digestDayById.get(cid);
        const snapLine = snap
          ? `<p style="margin:0 0 8px 0;color:#475569;font-size:12px;">Digest day totals: sent ${escapeHtml(String(snap.sent_count ?? 0))} · open ${escapeHtml(String(snap.open_rate_pct ?? 0))}% · click ${escapeHtml(String(snap.click_rate_pct ?? 0))}%</p>`
          : "";
        const days = Array.isArray((camp as Record<string, unknown>).days)
          ? ((camp as Record<string, unknown>).days as Record<string, unknown>[])
          : [];
        let drows = "";
        for (const r of days) {
          drows +=
            `<tr><td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;">${escapeHtml(String(r.local_date ?? ""))}</td>` +
            `<td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;">${escapeHtml(String(r.sent ?? 0))}</td>` +
            `<td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;">${escapeHtml(String(r.open_rate_pct ?? 0))}%</td>` +
            `<td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;">${escapeHtml(String(r.click_rate_pct ?? 0))}%</td>` +
            `<td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;color:#64748b;">${escapeHtml(String(r.opened ?? 0))}</td>` +
            `<td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;color:#64748b;">${escapeHtml(String(r.clicked ?? 0))}</td></tr>`;
        }
        blocks.push(
          `<div style="margin-bottom:20px;border:1px solid #e2e8f0;border-radius:8px;padding:12px;background:#fafafa;">` +
            `<h4 style="margin:0 0 6px 0;font-size:14px;color:#0f172a;">${escapeHtml(String((camp as Record<string, unknown>).name ?? "Campaign"))}</h4>` +
            snapLine +
            `<table style="border-collapse:collapse;width:100%;max-width:560px;font-size:12px;background:#fff;">` +
            `<thead><tr>` +
            `<th align="left" style="padding:6px 8px;border-bottom:1px solid #cbd5e1;">Date</th>` +
            `<th align="left" style="padding:6px 8px;border-bottom:1px solid #cbd5e1;">Sent</th>` +
            `<th align="left" style="padding:6px 8px;border-bottom:1px solid #cbd5e1;">Open %</th>` +
            `<th align="left" style="padding:6px 8px;border-bottom:1px solid #cbd5e1;">Click %</th>` +
            `<th align="left" style="padding:6px 8px;border-bottom:1px solid #cbd5e1;">Opens</th>` +
            `<th align="left" style="padding:6px 8px;border-bottom:1px solid #cbd5e1;">Clicks</th>` +
            `</tr></thead><tbody>${drows}</tbody></table></div>`,
        );
      }
    } else {
      const camps = Array.isArray(stats.campaigns) ? stats.campaigns : [];
      let rows = "";
      for (const c of camps) {
        rows +=
          `<tr><td style="padding:8px;border-bottom:1px solid #e2e8f0;">${escapeHtml(String(c.name ?? ""))}</td>` +
          `<td style="padding:8px;border-bottom:1px solid #e2e8f0;">${escapeHtml(String(c.sent_count ?? 0))}</td>` +
          `<td style="padding:8px;border-bottom:1px solid #e2e8f0;">${escapeHtml(String(c.opened_count ?? 0))}</td>` +
          `<td style="padding:8px;border-bottom:1px solid #e2e8f0;">${escapeHtml(String(c.open_rate_pct ?? 0))}%</td>` +
          `<td style="padding:8px;border-bottom:1px solid #e2e8f0;">${escapeHtml(String(c.clicked_count ?? 0))}</td>` +
          `<td style="padding:8px;border-bottom:1px solid #e2e8f0;">${escapeHtml(String(c.click_rate_pct ?? 0))}%</td></tr>`;
      }
      blocks.push(
        `<h3 style="font-size:15px;margin:16px 0 8px 0;">Campaigns (digest day only)</h3>` +
          `<table style="border-collapse:collapse;width:100%;max-width:560px;font-size:13px;">` +
          `<thead><tr><th align="left" style="padding:8px;border-bottom:1px solid #cbd5e1;">Campaign</th>` +
          `<th align="left" style="padding:8px;border-bottom:1px solid #cbd5e1;">Sent</th>` +
          `<th align="left" style="padding:8px;border-bottom:1px solid #cbd5e1;">Opens</th>` +
          `<th align="left" style="padding:8px;border-bottom:1px solid #cbd5e1;">Open %</th>` +
          `<th align="left" style="padding:8px;border-bottom:1px solid #cbd5e1;">Clicks</th>` +
          `<th align="left" style="padding:8px;border-bottom:1px solid #cbd5e1;">Click %</th></tr></thead><tbody>` +
          (rows ||
            `<tr><td colspan="6" style="padding:8px;color:#64748b;">No sends in range</td></tr>`) +
          `</tbody></table>`,
      );
    }
  }

  if (sectionOn(sections, "rollout_batches")) {
    const batches = Array.isArray(stats.rollout_batches) ? stats.rollout_batches : [];
    if (batches.length > 0) {
      let rows = "";
      for (const b of batches) {
        rows +=
          `<tr><td style="padding:8px;border-bottom:1px solid #e2e8f0;">${escapeHtml(String(b.campaign_name ?? ""))}</td>` +
          `<td style="padding:8px;border-bottom:1px solid #e2e8f0;">${escapeHtml(String(b.batch_number ?? ""))}</td>` +
          `<td style="padding:8px;border-bottom:1px solid #e2e8f0;">${escapeHtml(String(b.sent_count ?? 0))}</td>` +
          `<td style="padding:8px;border-bottom:1px solid #e2e8f0;">${escapeHtml(String(b.open_rate_pct ?? 0))}%</td>` +
          `<td style="padding:8px;border-bottom:1px solid #e2e8f0;">${escapeHtml(String(b.click_rate_pct ?? 0))}%</td></tr>`;
      }
      blocks.push(
        `<h3 style="font-size:15px;margin:16px 0 8px 0;">Rollout batches (segment-style slices)</h3>` +
          `<p style="margin:0 0 10px 0;color:#64748b;font-size:12px;line-height:1.45;">` +
          `Each row is a staged batch from a campaign rollout with sends in this period — useful for comparing audiences.</p>` +
          `<table style="border-collapse:collapse;width:100%;max-width:560px;font-size:13px;">` +
          `<thead><tr><th align="left" style="padding:8px;border-bottom:1px solid #cbd5e1;">Campaign</th>` +
          `<th align="left" style="padding:8px;border-bottom:1px solid #cbd5e1;">Batch</th>` +
          `<th align="left" style="padding:8px;border-bottom:1px solid #cbd5e1;">Sent</th>` +
          `<th align="left" style="padding:8px;border-bottom:1px solid #cbd5e1;">Open %</th>` +
          `<th align="left" style="padding:8px;border-bottom:1px solid #cbd5e1;">Click %</th></tr></thead><tbody>${rows}</tbody></table>`,
      );
    }
  }

  if (sectionTrendOn(sections)) {
    const seven = trendRows(stats);
    let rows = "";
    for (const r of seven) {
      rows +=
        `<tr><td style="padding:8px;border-bottom:1px solid #e2e8f0;">${escapeHtml(String(r.local_date ?? ""))}</td>` +
        `<td style="padding:8px;border-bottom:1px solid #e2e8f0;">${escapeHtml(String(r.sent ?? 0))}</td>` +
        `<td style="padding:8px;border-bottom:1px solid #e2e8f0;">${escapeHtml(String(r.open_rate_pct ?? 0))}%</td>` +
        `<td style="padding:8px;border-bottom:1px solid #e2e8f0;">${escapeHtml(String(r.click_rate_pct ?? 0))}%</td>` +
        `</tr>`;
    }
    blocks.push(
      `<h3 style="font-size:15px;margin:16px 0 8px 0;">7-day open &amp; click trend</h3>` +
        `<table style="border-collapse:collapse;width:100%;max-width:560px;font-size:13px;">` +
        `<thead><tr><th align="left" style="padding:8px;border-bottom:1px solid #cbd5e1;">Date</th>` +
        `<th align="left" style="padding:8px;border-bottom:1px solid #cbd5e1;">Sent</th>` +
        `<th align="left" style="padding:8px;border-bottom:1px solid #cbd5e1;">Open %</th>` +
        `<th align="left" style="padding:8px;border-bottom:1px solid #cbd5e1;">Click %</th>` +
        `</tr></thead><tbody>${rows}</tbody></table>` +
        `<p style="margin:10px 0 0 0;color:#64748b;font-size:12px;line-height:1.45;">` +
        `Percentages are opens or clicks ÷ sent deliveries that calendar day (local timezone).</p>`,
    );
  }

  if (sectionOn(sections, "extra_counts")) {
    blocks.push(
      `<p style="font-size:12px;color:#64748b;margin-top:16px;line-height:1.45;">` +
        `Rolling 7-day trend ends on the report anchor date (range end in your timezone). ` +
        `Unsubscribes count consent events by when they occurred, including unsubscribes from older sends.</p>`,
    );
  }

  return `<!DOCTYPE html><html><body style="font-family:system-ui,-apple-system,sans-serif;line-height:1.5;color:#0f172a;max-width:640px;margin:0 auto;padding:20px;">${blocks.join("")}</body></html>`;
}

function getLocalHourMinute(d: Date, timeZone: string): { hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(d);
  // Some ICU builds return "24" for midnight with hour12:false — normalize to 0.
  let hour = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10);
  if (hour === 24) hour = 0;
  const minute = parseInt(parts.find((p) => p.type === "minute")?.value ?? "0", 10);
  return { hour, minute };
}

function parseRecipientList(raw: string): string[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s));
}

/**
 * True once local wall-clock is at/after the configured send time today.
 * Keeps retrying for the rest of the local calendar day (until last_sent_on catches up).
 */
function isAtOrAfterDigestSendTime(
  localHour: number,
  localMinute: number,
  digestHour: number,
  digestMinuteExplicit: number | null,
): boolean {
  const digestMinute = digestMinuteExplicit ?? 0;
  return localHour * 60 + localMinute >= digestHour * 60 + digestMinute;
}

async function recordDigestAttempt(
  supabase: ReturnType<typeof createClient>,
  businessId: string,
  errorMessage: string | null,
) {
  try {
    await supabase
      .from("mail_settings")
      .update({
        daily_digest_last_attempt_at: new Date().toISOString(),
        daily_digest_last_error: errorMessage,
      })
      .eq("business_id", businessId);
  } catch (e) {
    console.warn("[mail-daily-digest] failed to record attempt:", e);
  }
}

async function runCron(
  supabase: ReturnType<typeof createClient>,
  supabaseUrl: string,
  serviceKey: string,
  options: { force?: boolean } = {},
) {
  const forceSend = options.force === true;
  const { data: rows, error } = await supabase
    .from("mail_settings")
    .select(
      "business_id, daily_digest_recipients, daily_digest_sections, daily_digest_last_sent_on, daily_digest_send_hour, daily_digest_send_minute, daily_digest_timezone",
    )
    .eq("daily_digest_enabled", true);

  if (error) {
    return new Response(JSON.stringify({ ok: false, error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let sent = 0;
  const errors: string[] = [];
  const skips: Array<{ business_id: string; reason: string; detail?: string }> = [];

  for (const row of rows ?? []) {
    const businessId = row.business_id as string;
    let previousLastSent: string | null = row.daily_digest_last_sent_on
      ? String(row.daily_digest_last_sent_on)
      : null;
    let claimedToday: string | null = null;

    try {
      const rawRecipients = String(row.daily_digest_recipients ?? "");
      const recipients = parseRecipientList(rawRecipients);
      if (recipients.length === 0) {
        skips.push({ business_id: businessId, reason: "no_valid_recipients" });
        continue;
      }

      const { data: biz } = await supabase
        .from("businesses")
        .select("timezone, name")
        .eq("id", businessId)
        .single();

      const overrideTz = String((row as Record<string, unknown>).daily_digest_timezone ?? "").trim();
      const tz = normalizeIanaTimeZone(overrideTz || (biz?.timezone as string | null) || "");
      const businessName = biz?.name || "Your business";

      const now = new Date();
      const { hour, minute } = getLocalHourMinute(now, tz);
      const rawDigestHour = row.daily_digest_send_hour;
      const digestHour = Math.min(
        23,
        Math.max(0, Number.isFinite(Number(rawDigestHour)) ? Number(rawDigestHour) : 20),
      );
      const rawDigestMinute = (row as Record<string, unknown>).daily_digest_send_minute;
      const digestMinuteExplicit =
        rawDigestMinute === null || rawDigestMinute === undefined || rawDigestMinute === ""
          ? null
          : Math.min(
            59,
            Math.max(0, Number.isFinite(Number(rawDigestMinute)) ? Number(rawDigestMinute) : 0),
          );

      if (!forceSend && !isAtOrAfterDigestSendTime(hour, minute, digestHour, digestMinuteExplicit)) {
        skips.push({
          business_id: businessId,
          reason: "before_digest_send_time_local",
          detail:
            `local=${hour}:${String(minute).padStart(2, "0")} tz=${tz} target=${digestHour}:${String(digestMinuteExplicit ?? 0).padStart(2, "0")} (retries for rest of local day once due)`,
        });
        continue;
      }

      const { data: bounds } = await supabase.rpc("mail_daily_digest_day_bounds", {
        p_timezone: tz,
        p_instant: now.toISOString(),
      });
      if (!bounds?.local_date || !bounds?.range_start || !bounds?.range_end) {
        skips.push({ business_id: businessId, reason: "day_bounds_failed" });
        await recordDigestAttempt(supabase, businessId, "day_bounds_failed");
        continue;
      }

      const todayStr = String(bounds.local_date);
      if (!forceSend && previousLastSent && previousLastSent === todayStr) {
        skips.push({ business_id: businessId, reason: "already_sent_today", detail: todayStr });
        continue;
      }

      // Atomic claim so dual cron triggers cannot double-send. Roll back on failure.
      // Force resend: keep last_sent_on as today but still proceed to mail-send.
      if (!forceSend || previousLastSent !== todayStr) {
        const claimQuery = supabase
          .from("mail_settings")
          .update({
            daily_digest_last_sent_on: todayStr,
            daily_digest_last_attempt_at: now.toISOString(),
            daily_digest_last_error: null,
          })
          .eq("business_id", businessId);

        const { data: claimedRows, error: claimError } = previousLastSent
          ? await claimQuery.eq("daily_digest_last_sent_on", previousLastSent).select("business_id")
          : await claimQuery.is("daily_digest_last_sent_on", null).select("business_id");

        if (claimError) {
          errors.push(`${businessId}: claim ${claimError.message}`);
          await recordDigestAttempt(supabase, businessId, `claim ${claimError.message}`);
          continue;
        }
        if (!claimedRows || claimedRows.length === 0) {
          skips.push({
            business_id: businessId,
            reason: "already_claimed_or_sent",
            detail: todayStr,
          });
          continue;
        }
        claimedToday = todayStr;
      } else {
        claimedToday = todayStr;
        await recordDigestAttempt(supabase, businessId, null);
      }

      const { data: stats, error: sErr } = await supabase.rpc("mail_daily_digest_stats", {
        p_business_id: businessId,
        p_range_start: bounds.range_start,
        p_range_end: bounds.range_end,
        p_timezone: tz,
      });
      if (sErr || !stats) {
        const msg = sErr?.message ?? "stats failed";
        errors.push(`${businessId}: ${msg}`);
        await supabase
          .from("mail_settings")
          .update({
            daily_digest_last_sent_on: previousLastSent,
            daily_digest_last_attempt_at: new Date().toISOString(),
            daily_digest_last_error: msg,
          })
          .eq("business_id", businessId)
          .eq("daily_digest_last_sent_on", todayStr);
        claimedToday = null;
        continue;
      }

      const { data: ms } = await supabase
        .from("mail_settings")
        .select("from_email, from_name")
        .eq("business_id", businessId)
        .maybeSingle();

      const fromEmail = DIGEST_FROM_EMAIL;
      const sections = (row.daily_digest_sections as Sections) || {};
      const html = buildDigestHtml(stats as Record<string, unknown>, sections, businessName, todayStr);
      const subject = `Daily mail stats — ${businessName} — ${todayStr}`;

      const mailRes = await fetch(`${supabaseUrl}/functions/v1/mail-send`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
        },
        body: JSON.stringify({
          businessId,
          campaignId: crypto.randomUUID(),
          emailType: "transactional",
          to: recipients.join(", "),
          fromEmail,
          fromName: ms?.from_name || businessName,
          subject,
          html,
          text: `Daily mail stats for ${todayStr}.`,
        }),
      });

      const mailJson = await mailRes.json().catch(() => null);
      if (!mailRes.ok || mailJson?.ok !== true) {
        const msg = `mail-send ${mailJson?.error || mailRes.status}`;
        errors.push(`${businessId}: ${msg}`);
        await supabase
          .from("mail_settings")
          .update({
            daily_digest_last_sent_on: previousLastSent,
            daily_digest_last_attempt_at: new Date().toISOString(),
            daily_digest_last_error: msg,
          })
          .eq("business_id", businessId)
          .eq("daily_digest_last_sent_on", todayStr);
        claimedToday = null;
        continue;
      }

      await recordDigestAttempt(supabase, businessId, null);
      sent += 1;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`${businessId}: ${msg}`);
      if (claimedToday) {
        await supabase
          .from("mail_settings")
          .update({
            daily_digest_last_sent_on: previousLastSent,
            daily_digest_last_attempt_at: new Date().toISOString(),
            daily_digest_last_error: msg,
          })
          .eq("business_id", businessId)
          .eq("daily_digest_last_sent_on", claimedToday);
      } else {
        await recordDigestAttempt(supabase, businessId, msg);
      }
    }
  }

  return new Response(
    JSON.stringify({
      ok: true,
      processed: rows?.length ?? 0,
      sent,
      skips,
      errors,
      hint:
        "Digest sends at/after the configured local time and retries every cron tick until daily_digest_last_sent_on matches today. Dual-triggered by digest cron + mail-process-schedules.",
    }),
    {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    },
  );
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
  const CRON_SECRET = Deno.env.get("MAIL_DIGEST_CRON_SECRET") ?? "";

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const cronHeader = req.headers.get("x-mail-digest-cron-secret") ?? "";
    const authHeader = req.headers.get("Authorization") ?? "";
    let cronSecretOk = Boolean(CRON_SECRET && cronHeader === CRON_SECRET);
    if (!cronSecretOk && cronHeader) {
      const { data: secretRow } = await supabase
        .from("system_runtime_secrets")
        .select("secret_value")
        .eq("key_name", "mail_digest_cron_secret")
        .maybeSingle();
      cronSecretOk = Boolean(
        secretRow?.secret_value && String(secretRow.secret_value) === cronHeader,
      );
    }
    const serviceRoleBearerOk = authHeader === `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`;
    const cronBody = await req.json().catch(() => ({}));

    if (req.method === "POST" && (cronSecretOk || serviceRoleBearerOk)) {
      return await runCron(supabase, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
        force: cronBody?.force === true && serviceRoleBearerOk,
      });
    }

    if (req.method !== "POST") {
      return new Response(JSON.stringify({ ok: false, error: "Method not allowed" }), {
        status: 405,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = cronBody;
    const action = String(body?.action ?? "");

    if (action !== "test") {
      return new Response(JSON.stringify({ ok: false, error: "Unknown action" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const businessId = String(body?.businessId ?? "").trim();
    if (!businessId) {
      return new Response(JSON.stringify({ ok: false, error: "businessId required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user?.id) {
      return new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const uid = userData.user.id;
    const { data: bu } = await supabase
      .from("business_users")
      .select("id")
      .eq("business_id", businessId)
      .eq("user_id", uid)
      .maybeSingle();
    const { data: ur } = await supabase
      .from("user_roles")
      .select("id")
      .eq("business_id", businessId)
      .eq("user_id", uid)
      .maybeSingle();
    if (!bu && !ur) {
      return new Response(JSON.stringify({ ok: false, error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const recipientRaw = String(body?.recipients ?? "").trim();
    const recipients = parseRecipientList(recipientRaw);
    if (recipients.length === 0) {
      return new Response(JSON.stringify({ ok: false, error: "No valid recipient emails" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: biz } = await supabase
      .from("businesses")
      .select("timezone, name")
      .eq("id", businessId)
      .single();

    const { data: msRow } = await supabase
      .from("mail_settings")
      .select("daily_digest_timezone, from_email, from_name, daily_digest_sections")
      .eq("business_id", businessId)
      .maybeSingle();

    const overrideTz = String(msRow?.daily_digest_timezone ?? "").trim();
    const tz = normalizeIanaTimeZone(overrideTz || (biz?.timezone as string | null) || "");
    const businessName = biz?.name || "Your business";

    const { data: bounds, error: bErr } = await supabase.rpc("mail_daily_digest_day_bounds", {
      p_timezone: tz,
      p_instant: new Date().toISOString(),
    });
    if (bErr || !bounds?.range_start || !bounds?.range_end) {
      return new Response(JSON.stringify({ ok: false, error: bErr?.message ?? "bounds failed" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: stats, error: sErr } = await supabase.rpc("mail_daily_digest_stats", {
      p_business_id: businessId,
      p_range_start: bounds.range_start,
      p_range_end: bounds.range_end,
      p_timezone: tz,
    });
    if (sErr || !stats) {
      return new Response(JSON.stringify({ ok: false, error: sErr?.message ?? "stats failed" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const sections =
      body?.sections && typeof body.sections === "object"
        ? (body.sections as Sections)
        : ((msRow?.daily_digest_sections as Sections) || {});
    const fromEmail = DIGEST_FROM_EMAIL;

    const localDate = String(bounds.local_date ?? "");
    const html = buildDigestHtml(stats as Record<string, unknown>, sections, businessName, localDate);
    const subject = `Daily mail stats — ${businessName} — ${localDate}`;

    const mailRes = await fetch(`${SUPABASE_URL}/functions/v1/mail-send`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({
        businessId,
        campaignId: crypto.randomUUID(),
        emailType: "transactional",
        to: recipients.join(", "),
        fromEmail,
        fromName: msRow?.from_name || businessName,
        subject,
        html,
        text: `Daily mail stats for ${localDate}. Open this email in HTML for full details.`,
      }),
    });

    const mailJson = await mailRes.json().catch(() => null);
    if (!mailRes.ok || mailJson?.ok !== true) {
      return new Response(
        JSON.stringify({ ok: false, error: mailJson?.error || `mail-send ${mailRes.status}` }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
