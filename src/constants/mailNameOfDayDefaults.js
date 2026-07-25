/** Defaults aligned with `supabase/functions/mail-name-of-day/index.ts` */

export const DEFAULT_PROFILE_ID = 'default';

export const DEFAULT_NAME_OF_DAY_PROFILE_FIELDS = {
  popularity_quintile_points: [-1, 0, 0, 1, 2],
  visit_points: { visited_30d: 2, not_visited: 0 },
  same_waiver_duplicate_points: { single_minor: 0, multiple_minors_same_name: 1 },
  preschool_max_age: 5,
  preschool_points: { in_range: 1, out_of_range: 0 }
};

/** Built-in cooldown ladder (days since name last won → score points) unless a profile sets `cooldown_tiers`. */
export const DEFAULT_NAME_OF_DAY_COOLDOWN_TIERS = [
  { max_days: 10, points: -5 },
  { max_days: 20, points: -4 },
  { max_days: 30, points: -3 },
  { max_days: 40, points: -2 },
  { max_days: 50, points: -1 },
  { max_days: 60, points: 0 },
  { max_days: 70, points: 1 },
  { max_days: 80, points: 2 },
  { max_days: 90, points: 3 },
  { max_days: 100, points: 4 },
  { max_days: 999999, points: 5 }
];

export const DOW_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
