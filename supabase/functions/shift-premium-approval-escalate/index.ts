import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  ESCALATION_HOURS,
  SUPABASE_SERVICE_ROLE_KEY,
  SUPABASE_URL,
  escalatePendingAssignment,
} from "../_shared/shiftPremiumApproval.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-shift-premium-approval-escalate-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body, null, 2), { status, headers: corsHeaders });

async function authorizeCronOrService(req: Request, admin: ReturnType<typeof createClient>) {
  const authHeader = req.headers.get("Authorization") || "";
  if (authHeader === `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`) return true;

  const requestSecret = (req.headers.get("x-shift-premium-approval-escalate-cron-secret") || "").trim();
  if (!requestSecret) return false;

  const { data } = await admin
    .from("system_runtime_secrets")
    .select("secret_value")
    .eq("key_name", "shift_premium_approval_escalate_cron_secret")
    .maybeSingle();

  return Boolean(data?.secret_value && data.secret_value === requestSecret);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const authorized = await authorizeCronOrService(req, admin);
    if (!authorized) return json({ error: "Unauthorized" }, 401);

    const cutoff = new Date(Date.now() - ESCALATION_HOURS * 60 * 60 * 1000).toISOString();

    const { data: pending, error } = await admin
      .from("hrpayroll_employee_premiums")
      .select(`
        id,
        business_id,
        user_id,
        premium_name,
        approval_chain_step,
        approval_escalation_mode,
        approval_last_notified_at,
        employee_certificate_id
      `)
      .eq("approval_status", "pending")
      .eq("assignment_source", "certificate_upload")
      .lt("approval_last_notified_at", cutoff)
      .neq("approval_escalation_mode", "all_managers");

    if (error) throw error;

    const results: Array<Record<string, unknown>> = [];
    for (const row of pending || []) {
      try {
        const result = await escalatePendingAssignment(admin, row);
        results.push(result);
      } catch (rowErr) {
        console.error("escalate assignment failed", row.id, rowErr);
        results.push({
          assignment_id: row.id,
          error: rowErr instanceof Error ? rowErr.message : String(rowErr),
        });
      }
    }

    return json({
      ok: true,
      escalation_hours: ESCALATION_HOURS,
      processed: results.length,
      results,
    });
  } catch (err) {
    console.error("[shift-premium-approval-escalate]", err);
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
