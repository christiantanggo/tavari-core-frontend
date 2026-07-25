// Process an invoice attachment from a received email: create draft, run extraction up to 5 times.
// Retries until we get vendor/amount (got_data) or hit max attempts.
// POST body: { received_email_id, attachment_id }

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type" };

function isAuthorizedInternalCaller(req: Request): boolean {
  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length).trim() : "";
  return !!token && token === SUPABASE_SERVICE_ROLE_KEY;
}

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
}

async function runDraftExtraction(draftId: string, log: (msg: string, data?: unknown) => void): Promise<{
  extraction_ok: boolean;
  extraction_got_data: boolean;
  extraction_message: string;
}> {
  const initialDelayMs = 800;
  const retryDelayMs = 2000;
  const maxAttempts = 3;
  const extractUrl = `${SUPABASE_URL}/functions/v1/accounting-extract-draft-expense`;
  let extractStatus = 0;
  let extractBody = "";
  let gotData = false;

  log(`Waiting ${initialDelayMs}ms then extract (max ${maxAttempts} attempts)`, { draftId });
  await new Promise((r) => setTimeout(r, initialDelayMs));

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const extractRes = await fetch(extractUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
        body: JSON.stringify({ draft_id: draftId, attempt, max_attempts: maxAttempts })
      });
      extractStatus = extractRes.status;
      extractBody = await extractRes.text();
      log(`Attempt ${attempt}/${maxAttempts} extract`, { status: extractStatus, bodyPreview: extractBody?.slice(0, 200) });
      if (extractRes.ok) {
        try {
          const parsed = JSON.parse(extractBody) as { got_data?: boolean; extracted_vendor?: string; extracted_total?: number };
          gotData = parsed.got_data === true;
          log(`Attempt ${attempt} parsed`, { got_data: gotData, extracted_vendor: parsed.extracted_vendor, extracted_total: parsed.extracted_total });
          if (gotData) {
            break;
          }
        } catch (parseErr) {
          log(`Attempt ${attempt} parse error`, { err: String(parseErr) });
        }
      } else {
        log(`Attempt ${attempt} extract HTTP error`, { status: extractStatus });
      }
    } catch (e) {
      log(`Attempt ${attempt} exception`, { err: e instanceof Error ? e.message : String(e) });
      extractBody = e instanceof Error ? e.message : String(e);
    }

    if (!gotData && attempt < maxAttempts) {
      await new Promise((r) => setTimeout(r, retryDelayMs));
    }
  }

  return {
    extraction_ok: extractStatus >= 200 && extractStatus < 300,
    extraction_got_data: gotData,
    extraction_message: (extractBody || "").slice(0, 500)
  };
}

function scheduleBackgroundWork(work: Promise<unknown>, log: (msg: string, data?: unknown) => void): void {
  const runtime = (globalThis as { EdgeRuntime?: { waitUntil?: (promise: Promise<unknown>) => void } }).EdgeRuntime;
  if (runtime?.waitUntil) {
    runtime.waitUntil(work);
    return;
  }

  log("EdgeRuntime.waitUntil unavailable; background work may stop early");
  void work;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  const log = (msg: string, data?: unknown) => {
    console.log(`[process-inbound-invoice] ${msg}`, data !== undefined ? JSON.stringify(data) : "");
  };
  try {
    if (!isAuthorizedInternalCaller(req)) {
      log("ERROR: Unauthorized caller");
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    const body = await req.json().catch(() => ({}));
    const { received_email_id, attachment_id } = body as { received_email_id?: string; attachment_id?: string };
    log("ENTRY", { received_email_id, attachment_id });
    if (!received_email_id || !attachment_id) {
      log("ERROR: Missing received_email_id or attachment_id");
      return jsonResponse({ error: "received_email_id and attachment_id required" }, 400);
    }

    log("Creating supabase client");
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    log("Fetching email row");
    const { data: emailRow, error: emailErr } = await supabase
      .from("received_emails")
      .select("id, business_id")
      .eq("id", received_email_id)
      .single();
    if (emailErr || !emailRow) {
      log("ERROR: Email not found", { emailErr: String(emailErr) });
      return jsonResponse({ error: "Email not found" }, 404);
    }
    log("Email found", { business_id: emailRow.business_id });

    log("Fetching attachment row");
    const { data: attRow, error: attErr } = await supabase
      .from("received_email_attachments")
      .select("id, storage_path, filename, content_type")
      .eq("id", attachment_id)
      .eq("received_email_id", received_email_id)
      .single();
    if (attErr || !attRow) {
      log("ERROR: Attachment not found", { attErr: String(attErr) });
      return jsonResponse({ error: "Attachment not found" }, 404);
    }

    const businessId = emailRow.business_id as string;
    const storagePath = attRow.storage_path as string;
    const contentType = (attRow.content_type || "").toLowerCase();
    const isPdf = contentType === "application/pdf";
    const isImage = /^image\/(jpeg|png|webp)$/i.test(contentType);
    log("Attachment loaded", { storagePath, contentType, isPdf, isImage });
    if (!isPdf && !isImage) {
      log("ERROR: Unsupported content_type", { contentType });
      return jsonResponse({ error: "Unsupported attachment type; use PDF or image" }, 400);
    }

    const { data: existingDraft } = await supabase
      .from("accounting_draft_expenses")
      .select("id")
      .eq("business_id", businessId)
      .eq("received_email_id", received_email_id)
      .eq("attachment_id", attachment_id)
      .maybeSingle();
    if (existingDraft?.id) {
      log("Draft already exists for attachment", { draft_id: existingDraft.id });
      return jsonResponse({ success: true, draft_id: existingDraft.id, duplicate: true, extraction_scheduled: false });
    }

    log("Inserting draft");
    const nowIso = new Date().toISOString();
    const { data: draft, error: draftErr } = await supabase
      .from("accounting_draft_expenses")
      .insert({
        business_id: businessId,
        source: "email",
        received_email_id: received_email_id,
        attachment_id: attachment_id,
        vendor_id: null,
        vendor_name_display: null,
        transaction_date: null,
        invoice_date: null,
        subtotal: null,
        tax_amount: null,
        total_amount: 0,
        invoice_number: null,
        expense_category_id: null,
        gl_account_erpnext: null,
        hst_treatment: "recoverable",
        invoice_file_path: storagePath
      })
      .select("id")
      .single();

    if (draftErr && draftErr.code === "23505") {
      const { data: duplicateDraft } = await supabase
        .from("accounting_draft_expenses")
        .select("id")
        .eq("business_id", businessId)
        .eq("received_email_id", received_email_id)
        .eq("attachment_id", attachment_id)
        .maybeSingle();
      if (duplicateDraft?.id) {
        log("Draft created concurrently for attachment", { draft_id: duplicateDraft.id });
        return jsonResponse({ success: true, draft_id: duplicateDraft.id, duplicate: true, extraction_scheduled: false });
      }
    }

    if (draftErr || !draft) {
      log("ERROR: Draft insert failed", { draftErr: String(draftErr) });
      return jsonResponse({ error: "Failed to create draft expense" }, 500);
    }
    log("Draft created", { draft_id: draft.id });

    scheduleBackgroundWork(
      runDraftExtraction(draft.id, log)
        .then((result) => log("Background extraction finished", { draft_id: draft.id, ...result }))
        .catch((error) => log("Background extraction failed", { draft_id: draft.id, error: error instanceof Error ? error.message : String(error) })),
      log
    );

    log("EXIT", { draft_id: draft.id, extraction_scheduled: true });
    return jsonResponse({
      success: true,
      draft_id: draft.id,
      extraction_scheduled: true
    });
  } catch (e) {
    console.error("[process-inbound-invoice] FATAL", e);
    return jsonResponse({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
