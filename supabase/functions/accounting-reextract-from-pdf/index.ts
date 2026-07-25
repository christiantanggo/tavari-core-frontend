// Re-extract invoice data from a stored PDF (e.g. for drafts that were created before extraction improved).
// POST body: { business_id, invoice_file_path }

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { extractTextFromPdfBytes, getFirstImageFromPdfBytes } from "../_shared/pdfTextExtract.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, x-client-info, apikey",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

function getBearerToken(req: Request): string {
  const authHeader = req.headers.get("Authorization") || "";
  return authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length).trim() : "";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const body = (await req.json().catch(() => ({}))) as { business_id?: string; invoice_file_path?: string };
    const businessId = typeof body?.business_id === "string" ? body.business_id.trim() : "";
    const storagePath = typeof body?.invoice_file_path === "string" ? body.invoice_file_path.trim() : "";
    if (!businessId || !storagePath) {
      return new Response(
        JSON.stringify({ success: false, error: "Missing business_id or invoice_file_path. Please save the draft and try again." }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const isServiceRole = getBearerToken(req) === SUPABASE_SERVICE_ROLE_KEY;
    if (!isServiceRole) {
      const supabaseUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        global: { headers: { Authorization: authHeader } }
      });
      const { data: { user } } = await supabaseUser.auth.getUser();
      if (!user?.id) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const { data: membership } = await supabaseUser
        .from("business_users")
        .select("role")
        .eq("business_id", businessId)
        .eq("user_id", user.id)
        .in("role", ["owner", "manager", "admin"])
        .maybeSingle();
      if (!membership) {
        return new Response(JSON.stringify({ error: "Access denied to this business" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    if (!storagePath.startsWith(`${businessId}/`)) {
      return new Response(JSON.stringify({ error: "Invalid storage path" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: fileData, error: downloadErr } = await supabase.storage.from("expense-invoices").download(storagePath.trim());
    if (downloadErr || !fileData) {
      console.error("Storage download error:", downloadErr);
      return new Response(JSON.stringify({ error: "Failed to download invoice file" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const bytes = new Uint8Array(await fileData.arrayBuffer());
    const lowerPath = storagePath.toLowerCase();
    const pathImageMime =
      lowerPath.endsWith(".png") ? "image/png"
        : (lowerPath.endsWith(".webp") ? "image/webp"
          : (/\.jpe?g$/.test(lowerPath) ? "image/jpeg"
            : (lowerPath.endsWith(".gif") ? "image/gif" : null)));
    const magicImageMime =
      (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) ? "image/jpeg"
        : ((bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) ? "image/png"
          : ((bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
            && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) ? "image/webp"
            : null));
    const directImageMime = pathImageMime || magicImageMime;

    let invoiceText = "";
    let imageBase64: string | null = null;
    let imageMime: string = "image/png";

    if (directImageMime) {
      // Uploaded receipt photo / scanned JPG — skip PDF parsing.
      let binary = "";
      const chunk = 0x8000;
      for (let offset = 0; offset < bytes.length; offset += chunk) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
      }
      imageBase64 = btoa(binary);
      imageMime = directImageMime;
    } else {
      invoiceText = await extractTextFromPdfBytes(bytes);
      if (!invoiceText.trim()) {
        const firstImage = await getFirstImageFromPdfBytes(bytes);
        if (firstImage?.base64) {
          imageBase64 = firstImage.base64;
          imageMime = firstImage.mime ?? "image/png";
        } else {
          return new Response(
            JSON.stringify({
              success: false,
              try_browser_render: true,
              error: "PDF has no extractable text. Rendering the first page as an image in your browser and extracting from that."
            }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      }
    }

    const { data: categories } = await supabase
      .from("accounting_expense_categories")
      .select("id, name")
      .eq("business_id", businessId)
      .order("sort_order")
      .order("name");
    const categoriesForApi = (categories || []).map((c: { id: string; name: string }) => ({ id: c.id, name: c.name }));

    const extractPayload: Record<string, unknown> = { business_id: businessId, categories: categoriesForApi };
    if (imageBase64) {
      extractPayload.image_base64 = imageBase64;
      extractPayload.mime_type = imageMime;
    } else {
      extractPayload.invoice_text = invoiceText;
    }

    const extractRes = await fetch(`${SUPABASE_URL}/functions/v1/accounting-extract-invoice`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
      body: JSON.stringify(extractPayload)
    });
    const extractBody = await extractRes.text();
    if (!extractRes.ok) {
      console.warn("Extract API error:", extractRes.status, extractBody?.slice(0, 200));
      return new Response(JSON.stringify({ error: "Extraction failed: " + (extractBody?.slice(0, 200) || extractRes.statusText) }), { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    let extracted: Record<string, unknown>;
    try {
      extracted = JSON.parse(extractBody) as Record<string, unknown>;
    } catch {
      return new Response(JSON.stringify({ error: "Invalid extraction response" }), { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (extracted.error) {
      return new Response(
        JSON.stringify({
          success: false,
          error: extracted.error,
          code: extracted.code ?? null,
          upstream_code: extracted.upstream_code ?? null,
          upstream_type: extracted.upstream_type ?? null,
          retry_after_seconds: extracted.retry_after_seconds ?? null,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        vendor_name: extracted.vendor_name ?? null,
        invoice_date: extracted.invoice_date ?? null,
        subtotal: extracted.subtotal ?? null,
        tax_amount: extracted.tax_amount ?? null,
        total_amount: extracted.total_amount ?? null,
        invoice_number: extracted.invoice_number ?? null,
        suggested_category_id: extracted.suggested_category_id ?? null,
        inferred_hst_rate: extracted.inferred_hst_rate ?? null,
        document_type: extracted.document_type ?? 'invoice',
        credit_memo_against: extracted.credit_memo_against ?? null,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
