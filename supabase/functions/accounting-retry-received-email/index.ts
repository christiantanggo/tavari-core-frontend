// One-off ops helper: backfill email-body.pdf when missing and queue draft processing.
// POST { received_email_id } — service role only.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { emailBodyToPdf } from "../_shared/emailBodyToPdf.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
};

const INVOICE_CONTENT_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length).trim() : "";
  if (!token || token !== SUPABASE_SERVICE_ROLE_KEY) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  try {
    const { received_email_id } = (await req.json().catch(() => ({}))) as { received_email_id?: string };
    if (!received_email_id) {
      return new Response(JSON.stringify({ error: "received_email_id required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: emailRow, error: emailErr } = await supabase
      .from("received_emails")
      .select("id, business_id, body_text, body_html")
      .eq("id", received_email_id)
      .single();
    if (emailErr || !emailRow) {
      return new Response(JSON.stringify({ error: "Email not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const businessId = emailRow.business_id as string;
    const { data: existingAttachments } = await supabase
      .from("received_email_attachments")
      .select("id, content_type, filename")
      .eq("received_email_id", received_email_id);

    const invoiceLike = (existingAttachments || []).filter((row) => {
      const ct = String(row.content_type || "").toLowerCase().split(";")[0].trim();
      return INVOICE_CONTENT_TYPES.includes(ct);
    });

    let createdAttachmentId: string | null = null;
    if (invoiceLike.length === 0) {
      const pdfBytes = await emailBodyToPdf(emailRow.body_text as string | null, emailRow.body_html as string | null);
      if (!pdfBytes) {
        return new Response(JSON.stringify({ error: "Could not build PDF from email body" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const pathSegment = crypto.randomUUID();
      const storagePath = `${businessId}/${pathSegment}/email-body.pdf`;
      const { error: upErr } = await supabase.storage
        .from("expense-invoices")
        .upload(storagePath, pdfBytes, { contentType: "application/pdf", upsert: false });
      if (upErr) {
        return new Response(JSON.stringify({ error: `Upload failed: ${upErr.message}` }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const { data: attRow, error: attErr } = await supabase
        .from("received_email_attachments")
        .insert({
          received_email_id,
          storage_path: storagePath,
          filename: "email-body.pdf",
          content_type: "application/pdf",
          size_bytes: pdfBytes.length,
        })
        .select("id")
        .single();
      if (attErr || !attRow) {
        return new Response(JSON.stringify({ error: "Failed to insert attachment row" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      createdAttachmentId = attRow.id;
      invoiceLike.push({ id: attRow.id, content_type: "application/pdf", filename: "email-body.pdf" });
      await supabase.from("received_emails").update({ has_attachments: true, attachment_count: 1 }).eq("id", received_email_id);
    }

    const processorUrl = `${SUPABASE_URL}/functions/v1/accounting-process-inbound-invoice`;
    const results: Array<Record<string, unknown>> = [];
    for (const att of invoiceLike) {
      const res = await fetch(processorUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
        body: JSON.stringify({ received_email_id, attachment_id: att.id }),
      });
      const body = await res.json().catch(() => ({}));
      results.push({ attachment_id: att.id, status: res.status, ...body });
    }

    return new Response(JSON.stringify({
      success: true,
      received_email_id,
      created_attachment_id: createdAttachmentId,
      results,
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
