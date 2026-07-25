/**
 * Single source of truth for “is this ad eligible right now?” — matches Display Ads DB fields
 * (`start_date`, `end_date`, `indefinite_dates`, `schedule_*`) so kiosk behavior matches what
 * staff configured on POS → Display ads.
 */

function padHHMM(t) {
  if (t == null || t === '') return '';
  const s = String(t).trim();
  const parts = s.split(':');
  if (parts.length >= 2) {
    return `${String(parts[0]).padStart(2, '0')}:${String(parts[1]).padStart(2, '0')}`;
  }
  return s;
}

/** Local calendar date (not UTC) for comparing to Postgres date columns. */
export function localDateYYYYMMDD(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function minutesSinceMidnight(hhmm) {
  const p = padHHMM(hhmm);
  if (!p || !p.includes(':')) return null;
  const [h, m] = p.split(':').map((x) => parseInt(x, 10));
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
}

/**
 * @param {object} ad — row from customer_display_ads (same shape as Display Ads screen)
 * @param {Date} [now]
 */
export function adPassesCustomerDisplaySchedule(ad, now = new Date()) {
  const currentDate = localDateYYYYMMDD(now);
  const currentTime = padHHMM(now.toTimeString().split(' ')[0].substring(0, 5));
  const currentDay = now.getDay();

  const indefinite = ad.indefinite_dates === true || ad.indefinite_dates === 'true';

  if (!indefinite) {
    const startD = ad.start_date != null ? String(ad.start_date).slice(0, 10) : null;
    const endD = ad.end_date != null ? String(ad.end_date).slice(0, 10) : null;
    if (startD && currentDate < startD) return false;
    if (endD && currentDate > endD) return false;
  }

  const days = ad.schedule_days;
  if (days != null && Array.isArray(days) && days.length > 0) {
    const today = Number(currentDay);
    const matchesDay = days.some((d) => Number(d) === today);
    if (!matchesDay) return false;

    if (!ad.schedule_all_day && ad.schedule_start_time && ad.schedule_end_time) {
      const curM = minutesSinceMidnight(currentTime);
      const startM = minutesSinceMidnight(ad.schedule_start_time);
      const endM = minutesSinceMidnight(ad.schedule_end_time);
      if (curM != null && startM != null && endM != null) {
        if (curM < startM || curM > endM) return false;
      }
    }
  }

  return true;
}
