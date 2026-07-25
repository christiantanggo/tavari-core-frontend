/** Stored on waiver_participants.participant_portal_access for additional_adult rows. */
export const WAIVER_PORTAL_ACCESS = {
  CO_PRIMARY: 'co_primary',
  FULL_VIEW: 'full_view',
  SELF_ONLY: 'self_only'
};

export const DEFAULT_ADDITIONAL_ADULT_PORTAL_ACCESS = WAIVER_PORTAL_ACCESS.FULL_VIEW;

export const ADDITIONAL_ADULT_PORTAL_OPTIONS = [
  {
    value: WAIVER_PORTAL_ACCESS.CO_PRIMARY,
    title: 'Can view and manage this waiver',
    description:
      'They can view everyone on this waiver, open the full signed copy, and manage this waiver like the primary signer.'
  },
  {
    value: WAIVER_PORTAL_ACCESS.FULL_VIEW,
    title: 'Can view everyone on this waiver',
    description:
      'They can view everyone listed on this waiver and open the full signed copy, but they cannot manage it.'
  },
  {
    value: WAIVER_PORTAL_ACCESS.SELF_ONLY,
    title: 'Can only view their own waiver details',
    description:
      'They only see their own details. Other participants stay hidden for privacy.'
  }
];
