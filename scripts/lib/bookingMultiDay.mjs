/**
 * Shared multi-day booking helpers for Node setup/import scripts.
 */

export function parseMultiDaySettings(ticketSettings, defaultDurationMinutes = 480) {
  const multiDay = ticketSettings?.multiDay;
  if (!multiDay?.enabled) return null;

  const daysOfWeek = Array.isArray(multiDay.daysOfWeek) && multiDay.daysOfWeek.length > 0
    ? [...new Set(multiDay.daysOfWeek.map((d) => Number(d)).filter((d) => d >= 0 && d <= 6))]
    : [1, 2, 3, 4, 5];

  return {
    enabled: true,
    dayCount: Math.max(1, Number.parseInt(multiDay.dayCount, 10) || 5),
    daysOfWeek,
    dailyDurationMinutes: Math.max(
      1,
      Number.parseInt(multiDay.dailyDurationMinutes, 10) || defaultDurationMinutes || 480,
    ),
  };
}

export function computeMultiDayDates(anchorDateIso, config = {}) {
  if (!anchorDateIso) return [];

  const dayCount = Math.max(1, config.dayCount || 5);
  const allowed = new Set(
    (config.daysOfWeek && config.daysOfWeek.length > 0)
      ? config.daysOfWeek
      : [1, 2, 3, 4, 5],
  );

  const dates = [];
  const cursor = new Date(`${anchorDateIso}T12:00:00`);
  const maxIterations = dayCount * 14;

  for (let i = 0; i < maxIterations && dates.length < dayCount; i += 1) {
    if (allowed.has(cursor.getDay())) {
      dates.push(cursor.toISOString().slice(0, 10));
    }
    cursor.setDate(cursor.getDate() + 1);
  }

  return dates;
}

const DAY_CAMP_RESOURCE_ASSIGNMENTS = {
  'party-rooms': ['red-room', 'yellow-room', 'teal-room'],
};

export async function syncDayResourceAssignments(supabase, {
  businessId,
  bookingId,
  activityId,
  bookingDate,
  bookingTime,
}) {
  const { data: schedules } = await supabase
    .from('booking_activity_schedules')
    .select('resource_assignments, start_time, start_date, end_date, day_of_week')
    .eq('business_id', businessId)
    .eq('activity_id', activityId)
    .eq('is_active', true);

  const dayOfWeek = new Date(`${bookingDate}T12:00:00`).getDay();
  const match = (schedules || []).find((row) => {
    if (row.day_of_week !== dayOfWeek) return false;
    const time = String(row.start_time || '').toUpperCase().replace(/\s+/g, ' ').trim();
    const target = String(bookingTime || '').toUpperCase().replace(/\s+/g, ' ').trim();
    if (time !== target && time.replace(/^0/, '') !== target.replace(/^0/, '')) return false;
    if (row.start_date && bookingDate < row.start_date) return false;
    if (row.end_date && bookingDate > row.end_date) return false;
    return true;
  });

  const assignments = match?.resource_assignments || DAY_CAMP_RESOURCE_ASSIGNMENTS;
  const rows = [];
  for (const [categoryId, value] of Object.entries(assignments || {})) {
    const resourceIds = Array.isArray(value) ? value : [value];
    for (const resourceId of resourceIds.filter(Boolean)) {
      rows.push({
        business_id: businessId,
        booking_id: bookingId,
        category_id: categoryId,
        resource_id: resourceId,
        source: 'schedule',
      });
    }
  }

  if (rows.length === 0) return;

  await supabase
    .from('booking_resource_assignments')
    .delete()
    .eq('booking_id', bookingId)
    .eq('business_id', businessId);

  const { error } = await supabase.from('booking_resource_assignments').insert(rows);
  if (error) throw error;
}

export async function createMultiDayBookingRows(supabase, {
  businessId,
  activityId,
  bookingTypeId,
  multiDayConfig,
  anchorDate,
  bookingTime,
  parentRecord,
  dayDefaults = {},
}) {
  const attendanceDates = computeMultiDayDates(anchorDate, multiDayConfig);
  if (attendanceDates.length === 0) {
    throw new Error(`No attendance dates for anchor ${anchorDate}`);
  }

  const { data: parent, error: parentError } = await supabase
    .from('bookings')
    .insert({
      ...parentRecord,
      business_id: businessId,
      activity_id: activityId,
      booking_type_id: bookingTypeId || null,
      booking_date: attendanceDates[0],
      booking_time: bookingTime,
      duration_minutes: multiDayConfig.dailyDurationMinutes,
      multi_day_role: 'parent',
    })
    .select('id, booking_number')
    .single();
  if (parentError) throw parentError;

  await supabase.rpc('generate_booking_qr_code', { booking_uuid: parent.id });

  for (const attendanceDate of attendanceDates) {
    const { data: dayBooking, error: dayError } = await supabase
      .from('bookings')
      .insert({
        business_id: businessId,
        activity_id: activityId,
        booking_type_id: bookingTypeId || null,
        customer_id: parentRecord.customer_id || null,
        customer_email: parentRecord.customer_email || null,
        customer_phone: parentRecord.customer_phone || null,
        booking_date: attendanceDate,
        booking_time: bookingTime,
        duration_minutes: multiDayConfig.dailyDurationMinutes,
        status: parentRecord.status || 'confirmed',
        payment_status: parentRecord.payment_status || 'unpaid',
        source: parentRecord.source || 'staff',
        requires_approval: parentRecord.requires_approval || false,
        approved_at: parentRecord.approved_at || null,
        notes: parentRecord.notes || null,
        parent_booking_id: parent.id,
        multi_day_role: 'day',
        ...dayDefaults,
      })
      .select('id')
      .single();
    if (dayError) throw dayError;

    await syncDayResourceAssignments(supabase, {
      businessId,
      bookingId: dayBooking.id,
      activityId,
      bookingDate: attendanceDate,
      bookingTime,
    });
  }

  return parent;
}
