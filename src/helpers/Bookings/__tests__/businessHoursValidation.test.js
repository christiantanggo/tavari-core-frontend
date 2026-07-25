import { DEFAULT_OPERATING_HOURS } from '../operatingHoursTimeOptions';
import {
  filterActivitySchedulesWithinBusinessHours,
  getEffectiveBusinessHoursForDate,
  isDateClosedForBookings,
  validateBookingWithinBusinessHours,
} from '../businessHoursValidation';

describe('businessHoursValidation', () => {
  const operatingHours = DEFAULT_OPERATING_HOURS;
  const holidayHours = [
    {
      date: '2026-07-05',
      label: 'Closed Holiday',
      closed: true,
    },
    {
      date: '2026-07-06',
      label: 'Reduced Hours',
      closed: false,
      hours: { open: '11:00', close: '15:00' },
    },
  ];

  it('allows booking that fits within regular Wednesday hours', () => {
    const check = validateBookingWithinBusinessHours({
      bookingDate: '2026-05-20',
      bookingTime: '10:00 AM',
      durationMinutes: 60,
      operatingHours,
      holidayHours: [],
    });
    expect(check.ok).toBe(true);
  });

  it('allows booking starting before open when the day is not closed', () => {
    const check = validateBookingWithinBusinessHours({
      bookingDate: '2026-05-20',
      bookingTime: '8:00 AM',
      durationMinutes: 60,
      operatingHours,
      holidayHours: [],
    });
    expect(check.ok).toBe(true);
  });

  it('allows booking ending after close when the day is not closed', () => {
    const check = validateBookingWithinBusinessHours({
      bookingDate: '2026-05-20',
      bookingTime: '4:30 PM',
      durationMinutes: 60,
      operatingHours,
      holidayHours: [],
    });
    expect(check.ok).toBe(true);
  });

  it('treats all-day closed holiday as closed', () => {
    const effective = getEffectiveBusinessHoursForDate(operatingHours, holidayHours, '2026-07-05');
    expect(effective.closed).toBe(true);
    expect(isDateClosedForBookings(operatingHours, holidayHours, '2026-07-05')).toBe(true);

    const check = validateBookingWithinBusinessHours({
      bookingDate: '2026-07-05',
      bookingTime: '10:00 AM',
      durationMinutes: 60,
      operatingHours,
      holidayHours,
    });
    expect(check.ok).toBe(false);
    expect(check.requiresOverride).toBe(true);
  });

  it('uses reduced special hours metadata but still allows schedule times outside that window', () => {
    const effective = getEffectiveBusinessHoursForDate(operatingHours, holidayHours, '2026-07-06');
    expect(effective.closed).toBe(false);
    expect(effective.openMinutes).toBe(11 * 60);
    expect(effective.closeMinutes).toBe(15 * 60);

    const early = validateBookingWithinBusinessHours({
      bookingDate: '2026-07-06',
      bookingTime: '10:00 AM',
      durationMinutes: 60,
      operatingHours,
      holidayHours,
    });
    expect(early.ok).toBe(true);
  });

  it('keeps all schedules on an open day (open/close window is not a hard gate)', () => {
    const schedules = [
      { id: 'a', start_time: '8:00 AM' },
      { id: 'b', start_time: '10:00 AM' },
      { id: 'c', start_time: '4:30 PM' },
    ];
    const filtered = filterActivitySchedulesWithinBusinessHours(
      schedules,
      '2026-05-20',
      60,
      operatingHours,
      [],
    );
    expect(filtered.map((row) => row.id)).toEqual(['a', 'b', 'c']);
  });

  it('filters out all schedules on a fully closed holiday', () => {
    const schedules = [
      { id: 'a', start_time: '8:00 AM' },
      { id: 'b', start_time: '10:00 AM' },
    ];
    const filtered = filterActivitySchedulesWithinBusinessHours(
      schedules,
      '2026-07-05',
      60,
      operatingHours,
      holidayHours,
    );
    expect(filtered).toEqual([]);
  });
});
