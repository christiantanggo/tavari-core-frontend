/**
 * Digital signage player: resolve active schedule + signed media URLs for a screen_key.
 * Updates screen heartbeat. Uses service role (no auth on device).
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const STORAGE_BUCKET = "digital-signage-content";
const SIGNED_URL_TTL = 43200;
const DEFAULT_SLIDE_SECONDS = 8;

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

const WEEKDAY_LONG_TO_NUM: Record<string, number> = {
  Sunday: 0,
  Monday: 1,
  Tuesday: 2,
  Wednesday: 3,
  Thursday: 4,
  Friday: 5,
  Saturday: 6,
};

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

type ScheduleRow = {
  id: string;
  schedule_name?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  days_of_week?: number[] | null;
  timezone?: string | null;
  priority?: number | null;
  apply_to_screens?: string[] | null;
  apply_to_groups?: string[] | null;
  shuffle_playlist?: boolean | null;
};

function scheduleMatchesNow(row: ScheduleRow, timeZone: string, now: Date): boolean {
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
  if (st == null) return minutes <= et;
  if (et == null) return minutes >= st;

  if (et >= st) {
    return minutes >= st && minutes <= et;
  }
  return minutes >= st || minutes <= et;
}

type ContentRow = {
  id: string;
  content_name?: string | null;
  content_type?: string | null;
  file_url?: string | null;
  file_path?: string | null;
  duration_seconds?: number | null;
  mime_type?: string | null;
  play_start_date?: string | null;
  play_end_date?: string | null;
  is_active?: boolean | null;
};

function contentIsPlayableOnDate(
  content: ContentRow | null | undefined,
  dateStr: string,
): boolean {
  if (!content?.id) return false;
  const start = content.play_start_date ? String(content.play_start_date).slice(0, 10) : null;
  const end = content.play_end_date ? String(content.play_end_date).slice(0, 10) : null;
  if (start && dateStr < start) return false;
  if (end && dateStr > end) return false;
  return true;
}

type ScheduleItemRow = {
  id: string;
  zone_id?: string | null;
  display_order?: number | null;
  duration_seconds?: number | null;
  content?: ContentRow | null;
};

type ZoneRow = {
  id: string;
  zone_name?: string | null;
  zone_key?: string | null;
  position_x?: number | null;
  position_y?: number | null;
  width?: number | null;
  height?: number | null;
  position_unit?: string | null;
  z_index?: number | null;
  background_color?: string | null;
};

type PlaylistItem = {
  id: string;
  contentId: string;
  name: string;
  type: string;
  url: string;
  durationSeconds: number;
  mimeType?: string | null;
};

async function signContentUrl(
  supabase: ReturnType<typeof createClient>,
  content: ContentRow | null | undefined,
): Promise<string | null> {
  if (!content) return null;
  const filePath = String(content.file_path || "").trim();
  const fileUrl = String(content.file_url || "").trim();

  if (filePath) {
    const { data, error } = await supabase.storage
      .from(STORAGE_BUCKET)
      .createSignedUrl(filePath, SIGNED_URL_TTL);
    if (!error && data?.signedUrl) return data.signedUrl;
  }
  return fileUrl || null;
}

function itemDuration(item: ScheduleItemRow, content: ContentRow): number {
  const d = item.duration_seconds ?? content.duration_seconds;
  if (typeof d === "number" && d > 0) return d;
  return DEFAULT_SLIDE_SECONDS;
}

function isValidScreenKey(key: string): boolean {
  if (/^\d{4}-\d{4}$/.test(key)) return true;
  if (key.startsWith("screen_") && key.length >= 8) return true;
  return false;
}

function normalizeScreenKey(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith("screen_")) return trimmed;
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 8) {
    return `${digits.slice(0, 4)}-${digits.slice(4)}`;
  }
  return trimmed.replace(/\s/g, "");
}

function resolveContentFit(settings: unknown): "contain" | "cover" | "fill" {
  if (!settings || typeof settings !== "object") return "contain";
  const fit = String((settings as Record<string, unknown>).contentFit || "").toLowerCase();
  if (fit === "cover" || fit === "fill") return fit;
  return "contain";
}

function bookingDateTime(date: string, time: string): Date {
  return new Date(`${String(date).slice(0, 10)}T${String(time).slice(0, 8)}`);
}

function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60 * 1000);
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
    const screenKey = normalizeScreenKey(
      typeof body?.screen_key === "string"
        ? body.screen_key
        : typeof body?.screenKey === "string"
        ? body.screenKey
        : "",
    );

    if (!screenKey || !isValidScreenKey(screenKey)) {
      return jsonResponse({ ok: false, error: "Invalid or missing screen_key" }, 400);
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: screen, error: screenError } = await supabase
      .from("digital_signage_screens")
      .select(
        "id, business_id, screen_name, screen_key, orientation, resolution_width, resolution_height, group_id, current_schedule_id, current_content_id, settings",
      )
      .eq("screen_key", screenKey)
      .eq("is_active", true)
      .maybeSingle();

    if (screenError) {
      return jsonResponse({ ok: false, error: screenError.message }, 500);
    }
    if (!screen) {
      return jsonResponse({ ok: false, error: "Screen not found" }, 404);
    }

    await supabase.rpc("update_screen_heartbeat", { screen_key_param: screenKey });

    const { data: bizRow } = await supabase
      .from("businesses")
      .select("timezone, name")
      .eq("id", screen.business_id)
      .maybeSingle();

    const businessTimezone = String(bizRow?.timezone || "America/Toronto").trim() ||
      "America/Toronto";
    const now = new Date();
    const screenSettings = screen.settings && typeof screen.settings === "object"
      ? screen.settings as Record<string, unknown>
      : {};

    let activeScheduleId: string | null = screen.current_schedule_id ?? null;
    let activeScheduleName: string | null = null;
    let shufflePlaylist = false;
    let bookingOverride: Record<string, unknown> | null = null;

    const bookingResourceCategoryId = String(screenSettings.bookingResourceCategoryId || "").trim();
    const bookingResourceId = String(screenSettings.bookingResourceId || "").trim();
    if (bookingResourceCategoryId && bookingResourceId) {
      const { data: assignedRows } = await supabase
        .from("booking_resource_assignments")
        .select(`
          id,
          booking_id,
          category_id,
          resource_id,
          booking:bookings (
            id,
            booking_number,
            booking_date,
            booking_time,
            booking_end_time,
            duration_minutes,
            extended_minutes,
            status,
            customer_email,
            customer_phone,
            activity:booking_activities (
              id,
              activity_name,
              duration_minutes
            )
          )
        `)
        .eq("business_id", screen.business_id)
        .eq("category_id", bookingResourceCategoryId)
        .eq("resource_id", bookingResourceId);

      const activeBookingRows = (assignedRows || [])
        .map((row: Record<string, unknown>) => {
          const booking = row.booking as Record<string, unknown> | null;
          if (!booking || booking.status === "cancelled") return null;
          const start = bookingDateTime(String(booking.booking_date), String(booking.booking_time));
          const activity = booking.activity as Record<string, unknown> | null;
          const duration = Number(booking.duration_minutes || activity?.duration_minutes || 60);
          const extended = Number(booking.extended_minutes || 0);
          const fallbackEnd = addMinutes(start, duration + extended);
          const end = booking.booking_end_time
            ? bookingDateTime(String(booking.booking_date), String(booking.booking_end_time))
            : fallbackEnd;
          if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
          if (now < start || now >= end) return null;
          return { row, booking, activity, start, end };
        })
        .filter(Boolean)
        .sort((a: any, b: any) => a.start.getTime() - b.start.getTime());

      const activeBooking = activeBookingRows[0] as any;
      if (activeBooking) {
        const elapsedSeconds = Math.max(0, Math.floor((now.getTime() - activeBooking.start.getTime()) / 1000));
        const remainingSeconds = Math.max(0, Math.floor((activeBooking.end.getTime() - now.getTime()) / 1000));
        bookingOverride = {
          id: activeBooking.booking.id,
          bookingNumber: activeBooking.booking.booking_number,
          resourceCategoryId: bookingResourceCategoryId,
          resourceId: bookingResourceId,
          activityName: activeBooking.activity?.activity_name ?? null,
          bookingStart: activeBooking.start.toISOString(),
          bookingEnd: activeBooking.end.toISOString(),
          elapsedSeconds,
          remainingSeconds,
          extendedMinutes: Number(activeBooking.booking.extended_minutes || 0),
        };
        const configuredScheduleId = String(screenSettings.bookingOverrideScheduleId || "").trim();
        if (configuredScheduleId) {
          activeScheduleId = configuredScheduleId;
          activeScheduleName = "Booking override";
        }
      }
    }

    if (activeScheduleId && !bookingOverride) {
      const { data: pinned } = await supabase
        .from("digital_signage_schedules")
        .select("id, schedule_name, start_date, end_date, start_time, end_time, days_of_week, timezone, priority, shuffle_playlist")
        .eq("id", activeScheduleId)
        .eq("is_active", true)
        .maybeSingle();

      const tz = String(pinned?.timezone || businessTimezone).trim() || businessTimezone;
      if (pinned && scheduleMatchesNow(pinned as ScheduleRow, tz, now)) {
        activeScheduleName = pinned.schedule_name ?? null;
        shufflePlaylist = !!pinned.shuffle_playlist;
      } else {
        activeScheduleId = null;
      }
    }

    if (!activeScheduleId) {
      const { data: schedules } = await supabase
        .from("digital_signage_schedules")
        .select(
          "id, schedule_name, start_date, end_date, start_time, end_time, days_of_week, timezone, priority, apply_to_screens, apply_to_groups, shuffle_playlist",
        )
        .eq("business_id", screen.business_id)
        .eq("is_active", true)
        .order("priority", { ascending: false });

      const candidates = (schedules || []).filter((s: ScheduleRow) => {
        const appliesToScreen = Array.isArray(s.apply_to_screens) &&
          s.apply_to_screens.includes(screen.id);
        const appliesToGroup = Array.isArray(s.apply_to_groups) &&
          !!screen.group_id &&
          s.apply_to_groups.includes(screen.group_id);
        const applies = appliesToScreen || appliesToGroup;
        if (!applies) return false;
        const tz = String(s.timezone || businessTimezone).trim() || businessTimezone;
        return scheduleMatchesNow(s, tz, now);
      });

      if (candidates.length > 0) {
        activeScheduleId = candidates[0].id;
        activeScheduleName = candidates[0].schedule_name ?? null;
        shufflePlaylist = !!candidates[0].shuffle_playlist;
      }
    }

    const { dateStr: todayDateStr } = getZonedParts(now, businessTimezone);

    const playlist: PlaylistItem[] = [];
    const zoneMap = new Map<string, PlaylistItem[]>();

    if (activeScheduleId) {
      const { data: items } = await supabase
        .from("digital_signage_schedule_items")
        .select(
          `id, zone_id, display_order, duration_seconds, content:digital_signage_content ( id, content_name, content_type, file_url, file_path, duration_seconds, mime_type, play_start_date, play_end_date, is_active )`,
        )
        .eq("schedule_id", activeScheduleId)
        .order("display_order", { ascending: true });

      for (const row of (items || []) as ScheduleItemRow[]) {
        const content = row.content as ContentRow | null;
        if (!content?.id) continue;
        if (content.is_active === false) continue;
        if (!contentIsPlayableOnDate(content, todayDateStr)) continue;

        const url = await signContentUrl(supabase, content);
        if (!url) continue;

        const entry: PlaylistItem = {
          id: row.id,
          contentId: content.id,
          name: String(content.content_name || "Content").trim(),
          type: String(content.content_type || "image").trim(),
          url,
          durationSeconds: itemDuration(row, content),
          mimeType: content.mime_type ?? null,
        };

        const zoneId = row.zone_id ? String(row.zone_id) : null;
        if (zoneId) {
          const list = zoneMap.get(zoneId) || [];
          list.push(entry);
          zoneMap.set(zoneId, list);
        } else {
          playlist.push(entry);
        }
      }
    } else if (screen.current_content_id) {
      const { data: content } = await supabase
        .from("digital_signage_content")
        .select("id, content_name, content_type, file_url, file_path, duration_seconds, mime_type, play_start_date, play_end_date, is_active")
        .eq("id", screen.current_content_id)
        .eq("is_active", true)
        .maybeSingle();

      if (content && contentIsPlayableOnDate(content as ContentRow, todayDateStr)) {
        const url = await signContentUrl(supabase, content as ContentRow | null);
        if (url && content) {
          playlist.push({
            id: content.id,
            contentId: content.id,
            name: String(content.content_name || "Content").trim(),
            type: String(content.content_type || "image").trim(),
            url,
            durationSeconds: itemDuration({ duration_seconds: content.duration_seconds }, content as ContentRow),
            mimeType: content.mime_type ?? null,
          });
        }
      }
    }

    let zones: Array<{
      id: string;
      name: string;
      zoneKey: string;
      x: number;
      y: number;
      width: number;
      height: number;
      unit: string;
      zIndex: number;
      backgroundColor: string | null;
      items: PlaylistItem[];
    }> = [];

    if (zoneMap.size > 0) {
      const zoneIds = [...zoneMap.keys()];
      const { data: zoneRows } = await supabase
        .from("digital_signage_zones")
        .select(
          "id, zone_name, zone_key, position_x, position_y, width, height, position_unit, z_index, background_color",
        )
        .in("id", zoneIds)
        .eq("is_active", true);

      const activeZoneIds = new Set((zoneRows || []).map((z: ZoneRow) => z.id));
      for (const [zoneId, items] of zoneMap.entries()) {
        if (!activeZoneIds.has(zoneId)) {
          playlist.push(...items);
        }
      }

      zones = (zoneRows || []).map((z: ZoneRow) => ({
        id: z.id,
        name: String(z.zone_name || "Zone").trim(),
        zoneKey: String(z.zone_key || z.id).trim(),
        x: Number(z.position_x ?? 0),
        y: Number(z.position_y ?? 0),
        width: Number(z.width ?? 100),
        height: Number(z.height ?? 100),
        unit: String(z.position_unit || "percent").trim(),
        zIndex: Number(z.z_index ?? 0),
        backgroundColor: z.background_color ?? null,
        items: zoneMap.get(z.id) || [],
      })).filter((z) => z.items.length > 0);

      zones.sort((a, b) => a.zIndex - b.zIndex);
    }

    const layout = zones.length > 0 ? "zones" : "fullscreen";
    const playlistIdsKey = shufflePlaylist
      ? playlist.map((p) => p.contentId).sort().join(",")
      : playlist.map((p) => p.contentId).join(",");
    const zoneIdsKey = zones
      .map((z) => `${z.id}:${shufflePlaylist ? z.items.map((i) => i.contentId).sort().join(",") : z.items.map((i) => i.contentId).join(",")}`)
      .join("|");
    const manifestVersion = [
      activeScheduleId || "none",
      shufflePlaylist ? "shuffle" : "ordered",
      playlistIdsKey,
      zoneIdsKey,
    ].join("::");

    return jsonResponse({
      ok: true,
      manifestVersion,
      pollSeconds: 60,
      defaultSlideSeconds: DEFAULT_SLIDE_SECONDS,
      layout,
      shufflePlaylist,
      businessTimezone,
      businessName: bizRow?.name ?? null,
      screen: {
        id: screen.id,
        name: screen.screen_name,
        orientation: screen.orientation,
        resolutionWidth: screen.resolution_width,
        resolutionHeight: screen.resolution_height,
      contentFit: resolveContentFit(screen.settings),
      bookingResourceCategoryId,
      bookingResourceId,
      },
      schedule: activeScheduleId
        ? { id: activeScheduleId, name: activeScheduleName }
        : null,
      playlist,
      zones,
      bookingOverride,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return jsonResponse({ ok: false, error: message }, 500);
  }
});
