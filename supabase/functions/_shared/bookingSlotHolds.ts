import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export type SlotHoldValidationInput = {
  holdToken?: string | null;
  businessId: string;
  activityId: string;
  bookingDate: string;
  bookingTime: string;
};

export async function validateBookingSlotHold(
  supabase: SupabaseClient,
  input: SlotHoldValidationInput,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const holdToken = String(input.holdToken || "").trim();
  if (!holdToken) {
    return {
      ok: false,
      message: "Your time slot reservation is missing. Please return to the calendar and choose a time again.",
    };
  }

  const { data, error } = await supabase.rpc("booking_validate_slot_hold", {
    p_hold_token: holdToken,
    p_business_id: input.businessId,
    p_activity_id: input.activityId,
    p_booking_date: input.bookingDate,
    p_booking_time: input.bookingTime,
  });

  if (error) {
    console.error("[validateBookingSlotHold]", error);
    return { ok: false, message: "Could not verify your time slot reservation." };
  }

  if (!data?.ok) {
    return {
      ok: false,
      message: String(data?.message || "Your time slot reservation expired. Please choose a time again."),
    };
  }

  return { ok: true };
}

export async function releaseBookingSlotHoldByToken(
  supabase: SupabaseClient,
  holdToken?: string | null,
): Promise<void> {
  const token = String(holdToken || "").trim();
  if (!token) return;
  await supabase.rpc("booking_release_slot_hold", { p_hold_token: token });
}
