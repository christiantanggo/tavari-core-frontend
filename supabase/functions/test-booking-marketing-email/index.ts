// Test samples for Bookings → Settings → Marketing (reminder, abandoned cart, marketing links).
// POST { businessId: string, to: string, kind: "reminder" | "abandoned" | "links", publicOrigin?: string }
// Requires authenticated user with business_users membership for businessId.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { BOOKING_TRANSACTIONAL_FROM_EMAIL } from "../_shared/bookingTransactionalMail.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

type MarketingKind = "reminder" | "abandoned" | "links";

function jsonResponse(body: object, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function asNumber(v: unknown, fallback: number) {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

async function loadAbandonedSettings(
  supabase: ReturnType<typeof createClient>,
  businessId: string,
) {
  const { data } = await supabase
    .from("booking_settings")
    .select("setting_key, setting_value")
    .eq("business_id", businessId)
    .is("activity_id", null)
    .eq("is_global", true)
    .in("setting_key", [
      "abandonedCartEmailEnabled",
      "abandonedCartEmailHours",
      "abandonedCartMinStage",
      "abandonedCartEmailMessage",
    ]);

  const m: Record<string, unknown> = {};
  (data || []).forEach((r: { setting_key: string; setting_value: unknown }) => {
    m[r.setting_key] = r.setting_value;
  });
  return {
    enabled: m.abandonedCartEmailEnabled === true,
    hours: Math.min(168, Math.max(0.5, asNumber(m.abandonedCartEmailHours, 2))),
    minStage: typeof m.abandonedCartMinStage === "string" && m.abandonedCartMinStage
      ? String(m.abandonedCartMinStage)
      : "tickets",
    extraMessage: typeof m.abandonedCartEmailMessage === "string" ? m.abandonedCartEmailMessage : "",
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: { ...corsHeaders, "Content-Type": "text/plain" } });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    const body = (await req.json().catch(() => ({}))) as {
      businessId?: string;
      to?: string;
      kind?: string;
      publicOrigin?: string;
    };
    const businessId = body?.businessId?.trim();
    const to = typeof body?.to === "string" ? body.to.trim().toLowerCase() : "";
    const kind = body?.kind as MarketingKind | undefined;
    const publicOriginRaw = typeof body?.publicOrigin === "string" ? body.publicOrigin.trim().replace(/\/$/, "") : "";

    if (!businessId) {
      return jsonResponse({ error: "Missing businessId" }, 400);
    }
    if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      return jsonResponse({ error: "Valid email address (to) is required" }, 400);
    }
    if (kind !== "reminder" && kind !== "abandoned" && kind !== "links") {
      return jsonResponse({ error: 'kind must be "reminder", "abandoned", or "links"' }, 400);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseUser = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data: { user } } = await supabaseUser.auth.getUser();
    if (!user?.id) {
      return jsonResponse({ error: "Invalid session" }, 401);
    }

    const { data: membership } = await supabaseUser
      .from("business_users")
      .select("user_id")
      .eq("business_id", businessId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (!membership) {
      return jsonResponse({ error: "Access denied for this business" }, 403);
    }

    const { data: business } = await supabase
      .from("businesses")
      .select("id, name")
      .eq("id", businessId)
      .single();

    const businessName = (business?.name || "Tavari").replace(/</g, "&lt;").replace(/>/g, "&gt;");

    const envBase = (Deno.env.get("BOOKING_PUBLIC_APP_URL") || "https://tavari.app").replace(/\/$/, "");
    const publicBase = (publicOriginRaw || envBase).replace(/\/$/, "");

    let subject = "";
    let emailHTML = "";
    let textBody = "";

    if (kind === "reminder") {
      const { data: rows } = await supabase
        .from("booking_settings")
        .select("setting_key, setting_value")
        .eq("business_id", businessId)
        .is("activity_id", null)
        .eq("is_global", true)
        .in("setting_key", ["autoSendConfirmation", "reminderHoursBefore"]);

      const m: Record<string, unknown> = {};
      (rows || []).forEach((r: { setting_key: string; setting_value: unknown }) => {
        m[r.setting_key] = r.setting_value;
      });
      const autoOn = m.autoSendConfirmation !== false;
      const hours = Math.min(168, Math.max(1, asNumber(m.reminderHoursBefore, 24)));

      const { data: actRow } = await supabase
        .from("booking_activities")
        .select("activity_name")
        .eq("business_id", businessId)
        .eq("is_active", true)
        .limit(1)
        .maybeSingle();
      const sampleActivity = (actRow?.activity_name || "Sample activity").replace(/</g, "&lt;").replace(/>/g, "&gt;");

      const sampleDate = new Date();
      sampleDate.setDate(sampleDate.getDate() + 2);
      const dateStr = sampleDate.toLocaleDateString("en-CA", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
      const timeStr = "2:00 PM";

      const statusNote = autoOn
        ? `<p style="margin:0 0 16px;font-size:14px;color:#374151;">This is a <strong>test</strong>. Real reminder emails are sent <strong>${hours} hour${
          hours === 1 ? "" : "s"
        } before</strong> the customer&apos;s booking time (using your saved setting).</p>`
        : `<p style="margin:0 0 16px;font-size:14px;color:#b45309;">Your setting <strong>Automatically send confirmation emails</strong> is off. Reminder timing is still shown below for preview; turn confirmations on in production as needed.</p>`;

      subject = `[Test] Booking reminder — ${businessName}`;
      emailHTML = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="font-family:Arial,sans-serif;line-height:1.6;max-width:600px;margin:0 auto;padding:20px;">
  <p style="font-size:12px;text-transform:uppercase;letter-spacing:0.5px;color:#2563eb;font-weight:600;">Test — Reminder preview</p>
  <h1 style="font-size:20px;margin:8px 0 16px;">Upcoming booking</h1>
  ${statusNote}
  <p>Hi,</p>
  <p>This is a friendly reminder about your booking with <strong>${businessName}</strong>.</p>
  <p><strong>Booking #</strong> DEMO-1001</p>
  <p><strong>Activity</strong> ${sampleActivity}</p>
  <p><strong>Date</strong> ${dateStr}</p>
  <p><strong>Time</strong> ${timeStr}</p>
  <p style="color:#6b7280;font-size:13px;margin-top:24px;">Sample only — your real reminder content may vary as the product evolves.</p>
  <p style="color:#6b7280;font-size:12px;">Tavari Bookings (test)</p>
</body></html>`;
      textBody = [
        `Test — Reminder preview (${businessName})`,
        ``,
        `Upcoming booking (sample)`,
        `Activity: ${actRow?.activity_name || "Sample activity"}`,
        `Date: ${dateStr}  ${timeStr}`,
        ``,
        `Real reminders are sent ${hours} hour(s) before the booking time.`,
        autoOn ? "" : "Note: auto confirmation is off in settings.",
        ``,
        `Tavari Bookings (test)`,
      ].filter(Boolean).join("\n");
    } else if (kind === "abandoned") {
      const settings = await loadAbandonedSettings(supabase, businessId);
      const { data: act } = await supabase
        .from("booking_activities")
        .select("id, activity_name")
        .eq("business_id", businessId)
        .eq("is_active", true)
        .order("activity_name", { ascending: true })
        .limit(1)
        .maybeSingle();

      const activityName = (act?.activity_name || "Sample activity").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      const activityId = act?.id;
      const resumeUrl = activityId
        ? `${publicBase}/customer-portal/${businessId}/portal/${activityId}`
        : `${publicBase}/customer-portal/${businessId}/portal`;

      const custom = settings.extraMessage.trim();
      const extraBlock = custom
        ? `<p style="font-size:14px;color:#374151;">${escapeHtml(custom).replace(/\r\n/g, "\n").split("\n").join("<br/>")}</p>`
        : "";

      const enabledNote = settings.enabled
        ? `<p style="margin:0 0 12px;font-size:14px;color:#374151;">This is a <strong>test</strong> using the same layout as production nudges. Saved settings: idle <strong>${settings.hours}h</strong>, minimum step <strong>${escapeHtml(
          settings.minStage,
        )}</strong>.</p>`
        : `<p style="margin:0 0 12px;font-size:14px;color:#b45309;">Abandoned booking emails are <strong>off</strong> in settings. Below is a preview of what customers would see if you turned them on.</p>`;

      subject = `[Test] Complete your booking: ${activityName}`;
      emailHTML = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="font-family:Arial,sans-serif;line-height:1.6;max-width:600px;margin:0 auto;padding:20px;">
  <p style="font-size:12px;text-transform:uppercase;letter-spacing:0.5px;color:#2563eb;font-weight:600;">Test — Abandoned cart preview</p>
  ${enabledNote}
  <p>Hi,</p>
  <p>We saved your <strong>${activityName}</strong> selection at <strong>${businessName}</strong>. You can still complete your booking here:</p>
  <p><a href="${resumeUrl}" style="color:#2563eb;font-weight:600;">Continue booking</a></p>
  <p style="color:#6b7280;font-size:13px;">This link takes you back to the booking page for that activity. Your checkout session may have timed out; you may need to select your time again.</p>
  ${extraBlock}
  <p style="color:#6b7280;font-size:12px;margin-top:24px;">Tavari Bookings (test)</p>
</body></html>`;
      textBody = [
        `Test — Abandoned cart preview (${businessName})`,
        ``,
        `We saved your ${act?.activity_name || "Sample activity"} selection at ${business?.name || "Tavari"}.`,
        ``,
        `Continue: ${resumeUrl}`,
        ...(custom ? [``, custom] : []),
        ``,
        `Tavari Bookings (test)`,
      ].join("\n");
    } else {
      // links
      const portalBase = `${publicBase}/customer-portal/${businessId}/portal`;

      const { data: cat } = await supabase
        .from("booking_types")
        .select("id, display_name, type_name")
        .eq("business_id", businessId)
        .eq("is_active", true)
        .order("type_name", { ascending: true })
        .limit(1)
        .maybeSingle();

      const { data: act } = await supabase
        .from("booking_activities")
        .select("id, activity_name")
        .eq("business_id", businessId)
        .eq("is_active", true)
        .order("activity_name", { ascending: true })
        .limit(1)
        .maybeSingle();

      const categoryLabel = (cat?.display_name || cat?.type_name || "First category").replace(/</g, "&lt;");
      const activityLabel = (act?.activity_name || "First activity").replace(/</g, "&lt;");
      const categoryUrl = cat?.id ? `${portalBase}?type=${encodeURIComponent(cat.id)}` : portalBase;
      const activityUrl = act?.id ? `${publicBase}/customer-portal/${businessId}/portal/${act.id}` : portalBase;

      subject = `[Test] Your marketing links — ${businessName}`;
      emailHTML = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="font-family:Arial,sans-serif;line-height:1.6;max-width:600px;margin:0 auto;padding:20px;">
  <p style="font-size:12px;text-transform:uppercase;letter-spacing:0.5px;color:#2563eb;font-weight:600;">Test — Marketing links preview</p>
  <h1 style="font-size:18px;margin:8px 0 12px;">Public booking links</h1>
  <p style="color:#374151;font-size:14px;">These are the same link patterns shown under <strong>Marketing links</strong> in settings. Use them in email campaigns and social posts.</p>
  <p style="font-weight:600;margin:20px 0 8px;">Customer portal (home)</p>
  <p><a href="${portalBase}" style="color:#2563eb;word-break:break-all;">${escapeHtml(portalBase)}</a></p>
  <p style="font-weight:600;margin:20px 0 8px;">Example category link — ${categoryLabel}</p>
  <p><a href="${categoryUrl}" style="color:#2563eb;word-break:break-all;">${escapeHtml(categoryUrl)}</a></p>
  <p style="font-weight:600;margin:20px 0 8px;">Example activity link — ${activityLabel}</p>
  <p><a href="${activityUrl}" style="color:#2563eb;word-break:break-all;">${escapeHtml(activityUrl)}</a></p>
  <p style="color:#6b7280;font-size:12px;margin-top:24px;">If links look wrong, set BOOKING_PUBLIC_APP_URL on the server to your live app URL. Test email uses your current browser origin when available.</p>
  <p style="color:#6b7280;font-size:12px;">Tavari Bookings (test)</p>
</body></html>`;
      textBody = [
        `Test — Marketing links (${businessName})`,
        ``,
        `Portal: ${portalBase}`,
        `Category example (${categoryLabel}): ${categoryUrl}`,
        `Activity example (${activityLabel}): ${activityUrl}`,
        ``,
        `Tavari Bookings (test)`,
      ].join("\n");
    }

    const campaignId = `marketing-test-${kind}-${businessId}-${user.id}-${Date.now()}`;

    const mailPayload = {
      businessId,
      campaignId,
      contactId: user.id,
      emailType: "transactional",
      to,
      fromEmail: BOOKING_TRANSACTIONAL_FROM_EMAIL,
      fromName: `${businessName} - Booking (test)`,
      subject,
      html: emailHTML,
      text: textBody,
    };

    const mailResponse = await fetch(`${supabaseUrl}/functions/v1/mail-send`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: supabaseServiceKey,
        Authorization: `Bearer ${supabaseServiceKey}`,
      },
      body: JSON.stringify(mailPayload),
    });

    if (!mailResponse.ok) {
      const errText = await mailResponse.text();
      console.error("[test-booking-marketing-email] mail-send error:", mailResponse.status, errText);
      return jsonResponse({ error: "Failed to send test email", detail: errText }, 502);
    }
    const mailData = await mailResponse.json();
    if (!mailData?.ok) {
      return jsonResponse({ error: mailData?.error || "Mail send failed" }, 502);
    }

    return jsonResponse({ ok: true, messageId: mailData.messageId }, 200);
  } catch (err) {
    console.error("[test-booking-marketing-email]", err);
    return jsonResponse(
      { error: err instanceof Error ? err.message : "Server error" },
      500,
    );
  }
});
