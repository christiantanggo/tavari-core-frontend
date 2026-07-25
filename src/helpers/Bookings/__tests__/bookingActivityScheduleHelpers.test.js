import {
  dedupeSchedulesByStartTime,
  isIndividualDatesSchedule,
  listIndividualScheduleDateKeys,
  pickSchedulesForActivityOnDate,
  countBookingsPerSlotTime,
} from '../bookingActivityScheduleHelpers';

describe('bookingActivityScheduleHelpers portal slots', () => {
  const schedules = [
    {
      id: 'row-a',
      day_of_week: 6,
      start_time: '10:00 AM',
      spaces: 1,
      resource_assignments: { cat1: 'resource-a' },
    },
    {
      id: 'row-b',
      day_of_week: 6,
      start_time: '10:00 AM',
      spaces: 1,
      resource_assignments: { cat2: 'resource-b' },
    },
    {
      id: 'row-c',
      day_of_week: 6,
      start_time: '11:00 AM',
      spaces: 2,
      resource_assignments: { cat1: 'resource-c' },
    },
  ];

  it('dedupes same start time into one customer-facing slot with merged resources', () => {
    const deduped = dedupeSchedulesByStartTime(schedules);
    expect(deduped).toHaveLength(2);
    expect(deduped[0].start_time).toBe('10:00 AM');
    expect(deduped[0].resource_assignments).toEqual({
      cat1: 'resource-a',
      cat2: ['resource-b'],
    });
  });

  it('returns one slot per start time for a date', () => {
    const saturday = new Date('2026-05-23T12:00:00');
    const raw = pickSchedulesForActivityOnDate(schedules, saturday, 'America/Toronto');
    const deduped = dedupeSchedulesByStartTime(raw);
    expect(deduped).toHaveLength(2);
    expect(deduped.map((slot) => slot.start_time)).toEqual(['10:00 AM', '11:00 AM']);
  });
});

describe('individual dates schedule helpers', () => {
  const individual = [
    {
      id: 'd1',
      day_of_week: 1,
      start_time: '08:30',
      start_date: '2026-10-26',
      end_date: '2026-10-26',
      spaces: 20,
    },
    {
      id: 'd2',
      day_of_week: 5,
      start_time: '08:30',
      start_date: '2027-01-15',
      end_date: '2027-01-15',
      spaces: 20,
    },
    {
      id: 'd3',
      day_of_week: 1,
      start_time: '08:30',
      start_date: '2026-09-01',
      end_date: '2026-09-01',
      spaces: 20,
    },
  ];

  const weekly = [
    {
      id: 'w1',
      day_of_week: 6,
      start_time: '10:00',
      start_date: null,
      end_date: null,
      spaces: 1,
    },
  ];

  it('detects individual date schedules vs weekly', () => {
    expect(isIndividualDatesSchedule(individual)).toBe(true);
    expect(isIndividualDatesSchedule(weekly)).toBe(false);
    expect(isIndividualDatesSchedule([])).toBe(false);
  });

  it('lists future individual dates sorted without month walking', () => {
    expect(
      listIndividualScheduleDateKeys(individual, { todayStr: '2026-10-01' }),
    ).toEqual(['2026-10-26', '2027-01-15']);
  });

  it('respects max-advance and closed-day filters', () => {
    expect(
      listIndividualScheduleDateKeys(individual, {
        todayStr: '2026-10-01',
        latestAllowedDateStr: '2026-12-31',
      }),
    ).toEqual(['2026-10-26']);

    expect(
      listIndividualScheduleDateKeys(individual, {
        todayStr: '2026-10-01',
        isDateClosed: (key) => key === '2026-10-26',
      }),
    ).toEqual(['2027-01-15']);
  });
});

describe('countBookingsPerSlotTime participant capacity', () => {
  const minorParticipant = (id) => ({
    id,
    waiver_participants: { participant_type: 'minor' },
  });

  const adultParticipant = (id) => ({
    id,
    party_role: 'host_adult',
    waiver_participants: { participant_type: 'adult' },
  });

  it('counts booking rows for party activities', () => {
    const counts = countBookingsPerSlotTime([
      { id: 'a', booking_time: '08:30:00', status: 'confirmed', booking_participants: [minorParticipant('p1'), minorParticipant('p2')] },
    ], { countByParticipants: false });
    expect(counts['08:30']).toBe(1);
  });

  it('counts every attendee for drop-in activities', () => {
    const counts = countBookingsPerSlotTime([
      {
        id: 'a',
        booking_time: '10:00:00',
        status: 'confirmed',
        booking_participants: [minorParticipant('p1'), adultParticipant('adult')],
      },
    ], { typeKey: 'drop_in_play', countByParticipants: true });
    expect(counts['10:00']).toBe(2);
  });

  it('counts campers only for day camp activities', () => {
    const counts = countBookingsPerSlotTime([
      {
        id: 'a',
        booking_time: '08:30:00',
        status: 'confirmed',
        booking_participants: [minorParticipant('p1'), minorParticipant('p2'), adultParticipant('adult')],
      },
      {
        id: 'b',
        booking_time: '08:30:00',
        status: 'confirmed',
        booking_participants: [minorParticipant('p3')],
      },
    ], { countByParticipants: true, typeKey: 'day_camp' });
    expect(counts['08:30']).toBe(3);
  });

  it('excludes multi-day parents and uses parent participants on day rows', () => {
    const parent = {
      id: 'parent-1',
      booking_time: '08:30:00',
      status: 'confirmed',
      multi_day_role: 'parent',
      booking_participants: [minorParticipant('p1'), minorParticipant('p2')],
    };
    const day = {
      id: 'day-1',
      booking_time: '08:30:00',
      status: 'confirmed',
      multi_day_role: 'day',
      parent_booking_id: 'parent-1',
      booking_participants: [],
    };
    const parentBookingsById = new Map([[parent.id, parent]]);
    const counts = countBookingsPerSlotTime([parent, day], {
      countByParticipants: true,
      typeKey: 'day_camp',
      parentBookingsById,
    });
    expect(counts['08:30']).toBe(2);
  });
});
