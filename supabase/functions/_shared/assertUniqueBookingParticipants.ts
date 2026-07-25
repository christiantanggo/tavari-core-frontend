const trimText = (value: unknown) =>
  typeof value === "string" && value.trim() ? value.trim() : "";

/**
 * Hard guard: the same person cannot fill more than one attending seat.
 * Prefer stable IDs (participant_id / waiver_participant_id) over display names.
 */
export function assertUniqueBookingParticipantIdentities(
  rows: Record<string, unknown>[] = [],
): { ok: true } | { ok: false; message: string } {
  const seenParticipantIds = new Set<string>();
  const seenWaiverParticipantIds = new Set<string>();
  const seenNameKeys = new Set<string>();
  let anonymousCount = 0;

  for (const row of rows) {
    const participantId = trimText(row?.participant_id);
    const waiverParticipantId = trimText(row?.waiver_participant_id);
    const firstName = trimText(row?.first_name).toLowerCase();
    const lastName = trimText(row?.last_name).toLowerCase();
    const dobRaw = row?.date_of_birth;
    const dob =
      dobRaw != null && String(dobRaw).trim()
        ? String(dobRaw).trim().split("T")[0]
        : "";

    if (participantId) {
      if (seenParticipantIds.has(participantId)) {
        return {
          ok: false,
          message:
            "Each attending seat must be a different person. The same participant is linked more than once.",
        };
      }
      seenParticipantIds.add(participantId);
    }

    if (waiverParticipantId) {
      if (seenWaiverParticipantIds.has(waiverParticipantId)) {
        return {
          ok: false,
          message:
            "Each attending seat must be a different person. The same waiver participant is linked more than once.",
        };
      }
      seenWaiverParticipantIds.add(waiverParticipantId);
    }

    if (!participantId && !waiverParticipantId) {
      if (firstName || lastName) {
        const nameKey = `${firstName}|${lastName}|${dob}`;
        if (seenNameKeys.has(nameKey)) {
          return {
            ok: false,
            message:
              "Each attending seat must be a different person. The same name is linked more than once.",
          };
        }
        seenNameKeys.add(nameKey);
      } else {
        anonymousCount += 1;
        if (anonymousCount > 1) {
          return {
            ok: false,
            message:
              "Each attending seat must identify a person. Multiple unnamed seats cannot be verified.",
          };
        }
      }
    }
  }

  return { ok: true };
}
