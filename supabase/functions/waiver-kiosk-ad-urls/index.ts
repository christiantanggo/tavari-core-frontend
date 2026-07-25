/**

 * Waiver kiosk attract-mode ads: playlist from the built-in "Waiver Kiosks" schedule.

 * Respects content play_start_date / play_end_date (business timezone) and schedule shuffle.

 * Falls back to legacy waiver-kiosk-ads rows when the playlist is empty.

 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

import { createClient } from "npm:@supabase/supabase-js@2";



const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;

const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const STORAGE_BUCKET = "digital-signage-content";

const SIGNED_URL_TTL = 604800;



const KIOSK_FOLDER = "waiver-kiosk-ads";

const KIOSK_TAG = "waiver-kiosk-ad";

const WAIVER_KIOSK_SCHEDULE_TYPE = "waiver_kiosk";



const corsHeaders = {

  "Access-Control-Allow-Origin": "*",

  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",

  "Access-Control-Allow-Methods": "POST, OPTIONS",

};



function jsonResponse(body: unknown, status = 200) {

  return new Response(JSON.stringify(body), {

    status,

    headers: { ...corsHeaders, "Content-Type": "application/json" },

  });

}



function isUuid(value: string) {

  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(

    value,

  );

}



type ContentRow = {

  id?: string;

  file_url?: string | null;

  file_path?: string | null;

  folder_path?: string | null;

  tags?: string[] | null;

  content_name?: string | null;

  content_type?: string | null;

  play_start_date?: string | null;

  play_end_date?: string | null;

};



type AdRow = {

  id: string;

  ad_name?: string | null;

  start_date?: string | null;

  end_date?: string | null;

  start_time?: string | null;

  end_time?: string | null;

  days_of_week?: number[] | null;

  content?: ContentRow | null;

};



type ScheduleItemRow = {

  id: string;

  display_order?: number | null;

  content?: ContentRow | null;

};



const WEEKDAY_LONG_TO_NUM: Record<string, number> = {

  Sunday: 0,

  Monday: 1,

  Tuesday: 2,

  Wednesday: 3,

  Thursday: 4,

  Friday: 5,

  Saturday: 6,

};



function isKioskContent(content: ContentRow | null | undefined): boolean {

  if (!content) return false;

  const folder = content.folder_path;

  const tags = Array.isArray(content.tags) ? content.tags : [];

  return folder === KIOSK_FOLDER || tags.includes(KIOSK_TAG);

}



function contentIsPlayableOnDate(content: ContentRow | null | undefined, dateStr: string): boolean {

  if (!content?.id) return false;

  const start = content.play_start_date ? String(content.play_start_date).slice(0, 10) : null;

  const end = content.play_end_date ? String(content.play_end_date).slice(0, 10) : null;

  if (start && dateStr < start) return false;

  if (end && dateStr > end) return false;

  return true;

}



function parseTimeToMinutes(val: string | null | undefined): number | null {

  if (val == null || val === "") return null;

  const s = String(val);

  const segment = s.includes("T") ? (s.split("T")[1] || "").slice(0, 8) : s.slice(0, 8);

  const [hh, mm] = segment.split(":");

  if (hh == null || mm == null || hh === "") return null;

  const h = parseInt(hh, 10);

  const m = parseInt(mm.slice(0, 2), 10);

  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;

  return h * 60 + m;

}



function getZonedParts(date: Date, timeZone: string) {

  const tz = timeZone?.trim() || "America/Toronto";

  try {

    const dtf = new Intl.DateTimeFormat("en-US", {

      timeZone: tz,

      hourCycle: "h23",

      year: "numeric",

      month: "2-digit",

      day: "2-digit",

      weekday: "long",

      hour: "2-digit",

      minute: "2-digit",

      second: "2-digit",

    });

    const parts = dtf.formatToParts(date);

    const m: Record<string, string> = {};

    for (const p of parts) {

      if (p.type !== "literal") m[p.type] = p.value;

    }

    const dateStr = `${m.year}-${m.month}-${m.day}`;

    const dow = WEEKDAY_LONG_TO_NUM[m.weekday] ?? 0;

    const minutes = parseInt(m.hour, 10) * 60 + parseInt(m.minute, 10);

    return { dateStr, dow, minutes };

  } catch {

    return getZonedParts(date, "America/Toronto");

  }

}



function adMatchesSchedule(row: AdRow, timeZone: string, now: Date): boolean {

  const { dateStr, dow, minutes } = getZonedParts(now, timeZone);



  const sd = row.start_date ? String(row.start_date).slice(0, 10) : null;

  const ed = row.end_date ? String(row.end_date).slice(0, 10) : null;

  if (sd && dateStr < sd) return false;

  if (ed && dateStr > ed) return false;



  const days = Array.isArray(row.days_of_week) ? row.days_of_week : null;

  if (days && days.length > 0 && !days.includes(dow)) return false;



  const st = parseTimeToMinutes(row.start_time ?? null);

  const et = parseTimeToMinutes(row.end_time ?? null);

  if (st == null && et == null) return true;

  if (st == null || et == null) return true;



  if (et >= st) {

    return minutes >= st && minutes <= et;

  }

  return minutes >= st || minutes <= et;

}



function shuffleCopy<T>(array: T[]): T[] {

  const a = [...array];

  for (let i = a.length - 1; i > 0; i -= 1) {

    const j = Math.floor(Math.random() * (i + 1));

    [a[i], a[j]] = [a[j], a[i]];

  }

  return a;

}



async function signImageUrl(

  supabase: ReturnType<typeof createClient>,

  content: ContentRow | null | undefined,

): Promise<string> {

  if (!content) return "";

  const filePath = String(content.file_path || "").trim();

  const fileUrl = String(content.file_url || "").trim();



  if (filePath) {

    const { data, error } = await supabase.storage

      .from(STORAGE_BUCKET)

      .createSignedUrl(filePath, SIGNED_URL_TTL);

    if (!error && data?.signedUrl) return data.signedUrl;

  }

  return fileUrl || "";

}



async function loadFromWaiverKioskSchedule(

  supabase: ReturnType<typeof createClient>,

  businessId: string,

  todayDateStr: string,

): Promise<Array<{ id: string; name: string; imageUrl: string }>> {

  const { data: schedule } = await supabase

    .from("digital_signage_schedules")

    .select("id, shuffle_playlist")

    .eq("business_id", businessId)

    .eq("schedule_type", WAIVER_KIOSK_SCHEDULE_TYPE)

    .eq("is_active", true)

    .maybeSingle();



  if (!schedule?.id) return [];



  const { data: items } = await supabase

    .from("digital_signage_schedule_items")

    .select(

      `id, display_order, content:digital_signage_content ( id, content_name, content_type, file_url, file_path, play_start_date, play_end_date )`,

    )

    .eq("schedule_id", schedule.id)

    .order("display_order", { ascending: true });



  let playable: ScheduleItemRow[] = [];

  for (const row of (items || []) as ScheduleItemRow[]) {

    const content = row.content as ContentRow | null;

    if (!content?.id) continue;

    if (!contentIsPlayableOnDate(content, todayDateStr)) continue;

    if (String(content.content_type || "image").trim() !== "image") continue;

    playable.push(row);

  }



  if (schedule.shuffle_playlist && playable.length > 1) {

    playable = shuffleCopy(playable);

  }



  const ads: Array<{ id: string; name: string; imageUrl: string }> = [];

  for (const row of playable) {

    const content = row.content as ContentRow;

    const imageUrl = await signImageUrl(supabase, content);

    if (!imageUrl) continue;

    ads.push({

      id: String(content.id || row.id),

      name: String(content.content_name || "Waiver Kiosk Image").trim() || "Waiver Kiosk Image",

      imageUrl,

    });

  }

  return ads;

}



async function loadLegacyKioskAds(

  supabase: ReturnType<typeof createClient>,

  businessId: string,

  businessTimezone: string,

  now: Date,

): Promise<Array<{ id: string; name: string; imageUrl: string }>> {

  const { data: rows, error: queryError } = await supabase

    .from("digital_signage_ads")

    .select(

      `id, ad_name, created_at, start_date, end_date, start_time, end_time, days_of_week, content:digital_signage_content ( file_url, file_path, folder_path, tags, content_name, play_start_date, play_end_date )`,

    )

    .eq("business_id", businessId)

    .eq("is_active", true)

    .eq("status", "active")

    .order("created_at", { ascending: false });



  if (queryError) return [];



  const { dateStr: todayDateStr } = getZonedParts(now, businessTimezone);

  const ads: Array<{ id: string; name: string; imageUrl: string }> = [];



  for (const row of (rows || []) as AdRow[]) {

    const content = row.content as ContentRow | null | undefined;

    if (!isKioskContent(content)) continue;

    if (!contentIsPlayableOnDate(content, todayDateStr)) continue;

    if (!adMatchesSchedule(row, businessTimezone, now)) continue;



    const imageUrl = await signImageUrl(supabase, content);

    if (!imageUrl) continue;



    const name =

      String(row.ad_name || content?.content_name || "Waiver Kiosk Image").trim() ||

      "Waiver Kiosk Image";



    ads.push({ id: row.id as string, name, imageUrl });

  }

  return ads;

}



serve(async (req) => {

  if (req.method === "OPTIONS") {

    return new Response("ok", { headers: corsHeaders });

  }



  if (req.method !== "POST") {

    return jsonResponse({ ok: false, error: "Method not allowed" }, 405);

  }



  try {

    const body = await req.json().catch(() => ({}));

    const businessId = typeof body?.business_id === "string"

      ? body.business_id.trim()

      : typeof body?.businessId === "string"

      ? body.businessId.trim()

      : "";



    if (!businessId || !isUuid(businessId)) {

      return jsonResponse({ ok: false, error: "Invalid or missing business_id" }, 400);

    }



    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const now = new Date();



    const { data: bizRow } = await supabase

      .from("businesses")

      .select("timezone")

      .eq("id", businessId)

      .maybeSingle();



    const businessTimezone = String(bizRow?.timezone || "America/Toronto").trim() ||

      "America/Toronto";

    const { dateStr: todayDateStr } = getZonedParts(now, businessTimezone);



    let ads = await loadFromWaiverKioskSchedule(supabase, businessId, todayDateStr);

    let source = "waiver_kiosk_schedule";



    if (ads.length === 0) {

      ads = await loadLegacyKioskAds(supabase, businessId, businessTimezone, now);

      source = ads.length > 0 ? "legacy_ads" : "none";

    }



    return jsonResponse({ ok: true, ads, source, business_timezone: businessTimezone });

  } catch (error) {

    const message = error instanceof Error ? error.message : String(error);

    return jsonResponse({ ok: false, error: message }, 500);

  }

});

