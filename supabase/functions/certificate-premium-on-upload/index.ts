import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  ESCALATION_HOURS,
  SUPABASE_SERVICE_ROLE_KEY,
  SUPABASE_URL,
  startChainApprovalNotifications,
} from "../_shared/shiftPremiumApproval.ts";

const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: corsHeaders });

async function resolvePublicUserId(
  admin: ReturnType<typeof createClient>,
  authUserId: string,
  email?: string | null,
) {
  if (email) {
    const { data } = await admin
      .from("users")
      .select("id")
      .eq("email", email.trim().toLowerCase())
      .maybeSingle();
    if (data?.id) return data.id as string;
  }
  const { data } = await admin.from("users").select("id").eq("id", authUserId).maybeSingle();
  return (data?.id as string) || authUserId;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

    const authClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: authData } = await authClient.auth.getUser();
    if (!authData.user?.id) return json({ error: "Unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const businessId = String(body.business_id || "").trim();
    const employeeCertificateId = String(body.employee_certificate_id || "").trim();

    if (!businessId || !employeeCertificateId) {
      return json({ error: "business_id and employee_certificate_id are required" }, 400);
    }

    const publicUserId = await resolvePublicUserId(admin, authData.user.id, authData.user.email);

    const { data: empCert, error: certErr } = await admin
      .from("employee_certificates")
      .select(`
        id,
        business_id,
        employee_id,
        certificate_id,
        certificate_file_url,
        hr_certificates(id, name)
      `)
      .eq("id", employeeCertificateId)
      .eq("business_id", businessId)
      .eq("employee_id", publicUserId)
      .maybeSingle();

    if (certErr || !empCert) return json({ error: "Certificate not found for this employee" }, 404);
    if (!empCert.certificate_file_url) {
      return json({ ok: true, assigned: [], message: "Certificate has no uploaded file yet" });
    }

    const { data: shiftPremiums, error: spErr } = await admin
      .from("hr_shift_premiums")
      .select("id, name, rate, applies_to, required_certificate_id")
      .eq("business_id", businessId)
      .eq("is_active", true)
      .eq("requires_certificate", true)
      .eq("required_certificate_id", empCert.certificate_id);

    if (spErr) throw spErr;
    if (!shiftPremiums?.length) {
      return json({ ok: true, assigned: [], message: "No shift premiums linked to this certificate" });
    }

    const { data: employee } = await admin
      .from("users")
      .select("id, full_name, first_name, last_name, email")
      .eq("id", publicUserId)
      .maybeSingle();

    const employeeName =
      employee?.full_name?.trim() ||
      `${employee?.first_name || ""} ${employee?.last_name || ""}`.trim() ||
      employee?.email ||
      "Employee";

    const certName =
      (empCert.hr_certificates as { name?: string } | null)?.name || "certificate";

    const [{ data: business }, { data: mailSettings }] = await Promise.all([
      admin.from("businesses").select("name").eq("id", businessId).maybeSingle(),
      admin.from("mail_settings").select("from_name").eq("business_id", businessId).maybeSingle(),
    ]);

    const businessName =
      String(business?.name || "").trim() ||
      String(mailSettings?.from_name || "").trim() ||
      "Tavari";
    const results: Array<Record<string, unknown>> = [];

    for (const premium of shiftPremiums) {
      const { data: existingActive } = await admin
        .from("hrpayroll_employee_premiums")
        .select("id")
        .eq("business_id", businessId)
        .eq("user_id", publicUserId)
        .eq("premium_name", premium.name)
        .eq("is_active", true)
        .eq("approval_status", "approved")
        .maybeSingle();

      if (existingActive?.id) {
        results.push({ premium_name: premium.name, skipped: "already_active" });
        continue;
      }

      const { data: existingPending } = await admin
        .from("hrpayroll_employee_premiums")
        .select("id")
        .eq("business_id", businessId)
        .eq("user_id", publicUserId)
        .eq("premium_name", premium.name)
        .eq("approval_status", "pending")
        .maybeSingle();

      if (existingPending?.id) {
        results.push({ premium_name: premium.name, skipped: "already_pending" });
        continue;
      }

      const { data: assignment, error: insErr } = await admin
        .from("hrpayroll_employee_premiums")
        .insert({
          business_id: businessId,
          user_id: publicUserId,
          premium_name: premium.name,
          premium_rate: premium.rate,
          applies_to_all_hours: premium.applies_to === "all_hours",
          is_active: false,
          approval_status: "pending",
          assignment_source: "certificate_upload",
          employee_certificate_id: employeeCertificateId,
          approval_chain_step: 0,
          approval_escalation_mode: "chain",
        })
        .select("id")
        .single();

      if (insErr) throw insErr;

      const notifyResult = await startChainApprovalNotifications(admin, {
        assignmentId: assignment.id,
        businessId,
        businessName,
        employeeId: publicUserId,
        employeeName,
        certName,
        premiumName: premium.name,
        certificateFilePath: empCert.certificate_file_url || null,
      });

      results.push({
        premium_name: premium.name,
        assignment_id: assignment.id,
        ...notifyResult,
      });
    }

    return json({ ok: true, assigned: results, escalation_hours: ESCALATION_HOURS });
  } catch (err) {
    console.error("certificate-premium-on-upload", err);
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
