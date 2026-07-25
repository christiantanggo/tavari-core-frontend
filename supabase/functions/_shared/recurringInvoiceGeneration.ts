import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolvePublicSiteUrl } from "./invoicePublicSiteUrl.ts";
import {
  computeDueDate,
  nextMonthlyRunDate,
  templateHasEnded,
  type RecurringTemplateRow,
} from "./invoiceRecurringSchedule.ts";

type LineItem = {
  line_type: string;
  inventory_id: string | null;
  name: string;
  description: string | null;
  quantity: number;
  unit_price: number;
  total_price: number;
  tax_exempt: boolean;
  tax_amount: number;
  sort_order: number;
};

type RecurringTemplate = RecurringTemplateRow & {
  business_id: string;
  name: string;
  status: string;
  auto_send: boolean;
  due_days_override: number | null;
  recipient_type: string;
  loyalty_customer_id: string | null;
  recipient_name: string;
  recipient_email: string | null;
  recipient_phone: string | null;
  recipient_company: string | null;
  recipient_address: string | null;
  recipient_city: string | null;
  recipient_state: string | null;
  recipient_postal: string | null;
  display_legal_name: string | null;
  display_dba: string | null;
  display_address: string | null;
  display_city: string | null;
  display_state: string | null;
  display_postal: string | null;
  display_tax_number: string | null;
  logo_url: string | null;
  notes: string | null;
  footer_terms: string | null;
  subtotal: number;
  tax_amount: number;
  total: number;
  indian_status_gst_only: boolean;
  indian_status_certificate_number: string | null;
  created_by: string | null;
  tavari_recurring_invoice_line_items?: LineItem[];
};

async function generateInvoiceNumber(
  admin: SupabaseClient,
  businessId: string,
): Promise<string> {
  const businessShort = businessId.slice(-4).toUpperCase();
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const today = new Date();
    const dateStr = today.toISOString().slice(2, 10).replace(/-/g, "");
    const randomComponent = Math.floor(Math.random() * 1000).toString().padStart(3, "0");
    const timestamp = Date.now().toString().slice(-4);
    const invoiceNumber = `INV-${businessShort}${dateStr}${timestamp}${randomComponent}`;

    const { data: existing } = await admin
      .from("tavari_invoices")
      .select("id")
      .eq("business_id", businessId)
      .eq("invoice_number", invoiceNumber)
      .maybeSingle();

    if (!existing) return invoiceNumber;
  }
  throw new Error("Could not generate a unique invoice number");
}

async function reserveStockForLines(
  admin: SupabaseClient,
  businessId: string,
  lines: LineItem[],
) {
  for (const line of lines) {
    if (!line.inventory_id) continue;
    const qty = Number(line.quantity) || 1;

    const { data: invRow } = await admin
      .from("pos_inventory")
      .select("stock_quantity, track_stock")
      .eq("id", line.inventory_id)
      .eq("business_id", businessId)
      .maybeSingle();

    if (!invRow?.track_stock) continue;

    const currentQty = Number(invRow.stock_quantity ?? 0);
    const nextQty = Math.max(0, currentQty - qty);
    await admin
      .from("pos_inventory")
      .update({ stock_quantity: nextQty, updated_at: new Date().toISOString() })
      .eq("id", line.inventory_id)
      .eq("business_id", businessId)
      .eq("track_stock", true);
  }
}

function buildInvoiceEmailHtml(opts: {
  businessName: string;
  invoiceNumber: string;
  recipientName: string;
  total: number;
  dueDate: string;
  payUrl: string | null;
  lines: LineItem[];
  notes: string | null;
}) {
  const lineRows = opts.lines
    .map(
      (line) =>
        `<tr><td style="padding:6px 8px;border-bottom:1px solid #eee;">${line.name}</td>` +
        `<td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:center;">${line.quantity}</td>` +
        `<td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right;">$${Number(line.total_price).toFixed(2)}</td></tr>`,
    )
    .join("");

  return `
    <p>Hello${opts.recipientName ? ` ${opts.recipientName}` : ""},</p>
    <p>Your recurring invoice <strong>#${opts.invoiceNumber}</strong> from <strong>${opts.businessName}</strong> is ready.</p>
    <table style="width:100%;border-collapse:collapse;margin:16px 0;">
      <thead><tr>
        <th style="text-align:left;padding:6px 8px;border-bottom:2px solid #ddd;">Item</th>
        <th style="text-align:center;padding:6px 8px;border-bottom:2px solid #ddd;">Qty</th>
        <th style="text-align:right;padding:6px 8px;border-bottom:2px solid #ddd;">Amount</th>
      </tr></thead>
      <tbody>${lineRows}</tbody>
    </table>
    <p><strong>Total:</strong> $${opts.total.toFixed(2)}<br>
    <strong>Due date:</strong> ${opts.dueDate}</p>
    ${opts.notes ? `<p>${opts.notes}</p>` : ""}
    ${opts.payUrl ? `<p><a href="${opts.payUrl}" style="display:inline-block;padding:12px 24px;background:#008080;color:#fff;text-decoration:none;border-radius:6px;">Pay invoice</a></p>` : ""}
    <p>Thank you,<br>${opts.businessName}</p>`;
}

async function sendInvoiceNotificationEmail(
  admin: SupabaseClient,
  supabaseUrl: string,
  serviceRoleKey: string,
  opts: {
    businessId: string;
    businessName: string;
    invoiceId: string;
    invoiceNumber: string;
    recipientEmail: string;
    recipientName: string;
    total: number;
    dueDate: string;
    payUrl: string | null;
    lines: LineItem[];
    notes: string | null;
  },
) {
  const { data: mailSettings } = await admin
    .from("mail_settings")
    .select("from_email, from_name")
    .eq("business_id", opts.businessId)
    .order("updated_at", { ascending: false })
    .limit(1);

  const fromEmail = mailSettings?.[0]?.from_email?.trim() || "noreply@tavarios.ca";
  const fromName = mailSettings?.[0]?.from_name?.trim() || opts.businessName || "Tavari";

  const html = buildInvoiceEmailHtml({
    businessName: opts.businessName,
    invoiceNumber: opts.invoiceNumber,
    recipientName: opts.recipientName,
    total: opts.total,
    dueDate: opts.dueDate,
    payUrl: opts.payUrl,
    lines: opts.lines,
    notes: opts.notes,
  });

  const res = await fetch(`${supabaseUrl}/functions/v1/mail-send`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${serviceRoleKey}`,
      apikey: serviceRoleKey,
    },
    body: JSON.stringify({
      businessId: opts.businessId,
      emailType: "transactional",
      to: opts.recipientEmail,
      fromEmail,
      fromName,
      subject: `${opts.businessName} Invoice #${opts.invoiceNumber}`,
      html,
      sourceModule: "invoices",
      sourceId: opts.invoiceId,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(body || "Failed to send invoice email");
  }
}

export type GenerateResult = {
  ok: boolean;
  invoiceId?: string;
  skipped?: boolean;
  reason?: string;
  error?: string;
};

/**
 * Generate one invoice from a recurring template for the given planned date.
 * Idempotent per (template, planned_date) via tavari_recurring_invoice_runs.
 */
export async function generateRecurringInvoice(
  admin: SupabaseClient,
  template: RecurringTemplate,
  plannedDate: string,
  opts: {
    supabaseUrl: string;
    serviceRoleKey: string;
    siteUrl: string;
    forceSend?: boolean;
  },
): Promise<GenerateResult> {
  if (template.status !== "active") {
    return { ok: false, skipped: true, reason: "template_not_active" };
  }

  if (templateHasEnded(template, plannedDate)) {
    await admin
      .from("tavari_recurring_invoices")
      .update({ status: "ended", updated_at: new Date().toISOString() })
      .eq("id", template.id);
    return { ok: false, skipped: true, reason: "template_ended" };
  }

  const { data: existingRun } = await admin
    .from("tavari_recurring_invoice_runs")
    .select("id, invoice_id")
    .eq("recurring_template_id", template.id)
    .eq("planned_date", plannedDate)
    .maybeSingle();

  if (existingRun?.invoice_id) {
    return { ok: true, invoiceId: existingRun.invoice_id, skipped: true, reason: "already_generated" };
  }

  const lines = template.tavari_recurring_invoice_line_items || [];
  const balanceDue = Number(template.total) || 0;

  const { data: settings } = await admin
    .from("tavari_invoice_settings")
    .select("default_due_days")
    .eq("business_id", template.business_id)
    .maybeSingle();

  const dueDays =
    template.due_days_override != null
      ? template.due_days_override
      : Number(settings?.default_due_days) || 0;
  const dueDate = computeDueDate(plannedDate, dueDays);

  let invoiceNumber: string;
  try {
    invoiceNumber = await generateInvoiceNumber(admin, template.business_id);
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }

  const payToken = balanceDue > 0 ? crypto.randomUUID() : null;
  const emailTrackingToken = balanceDue > 0 ? crypto.randomUUID() : null;
  const shouldSend = template.auto_send || opts.forceSend;

  const { data: invoice, error: insertError } = await admin
    .from("tavari_invoices")
    .insert({
      business_id: template.business_id,
      invoice_number: invoiceNumber,
      invoice_type: "standard",
      status: shouldSend && balanceDue > 0 ? "sent" : "draft",
      recipient_type: template.recipient_type,
      loyalty_customer_id: template.loyalty_customer_id,
      recipient_name: template.recipient_name,
      recipient_email: template.recipient_email,
      recipient_phone: template.recipient_phone,
      recipient_company: template.recipient_company,
      recipient_address: template.recipient_address,
      recipient_city: template.recipient_city,
      recipient_state: template.recipient_state,
      recipient_postal: template.recipient_postal,
      display_legal_name: template.display_legal_name,
      display_dba: template.display_dba,
      display_address: template.display_address,
      display_city: template.display_city,
      display_state: template.display_state,
      display_postal: template.display_postal,
      display_tax_number: template.display_tax_number,
      logo_url: template.logo_url,
      notes: template.notes,
      footer_terms: template.footer_terms,
      due_date: dueDate,
      subtotal: template.subtotal,
      tax_amount: template.tax_amount,
      total: template.total,
      balance_due: balanceDue,
      indian_status_gst_only: template.indian_status_gst_only,
      indian_status_certificate_number: template.indian_status_certificate_number,
      recurring_template_id: template.id,
      pay_token: payToken,
      email_tracking_token: emailTrackingToken,
      first_sent_at: shouldSend && balanceDue > 0 ? new Date().toISOString() : null,
      last_sent_at: shouldSend && balanceDue > 0 ? new Date().toISOString() : null,
      stock_reserved: shouldSend && balanceDue > 0,
      created_by: template.created_by,
    })
    .select()
    .single();

  if (insertError || !invoice) {
    return { ok: false, error: insertError?.message || "Failed to create invoice" };
  }

  if (lines.length) {
    const lineRows = lines.map((line, index) => ({
      invoice_id: invoice.id,
      business_id: template.business_id,
      line_type: line.line_type || "custom",
      inventory_id: line.inventory_id,
      name: line.name,
      description: line.description,
      quantity: line.quantity,
      unit_price: line.unit_price,
      total_price: line.total_price,
      tax_exempt: line.tax_exempt,
      tax_amount: line.tax_amount,
      sort_order: line.sort_order ?? index,
    }));
    const { error: lineError } = await admin.from("tavari_invoice_line_items").insert(lineRows);
    if (lineError) {
      await admin.from("tavari_invoices").delete().eq("id", invoice.id);
      return { ok: false, error: lineError.message };
    }
  }

  let posSaleId: string | null = null;
  if (shouldSend && balanceDue > 0) {
    await reserveStockForLines(admin, template.business_id, lines);

    const { data: sale, error: saleError } = await admin
      .from("pos_sales")
      .insert({
        business_id: template.business_id,
        user_id: template.created_by,
        loyalty_customer_id: template.loyalty_customer_id,
        customer_name: template.recipient_name,
        customer_phone: template.recipient_phone,
        customer_email: template.recipient_email,
        subtotal: template.subtotal,
        tax: template.tax_amount,
        discount: 0,
        total: template.total,
        payment_status: "unpaid",
        payment_method: "invoice",
        sale_number: invoiceNumber,
        notes: `Recurring invoice ${invoiceNumber} (${template.name})`,
        item_count: lines.length,
      })
      .select()
      .single();

    if (!saleError && sale) {
      posSaleId = sale.id;
      await admin.from("tavari_invoices").update({ pos_sale_id: posSaleId }).eq("id", invoice.id);
    }

    if (template.recipient_email) {
      try {
        const { data: business } = await admin
          .from("businesses")
          .select("name")
          .eq("id", template.business_id)
          .maybeSingle();

        const payUrl = payToken ? `${opts.siteUrl}/pay/invoice/${payToken}?src=email` : null;
        await sendInvoiceNotificationEmail(admin, opts.supabaseUrl, opts.serviceRoleKey, {
          businessId: template.business_id,
          businessName: business?.name || "Tavari Business",
          invoiceId: invoice.id,
          invoiceNumber,
          recipientEmail: template.recipient_email,
          recipientName: template.recipient_name,
          total: balanceDue,
          dueDate,
          payUrl,
          lines,
          notes: template.notes,
        });
      } catch (emailErr) {
        console.warn("[recurring-invoice] email failed:", emailErr);
      }
    }
  }

  await admin.from("tavari_recurring_invoice_runs").insert({
    recurring_template_id: template.id,
    business_id: template.business_id,
    planned_date: plannedDate,
    invoice_id: invoice.id,
  });

  const newOccurrences = (template.occurrences_sent || 0) + 1;
  const nextRun = nextMonthlyRunDate(plannedDate, template.schedule_day_of_month);
  const ended =
    (template.max_occurrences != null && newOccurrences >= template.max_occurrences) ||
    (template.ends_on != null && nextRun > template.ends_on);

  await admin
    .from("tavari_recurring_invoices")
    .update({
      occurrences_sent: newOccurrences,
      next_run_date: nextRun,
      status: ended ? "ended" : template.status,
      updated_at: new Date().toISOString(),
    })
    .eq("id", template.id);

  return { ok: true, invoiceId: invoice.id };
}

export { resolvePublicSiteUrl };
