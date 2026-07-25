// Regenerate the email-body PDF from stored received_emails body_html/body_text and overwrite the file at storage_path.
// Called from the Queue when user clicks "Re-extract from email body" so the viewed PDF matches the extracted fields.
// POST body: { received_email_id, storage_path }
// Requires Authorization (user JWT). Uses service role only for storage upload.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { emailBodyToPdf } from "../_shared/emailBodyToPdf.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, x-client-info, apikey",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { received_email_id, storage_path } = (await req.json().catch(() => ({}))) as { received_email_id?: string; storage_path?: string };
    if (!received_email_id || !storage_path || typeof storage_path !== "string") {
      return new Response(JSON.stringify({ error: "received_email_id and storage_path required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const supabaseUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: emailRow, error: emailErr } = await supabaseUser
      .from("received_emails")
      .select("body_html, body_text, business_id")
      .eq("id", received_email_id)
      .single();
    if (emailErr || !emailRow) {
      return new Response(JSON.stringify({ error: "Email not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const businessId = emailRow.business_id as string;
    if (!businessId || !storage_path.startsWith(businessId + "/")) {
      return new Response(JSON.stringify({ error: "Invalid storage path" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const pdfBytes = await emailBodyToPdf(emailRow.body_text as string | null, emailRow.body_html as string | null);
    if (!pdfBytes) {
      return new Response(JSON.stringify({ error: "Could not build PDF from email body" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { error: upErr } = await supabase.storage.from("expense-invoices").upload(storage_path, pdfBytes, { contentType: "application/pdf", upsert: true });
    if (upErr) {
      console.error("Storage upload error:", upErr);
      return new Response(JSON.stringify({ error: "Failed to upload PDF" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ success: true }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
