import {
  computeMultiDayDates,
  parseMultiDaySettings,
  resolveMultiDayDetailBookingId,
  shouldHideFromScheduleSlot,
  getMultiDayPriceScale,
  buildMultiDayProratedPriceOverrides,
  mergeTicketPriceOverrides,
} from '../bookingMultiDay';

describe('bookingMultiDay', () => {
  test('parseMultiDaySettings returns null when disabled', () => {
    expect(parseMultiDaySettings({})).toBeNull();
    expect(parseMultiDaySettings({ multiDay: { enabled: false } })).toBeNull();
  });

  test('parseMultiDaySettings reads week camp config', () => {
    const config = parseMultiDaySettings({
      multiDay: {
        enabled: true,
        dayCount: 5,
        daysOfWeek: [1, 2, 3, 4, 5],
        dailyDurationMinutes: 480,
      },
    }, 60);
    expect(config.enabled).toBe(true);
    expect(config.dayCount).toBe(5);
    expect(config.dailyDurationMinutes).toBe(480);
  });

  test('computeMultiDayDates expands Mon anchor to Mon–Fri', () => {
    const dates = computeMultiDayDates('2026-07-06', {
      dayCount: 5,
      daysOfWeek: [1, 2, 3, 4, 5],
    });
    expect(dates).toEqual([
      '2026-07-06',
      '2026-07-07',
      '2026-07-08',
      '2026-07-09',
      '2026-07-10',
    ]);
  });

  test('resolveMultiDayDetailBookingId prefers parent for day rows', () => {
    expect(resolveMultiDayDetailBookingId({
      id: 'day-1',
      multi_day_role: 'day',
      parent_booking_id: 'parent-1',
    })).toBe('parent-1');
    expect(resolveMultiDayDetailBookingId({ id: 'single-1' })).toBe('single-1');
  });

  test('shouldHideFromScheduleSlot hides parent rows only', () => {
    expect(shouldHideFromScheduleSlot({ multi_day_role: 'parent' })).toBe(true);
    expect(shouldHideFromScheduleSlot({ multi_day_role: 'day' })).toBe(false);
    expect(shouldHideFromScheduleSlot({})).toBe(false);
  });

  test('getMultiDayPriceScale prorates short weeks only', () => {
    expect(getMultiDayPriceScale(5, 5)).toBe(1);
    expect(getMultiDayPriceScale(4, 5)).toBe(0.8);
    expect(getMultiDayPriceScale(3, 5)).toBe(0.6);
    expect(getMultiDayPriceScale(6, 5)).toBe(1);
  });

  test('buildMultiDayProratedPriceOverrides scales unit prices', () => {
    const overrides = buildMultiDayProratedPriceOverrides(
      [{ id: 'camp-ticket', price: 250 }],
      { weekDayCount: 4, fullWeekDayCount: 5 },
    );
    expect(overrides).toEqual({ 'camp-ticket': 200 });
    expect(buildMultiDayProratedPriceOverrides(
      [{ id: 'camp-ticket', price: 250 }],
      { weekDayCount: 5, fullWeekDayCount: 5 },
    )).toEqual({});
  });

  test('mergeTicketPriceOverrides lets later maps win', () => {
    expect(mergeTicketPriceOverrides(
      { a: 100, b: 200 },
      { b: 160 },
    )).toEqual({ a: 100, b: 160 });
  });
});
