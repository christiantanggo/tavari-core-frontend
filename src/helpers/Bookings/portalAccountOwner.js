/**
 * Prefer the real loyalty-account person as Participant 1 / account owner.
 * Test waiver signer names (e.g. "Super Mario") must not win over booking_customer_participants
 * or a name that matches pos_loyalty_accounts.customer_name.
 */

function participantDisplayName(p) {
  return `${String(p?.first_name || '').trim()} ${String(p?.last_name || '').trim()}`
    .trim()
    .toLowerCase();
}

function accountDisplayName(customerAccount) {
  return String(customerAccount?.customer_name || '').trim().toLowerCase();
}

function normalizeDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

/**
 * Rewrite test/alias owner rows that share this account's phone/email so they
 * merge with the loyalty account person instead of showing as "Super Mario".
 */
export function reconcilePortalOwnerWithLoyaltyAccount(participants = [], customerAccount = null) {
  const list = Array.isArray(participants) ? participants.filter(Boolean) : [];
  const accountName = accountDisplayName(customerAccount);
  if (!accountName) return list;

  const accountPhone = normalizeDigits(
    customerAccount?.customer_phone || customerAccount?.phone || ''
  );
  const accountEmail = String(
    customerAccount?.customer_email || customerAccount?.email || ''
  )
    .trim()
    .toLowerCase();
  const nameParts = String(customerAccount.customer_name || '').trim().split(/\s+/);
  const firstName = nameParts[0] || '';
  const lastName = nameParts.slice(1).join(' ') || '';

  return list.map((p) => {
    const samePhone =
      accountPhone &&
      normalizeDigits(p.phone_number) &&
      (normalizeDigits(p.phone_number) === accountPhone ||
        normalizeDigits(p.phone_number).slice(-10) === accountPhone.slice(-10));
    const sameEmail =
      accountEmail && String(p.email || '').trim().toLowerCase() === accountEmail;
    const differentName = participantDisplayName(p) !== accountName;
    const looksLikeOwnerAlias =
      differentName &&
      (p.is_account_owner ||
        String(p.participant_type || '').toLowerCase() === 'primary');

    if (!(samePhone || sameEmail) || !looksLikeOwnerAlias) return p;

    return {
      ...p,
      first_name: firstName || p.first_name,
      last_name: lastName || p.last_name,
      date_of_birth: p.date_of_birth || customerAccount?.date_of_birth || null,
      email: p.email || customerAccount?.customer_email || null,
      phone_number: p.phone_number || customerAccount?.customer_phone || null,
      is_account_owner: true,
      participant_type: 'primary',
    };
  });
}

export function pickPortalAccountOwner(participants = [], customerAccount = null) {
  const list = Array.isArray(participants) ? participants.filter(Boolean) : [];
  if (list.length === 0) return null;

  const owners = list.filter((p) => p.is_account_owner);
  const accountName = accountDisplayName(customerAccount);

  const byAccountName = (pool) =>
    accountName ? pool.find((p) => participantDisplayName(p) === accountName) : null;

  return (
    owners.find((o) => o.booking_customer_participant_id) ||
    byAccountName(owners) ||
    list.find((p) => p.booking_customer_participant_id && p.is_account_owner) ||
    byAccountName(list) ||
    list.find((p) => p.booking_customer_participant_id) ||
    owners[0] ||
    list[0] ||
    null
  );
}

/** Keep exactly one account owner; demote everyone else. */
export function enforceSinglePortalAccountOwner(participants = [], customerAccount = null) {
  const reconciled = reconcilePortalOwnerWithLoyaltyAccount(participants, customerAccount);

  // After renaming aliases to the loyalty account name, collapse duplicates.
  const byIdentity = new Map();
  reconciled.forEach((p) => {
    const key = `${participantDisplayName(p)}|${String(p.date_of_birth || '').slice(0, 10)}`;
    const existing = byIdentity.get(key);
    if (!existing) {
      byIdentity.set(key, p);
      return;
    }
    const preferNew =
      (!!p.booking_customer_participant_id && !existing.booking_customer_participant_id) ||
      (!!p.waiver_id && !existing.waiver_id);
    byIdentity.set(key, preferNew
      ? {
          ...existing,
          ...p,
          booking_customer_participant_id:
            p.booking_customer_participant_id || existing.booking_customer_participant_id || null,
          waiver_id: p.waiver_id || existing.waiver_id || null,
          is_account_owner: !!(p.is_account_owner || existing.is_account_owner),
        }
      : {
          ...p,
          ...existing,
          booking_customer_participant_id:
            existing.booking_customer_participant_id || p.booking_customer_participant_id || null,
          waiver_id: existing.waiver_id || p.waiver_id || null,
          is_account_owner: !!(existing.is_account_owner || p.is_account_owner),
        });
  });

  const deduped = Array.from(byIdentity.values());
  const keep = pickPortalAccountOwner(deduped, customerAccount);
  if (!keep?.id) return deduped;

  return deduped
    .map((p) => {
      const isOwner = String(p.id) === String(keep.id);
      let participantType = p.participant_type;
      if (isOwner && (!participantType || participantType === 'additional_adult')) {
        participantType = 'primary';
      } else if (!isOwner && p.is_account_owner && participantType === 'primary') {
        participantType = 'additional_adult';
      }
      return {
        ...p,
        is_account_owner: isOwner,
        participant_type: participantType,
      };
    })
    .sort((a, b) => (b.is_account_owner ? 1 : 0) - (a.is_account_owner ? 1 : 0));
}
