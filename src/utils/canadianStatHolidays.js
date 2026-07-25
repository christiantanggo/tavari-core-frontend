/** @typedef {{ name: string, date: string }} StatHoliday */

function padDate(y, m, d) {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function easterSunday(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function nthWeekdayOfMonth(year, monthIndex, weekday, n) {
  const date = new Date(year, monthIndex, 1);
  let count = 0;
  while (date.getMonth() === monthIndex) {
    if (date.getDay() === weekday) {
      count += 1;
      if (count === n) return new Date(date);
    }
    date.setDate(date.getDate() + 1);
  }
  return null;
}

function mondayOnOrBeforeMay24(year) {
  const may24 = new Date(year, 4, 24);
  const day = may24.getDay();
  const daysFromMonday = day === 0 ? 6 : day - 1;
  may24.setDate(24 - daysFromMonday);
  return may24;
}

function firstMondayInMonth(year, monthIndex) {
  return nthWeekdayOfMonth(year, monthIndex, 1, 1);
}

/**
 * Statutory holidays for a calendar year by jurisdiction key.
 * @param {'federal'|'ontario'|'bc'|'ON'|'BC'|'AB'|string} jurisdiction
 * @param {number} year
 * @returns {StatHoliday[]}
 */
export function getCanadianStatHolidays(jurisdiction, year) {
  const key = String(jurisdiction || 'ON').toLowerCase();
  const jKey = key === 'on' ? 'ontario' : key === 'bc' ? 'bc' : key === 'ab' ? 'alberta' : key;

  const easter = easterSunday(year);
  const goodFriday = addDays(easter, -2);
  const easterMonday = addDays(easter, 1);

  const fixed = [
    { name: "New Year's Day", date: padDate(year, 1, 1) },
    { name: 'Canada Day', date: padDate(year, 7, 1) },
    { name: 'Christmas Day', date: padDate(year, 12, 25) },
    { name: 'Boxing Day', date: padDate(year, 12, 26) }
  ];

  const goodFridayHoliday = {
    name: 'Good Friday',
    date: padDate(goodFriday.getFullYear(), goodFriday.getMonth() + 1, goodFriday.getDate())
  };
  const victoriaDay = {
    name: 'Victoria Day',
    date: padDate(
      year,
      5,
      mondayOnOrBeforeMay24(year).getDate()
    )
  };
  const labourDay = {
    name: 'Labour Day',
    date: (() => {
      const d = firstMondayInMonth(year, 8);
      return padDate(d.getFullYear(), d.getMonth() + 1, d.getDate());
    })()
  };
  const thanksgiving = {
    name: 'Thanksgiving Day',
    date: (() => {
      const d = nthWeekdayOfMonth(year, 9, 1, 2);
      return padDate(d.getFullYear(), d.getMonth() + 1, d.getDate());
    })()
  };

  const federal = [
    fixed[0],
    goodFridayHoliday,
    {
      name: 'Easter Monday',
      date: padDate(easterMonday.getFullYear(), easterMonday.getMonth() + 1, easterMonday.getDate())
    },
    victoriaDay,
    fixed[1],
    labourDay,
    thanksgiving,
    { name: 'Remembrance Day', date: padDate(year, 11, 11) },
    fixed[2],
    fixed[3]
  ];

  const familyDay = {
    name: 'Family Day',
    date: (() => {
      const d = nthWeekdayOfMonth(year, 1, 1, 3);
      return padDate(d.getFullYear(), d.getMonth() + 1, d.getDate());
    })()
  };
  const civicHoliday = {
    name: 'Civic Holiday',
    date: (() => {
      const d = firstMondayInMonth(year, 7);
      return padDate(d.getFullYear(), d.getMonth() + 1, d.getDate());
    })()
  };

  const ontario = [
    fixed[0],
    familyDay,
    goodFridayHoliday,
    victoriaDay,
    fixed[1],
    civicHoliday,
    labourDay,
    thanksgiving,
    fixed[2],
    fixed[3]
  ];

  const bcDay = {
    name: 'BC Day',
    date: civicHoliday.date
  };
  const bc = [
    fixed[0],
    familyDay,
    goodFridayHoliday,
    victoriaDay,
    fixed[1],
    bcDay,
    labourDay,
    thanksgiving,
    { name: 'Remembrance Day', date: padDate(year, 11, 11) },
    fixed[2]
  ];

  if (jKey === 'federal') return federal;
  if (jKey === 'bc') return bc;
  if (jKey === 'alberta') {
    return [
      fixed[0],
      familyDay,
      goodFridayHoliday,
      victoriaDay,
      fixed[1],
      labourDay,
      thanksgiving,
      { name: 'Remembrance Day', date: padDate(year, 11, 11) },
      fixed[2]
    ];
  }
  return ontario;
}

/**
 * Holidays for a pay period window (includes adjacent years when period spans Dec/Jan).
 * Only returns holidays whose date falls within [periodStart, periodEnd] inclusive.
 * @param {object} options
 * @param {string} options.jurisdiction
 * @param {string} [options.periodStart] YYYY-MM-DD
 * @param {string} [options.periodEnd] YYYY-MM-DD
 * @returns {StatHoliday[]}
 */
export function getCanadianStatHolidaysForPeriod({ jurisdiction, periodStart, periodEnd }) {
  const start = periodStart ? new Date(`${periodStart}T12:00:00`) : new Date();
  const end = periodEnd ? new Date(`${periodEnd}T12:00:00`) : start;
  const years = new Set([start.getFullYear(), end.getFullYear()]);
  if (start.getMonth() === 11 || end.getMonth() === 0) {
    years.add(start.getFullYear() - 1);
    years.add(end.getFullYear() + 1);
  }

  const startKey = periodStart ? String(periodStart).slice(0, 10) : null;
  const endKey = periodEnd ? String(periodEnd).slice(0, 10) : null;

  const all = [];
  years.forEach((year) => {
    getCanadianStatHolidays(jurisdiction, year).forEach((h) => all.push(h));
  });

  const seen = new Set();
  return all
    .filter((h) => {
      if (seen.has(h.date)) return false;
      seen.add(h.date);
      if (startKey && h.date < startKey) return false;
      if (endKey && h.date > endKey) return false;
      return true;
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}
