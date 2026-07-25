/** @param {string|null|undefined} value */
export function toDateInputValue(value) {
  if (!value) return '';
  return String(value).slice(0, 10);
}

/** @param {{ play_start_date?: string|null, play_end_date?: string|null }} content */
export function parseContentPlayDates(content) {
  return {
    playStartDate: toDateInputValue(content?.play_start_date),
    playEndDate: toDateInputValue(content?.play_end_date),
    indefinite: !content?.play_end_date
  };
}

/**
 * @param {{ playStartDate?: string, playEndDate?: string, indefinite?: boolean }} fields
 */
export function buildContentPlayDateFields({ playStartDate = '', playEndDate = '', indefinite = true }) {
  return {
    play_start_date: playStartDate?.trim() || null,
    play_end_date: indefinite ? null : playEndDate?.trim() || null
  };
}

function formatDisplay(isoDate) {
  try {
    const [y, m, d] = isoDate.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  } catch {
    return isoDate;
  }
}

/** @param {{ play_start_date?: string|null, play_end_date?: string|null }} content */
export function formatContentPlayDateLabel(content) {
  const start = toDateInputValue(content?.play_start_date) || null;
  const end = toDateInputValue(content?.play_end_date) || null;
  if (!start && !end) return 'Indefinite';
  if (start && !end) return `${formatDisplay(start)} — indefinite`;
  if (!start && end) return `Until ${formatDisplay(end)}`;
  return `${formatDisplay(start)} — ${formatDisplay(end)}`;
}

/**
 * @param {{ play_start_date?: string|null, play_end_date?: string|null }} content
 * @param {string} dateStr YYYY-MM-DD in business timezone
 */
export function isContentPlayableOnDate(content, dateStr) {
  const start = toDateInputValue(content?.play_start_date) || null;
  const end = toDateInputValue(content?.play_end_date) || null;
  if (start && dateStr < start) return false;
  if (end && dateStr > end) return false;
  return true;
}

/**
 * @param {{ play_start_date?: string|null, play_end_date?: string|null }} content
 * @param {string} dateStr YYYY-MM-DD
 */
export function getContentPlayDateStatus(content, dateStr) {
  if (isContentPlayableOnDate(content, dateStr)) return 'active';
  const start = toDateInputValue(content?.play_start_date) || null;
  if (start && dateStr < start) return 'scheduled';
  return 'expired';
}

/**
 * @param {{ playStartDate?: string, playEndDate?: string, indefinite?: boolean }} fields
 * @returns {string|null} error message
 */
export function validateContentPlayDates({ playStartDate = '', playEndDate = '', indefinite = true }) {
  if (!indefinite && !playEndDate?.trim()) {
    return 'Choose an end date or check Indefinite.';
  }
  if (playStartDate?.trim() && playEndDate?.trim() && !indefinite && playStartDate > playEndDate) {
    return 'End date must be on or after the start date.';
  }
  return null;
}
