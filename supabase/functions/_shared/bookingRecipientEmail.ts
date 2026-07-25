import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export type BookingEmailContact = {
  customer_email?: string | null;
  customer_id?: string | null;
  secondary_customer_email?: string | null;
};

export type BookingMailRecipients = {
  to: string;
  cc?: string;
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeBookingEmail(value: unknown): string | null {
  const email = String(value || "").trim().toLowerCase();
  if (!email || !EMAIL_PATTERN.test(email)) return null;
  return email;
}

export async function resolveBookingPrimaryRecipientEmail(
  supabase: SupabaseClient,
  booking: BookingEmailContact,
  businessId: string,
): Promise<string | null> {
  let recipientEmail: string | null = normalizeBookingEmail(booking.customer_email);
  if (!recipientEmail && booking.customer_id) {
    const { data: loyalty } = await supabase
      .from("pos_loyalty_accounts")
      .select("customer_email")
      .eq("id", booking.customer_id)
      .eq("business_id", businessId)
      .maybeSingle();
    recipientEmail = normalizeBookingEmail(loyalty?.customer_email);
  }
  return recipientEmail;
}

export async function resolveBookingMailRecipients(
  supabase: SupabaseClient,
  booking: BookingEmailContact,
  businessId: string,
): Promise<BookingMailRecipients | null> {
  const primary = await resolveBookingPrimaryRecipientEmail(supabase, booking, businessId);
  const secondary = normalizeBookingEmail(booking.secondary_customer_email);

  if (!primary && !secondary) return null;
  if (!primary && secondary) return { to: secondary };
  if (primary && secondary && secondary === primary) return { to: primary };
  if (primary && secondary) return { to: primary, cc: secondary };
  return { to: primary! };
}

export function withBookingMailRecipients<T extends Record<string, unknown>>(
  payload: T,
  recipients: BookingMailRecipients,
): T & { to: string; cc?: string } {
  return recipients.cc
    ? { ...payload, to: recipients.to, cc: recipients.cc }
    : { ...payload, to: recipients.to };
}
