import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const MAIL_BUSINESS_ID = (Deno.env.get("PULLCOPARENT_MAIL_BUSINESS_ID") || "").trim();
const APP_URL = (Deno.env.get("PULLCOPARENT_APP_URL") || "https://pulltogether.app/coparent").replace(/\/$/, "");
const FROM_NAME = "Pull Together: Co-Parent";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: corsHeaders });

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: authData, error: authError } = await userClient.auth.getUser();
    if (authError || !authData.user) return json({ error: "Unauthorized" }, 401);

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const settlementId = String(body.settlementId || "").trim();
    if (!settlementId) return json({ error: "settlementId is required" }, 400);

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: settlement, error: sErr } = await admin
      .from("pullcoparent_settlements")
      .select("id, household_id, from_user_id, to_user_id, amount, payment_date, note, status")
      .eq("id", settlementId)
      .maybeSingle();

    if (sErr || !settlement) return json({ error: "Settlement not found" }, 404);
    if (settlement.status !== "pending") return json({ ok: true, skipped: true });

    const { data: profiles } = await admin
      .from("pullcoparent_profiles")
      .select("user_id, display_name")
      .in("user_id", [settlement.from_user_id, settlement.to_user_id]);

    const names = Object.fromEntries((profiles || []).map((p) => [p.user_id, p.display_name || "Parent"]));
    const senderName = names[settlement.from_user_id] || "Your co-parent";
    const amount = Number(settlement.amount) || 0;
    const linkPath = `/app/expenses?confirm=${settlement.id}`;

    await admin.from("pullcoparent_notifications").insert({
      household_id: settlement.household_id,
      user_id: settlement.to_user_id,
      type: "settlement_pending",
      title: `${senderName} sent you $${amount.toFixed(2)}`,
      body: "Please confirm you received this payment.",
      link_path: linkPath,
      metadata: { settlement_id: settlement.id, amount, from_user_id: settlement.from_user_id },
    });

    const { data: recipientAuth } = await admin.auth.admin.getUserById(settlement.to_user_id);
    const email = recipientAuth?.user?.email;
    if (email && MAIL_BUSINESS_ID) {
      const confirmUrl = `${APP_URL}/app/expenses?confirm=${settlement.id}`;
      await fetch(`${SUPABASE_URL.replace(/\/$/, "")}/functions/v1/mail-send`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({
          businessId: MAIL_BUSINESS_ID,
          campaignId: `pullcoparent-settlement-${Date.now()}`,
          emailType: "transactional",
          to: email,
          fromEmail: "noreply@tavarios.ca",
          fromName: FROM_NAME,
          subject: `${senderName} says they sent you $${amount.toFixed(2)}`,
          html: `<p><strong>${senderName}</strong> recorded a payment of <strong>$${amount.toFixed(2)}</strong>.</p><p>Please confirm you received it in the app.</p><p><a href="${confirmUrl}">Confirm receipt</a></p>`,
          text: `${senderName} recorded a payment of $${amount.toFixed(2)}. Confirm receipt: ${confirmUrl}`,
        }),
      });
    }

    return json({ ok: true });
  } catch (err) {
    console.error("[pullcoparent-notify-settlement]", err);
    return json({ error: err instanceof Error ? err.message : "Internal error" }, 500);
  }
});
