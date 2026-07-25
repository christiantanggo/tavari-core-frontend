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

const escapeHtml = (v: unknown) =>
  String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

function amountDueForRecipient(
  expense: Record<string, unknown>,
  payerId: string,
  recipientId: string,
): number {
  const amount = Number(expense.amount) || 0;
  if (recipientId === payerId) return 0;

  const splitType = String(expense.split_type || "equal");
  if (splitType === "full") return amount;
  if (splitType === "custom") {
    const pctA = Number(expense.split_percent_a) || 50;
    const pctB = Number(expense.split_percent_b) || 50;
    // Without member order, assume recipient gets the non-payer share half
    return amount * (Math.max(pctA, pctB) === pctA ? pctA : pctB) / 100;
  }
  return amount / 2;
}

async function sendExpenseEmail(
  to: string,
  recipientName: string,
  payerName: string,
  amount: number,
  amountDue: number,
  category: string,
  description: string,
  expenseDate: string,
) {
  if (!MAIL_BUSINESS_ID || !to) return;

  const payUrl = `${APP_URL}/app/expenses?settle=1`;
  const subject = `${payerName} logged a ${category} expense — $${amount.toFixed(2)}`;
  const text = [
    `Hi ${recipientName},`,
    ``,
    `${payerName} added a shared expense in Pull Together: Co-Parent.`,
    ``,
    `Amount: $${amount.toFixed(2)}`,
    `Category: ${category}`,
    description ? `Note: ${description}` : "",
    `Date: ${expenseDate}`,
    ``,
    `Your share: $${amountDue.toFixed(2)}`,
    ``,
    `Open the app to record your payment: ${payUrl}`,
  ].filter(Boolean).join("\n");

  const html = `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;line-height:1.6;color:#1f1a17;max-width:520px">
<p>Hi ${escapeHtml(recipientName)},</p>
<p><strong>${escapeHtml(payerName)}</strong> logged a shared expense.</p>
<table style="width:100%;border-collapse:collapse;margin:16px 0">
<tr><td style="padding:8px 0;color:#6f655c">Amount</td><td style="padding:8px 0;font-weight:700">$${amount.toFixed(2)}</td></tr>
<tr><td style="padding:8px 0;color:#6f655c">Category</td><td style="padding:8px 0">${escapeHtml(category)}</td></tr>
<tr><td style="padding:8px 0;color:#6f655c">Your share</td><td style="padding:8px 0;font-weight:700;color:#c96f4a">$${amountDue.toFixed(2)}</td></tr>
</table>
${description ? `<p style="color:#6f655c">${escapeHtml(description)}</p>` : ""}
<p><a href="${escapeHtml(payUrl)}" style="display:inline-block;background:#c96f4a;color:#fff;padding:12px 20px;border-radius:999px;text-decoration:none;font-weight:600">Record payment</a></p>
<p style="font-size:12px;color:#999">Pull Together: Co-Parent — not legal advice.</p>
</body></html>`;

  const res = await fetch(`${SUPABASE_URL.replace(/\/$/, "")}/functions/v1/mail-send`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({
      businessId: MAIL_BUSINESS_ID,
      campaignId: `pullcoparent-expense-${Date.now()}`,
      emailType: "transactional",
      to,
      fromEmail: "noreply@tavarios.ca",
      fromName: FROM_NAME,
      subject,
      html,
      text,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    console.warn("[pullcoparent-notify-expense] mail-send failed:", err.slice(0, 400));
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) {
      return json({ error: "Unauthorized" }, 401);
    }

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: authData, error: authError } = await userClient.auth.getUser();
    if (authError || !authData.user) {
      return json({ error: "Unauthorized" }, 401);
    }
    const actorId = authData.user.id;

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const expenseId = String(body.expenseId || "").trim();
    if (!expenseId) {
      return json({ error: "expenseId is required" }, 400);
    }

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: expense, error: expenseError } = await admin
      .from("pullcoparent_expenses")
      .select("id, household_id, amount, category, description, paid_by_user_id, split_type, split_percent_a, split_percent_b, expense_date")
      .eq("id", expenseId)
      .maybeSingle();

    if (expenseError || !expense) {
      return json({ error: "Expense not found" }, 404);
    }

    const { data: actorMembership } = await admin
      .from("pullcoparent_household_members")
      .select("id")
      .eq("household_id", expense.household_id)
      .eq("user_id", actorId)
      .maybeSingle();

    if (!actorMembership) {
      return json({ error: "Not a household member" }, 403);
    }

    const { data: members } = await admin
      .from("pullcoparent_household_members")
      .select("user_id")
      .eq("household_id", expense.household_id);

    const { data: profiles } = await admin
      .from("pullcoparent_profiles")
      .select("user_id, display_name")
      .in("user_id", (members || []).map((m) => m.user_id));

    const nameByUser = Object.fromEntries(
      (profiles || []).map((p) => [p.user_id, p.display_name || "Parent"]),
    );

    const payerId = expense.paid_by_user_id as string;
    const payerName = nameByUser[payerId] || "Your co-parent";
    const amount = Number(expense.amount) || 0;
    const category = String(expense.category || "Expense");
    const description = String(expense.description || "");
    const expenseDate = String(expense.expense_date || "");

    const recipients = (members || [])
      .map((m) => m.user_id as string)
      .filter((uid) => uid !== payerId);

    let notified = 0;

    for (const recipientId of recipients) {
      const amountDue = amountDueForRecipient(expense, payerId, recipientId);
      if (amountDue <= 0) continue;

      const recipientName = nameByUser[recipientId] || "there";
      const title = `New expense: $${amount.toFixed(2)}`;
      const bodyText = `${payerName} paid for ${category}. Your share: $${amountDue.toFixed(2)}.`;
      const linkPath = `/app/expenses?settle=1&amount=${amountDue.toFixed(2)}&from=${recipientId}&to=${payerId}&expense=${expenseId}`;

      const { error: insertError } = await admin.from("pullcoparent_notifications").insert({
        household_id: expense.household_id,
        user_id: recipientId,
        type: "expense_added",
        title,
        body: bodyText,
        link_path: linkPath,
        related_expense_id: expense.id,
        metadata: {
          expense_id: expense.id,
          amount_due: amountDue,
          payer_user_id: payerId,
          from_user_id: recipientId,
          to_user_id: payerId,
        },
      });

      if (insertError) {
        console.warn("[pullcoparent-notify-expense] insert failed:", insertError.message);
        continue;
      }

      notified += 1;

      const { data: authUser } = await admin.auth.admin.getUserById(recipientId);
      const email = authUser?.user?.email;
      if (email) {
        await sendExpenseEmail(
          email,
          recipientName,
          payerName,
          amount,
          amountDue,
          category,
          description,
          expenseDate,
        );
      }
    }

    return json({ ok: true, notified });
  } catch (err) {
    console.error("[pullcoparent-notify-expense]", err);
    return json({ error: err instanceof Error ? err.message : "Internal error" }, 500);
  }
});
