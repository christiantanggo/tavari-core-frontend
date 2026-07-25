import {
  bookingMatchesScheduleSearch,
  normalizeSearchDigits,
  parseScheduleSearchDate,
} from '../bookingScheduleSearch';

describe('bookingScheduleSearch', () => {
  const booking = {
    booking_number: 'BK-000046',
    booking_date: '2026-07-17',
    customer_email: 'melmelhajime@gmail.com',
    customer_phone: '2269198494',
    customer_name: 'Yameng Holstenson',
    booking_activities: { activity_name: 'Party for Up to 12 Kids' },
    booking_participants: [
      {
        party_role: 'host_adult',
        booking_customer_participants: {
          first_name: 'Yameng',
          last_name: 'Holstenson',
        },
      },
    ],
  };

  it('normalizes phone digits', () => {
    expect(normalizeSearchDigits('(226) 919-8494')).toBe('2269198494');
  });

  it('parses common date formats', () => {
    expect(parseScheduleSearchDate('2026-07-17')).toBe('2026-07-17');
    expect(parseScheduleSearchDate('7/17/2026')).toBe('2026-07-17');
    expect(parseScheduleSearchDate('July 17, 2026')).toBe('2026-07-17');
    expect(parseScheduleSearchDate('7/17', 2026)).toBe('2026-07-17');
  });

  it('matches email, phone, name, date, booking number, and activity', () => {
    expect(bookingMatchesScheduleSearch(booking, 'melmel')).toBe(true);
    expect(bookingMatchesScheduleSearch(booking, '226-919')).toBe(true);
    expect(bookingMatchesScheduleSearch(booking, 'holstenson')).toBe(true);
    expect(bookingMatchesScheduleSearch(booking, '2026-07-17')).toBe(true);
    expect(bookingMatchesScheduleSearch(booking, '7/17')).toBe(true);
    expect(bookingMatchesScheduleSearch(booking, '000046')).toBe(true);
    expect(bookingMatchesScheduleSearch(booking, 'party for up')).toBe(true);
    expect(bookingMatchesScheduleSearch(booking, 'zzzz')).toBe(false);
  });
});
