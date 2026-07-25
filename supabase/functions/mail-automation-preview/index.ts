import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  buildBirthdayDeliveryKey,
  filterBirthdayCandidatesForPriorSendSuppression,
  normalizeNamePart,
} from "../_shared/birthdayAutomationSuppression.ts";
import {
  buildToddlerThursdayDeliveryKey,
  formatPromoThursdayDisplay,
  formatToddlerNamesList,
  getContactCohort,
  resolveToddlerThursdayPreviewSchedule,
  type ToddlerThursdayCriteria,
} from "../_shared/toddlerThursday.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
/** Prefer ?? so authorizeRequest can return 401 instead of passing undefined into createClient */
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const AUTOMATION_SEND_START_HOUR = 7;
const AUTOMATION_SEND_END_HOUR = 19;
const SUPABASE_PAGE_SIZE = 1000;
/** Prevents infinite loops when PostgREST ignores .range() on a table query (same as mail-name-of-day minor pool). */
const TABLE_PAGE_MAX_LOOPS = 500;
/** Avoid giant preview payloads / huge Array.from in buildAutomationSendSlots (worker memory / timeout → 500). */
const MAX_BIRTHDAY_PREVIEW_ROWS = 2500;
/** Stop scanning waivers after this many pages (1000 rows each) so birthday preview does not hit statement/edge timeouts. */
const BIRTHDAY_PREVIEW_MAX_PAGES = 30;

async function fetchPagedTable<T>(
  label: string,
  pageSize: number,
  rowKey: (row: T) => string,
  fetchOnce: (from: number, to: number) => Promise<{ data: T[] | null; error: { message?: string } | null }>,
  maxPages: number | null = null,
): Promise<T[]> {
  const out: T[] = [];
  let prevKey: string | null = null;
  const pageCap = maxPages != null && maxPages > 0 ? maxPages : TABLE_PAGE_MAX_LOOPS;
  for (let page = 0; page < pageCap; page++) {
    const from = page * pageSize;
    const to = from + pageSize - 1;
    const { data, error } = await fetchOnce(from, to);
    if (error) throw error;
    const batch = data || [];
    if (batch.length === 0) break;
    const k = rowKey(batch[0]!);
    if (page > 0 && k === prevKey) {
      console.warn(
        `[mail-automation-preview] ${label}: got duplicate first row (Range may be ignored); stopping pagination`,
      );
      break;
    }
    prevKey = k;
    out.push(...batch);
    if (batch.length < pageSize) break;
  }
  return out;
}

function formatUniqueMinorFirstNames(minors: { first: string }[]): string {
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const m of minors) {
    const raw = String(m.first || "").trim();
    if (!raw) continue;
    const key = raw.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    parts.push(raw);
  }
  return parts.join(", ");
}

type NodPoolRow = {
  participant_id: string;
  waiver_id: string;
  minor_first: string;
  minor_dob: string | null;
  guardian_email: string;
  signed_at: string | null;
  gender_hint?: string | null;
};

/** Same branch split as mail-name-of-day — avoids single-statement timeout on large tenants. */
const NOD_PREVIEW_BRANCHES = ["modern", "legacy_minors", "legacy_info", "legacy_notes"] as const;
const NOD_PREVIEW_ROW_CAP = 4000;

/**
 * Preview only: when a pick exists, load minors matching the two normalized names (DB RPC) — no full-pool scan.
 * When no pick, return [] and let the UI skip pool size (avoids statement timeout on large tenants).
 */
async function loadNameOfDayPreviewPoolRows(
  supabase: ReturnType<typeof createClient>,
  businessId: string,
  pickRow: { girl_normalized?: string | null; boy_normalized?: string | null } | null,
): Promise<NodPoolRow[]> {
  const gn = String(pickRow?.girl_normalized ?? "").trim();
  const bn = String(pickRow?.boy_normalized ?? "").trim();
  if (!gn && !bn) return [];

  const chunks = await Promise.all(
    NOD_PREVIEW_BRANCHES.map((branch) =>
      supabase.rpc("mail_name_of_day_minor_pool_for_preview_branch", {
        p_business_id: businessId,
        p_girl_norm: gn,
        p_boy_norm: bn,
        p_branch: branch,
      })
    ),
  );
  for (const { error } of chunks) {
    if (error) throw error;
  }
  const out = chunks
    .flatMap((c) => (c.data || []) as NodPoolRow[])
    .slice(0, NOD_PREVIEW_ROW_CAP);
  return out;
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type PreviewPayload = {
  businessId?: string;
  automationId?: string;
  previewDate?: string;
};

function jsonResponse(body: unknown, status = 200) {
  try {
    return new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (serializeErr) {
    const msg = serializeErr instanceof Error ? serializeErr.message : String(serializeErr);
    return new Response(
      JSON.stringify({ ok: false, error: "Failed to serialize response", detail: msg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    const any = error as { details?: string; hint?: string; code?: string };
    let msg = error.message || "Error";
    if (typeof any.details === "string" && any.details.trim()) msg = `${msg}: ${any.details}`;
    if (typeof any.hint === "string" && any.hint.trim()) msg = `${msg} (${any.hint})`;
    if (typeof any.code === "string" && any.code) msg = `${msg} [${any.code}]`;
    return msg;
  }
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message?: unknown }).message || "Unknown error");
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function normalizeDateString(value: unknown) {
  const text = String(value || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  return new Date().toISOString().slice(0, 10);
}

function getDateTimePartsInTimeZone(date: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timeZone || "America/Toronto",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts = formatter.formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(values.year) || 1970,
    month: Number(values.month) || 1,
    day: Number(values.day) || 1,
    hour: Number(values.hour) || 0,
    minute: Number(values.minute) || 0,
    second: Number(values.second) || 0,
  };
}

function localDateTimeToUtcIso(dateString: string, hour: number, minute: number, timeZone: string) {
  const [year, month, day] = String(dateString || "1970-01-01")
    .split("-")
    .map((value) => Number(value) || 0);
  const desiredWallMs = Date.UTC(year, Math.max(month - 1, 0), day || 1, hour, minute, 0);
  let utcDate = new Date(desiredWallMs);

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const actual = getDateTimePartsInTimeZone(utcDate, timeZone);
    const actualWallMs = Date.UTC(
      actual.year,
      Math.max(actual.month - 1, 0),
      actual.day,
      actual.hour,
      actual.minute,
      actual.second,
    );
    utcDate = new Date(utcDate.getTime() + (desiredWallMs - actualWallMs));
  }

  return utcDate.toISOString();
}

function getAutomationSendWindow(criteria: Record<string, unknown>) {
  const rawWindow = criteria.send_window && typeof criteria.send_window === "object"
    ? criteria.send_window as Record<string, unknown>
    : {};
  const rawStartHour = Number(rawWindow.start_hour);
  const rawEndHour = Number(rawWindow.end_hour);
  const rawMinuteOffset = Number(rawWindow.minute_offset);
  const startHour = Math.min(23, Math.max(0, Number.isFinite(rawStartHour) ? rawStartHour : AUTOMATION_SEND_START_HOUR));
  const endHour = Math.min(23, Math.max(startHour, Number.isFinite(rawEndHour) ? rawEndHour : AUTOMATION_SEND_END_HOUR));
  const minuteOffset = Math.min(59, Math.max(0, Number.isFinite(rawMinuteOffset) ? rawMinuteOffset : 0));

  return {
    start_hour: startHour,
    end_hour: endHour,
    minute_offset: minuteOffset,
  };
}

function buildAutomationSendSlots(
  totalRecipients: number,
  sendDate: string,
  timeZone: string,
  sendWindow: { start_hour: number; end_hour: number; minute_offset: number },
) {
  const slotCount = sendWindow.end_hour - sendWindow.start_hour + 1;
  if (totalRecipients <= 0) return [];

  return Array.from({ length: totalRecipients }, (_, index) => {
    const slotIndex = totalRecipients <= slotCount
      ? index
      : Math.floor((index * slotCount) / totalRecipients);
    const localHour = sendWindow.start_hour + Math.min(slotIndex, slotCount - 1);
    const localMinute = sendWindow.minute_offset;
    return {
      local_hour: localHour,
      local_minute: localMinute,
      local_time: `${sendDate} ${String(localHour).padStart(2, "0")}:${String(localMinute).padStart(2, "0")}`,
      scheduled_for: localDateTimeToUtcIso(sendDate, localHour, localMinute, timeZone),
      time_zone: timeZone || "America/Toronto",
    };
  });
}

function shiftDateString(dateString: string, dayDelta: number) {
  const [year, month, day] = String(dateString || "1970-01-01")
    .split("-")
    .map((value) => Number(value) || 0);
  const date = new Date(Date.UTC(year, Math.max(month - 1, 0), day || 1));
  date.setUTCDate(date.getUTCDate() + dayDelta);
  return date.toISOString().slice(0, 10);
}

function monthDayKey(dateString: string) {
  return String(dateString || "").slice(5, 10);
}

function calculateAgeOnDate(dateOfBirth: string, onDate: string) {
  const dob = new Date(`${String(dateOfBirth || "").slice(0, 10)}T00:00:00Z`);
  const target = new Date(`${String(onDate || "").slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(dob.getTime()) || Number.isNaN(target.getTime())) return null;

  let age = target.getUTCFullYear() - dob.getUTCFullYear();
  const monthDelta = target.getUTCMonth() - dob.getUTCMonth();
  if (monthDelta < 0 || (monthDelta === 0 && target.getUTCDate() < dob.getUTCDate())) {
    age -= 1;
  }
  return age;
}

function isTriggeringMinorEligibleByMaxChildAge(
  minorDateOfBirth: string,
  eventDate: string,
  maxChildAge: number | null,
) {
  if (maxChildAge == null || !Number.isFinite(maxChildAge)) return true;
  const age = calculateAgeOnDate(minorDateOfBirth, eventDate);
  return age != null && age <= maxChildAge;
}

/**
 * Same resolution rules as `mail-process-schedules` `fetchEligibleMailContactsByEmail`:
 * paginate `mail_contacts` and match parent emails case-insensitively (`.in("email", …)` is case-sensitive in Postgres).
 */
async function fetchContactsByEmail(
  supabase: ReturnType<typeof createClient>,
  businessId: string,
  emails: string[],
) {
  const contacts: Array<Record<string, unknown>> = [];
  const emailSet = new Set(
    emails.map((email) => String(email || "").trim().toLowerCase()).filter(Boolean),
  );
  if (emailSet.size === 0) return contacts;

  for (let from = 0; ; from += SUPABASE_PAGE_SIZE) {
    const { data, error } = await supabase
      .from("mail_contacts")
      .select("id, email, first_name, last_name, subscribed, consent_method, consent_timestamp")
      .eq("business_id", businessId)
      .eq("subscribed", true)
      .not("consent_method", "is", null)
      .not("consent_timestamp", "is", null)
      .order("id", { ascending: true })
      .range(from, from + SUPABASE_PAGE_SIZE - 1);

    if (error) throw error;
    contacts.push(...(data || []).filter((contact) => (
      emailSet.has(String(contact.email || "").trim().toLowerCase())
    )));
    if (!data || data.length < SUPABASE_PAGE_SIZE) break;
  }

  return contacts;
}

async function fetchModernMinorParticipantRows(
  supabase: ReturnType<typeof createClient>,
  businessId: string,
  options?: { maxPages?: number },
) {
  return await fetchPagedTable(
    "waiver_participants(minor+dob)",
    SUPABASE_PAGE_SIZE,
    (r) => String((r as { id?: string }).id ?? ""),
    (from, to) =>
      supabase
        .from("waiver_participants")
        .select(`
        id,
        first_name,
        last_name,
        date_of_birth,
        waiver:waiver_signatures!inner(id,business_id,email,signed_at)
      `)
        .eq("participant_type", "minor")
        .eq("waiver.business_id", businessId)
        .not("date_of_birth", "is", null)
        .order("id", { ascending: true })
        .range(from, to),
    options?.maxPages ?? null,
  );
}

async function fetchLegacyWaiverRows(
  supabase: ReturnType<typeof createClient>,
  businessId: string,
) {
  return await fetchPagedTable(
    "legacy_waivers(legacy_minors)",
    SUPABASE_PAGE_SIZE,
    (r) => String((r as { id?: string }).id ?? ""),
    (from, to) =>
      supabase
        .from("legacy_waivers")
        .select("id,email,first_name,last_name,legacy_minors,signed_at")
        .eq("business_id", businessId)
        .is("deleted_at", null)
        .not("legacy_minors", "is", null)
        .order("id", { ascending: true })
        .range(from, to),
  );
}

function normalizeModernParticipantRow(row: any) {
  const waiver = Array.isArray(row?.waiver) ? row.waiver[0] : row?.waiver;
  const email = String(waiver?.email || "").trim().toLowerCase();
  const dob = String(row?.date_of_birth || "").trim();
  if (!email || !dob) return null;

  return {
    source: "modern_waiver_participants",
    waiver_id: String(waiver?.id || ""),
    email,
    minor_first_name: String(row?.first_name || "").trim(),
    minor_last_name: String(row?.last_name || "").trim(),
    minor_date_of_birth: dob,
    waiver_signed_at: String(waiver?.signed_at || ""),
  };
}

function normalizeLegacyMinorRows(row: any) {
  const email = String(row?.email || "").trim().toLowerCase();
  const minors = Array.isArray(row?.legacy_minors) ? row.legacy_minors : [];
  if (!email || minors.length === 0) return [];

  return minors
    .map((minor: unknown) => {
      const minorRecord = minor && typeof minor === "object" ? minor as Record<string, unknown> : {};
      const dob = getLegacyMinorDateOfBirth(minorRecord);
      if (!dob) return null;

      return {
        source: "legacy_waivers.legacy_minors",
        waiver_id: String(row?.id || ""),
        email,
        minor_first_name: getLegacyMinorFirstName(minorRecord),
        minor_last_name: getLegacyMinorLastName(minorRecord),
        minor_date_of_birth: dob,
        waiver_signed_at: String(row?.signed_at || ""),
        legacy_signer_first_name: String(row?.first_name || "").trim(),
        legacy_signer_last_name: String(row?.last_name || "").trim(),
      };
    })
    .filter(Boolean) as Array<Record<string, unknown>>;
}

/** Compute target birthday calendar date from a send date (same rules as main preview). */
function eventDateFromSendDate(
  sendDate: string,
  triggerTiming: string,
  offsetDays: number,
): string {
  if (triggerTiming === "before_event") return shiftDateString(sendDate, offsetDays);
  if (triggerTiming === "after_event") return shiftDateString(sendDate, -offsetDays);
  return sendDate;
}

type BirthdayDedupeContext = {
  businessId: string;
  automationId: string;
  targetSegment: string | null;
  applyMaxChildAgeRule: boolean;
  maxChildAge: number | null;
};

/**
 * Same eligibility + dedupe path as the preview recipient table: marketing-eligible contacts,
 * optional segment, max-child-age on event date, waiver dedupe by contact+minor.
 */
async function dedupeBirthdayMinorRowsToCandidates(
  supabase: ReturnType<typeof createClient>,
  ctx: BirthdayDedupeContext,
  birthdayRows: Array<Record<string, unknown>>,
  eventDate: string,
  sendDate: string,
): Promise<{
  allCandidates: Array<Record<string, unknown>>;
  excluded: {
    matching_minor_birthdays: number;
    modern_minor_birthdays: number;
    legacy_minor_birthdays: number;
    missing_or_unconsented_mail_contact: number;
    segment_filtered: number;
    max_child_age_filtered: number;
    duplicate_minor_records: number;
  };
}> {
  const allParentEmails = [...new Set(
    birthdayRows
      .map((row) => String(row.email || "").trim().toLowerCase())
      .filter(Boolean),
  )];

  const contacts = await fetchContactsByEmail(supabase, ctx.businessId, allParentEmails);

  const contactByEmail = new Map<string, Record<string, unknown>>();
  for (const contact of contacts) {
    const email = String(contact.email || "").trim().toLowerCase();
    if (email) contactByEmail.set(email, contact);
  }

  let allowedContactIds: Set<string> | null = null;
  if (ctx.targetSegment) {
    const contactIds = contacts.map((contact) => String(contact.id || "")).filter(Boolean);
    if (contactIds.length > 0) {
      const { data: memberships, error: membershipsError } = await supabase
        .from("mail_contact_segment_memberships")
        .select("contact_id")
        .eq("business_id", ctx.businessId)
        .eq("segment_id", ctx.targetSegment)
        .in("contact_id", contactIds);

      if (membershipsError) throw membershipsError;
      allowedContactIds = new Set(
        (memberships || []).map((row) => String(row.contact_id || "")).filter(Boolean),
      );
    } else {
      allowedContactIds = new Set();
    }
  }

  const loyaltyEmails = [...new Set(
    contacts.map((contact) => String(contact.email || "").trim().toLowerCase()).filter(Boolean),
  )];
  const loyaltyByEmail = new Map<string, number>();
  if (loyaltyEmails.length > 0) {
    const { data: loyaltyRows } = await supabase
      .from("pos_loyalty_accounts")
      .select("customer_email, points")
      .eq("business_id", ctx.businessId)
      .in("customer_email", loyaltyEmails);

    for (const row of loyaltyRows || []) {
      const email = String(row.customer_email || "").trim().toLowerCase();
      if (!email || loyaltyByEmail.has(email)) continue;
      loyaltyByEmail.set(email, Number(row.points) || 0);
    }
  }

  const dedupedCandidates = new Map<string, Record<string, unknown>>();
  const excluded = {
    matching_minor_birthdays: birthdayRows.length,
    modern_minor_birthdays: birthdayRows.filter((row) => row.source === "modern_waiver_participants").length,
    legacy_minor_birthdays: birthdayRows.filter((row) => row.source === "legacy_waivers.legacy_minors").length,
    missing_or_unconsented_mail_contact: 0,
    segment_filtered: 0,
    max_child_age_filtered: 0,
    duplicate_minor_records: 0,
  };

  for (const row of birthdayRows) {
    const email = String(row.email || "").trim().toLowerCase();
    const contact = contactByEmail.get(email);
    if (!contact?.id) {
      excluded.missing_or_unconsented_mail_contact += 1;
      continue;
    }
    if (allowedContactIds && !allowedContactIds.has(String(contact.id))) {
      excluded.segment_filtered += 1;
      continue;
    }
    const minorDateOfBirth = String(row.minor_date_of_birth || "").trim();
    if (
      ctx.applyMaxChildAgeRule &&
      !isTriggeringMinorEligibleByMaxChildAge(minorDateOfBirth, eventDate, ctx.maxChildAge)
    ) {
      excluded.max_child_age_filtered += 1;
      continue;
    }

    const minorFirstName = String(row.minor_first_name || "").trim();
    const minorLastName = String(row.minor_last_name || "").trim();
    const candidateKey = [
      String(contact.id),
      minorDateOfBirth,
      normalizeNamePart(minorFirstName),
      normalizeNamePart(minorLastName),
    ].join(":");

    const currentSignedAt = String(row.waiver_signed_at || "");
    const existing = dedupedCandidates.get(candidateKey);
    if (existing) excluded.duplicate_minor_records += 1;

    if (!existing || currentSignedAt > String(existing.waiver_signed_at || "")) {
      const deliveryKey = buildBirthdayDeliveryKey({
        eventDate,
        minorDateOfBirth,
        minorFirstName,
        minorLastName,
      });

      dedupedCandidates.set(candidateKey, {
        contact_id: String(contact.id),
        email_address: email,
        recipient_first_name: String(contact.first_name || ""),
        recipient_last_name: String(contact.last_name || ""),
        loyalty_points: loyaltyByEmail.get(email) ?? 0,
        minor_first_name: minorFirstName,
        minor_last_name: minorLastName,
        minor_date_of_birth: minorDateOfBirth,
        waiver_id: String(row.waiver_id || ""),
        waiver_signed_at: currentSignedAt,
        source: String(row.source || ""),
        max_child_age_rule_applied: ctx.applyMaxChildAgeRule,
        max_child_age: ctx.maxChildAge,
        event_date: eventDate,
        send_date: sendDate,
        delivery_key: deliveryKey,
      });
    }
  }

  const allCandidates = [...dedupedCandidates.values()];
  return { allCandidates, excluded };
}

/** Same normalization as mail-name-of-day for minor first names */
function normalizePoolFirstName(s: string): string {
  return String(s || "").trim().toLowerCase();
}

function normalizePoolEmail(e: string): string {
  return String(e || "").trim().toLowerCase();
}

function getLegacyMinorDateOfBirth(minor: Record<string, unknown>) {
  return String(
    minor.date_of_birth ||
      minor.dateOfBirth ||
      minor.dob ||
      minor.birthdate ||
      "",
  ).trim();
}

function getLegacyMinorFirstName(minor: Record<string, unknown>) {
  return String(minor.first_name || minor.firstName || minor.first || "").trim();
}

function getLegacyMinorLastName(minor: Record<string, unknown>) {
  return String(minor.last_name || minor.lastName || minor.last || "").trim();
}

async function previewNameOfDayAutomation(
  supabase: ReturnType<typeof createClient>,
  automation: Record<string, unknown>,
  campaign: Record<string, unknown>,
  previewDate: string,
) {
  const businessId = String(automation.business_id || campaign.business_id || "");

  const { data: businessRow } = await supabase
    .from("businesses")
    .select("timezone")
    .eq("id", businessId)
    .maybeSingle();
  const businessTimeZone = String(businessRow?.timezone || "America/Toronto");

  const { data: pickRow } = await supabase
    .from("mail_name_of_day_picks")
    .select(
      "girl_display_name, boy_display_name, girl_normalized, boy_normalized, meta, local_date",
    )
    .eq("business_id", businessId)
    .eq("local_date", previewDate)
    .maybeSingle();

  if (!pickRow) {
    return {
      preview_kind: "name_of_day",
      automation_id: automation.id,
      automation_type: automation.automation_type,
      campaign_name: campaign.name || null,
      send_date: previewDate,
      business_time_zone: businessTimeZone,
      pick_status: "not_yet_picked",
      girl_display_name: null,
      boy_display_name: null,
      explanation:
        "Names for this calendar day appear after the daily Name-of-Day job runs at your configured send time (see Mail → Automations → Name of the Day scoring). Until then there is no girl/boy pair for this date.",
      one_pair_per_day:
        "Exactly one girl name and one boy name are stored per calendar day (two slots total). The same first name cannot fill both slots.",
      recipients: [],
      counts: {
        recipients: 0,
        minors_in_pool: null as number | null,
        minors_in_pool_note:
          "Full pool size is not loaded in preview (avoids database timeouts on large businesses).",
      },
    };
  }

  const rows = await loadNameOfDayPreviewPoolRows(supabase, businessId, pickRow);

  const girlNorm = normalizePoolFirstName(String(pickRow.girl_normalized || ""));
  const boyNorm = normalizePoolFirstName(String(pickRow.boy_normalized || ""));

  const winners = new Map<
    string,
    { email: string; minors: { first: string; slot: "girl" | "boy" }[] }
  >();

  for (const r of rows) {
    const fn = normalizePoolFirstName(r.minor_first);
    let slot: "girl" | "boy" | null = null;
    if (fn === girlNorm) slot = "girl";
    else if (fn === boyNorm) slot = "boy";
    if (!slot) continue;
    const email = normalizePoolEmail(String(r.guardian_email || ""));
    if (!email) continue;
    let entry = winners.get(email);
    if (!entry) {
      entry = { email, minors: [] };
      winners.set(email, entry);
    }
    entry.minors.push({ first: String(r.minor_first || "").trim(), slot });
  }

  const allEmails = [...winners.keys()];
  const contacts = await fetchContactsByEmail(supabase, businessId, allEmails);

  const contactByEmail = new Map<string, Record<string, unknown>>();
  for (const contact of contacts) {
    const email = String(contact.email || "").trim().toLowerCase();
    if (email) contactByEmail.set(email, contact);
  }

  const loyaltyEmails = contacts
    .map((c) => String(c.email || "").trim().toLowerCase())
    .filter(Boolean);
  const loyaltyByEmail = new Map<string, number>();
  if (loyaltyEmails.length > 0) {
    const { data: loyaltyRows } = await supabase
      .from("pos_loyalty_accounts")
      .select("customer_email, points")
      .eq("business_id", businessId)
      .in("customer_email", loyaltyEmails);

    for (const row of loyaltyRows || []) {
      const email = String(row.customer_email || "").trim().toLowerCase();
      if (!email || loyaltyByEmail.has(email)) continue;
      loyaltyByEmail.set(email, Number(row.points) || 0);
    }
  }

  const deduped: Array<Record<string, unknown>> = [];
  let excluded_no_contact = 0;

  for (const [email, win] of winners) {
    const contact = contactByEmail.get(email);
    if (!contact?.id) {
      excluded_no_contact += 1;
      continue;
    }
    const deliveryKey = `name-of-day:${previewDate}:${contact.id}`;
    const minorFirst = formatUniqueMinorFirstNames(win.minors);
    const slotsLabel = win.minors.map((m) => `${m.first} (${m.slot})`).join(", ");

    deduped.push({
      contact_id: String(contact.id),
      email_address: email,
      recipient_first_name: String(contact.first_name || ""),
      recipient_last_name: String(contact.last_name || ""),
      loyalty_points: loyaltyByEmail.get(email) ?? 0,
      minor_first_name: minorFirst,
      winning_slots: slotsLabel,
      delivery_key: deliveryKey,
      send_date: previewDate,
    });
  }

  const runKeys = new Set<string>();
  if (deduped.length > 0) {
    const { data: existingRuns, error: runsError } = await supabase
      .from("mail_automation_runs")
      .select("contact_id, delivery_key")
      .eq("automation_id", String(automation.id))
      .eq("trigger_date", previewDate);

    if (runsError) throw runsError;
    for (const run of existingRuns || []) {
      runKeys.add(`${String(run.contact_id || "")}:${String(run.delivery_key || "")}`);
    }
  }

  const recipients = deduped.map((r) => ({
    ...r,
    already_has_run_for_date: runKeys.has(
      `${String(r.contact_id)}:${String(r.delivery_key)}`,
    ),
  }));

  return {
    preview_kind: "name_of_day",
    automation_id: automation.id,
    automation_type: automation.automation_type,
    campaign_name: campaign.name || null,
    send_date: previewDate,
    business_time_zone: businessTimeZone,
    pick_status: "picked",
    girl_display_name: pickRow.girl_display_name,
    boy_display_name: pickRow.boy_display_name,
    girl_normalized: pickRow.girl_normalized,
    boy_normalized: pickRow.boy_normalized,
    one_pair_per_day:
      "Exactly one girl display name and one boy display name are chosen per calendar day. Parents email when any of their minors matches either name.",
    explanation: null as string | null,
    recipients,
    counts: {
      recipients: recipients.length,
      minors_in_pool: rows.length,
      minors_in_pool_note:
        rows.length >= 4000
          ? "Preview loads at most 4000 matching minors (performance cap); recipient list may be incomplete if names are extremely common."
          : "Count is minors matching that day’s girl/boy names (not the entire waiver pool).",
      guardian_emails_with_matching_minors: winners.size,
      excluded_missing_mail_contact: excluded_no_contact,
    },
  };
}

type ToddlerEligiblePreviewRow = {
  contact_id: string;
  email: string;
  first_name?: string | null;
  last_name?: string | null;
  toddler_count?: number | null;
  toddler_first_names?: string[] | null;
  has_expired_waiver?: boolean | null;
};

const TODDLER_PREVIEW_EXPLANATIONS: Record<string, string> = {
  invalid_send_date: "Choose a valid calendar date.",
  promo_anchor_date_missing:
    "Set a promo anchor date in the automation builder (first Toddler Thursday promo week).",
  not_send_day: "Toddler Thursday sends on Thursday morning only. Pick a Thursday send date.",
  not_promo_thursday: "Toddler Thursday promos run on Thursdays. Pick a Thursday send date.",
  before_promo_anchor: "This send date is before your promo anchor — no promo week yet.",
  not_biweekly_promo_week:
    "This Thursday is an off week. Toddler Thursday promos run every other Thursday from the anchor date.",
};

async function previewToddlerThursdayAutomation(
  supabase: ReturnType<typeof createClient>,
  automation: Record<string, unknown>,
  campaign: Record<string, unknown>,
  previewDate: string,
) {
  const businessId = String(automation.business_id || campaign.business_id || "");
  const criteria = (automation.criteria && typeof automation.criteria === "object")
    ? automation.criteria as ToddlerThursdayCriteria & Record<string, unknown>
    : {};

  const { data: businessRow } = await supabase
    .from("businesses")
    .select("timezone")
    .eq("id", businessId)
    .maybeSingle();
  const businessTimeZone = String(businessRow?.timezone || "America/Toronto");

  const schedule = resolveToddlerThursdayPreviewSchedule(previewDate, businessTimeZone, criteria);
  const sendWindow = criteria.send_window && typeof criteria.send_window === "object"
    ? criteria.send_window
    : {};
  const minAge = Math.max(1, Number(criteria.toddler_min_age_years ?? 1));
  const maxAge = Math.max(minAge, Number(criteria.toddler_max_age_years ?? 3));
  const targetSegment = String(criteria.target_segment || "").trim() || null;
  const offerPrice = String(criteria.offer_price_label || "$7");

  if (!schedule.ok) {
    const reason = String(schedule.skipped_reason || "schedule_gate");
    return {
      preview_kind: "toddler_thursday",
      automation_id: automation.id,
      automation_type: automation.automation_type,
      campaign_name: campaign.name || null,
      send_date: previewDate,
      business_time_zone: businessTimeZone,
      schedule_status: reason,
      explanation: TODDLER_PREVIEW_EXPLANATIONS[reason] ||
        "This date would not trigger a Toddler Thursday send.",
      promo_thursday_date: schedule.promo_thursday_date || null,
      active_cohort: schedule.active_cohort || null,
      promo_anchor_date: String(criteria.promo_anchor_date || "").slice(0, 10) || null,
      send_window: {
        start_hour: Number(sendWindow.start_hour ?? 18),
        end_hour: Number(sendWindow.end_hour ?? 18),
        minute_offset: Number(sendWindow.minute_offset ?? 0),
        time_zone: businessTimeZone,
      },
      recipients: [],
      counts: {
        eligible_pool: 0,
        recipients: 0,
        active_cohort: schedule.active_cohort || null,
        inactive_cohort: schedule.active_cohort === "A" ? "B" : schedule.active_cohort === "B" ? "A" : null,
      },
    };
  }

  const promoThursdayDate = String(schedule.promo_thursday_date || "");
  const sendLocalDate = String(schedule.send_local_date || previewDate);
  const activeCohort = schedule.active_cohort || "A";
  const promoThursdayDisplay = formatPromoThursdayDisplay(promoThursdayDate, businessTimeZone);

  const { data: eligibleRows, error: rpcError } = await supabase.rpc(
    "mail_toddler_thursday_eligible_guardians",
    {
      p_business_id: businessId,
      p_min_age_years: Math.floor(minAge),
      p_max_age_years: Math.floor(maxAge),
    },
  );
  if (rpcError) throw rpcError;

  const pool = (eligibleRows || []) as ToddlerEligiblePreviewRow[];
  let segmentFiltered = 0;
  let allowedContactIds: Set<string> | null = null;

  if (targetSegment) {
    const contactIds = pool.map((row) => String(row.contact_id || "")).filter(Boolean);
    if (contactIds.length > 0) {
      const { data: memberships, error: membershipsError } = await supabase
        .from("mail_contact_segment_memberships")
        .select("contact_id")
        .eq("business_id", businessId)
        .eq("segment_id", targetSegment)
        .in("contact_id", contactIds);
      if (membershipsError) throw membershipsError;
      allowedContactIds = new Set(
        (memberships || []).map((row) => String(row.contact_id || "")).filter(Boolean),
      );
    } else {
      allowedContactIds = new Set();
    }
  }

  const cohortCandidates = pool.filter((row) => {
    const contactId = String(row.contact_id || "");
    if (!contactId || !row.email) return false;
    if (allowedContactIds && !allowedContactIds.has(contactId)) {
      segmentFiltered += 1;
      return false;
    }
    return getContactCohort(contactId, String(row.email)) === activeCohort;
  });

  const inactiveCohortCount = pool.filter((row) => {
    const contactId = String(row.contact_id || "");
    if (!contactId || !row.email) return false;
    if (allowedContactIds && !allowedContactIds.has(contactId)) return false;
    return getContactCohort(contactId, String(row.email)) !== activeCohort;
  }).length;

  const runKeys = new Set<string>();
  if (cohortCandidates.length > 0) {
    const { data: existingRuns, error: runsError } = await supabase
      .from("mail_automation_runs")
      .select("contact_id, delivery_key")
      .eq("automation_id", String(automation.id))
      .eq("trigger_date", sendLocalDate);
    if (runsError) throw runsError;
    for (const run of existingRuns || []) {
      runKeys.add(`${String(run.contact_id || "")}:${String(run.delivery_key || "")}`);
    }
  }

  const recipients = cohortCandidates.map((row) => {
    const contactId = String(row.contact_id);
    const toddlerNames = formatToddlerNamesList(
      Array.isArray(row.toddler_first_names) ? row.toddler_first_names.map(String) : [],
    );
    const deliveryKey = buildToddlerThursdayDeliveryKey(promoThursdayDate, contactId);
    return {
      contact_id: contactId,
      email_address: String(row.email || "").trim().toLowerCase(),
      recipient_first_name: String(row.first_name || ""),
      recipient_last_name: String(row.last_name || ""),
      toddler_count: Number(row.toddler_count || 0),
      toddler_names: toddlerNames,
      has_expired_waiver: row.has_expired_waiver === true,
      delivery_key: deliveryKey,
      send_date: sendLocalDate,
      promo_thursday_date: promoThursdayDate,
      active_cohort: activeCohort,
      already_has_run_for_date: runKeys.has(`${contactId}:${deliveryKey}`),
    };
  });

  const alreadyQueued = recipients.filter((r) => r.already_has_run_for_date).length;

  return {
    preview_kind: "toddler_thursday",
    automation_id: automation.id,
    automation_type: automation.automation_type,
    campaign_name: campaign.name || null,
    send_date: sendLocalDate,
    event_date: promoThursdayDate,
    promo_thursday_display: promoThursdayDisplay,
    business_time_zone: businessTimeZone,
    schedule_status: "ok",
    explanation: null as string | null,
    promo_anchor_date: String(criteria.promo_anchor_date || "").slice(0, 10) || null,
    active_cohort: activeCohort,
    offer_price_label: offerPrice,
    toddler_age_band: `${minAge}-${maxAge}`,
    send_window: {
      start_hour: Number(sendWindow.start_hour ?? 18),
      end_hour: Number(sendWindow.end_hour ?? 18),
      minute_offset: Number(sendWindow.minute_offset ?? 0),
      time_zone: businessTimeZone,
    },
    recipients,
    counts: {
      eligible_pool: pool.length,
      recipients: recipients.length,
      recipients_new: recipients.length - alreadyQueued,
      recipients_already_queued_for_send_date: alreadyQueued,
      inactive_cohort: inactiveCohortCount,
      segment_filtered: segmentFiltered,
      active_cohort: activeCohort,
      with_expired_waiver: recipients.filter((r) => r.has_expired_waiver).length,
    },
  };
}

async function authorizeRequest(req: Request, businessId: string) {
  const authHeader = req.headers.get("Authorization") || "";
  if (authHeader === `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`) return null;
  if (!authHeader || !SUPABASE_ANON_KEY) return jsonResponse({ error: "Unauthorized" }, 401);

  const supabaseUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userError } = await supabaseUser.auth.getUser();
  if (userError || !userData.user?.id) return jsonResponse({ error: "Unauthorized" }, 401);

  const userId = userData.user.id;
  const [{ data: businessUser }, { data: role }, { data: employee }] = await Promise.all([
    supabaseUser
      .from("business_users")
      .select("business_id")
      .eq("business_id", businessId)
      .eq("user_id", userId)
      .limit(1)
      .maybeSingle(),
    supabaseUser
      .from("user_roles")
      .select("business_id")
      .eq("business_id", businessId)
      .eq("user_id", userId)
      .limit(1)
      .maybeSingle(),
    supabaseUser
      .from("tavari_employees")
      .select("business_id")
      .eq("business_id", businessId)
      .eq("user_id", userId)
      .eq("is_active", true)
      .limit(1)
      .maybeSingle(),
  ]);

  if (!businessUser && !role && !employee) {
    return jsonResponse({ error: "Access denied to this business" }, 403);
  }

  return null;
}

async function previewBirthdayAutomation(
  supabase: ReturnType<typeof createClient>,
  automation: Record<string, unknown>,
  campaign: Record<string, unknown>,
  sendDate: string,
) {
  const businessId = String(automation.business_id || campaign.business_id || "");
  const { data: businessRow } = await supabase
    .from("businesses")
    .select("timezone")
    .eq("id", businessId)
    .maybeSingle();
  const businessTimeZone = String(businessRow?.timezone || "America/Toronto");
  const triggerTiming = String(automation.trigger_timing || "event_day");
  const offsetDays = Math.max(Number(automation.days_offset) || 0, 0);
  const criteria = automation.criteria && typeof automation.criteria === "object"
    ? automation.criteria as Record<string, unknown>
    : {};
  const sendWindow = getAutomationSendWindow(criteria);
  const targetSegment = String(criteria.target_segment || "").trim() || null;
  const applyMaxChildAgeRule = criteria.apply_max_child_age_rule === true;
  let maxChildAge: number | null = null;
  if (applyMaxChildAgeRule) {
    const { data: settingsRow, error: settingsError } = await supabase
      .from("mail_settings")
      .select("max_child_age_for_automations")
      .eq("business_id", businessId)
      .maybeSingle();

    if (settingsError) throw settingsError;
    maxChildAge = Number(settingsRow?.max_child_age_for_automations ?? 12);
  }
  const eventDate = eventDateFromSendDate(sendDate, triggerTiming, offsetDays);
  const eventMonthDay = monthDayKey(eventDate);

  const scannedMinorRows: Array<Record<string, unknown>> = [];

  const modernMinorRows = await fetchModernMinorParticipantRows(supabase, businessId, {
    maxPages: BIRTHDAY_PREVIEW_MAX_PAGES,
  });
  for (const row of modernMinorRows) {
    const minorRow = normalizeModernParticipantRow(row);
    if (minorRow) scannedMinorRows.push(minorRow);
  }

  const legacyWaiverRows = await fetchLegacyWaiverRows(supabase, businessId, {
    maxPages: BIRTHDAY_PREVIEW_MAX_PAGES,
  });
  for (const row of legacyWaiverRows) {
    for (const minorRow of normalizeLegacyMinorRows(row)) {
      scannedMinorRows.push(minorRow);
    }
  }

  const birthdayRowsForPreview = scannedMinorRows.filter((row) =>
    monthDayKey(String(row.minor_date_of_birth || "").trim()) === eventMonthDay
  );

  const dedupeCtx: BirthdayDedupeContext = {
    businessId,
    automationId: String(automation.id || ""),
    targetSegment,
    applyMaxChildAgeRule,
    maxChildAge,
  };

  const { allCandidates, excluded } = await dedupeBirthdayMinorRowsToCandidates(
    supabase,
    dedupeCtx,
    birthdayRowsForPreview,
    eventDate,
    sendDate,
  );

  const previewNow = new Date();
  const cohortFiltered = await filterBirthdayCandidatesForPriorSendSuppression(
    supabase,
    String(automation.id || ""),
    eventDate,
    allCandidates,
    previewNow,
  );
  const excludedPriorSendSuppression = allCandidates.length - cohortFiltered.length;

  const previewTruncated = cohortFiltered.length > MAX_BIRTHDAY_PREVIEW_ROWS;
  const candidates = previewTruncated
    ? cohortFiltered.slice(0, MAX_BIRTHDAY_PREVIEW_ROWS)
    : cohortFiltered;

  /** One cohort per calendar send day (full cohorts; “new to queue” counts applied after DB run lookup below). */
  type BirthdayDayPack = {
    send_date: string;
    event_date: string;
    cohort: Array<Record<string, unknown>>;
  };
  const dayPacks: BirthdayDayPack[] = [];
  for (let dayOffset = 0; dayOffset < 8; dayOffset++) {
    const sd = shiftDateString(sendDate, dayOffset);
    const ev = eventDateFromSendDate(sd, triggerTiming, offsetDays);
    const md = monthDayKey(ev);
    const rowsForDay = scannedMinorRows.filter((row) =>
      monthDayKey(String(row.minor_date_of_birth || "").trim()) === md
    );
    const { allCandidates: dayCandidates } = await dedupeBirthdayMinorRowsToCandidates(
      supabase,
      dedupeCtx,
      rowsForDay,
      ev,
      sd,
    );
    const dayCohort = await filterBirthdayCandidatesForPriorSendSuppression(
      supabase,
      String(automation.id || ""),
      ev,
      dayCandidates,
      previewNow,
    );
    dayPacks.push({ send_date: sd, event_date: ev, cohort: dayCohort });
  }

  const runKey = (contactId: string, deliveryKey: string) => `${contactId}:${deliveryKey}`;

  const runKeys = new Set<string>();
  if (candidates.length > 0) {
    const { data: existingRuns, error: runsError } = await supabase
      .from("mail_automation_runs")
      .select("contact_id, delivery_key, status, sent_at")
      .eq("automation_id", String(automation.id))
      .eq("trigger_date", sendDate);

    if (runsError) throw runsError;
    for (const run of existingRuns || []) {
      runKeys.add(runKey(String(run.contact_id || ""), String(run.delivery_key || "")));
    }
  }

  const wouldNewlyQueue = candidates.filter((c) =>
    !runKeys.has(runKey(String(c.contact_id || ""), String(c.delivery_key || "")))
  );
  const alreadyQueuedForSendDate = candidates.length - wouldNewlyQueue.length;

  const sendDatesForSuggested = dayPacks.map((p) => p.send_date);
  const runKeysBySendDate = new Map<string, Set<string>>();
  if (sendDatesForSuggested.length > 0) {
    const { data: existingMulti, error: multiErr } = await supabase
      .from("mail_automation_runs")
      .select("trigger_date, contact_id, delivery_key")
      .eq("automation_id", String(automation.id))
      .in("trigger_date", sendDatesForSuggested);

    if (multiErr) throw multiErr;
    for (const run of existingMulti || []) {
      const r = run as { trigger_date?: string; contact_id?: string; delivery_key?: string };
      const td = String(r.trigger_date || "").slice(0, 10);
      if (!td) continue;
      if (!runKeysBySendDate.has(td)) runKeysBySendDate.set(td, new Set());
      runKeysBySendDate.get(td)!.add(runKey(String(r.contact_id || ""), String(r.delivery_key || "")));
    }
  }

  const suggestedSendDates = dayPacks.map((pack) => {
    const rk = runKeysBySendDate.get(pack.send_date) ?? new Set();
    const wouldNew = pack.cohort.filter((c) =>
      !rk.has(runKey(String(c.contact_id || ""), String(c.delivery_key || "")))
    );
    const truncated = wouldNew.length > MAX_BIRTHDAY_PREVIEW_ROWS;
    const capped = truncated ? MAX_BIRTHDAY_PREVIEW_ROWS : wouldNew.length;
    return {
      send_date: pack.send_date,
      event_date: pack.event_date,
      recipients: capped,
    };
  });

  const sendSlots = buildAutomationSendSlots(wouldNewlyQueue.length, sendDate, businessTimeZone, sendWindow);
  let slotIndex = 0;
  const recipients = candidates.map((candidate) => {
    const cid = String(candidate.contact_id || "");
    const dk = String(candidate.delivery_key || "");
    const already = runKeys.has(runKey(cid, dk));
    const sendSlot = !already
      ? (sendSlots[slotIndex++] || null)
      : null;
    return {
      ...candidate,
      scheduled_for: sendSlot?.scheduled_for || null,
      scheduled_local_time: sendSlot?.local_time || null,
      scheduled_local_hour: sendSlot?.local_hour ?? null,
      scheduled_local_minute: sendSlot?.local_minute ?? null,
      scheduled_time_zone: sendSlot?.time_zone || businessTimeZone,
      already_has_run_for_date: already,
    };
  });

  return {
    preview_kind: "birthday",
    automation_id: automation.id,
    automation_type: automation.automation_type,
    campaign_id: campaign.id,
    campaign_name: campaign.name || null,
    trigger_timing: triggerTiming,
    days_offset: offsetDays,
    source_table: "waiver_participants + legacy_waivers",
    source_filter: "modern participant_type = minor; legacy legacy_minors JSON array",
    max_child_age_rule_applied: applyMaxChildAgeRule,
    max_child_age: maxChildAge,
    send_window: {
      start_hour: sendWindow.start_hour,
      end_hour: sendWindow.end_hour,
      minute_offset: sendWindow.minute_offset,
      time_zone: businessTimeZone,
    },
    send_date: sendDate,
    event_date: eventDate,
    target_birthday_month_day: eventMonthDay,
    target_segment: targetSegment,
    suggested_send_dates: suggestedSendDates,
    preview_truncated: previewTruncated,
    preview_row_cap: MAX_BIRTHDAY_PREVIEW_ROWS,
    total_matches_before_preview_cap: cohortFiltered.length,
    recipients,
    counts: {
      /** Matches `mail-process-schedules`: rows still missing `mail_automation_runs` for this send_date (what can still be queued). */
      recipients: wouldNewlyQueue.length,
      recipients_eligible_in_cohort: candidates.length,
      recipients_already_queued_for_send_date: alreadyQueuedForSendDate,
      total_matches_before_preview_cap: cohortFiltered.length,
      preview_truncated: previewTruncated,
      excluded_prior_send_suppression: excludedPriorSendSuppression,
      ...excluded,
    },
  };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error("[mail-automation-preview] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    return jsonResponse(
      { ok: false, error: "Server misconfigured (missing Supabase secrets)" },
      500,
    );
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const payload = (await req.json().catch(() => ({}))) as PreviewPayload;
    const businessId = String(payload.businessId || "").trim();
    const automationId = String(payload.automationId || "").trim();
    const previewDate = normalizeDateString(payload.previewDate);

    if (!businessId || !automationId) {
      return jsonResponse({ ok: false, error: "Missing businessId or automationId" }, 400);
    }
    if (!UUID_RE.test(businessId) || !UUID_RE.test(automationId)) {
      return jsonResponse({ ok: false, error: "Invalid businessId or automationId (expected UUID)" }, 400);
    }

    const authError = await authorizeRequest(req, businessId);
    if (authError) return authError;

    const { data: automation, error: automationError } = await supabase
      .from("mail_automations")
      .select(`
        *,
        campaign:mail_campaigns!inner(id,business_id,name,subject_line,status)
      `)
      .eq("id", automationId)
      .eq("business_id", businessId)
      .maybeSingle();

    if (automationError) throw automationError;
    if (!automation) return jsonResponse({ ok: false, error: "Automation not found" }, 404);

    const campaign = automation.campaign && typeof automation.campaign === "object"
      ? automation.campaign as Record<string, unknown>
      : {};

    const automationType = String(automation.automation_type || "");
    const criteria = automation.criteria && typeof automation.criteria === "object"
      ? automation.criteria as Record<string, unknown>
      : {};
    const criteriaSource = String(criteria.source || "");

    if (automationType === "birthday") {
      const preview = await previewBirthdayAutomation(supabase, automation, campaign, previewDate);
      return jsonResponse({ ok: true, supported: true, preview });
    }

    if (automationType === "custom" && criteriaSource === "name_of_day") {
      const preview = await previewNameOfDayAutomation(supabase, automation, campaign, previewDate);
      return jsonResponse({ ok: true, supported: true, preview });
    }

    if (automationType === "custom" && criteriaSource === "toddler_thursday") {
      const preview = await previewToddlerThursdayAutomation(supabase, automation, campaign, previewDate);
      return jsonResponse({ ok: true, supported: true, preview });
    }

    return jsonResponse({
      ok: true,
      supported: false,
      preview_date: previewDate,
      automation_id: automationId,
      message: "Preview is available for birthday, Name of the Day, and Toddler Thursday automations.",
    });
  } catch (error) {
    console.error("[mail-automation-preview] failed", error);
    return jsonResponse({ ok: false, error: getErrorMessage(error) }, 500);
  }
});
