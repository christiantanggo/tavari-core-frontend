import {
  buildPartyParticipantRowsForCheckout,
  PARTY_ROLES,
  resolvePartyCheckoutParticipantIdentity,
} from '../bookingPartySettings';

describe('resolvePartyCheckoutParticipantIdentity', () => {
  it('prefers roster account owner profile when host row lost booking_customer_participant_id', () => {
    const customerParticipants = [
      {
        id: 'waiver-alias-id',
        is_account_owner: true,
        first_name: 'Super',
        last_name: 'Mario',
        booking_customer_participant_id: null,
      },
      {
        id: 'roster-owner-id',
        is_account_owner: true,
        first_name: 'Christian',
        last_name: 'Fournier',
        booking_customer_participant_id: 'bcp-owner-1',
      },
    ];
    const host = customerParticipants[0];
    const identity = resolvePartyCheckoutParticipantIdentity(host, {
      customerParticipants,
      customerAccount: { customer_name: 'Christian Fournier' },
    });
    expect(identity.participantId).toBe('bcp-owner-1');
    expect(identity.firstName).toBe('Christian');
    expect(identity.lastName).toBe('Fournier');
  });

  it('falls back to customer account name when host names are blank', () => {
    const identity = resolvePartyCheckoutParticipantIdentity(
      { id: 'x', is_account_owner: true, first_name: '', last_name: '' },
      {
        customerParticipants: [],
        customerAccount: { customer_name: 'Christian Fournier' },
      },
    );
    expect(identity.firstName).toBe('Christian');
    expect(identity.lastName).toBe('Fournier');
  });
});

describe('buildPartyParticipantRowsForCheckout', () => {
  it('links host row to account owner booking_customer_participant_id', () => {
    const rows = buildPartyParticipantRowsForCheckout({
      customerParticipants: [
        {
          id: 'host-ui-id',
          is_account_owner: true,
          first_name: '',
          last_name: '',
          booking_customer_participant_id: null,
          waiver_id: 'waiver-1',
        },
        {
          id: 'owner-roster-id',
          is_account_owner: true,
          first_name: 'Christian',
          last_name: 'Fournier',
          booking_customer_participant_id: 'bcp-owner-1',
        },
      ],
      customerAccount: { customer_name: 'Christian Fournier' },
      hostParticipantId: 'host-ui-id',
      birthdayChildParticipantId: null,
      selectedParticipantTicketAssignments: {
        'host-ui-id': { inventory_item_id: 'inv-classic' },
      },
      inventoryItems: [{ id: 'inv-classic', name: 'Classic Birthday Party' }],
      getParticipantWaiverStatus: () => 'valid',
      getParticipantCamperRegistrationStatus: () => 'not_required',
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].party_role).toBe(PARTY_ROLES.HOST_ADULT);
    expect(rows[0].participant_id).toBe('bcp-owner-1');
    expect(rows[0].first_name).toBe('Christian');
    expect(rows[0].last_name).toBe('Fournier');
    expect(rows[0].inventory_item_id).toBe('inv-classic');
  });
});
