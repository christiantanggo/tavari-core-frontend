import React, { useEffect, useMemo, useState } from 'react';

/** Today's calendar date in local timezone as YYYY-MM-DD */
export function getLocalIsoDate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Conservative minimum DOB for adults-only flows (120 years ago, local date). */
export function getDateYearsAgoLocal(yearsBack) {
  const d = new Date();
  d.setFullYear(d.getFullYear() - yearsBack);
  return getLocalIsoDate(d);
}

const MONTH_LABELS = [
  { value: 1, label: 'January' },
  { value: 2, label: 'February' },
  { value: 3, label: 'March' },
  { value: 4, label: 'April' },
  { value: 5, label: 'May' },
  { value: 6, label: 'June' },
  { value: 7, label: 'July' },
  { value: 8, label: 'August' },
  { value: 9, label: 'September' },
  { value: 10, label: 'October' },
  { value: 11, label: 'November' },
  { value: 12, label: 'December' }
];

export function daysInMonth(year, month) {
  if (!Number.isFinite(year) || !Number.isFinite(month)) return 31;
  return new Date(year, month, 0).getDate();
}

export function parseIsoParts(iso) {
  if (!iso || typeof iso !== 'string') return null;
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  if (month < 1 || month > 12) return null;
  const dim = daysInMonth(year, month);
  if (day < 1 || day > dim) return null;
  return { year, month, day };
}

function isoToSortKey(iso) {
  const p = parseIsoParts(iso);
  if (!p) return null;
  return p.year * 10000 + p.month * 100 + p.day;
}

function isIsoInRange(iso, minIso, maxIso) {
  const k = isoToSortKey(iso);
  if (k == null) return false;
  if (minIso) {
    const mk = isoToSortKey(minIso);
    if (mk != null && k < mk) return false;
  }
  if (maxIso) {
    const xk = isoToSortKey(maxIso);
    if (xk != null && k > xk) return false;
  }
  return true;
}

function padIso(y, m, d) {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/**
 * Controlled date as YYYY-MM-DD using month / day / year dropdowns (no native calendar picker).
 */
export default function DateDropdownInput({
  value,
  onChange,
  min,
  max,
  required = false,
  disabled = false,
  idPrefix = 'date-dd',
  style,
  selectStyle
}) {
  const innerFromProp = useMemo(() => {
    const p = parseIsoParts(value);
    if (p) return { year: p.year, month: p.month, day: p.day };
    return { year: '', month: '', day: '' };
  }, [value]);

  const [inner, setInner] = useState(innerFromProp);

  useEffect(() => {
    setInner(innerFromProp);
  }, [innerFromProp]);

  const yearBounds = useMemo(() => {
    const nowY = new Date().getFullYear();
    let yMax = nowY + 15;
    let yMin = 1900;
    if (max) {
      const pm = parseIsoParts(max);
      if (pm) yMax = Math.min(yMax, pm.year);
    }
    if (min) {
      const pn = parseIsoParts(min);
      if (pn) yMin = Math.max(yMin, pn.year);
    }
    const years = [];
    if (yMin <= yMax) {
      for (let y = yMax; y >= yMin; y -= 1) years.push(y);
    } else {
      years.push(nowY);
    }
    return { years, yMin, yMax };
  }, [min, max]);

  const maxDay = useMemo(() => {
    const y = Number(inner.year);
    const m = Number(inner.month);
    if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) return 31;
    return daysInMonth(y, m);
  }, [inner.year, inner.month]);

  const baseSelect = {
    flex: 1,
    minWidth: 0,
    padding: '10px 12px',
    borderRadius: '10px',
    border: '1px solid #cbd5e1',
    fontSize: '14px',
    fontWeight: 600,
    color: '#0f172a',
    backgroundColor: disabled ? '#f1f5f9' : '#fff',
    fontFamily: 'inherit',
    boxSizing: 'border-box',
    ...selectStyle
  };

  const handlePart = (key, raw) => {
    if (raw === '' || raw === undefined) {
      const next = { ...inner, [key]: '' };
      if (key === 'month' || key === 'year') next.day = '';
      setInner(next);
      onChange('');
      return;
    }
    const num = Number(raw);
    let next = { ...inner, [key]: num };

    if (key === 'month' || key === 'year') {
      const y = Number(next.year);
      const m = Number(next.month);
      if (Number.isFinite(y) && Number.isFinite(m) && m >= 1 && m <= 12) {
        const dim = daysInMonth(y, m);
        if (Number.isFinite(Number(next.day)) && Number(next.day) > dim) {
          next = { ...next, day: dim };
        }
      }
    }

    setInner(next);

    const y = Number(next.year);
    const m = Number(next.month);
    let d = Number(next.day);
    if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) {
      onChange('');
      return;
    }
    const dim = daysInMonth(y, m);
    if (m < 1 || m > 12 || d < 1) {
      onChange('');
      return;
    }
    if (d > dim) d = dim;
    const iso = padIso(y, m, d);
    if (!isIsoInRange(iso, min, max)) {
      onChange('');
      return;
    }
    onChange(iso);
  };

  const dayOptions = useMemo(() => {
    const list = [];
    for (let d = 1; d <= maxDay; d += 1) list.push(d);
    return list;
  }, [maxDay]);

  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: '8px',
        alignItems: 'stretch',
        ...style
      }}
    >
      <select
        id={`${idPrefix}-month`}
        aria-label="Month"
        disabled={disabled}
        value={inner.month === '' ? '' : String(inner.month)}
        required={required}
        onChange={(e) => handlePart('month', e.target.value === '' ? '' : Number(e.target.value))}
        style={baseSelect}
      >
        <option value="">Month</option>
        {MONTH_LABELS.map((mo) => (
          <option key={mo.value} value={mo.value}>
            {mo.label}
          </option>
        ))}
      </select>
      <select
        id={`${idPrefix}-day`}
        aria-label="Day"
        disabled={disabled}
        value={inner.day === '' ? '' : String(inner.day)}
        required={required}
        onChange={(e) => handlePart('day', e.target.value === '' ? '' : Number(e.target.value))}
        style={baseSelect}
      >
        <option value="">Day</option>
        {dayOptions.map((d) => (
          <option key={d} value={d}>
            {d}
          </option>
        ))}
      </select>
      <select
        id={`${idPrefix}-year`}
        aria-label="Year"
        disabled={disabled}
        value={inner.year === '' ? '' : String(inner.year)}
        required={required}
        onChange={(e) => handlePart('year', e.target.value === '' ? '' : Number(e.target.value))}
        style={baseSelect}
      >
        <option value="">Year</option>
        {yearBounds.years.map((y) => (
          <option key={y} value={y}>
            {y}
          </option>
        ))}
      </select>
    </div>
  );
}
