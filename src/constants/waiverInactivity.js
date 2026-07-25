// Waiver timeout behavior:
// - 20 seconds of idle time on each screen
// - then show a warning modal for 10 seconds
// - if not extended, return to the beginning
export const WAIVER_IDLE_TIMEOUT_SECONDS = 20;
export const WAIVER_TIMEOUT_WARNING_SECONDS = 10;
export const WAIVER_SCREEN_TIMEOUT_SECONDS =
  WAIVER_IDLE_TIMEOUT_SECONDS + WAIVER_TIMEOUT_WARNING_SECONDS;

// Keep legacy names for existing step imports.
export const WAIVER_PRE_OTP_TIMEOUT_SECONDS = WAIVER_SCREEN_TIMEOUT_SECONDS;
export const WAIVER_POST_OTP_TIMEOUT_SECONDS = WAIVER_SCREEN_TIMEOUT_SECONDS;
