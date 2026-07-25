import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolvePublicSiteUrl } from "./invoicePublicSiteUrl.ts";

type SupabaseClient = ReturnType<typeof createClient>;

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export async function getOrCreateBookingSelfServiceToken(
  supabase: SupabaseClient,
  bookingId: string,
  businessId: string,
) {
  const nowIso = new Date().toISOString();

  const { data: existing, error: existingError } = await supabase
    .from("booking_self_service_tokens")
    .select("token")
    .eq("booking_id", bookingId)
    .eq("business_id", businessId)
    .is("revoked_at", null)
    .gt("expires_at", nowIso)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existingError) {
    throw existingError;
  }

  if (existing?.token) {
    return existing.token;
  }

  const token = `${crypto.randomUUID().replaceAll("-", "")}${crypto.randomUUID().replaceAll("-", "")}`;
  const expiresAt = new Date(Date.now() + THIRTY_DAYS_MS).toISOString();

  const { error: insertError } = await supabase.from("booking_self_service_tokens").insert({
    token,
    booking_id: bookingId,
    business_id: businessId,
    expires_at: expiresAt,
  });

  if (insertError) {
    throw insertError;
  }

  return token;
}

export async function resolveBookingSelfServiceToken(
  supabase: SupabaseClient,
  token: string,
) {
  const nowIso = new Date().toISOString();
  const { data, error } = await supabase
    .from("booking_self_service_tokens")
    .select("token, booking_id, business_id, expires_at, revoked_at")
    .eq("token", token)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!data || data.revoked_at || data.expires_at <= nowIso) {
    return null;
  }

  await supabase
    .from("booking_self_service_tokens")
    .update({ last_used_at: nowIso })
    .eq("token", token);

  return data;
}

export function buildBookingManageUrl(businessId: string, token: string) {
  const baseUrl = resolvePublicSiteUrl(
    Deno.env.get("PUBLIC_SITE_URL") || Deno.env.get("VITE_PUBLIC_SITE_URL") || Deno.env.get("VITE_APP_URL"),
  );
  return `${baseUrl}/customer-portal/${businessId}/portal/manage-booking/${encodeURIComponent(token)}`;
}
