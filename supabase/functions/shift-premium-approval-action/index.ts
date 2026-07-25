import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  buildReminderActionPageHtml,
  type ReminderActionPageVariant,
} from "../_shared/reminderActionPage.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

const htmlHeaders = { ...corsHeaders, "Content-Type": "text/html; charset=utf-8" };

type ActionPageResult = {
  ok: boolean;
  title: string;
  message: string;
  variant?: ReminderActionPageVariant;
  detail?: string;
};

function resultPage(result: ActionPageResult) {
  const html = buildReminderActionPageHtml({
    title: result.title,
    message: result.message,
    variant: result.variant ?? (result.ok ? "success" : "error"),
    detail: result.detail,
    reminderTitle: result.detail ? undefined : undefined,
  }).replace(/Tavari Reminder/g, "Tavari HR");
  return new Response(html, {
    status: result.ok ? 200 : 400,
    headers: htmlHeaders,
  });
}

async function applyAction(
  admin: ReturnType<typeof createClient>,
  input: { token: string; action: string },
): Promise<ActionPageResult> {
  const { data: tokenRow, error } = await admin
    .from("shift_premium_approval_action_tokens")
    .select("*")
    .eq("token", input.token)
    .maybeSingle();

  if (error || !tokenRow) {
    return {
      ok: false,
      variant: "error",
      title: "Invalid link",
      message: "This approval link is not valid or has expired.",
    };
  }

  if (tokenRow.used_at) {
    return {
      ok: true,
      variant: "warning",
      title: "Already processed",
      message: "This shift premium request was already handled. Thank you.",
    };
  }

  if (new Date(tokenRow.expires_at as string).getTime() < Date.now()) {
    return {
      ok: false,
      variant: "error",
      title: "Link expired",
      message: "This approval link has expired. Please review the request in Tavari HR.",
    };
  }

  const expectedAction = tokenRow.action as string;
  if (input.action && input.action !== expectedAction) {
    return {
      ok: false,
      variant: "error",
      title: "Invalid action",
      message: "The action in this link does not match.",
    };
  }

  const assignmentId = tokenRow.premium_assignment_id as string;
  // Do not embed users(*) — multiple FKs to users make the relationship ambiguous in PostgREST.
  const { data: assignment, error: assignmentError } = await admin
    .from("hrpayroll_employee_premiums")
    .select("id, premium_name, approval_status, user_id, business_id")
    .eq("id", assignmentId)
    .maybeSingle();

  if (assignmentError || !assignment) {
    console.error("shift-premium-approval-action assignment lookup", assignmentError);
    return {
      ok: false,
      variant: "error",
      title: "Not found",
      message: "This shift premium assignment could not be found.",
    };
  }

  if (assignment.approval_status !== "pending") {
    await admin
      .from("shift_premium_approval_action_tokens")
      .update({ used_at: new Date().toISOString() })
      .eq("premium_assignment_id", assignmentId);

    return {
      ok: true,
      variant: "warning",
      title: "Already decided",
      message: `This "${assignment.premium_name}" request is already ${assignment.approval_status}.`,
    };
  }

  const { data: employee } = await admin
    .from("users")
    .select("full_name, email")
    .eq("id", assignment.user_id)
    .maybeSingle();
  const employeeLabel = employee?.full_name || employee?.email || "the employee";
  const now = new Date().toISOString();
  const managerId = tokenRow.manager_user_id as string | null;

  if (expectedAction === "approve") {
    const { error: approveError } = await admin
      .from("hrpayroll_employee_premiums")
      .update({
        approval_status: "approved",
        is_active: true,
        approved_by: managerId,
        approved_at: now,
        rejected_by: null,
        rejected_at: null,
        rejection_reason: null,
        updated_at: now,
      })
      .eq("id", assignmentId);

    if (approveError) {
      console.error("shift-premium-approval-action approve failed", approveError);
      return {
        ok: false,
        variant: "error",
        title: "Could not approve",
        message: approveError.message || "Failed to approve this shift premium.",
      };
    }

    await admin
      .from("shift_premium_approval_action_tokens")
      .update({ used_at: now })
      .eq("premium_assignment_id", assignmentId);

    return {
      ok: true,
      variant: "success",
      title: "Shift premium approved",
      message: `The "${assignment.premium_name}" premium is now active for ${employeeLabel} and will apply to payroll.`,
    };
  }

  if (expectedAction === "reject") {
    const { error: rejectError } = await admin
      .from("hrpayroll_employee_premiums")
      .update({
        approval_status: "rejected",
        is_active: false,
        rejected_by: managerId,
        rejected_at: now,
        updated_at: now,
      })
      .eq("id", assignmentId);

    if (rejectError) {
      console.error("shift-premium-approval-action reject failed", rejectError);
      return {
        ok: false,
        variant: "error",
        title: "Could not reject",
        message: rejectError.message || "Failed to reject this shift premium.",
      };
    }

    await admin
      .from("shift_premium_approval_action_tokens")
      .update({ used_at: now })
      .eq("premium_assignment_id", assignmentId);

    return {
      ok: true,
      variant: "success",
      title: "Shift premium rejected",
      message: `The "${assignment.premium_name}" premium was not activated for ${employeeLabel}.`,
    };
  }

  return {
    ok: false,
    variant: "error",
    title: "Unknown action",
    message: "This link could not be processed.",
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "GET") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  }

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const url = new URL(req.url);
    const token = (url.searchParams.get("token") || "").trim();
    const action = (url.searchParams.get("action") || "").trim();

    if (!token) {
      return resultPage({
        ok: false,
        title: "Missing link",
        message: "This approval link is invalid.",
        variant: "error",
      });
    }

    const result = await applyAction(admin, { token, action });
    return resultPage(result);
  } catch (err) {
    console.error("shift-premium-approval-action", err);
    return resultPage({
      ok: false,
      title: "Error",
      message: err instanceof Error ? err.message : "Unexpected error",
      variant: "error",
    });
  }
});
