import {
  getOccupiedResourceIds,
  getResourceConflictCounts,
  parseResourceQuantity,
  areRequiredResourcesAvailableForSlot,
  resolveConcreteResourceAssignmentsForSchedule,
  filterPeerSchedulesOverlappingWindow,
  buildPeerFixedResourceDemand,
  scorePoolResourcesForAutoAssign,
} from '../bookingResourceAvailability';

const makeBooking = (id, time, resourceId, status = 'confirmed') => ({
  id,
  status,
  booking_time: time,
  duration_minutes: 60,
  extended_minutes: 0,
  booking_end_time: null,
  booking_activities: { duration_minutes: 60 },
  booking_resource_assignments: [
    { category_id: 'rooms', resource_id: resourceId },
  ],
});

describe('bookingResourceAvailability quantity', () => {
  test('parseResourceQuantity defaults blank to exclusive use', () => {
    expect(parseResourceQuantity(null, 1)).toBe(1);
    expect(parseResourceQuantity('', 1)).toBe(1);
    expect(parseResourceQuantity(3, 1)).toBe(3);
  });

  test('exclusive resource blocks a second booking at the same time', () => {
    const dayBookings = [makeBooking('b1', '10:15', 'red-room')];
    const target = makeBooking('b2', '10:15', 'red-room');

    const occupied = getOccupiedResourceIds({
      bookings: dayBookings,
      targetBooking: target,
      categoryId: 'rooms',
      resourceQuantityById: new Map([['red-room', 1]]),
    });

    expect(occupied.has('red-room')).toBe(true);
  });

  test('resource with quantity 2 allows one overlap but blocks a third', () => {
    const dayBookings = [
      makeBooking('b1', '10:15', 'field'),
      makeBooking('b2', '10:15', 'field'),
    ];
    const target = makeBooking('b3', '10:15', 'field');
    const quantityById = new Map([['field', 2]]);

    const counts = getResourceConflictCounts({
      bookings: dayBookings,
      targetBooking: target,
      categoryId: 'rooms',
    });
    expect(counts.get('field')?.count).toBe(2);

    const occupied = getOccupiedResourceIds({
      bookings: dayBookings,
      targetBooking: target,
      categoryId: 'rooms',
      resourceQuantityById: quantityById,
    });
    expect(occupied.has('field')).toBe(true);
  });

  test('editing booking excludes itself from conflict count', () => {
    const dayBookings = [makeBooking('b1', '10:15', 'red-room')];
    const target = makeBooking('b1', '10:15', 'red-room');

    const occupied = getOccupiedResourceIds({
      bookings: dayBookings,
      targetBooking: target,
      categoryId: 'rooms',
      excludeBookingId: 'b1',
      resourceQuantityById: new Map([['red-room', 1]]),
    });

    expect(occupied.has('red-room')).toBe(false);
  });

  test('pool mode requires any N free rooms and auto-prefers low-demand rooms', () => {
    const schedule = {
      resource_assignments: {
        'party-rooms': {
          mode: 'pool',
          count: 1,
          pool: ['red-room', 'yellow-room', 'teal-room'],
        },
      },
    };

    const dayBookings = [
      {
        id: 'super-red',
        status: 'pending',
        booking_time: '18:00',
        duration_minutes: 90,
        booking_resource_assignments: [
          { category_id: 'party-rooms', resource_id: 'red-room' },
        ],
      },
      {
        id: 'super-yellow',
        status: 'pending',
        booking_time: '18:00',
        duration_minutes: 90,
        booking_resource_assignments: [
          { category_id: 'party-rooms', resource_id: 'yellow-room' },
        ],
      },
    ];

    const available = areRequiredResourcesAvailableForSlot({
      schedule,
      bookingDate: '2026-07-23',
      bookingTime: '18:00',
      durationMinutes: 90,
      dayBookings,
    });
    expect(available.ok).toBe(true);

    const resolved = resolveConcreteResourceAssignmentsForSchedule({
      schedule,
      bookingDate: '2026-07-23',
      bookingTime: '18:00',
      durationMinutes: 90,
      dayBookings,
      peerSchedules: [
        {
          resource_assignments: {
            'party-rooms': ['red-room', 'yellow-room'],
          },
        },
      ],
    });
    expect(resolved.ok).toBe(true);
    expect(resolved.assignments).toEqual([
      { categoryId: 'party-rooms', resourceId: 'teal-room' },
    ]);
  });

  test('pool mode blocks when all rooms are taken', () => {
    const schedule = {
      resource_assignments: {
        'party-rooms': {
          mode: 'pool',
          count: 1,
          pool: ['red-room', 'yellow-room', 'teal-room'],
        },
      },
    };
    const dayBookings = ['red-room', 'yellow-room', 'teal-room'].map((resourceId, index) => ({
      id: `b${index}`,
      status: 'pending',
      booking_time: '18:00',
      duration_minutes: 90,
      booking_resource_assignments: [
        { category_id: 'party-rooms', resource_id: resourceId },
      ],
    }));

    expect(
      areRequiredResourcesAvailableForSlot({
        schedule,
        bookingDate: '2026-07-23',
        bookingTime: '18:00',
        durationMinutes: 90,
        dayBookings,
      }).ok,
    ).toBe(false);
  });

  test('super stays available when classic holds one room that can move to teal', () => {
    const schedule = {
      resource_assignments: {
        'party-rooms': ['red-room', 'yellow-room'],
      },
    };
    const dayBookings = [
      {
        id: 'classic',
        status: 'confirmed',
        booking_time: '16:00:00',
        duration_minutes: 90,
        booking_resource_assignments: [
          { category_id: 'party-rooms', resource_id: 'red-room' },
        ],
      },
    ];

    expect(
      areRequiredResourcesAvailableForSlot({
        schedule,
        bookingDate: '2026-07-24',
        bookingTime: '16:00',
        durationMinutes: 90,
        dayBookings,
      }).ok,
    ).toBe(true);

    expect(
      areRequiredResourcesAvailableForSlot({
        schedule,
        bookingDate: '2026-07-24',
        bookingTime: '16:30',
        durationMinutes: 90,
        dayBookings,
      }).ok,
    ).toBe(true);
  });

  test('ultimate still blocked when classic holds teal and all three are required', () => {
    const schedule = {
      resource_assignments: {
        'party-rooms': ['red-room', 'yellow-room', 'teal-room'],
      },
    };
    const dayBookings = [
      {
        id: 'classic',
        status: 'confirmed',
        booking_time: '17:00:00',
        duration_minutes: 90,
        booking_resource_assignments: [
          { category_id: 'party-rooms', resource_id: 'teal-room' },
        ],
      },
    ];

    expect(
      areRequiredResourcesAvailableForSlot({
        schedule,
        bookingDate: '2026-07-23',
        bookingTime: '17:00',
        durationMinutes: 90,
        dayBookings,
      }).ok,
    ).toBe(false);
  });

  test('overlapping peer demand prefers teal for classic pool assign', () => {
    const peers = filterPeerSchedulesOverlappingWindow({
      peerSchedules: [
        { start_time: '4:00 PM', resource_assignments: { 'party-rooms': ['red-room', 'yellow-room'] } },
        { start_time: '4:30 PM', resource_assignments: { 'party-rooms': ['red-room', 'yellow-room'] } },
        { start_time: '5:00 PM', resource_assignments: { 'party-rooms': ['red-room', 'yellow-room'] } },
      ],
      bookingTime: '16:00',
      durationMinutes: 90,
    });
    expect(peers.length).toBe(3);
    const demand = buildPeerFixedResourceDemand({ peerSchedules: peers });
    const scored = scorePoolResourcesForAutoAssign({
      pool: ['red-room', 'yellow-room', 'teal-room'],
      peerFixedDemandByResourceId: demand,
    });
    expect(scored[0].resourceId).toBe('teal-room');
  });

  test('pool allowed_combinations blocks non-adjacent red+teal', () => {
    const schedule = {
      resource_assignments: {
        'party-rooms': {
          mode: 'pool',
          count: 2,
          pool: ['red-room', 'yellow-room', 'teal-room'],
          allowed_combinations: [
            ['red-room', 'yellow-room'],
            ['yellow-room', 'teal-room'],
          ],
        },
      },
    };
    // Yellow taken → only red+teal would work mathematically, but it is not allowed
    const dayBookings = [
      {
        id: 'classic',
        status: 'confirmed',
        booking_time: '16:00',
        duration_minutes: 90,
        booking_resource_assignments: [
          { category_id: 'party-rooms', resource_id: 'yellow-room' },
        ],
      },
    ];

    expect(
      areRequiredResourcesAvailableForSlot({
        schedule,
        bookingDate: '2026-07-23',
        bookingTime: '16:00',
        durationMinutes: 90,
        dayBookings,
      }).ok,
    ).toBe(false);
  });

  test('pool allowed_combinations auto-picks an adjacent pair', () => {
    const schedule = {
      resource_assignments: {
        'party-rooms': {
          mode: 'pool',
          count: 2,
          pool: ['red-room', 'yellow-room', 'teal-room'],
          allowed_combinations: [
            ['red-room', 'yellow-room'],
            ['yellow-room', 'teal-room'],
          ],
        },
      },
    };

    const resolved = resolveConcreteResourceAssignmentsForSchedule({
      schedule,
      bookingDate: '2026-07-23',
      bookingTime: '16:00',
      durationMinutes: 90,
      dayBookings: [],
    });
    expect(resolved.ok).toBe(true);
    const ids = resolved.assignments.map((row) => row.resourceId).sort();
    expect(
      (ids[0] === 'red-room' && ids[1] === 'yellow-room') ||
        (ids[0] === 'teal-room' && ids[1] === 'yellow-room'),
    ).toBe(true);
  });
});
