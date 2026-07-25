import React, { useEffect, useMemo, useRef, useState } from 'react';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import { FiCalendar, FiChevronLeft, FiChevronRight } from 'react-icons/fi';
import { TavariStyles } from '../../utils/TavariStyles';
import { formatDateShort } from '../../utils/businessDateFormat';
import {
  getAvailableDatesInMonth,
  getCalendarDaysForMonth,
  getBusinessTodayDateKey,
} from '../../helpers/Bookings/bookingActivityScheduleHelpers';

dayjs.extend(utc);
dayjs.extend(timezone);

const weekdayLabels = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

const BookingActivityDatePicker = ({
  value,
  onChange,
  schedules = [],
  businessTimezone,
  includeDateKeys = [],
  disabled = false,
  loading = false,
}) => {
  const containerRef = useRef(null);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(() => {
    if (value) return dayjs.tz(value, businessTimezone).startOf('month').toDate();
    return dayjs().tz(businessTimezone).startOf('month').toDate();
  });

  useEffect(() => {
    if (!value) return;
    const monthStart = dayjs.tz(value, businessTimezone).startOf('month').toDate();
    setCalendarMonth(monthStart);
  }, [value, businessTimezone]);

  useEffect(() => {
    setCalendarOpen(false);
  }, [value]);

  useEffect(() => {
    if (!calendarOpen) return undefined;

    const handlePointerDown = (event) => {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setCalendarOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [calendarOpen]);

  const calendarDays = useMemo(
    () => getCalendarDaysForMonth(calendarMonth, businessTimezone),
    [calendarMonth, businessTimezone],
  );

  const todayStr = useMemo(
    () => getBusinessTodayDateKey(businessTimezone),
    [businessTimezone],
  );

  const availableDateKeys = useMemo(
    () => getAvailableDatesInMonth(
      schedules,
      calendarMonth,
      businessTimezone,
      includeDateKeys,
    ),
    [schedules, calendarMonth, businessTimezone, includeDateKeys],
  );

  const monthLabel = dayjs(calendarMonth).tz(businessTimezone).format('MMMM YYYY');
  const hasAnyAvailableDates = availableDateKeys.size > 0;

  const openCalendar = () => {
    if (disabled || loading) return;
    if (value) {
      setCalendarMonth(dayjs.tz(value, businessTimezone).startOf('month').toDate());
    }
    setCalendarOpen((open) => !open);
  };

  const handleSelectDate = (dateKey) => {
    onChange?.(dateKey);
    setCalendarOpen(false);
  };

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'stretch',
          gap: '8px',
        }}
      >
        <div
          style={{
            flex: 1,
            minWidth: 0,
            padding: '10px 12px',
            border: '1px solid #d1d5db',
            borderRadius: '8px',
            fontSize: '14px',
            boxSizing: 'border-box',
            backgroundColor: disabled ? '#f3f4f6' : 'white',
            color: value ? TavariStyles.colors.gray900 : TavariStyles.colors.gray500,
            display: 'flex',
            alignItems: 'center',
          }}
        >
          {value ? formatDateShort(value, businessTimezone) : 'No date selected'}
        </div>
        <button
          type="button"
          onClick={openCalendar}
          disabled={disabled || loading}
          aria-label={calendarOpen ? 'Close date calendar' : 'Change booking date'}
          title={calendarOpen ? 'Close calendar' : 'Change date'}
          style={{
            flexShrink: 0,
            width: '42px',
            border: `1px solid ${calendarOpen ? TavariStyles.colors.primary : '#d1d5db'}`,
            borderRadius: '8px',
            backgroundColor: calendarOpen ? '#ecfdf5' : 'white',
            color: calendarOpen ? TavariStyles.colors.primary : TavariStyles.colors.gray700,
            cursor: disabled || loading ? 'not-allowed' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 0,
          }}
        >
          <FiCalendar size={18} />
        </button>
      </div>

      {loading ? (
        <div style={{ fontSize: '13px', color: TavariStyles.colors.gray600, marginTop: '6px' }}>
          Loading available dates…
        </div>
      ) : null}

      {calendarOpen ? (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 8px)',
            left: 0,
            right: 0,
            maxWidth: '320px',
            padding: '14px',
            border: '1px solid #e5e7eb',
            borderRadius: '12px',
            backgroundColor: 'white',
            boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)',
            zIndex: 30,
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
              disabled={disabled}
              onClick={() => setCalendarMonth((prev) => dayjs(prev).subtract(1, 'month').toDate())}
              style={{
                border: 'none',
                background: 'transparent',
                cursor: disabled ? 'not-allowed' : 'pointer',
                padding: '4px',
                color: TavariStyles.colors.gray700,
              }}
              aria-label="Previous month"
            >
              <FiChevronLeft size={18} />
            </button>
            <div style={{ fontSize: '14px', fontWeight: '600', color: TavariStyles.colors.gray900 }}>
              {monthLabel}
            </div>
            <button
              type="button"
              disabled={disabled}
              onClick={() => setCalendarMonth((prev) => dayjs(prev).add(1, 'month').toDate())}
              style={{
                border: 'none',
                background: 'transparent',
                cursor: disabled ? 'not-allowed' : 'pointer',
                padding: '4px',
                color: TavariStyles.colors.gray700,
              }}
              aria-label="Next month"
            >
              <FiChevronRight size={18} />
            </button>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(7, 1fr)',
              gap: '6px',
              marginBottom: '8px',
            }}
          >
            {weekdayLabels.map((label, index) => (
              <div
                key={`${label}-${index}`}
                style={{
                  textAlign: 'center',
                  fontSize: '11px',
                  fontWeight: '700',
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
              gap: '6px',
            }}
          >
            {calendarDays.map((date, index) => {
              if (!date) {
                return <div key={`blank-${index}`} style={{ height: '34px' }} />;
              }

              const dateKey = dayjs(date).tz(businessTimezone).format('YYYY-MM-DD');
              const isPast = dateKey < todayStr;
              const isAvailable = !isPast && availableDateKeys.has(dateKey);
              const isCurrentSelection = value === dateKey;

              return (
                <button
                  key={dateKey}
                  type="button"
                  disabled={disabled || loading || !isAvailable}
                  onClick={() => handleSelectDate(dateKey)}
                  style={{
                    height: '34px',
                    borderRadius: '8px',
                    border: `1px solid ${isCurrentSelection ? TavariStyles.colors.primary : '#e5e7eb'}`,
                    backgroundColor: isCurrentSelection
                      ? TavariStyles.colors.primary
                      : isAvailable
                        ? 'white'
                        : '#f3f4f6',
                    color: isCurrentSelection
                      ? 'white'
                      : isAvailable
                        ? TavariStyles.colors.gray900
                        : TavariStyles.colors.gray400,
                    cursor: disabled || loading || !isAvailable ? 'not-allowed' : 'pointer',
                    fontSize: '13px',
                    fontWeight: isCurrentSelection ? '700' : '500',
                    padding: 0,
                  }}
                >
                  {date.getDate()}
                </button>
              );
            })}
          </div>

          {!loading && !hasAnyAvailableDates ? (
            <div style={{ fontSize: '13px', color: '#b45309', marginTop: '10px' }}>
              No scheduled dates are configured for this activity in this month.
            </div>
          ) : null}

          <div style={{ fontSize: '13px', color: TavariStyles.colors.gray500, marginTop: '10px' }}>
            Past dates cannot be selected.
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default BookingActivityDatePicker;
