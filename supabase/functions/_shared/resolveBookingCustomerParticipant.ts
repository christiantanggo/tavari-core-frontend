import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type SupabaseClient = ReturnType<typeof createClient>;

const trimText = (value: unknown) =>
  typeof value === "string" && value.trim() ? value.trim() : "";

/** Resolve booking_customer_participants.id for portal checkout rows. */
export async function resolveBookingCustomerParticipantId(
  supabase: SupabaseClient,
  businessId: string,
  customerId: string | null,
  row: Record<string, unknown>,
): Promise<string | null> {
  const explicitId = trimText(row?.participant_id);
  if (explicitId) return explicitId;
  if (!customerId) return null;

  const partyRole = trimText(row?.party_role).toLowerCase();
  if (partyRole === "host_adult") {
    const { data: ownerRow } = await supabase
      .from("booking_customer_participants")
      .select("id")
      .eq("business_id", businessId)
      .eq("customer_id", customerId)
      .eq("is_account_owner", true)
      .limit(1)
      .maybeSingle();
    if (ownerRow?.id) return ownerRow.id;
  }

  // Never fall back to the loyalty account name — that collapses every unnamed
  // seat onto the booker (same person verifying multiple tickets).
  const firstName = trimText(row?.first_name);
  const lastName = trimText(row?.last_name);
  if (!firstName && !lastName) return null;

  const { data: matches } = await supabase
    .from("booking_customer_participants")
    .select("id")
    .eq("business_id", businessId)
    .eq("customer_id", customerId)
    .ilike("first_name", firstName)
    .ilike("last_name", lastName)
    .limit(1);

  if (matches?.[0]?.id) return matches[0].id;

  const { data: created, error } = await supabase
    .from("booking_customer_participants")
    .insert({
      business_id: businessId,
      customer_id: customerId,
      first_name: firstName || "Guest",
      last_name: lastName,
      date_of_birth: trimText(row?.date_of_birth) || null,
      is_account_owner: partyRole === "host_adult",
      is_active: true,
    })
    .select("id")
    .single();

  if (error) {
    console.warn("[resolveBookingCustomerParticipant] insert failed:", error);
    return null;
  }

  return created?.id ?? null;
}
