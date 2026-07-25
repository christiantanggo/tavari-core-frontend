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
    const wantId = String(body.wantId || "").trim();
    if (!wantId) return json({ error: "wantId is required" }, 400);

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: want, error: wErr } = await admin
      .from("pullcoparent_child_wants")
      .select("id, household_id, child_id, want_type, title, event_date, event_time, created_by, status")
      .eq("id", wantId)
      .maybeSingle();

    if (wErr || !want) return json({ error: "Request not found" }, 404);
    if (want.status !== "pending") return json({ ok: true, skipped: true });

    const { data: child } = await admin.from("pullcoparent_children").select("name").eq("id", want.child_id).maybeSingle();
    const { data: creator } = await admin.from("pullcoparent_profiles").select("display_name").eq("user_id", want.created_by).maybeSingle();

    const { data: members } = await admin
      .from("pullcoparent_household_members")
      .select("user_id")
      .eq("household_id", want.household_id);

    const recipients = (members || []).map((m) => m.user_id as string).filter((id) => id !== want.created_by);
    const creatorName = creator?.display_name || "Your co-parent";
    const childName = child?.name || "your child";
    const reviewUrl = `${APP_URL}/app/wants?review=${want.id}`;

    for (const recipientId of recipients) {
      const { data: authUser } = await admin.auth.admin.getUserById(recipientId);
      const email = authUser?.user?.email;
      if (!email || !MAIL_BUSINESS_ID) continue;

      await fetch(`${SUPABASE_URL.replace(/\/$/, "")}/functions/v1/mail-send`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({
          businessId: MAIL_BUSINESS_ID,
          campaignId: `pullcoparent-want-${Date.now()}`,
          emailType: "transactional",
          to: email,
          fromEmail: "noreply@tavarios.ca",
          fromName: FROM_NAME,
          subject: `Review request: ${want.title}`,
          html: `<p><strong>${creatorName}</strong> submitted a request for ${childName}.</p><p><strong>${want.title}</strong></p><p><a href="${reviewUrl}">Review in the app</a></p>`,
          text: `${creatorName} submitted a request for ${childName}: ${want.title}. Review: ${reviewUrl}`,
        }),
      });
    }

    return json({ ok: true, emailed: recipients.length });
  } catch (err) {
    console.error("[pullcoparent-notify-child-want]", err);
    return json({ error: err instanceof Error ? err.message : "Internal error" }, 500);
  }
});
