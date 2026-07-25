/** Built-in schedule that drives idle/attract content on all waiver kiosks for a business. */

export const WAIVER_KIOSK_SCHEDULE_TYPE = 'waiver_kiosk';
export const WAIVER_KIOSK_SCHEDULE_NAME = 'Waiver Kiosks';

export function isWaiverKioskSchedule(schedule) {
  return schedule?.schedule_type === WAIVER_KIOSK_SCHEDULE_TYPE;
}
