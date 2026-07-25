import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveBookingSelfServiceToken } from "../_shared/bookingSelfService.ts";

const BUCKET = "booking-cake-receipts";
const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "application/pdf",
]);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function sanitizeFileName(name: string) {
  return String(name || "receipt")
    .replace(/[^\w.\-() ]+/g, "_")
    .slice(0, 180) || "receipt";
}

function decodeBase64File(base64: string): Uint8Array {
  const raw = base64.includes(",") ? base64.split(",").pop() || "" : base64;
  const binary = atob(raw);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function assertStaffAccess(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  businessId: string,
) {
  const { data } = await supabase
    .from("business_users")
    .select("role")
    .eq("business_id", businessId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!data) throw new Error("Forbidden");
}

async function resolveBookingContext(
  supabase: ReturnType<typeof createClient>,
  body: Record<string, unknown>,
  userId: string | null,
) {
  const token = String(body.token || body.managementToken || "").trim();
  if (token) {
    const tokenRow = await resolveBookingSelfServiceToken(supabase, token);
    if (!tokenRow) throw new Error("Booking management link is invalid or expired");
    return {
      businessId: tokenRow.business_id,
      bookingId: tokenRow.booking_id,
      uploadedSource: "customer" as const,
      uploadedBy: null,
    };
  }

  const businessId = String(body.businessId || body.business_id || "").trim();
  const bookingId = String(body.bookingId || body.booking_id || "").trim();
  if (!businessId || !bookingId || !userId) {
    throw new Error("Missing businessId, bookingId, or authentication");
  }
  await assertStaffAccess(supabase, userId, businessId);
  return {
    businessId,
    bookingId,
    uploadedSource: "staff" as const,
    uploadedBy: userId,
  };
}

async function assertBookingExists(
  supabase: ReturnType<typeof createClient>,
  businessId: string,
  bookingId: string,
) {
  const { data, error } = await supabase
    .from("bookings")
    .select("id, status")
    .eq("id", bookingId)
    .eq("business_id", businessId)
    .maybeSingle();
  if (error || !data) throw new Error("Booking not found");
  if (data.status === "cancelled") throw new Error("Cannot upload receipts for a cancelled booking");
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: { ...corsHeaders, "Content-Type": "text/plain" } });
  }
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const action = String(body.action || "list").trim();

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const authHeader = req.headers.get("Authorization") || "";
    let userId: string | null = null;
    if (authHeader.startsWith("Bearer ")) {
      const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: { user } } = await userClient.auth.getUser();
      userId = user?.id || null;
    }

    const ctx = await resolveBookingContext(supabase, body, userId);
    await assertBookingExists(supabase, ctx.businessId, ctx.bookingId);

    if (action === "list") {
      const { data, error } = await supabase
        .from("booking_cake_receipts")
        .select("*")
        .eq("business_id", ctx.businessId)
        .eq("booking_id", ctx.bookingId)
        .order("created_at", { ascending: false });
      if (error) throw error;

      const receipts = await Promise.all((data || []).map(async (row) => {
        const { data: signed } = await supabase.storage
          .from(BUCKET)
          .createSignedUrl(row.file_path, 3600);
        return { ...row, signed_url: signed?.signedUrl || null };
      }));

      return json({ ok: true, receipts });
    }

    if (action === "upload") {
      const fileName = sanitizeFileName(String(body.fileName || body.file_name || "receipt"));
      const mimeType = String(body.mimeType || body.mime_type || "").trim().toLowerCase();
      const fileBase64 = String(body.fileBase64 || body.file_base64 || "");
      const notes = String(body.notes || "").trim() || null;

      if (!fileBase64) return json({ error: "Missing file data" }, 400);
      if (!ALLOWED_MIME.has(mimeType)) {
        return json({ error: "File must be a JPG, PNG, WEBP, HEIC, or PDF" }, 400);
      }

      const bytes = decodeBase64File(fileBase64);
      if (bytes.byteLength > MAX_BYTES) {
        return json({ error: "File must be 10 MB or smaller" }, 400);
      }

      const receiptId = crypto.randomUUID();
      const filePath = `${ctx.businessId}/${ctx.bookingId}/${receiptId}-${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from(BUCKET)
        .upload(filePath, bytes, { contentType: mimeType, upsert: false });
      if (uploadError) throw uploadError;

      const { data: row, error: insertError } = await supabase
        .from("booking_cake_receipts")
        .insert({
          id: receiptId,
          business_id: ctx.businessId,
          booking_id: ctx.bookingId,
          file_path: filePath,
          file_name: fileName,
          mime_type: mimeType,
          file_size: bytes.byteLength,
          uploaded_by: ctx.uploadedBy,
          uploaded_source: ctx.uploadedSource,
          notes,
        })
        .select("*")
        .single();

      if (insertError) {
        await supabase.storage.from(BUCKET).remove([filePath]);
        throw insertError;
      }

      const { data: signed } = await supabase.storage.from(BUCKET).createSignedUrl(filePath, 3600);
      return json({ ok: true, receipt: { ...row, signed_url: signed?.signedUrl || null } });
    }

    if (action === "delete") {
      const receiptId = String(body.receiptId || body.receipt_id || "").trim();
      if (!receiptId) return json({ error: "Missing receiptId" }, 400);

      const { data: row, error: fetchError } = await supabase
        .from("booking_cake_receipts")
        .select("*")
        .eq("id", receiptId)
        .eq("business_id", ctx.businessId)
        .eq("booking_id", ctx.bookingId)
        .maybeSingle();
      if (fetchError || !row) return json({ error: "Receipt not found" }, 404);

      await supabase.storage.from(BUCKET).remove([row.file_path]);
      const { error: deleteError } = await supabase
        .from("booking_cake_receipts")
        .delete()
        .eq("id", receiptId);
      if (deleteError) throw deleteError;

      return json({ ok: true, receiptId });
    }

    if (action === "signedUrl") {
      const receiptId = String(body.receiptId || body.receipt_id || "").trim();
      if (!receiptId) return json({ error: "Missing receiptId" }, 400);

      const { data: row, error: fetchError } = await supabase
        .from("booking_cake_receipts")
        .select("file_path")
        .eq("id", receiptId)
        .eq("business_id", ctx.businessId)
        .eq("booking_id", ctx.bookingId)
        .maybeSingle();
      if (fetchError || !row) return json({ error: "Receipt not found" }, 404);

      const { data: signed, error: signError } = await supabase.storage
        .from(BUCKET)
        .createSignedUrl(row.file_path, 3600);
      if (signError) throw signError;

      return json({ ok: true, signedUrl: signed?.signedUrl || null });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (err) {
    console.error("[booking-cake-receipt]", err);
    const message = err instanceof Error ? err.message : "Server error";
    const status = message === "Forbidden" ? 403
      : message.includes("not found") || message.includes("invalid or expired") ? 404
      : 400;
    return json({ error: message }, status);
  }
});
