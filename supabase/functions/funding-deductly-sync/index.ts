// Sync Deductly open programs for a business and create Reminder alerts for new matches.
// Deploy: npx supabase functions deploy funding-deductly-sync --no-verify-jwt
// Body: { business_id } or { action: "sync_all" } (service role / cron)

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const DEDUCTLY_BASE = "https://www.deductly.ca/api/v1/programs";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function fetchPrograms(params: {
  province?: string | null;
  industry?: string | null;
  types?: string[] | null;
}) {
  const all: Array<Record<string, unknown>> = [];
  const types = params.types?.length ? params.types : [""];

  for (const type of types) {
    const qs = new URLSearchParams();
    if (params.province) qs.set("province", params.province);
    if (params.industry) qs.set("industry", params.industry);
    if (type) qs.set("type", type);
    qs.set("limit", "100");

    const res = await fetch(`${DEDUCTLY_BASE}?${qs}`, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Deductly ${res.status}: ${text.slice(0, 200)}`);
    }
    const data = await res.json() as { results?: Array<Record<string, unknown>> };
    for (const row of data.results || []) {
      if (row?.id) all.push(row);
    }
  }

  const byId = new Map<string, Record<string, unknown>>();
  for (const row of all) byId.set(String(row.id), row);
  return [...byId.values()];
}

async function syncBusiness(
  admin: ReturnType<typeof createClient>,
  businessId: string,
) {
  const { data: settings } = await admin
    .from("funding_settings")
    .select("*")
    .eq("business_id", businessId)
    .maybeSingle();

  if (settings && settings.deductly_alerts_enabled === false) {
    return { business_id: businessId, skipped: true, new_count: 0 };
  }

  const programs = await fetchPrograms({
    province: settings?.deductly_province,
    industry: settings?.deductly_industry,
    types: settings?.deductly_program_types || ["grant"],
  });

  const now = new Date().toISOString();
  let newCount = 0;
  const newMatches: Array<{ id: string; name: string; application_url?: string }> = [];

  for (const program of programs) {
    const programId = String(program.id);
    const { data: existing } = await admin
      .from("funding_program_matches")
      .select("id")
      .eq("business_id", businessId)
      .eq("deductly_program_id", programId)
      .maybeSingle();

    const isNew = !existing;
    const { data: upserted, error } = await admin
      .from("funding_program_matches")
      .upsert({
        business_id: businessId,
        deductly_program_id: programId,
        name: String(program.name || programId),
        program_type: program.type ? String(program.type) : null,
        description: String(program.description || ""),
        estimated_value: program.estimated_value ? String(program.estimated_value) : null,
        application_url: program.application_url ? String(program.application_url) : null,
        deadline: program.deadline ? String(program.deadline) : null,
        eligibility: program.eligibility || {},
        raw: program,
        last_seen_at: now,
        is_new: isNew,
      }, { onConflict: "business_id,deductly_program_id" })
      .select("id, name, application_url")
      .single();

    if (error) throw error;
    if (isNew && upserted) {
      newCount += 1;
      newMatches.push(upserted);
    }
  }

  // Create Reminder module alerts for newly discovered programs
  for (const match of newMatches.slice(0, 10)) {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const onceDate = tomorrow.toISOString().slice(0, 10);

    const { data: reminder, error: remError } = await admin
      .from("tavari_reminders")
      .insert({
        business_id: businessId,
        title: `New funding program: ${match.name}`,
        body: `A new open program matched your Funding filters: ${match.name}.${
          match.application_url ? ` Apply: ${match.application_url}` : ""
        }\n\nReview in Tavari Funding → Opportunities.`,
        schedule_type: "once",
        schedule_time: "09:00",
        schedule_once_date: onceDate,
        starts_on: onceDate,
        ends_on: onceDate,
        send_on_weekends: true,
        paused: false,
        snooze_max: 2,
        repeat_until_complete: true,
        custom_links: match.application_url
          ? [{ label: "Program page", url: match.application_url }]
          : [],
        manual_emails: [],
      })
      .select("id")
      .single();

    if (!remError && reminder?.id) {
      await admin.from("funding_program_alerts").insert({
        business_id: businessId,
        program_match_id: match.id,
        reminder_id: reminder.id,
        sent_at: now,
      });

      // Best-effort: materialize schedule via existing dispatch function
      try {
        const dispatchUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/reminder-dispatch`;
        await fetch(dispatchUrl, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ action: "process", reminder_id: reminder.id }),
        });
      } catch (e) {
        console.warn("[funding-deductly-sync] reminder-dispatch failed", e);
      }
    }
  }

  return {
    business_id: businessId,
    skipped: false,
    synced: programs.length,
    new_count: newCount,
  };
}

Deno.serve(async (req: Request) => {
  try {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

    const body = await req.json().catch(() => ({})) as {
      action?: string;
      business_id?: string;
    };

    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const admin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      serviceKey,
    );

    const authHeader = req.headers.get("Authorization") || "";
    const isService = authHeader.includes(serviceKey) && !!serviceKey;

    if (body.action === "sync_all") {
      if (!isService) return json({ error: "Forbidden" }, 403);
      const { data: settingsRows, error } = await admin
        .from("funding_settings")
        .select("business_id")
        .eq("deductly_alerts_enabled", true);
      if (error) throw error;

      const results = [];
      for (const row of settingsRows || []) {
        results.push(await syncBusiness(admin, row.business_id));
      }
      return json({ ok: true, results });
    }

    if (!body.business_id) return json({ error: "business_id required" }, 400);

    if (!isService) {
      const userClient = createClient(
        Deno.env.get("SUPABASE_URL") ?? "",
        Deno.env.get("SUPABASE_ANON_KEY") ?? "",
        { global: { headers: { Authorization: authHeader } } },
      );
      const { data: userData } = await userClient.auth.getUser();
      if (!userData?.user) return json({ error: "Unauthorized" }, 401);

      const { data: member } = await admin
        .from("business_users")
        .select("user_id")
        .eq("business_id", body.business_id)
        .eq("user_id", userData.user.id)
        .maybeSingle();
      if (!member) return json({ error: "Forbidden" }, 403);
    }

    const result = await syncBusiness(admin, body.business_id);
    return json({ ok: true, ...result });
  } catch (err) {
    console.error("[funding-deductly-sync]", err);
    return json({ error: err instanceof Error ? err.message : "Unexpected error" }, 500);
  }
});
