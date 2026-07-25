/**
 * Popover calendar — stays open while browsing months until the user picks a day.
 * Replaces native `<input type="date">`, which closes when changing month on many browsers.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import { Calendar, ChevronLeft, ChevronRight } from 'lucide-react';
import { TavariStyles } from '../../utils/TavariStyles';
import { getCalendarDaysForMonth } from '../../helpers/Bookings/bookingActivityScheduleHelpers';

dayjs.extend(utc);
dayjs.extend(timezone);

const WEEKDAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const DATE_KEY_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_OPTIONS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

function stopInsideEvent(event) {
  event.stopPropagation();
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

/** Parse typed input to YYYY-MM-DD for storage. */
function parseDateInput(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;

  if (DATE_KEY_REGEX.test(s)) {
    return dayjs(s, 'YYYY-MM-DD', true).isValid() ? s : null;
  }

  const isoish = s.match(/^(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})$/);
  if (isoish) {
    const key = `${isoish[1]}-${pad2(isoish[2])}-${pad2(isoish[3])}`;
    return dayjs(key, 'YYYY-MM-DD', true).isValid() ? key : null;
  }

  return null;
}

function toDisplayValue(value) {
  if (!value) return '';
  if (DATE_KEY_REGEX.test(String(value))) return String(value);
  const parsed = dayjs(String(value));
  return parsed.isValid() ? parsed.format('YYYY-MM-DD') : String(value);
}

export default function BusinessCalendarPicker({
  value,
  onChange,
  businessTimezone = 'America/Toronto',
  disabled = false,
  ariaLabel = 'Choose date',
  compact = false,
  placeholder = 'Select date',
  minDate = null,
  maxDate = null,
  showMonthYearSelects = false,
  fullWidth = false,
  popoverZIndex = 1200,
}) {
  const containerRef = useRef(null);
  const inputRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [textValue, setTextValue] = useState(() => toDisplayValue(value));
  const [focused, setFocused] = useState(false);
  const [viewMonth, setViewMonth] = useState(() => {
    if (value) return dayjs.tz(value, businessTimezone).startOf('month').toDate();
    return dayjs().tz(businessTimezone).startOf('month').toDate();
  });

  useEffect(() => {
    if (!open) return;
    setViewMonth(
      value
        ? dayjs.tz(value, businessTimezone).startOf('month').toDate()
        : dayjs().tz(businessTimezone).startOf('month').toDate(),
    );
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps -- sync view only when opening

  useEffect(() => {
    if (!focused) {
      setTextValue(toDisplayValue(value));
    }
  }, [value, focused]);

  useEffect(() => {
    if (!open) return undefined;

    const handleOutside = (event) => {
      const root = containerRef.current;
      if (!root || root.contains(event.target)) return;
      setOpen(false);
    };

    const timer = window.setTimeout(() => {
      document.addEventListener('mousedown', handleOutside);
      document.addEventListener('touchstart', handleOutside, { passive: true });
    }, 0);

    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('touchstart', handleOutside);
    };
  }, [open]);

  const calendarDays = useMemo(
    () => getCalendarDaysForMonth(viewMonth, businessTimezone),
    [viewMonth, businessTimezone],
  );

  const monthLabel = dayjs(viewMonth).tz(businessTimezone).format('MMMM YYYY');
  const todayKey = dayjs().tz(businessTimezone).format('YYYY-MM-DD');
  const viewYear = dayjs(viewMonth).tz(businessTimezone).year();
  const viewMonthIndex = dayjs(viewMonth).tz(businessTimezone).month();

  const yearOptions = useMemo(() => {
    const maxYear = maxDate
      ? dayjs(maxDate, 'YYYY-MM-DD', true).year()
      : dayjs().tz(businessTimezone).year();
    const minYear = minDate
      ? dayjs(minDate, 'YYYY-MM-DD', true).year()
      : maxYear - 100;
    const years = [];
    for (let year = maxYear; year >= minYear; year -= 1) {
      years.push(year);
    }
    return years;
  }, [businessTimezone, maxDate, minDate]);

  const isDayDisabled = (dateKey) => {
    if (minDate && dateKey < minDate) return true;
    if (maxDate && dateKey > maxDate) return true;
    return false;
  };

  const toggleOpen = () => {
    if (disabled) return;
    setOpen((was) => !was);
  };

  const handleSelectDay = (dateKey) => {
    if (isDayDisabled(dateKey)) return;
    setTextValue(dateKey);
    onChange?.(dateKey);
    setOpen(false);
    inputRef.current?.blur();
  };

  const commitTextValue = () => {
    const trimmed = textValue.trim();
    if (!trimmed) {
      setTextValue('');
      onChange?.('');
      return;
    }
    const parsed = parseDateInput(trimmed);
    if (parsed && !isDayDisabled(parsed)) {
      setTextValue(parsed);
      if (parsed !== value) onChange?.(parsed);
      return;
    }
    setTextValue(toDisplayValue(value));
  };

  const handleInputKeyDown = (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commitTextValue();
      inputRef.current?.blur();
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      setTextValue(toDisplayValue(value));
      inputRef.current?.blur();
    }
  };

  const shiftMonth = (direction) => {
    setViewMonth((prev) => dayjs(prev).add(direction, 'month').toDate());
  };

  const setCalendarMonth = (monthIndex) => {
    setViewMonth((prev) => dayjs(prev).month(monthIndex).startOf('month').toDate());
  };

  const setCalendarYear = (year) => {
    setViewMonth((prev) => dayjs(prev).year(year).startOf('month').toDate());
  };

  const fieldStyle = {
    padding: compact ? '8px 10px' : '10px 12px',
    border: `1px solid ${open || focused ? TavariStyles.colors.primary : '#e5e7eb'}`,
    borderRadius: '6px',
    fontSize: compact ? '13px' : '14px',
    backgroundColor: disabled ? '#f3f4f6' : 'white',
    color: TavariStyles.colors.gray900,
    minWidth: fullWidth ? 0 : compact ? '128px' : '168px',
    width: fullWidth ? '100%' : compact ? '128px' : '168px',
    flex: fullWidth ? 1 : '0 0 auto',
    boxSizing: 'border-box',
    cursor: disabled ? 'not-allowed' : 'text',
    outline: 'none',
  };

  const buttonStyle = {
    flexShrink: 0,
    width: compact ? '34px' : '40px',
    height: compact ? '34px' : '40px',
    border: `1px solid ${open ? TavariStyles.colors.primary : '#e5e7eb'}`,
    borderRadius: '6px',
    backgroundColor: open ? '#ecfdf5' : 'white',
    color: open ? TavariStyles.colors.primary : TavariStyles.colors.gray700,
    cursor: disabled ? 'not-allowed' : 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 0,
  };

  const navButtonStyle = {
    border: 'none',
    background: 'transparent',
    cursor: 'pointer',
    padding: '4px',
    color: TavariStyles.colors.gray700,
    display: 'flex',
  };

  const headerSelectStyle = {
    border: '1px solid #e5e7eb',
    borderRadius: '6px',
    padding: '4px 6px',
    fontSize: '13px',
    fontWeight: 600,
    color: TavariStyles.colors.gray900,
    backgroundColor: '#fff',
    maxWidth: showMonthYearSelects ? '112px' : undefined,
  };

  return (
    <div
      ref={containerRef}
      style={{
        position: 'relative',
        display: fullWidth ? 'flex' : 'inline-flex',
        alignItems: 'stretch',
        gap: '6px',
        width: fullWidth ? '100%' : undefined,
      }}
    >
      <input
        ref={inputRef}
        type="text"
        inputMode="numeric"
        value={textValue}
        onChange={(e) => setTextValue(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          commitTextValue();
        }}
        onKeyDown={handleInputKeyDown}
        disabled={disabled}
        aria-label={ariaLabel}
        placeholder={placeholder}
        title="Type YYYY-MM-DD or use the calendar"
        style={fieldStyle}
        autoComplete="off"
        spellCheck={false}
      />
      <button
        type="button"
        onClick={toggleOpen}
        disabled={disabled}
        aria-label={open ? 'Close calendar' : 'Open calendar'}
        aria-expanded={open}
        style={buttonStyle}
      >
        <Calendar size={compact ? 16 : 18} aria-hidden />
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="Calendar"
          onMouseDown={stopInsideEvent}
          onTouchStart={stopInsideEvent}
          style={{
            position: 'absolute',
            top: 'calc(100% + 8px)',
            left: 0,
            zIndex: popoverZIndex,
            width: showMonthYearSelects ? '300px' : '280px',
            padding: '14px',
            border: '1px solid #e5e7eb',
            borderRadius: '12px',
            backgroundColor: 'white',
            boxShadow: '0 10px 25px rgba(0, 0, 0, 0.12)',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: '12px',
            }}
          >
            <button
              type="button"
              onMouseDown={stopInsideEvent}
              onTouchStart={stopInsideEvent}
              onClick={(e) => {
                e.stopPropagation();
                shiftMonth(-1);
              }}
              style={navButtonStyle}
              aria-label="Previous month"
            >
              <ChevronLeft size={18} />
            </button>
            {showMonthYearSelects ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', justifyContent: 'center' }}>
                <select
                  value={viewMonthIndex}
                  onMouseDown={stopInsideEvent}
                  onTouchStart={stopInsideEvent}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => {
                    e.stopPropagation();
                    setCalendarMonth(Number(e.target.value));
                  }}
                  aria-label="Choose month"
                  style={{ ...headerSelectStyle, minWidth: '96px' }}
                >
                  {MONTH_OPTIONS.map((label, index) => (
                    <option key={label} value={index}>
                      {label}
                    </option>
                  ))}
                </select>
                <select
                  value={viewYear}
                  onMouseDown={stopInsideEvent}
                  onTouchStart={stopInsideEvent}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => {
                    e.stopPropagation();
                    setCalendarYear(Number(e.target.value));
                  }}
                  aria-label="Choose year"
                  style={{ ...headerSelectStyle, minWidth: '72px' }}
                >
                  {yearOptions.map((year) => (
                    <option key={year} value={year}>
                      {year}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <div style={{ fontSize: '14px', fontWeight: 600, color: TavariStyles.colors.gray900 }}>
                {monthLabel}
              </div>
            )}
            <button
              type="button"
              onMouseDown={stopInsideEvent}
              onTouchStart={stopInsideEvent}
              onClick={(e) => {
                e.stopPropagation();
                shiftMonth(1);
              }}
              style={navButtonStyle}
              aria-label="Next month"
            >
              <ChevronRight size={18} />
            </button>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(7, 1fr)',
              gap: '4px',
              marginBottom: '6px',
            }}
          >
            {WEEKDAY_LABELS.map((label, index) => (
              <div
                key={`${label}-${index}`}
                style={{
                  textAlign: 'center',
                  fontSize: '11px',
                  fontWeight: 700,
                  color: TavariStyles.colors.gray500,
                }}
              >
                {label}
              </div>
            ))}
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(7, 1fr)',
              gap: '4px',
            }}
          >
            {calendarDays.map((date, index) => {
              if (!date) {
                return <div key={`blank-${index}`} style={{ height: '32px' }} />;
              }
              const dateKey = dayjs(date).tz(businessTimezone).format('YYYY-MM-DD');
              const isSelected = value === dateKey;
              const isToday = dateKey === todayKey;
              const dayDisabled = isDayDisabled(dateKey);

              return (
                <button
                  key={dateKey}
                  type="button"
                  disabled={dayDisabled}
                  onMouseDown={stopInsideEvent}
                  onTouchStart={stopInsideEvent}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!dayDisabled) handleSelectDay(dateKey);
                  }}
                  style={{
                    height: '32px',
                    borderRadius: '6px',
                    border: `1px solid ${
                      isSelected ? TavariStyles.colors.primary : isToday ? '#93c5fd' : '#e5e7eb'
                    }`,
                    backgroundColor: isSelected ? TavariStyles.colors.primary : dayDisabled ? '#f9fafb' : 'white',
                    color: dayDisabled ? '#d1d5db' : isSelected ? 'white' : TavariStyles.colors.gray900,
                    cursor: dayDisabled ? 'not-allowed' : 'pointer',
                    fontSize: '13px',
                    fontWeight: isSelected || isToday ? 700 : 500,
                    padding: 0,
                    opacity: dayDisabled ? 0.55 : 1,
                  }}
                >
                  {date.getDate()}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
