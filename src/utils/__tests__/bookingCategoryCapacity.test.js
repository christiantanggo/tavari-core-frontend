import {
  CATEGORY_CAPACITY_MODES,
  defaultCategorySharedCapacityRules,
  mergeCategorySessionRulesWithSharedCapacity,
  parseCategorySharedCapacityRules,
  serializeCategorySharedCapacityRules,
} from '../bookingCategoryCapacity';

describe('bookingCategoryCapacity session_rules', () => {
  it('defaults to disabled shared capacity', () => {
    expect(defaultCategorySharedCapacityRules()).toEqual({
      enabled: false,
      mode: CATEGORY_CAPACITY_MODES.DAILY,
      max: null,
    });
  });

  it('parses shared capacity from session_rules', () => {
    const parsed = parseCategorySharedCapacityRules({
      shared_capacity: { enabled: true, mode: 'time_slot', max: 30 },
    });
    expect(parsed).toEqual({
      enabled: true,
      mode: CATEGORY_CAPACITY_MODES.TIME_SLOT,
      max: 30,
    });
  });

  it('merges without dropping party keys', () => {
    const merged = mergeCategorySessionRulesWithSharedCapacity(
      { party_booking: true, default_spaces_per_slot: 1 },
      { enabled: true, mode: CATEGORY_CAPACITY_MODES.DAILY, max: 20 },
    );
    expect(merged.party_booking).toBe(true);
    expect(merged.shared_capacity).toEqual(
      serializeCategorySharedCapacityRules({ enabled: true, mode: 'daily', max: 20 }),
    );
  });

  it('serializes disabled when max missing', () => {
    expect(
      serializeCategorySharedCapacityRules({ enabled: true, mode: 'daily', max: null }),
    ).toEqual({
      enabled: false,
      mode: CATEGORY_CAPACITY_MODES.DAILY,
      max: null,
    });
  });
});
