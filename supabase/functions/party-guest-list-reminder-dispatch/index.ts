// Cron: party guest list host reminders + staff alerts for incomplete lists past deadline.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { normalizeBookingEmail } from "../_shared/bookingRecipientEmail.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-reminder-dispatch-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const authHeader = req.headers.get("Authorization") || "";
  if (authHeader !== `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`) {
    const secret = req.headers.get("x-reminder-dispatch-cron-secret") || "";
    const { data } = await supabase
      .from("system_runtime_secrets")
      .select("secret_value")
      .eq("key_name", "reminder_dispatch_cron_secret")
      .maybeSingle();
    if (!secret || !data?.secret_value || data.secret_value !== secret) {
      return json({ error: "Unauthorized" }, 401);
    }
  }

  const siteUrl = (Deno.env.get("PUBLIC_SITE_URL") || "https://tavarios.ca").replace(/\/$/, "");
  let hostReminders = 0;
  let staffAlerts = 0;

  const { data: settingsRows } = await supabase.from("party_guest_list_settings").select("*");
  const settingsByBiz = new Map((settingsRows || []).map((s) => [s.business_id, s]));

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const { data: lists } = await supabase
    .from("party_guest_lists")
    .select("id, business_id, booker_phone, party_date, status, booking_id")
    .gte("party_date", today.toISOString().slice(0, 10))
    .lte("party_date", new Date(today.getTime() + 14 * 86400000).toISOString().slice(0, 10));

  for (const list of lists || []) {
    const settings = settingsByBiz.get(list.business_id);
    const deadlineDays = Number(settings?.edit_deadline_days_before_party) || 7;
    if (!list.party_date) continue;

    const partyDate = new Date(`${list.party_date}T12:00:00`);
    const deadline = new Date(partyDate);
    deadline.setDate(deadline.getDate() - deadlineDays);

    const { count } = await supabase
      .from("party_guest_entries")
      .select("id", { count: "exact", head: true })
      .eq("guest_list_id", list.id);

    const incomplete = (count || 0) === 0;
    const pastDeadline = today > deadline;

    if (incomplete && today.getTime() === deadline.getTime()) {
      const reminderKey = `host_reminder_${list.party_date}`;
      const { error: logErr } = await supabase.from("party_guest_list_reminder_log").insert({
        guest_list_id: list.id,
        reminder_key: reminderKey,
      });
      if (!logErr) {
        hostReminders += 1;
        const portalUrl = `${siteUrl}/customer-portal/${list.business_id}/party-guest-list`;
        const { data: customer } = await supabase.rpc("bookings_get_portal_customer_by_phone", {
          p_business_id: list.business_id,
          p_phone_number: list.booker_phone,
        });
        const row = Array.isArray(customer) ? customer[0] : customer;
        const email = String(row?.customer_email || "").trim();
        if (email) {
          let cc: string | undefined;
          if (list.booking_id) {
            const { data: bookingRow } = await supabase
              .from("bookings")
              .select("secondary_customer_email")
              .eq("id", list.booking_id)
              .eq("business_id", list.business_id)
              .maybeSingle();
            const secondary = normalizeBookingEmail(bookingRow?.secondary_customer_email);
            if (secondary && secondary !== email.trim().toLowerCase()) {
              cc = secondary;
            }
          }
          await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/mail-send`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              apikey: Deno.env.get("SUPABASE_ANON_KEY") || "",
              Authorization: `Bearer ${Deno.env.get("SUPABASE_ANON_KEY") || ""}`,
            },
            body: JSON.stringify({
              businessId: list.business_id,
              campaignId: `party-guest-reminder-${list.id}-${Date.now()}`,
              emailType: "transactional",
              to: email,
              ...(cc ? { cc } : {}),
              fromEmail: "noreply@tavarios.ca",
              fromName: "Party Guest List Reminder",
              subject: "Reminder: submit your party guest list",
              html: `<p>Your party is coming up on ${list.party_date}. Please submit your guest list:</p><p><a href="${portalUrl}">${portalUrl}</a></p>`,
              text: `Your party is on ${list.party_date}. Submit your guest list: ${portalUrl}`,
            }),
          });
        }
      }
    }

    if (incomplete && pastDeadline && !list.staff_notified_at) {
      const emails = (settings?.staff_notification_emails || []) as string[];
      for (const to of emails) {
        await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/mail-send`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: Deno.env.get("SUPABASE_ANON_KEY") || "",
            Authorization: `Bearer ${Deno.env.get("SUPABASE_ANON_KEY") || ""}`,
          },
          body: JSON.stringify({
            businessId: list.business_id,
            campaignId: `party-guest-staff-incomplete-${list.id}`,
            emailType: "transactional",
            to,
            fromEmail: "noreply@tavarios.ca",
            fromName: "Tavari Party Guest List",
            subject: "Incomplete party guest list past deadline",
            html: `<p>Guest list ${list.id} for ${list.party_date} is incomplete past the edit deadline.</p>`,
            text: `Guest list ${list.id} for ${list.party_date} is incomplete past the edit deadline.`,
          }),
        });
      }
      await supabase.from("party_guest_lists").update({ staff_notified_at: new Date().toISOString() }).eq("id", list.id);
      staffAlerts += 1;
    }
  }

  return json({ ok: true, hostReminders, staffAlerts });
});
