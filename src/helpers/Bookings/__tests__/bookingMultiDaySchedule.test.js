import {
  buildMultiDayScheduleName,
  isMultiDayEventSchedule,
  groupMultiDaySeries,
  listMultiDaySeriesPortalEntries,
  listMultiDayAnchorPortalEntriesFromConfig,
  shouldUseMultiDayPortalListing,
  listWeekdayRunFromStart,
  listSelectedDaysInWeekOf,
  buildMultiDayTicketSettingsFromDates,
  resolveMultiDaySeriesDayCountForDate,
} from '../bookingMultiDaySchedule';

describe('bookingMultiDaySchedule', () => {
  test('listWeekdayRunFromStart returns Mon–Fri from a Monday', () => {
    expect(listWeekdayRunFromStart('2026-07-20', 5)).toEqual([
      '2026-07-20',
      '2026-07-21',
      '2026-07-22',
      '2026-07-23',
      '2026-07-24',
    ]);
  });

  test('listSelectedDaysInWeekOf skips unchecked holiday days', () => {
    expect(listSelectedDaysInWeekOf('2026-07-20', [2, 3, 4, 5])).toEqual([
      '2026-07-21',
      '2026-07-22',
      '2026-07-23',
      '2026-07-24',
    ]);
    expect(listSelectedDaysInWeekOf('2026-07-22', [1, 2, 3, 4])).toEqual([
      '2026-07-20',
      '2026-07-21',
      '2026-07-22',
      '2026-07-23',
    ]);
  });

  test('groupMultiDaySeries splits multiple weeks under one schedule name', () => {
    const name = buildMultiDayScheduleName('Summer Camp 2026');
    const week1 = ['2026-07-20', '2026-07-21', '2026-07-22', '2026-07-23', '2026-07-24'];
    const week2 = ['2026-07-27', '2026-07-28', '2026-07-29', '2026-07-30', '2026-07-31'];
    const schedules = [...week1, ...week2].map((date) => ({
      schedule_name: name,
      start_date: date,
      end_date: date,
      start_time: '8:30 AM',
      day_of_week: new Date(`${date}T12:00:00`).getDay(),
      spaces: 20,
    }));
    const series = groupMultiDaySeries(schedules);
    expect(series).toHaveLength(2);
    expect(series[0].anchorDateKey).toBe('2026-07-20');
    expect(series[1].anchorDateKey).toBe('2026-07-27');
    const portal = listMultiDaySeriesPortalEntries(schedules, { todayStr: '2026-07-01' });
    expect(portal.map((p) => p.anchorDateKey)).toEqual(['2026-07-20', '2026-07-27']);
  });

  test('groups series and exposes only anchor for portal booking', () => {
    const name = buildMultiDayScheduleName('Summer Week');
    const schedules = ['2026-07-20', '2026-07-21', '2026-07-22', '2026-07-23', '2026-07-24'].map((date, i) => ({
      schedule_name: name,
      start_date: date,
      end_date: date,
      start_time: '8:30 AM',
      day_of_week: i + 1,
      spaces: 20,
    }));
    expect(isMultiDayEventSchedule(schedules)).toBe(true);
    const series = groupMultiDaySeries(schedules);
    expect(series).toHaveLength(1);
    expect(series[0].anchorDateKey).toBe('2026-07-20');
    const portal = listMultiDaySeriesPortalEntries(schedules, { todayStr: '2026-07-01' });
    expect(portal).toHaveLength(1);
    expect(portal[0].anchorDateKey).toBe('2026-07-20');
  });

  test('config fallback only lists Monday anchors even when Tue–Fri rows exist', () => {
    const schedules = ['2026-07-20', '2026-07-21', '2026-07-22', '2026-07-23', '2026-07-24'].map((date, i) => ({
      schedule_name: 'Individual: camp',
      start_date: date,
      end_date: date,
      start_time: '8:30 AM',
      day_of_week: i + 1,
      spaces: 20,
    }));
    expect(shouldUseMultiDayPortalListing(schedules, { multiDay: { enabled: true } })).toBe(true);
    const portal = listMultiDayAnchorPortalEntriesFromConfig(
      schedules,
      { enabled: true, dayCount: 5, daysOfWeek: [1, 2, 3, 4, 5], anchorDayOfWeek: 1 },
      { todayStr: '2026-07-01' },
    );
    expect(portal).toHaveLength(1);
    expect(portal[0].anchorDateKey).toBe('2026-07-20');
  });

  test('buildMultiDayTicketSettingsFromDates sets dayCount and weekdays', () => {
    const settings = buildMultiDayTicketSettingsFromDates(
      ['2026-07-20', '2026-07-21', '2026-07-22', '2026-07-23', '2026-07-24'],
      480,
    );
    expect(settings.enabled).toBe(true);
    expect(settings.dayCount).toBe(5);
    expect(settings.daysOfWeek).toEqual([1, 2, 3, 4, 5]);
    expect(settings.dailyDurationMinutes).toBe(480);
  });

  test('resolveMultiDaySeriesDayCountForDate returns short week length', () => {
    const name = buildMultiDayScheduleName('Summer Camp 2026');
    const schedules = ['2026-07-21', '2026-07-22', '2026-07-23', '2026-07-24'].map((date) => ({
      schedule_name: name,
      start_date: date,
      end_date: date,
      start_time: '8:30 AM',
    }));
    expect(resolveMultiDaySeriesDayCountForDate(schedules, '2026-07-21')).toBe(4);
    expect(resolveMultiDaySeriesDayCountForDate(schedules, '2026-07-23')).toBe(4);
  });
});
