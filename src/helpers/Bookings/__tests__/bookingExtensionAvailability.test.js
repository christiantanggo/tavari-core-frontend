import {
  assessBookingExtensionAvailability,
  buildExtendedBookingSnapshot,
} from '../bookingExtensionAvailability';

const makeBooking = (id, time, resourceId, durationMinutes = 60, endTime = null) => ({
  id,
  status: 'confirmed',
  booking_time: time,
  duration_minutes: durationMinutes,
  extended_minutes: 0,
  booking_end_time: endTime,
  booking_activities: { duration_minutes: durationMinutes },
  booking_resource_assignments: [
    { category_id: 'rooms', resource_id: resourceId },
  ],
});

describe('bookingExtensionAvailability', () => {
  test('buildExtendedBookingSnapshot pushes end time forward', () => {
    const booking = makeBooking('b1', '14:00', 'room-a', 60);
    const extended = buildExtendedBookingSnapshot(booking, 30);
    expect(extended.extended_minutes).toBe(30);
    expect(String(extended.booking_end_time)).toContain('15:30');
  });

  test('allows extension when no other booking conflicts', () => {
    const booking = makeBooking('b1', '14:00', 'room-a', 60);
    const other = makeBooking('b2', '16:00', 'room-a', 60);

    const result = assessBookingExtensionAvailability({
      booking,
      addedMinutes: 30,
      dayBookings: [booking, other],
      resources: [{
        categoryId: 'rooms',
        name: 'Rooms',
        resources: [{ id: 'room-a', name: 'Room A' }],
      }],
      resourceQuantityById: new Map([['room-a', 1]]),
    });

    expect(result.ok).toBe(true);
    expect(result.conflicts).toHaveLength(0);
  });

  test('blocks extension when another booking occupies the extended window', () => {
    const booking = makeBooking('b1', '14:00', 'room-a', 60);
    const other = makeBooking('b2', '15:00', 'room-a', 60);

    const result = assessBookingExtensionAvailability({
      booking,
      addedMinutes: 30,
      dayBookings: [booking, other],
      resources: [{
        categoryId: 'rooms',
        name: 'Rooms',
        resources: [{ id: 'room-a', name: 'Room A' }],
      }],
      resourceQuantityById: new Map([['room-a', 1]]),
    });

    expect(result.ok).toBe(false);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0].resourceName).toBe('Room A');
  });
});
