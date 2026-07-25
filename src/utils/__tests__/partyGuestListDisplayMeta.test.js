import {
  buildGuestListEntryDisplayMeta,
  computeGuestListWarnings,
  computePartyGuestOverageSummary,
  DEFAULT_PARTY_GUEST_OVERAGE_FOOD,
  DEFAULT_PARTY_GUEST_OVERAGE_PAYMENT,
  DEFAULT_PARTY_GUEST_OVERAGE_SOCKS,
  resolvePartyGuestOverageFood,
  resolvePartyGuestOveragePayment,
  resolvePartyGuestOveragePricing,
  resolvePartyGuestOverageSocks,
  formatPartyGuestOverageFood,
  formatPartyGuestOverageSocks,
} from '../partyGuestList';

describe('buildGuestListEntryDisplayMeta', () => {
  const limits = {
    includedKids: 2,
    includedAdults: 1,
    kidsChairLimit: 3,
    oneAdultPerChildEnabled: false,
  };

  const overagePricing = {
    childPrice: 12.39,
    adultPrice: 4.42,
    childLabel: 'Ages 2-17',
    adultLabel: 'Additional adults',
    hasPricing: true,
  };

  it('numbers children and adults separately and highlights over-limit guests', () => {
    const entries = [
      { guest_type: 'child', first_name: 'A', last_name: 'One', is_attending: true },
      { guest_type: 'child', first_name: 'B', last_name: 'Two', is_attending: true },
      { guest_type: 'child', first_name: 'C', last_name: 'Three', is_attending: true },
      { guest_type: 'adult', first_name: 'D', last_name: 'Four', is_attending: true },
      { guest_type: 'adult', first_name: 'E', last_name: 'Five', is_attending: true },
    ];

    const meta = buildGuestListEntryDisplayMeta(entries, limits);

    expect(meta.get(0)).toEqual({ listNumber: 1, isOverLimit: false, isPackageOverLimit: false, guestType: 'child', overagePrice: null, overageLabel: null });
    expect(meta.get(2)?.isOverLimit).toBe(true);
    expect(meta.get(4)?.isOverLimit).toBe(true);
  });

  it('adds overage prices for guests beyond the package', () => {
    const entries = [
      { guest_type: 'child', first_name: 'A', last_name: 'One', is_attending: true },
      { guest_type: 'child', first_name: 'B', last_name: 'Two', is_attending: true },
      { guest_type: 'child', first_name: 'C', last_name: 'Three', is_attending: true },
      { guest_type: 'adult', first_name: 'D', last_name: 'Four', is_attending: true },
      { guest_type: 'adult', first_name: 'E', last_name: 'Five', is_attending: true },
    ];

    const meta = buildGuestListEntryDisplayMeta(entries, limits, overagePricing);
    expect(meta.get(2)?.overagePrice).toBe(12.39);
    expect(meta.get(4)?.overagePrice).toBe(4.42);

    const summary = computePartyGuestOverageSummary(entries, limits, overagePricing);
    expect(summary.total).toBe(16.81);
    expect(summary.extraChildCount).toBe(1);
    expect(summary.extraAdultCount).toBe(1);
  });

  it('resolves OTWK-style ticket names', () => {
    const pricing = resolvePartyGuestOveragePricing([
      { id: '1', name: 'Ages 2-17', price: 13.27, website_online_price: 12.39 },
      { id: '2', name: 'Additional adults', price: 5.31, website_online_price: 4.42 },
    ]);
    expect(pricing.childPrice).toBe(12.39);
    expect(pricing.adultPrice).toBe(4.42);
  });

  it('defaults extra guest responsibility to guests', () => {
    expect(resolvePartyGuestOveragePayment()).toBe(DEFAULT_PARTY_GUEST_OVERAGE_PAYMENT);
    expect(resolvePartyGuestOveragePayment(null)).toBe('guest_at_gate');
    expect(resolvePartyGuestOverageFood()).toBe(DEFAULT_PARTY_GUEST_OVERAGE_FOOD);
    expect(resolvePartyGuestOverageFood('')).toBe('guests_buy_own');
    expect(resolvePartyGuestOverageSocks()).toBe(DEFAULT_PARTY_GUEST_OVERAGE_SOCKS);
    expect(resolvePartyGuestOverageSocks('')).toBe('guests_buy_own');
    expect(resolvePartyGuestOveragePayment('host_bill')).toBe('host_bill');
    expect(resolvePartyGuestOverageFood('host_tab_food')).toBe('host_tab_food');
    expect(resolvePartyGuestOverageFood('host_tab')).toBe('host_tab_food_drinks');
    expect(resolvePartyGuestOverageSocks('host_bill')).toBe('host_bill');
  });

  it('formats selected food preference for print', () => {
    expect(formatPartyGuestOverageFood('host_tab_drinks')).toContain('drinks only');
    expect(formatPartyGuestOverageFood({
      overage_food: 'other',
      overage_food_other: 'Pizza for 4 extra kids',
    })).toBe('Other: Pizza for 4 extra kids');
    expect(formatPartyGuestOverageSocks('host_bill')).toContain('pay for socks');
  });

  it('keeps warnings in sync with highlighted rows', () => {
    const entries = [
      { guest_type: 'child', first_name: 'A', last_name: 'One', is_attending: true },
      { guest_type: 'child', first_name: 'B', last_name: 'Two', is_attending: true },
      { guest_type: 'child', first_name: 'C', last_name: 'Three', is_attending: true },
    ];

    const { warnings } = computeGuestListWarnings(entries, limits);
    const meta = buildGuestListEntryDisplayMeta(entries, limits);

    expect(warnings.length).toBeGreaterThan(0);
    expect(meta.get(2)?.isOverLimit).toBe(true);
  });
});
