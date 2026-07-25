/**
 * Only skip queuing when the same automation already queued/sent the same
 * `contact_id` + `delivery_key` within this many weeks (same birthday cohort).
 */
export const BIRTHDAY_AUTOMATION_SUPPRESSION_WEEKS = 5;

function addUtcWeeks(date: Date, weekDelta: number): Date {
  const out = new Date(date.getTime());
  out.setUTCDate(out.getUTCDate() + weekDelta * 7);
  return out;
}

export function birthdaySuppressionCutoffIso(now: Date): string {
  return addUtcWeeks(now, -BIRTHDAY_AUTOMATION_SUPPRESSION_WEEKS).toISOString();
}

export function normalizeNamePart(value: unknown): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function buildBirthdayDeliveryKey(input: {
  eventDate: string;
  minorDateOfBirth: string;
  minorFirstName: string;
  minorLastName: string;
}): string {
  return [
    "birthday",
    input.eventDate,
    input.minorDateOfBirth,
    normalizeNamePart(input.minorFirstName),
    normalizeNamePart(input.minorLastName),
  ].join(":");
}

/**
 * Pairs `contact_id:delivery_key` that already have a queued/retrying/sent run for this
 * automation within the suppression window. Keys must match `buildBirthdayDeliveryKey`
 * for the current send cohort.
 */
export async function loadBirthdaySuppressedContactDeliveryPairs(
  supabase: any,
  automationId: string,
  candidateContactIds: string[],
  deliveryKeys: string[],
  suppressionCutoffIso: string,
): Promise<Set<string>> {
  const suppressedPairs = new Set<string>();
  /** Keep URL / PostgREST filter size safe (many UUIDs + keys in one .in() can fail). */
  const KEY_CHUNK = 80;
  const CONTACT_CHUNK = 60;
  const uniqueKeys = [...new Set(deliveryKeys.filter(Boolean))];
  if (!automationId || candidateContactIds.length === 0 || uniqueKeys.length === 0) {
    return suppressedPairs;
  }

  for (let ki = 0; ki < uniqueKeys.length; ki += KEY_CHUNK) {
    const keyChunk = uniqueKeys.slice(ki, ki + KEY_CHUNK);
    for (let ci = 0; ci < candidateContactIds.length; ci += CONTACT_CHUNK) {
      const contactChunk = candidateContactIds.slice(ci, ci + CONTACT_CHUNK);
      const { data, error } = await supabase
        .from("mail_automation_runs")
        .select("contact_id, delivery_key")
        .eq("automation_id", automationId)
        .in("contact_id", contactChunk)
        .in("delivery_key", keyChunk)
        .in("status", ["queued", "retrying", "sent"])
        .gte("queued_at", suppressionCutoffIso);

      if (error) throw error;
      for (const row of data || []) {
        const rec = row as { contact_id?: string; delivery_key?: string };
        const cid = String(rec.contact_id || "");
        const dk = String(rec.delivery_key || "");
        if (cid && dk) suppressedPairs.add(`${cid}:${dk}`);
      }
    }
  }
  return suppressedPairs;
}

export async function filterBirthdayCandidatesForPriorSendSuppression(
  supabase: any,
  automationId: string,
  eventDate: string,
  candidates: Array<Record<string, unknown>>,
  now: Date,
): Promise<Array<Record<string, unknown>>> {
  if (candidates.length === 0) return candidates;
  const suppressionCutoffIso = birthdaySuppressionCutoffIso(now);
  const contactIds = [...new Set(candidates.map((c) => String(c.contact_id || "")).filter(Boolean))];
  const deliveryKeys = candidates.map((c) =>
    buildBirthdayDeliveryKey({
      eventDate,
      minorDateOfBirth: String(c.minor_date_of_birth || ""),
      minorFirstName: String(c.minor_first_name || ""),
      minorLastName: String(c.minor_last_name || ""),
    })
  );
  const suppressed = await loadBirthdaySuppressedContactDeliveryPairs(
    supabase,
    automationId,
    contactIds,
    deliveryKeys,
    suppressionCutoffIso,
  );
  return candidates.filter((c) => {
    const cid = String(c.contact_id || "");
    const dk = buildBirthdayDeliveryKey({
      eventDate,
      minorDateOfBirth: String(c.minor_date_of_birth || ""),
      minorFirstName: String(c.minor_first_name || ""),
      minorLastName: String(c.minor_last_name || ""),
    });
    return !suppressed.has(`${cid}:${dk}`);
  });
}
