import { createClient } from "npm:@supabase/supabase-js@2";
import { buildShiftPremiumApprovalEmailHtml } from "./shiftPremiumApprovalEmail.ts";

export const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
export const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
export const DEFAULT_PUBLIC_SITE_URL = "https://tavarios.ca";
export const FROM_EMAIL = "noreply@tavarios.ca";
export const MANAGER_ROLES = ["owner", "admin", "manager"];
/** Hours to wait at each chain step before escalating. */
export const ESCALATION_HOURS = 48;
export const MAX_CHAIN_DEPTH = 12;

export type ManagerContact = {
  id: string;
  email: string;
  full_name: string | null;
};

export function resolvePublicSiteUrl() {
  const raw = (Deno.env.get("PUBLIC_SITE_URL") || Deno.env.get("VITE_PUBLIC_SITE_URL") || "").trim();
  return raw ? raw.replace(/\/$/, "") : DEFAULT_PUBLIC_SITE_URL;
}

export function generateToken() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function getManagerChain(
  admin: ReturnType<typeof createClient>,
  employeeId: string,
): Promise<ManagerContact[]> {
  const chain: ManagerContact[] = [];
  const visited = new Set<string>();
  let currentEmployeeId = employeeId;

  for (let depth = 0; depth < MAX_CHAIN_DEPTH; depth++) {
    const { data: employee } = await admin
      .from("users")
      .select("id, manager_id")
      .eq("id", currentEmployeeId)
      .maybeSingle();

    const managerId = employee?.manager_id as string | null | undefined;
    if (!managerId || visited.has(managerId)) break;

    visited.add(managerId);

    const { data: manager } = await admin
      .from("users")
      .select("id, email, full_name")
      .eq("id", managerId)
      .maybeSingle();

    if (manager?.id && manager.email?.trim()) {
      chain.push({
        id: manager.id,
        email: manager.email.trim().toLowerCase(),
        full_name: manager.full_name ?? null,
      });
    }

    currentEmployeeId = managerId;
  }

  return chain;
}

export async function loadBusinessManagers(
  admin: ReturnType<typeof createClient>,
  businessId: string,
): Promise<ManagerContact[]> {
  const byId = new Map<string, ManagerContact>();

  const { data: buRows } = await admin
    .from("business_users")
    .select("user_id, role, users!inner(id, email, full_name)")
    .eq("business_id", businessId)
    .in("role", MANAGER_ROLES);

  for (const row of buRows || []) {
    const u = row.users as { id: string; email: string; full_name: string | null };
    if (u?.email) {
      byId.set(u.id, { id: u.id, email: u.email.trim().toLowerCase(), full_name: u.full_name });
    }
  }

  const { data: urRows } = await admin
    .from("user_roles")
    .select("user_id, role, users!inner(id, email, full_name)")
    .eq("business_id", businessId)
    .eq("active", true)
    .in("role", MANAGER_ROLES);

  for (const row of urRows || []) {
    const u = row.users as { id: string; email: string; full_name: string | null };
    if (u?.email) {
      byId.set(u.id, { id: u.id, email: u.email.trim().toLowerCase(), full_name: u.full_name });
    }
  }

  return [...byId.values()];
}

async function createCertificateSignedUrl(
  admin: ReturnType<typeof createClient>,
  filePath: string | null | undefined,
  expiresInSeconds = 30 * 24 * 60 * 60,
): Promise<string | null> {
  const path = String(filePath || "").trim();
  if (!path) return null;
  try {
    const { data, error } = await admin.storage
      .from("employee-certificates")
      .createSignedUrl(path, expiresInSeconds);
    if (error || !data?.signedUrl) {
      console.error("certificate signed URL failed", error);
      return null;
    }
    return data.signedUrl;
  } catch (err) {
    console.error("certificate signed URL exception", err);
    return null;
  }
}

async function sendManagerEmail(input: {
  businessId: string;
  businessName: string;
  to: string;
  managerUserId: string;
  subject: string;
  body: string;
  approveUrl: string;
  rejectUrl: string;
  viewCertificateUrl?: string | null;
  premiumAssignmentId: string;
  campaignSuffix: string;
}) {
  const html = buildShiftPremiumApprovalEmailHtml({
    businessName: input.businessName,
    title: input.subject,
    body: input.body,
    approveUrl: input.approveUrl,
    rejectUrl: input.rejectUrl,
    viewCertificateUrl: input.viewCertificateUrl,
  });

  const textParts = [
    input.subject,
    "",
    input.body,
    "",
  ];
  if (input.viewCertificateUrl) {
    textParts.push(`View certificate: ${input.viewCertificateUrl}`, "");
  }
  textParts.push(
    `Approve: ${input.approveUrl}`,
    `Reject: ${input.rejectUrl}`,
    "",
    `Sent by ${input.businessName} through Tavari HR.`,
  );
  const text = textParts.join("\n");

  const response = await fetch(`${SUPABASE_URL.replace(/\/$/, "")}/functions/v1/mail-send`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify({
      businessId: input.businessId,
      campaignId: `shift-premium-approval-${input.premiumAssignmentId}-${input.campaignSuffix}`,
      emailType: "transactional",
      to: input.to,
      fromEmail: FROM_EMAIL,
      fromName: `HR - ${input.businessName}`,
      subject: input.subject,
      html,
      text,
    }),
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.ok !== true) {
    throw new Error(String(payload?.error || `mail-send failed (${response.status})`));
  }
}

export async function notifyManagersForAssignment(
  admin: ReturnType<typeof createClient>,
  input: {
    assignmentId: string;
    businessId: string;
    businessName: string;
    employeeName: string;
    certName: string;
    premiumName: string;
    certificateFilePath?: string | null;
    recipients: ManagerContact[];
    escalationNote?: string;
    campaignSuffix: string;
  },
) {
  const siteUrl = resolvePublicSiteUrl();
  const actionBase = `${siteUrl}/shift-premium/approval`;
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  const viewCertificateUrl = await createCertificateSignedUrl(admin, input.certificateFilePath);

  const subject = `Approve shift premium for ${input.employeeName}`;
  const bodyParts = [
    `${input.employeeName} uploaded their ${input.certName} certificate.`,
    "",
    `Please open the uploaded certificate and confirm it matches "${input.certName}" before approving.`,
    "",
    `Please review and approve the "${input.premiumName}" shift premium assignment.`,
    "This premium will not apply to payroll until you approve it.",
  ];
  if (input.escalationNote) {
    bodyParts.push("", input.escalationNote);
  }
  const emailBody = bodyParts.join("\n");

  let notified = 0;
  for (const manager of input.recipients) {
    const approveToken = generateToken();
    const rejectToken = generateToken();

    await admin.from("shift_premium_approval_action_tokens").insert([
      {
        token: approveToken,
        premium_assignment_id: input.assignmentId,
        business_id: input.businessId,
        manager_user_id: manager.id,
        manager_email: manager.email,
        action: "approve",
        expires_at: expiresAt,
      },
      {
        token: rejectToken,
        premium_assignment_id: input.assignmentId,
        business_id: input.businessId,
        manager_user_id: manager.id,
        manager_email: manager.email,
        action: "reject",
        expires_at: expiresAt,
      },
    ]);

    try {
      await sendManagerEmail({
        businessId: input.businessId,
        businessName: input.businessName,
        to: manager.email,
        managerUserId: manager.id,
        subject,
        body: emailBody,
        approveUrl: `${actionBase}?token=${approveToken}&action=approve`,
        rejectUrl: `${actionBase}?token=${rejectToken}&action=reject`,
        viewCertificateUrl,
        premiumAssignmentId: input.assignmentId,
        campaignSuffix: `${input.campaignSuffix}-${manager.id}`,
      });
      notified += 1;
    } catch (mailErr) {
      console.error("shift premium approval email failed", manager.email, mailErr);
    }
  }

  return notified;
}

export async function startChainApprovalNotifications(
  admin: ReturnType<typeof createClient>,
  input: {
    assignmentId: string;
    businessId: string;
    businessName: string;
    employeeId: string;
    employeeName: string;
    certName: string;
    premiumName: string;
    certificateFilePath?: string | null;
  },
) {
  const chain = await getManagerChain(admin, input.employeeId);
  const now = new Date().toISOString();

  if (!chain.length) {
    const managers = await loadBusinessManagers(admin, input.businessId);
    if (!managers.length) {
      throw new Error("No managers found to approve shift premiums");
    }

    await admin
      .from("hrpayroll_employee_premiums")
      .update({
        approval_chain_step: 0,
        approval_escalation_mode: "all_managers",
        approval_last_notified_at: now,
      })
      .eq("id", input.assignmentId);

    const notified = await notifyManagersForAssignment(admin, {
      ...input,
      recipients: managers,
      escalationNote:
        "No direct manager is on file for this employee, so this was sent to all business managers.",
      campaignSuffix: "all-initial",
    });

    return { mode: "all_managers", chain_length: 0, notified };
  }

  await admin
    .from("hrpayroll_employee_premiums")
    .update({
      approval_chain_step: 0,
      approval_escalation_mode: "chain",
      approval_last_notified_at: now,
    })
    .eq("id", input.assignmentId);

  const notified = await notifyManagersForAssignment(admin, {
    ...input,
    recipients: [chain[0]],
    campaignSuffix: "chain-0",
  });

  return { mode: "chain", chain_length: chain.length, notified };
}

export async function escalatePendingAssignment(
  admin: ReturnType<typeof createClient>,
  assignment: {
    id: string;
    business_id: string;
    user_id: string;
    premium_name: string;
    approval_chain_step: number | null;
    approval_escalation_mode: string | null;
    approval_last_notified_at: string | null;
    employee_certificate_id: string | null;
  },
) {
  const [{ data: business }, { data: mailSettings }] = await Promise.all([
    admin.from("businesses").select("name").eq("id", assignment.business_id).maybeSingle(),
    admin
      .from("mail_settings")
      .select("from_name")
      .eq("business_id", assignment.business_id)
      .maybeSingle(),
  ]);
  const businessName =
    String(business?.name || "").trim() ||
    String(mailSettings?.from_name || "").trim() ||
    "Tavari";

  const { data: employee } = await admin
    .from("users")
    .select("id, full_name, first_name, last_name, email")
    .eq("id", assignment.user_id)
    .maybeSingle();

  const employeeName =
    employee?.full_name?.trim() ||
    `${employee?.first_name || ""} ${employee?.last_name || ""}`.trim() ||
    employee?.email ||
    "Employee";

  let certName = "certificate";
  let certificateFilePath: string | null = null;
  if (assignment.employee_certificate_id) {
    const { data: empCert } = await admin
      .from("employee_certificates")
      .select("certificate_file_url, hr_certificates(name)")
      .eq("id", assignment.employee_certificate_id)
      .maybeSingle();
    certName = (empCert?.hr_certificates as { name?: string } | null)?.name || certName;
    certificateFilePath = empCert?.certificate_file_url || null;
  }

  const notifyInput = {
    assignmentId: assignment.id,
    businessId: assignment.business_id,
    businessName,
    employeeName,
    certName,
    premiumName: assignment.premium_name,
    certificateFilePath,
  };

  const now = new Date().toISOString();
  const mode = assignment.approval_escalation_mode || "chain";
  const chainStep = assignment.approval_chain_step ?? 0;

  if (mode === "all_managers") {
    return { assignment_id: assignment.id, skipped: "already_all_managers" };
  }

  const chain = await getManagerChain(admin, assignment.user_id);
  const nextStep = chainStep + 1;

  if (nextStep < chain.length) {
    const notified = await notifyManagersForAssignment(admin, {
      ...notifyInput,
      recipients: [chain[nextStep]],
      escalationNote:
        `This was escalated because no response was received within ${ESCALATION_HOURS} hours.`,
      campaignSuffix: `chain-${nextStep}`,
    });

    await admin
      .from("hrpayroll_employee_premiums")
      .update({
        approval_chain_step: nextStep,
        approval_last_notified_at: now,
      })
      .eq("id", assignment.id);

    return { assignment_id: assignment.id, escalated_to: "chain", step: nextStep, notified };
  }

  const managers = await loadBusinessManagers(admin, assignment.business_id);
  if (!managers.length) {
    return { assignment_id: assignment.id, skipped: "no_managers" };
  }

  const notified = await notifyManagersForAssignment(admin, {
    ...notifyInput,
    recipients: managers,
    escalationNote:
      `This was escalated to all managers because the approval chain did not respond within ${ESCALATION_HOURS} hours.`,
    campaignSuffix: "all-escalated",
  });

  await admin
    .from("hrpayroll_employee_premiums")
    .update({
      approval_escalation_mode: "all_managers",
      approval_last_notified_at: now,
    })
    .eq("id", assignment.id);

  return { assignment_id: assignment.id, escalated_to: "all_managers", notified };
}
