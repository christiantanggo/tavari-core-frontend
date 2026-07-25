// Finds abandoned booking checkouts / funnels and sends nudge emails. Invoked by pg_cron (secret header) or manual.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { BOOKING_TRANSACTIONAL_FROM_EMAIL } from "../_shared/bookingTransactionalMail.ts";
import {
  buildBookingAbandonedCartEmail,
  loadBookingEmailBusinessContext,
  resolveBookingRecipientName,
} from "../_shared/bookingTransactionalEmail.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-booking-abandoned-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

const STAGE_RANK: Record<string, number> = {
  activity_view: 1,
  date_time: 2,
  participants: 3,
  tickets: 4,
  payment: 5,
  payment_started: 6,
  converted: 99,
};

function json(body: object, status = 200) {
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

type AbandonedSettings = {
  enabled: boolean;
  hours: number;
  minStage: string;
  extraMessage: string;
};

async function loadAbandonedSettings(
  supabase: ReturnType<typeof createClient>,
  businessId: string,
): Promise<AbandonedSettings> {
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

function stageMeetsMin(current: string, min: string): boolean {
  const minR = STAGE_RANK[min] ?? STAGE_RANK["tickets"] ?? 4;
  return (STAGE_RANK[current] || 0) >= minR;
}

async function sendAbandonedCartEmail(
  supabase: ReturnType<typeof createClient>,
  supabaseUrl: string,
  serviceKey: string,
  params: {
    businessId: string;
    activityId: string;
    activityName: string;
    toEmail: string;
    customerId?: string | null;
    campaignId: string;
    contactId: string;
    resumeUrl: string;
    extraMessage?: string;
  },
): Promise<boolean> {
  const business = await loadBookingEmailBusinessContext(supabase, params.businessId);
  const recipientName = await resolveBookingRecipientName(
    supabase,
    { customer_id: params.customerId || null, customer_email: params.toEmail },
    params.businessId,
  );
  const email = buildBookingAbandonedCartEmail({
    business,
    recipientName,
    activityName: params.activityName,
    resumeUrl: params.resumeUrl,
    extraMessage: params.extraMessage || null,
  });

  const mailRes = await fetch(`${supabaseUrl}/functions/v1/mail-send`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
    },
    body: JSON.stringify({
      businessId: params.businessId,
      campaignId: params.campaignId,
      contactId: params.contactId,
      emailType: "transactional",
      to: params.toEmail,
      fromEmail: BOOKING_TRANSACTIONAL_FROM_EMAIL,
      fromName: `${business.name} - Bookings`,
      subject: email.subject,
      html: email.html,
      text: email.text,
    }),
  });

  if (!mailRes.ok) {
    const t = await mailRes.text();
    throw new Error(t);
  }
  const mailData = await mailRes.json();
  return Boolean(mailData?.ok);
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: { ...corsHeaders, "Content-Type": "text/plain" } });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceKey);

  const secret = req.headers.get("x-booking-abandoned-secret");
  const { data: expectedRow } = await supabase
    .from("system_runtime_secrets")
    .select("secret_value")
    .eq("key_name", "booking_abandoned_cart_cron_secret")
    .maybeSingle();
  const expected = expectedRow?.secret_value;
  if (!expected || secret !== expected) {
    return json({ error: "Unauthorized" }, 401);
  }

  const publicBase = (Deno.env.get("BOOKING_PUBLIC_APP_URL") || "https://tavari.app").replace(/\/$/, "");

  let sentPending = 0;
  let sentFunnel = 0;
  const errors: string[] = [];

  try {
    const { data: pendingList, error: pErr } = await supabase
      .from("booking_pending_helcim")
      .select("id, business_id, activity_id, customer_id, customer_email_snapshot, status, created_at, abandoned_cart_email_sent_at")
      .eq("status", "pending")
      .is("abandoned_cart_email_sent_at", null);

    if (pErr) {
      console.error("[process-booking-abandoned-carts] pending list", pErr);
      return json({ error: pErr.message }, 500);
    }

    for (const p of pendingList || []) {
      const settings = await loadAbandonedSettings(supabase, p.business_id);
      if (!settings.enabled) continue;

      const created = new Date(p.created_at as string).getTime();
      const minMs = settings.hours * 60 * 60 * 1000;
      if (Date.now() - created < minMs) continue;

      const toEmail = await resolveEmailForPending(supabase, p);
      if (!toEmail) continue;

      const { data: act } = await supabase
        .from("booking_activities")
        .select("activity_name")
        .eq("id", p.activity_id)
        .maybeSingle();
      const activityName = act?.activity_name || "Activity";
      const resumeUrl = `${publicBase}/customer-portal/${p.business_id}/portal/${p.activity_id}`;

      try {
        const sent = await sendAbandonedCartEmail(supabase, supabaseUrl, serviceKey, {
          businessId: p.business_id,
          activityId: p.activity_id,
          activityName,
          toEmail,
          customerId: p.customer_id,
          campaignId: `abandoned-pending-${p.id}-${Date.now()}`,
          contactId: p.customer_id || p.id,
          resumeUrl,
          extraMessage: settings.extraMessage,
        });
        if (!sent) {
          errors.push(`pending ${p.id}: mail error`);
          continue;
        }
      } catch (mailErr) {
        errors.push(`pending ${p.id}: ${mailErr instanceof Error ? mailErr.message : "mail error"}`);
        continue;
      }

      const { error: upErr } = await supabase
        .from("booking_pending_helcim")
        .update({ abandoned_cart_email_sent_at: new Date().toISOString() })
        .eq("id", p.id);
      if (!upErr) sentPending += 1;
    }

    // Funnel: no open Helcim session (nudge earlier in the flow)
    const { data: funnelList, error: fErr } = await supabase
      .from("booking_portal_funnel")
      .select("id, business_id, activity_id, client_session_key, current_stage, customer_id, customer_email, pending_helcim_id, last_activity_at, abandoned_email_sent_at")
      .is("abandoned_email_sent_at", null)
      .neq("current_stage", "converted")
      .is("pending_helcim_id", null);

    if (fErr) {
      console.error("[process-booking-abandoned-carts] funnel list", fErr);
    } else {
      for (const f of funnelList || []) {
        const settings = await loadAbandonedSettings(supabase, f.business_id);
        if (!settings.enabled) continue;
        if (!stageMeetsMin(f.current_stage as string, settings.minStage)) continue;

        const last = new Date(f.last_activity_at as string).getTime();
        if (Date.now() - last < settings.hours * 60 * 60 * 1000) continue;

        const toEmail = await resolveEmailForFunnel(supabase, f);
        if (!toEmail) continue;

        const { data: act } = await supabase
          .from("booking_activities")
          .select("activity_name")
          .eq("id", f.activity_id)
          .maybeSingle();
        const activityName = act?.activity_name || "Activity";
        const resumeUrl = `${publicBase}/customer-portal/${f.business_id}/portal/${f.activity_id}`;

        try {
          const sent = await sendAbandonedCartEmail(supabase, supabaseUrl, serviceKey, {
            businessId: f.business_id,
            activityId: f.activity_id,
            activityName,
            toEmail,
            customerId: f.customer_id,
            campaignId: `abandoned-funnel-${f.id}-${Date.now()}`,
            contactId: f.customer_id || f.id,
            resumeUrl,
            extraMessage: settings.extraMessage,
          });
          if (!sent) {
            errors.push(`funnel ${f.id}: mail error`);
            continue;
          }
        } catch (mailErr) {
          errors.push(`funnel ${f.id}: ${mailErr instanceof Error ? mailErr.message : "mail error"}`);
          continue;
        }

        const { error: fuErr } = await supabase
          .from("booking_portal_funnel")
          .update({ abandoned_email_sent_at: new Date().toISOString() })
          .eq("id", f.id);
        if (!fuErr) sentFunnel += 1;
      }
    }

    return json({ ok: true, sentPending, sentFunnel, errors: errors.length ? errors : undefined }, 200);
  } catch (e) {
    console.error("[process-booking-abandoned-carts]", e);
    return json({ error: e instanceof Error ? e.message : "Server error" }, 500);
  }
});

async function resolveEmailForPending(
  supabase: ReturnType<typeof createClient>,
  p: { customer_id?: string | null; customer_email_snapshot?: string | null },
) {
  const snap = p.customer_email_snapshot?.trim();
  if (snap && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(snap)) return snap.toLowerCase();
  if (!p.customer_id) return null;
  const { data } = await supabase
    .from("pos_loyalty_accounts")
    .select("customer_email")
    .eq("id", p.customer_id)
    .maybeSingle();
  const em = data?.customer_email?.trim();
  if (em && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) return em.toLowerCase();
  return null;
}

async function resolveEmailForFunnel(
  supabase: ReturnType<typeof createClient>,
  f: { customer_email?: string | null; customer_id?: string | null },
) {
  const direct = f.customer_email?.trim();
  if (direct && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(direct)) return direct.toLowerCase();
  if (!f.customer_id) return null;
  const { data } = await supabase
    .from("pos_loyalty_accounts")
    .select("customer_email")
    .eq("id", f.customer_id)
    .maybeSingle();
  const em = data?.customer_email?.trim();
  if (em && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) return em.toLowerCase();
  return null;
}
