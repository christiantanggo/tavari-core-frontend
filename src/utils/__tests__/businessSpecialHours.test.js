import {
  buildSpecialHoursReminderMessage,
  formatHoursRange,
  getSpecialHoursForDate,
  isBusinessClosedOnDate,
  getClosedHolidayMessage,
} from '../businessSpecialHours';

describe('businessSpecialHours', () => {
  const holidayHours = [
    {
      id: '1',
      date: '2026-12-24',
      name: 'Christmas Eve',
      closed: false,
      hours: { open: '10:00', close: '14:00' },
    },
    {
      id: '2',
      date: '2026-12-25',
      name: 'Christmas Day',
      closed: true,
      hours: { open: '10:00', close: '14:00' },
    },
  ];

  it('returns null when date is not a special day', () => {
    expect(getSpecialHoursForDate(holidayHours, '2026-12-23')).toBeNull();
  });

  it('returns formatted hours for a special open day', () => {
    const entry = getSpecialHoursForDate(holidayHours, '2026-12-24');
    expect(entry).toMatchObject({
      date: '2026-12-24',
      label: 'Christmas Eve',
      hoursText: '10am - 2pm',
      closed: false,
      closingTimeDisplay: '2pm',
    });
  });

  it('returns closed state for a closed special day', () => {
    const entry = getSpecialHoursForDate(holidayHours, '2026-12-25');
    expect(entry?.closed).toBe(true);
    expect(entry?.hoursText).toBe('Closed');
  });

  it('builds reminder message with unlimited play note', () => {
    const entry = getSpecialHoursForDate(holidayHours, '2026-12-24');
    const message = buildSpecialHoursReminderMessage(entry);
    expect(message).toContain('Christmas Eve');
    expect(message).toContain('10am - 2pm');
    expect(message).toContain('Unlimited play');
    expect(message).toContain('2pm');
  });

  it('formats hour ranges consistently', () => {
    expect(formatHoursRange('09:00', '17:00')).toBe('9am - 5pm');
  });

  it('detects closed holiday dates', () => {
    expect(isBusinessClosedOnDate(holidayHours, '2026-12-25')).toBe(true);
    expect(isBusinessClosedOnDate(holidayHours, '2026-12-24')).toBe(false);
    expect(isBusinessClosedOnDate(holidayHours, '2026-12-23')).toBe(false);
  });

  it('builds closed-day customer message', () => {
    expect(getClosedHolidayMessage(holidayHours, '2026-12-25')).toContain('Christmas Day');
  });
});
