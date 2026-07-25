import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export async function insertBookingHistory(
  supabase: SupabaseClient,
  params: {
    businessId: string;
    bookingId: string;
    actionType: string;
    summary: string;
    details?: Record<string, unknown>;
    changedBy?: string | null;
    changedIp?: string | null;
  },
): Promise<void> {
  const { businessId, bookingId, actionType, summary } = params;
  if (!businessId || !bookingId || !actionType || !summary) return;

  const { error } = await supabase.from("booking_history").insert({
    business_id: businessId,
    booking_id: bookingId,
    action_type: actionType,
    summary,
    details: params.details || {},
    changed_by: params.changedBy ?? null,
    changed_ip: params.changedIp ?? null,
  });

  if (error) {
    console.error("[insertBookingHistory]", bookingId, actionType, error.message);
  }
}
