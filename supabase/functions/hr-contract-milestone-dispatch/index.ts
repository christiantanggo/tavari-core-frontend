import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const DEFAULT_PUBLIC_SITE_URL = "https://tavarios.ca";
const FROM_EMAIL = "noreply@tavarios.ca";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-hr-contract-milestone-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body, null, 2), { status, headers: corsHeaders });

type MilestoneDef = {
  key: string;
  daysBefore: number;
  kind: "probation" | "contract_end";
  subjectPrefix: string;
};

const MILESTONES: MilestoneDef[] = [
  { key: "contract_end_28d", daysBefore: 28, kind: "contract_end", subjectPrefix: "Contract ending in 4 weeks" },
  { key: "probation_end_28d", daysBefore: 28, kind: "probation", subjectPrefix: "Probation ending in 4 weeks" },
  { key: "probation_end_14d", daysBefore: 14, kind: "probation", subjectPrefix: "Probation ending in 2 weeks" },
  { key: "probation_end_1d", daysBefore: 1, kind: "probation", subjectPrefix: "Probation ending tomorrow" },
];

const parseDateOnly = (value: unknown): Date | null => {
  if (!value) return null;
  const raw = String(value).trim();
  const dateOnly = raw.includes("T") ? raw.split("T")[0] : raw;
  const parts = dateOnly.split("-").map(Number);
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) return null;
  return new Date(parts[0], parts[1] - 1, parts[2]);
};

const startOfDay = (date: Date) => {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
};

const daysBetween = (from: Date, to: Date) => {
  const ms = startOfDay(to).getTime() - startOfDay(from).getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
};

const formatDateCa = (d: Date) =>
  d.toLocaleDateString("en-CA", { year: "numeric", month: "long", day: "numeric" });

function getProbationEndDate(contract: Record<string, unknown>): Date | null {
  if (contract.probation_end_date) {
    return parseDateOnly(contract.probation_end_date);
  }
  const contractData = contract.contract_data as Record<string, unknown> | undefined;
  const keyTerms = (contractData?.keyTerms || {}) as Record<string, unknown>;
  if (keyTerms.probationEndDate) {
    return parseDateOnly(keyTerms.probationEndDate);
  }
  if (keyTerms.contractStartDate && keyTerms.probationaryPeriod) {
    const start = parseDateOnly(keyTerms.contractStartDate);
    if (!start) return null;
    const end = new Date(start);
    end.setDate(end.getDate() + Number(keyTerms.probationaryPeriod || 90));
    return end;
  }
  return null;
}

function getContractEndDate(contract: Record<string, unknown>): Date | null {
  const contractData = contract.contract_data as Record<string, unknown> | undefined;
  const keyTerms = (contractData?.keyTerms || {}) as Record<string, unknown>;
  return (
    parseDateOnly(contract.end_date) ||
    parseDateOnly(contract.expiry_date) ||
    parseDateOnly(keyTerms.contractEndDate) ||
    null
  );
}

function resolvePublicSiteUrl() {
  const raw = (Deno.env.get("PUBLIC_SITE_URL") || Deno.env.get("VITE_PUBLIC_SITE_URL") || "").trim();
  if (raw) return raw.replace(/\/$/, "");
  return DEFAULT_PUBLIC_SITE_URL;
}

async function authorizeCron(req: Request, admin: ReturnType<typeof createClient>) {
  const authHeader = req.headers.get("Authorization") || "";
  if (authHeader === `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`) return true;

  const requestSecret = (req.headers.get("x-hr-contract-milestone-cron-secret") || "").trim();
  if (!requestSecret) return false;

  const { data } = await admin
    .from("system_runtime_secrets")
    .select("secret_value")
    .eq("key_name", "hr_contract_milestone_cron_secret")
    .maybeSingle();

  return Boolean(data?.secret_value && data.secret_value === requestSecret);
}

function employeeDisplayName(contract: Record<string, unknown>) {
  const first = String(contract.employee_first_name || "").trim();
  const last = String(contract.employee_last_name || "").trim();
  const combined = `${first} ${last}`.trim();
  if (combined) return combined;
  const contractData = contract.contract_data as Record<string, unknown> | undefined;
  const keyTerms = (contractData?.keyTerms || {}) as Record<string, unknown>;
  const ktFirst = String(keyTerms.employeeFirstName || keyTerms.firstName || "").trim();
  const ktLast = String(keyTerms.employeeLastName || keyTerms.lastName || "").trim();
  return `${ktFirst} ${ktLast}`.trim() || String(contract.employee_email || "Employee");
}

function buildEmailHtml(input: {
  businessName: string;
  employeeName: string;
  milestoneLabel: string;
  endDateLabel: string;
  daysBefore: number;
  contractsUrl: string;
}) {
  const lead =
    input.daysBefore === 1
      ? "is tomorrow"
      : input.daysBefore === 14
        ? "is in 2 weeks"
        : input.daysBefore === 28
          ? "is in 4 weeks"
          : `is in ${input.daysBefore} days`;

  return `<!DOCTYPE html>
<html><body style="font-family:Arial,sans-serif;line-height:1.6;color:#333;max-width:640px;margin:0 auto;padding:24px;">
  <h2 style="color:#008080;">${input.milestoneLabel} ${lead}</h2>
  <p>Dear Authorized Representative,</p>
  <p>
    The <strong>${input.milestoneLabel.toLowerCase()}</strong> for
    <strong>${input.employeeName}</strong> at <strong>${input.businessName}</strong>
    ${lead} (<strong>${input.endDateLabel}</strong>).
  </p>
  <p>Please review and decide whether to:</p>
  <ul>
    <li>Move the employee to permanent status,</li>
    <li>Issue a new contract, or</li>
    <li>Plan termination at the end of the period.</li>
  </ul>
  <p style="margin:24px 0;">
    <a href="${input.contractsUrl}" style="background:#008080;color:#fff;padding:12px 20px;text-decoration:none;border-radius:6px;display:inline-block;">
      Open HR Contracts
    </a>
  </p>
  <p style="font-size:12px;color:#666;">Sent automatically by Tavari HR.</p>
</body></html>`;
}

async function sendMilestoneEmail(
  admin: ReturnType<typeof createClient>,
  input: {
    businessId: string;
    businessName: string;
    contractId: string;
    milestone: MilestoneDef;
    targetDate: Date;
    to: string;
    cc?: string;
    employeeName: string;
  },
) {
  const siteUrl = resolvePublicSiteUrl();
  const contractsUrl = `${siteUrl}/dashboard/hr/contract-management`;
  const endDateLabel = formatDateCa(input.targetDate);
  const milestoneLabel =
    input.milestone.kind === "contract_end" ? "Contract end date" : "Probation end date";

  const subject = `${input.milestone.subjectPrefix} — ${input.employeeName}`;
  const html = buildEmailHtml({
    businessName: input.businessName,
    employeeName: input.employeeName,
    milestoneLabel,
    endDateLabel,
    daysBefore: input.milestone.daysBefore,
    contractsUrl,
  });
  const text = [
    `${milestoneLabel} for ${input.employeeName} at ${input.businessName} (${endDateLabel}).`,
    "",
    "Please review: make permanent, issue a new contract, or plan termination.",
    contractsUrl,
  ].join("\n");

  const targetDateStr = input.targetDate.toISOString().split("T")[0];

  const { data: existing } = await admin
    .from("hr_contract_notification_log")
    .select("id")
    .eq("contract_id", input.contractId)
    .eq("milestone_key", input.milestone.key)
    .eq("target_date", targetDateStr)
    .maybeSingle();

  if (existing?.id) {
    return { skipped: true, reason: "already_sent" };
  }

  const response = await fetch(`${SUPABASE_URL.replace(/\/$/, "")}/functions/v1/mail-send`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify({
      businessId: input.businessId,
      campaignId: `hr-milestone-${input.contractId}-${input.milestone.key}-${targetDateStr}`,
      emailType: "transactional",
      to: input.to,
      cc: input.cc || undefined,
      fromEmail: FROM_EMAIL,
      fromName: `HR — ${input.businessName}`,
      subject,
      html,
      text,
    }),
  });

  const payload = await response.json().catch(() => null);
  const ok = response.ok && payload?.ok === true;
  const errorMessage = ok ? null : String(payload?.error || `HTTP ${response.status}`);

  await admin.from("hr_contract_notification_log").insert({
    business_id: input.businessId,
    contract_id: input.contractId,
    milestone_key: input.milestone.key,
    target_date: targetDateStr,
    days_before: input.milestone.daysBefore,
    recipient_email: input.to,
    mail_message_id: payload?.messageId || null,
    error_message: errorMessage,
  });

  if (!ok) throw new Error(errorMessage || "mail-send failed");
  return { skipped: false, sent: true };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  if (!(await authorizeCron(req, admin))) {
    return json({ error: "Unauthorized" }, 401);
  }

  const today = startOfDay(new Date());
  const stats = { scanned: 0, sent: 0, skipped: 0, errors: 0 };

  const { data: contracts, error } = await admin
    .from("hr_contracts")
    .select(
      `id, business_id, employee_email, employee_first_name, employee_last_name,
       status, contract_type, start_date, end_date, expiry_date, probation_end_date,
       contract_data, authorized_representative_email, authorized_representative_name, hr_email`,
    )
    .in("status", ["signed", "active"]);

  if (error) return json({ error: error.message }, 500);

  const businessNameCache = new Map<string, string>();

  for (const contract of contracts || []) {
    stats.scanned += 1;

    const authRepEmail = String(
      contract.authorized_representative_email ||
        (contract.contract_data as Record<string, unknown>)?.authorized_representative_email ||
        "",
    )
      .trim()
      .toLowerCase();

    if (!authRepEmail) {
      stats.skipped += 1;
      continue;
    }

    let businessName = businessNameCache.get(contract.business_id);
    if (!businessName) {
      const [{ data: biz }, { data: mailSettings }] = await Promise.all([
        admin.from("businesses").select("name").eq("id", contract.business_id).maybeSingle(),
        admin
          .from("mail_settings")
          .select("from_name")
          .eq("business_id", contract.business_id)
          .maybeSingle(),
      ]);
      businessName =
        String(biz?.name || "").trim() ||
        String(mailSettings?.from_name || "").trim() ||
        "Tavari";
      businessNameCache.set(contract.business_id, businessName);
    }

    const employeeName = employeeDisplayName(contract as Record<string, unknown>);
    const hrCc = String(contract.hr_email || "").trim() || undefined;

    for (const milestone of MILESTONES) {
      const endDate =
        milestone.kind === "contract_end"
          ? getContractEndDate(contract as Record<string, unknown>)
          : getProbationEndDate(contract as Record<string, unknown>);

      if (!endDate) continue;

      const daysUntil = daysBetween(today, endDate);
      if (daysUntil !== milestone.daysBefore) continue;

      try {
        const result = await sendMilestoneEmail(admin, {
          businessId: contract.business_id,
          businessName,
          contractId: contract.id,
          milestone,
          targetDate: endDate,
          to: authRepEmail,
          cc: hrCc,
          employeeName,
        });
        if (result.skipped) stats.skipped += 1;
        else stats.sent += 1;
      } catch (e) {
        stats.errors += 1;
        console.error("[hr-contract-milestone-dispatch]", contract.id, milestone.key, e);
      }
    }
  }

  return json({ ok: true, ...stats });
});
