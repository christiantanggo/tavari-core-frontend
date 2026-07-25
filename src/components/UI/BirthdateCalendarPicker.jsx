import React from 'react';
import dayjs from 'dayjs';
import BusinessCalendarPicker from './BusinessCalendarPicker';
import { birthdatePartsToIso, isoToBirthdateParts } from '../../utils/birthdatePickerHelpers';

/**
 * Birthdate picker — calendar popover with month/year navigation that stays open
 * until the user picks a day (replaces separate year/month/day dropdowns).
 */
export default function BirthdateCalendarPicker({
  value,
  onChange,
  disabled = false,
  yearRangeBack = 100,
  businessTimezone = 'America/Toronto',
  fullWidth = true,
  compact = false,
  placeholder = 'Select birthdate',
  ariaLabel = 'Birthdate',
  popoverZIndex,
}) {
  const maxDate = dayjs().format('YYYY-MM-DD');
  const minDate = dayjs().subtract(yearRangeBack, 'year').format('YYYY-MM-DD');
  const isoValue = birthdatePartsToIso(value);

  return (
    <BusinessCalendarPicker
      value={isoValue}
      onChange={(nextIso) => onChange?.(isoToBirthdateParts(nextIso))}
      businessTimezone={businessTimezone}
      disabled={disabled}
      ariaLabel={ariaLabel}
      compact={compact}
      placeholder={placeholder}
      minDate={minDate}
      maxDate={maxDate}
      showMonthYearSelects
      fullWidth={fullWidth}
      popoverZIndex={popoverZIndex}
    />
  );
}
