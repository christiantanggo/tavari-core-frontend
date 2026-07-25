import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import dayjs from 'dayjs';
import { Clock, Printer, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';
import { supabase } from '../../supabaseClient';
import { TavariStyles } from '../../utils/TavariStyles';
import { employeeAppPath } from '../../utils/employeeAppRouting';
import { getPublicUserId } from '../../utils/getPublicUserId';
import { sendSchedulingNotification } from '../../helpers/Scheduling/schedulingNotificationService';
import { ensureEmployeePortalSelectedProfile, getEmployeePortalSelectedBusinessId } from '../../utils/employeeProfileSelection';
import TavariCheckbox from '../../components/UI/TavariCheckbox';
import DateDropdownInput from '../../components/UI/DateDropdownInput';
import PositionLabel from '../../components/HR/PositionLabel';
import { useBusinessPositions } from '../../hooks/useBusinessPositions';
import PortalScheduleManager from '../../components/Portal/PortalScheduleManager';
import { formatPositionDisplay } from '../../utils/positionCatalog';

const REQUEST_TYPES = [
  { value: 'vacation', label: 'Vacation' },
  { value: 'sick', label: 'Sick' },
  { value: 'personal', label: 'Personal' },
  { value: 'bereavement', label: 'Bereavement' },
  { value: 'jury_duty', label: 'Jury Duty' },
  { value: 'other', label: 'Other' }
];

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const getLocalDateString = (date = new Date()) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const addDays = (date, days) => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};

const getWeekStart = (dateString) => {
  const date = new Date(`${dateString}T12:00:00`);
  date.setDate(date.getDate() - date.getDay());
  return getLocalDateString(date);
};

const getDefaultFilters = () => {
  const today = new Date();
  return {
    preset: 'next30',
    startDate: getLocalDateString(today),
    endDate: getLocalDateString(addDays(today, 30))
  };
};

/** Full Schedule tab: today through today + 6 days (7 calendar days). */
const getFullScheduleDefaultFilters = () => {
  const today = new Date();
  return {
    preset: 'next7',
    startDate: getLocalDateString(today),
    endDate: getLocalDateString(addDays(today, 6))
  };
};

const timeStringToMinutes = (t) => {
  if (!t) return 0;
  const parts = String(t).split(':');
  const h = Number(parts[0]);
  const m = Number(parts[1]);
  if (Number.isNaN(h) || Number.isNaN(m)) return 0;
  return h * 60 + m;
};

const composeUserDisplayName = (u) => {
  if (!u) return '';
  if (u.full_name && String(u.full_name).trim()) return u.full_name.trim();
  return [u.first_name, u.last_name].filter(Boolean).join(' ').trim();
};

const getShiftEmployeeName = (shift, employeeNameById = null) => {
  const fromJoin = composeUserDisplayName(shift.users);
  if (fromJoin) return fromJoin;
  if (shift.employee_id && employeeNameById?.[shift.employee_id]) {
    return employeeNameById[shift.employee_id];
  }
  return 'Unknown';
};

const sortShiftsForFullSchedule = (shifts) => {
  return [...shifts].sort((a, b) => {
    const dc = (a.shift_date || '').localeCompare(b.shift_date || '');
    if (dc !== 0) return dc;
    const tc = timeStringToMinutes(a.start_time) - timeStringToMinutes(b.start_time);
    if (tc !== 0) return tc;
    const fa = (a.users?.first_name || '').trim().toLowerCase();
    const fb = (b.users?.first_name || '').trim().toLowerCase();
    const fc = fa.localeCompare(fb);
    if (fc !== 0) return fc;
    return (a.users?.last_name || '').trim().toLowerCase().localeCompare((b.users?.last_name || '').trim().toLowerCase());
  });
};

/**
 * One row per calendar day in [startDate, endDate] that has at least one shift or one event.
 * Events are sorted by name; shifts should already be sorted (e.g. sortShiftsForFullSchedule).
 */
const normalizeScheduleDateKey = (value) => {
  if (!value) return '';
  return String(value).slice(0, 10);
};

const buildScheduleDayGroupsFromRange = (startDate, endDate, sortedShifts, events = []) => {
  const allDays = enumerateDateStringsInclusive(startDate, endDate);
  const shiftsByDate = new Map();
  for (const s of sortedShifts || []) {
    const d = normalizeScheduleDateKey(s.shift_date);
    if (!d) continue;
    if (!shiftsByDate.has(d)) shiftsByDate.set(d, []);
    shiftsByDate.get(d).push(s);
  }
  const eventsByDate = new Map();
  for (const e of events || []) {
    const d = normalizeScheduleDateKey(e.event_date);
    if (!d) continue;
    if (!eventsByDate.has(d)) eventsByDate.set(d, []);
    eventsByDate.get(d).push(e);
  }
  const groups = [];
  for (const date of allDays) {
    const dayShifts = shiftsByDate.get(date) || [];
    const dayEvents = (eventsByDate.get(date) || [])
      .slice()
      .sort((a, b) => String(a.event_name || '').localeCompare(String(b.event_name || '')));
    if (dayShifts.length === 0 && dayEvents.length === 0) continue;
    groups.push({ date, shifts: dayShifts, events: dayEvents });
  }
  return groups;
};

const escapeHtml = (str) => {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
};

const getShiftPositionPrintLabel = (shift, nameSet) => {
  const out = formatPositionDisplay(shift.position, nameSet);
  if (!out) return 'No position';
  return out;
};

/** Match scheduling SchedulesTab week chunks when printing long ranges */
const enumerateDateStringsInclusive = (startStr, endStr) => {
  const out = [];
  const cur = new Date(`${startStr}T12:00:00`);
  const end = new Date(`${endStr}T12:00:00`);
  if (Number.isNaN(cur.getTime()) || Number.isNaN(end.getTime())) return out;
  while (cur <= end) {
    const y = cur.getFullYear();
    const m = String(cur.getMonth() + 1).padStart(2, '0');
    const d = String(cur.getDate()).padStart(2, '0');
    out.push(`${y}-${m}-${d}`);
    cur.setDate(cur.getDate() + 1);
  }
  return out;
};

const chunkArray = (arr, size) => {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
};

/** Same time display as SchedulesTab shift blocks */
const formatShiftTimeRange12h = (shift) => {
  const fmt = (timeStrRaw) => {
    if (!timeStrRaw) return 'Time TBD';
    const timeStr = timeStrRaw.length > 5 ? timeStrRaw.substring(0, 5) : timeStrRaw;
    const [hours, minutes] = timeStr.split(':').map(Number);
    if (Number.isNaN(hours)) return 'Time TBD';
    const hour12 = hours % 12 || 12;
    const ampm = hours >= 12 ? 'pm' : 'am';
    return `${hour12}:${String(minutes).padStart(2, '0')}${ampm}`;
  };
  return `${fmt(shift.start_time)} - ${fmt(shift.end_time)}`;
};

const formatTo12HourOpenClose = (time24) => {
  if (!time24) return '';
  const parts = String(time24).split(':');
  const hour = parseInt(parts[0], 10);
  const minutes = parts[1] || '00';
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const hour12 = hour % 12 || 12;
  return `${hour12}:${minutes} ${ampm}`;
};

const getShiftBgColorPrint = (position, positionRows) => {
  const row = (positionRows || []).find((p) => p.position_name === position);
  if (row?.color) return row.color;
  const colorMap = {
    'President/CEO': '#dc3545',
    'Facility Director': '#fd7e14',
    'A-Shift Lead': '#28a745',
    'GEC Clerk': '#007bff',
    'A - Clerk': '#20c997',
    'Night Cleaner': '#6610f2',
    Default: '#4a90e2'
  };
  return colorMap[position] || colorMap.Default;
};

const getDayBusinessHoursPrint = (dayStr, operatingHours, holidayHours) => {
  if (!operatingHours) return null;
  const day = dayjs(dayStr);
  const dayName = day.format('dddd').toLowerCase();
  const hours = operatingHours[dayName];
  const holiday = (holidayHours || []).find((h) => h.date === dayStr);
  if (holiday) {
    if (holiday.closed) return 'CLOSED';
    if (holiday.hours) {
      return `${formatTo12HourOpenClose(holiday.hours.open)} - ${formatTo12HourOpenClose(holiday.hours.close)}`;
    }
    return null;
  }
  if (hours && !hours.closed) {
    return `${formatTo12HourOpenClose(hours.open)} - ${formatTo12HourOpenClose(hours.close)}`;
  }
  if (hours && hours.closed) return 'CLOSED';
  return null;
};

const sortShiftsByStartPrint = (list) =>
  [...list].sort((a, b) => timeStringToMinutes(a.start_time) - timeStringToMinutes(b.start_time));

/**
 * HTML for one grid matching Scheduling → Schedules tab layout (team column + day columns).
 */
const buildSchedulesTabStylePrintGrid = ({
  chunkDays,
  teamShifts,
  employees,
  operatingHours,
  holidayHours,
  events,
  nameSet,
  positionRows
}) => {
  const n = chunkDays.length;
  const gridCol = `200px repeat(${n}, minmax(0, 1fr))`;
  const borderR = `1px solid #e5e7eb`;
  const borderB = `2px solid #d1d5db`;
  const ink = '#0f172a';
  const inkMuted = '#1e293b';

  let html = '';

  html += `<div style="display:grid;grid-template-columns:${gridCol};background:#f9fafb;border-bottom:${borderB};color:${ink};">`;
  html += `<div style="padding:12px;border-right:${borderR};font-weight:700;font-size: 14px;text-align:center;color:${ink}">Team Members</div>`;
  chunkDays.forEach((d) => {
    const dj = dayjs(d);
    html += `<div style="padding:12px;border-right:${borderR};font-weight:700;font-size: 14px;text-align:center;color:${ink}"><div>${dj.format('ddd').toUpperCase()}</div><div>${dj.format('D')}</div></div>`;
  });
  html += '</div>';

  html += `<div style="display:grid;grid-template-columns:${gridCol};background:#f0fdf4;border-bottom:${borderB};color:${ink};">`;
  html += `<div style="padding:12px;border-right:${borderR};font-weight:700;font-size: 13px;display:flex;align-items:center;color:${ink}">Business Hours</div>`;
  chunkDays.forEach((d) => {
    const h = getDayBusinessHoursPrint(d, operatingHours, holidayHours);
    const display = h || 'N/A';
    let cellColor = inkMuted;
    if (h === 'CLOSED') cellColor = '#b91c1c';
    else if (h) cellColor = '#047857';
    html += `<div style="padding:12px;text-align:center;border-right:${borderR};font-size: 13px;font-weight:600;color:${cellColor}">${escapeHtml(display)}</div>`;
  });
  html += '</div>';

  html += `<div style="display:grid;grid-template-columns:${gridCol};background:#dbeafe;border-bottom:${borderB};color:${ink};">`;
  html += `<div style="padding:12px;border-right:${borderR};font-weight:700;font-size: 13px;display:flex;align-items:center;color:${ink}">Events</div>`;
  chunkDays.forEach((d) => {
    const dayEvents = (events || []).filter((e) => e.event_date === d);
    const inner = dayEvents.length
      ? dayEvents.map((e) => `<div style="padding:4px 8px;background:#1d4ed8;color:#ffffff;border-radius:4px;font-size: 13px;font-weight:700;margin-bottom:4px">${escapeHtml(e.event_name || '')}</div>`).join('')
      : '';
    html += `<div style="padding:12px;border-right:${borderR};display:flex;flex-direction:column;gap:4px;min-height:36px">${inner}</div>`;
  });
  html += '</div>';

  html += `<div style="display:grid;grid-template-columns:${gridCol};background:#fef3c7;border-bottom:${borderB};color:${ink};">`;
  html += `<div style="padding:12px;border-right:${borderR};font-weight:700;font-size: 13px;display:flex;align-items:center;color:${ink}">Open Shifts</div>`;
  chunkDays.forEach((d) => {
    const openShifts = sortShiftsByStartPrint(
      teamShifts.filter((s) => s.shift_date === d && (!s.employee_id || s.is_open_shift))
    );
    const blocks = openShifts.map((shift) => {
      const bg = getShiftBgColorPrint(shift.position, positionRows);
      const pos = escapeHtml(getShiftPositionPrintLabel(shift, nameSet));
      const times = escapeHtml(formatShiftTimeRange12h(shift));
      const pending = shift.is_published === false;
      const border = pending ? 'border:2px dashed #f59e0b' : 'border:none';
      const op = pending ? '0.85' : '1';
      return `<div style="padding:8px;border-radius:4px;color:#ffffff;font-size: 14px;font-weight:700;background:${bg};${border};opacity:${op};margin-bottom:4px;text-shadow:0 0 1px rgba(0,0,0,0.35)"><div>${pos}${pending ? ' <span style="font-size: 10px;font-weight:800">(Pending)</span>' : ''}</div><div style="font-size: 14px;font-weight:600">${times}</div></div>`;
    }).join('');
    html += `<div style="padding:4px;border-right:${borderR};display:flex;flex-direction:column;gap:4px">${blocks}</div>`;
  });
  html += '</div>';

  employees.forEach((emp) => {
    html += `<div style="display:grid;grid-template-columns:${gridCol};border-bottom:1px solid #e5e7eb;min-height:48px;">`;
    html += `<div style="display:flex;align-items:center;padding:12px;border-right:${borderR};background:#fff;font-weight:700;font-size: 14px;color:${ink}">${escapeHtml(emp.full_name)}</div>`;
    chunkDays.forEach((d) => {
      const dayShifts = sortShiftsByStartPrint(
        teamShifts.filter((s) => s.employee_id === emp.id && s.shift_date === d)
      );
      const blocks = dayShifts.map((shift) => {
        const bg = getShiftBgColorPrint(shift.position, positionRows);
        const pos = escapeHtml(getShiftPositionPrintLabel(shift, nameSet));
        const times = escapeHtml(formatShiftTimeRange12h(shift));
        const pending = shift.is_published === false;
        const border = pending ? 'border:2px dashed #f59e0b' : 'border:none';
        const op = pending ? '0.85' : '1';
        return `<div style="padding:8px;border-radius:4px;color:#ffffff;font-size: 16px;font-weight:700;background:${bg};${border};opacity:${op};margin-bottom:4px;text-shadow:0 0 1px rgba(0,0,0,0.35)"><div style="margin-bottom:2px">${pos}${pending ? ' <span style="font-size: 10px;font-weight:800">(Pending)</span>' : ''}</div><div style="font-size: 14px;font-weight:600">${times}</div></div>`;
      }).join('');
      html += `<div style="padding:4px;border-right:${borderR};display:flex;flex-direction:column;gap:4px;background:#fff">${blocks}</div>`;
    });
    html += '</div>';
  });

  return html;
};

/** US Letter landscape with 0.5in margins @ 96dpi — iframe layout width must match or scale shrinks for fake “wide” pages */
const PRINT_DPI = 96;
const PRINT_MARGIN_IN = 0.5;
const PRINT_MARGIN_PX = PRINT_MARGIN_IN * PRINT_DPI;
const PRINTABLE_W_PX = Math.round(11 * PRINT_DPI - 2 * PRINT_MARGIN_PX);
const PRINTABLE_H_PX = Math.round(8.5 * PRINT_DPI - 2 * PRINT_MARGIN_PX);

/** Match `@page` margins — printable area = sheet − margins */
const applyFitOnePagePrintScale = (win) => {
  const doc = win.document;
  const htmlEl = doc.documentElement;
  const body = doc.body;
  if (!body) return;

  const root = doc.getElementById('print-root');
  const measureEl = root || body;

  const rect = measureEl.getBoundingClientRect();
  const cw = Math.ceil(Math.max(measureEl.scrollWidth, measureEl.offsetWidth, rect.width || 0));
  const ch = Math.ceil(Math.max(measureEl.scrollHeight, measureEl.offsetHeight, rect.height || 0));

  if (!cw || !ch) return;

  /** Lay out at printable width first so scale is driven by height (tall schedules), not by an oversized iframe width */
  const scale = Math.min(1, PRINTABLE_W_PX / cw, PRINTABLE_H_PX / ch);
  if (scale >= 0.998) return;

  if (typeof htmlEl.style.zoom !== 'undefined') {
    htmlEl.style.zoom = String(scale);
    return;
  }
  if (typeof body.style.zoom !== 'undefined') {
    body.style.zoom = String(scale);
    return;
  }

  body.style.transformOrigin = 'top left';
  body.style.transform = `scale(${scale})`;
  const inv = 100 / scale;
  body.style.width = `${inv}%`;
};

/** Pop-up windows with `noopener` often cannot be scripted (blank tab on Safari/iOS). Hidden iframe avoids that. */
const printHtmlDocument = (html, options = {}) => {
  const { fitOnePage = false } = options;

  const iframe = document.createElement('iframe');
  iframe.setAttribute('title', 'Print preview');
  iframe.setAttribute('aria-hidden', 'true');
  Object.assign(iframe.style, {
    position: 'fixed',
    left: '-20000px',
    top: '0',
    /** Same width as printed page — wide iframe made the grid huge and forced tiny scale + empty space below */
    width: `${PRINTABLE_W_PX}px`,
    height: '12000px',
    border: '0',
    opacity: '0',
    pointerEvents: 'none',
  });

  const cleanup = () => {
    if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
  };

  document.body.appendChild(iframe);

  const win = iframe.contentWindow;
  const doc = iframe.contentDocument || win.document;
  doc.open();
  doc.write(html);
  doc.close();

  const runPrint = () => {
    try {
      if (fitOnePage) {
        applyFitOnePagePrintScale(win);
      }
      win.focus();
      win.print();
    } finally {
      setTimeout(cleanup, 1500);
    }
  };

  const delay = fitOnePage ? 280 : 150;
  setTimeout(runPrint, delay);
};

const SCHEDULE_TAB_KEYS = ['schedule', 'fullSchedule', 'availability', 'timeOff', 'activity'];

/** Summary grid 2×2, centered tabs — below this width (matches portal / dashboard mobile breakpoint). */
const SCHEDULE_PAGE_MOBILE_MQ = '(max-width: 768px)';

const PortalScheduleSelfService = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [isScheduleMobileLayout, setIsScheduleMobileLayout] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia(SCHEDULE_PAGE_MOBILE_MQ).matches
  );
  const [activeTab, setActiveTab] = useState(() => {
    const t = searchParams.get('tab');
    return SCHEDULE_TAB_KEYS.includes(t) ? t : 'schedule';
  });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [business, setBusiness] = useState(null);
  const [employee, setEmployee] = useState(null);
  const [shifts, setShifts] = useState([]);
  const [availability, setAvailability] = useState([]);
  const [timeOff, setTimeOff] = useState([]);
  const [scheduleSeenAt, setScheduleSeenAt] = useState(null);
  const [filters, setFilters] = useState(getDefaultFilters);
  const [fullScheduleFilters, setFullScheduleFilters] = useState(getFullScheduleDefaultFilters);
  const [teamShifts, setTeamShifts] = useState([]);
  const [teamEmployeeNameById, setTeamEmployeeNameById] = useState({});
  const [teamScheduleEvents, setTeamScheduleEvents] = useState([]);
  const [myScheduleEvents, setMyScheduleEvents] = useState([]);
  const [loadingTeamSchedule, setLoadingTeamSchedule] = useState(false);
  const [availabilityForm, setAvailabilityForm] = useState({
    day_of_week: new Date().getDay(),
    is_available: true,
    all_day: true,
    start_time: '09:00',
    end_time: '17:00',
    effective_date: getLocalDateString(new Date()),
    expiry_date: '',
    notes: ''
  });
  const [timeOffForm, setTimeOffForm] = useState({
    request_type: 'vacation',
    start_date: getLocalDateString(addDays(new Date(), 1)),
    end_date: getLocalDateString(addDays(new Date(), 1)),
    is_partial_day: false,
    start_time: '09:00',
    end_time: '17:00',
    notes: ''
  });
  const [timeOffBlockModal, setTimeOffBlockModal] = useState({ open: false, title: '', message: '' });
  const [isOwnerOrManager, setIsOwnerOrManager] = useState(false);
  const [schedulePageView, setSchedulePageView] = useState('personal');

  const nextShift = shifts[0] || null;
  const totalHours = useMemo(() => {
    return shifts.reduce((sum, shift) => sum + (calculateHours(shift.start_time, shift.end_time) || 0), 0);
  }, [shifts]);

  const activityItems = useMemo(() => {
    const items = [];

    shifts.slice(0, 8).forEach((shift) => {
      items.push({
        id: `shift-${shift.id}`,
        date: shift.shift_date,
        title: 'Published shift',
        description: `${formatShiftDate(shift.shift_date)} • ${formatTime(shift.start_time)} - ${formatTime(shift.end_time)}`,
        status: shift.status || 'scheduled'
      });
    });

    availability.slice(0, 8).forEach((item) => {
      items.push({
        id: `availability-${item.id}`,
        date: item.updated_at || item.created_at || item.effective_date,
        title: `Availability ${formatStatus(item.status || 'pending')}`,
        description: `${DAYS[item.day_of_week] || 'Day'} • ${item.is_available ? 'Available' : 'Unavailable'}`,
        status: item.status || 'pending'
      });
    });

    timeOff.slice(0, 8).forEach((item) => {
      items.push({
        id: `timeoff-${item.id}`,
        date: item.updated_at || item.created_at || item.start_date,
        title: `Time off ${formatStatus(item.status || 'pending')}`,
        description: `${formatRequestType(item.request_type)} • ${formatDateRange(item.start_date, item.end_date)}`,
        status: item.status || 'pending'
      });
    });

    myScheduleEvents.slice(0, 8).forEach((ev) => {
      items.push({
        id: `event-${ev.id}`,
        date: ev.event_date,
        title: 'Business event',
        description: `${formatShiftDate(ev.event_date)} • ${ev.event_name || 'Event'}`,
        status: 'posted'
      });
    });

    return items
      .sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime())
      .slice(0, 12);
  }, [availability, shifts, timeOff, myScheduleEvents]);

  const fullScheduleGroups = useMemo(
    () =>
      buildScheduleDayGroupsFromRange(
        fullScheduleFilters.startDate,
        fullScheduleFilters.endDate,
        teamShifts,
        teamScheduleEvents
      ),
    [fullScheduleFilters.startDate, fullScheduleFilters.endDate, teamShifts, teamScheduleEvents]
  );

  const myScheduleGroups = useMemo(
    () =>
      buildScheduleDayGroupsFromRange(
        filters.startDate,
        filters.endDate,
        sortShiftsForFullSchedule(shifts),
        myScheduleEvents
      ),
    [filters.startDate, filters.endDate, shifts, myScheduleEvents]
  );

  const { nameSet, rows: positionRows } = useBusinessPositions(business?.id);

  const handlePrintFullSchedule = async () => {
    if (!business?.id) {
      toast.error('Nothing to print for this date range');
      return;
    }

    const employeeMap = new Map();
    teamShifts.forEach((s) => {
      if (!s.employee_id || s.is_open_shift) return;
      if (!employeeMap.has(s.employee_id)) {
        employeeMap.set(s.employee_id, { id: s.employee_id, full_name: getShiftEmployeeName(s, teamEmployeeNameById) });
      }
    });
    const employees = [...employeeMap.values()].sort((a, b) => a.full_name.localeCompare(b.full_name));

    try {
      const start = fullScheduleFilters.startDate;
      const end = fullScheduleFilters.endDate;
      const [bizResult, eventsResult] = await Promise.all([
        supabase.from('businesses').select('operating_hours, holiday_hours').eq('id', business.id).single(),
        supabase
          .from('scheduling_events')
          .select('*')
          .eq('business_id', business.id)
          .gte('event_date', start)
          .lte('event_date', end)
      ]);

      if (bizResult.error) console.warn('print schedule business hours', bizResult.error);
      if (eventsResult.error) console.warn('print schedule events', eventsResult.error);

      const operatingHours = bizResult.data?.operating_hours ?? null;
      const holidayHours = bizResult.data?.holiday_hours ?? [];
      const events = eventsResult.data || [];

      if (!teamShifts.length && !events.length) {
        toast.error('Nothing to print for this date range');
        return;
      }

      const allDays = enumerateDateStringsInclusive(start, end);
      const chunks = chunkArray(allDays, 7);

      const businessName = business?.name || 'Business';
      const rangeLabel = `${start} to ${end}`;
      const printed = new Date().toLocaleString();

      const gridsHtml = chunks
        .map((chunkDays) => {
          if (chunkDays.length === 0) return '';
          const chunkLabel =
            chunkDays.length === 1
              ? dayjs(chunkDays[0]).format('MMM D, YYYY')
              : `${dayjs(chunkDays[0]).format('MMM D')} – ${dayjs(chunkDays[chunkDays.length - 1]).format('MMM D, YYYY')}`;
          const grid = buildSchedulesTabStylePrintGrid({
            chunkDays,
            teamShifts,
            employees,
            operatingHours,
            holidayHours,
            events,
            nameSet,
            positionRows
          });
          return `<div style="margin-bottom:28px;page-break-inside:avoid">
${chunks.length > 1 ? `<h2 style="font-size: 15px;margin:0 0 12px;color:#0f172a;font-weight:800">${escapeHtml(chunkLabel)}</h2>` : ''}
${grid}
</div>`;
        })
        .join('');

      const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>${escapeHtml(businessName)} — Schedule</title><style>
html{box-sizing:border-box;}
*,*:before,*:after{box-sizing:inherit;}
body{font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:#0f172a;margin:0;padding:14px 16px;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
#print-root{max-width:100%;color:#0f172a;}
h1{font-size: 23px;margin:0 0 8px;font-weight:800;color:#020617;}
.meta{color:#1e293b;margin:0 0 14px;font-size: 13px;font-weight:600;}
.grid-wrap{background:#fff;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;width:100%;}
@page{size:letter landscape;margin:${PRINT_MARGIN_IN}in;}
@media print{body{padding:0;}#print-root{padding:0;}}
</style></head><body>
<div id="print-root">
<h1>${escapeHtml(businessName)} — Schedules</h1>
<p class="meta">${escapeHtml(rangeLabel)} · Printed ${escapeHtml(printed)}</p>
<div class="grid-wrap">${gridsHtml}</div>
</div>
</body></html>`;

      printHtmlDocument(html, { fitOnePage: true });
    } catch (e) {
      console.error('printFullSchedule', e);
      toast.error('Could not prepare print view');
    }
  };

  useEffect(() => {
    const t = searchParams.get('tab');
    if (SCHEDULE_TAB_KEYS.includes(t)) {
      setActiveTab(t);
      return;
    }
    setActiveTab('schedule');
  }, [searchParams]);

  useEffect(() => {
    const mq = window.matchMedia(SCHEDULE_PAGE_MOBILE_MQ);
    const apply = () => setIsScheduleMobileLayout(mq.matches);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);

  useEffect(() => {
    loadSelfService();
    window.addEventListener('employee-profile-selection-changed', loadSelfService);
    return () => window.removeEventListener('employee-profile-selection-changed', loadSelfService);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.startDate, filters.endDate]);

  const loadSelfService = async ({ silent = false } = {}) => {
    try {
      if (silent) setRefreshing(true);
      else setLoading(true);

      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (!authUser) {
        return;
      }

      const publicUserId = await getPublicUserId(authUser.email);
      if (!publicUserId) {
        toast.error('Employee profile not found');
        return;
      }

      // Match PortalLayout: same ordering and ensure* so the active business is never arbitrary.
      const { data: businessUsers, error: businessUserError } = await supabase
        .from('business_users')
        .select('business_id, role, created_at, users!business_users_user_id_fkey(id, full_name, position), businesses:business_id(id, name, timezone)')
        .eq('user_id', publicUserId)
        .order('created_at', { ascending: false })
        .limit(20);

      if (businessUserError) throw businessUserError;
      if (!businessUsers?.length) {
        toast.error('You are not associated with a business');
        return;
      }

      const profileList = businessUsers.map((row) => ({
        employee_id: publicUserId,
        business_id: row.business_id,
        business_name: row.businesses?.name || 'Business',
        role: row.role || 'employee',
      }));

      const resolved = ensureEmployeePortalSelectedProfile(profileList);
      const targetBusinessId = resolved?.business_id ?? getEmployeePortalSelectedBusinessId();

      const businessUser = businessUsers.find(
        (row) => String(row.business_id) === String(targetBusinessId)
      ) || businessUsers[0];
      if (!businessUser?.business_id) {
        toast.error('You are not associated with a business');
        return;
      }

      // Shifts may key employee_id to public.users.id and/or auth user id depending on when the row was created.
      const scheduleEmployeeIds = [...new Set([publicUserId, authUser.id].filter(Boolean))];

      const nextBusiness = businessUser.businesses || { id: businessUser.business_id };
      const nextEmployee = businessUser.users || { id: publicUserId, full_name: authUser.email };

      setBusiness(nextBusiness);
      setEmployee(nextEmployee);

      const { data: userRoles } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', publicUserId)
        .eq('business_id', businessUser.business_id)
        .eq('active', true)
        .limit(1);

      const userRole = userRoles?.[0]?.role || null;
      const buRole = businessUser.role || 'employee';
      setIsOwnerOrManager(
        userRole === 'owner' ||
          userRole === 'manager' ||
          userRole === 'admin' ||
          userRole === 'hr_admin' ||
          buRole === 'owner' ||
          buRole === 'manager' ||
          buRole === 'admin' ||
          buRole === 'hr_admin',
      );

      const weekStart = getWeekStart(filters.startDate);
      const [shiftResult, availabilityResult, timeOffResult, seenResult, scheduleEventsResult] = await Promise.all([
        supabase
          .from('scheduling_shifts')
          .select('id, business_id, employee_id, shift_date, start_time, end_time, status, position, notes, is_published, updated_at')
          .eq('business_id', businessUser.business_id)
          .in('employee_id', scheduleEmployeeIds)
          .gte('shift_date', filters.startDate)
          .lte('shift_date', filters.endDate)
          .order('shift_date', { ascending: true })
          .order('start_time', { ascending: true }),
        supabase
          .from('scheduling_availability')
          .select('*')
          .eq('business_id', businessUser.business_id)
          .in('employee_id', scheduleEmployeeIds)
          .order('created_at', { ascending: false }),
        supabase
          .from('scheduling_time_off')
          .select('*')
          .eq('business_id', businessUser.business_id)
          .in('employee_id', scheduleEmployeeIds)
          .order('created_at', { ascending: false }),
        supabase
          .from('scheduling_schedule_views')
          .select('*')
          .eq('business_id', businessUser.business_id)
          .in('employee_id', scheduleEmployeeIds)
          .eq('week_start', weekStart)
          .order('seen_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from('scheduling_events')
          .select('id, business_id, event_date, event_name, event_description')
          .eq('business_id', businessUser.business_id)
          .gte('event_date', filters.startDate)
          .lte('event_date', filters.endDate)
      ]);

      if (shiftResult.error) throw shiftResult.error;
      if (availabilityResult.error) throw availabilityResult.error;
      if (timeOffResult.error) throw timeOffResult.error;
      if (seenResult.error && seenResult.error.code !== 'PGRST116') throw seenResult.error;
      if (scheduleEventsResult.error) {
        console.warn('[PortalScheduleSelfService] scheduling_events:', scheduleEventsResult.error);
        setMyScheduleEvents([]);
      } else {
        setMyScheduleEvents(scheduleEventsResult.data || []);
      }

      setShifts((shiftResult.data || []).filter((shift) => shift.is_published !== false));
      setAvailability(availabilityResult.data || []);
      setTimeOff(timeOffResult.data || []);
      setScheduleSeenAt(seenResult.data?.seen_at || null);

      await recordScheduleSeen({
        businessId: businessUser.business_id,
        employeeId: publicUserId,
        weekStart,
        authUserId: authUser.id
      });
    } catch (error) {
      console.error('Error loading employee scheduling self-service:', error);
      toast.error('Could not load scheduling self-service');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const loadTeamSchedule = async ({ silent = false } = {}) => {
    if (!business?.id) return;
    try {
      if (!silent) setLoadingTeamSchedule(true);
      const [shiftRes, eventsRes] = await Promise.all([
        supabase
          .from('scheduling_shifts')
          .select(`
          id, business_id, employee_id, shift_date, start_time, end_time, status, position, notes, is_published,
          users!scheduling_shifts_employee_id_fkey ( first_name, last_name, full_name )
        `)
          .eq('business_id', business.id)
          .gte('shift_date', fullScheduleFilters.startDate)
          .lte('shift_date', fullScheduleFilters.endDate),
        supabase
          .from('scheduling_events')
          .select('id, business_id, event_date, event_name, event_description')
          .eq('business_id', business.id)
          .gte('event_date', fullScheduleFilters.startDate)
          .lte('event_date', fullScheduleFilters.endDate)
      ]);
      if (shiftRes.error) throw shiftRes.error;
      if (eventsRes.error) {
        console.warn('[PortalScheduleSelfService] loadTeamSchedule scheduling_events', eventsRes.error);
        setTeamScheduleEvents([]);
      } else {
        setTeamScheduleEvents(eventsRes.data || []);
      }
      const published = (shiftRes.data || []).filter((s) => s.is_published !== false);

      const employeeIds = [...new Set(published.map((s) => s.employee_id).filter(Boolean))];
      let nameById = {};
      if (employeeIds.length > 0) {
        const { data: userRows, error: usersError } = await supabase
          .from('users')
          .select('id, full_name, first_name, last_name')
          .in('id', employeeIds);
        if (usersError) {
          console.warn('[PortalScheduleSelfService] loadTeamSchedule user names', usersError);
        } else {
          nameById = (userRows || []).reduce((map, row) => {
            const label = composeUserDisplayName(row);
            if (label) map[row.id] = label;
            return map;
          }, {});
        }
      }
      setTeamEmployeeNameById(nameById);
      setTeamShifts(sortShiftsForFullSchedule(published));
    } catch (e) {
      console.error('loadTeamSchedule', e);
      toast.error('Could not load team schedule');
      setTeamShifts([]);
      setTeamEmployeeNameById({});
      setTeamScheduleEvents([]);
    } finally {
      setLoadingTeamSchedule(false);
    }
  };

  useEffect(() => {
    if (activeTab !== 'fullSchedule' || !business?.id) return;
    loadTeamSchedule();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, business?.id, fullScheduleFilters.startDate, fullScheduleFilters.endDate]);

  const applyPreset = (preset) => {
    const today = new Date();
    const startOfWeek = new Date(today);
    startOfWeek.setDate(today.getDate() - today.getDay());
    const presets = {
      today: { startDate: getLocalDateString(today), endDate: getLocalDateString(today) },
      week: { startDate: getLocalDateString(startOfWeek), endDate: getLocalDateString(addDays(startOfWeek, 6)) },
      next30: { startDate: getLocalDateString(today), endDate: getLocalDateString(addDays(today, 30)) },
      past30: { startDate: getLocalDateString(addDays(today, -30)), endDate: getLocalDateString(today) }
    };
    setFilters({ preset, ...presets[preset] });
  };

  const updateCustomDate = (field, value) => {
    setFilters((current) => ({ ...current, preset: 'custom', [field]: value }));
  };

  const applyFullSchedulePreset = (preset) => {
    const today = new Date();
    const startOfWeek = new Date(today);
    startOfWeek.setDate(today.getDate() - today.getDay());
    const presets = {
      next7: { startDate: getLocalDateString(today), endDate: getLocalDateString(addDays(today, 6)) },
      today: { startDate: getLocalDateString(today), endDate: getLocalDateString(today) },
      week: { startDate: getLocalDateString(startOfWeek), endDate: getLocalDateString(addDays(startOfWeek, 6)) },
      next30: { startDate: getLocalDateString(today), endDate: getLocalDateString(addDays(today, 30)) },
      past30: { startDate: getLocalDateString(addDays(today, -30)), endDate: getLocalDateString(today) }
    };
    setFullScheduleFilters({ preset, ...presets[preset] });
  };

  const updateFullScheduleCustomDate = (field, value) => {
    setFullScheduleFilters((current) => ({ ...current, preset: 'custom', [field]: value }));
  };

  const goToScheduleTab = (key) => {
    setActiveTab(key);
    if (key === 'schedule') {
      setSearchParams({}, { replace: true });
    } else {
      setSearchParams({ tab: key }, { replace: true });
    }
  };

  const submitAvailability = async (event) => {
    event.preventDefault();
    if (!business?.id || !employee?.id) return;

    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const payload = {
        business_id: business.id,
        employee_id: employee.id,
        day_of_week: Number(availabilityForm.day_of_week),
        is_available: availabilityForm.is_available,
        all_day: availabilityForm.all_day,
        start_time: availabilityForm.all_day ? '00:00:00' : `${availabilityForm.start_time}:00`,
        end_time: availabilityForm.all_day ? '23:59:00' : `${availabilityForm.end_time}:00`,
        effective_date: availabilityForm.effective_date || null,
        expiry_date: availabilityForm.expiry_date || null,
        notes: availabilityForm.notes || null,
        requested_by: user?.id || employee.id,
        status: 'pending'
      };

      const { data, error } = await supabase
        .from('scheduling_availability')
        .insert(payload)
        .select('*')
        .single();

      if (error) throw error;

      await sendSchedulingNotification({
        businessId: business.id,
        eventKey: 'availability_submitted',
        employeeId: employee.id,
        context: {
          employeeName: employee.full_name,
          availability: data
        }
      });

      toast.success('Availability request submitted');
      setAvailabilityForm((current) => ({ ...current, notes: '' }));
      await loadSelfService({ silent: true });
    } catch (error) {
      console.error('Error submitting availability:', error);
      toast.error(error.message || 'Could not submit availability');
    } finally {
      setSaving(false);
    }
  };

  const submitTimeOff = async (event) => {
    event.preventDefault();
    if (!business?.id || !employee?.id) return;
    if (new Date(`${timeOffForm.end_date}T12:00:00`) < new Date(`${timeOffForm.start_date}T12:00:00`)) {
      toast.error('End date must be on or after start date');
      return;
    }

    setSaving(true);
    try {
      const { data: elig, error: eligErr } = await supabase.rpc('scheduling_check_time_off_eligible', {
        p_business_id: business.id,
        p_employee_id: employee.id,
        p_start_date: timeOffForm.start_date,
        p_end_date: timeOffForm.end_date,
        p_exclude_request_id: null,
      });
      if (eligErr) throw eligErr;
      if (elig && elig.ok === false) {
        setTimeOffBlockModal({
          open: true,
          title: elig.code === 'blackout'
            ? 'Date not available'
            : elig.code === 'schedule_published'
              ? 'Schedule already posted'
              : 'Too many people off',
          message: String(elig.message || 'You cannot request time off for these dates.'),
        });
        return;
      }

      const { data: { user } } = await supabase.auth.getUser();
      const totalHours = timeOffForm.is_partial_day
        ? calculateHours(timeOffForm.start_time, timeOffForm.end_time)
        : null;

      const payload = {
        business_id: business.id,
        employee_id: employee.id,
        request_type: timeOffForm.request_type,
        start_date: timeOffForm.start_date,
        end_date: timeOffForm.end_date,
        start_time: timeOffForm.is_partial_day ? `${timeOffForm.start_time}:00` : null,
        end_time: timeOffForm.is_partial_day ? `${timeOffForm.end_time}:00` : null,
        total_hours: totalHours,
        status: 'pending',
        requested_by: user?.id || employee.id,
        notes: timeOffForm.notes || null,
        is_partial_day: timeOffForm.is_partial_day
      };

      const { data, error } = await supabase
        .from('scheduling_time_off')
        .insert(payload)
        .select('*')
        .single();

      if (error) throw error;

      await sendSchedulingNotification({
        businessId: business.id,
        eventKey: 'time_off_requested',
        employeeId: employee.id,
        context: {
          requestId: data.id,
          employeeName: employee.full_name,
          requestType: data.request_type,
          startDate: data.start_date,
          endDate: data.end_date,
          startTime: data.start_time,
          endTime: data.end_time,
          totalHours: data.total_hours,
          isPartialDay: data.is_partial_day,
          status: data.status,
          notes: data.notes
        }
      });

      toast.success('Time off request submitted');
      setTimeOffForm((current) => ({ ...current, notes: '' }));
      await loadSelfService({ silent: true });
    } catch (error) {
      console.error('Error submitting time off:', error);
      toast.error(error.message || 'Could not submit time off');
    } finally {
      setSaving(false);
    }
  };

  const recordScheduleSeen = async ({ businessId, employeeId, weekStart, authUserId }) => {
    const now = new Date().toISOString();
    const { error } = await supabase
      .from('scheduling_schedule_views')
      .upsert({
        business_id: businessId,
        employee_id: employeeId,
        week_start: weekStart,
        seen_by: authUserId || employeeId,
        seen_at: now,
        updated_at: now
      }, { onConflict: 'business_id,employee_id,week_start' });

    if (error) {
      console.warn('Could not record schedule seen status:', error);
      return;
    }

    setScheduleSeenAt(now);
  };

  if (loading) {
    return (
      <div style={styles.loadingCard}>
        <RefreshCw size={18} className="spin" />
        Loading your schedule...
      </div>
    );
  }

  return (
    <div style={styles.page}>
      <section style={styles.hero}>
        <div style={styles.eyebrow}>Employee Scheduling</div>
        <h1 style={styles.title}>
          {schedulePageView === 'manager' && isOwnerOrManager ? 'Manager Schedule' : 'My Schedule'}
        </h1>
        <p style={styles.subtitle}>
          {schedulePageView === 'manager' && isOwnerOrManager
            ? 'Build the team schedule, edit shifts on the go, and publish when ready.'
            : 'View your published shifts, request availability changes, request time off, and clock in for work.'}
        </p>
      </section>

      {isOwnerOrManager && (
        <div style={styles.modeTabs}>
          <button
            type="button"
            style={{ ...styles.modeTabButton, ...(schedulePageView === 'personal' ? styles.modeTabButtonActive : {}) }}
            onClick={() => setSchedulePageView('personal')}
          >
            Personal
          </button>
          <button
            type="button"
            style={{ ...styles.modeTabButton, ...(schedulePageView === 'manager' ? styles.modeTabButtonActive : {}) }}
            onClick={() => setSchedulePageView('manager')}
          >
            Manager
          </button>
        </div>
      )}

      {schedulePageView === 'manager' && isOwnerOrManager ? (
        <PortalScheduleManager businessId={business?.id} />
      ) : (
        <>
      <div
        style={{
          ...styles.summaryGrid,
          gridTemplateColumns: isScheduleMobileLayout
            ? 'repeat(2, minmax(0, 1fr))'
            : 'repeat(auto-fit, minmax(160px, 1fr))',
        }}
      >
        <SummaryCard label="Next shift" value={nextShift ? `${formatShiftDate(nextShift.shift_date)} ${formatTime(nextShift.start_time)}` : 'None'} />
        <SummaryCard label="Scheduled hours" value={`${totalHours.toFixed(1)}h`} />
        <SummaryCard label="Schedule seen" value={scheduleSeenAt ? formatDateTime(scheduleSeenAt) : 'Recording...'} />
        <button
          type="button"
          style={styles.clockInSummaryButton}
          onClick={() => navigate(employeeAppPath('/portal/clock'))}
        >
          Clock In
        </button>
      </div>

      <div style={{ ...styles.tabs, justifyContent: isScheduleMobileLayout ? 'center' : 'flex-start' }}>
        {[
          ['schedule', 'My Schedule'],
          ['fullSchedule', 'Full Schedule'],
          ['availability', 'Availability'],
          ['timeOff', 'Time Off']
        ].map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => goToScheduleTab(key)}
            style={{ ...styles.tabButton, ...(activeTab === key ? styles.tabButtonActive : {}) }}
          >
            {label}
          </button>
        ))}
      </div>

      {activeTab === 'schedule' && (
        <section style={styles.card}>
          <SectionHeader title="Published Shifts" onRefresh={() => loadSelfService({ silent: true })} refreshing={refreshing} />
          <FilterBar filters={filters} applyPreset={applyPreset} updateCustomDate={updateCustomDate} mobileLayout={isScheduleMobileLayout} />
          {myScheduleGroups.length === 0 ? (
            <EmptyState text="No published shifts or business events in this date range." />
          ) : (
            <div style={styles.list}>
              {myScheduleGroups.map(({ date, shifts: dayShifts, events: dayEvents }) => (
                <div key={date} style={styles.dayGroup}>
                  <div style={styles.dayHeader}>{formatDayHeaderLong(date)}</div>
                  <div style={styles.fullScheduleDayBody}>
                    {dayEvents.map((ev) => (
                      <div key={ev.id} style={styles.scheduleEventCard}>
                        <div style={styles.scheduleEventBadge}>Event</div>
                        <div style={styles.scheduleEventName}>{ev.event_name || 'Event'}</div>
                        {ev.event_description ? (
                          <div style={styles.scheduleEventDesc}>{ev.event_description}</div>
                        ) : null}
                      </div>
                    ))}
                    {dayShifts.map((shift) => (
                      <div key={shift.id} style={styles.shiftCard}>
                        <div>
                          <div style={styles.shiftTime}>
                            <Clock size={16} /> {formatTime(shift.start_time)} - {formatTime(shift.end_time)}
                          </div>
                          <div style={styles.meta}>
                            <PositionLabel businessId={business?.id} value={shift.position} emptyFallback="No position" />
                            {' '}• {formatStatus(shift.status)}
                          </div>
                          {shift.notes && <div style={styles.notes}>{shift.notes}</div>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {activeTab === 'fullSchedule' && (
        <section style={styles.card}>
          <SectionHeader
            title="Full team schedule"
            onRefresh={() => loadTeamSchedule({ silent: true })}
            refreshing={loadingTeamSchedule}
            headerActions={(
              <button
                type="button"
                onClick={handlePrintFullSchedule}
                style={styles.refreshButton}
                disabled={loadingTeamSchedule || (teamShifts.length === 0 && teamScheduleEvents.length === 0)}
                title={teamShifts.length === 0 && teamScheduleEvents.length === 0 ? 'No shifts or events in this range' : 'Print full team schedule'}
              >
                <Printer size={16} /> Print
              </button>
            )}
          />
          <FullScheduleFilterBar filters={fullScheduleFilters} applyPreset={applyFullSchedulePreset} updateCustomDate={updateFullScheduleCustomDate} mobileLayout={isScheduleMobileLayout} />
          {loadingTeamSchedule && teamShifts.length === 0 ? (
            <EmptyState text="Loading..." />
          ) : fullScheduleGroups.length === 0 ? (
            <EmptyState text="No published shifts or business events in this date range." />
          ) : (
            fullScheduleGroups.map(({ date, shifts: dayShifts, events: dayEvents }) => (
              <div key={date} style={styles.dayGroup}>
                <div style={styles.dayHeader}>{formatDayHeaderLong(date)}</div>
                <div style={styles.fullScheduleDayBody}>
                  {dayEvents.map((ev) => (
                    <div key={ev.id} style={styles.scheduleEventCard}>
                      <div style={styles.scheduleEventBadge}>Event</div>
                      <div style={styles.scheduleEventName}>{ev.event_name || 'Event'}</div>
                      {ev.event_description ? (
                        <div style={styles.scheduleEventDesc}>{ev.event_description}</div>
                      ) : null}
                    </div>
                  ))}
                  {dayShifts.map((shift) => (
                    <div key={shift.id} style={styles.fullScheduleCard}>
                      <div style={styles.fsEmployeeName}>{getShiftEmployeeName(shift, teamEmployeeNameById)}</div>
                      <div style={styles.fsPosition}>
                        <PositionLabel businessId={business?.id} value={shift.position} emptyFallback="No position" />
                      </div>
                      <div style={styles.fsTimeLine}>
                        {formatTime(shift.start_time)} – {formatTime(shift.end_time)}
                      </div>
                      <div style={styles.fsLengthLine}>{formatShiftDurationLabel(shift)}</div>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </section>
      )}

      {activeTab === 'availability' && (
        <section style={styles.gridTwo}>
          <form style={styles.card} onSubmit={submitAvailability}>
            <SectionTitle title="Submit Availability" />
            <label style={styles.label}>Day</label>
            <select value={availabilityForm.day_of_week} onChange={(e) => setAvailabilityForm({ ...availabilityForm, day_of_week: e.target.value })} style={styles.input}>
              {DAYS.map((day, index) => <option key={day} value={index}>{day}</option>)}
            </select>
            <label style={styles.label}>Type</label>
            <select value={availabilityForm.is_available ? 'available' : 'unavailable'} onChange={(e) => setAvailabilityForm({ ...availabilityForm, is_available: e.target.value === 'available' })} style={styles.input}>
              <option value="available">Available</option>
              <option value="unavailable">Unavailable</option>
            </select>
            <label style={styles.checkboxLabel}>
              <input type="checkbox" checked={availabilityForm.all_day} onChange={(e) => setAvailabilityForm({ ...availabilityForm, all_day: e.target.checked })} />
              All day
            </label>
            {!availabilityForm.all_day && (
              <div style={styles.twoColumns}>
                <Field label="Start" type="time" value={availabilityForm.start_time} onChange={(value) => setAvailabilityForm({ ...availabilityForm, start_time: value })} />
                <Field label="End" type="time" value={availabilityForm.end_time} onChange={(value) => setAvailabilityForm({ ...availabilityForm, end_time: value })} />
              </div>
            )}
            <div style={styles.twoColumns}>
              <Field label="Effective" type="date" value={availabilityForm.effective_date} onChange={(value) => setAvailabilityForm({ ...availabilityForm, effective_date: value })} />
              <Field label="Expires" type="date" value={availabilityForm.expiry_date} onChange={(value) => setAvailabilityForm({ ...availabilityForm, expiry_date: value })} required={false} />
            </div>
            <label style={styles.label}>Notes</label>
            <textarea style={styles.textarea} rows={3} value={availabilityForm.notes} onChange={(e) => setAvailabilityForm({ ...availabilityForm, notes: e.target.value })} />
            <button type="submit" style={styles.primaryButton} disabled={saving}>Submit Availability</button>
          </form>
          <HistoryCard title="Availability History" items={availability} renderItem={(item) => (
            <>
              <strong>{DAYS[item.day_of_week] || 'Day'} • {item.is_available ? 'Available' : 'Unavailable'}</strong>
              <span>{formatStatus(item.status || 'pending')}</span>
              <small>{formatDateRange(item.effective_date, item.expiry_date || 'No expiry')}</small>
              {item.denial_reason && <small>Denied: {item.denial_reason}</small>}
            </>
          )} />
        </section>
      )}

      {activeTab === 'timeOff' && (
        <section style={styles.gridTwo}>
          <form style={styles.card} onSubmit={submitTimeOff}>
            <SectionTitle title="Request Time Off" />
            <label style={styles.label}>Request Type</label>
            <select value={timeOffForm.request_type} onChange={(e) => setTimeOffForm({ ...timeOffForm, request_type: e.target.value })} style={styles.input}>
              {REQUEST_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
            </select>
            <div style={styles.twoColumns}>
              <Field label="Start Date" type="date" value={timeOffForm.start_date} onChange={(value) => setTimeOffForm({ ...timeOffForm, start_date: value })} />
              <Field label="End Date" type="date" value={timeOffForm.end_date} onChange={(value) => setTimeOffForm({ ...timeOffForm, end_date: value })} />
            </div>
            <TavariCheckbox
              id="schedule-self-service-partial-day"
              checked={timeOffForm.is_partial_day}
              onChange={(checked) => setTimeOffForm({ ...timeOffForm, is_partial_day: checked })}
              label="Partial day"
              size="md"
              style={styles.tavariCheckboxRow}
              labelStyle={styles.tavariCheckboxLabelBold}
            />
            {timeOffForm.is_partial_day && (
              <div style={styles.twoColumns}>
                <Field label="Start" type="time" value={timeOffForm.start_time} onChange={(value) => setTimeOffForm({ ...timeOffForm, start_time: value })} />
                <Field label="End" type="time" value={timeOffForm.end_time} onChange={(value) => setTimeOffForm({ ...timeOffForm, end_time: value })} />
              </div>
            )}
            <label style={styles.label}>Notes</label>
            <textarea style={styles.textarea} rows={3} value={timeOffForm.notes} onChange={(e) => setTimeOffForm({ ...timeOffForm, notes: e.target.value })} />
            <button type="submit" style={styles.primaryButton} disabled={saving}>Submit Time Off</button>
          </form>
          <HistoryCard title="Time Off History" items={timeOff} renderItem={(item) => (
            <>
              <strong>{formatRequestType(item.request_type)} • {formatDateRange(item.start_date, item.end_date)}</strong>
              <span>{formatStatus(item.status || 'pending')}</span>
              {item.denial_reason && <small>Denied: {item.denial_reason}</small>}
              {item.notes && <small>{item.notes}</small>}
            </>
          )} />
        </section>
      )}

      {activeTab === 'activity' && (
        <section style={styles.card}>
          <SectionTitle title="Scheduling Activity" />
          {activityItems.length === 0 ? (
            <EmptyState text="No scheduling activity yet." />
          ) : (
            <div style={styles.list}>
              {activityItems.map((item) => (
                <div key={item.id} style={styles.activityItem}>
                  <div>
                    <strong>{item.title}</strong>
                    <div style={styles.meta}>{item.description}</div>
                  </div>
                  <span style={styles.statusPill}>{formatStatus(item.status)}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

        </>
      )}

      {timeOffBlockModal.open ? (
        <div
          style={styles.timeOffBlockOverlay}
          role="dialog"
          aria-modal="true"
          aria-labelledby="portal-time-off-block-title"
        >
          <div style={styles.timeOffBlockCard}>
            <h2 id="portal-time-off-block-title" style={styles.timeOffBlockTitle}>
              {timeOffBlockModal.title}
            </h2>
            <p style={styles.timeOffBlockMessage}>{timeOffBlockModal.message}</p>
            <button
              type="button"
              style={styles.primaryButton}
              onClick={() => setTimeOffBlockModal({ open: false, title: '', message: '' })}
            >
              OK
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
};

const SummaryCard = ({ label, value }) => (
  <div style={styles.summaryCard}>
    <div style={styles.labelMuted}>{label}</div>
    <div style={styles.summaryValue}>{value}</div>
  </div>
);

const SectionTitle = ({ title }) => <h2 style={styles.sectionTitle}>{title}</h2>;

const SectionHeader = ({ title, onRefresh, refreshing, headerActions }) => (
  <div style={styles.sectionHeader}>
    <SectionTitle title={title} />
    <div style={styles.sectionHeaderActions}>
      {headerActions}
      <button type="button" onClick={onRefresh} style={styles.refreshButton} disabled={refreshing}>
        <RefreshCw size={16} /> {refreshing ? 'Refreshing...' : 'Refresh'}
      </button>
    </div>
  </div>
);

const fullSchedulePresetLabel = (preset) => {
  if (preset === 'next7') return 'Next 7 days';
  if (preset === 'next30') return 'Next 30';
  if (preset === 'past30') return 'Past 30';
  return preset;
};

/** Shorter preset labels so five pills fit one row on narrow screens */
const fullSchedulePresetLabelCompact = (preset) => {
  const map = {
    next7: '7 days',
    today: 'Today',
    week: 'Week',
    next30: 'Next 30',
    past30: 'Past 30'
  };
  return map[preset] || fullSchedulePresetLabel(preset);
};

const FullScheduleFilterBar = ({ filters, applyPreset, updateCustomDate, mobileLayout }) => {
  const presets = ['next7', 'today', 'week', 'next30', 'past30'];
  const dateSelectStyle = mobileLayout ? styles.dateInputMobile : styles.dateInput;

  if (mobileLayout) {
    return (
      <div style={styles.filtersMobileStack}>
        <div style={styles.filtersPresetStripMobile}>
          {presets.map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => applyPreset(preset)}
              style={{
                ...styles.filterButton,
                ...(filters.preset === preset ? styles.filterButtonActive : {}),
                ...styles.filterButtonMobileGrow
              }}
            >
              {fullSchedulePresetLabelCompact(preset)}
            </button>
          ))}
        </div>
        <DateDropdownInput
          idPrefix="portal-ss-full-start"
          value={filters.startDate}
          onChange={(v) => updateCustomDate('startDate', v)}
          max={filters.endDate || undefined}
          style={styles.filtersDateRowMobile}
          selectStyle={dateSelectStyle}
        />
        <DateDropdownInput
          idPrefix="portal-ss-full-end"
          value={filters.endDate}
          onChange={(v) => updateCustomDate('endDate', v)}
          min={filters.startDate || undefined}
          style={styles.filtersDateRowMobile}
          selectStyle={dateSelectStyle}
        />
      </div>
    );
  }

  return (
    <div style={styles.filters}>
      {presets.map((preset) => (
        <button key={preset} type="button" onClick={() => applyPreset(preset)} style={{ ...styles.filterButton, ...(filters.preset === preset ? styles.filterButtonActive : {}) }}>
          {fullSchedulePresetLabel(preset)}
        </button>
      ))}
      <DateDropdownInput
        idPrefix="portal-ss-full-start"
        value={filters.startDate}
        onChange={(v) => updateCustomDate('startDate', v)}
        max={filters.endDate || undefined}
        selectStyle={styles.dateInput}
      />
      <DateDropdownInput
        idPrefix="portal-ss-full-end"
        value={filters.endDate}
        onChange={(v) => updateCustomDate('endDate', v)}
        min={filters.startDate || undefined}
        selectStyle={styles.dateInput}
      />
    </div>
  );
};

const FilterBar = ({ filters, applyPreset, updateCustomDate, mobileLayout }) => {
  const presets = ['today', 'week', 'next30', 'past30'];
  const presetLabel = (preset) => (preset === 'next30' ? 'Next 30' : preset === 'past30' ? 'Past 30' : preset);
  const dateSelectStyle = mobileLayout ? styles.dateInputMobile : styles.dateInput;

  if (mobileLayout) {
    return (
      <div style={styles.filtersMobileStack}>
        <div style={styles.filtersPresetStripMobile}>
          {presets.map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => applyPreset(preset)}
              style={{
                ...styles.filterButton,
                ...(filters.preset === preset ? styles.filterButtonActive : {}),
                ...styles.filterButtonMobileGrow
              }}
            >
              {presetLabel(preset)}
            </button>
          ))}
        </div>
        <DateDropdownInput
          idPrefix="portal-ss-filter-start"
          value={filters.startDate}
          onChange={(v) => updateCustomDate('startDate', v)}
          max={filters.endDate || undefined}
          style={styles.filtersDateRowMobile}
          selectStyle={dateSelectStyle}
        />
        <DateDropdownInput
          idPrefix="portal-ss-filter-end"
          value={filters.endDate}
          onChange={(v) => updateCustomDate('endDate', v)}
          min={filters.startDate || undefined}
          style={styles.filtersDateRowMobile}
          selectStyle={dateSelectStyle}
        />
      </div>
    );
  }

  return (
    <div style={styles.filters}>
      {presets.map((preset) => (
        <button key={preset} type="button" onClick={() => applyPreset(preset)} style={{ ...styles.filterButton, ...(filters.preset === preset ? styles.filterButtonActive : {}) }}>
          {presetLabel(preset)}
        </button>
      ))}
      <DateDropdownInput
        idPrefix="portal-ss-filter-start"
        value={filters.startDate}
        onChange={(v) => updateCustomDate('startDate', v)}
        max={filters.endDate || undefined}
        selectStyle={styles.dateInput}
      />
      <DateDropdownInput
        idPrefix="portal-ss-filter-end"
        value={filters.endDate}
        onChange={(v) => updateCustomDate('endDate', v)}
        min={filters.startDate || undefined}
        selectStyle={styles.dateInput}
      />
    </div>
  );
};

const Field = ({ label, type, value, onChange, required: req = true, min, max }) => (
  <div>
    <label style={styles.label}>{label}</label>
    {type === 'date' ? (
      <DateDropdownInput
        idPrefix={`portal-ss-${label.replace(/\s+/g, '-').toLowerCase()}`}
        value={value}
        onChange={onChange}
        required={req}
        min={min}
        max={max}
        selectStyle={{ ...styles.input, flex: 1, minWidth: 0 }}
      />
    ) : (
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} style={styles.input} required={req} />
    )}
  </div>
);

const HistoryCard = ({ title, items, renderItem }) => (
  <section style={styles.card}>
    <SectionTitle title={title} />
    {items.length === 0 ? (
      <EmptyState text="No requests yet." />
    ) : (
      <div style={styles.list}>
        {items.map((item) => (
          <div key={item.id} style={styles.historyItem}>
            {renderItem(item)}
          </div>
        ))}
      </div>
    )}
  </section>
);

const EmptyState = ({ text }) => <div style={styles.empty}>{text}</div>;

const formatTime = (timeString) => {
  if (!timeString) return 'TBD';
  const [hours, minutes] = timeString.split(':').map(Number);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return timeString;
  const date = new Date();
  date.setHours(hours, minutes, 0, 0);
  return date.toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' });
};

const formatShiftDate = (dateString) => {
  if (!dateString) return 'Date TBD';
  const date = new Date(`${dateString}T12:00:00`);
  return date.toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric' });
};

const calculateHours = (startTime, endTime) => {
  if (!startTime || !endTime) return null;
  const [startHour, startMinute] = startTime.split(':').map(Number);
  const [endHour, endMinute] = endTime.split(':').map(Number);
  if ([startHour, startMinute, endHour, endMinute].some(Number.isNaN)) return null;
  let start = startHour * 60 + startMinute;
  let end = endHour * 60 + endMinute;
  if (end < start) end += 24 * 60;
  return (end - start) / 60;
};

const formatDayHeaderLong = (dateString) => {
  if (!dateString) return '';
  const date = new Date(`${dateString}T12:00:00`);
  return date.toLocaleDateString('en-CA', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
};

const formatShiftDurationLabel = (shift) => {
  const h = calculateHours(shift.start_time, shift.end_time);
  if (h == null) return '—';
  const rounded = Math.round(h * 10) / 10;
  return `${rounded % 1 === 0 ? rounded.toFixed(0) : rounded.toFixed(1)} hours`;
};

const formatDateRange = (start, end) => {
  if (!start) return 'No date';
  if (!end || end === 'No expiry') return `${start} - No expiry`;
  return start === end ? start : `${start} - ${end}`;
};

const formatDateTime = (value) => {
  if (!value) return '';
  return new Date(value).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  });
};

const formatStatus = (value) => String(value || 'pending').replace(/_/g, ' ');
const formatRequestType = (value) => REQUEST_TYPES.find((type) => type.value === value)?.label || formatStatus(value);

const styles = {
  page: { display: 'flex', flexDirection: 'column', gap: TavariStyles.spacing.lg, width: '100%', overflowX: 'hidden' },
  modeTabs: {
    display: 'flex',
    gap: '8px',
    backgroundColor: TavariStyles.colors.gray100,
    padding: '6px',
    borderRadius: '14px',
  },
  modeTabButton: {
    flex: 1,
    border: 'none',
    borderRadius: '10px',
    padding: '10px 14px',
    backgroundColor: 'transparent',
    color: TavariStyles.colors.gray600,
    fontWeight: TavariStyles.typography.fontWeight.bold,
    cursor: 'pointer',
  },
  modeTabButtonActive: {
    backgroundColor: TavariStyles.colors.white,
    color: TavariStyles.colors.primary,
    boxShadow: TavariStyles.shadows?.sm || '0 1px 3px rgba(0,0,0,0.1)',
  },
  hero: { background: `linear-gradient(135deg, ${TavariStyles.colors.primary}, #0f766e)`, color: '#fff', borderRadius: '24px', padding: TavariStyles.spacing.xl },
  eyebrow: { fontSize: TavariStyles.typography.fontSize.sm, opacity: 0.85, marginBottom: TavariStyles.spacing.xs },
  title: { fontSize: TavariStyles.typography.fontSize['2xl'], fontWeight: TavariStyles.typography.fontWeight.bold, margin: 0 },
  subtitle: { marginTop: TavariStyles.spacing.sm, opacity: 0.9 },
  summaryGrid: {
    display: 'grid',
    gap: TavariStyles.spacing.md,
    alignItems: 'stretch',
    /** Columns overridden inline for mobile 2×2 vs desktop auto-fit */
    gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
  },
  clockInSummaryButton: {
    border: 'none',
    borderRadius: '18px',
    backgroundColor: TavariStyles.colors.primary,
    color: TavariStyles.colors.white,
    fontWeight: 800,
    fontSize: '18px',
    letterSpacing: '0.02em',
    padding: `${TavariStyles.spacing.md} ${TavariStyles.spacing.lg}`,
    cursor: 'pointer',
    minHeight: '88px',
    boxShadow: '0 4px 14px rgba(0, 128, 128, 0.35)',
    transition: 'transform 0.12s ease, box-shadow 0.12s ease',
  },
  summaryCard: { backgroundColor: '#fff', border: '1px solid #e5e7eb', borderRadius: '18px', padding: TavariStyles.spacing.lg },
  labelMuted: { color: '#6b7280', fontSize: '13px', marginBottom: '6px' },
  summaryValue: { color: '#111827', fontSize: '20px', fontWeight: 800 },
  tabs: { display: 'flex', flexWrap: 'wrap', gap: '8px', backgroundColor: '#f3f4f6', padding: '6px', borderRadius: '14px' },
  tabButton: { border: 'none', borderRadius: '10px', padding: '10px 14px', backgroundColor: 'transparent', color: '#4b5563', fontWeight: 700, cursor: 'pointer' },
  tabButtonActive: { backgroundColor: '#fff', color: TavariStyles.colors.primary, boxShadow: '0 1px 4px rgba(0,0,0,0.12)' },
  card: { backgroundColor: '#fff', border: '1px solid #e5e7eb', borderRadius: '18px', padding: TavariStyles.spacing.lg },
  gridTwo: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: TavariStyles.spacing.lg },
  sectionHeader: { display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'center', marginBottom: TavariStyles.spacing.md },
  sectionHeaderActions: { display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0, flexWrap: 'wrap' },
  sectionTitle: { margin: '0 0 14px', color: '#111827', fontSize: '20px' },
  refreshButton: { display: 'inline-flex', alignItems: 'center', gap: '6px', border: '1px solid #d1d5db', borderRadius: '10px', backgroundColor: '#fff', padding: '9px 12px', cursor: 'pointer' },
  filters: { display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: TavariStyles.spacing.md },
  /** Full-width stacked filters on narrow viewports (see FilterBar / FullScheduleFilterBar mobileLayout) */
  filtersMobileStack: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    width: '100%',
    maxWidth: '100%',
    marginBottom: TavariStyles.spacing.md,
    boxSizing: 'border-box',
  },
  filtersPresetStripMobile: {
    display: 'flex',
    flexDirection: 'row',
    gap: '6px',
    width: '100%',
    boxSizing: 'border-box',
  },
  filterButtonMobileGrow: {
    flex: '1 1 0',
    minWidth: 0,
    fontSize: '11px',
    padding: '10px 4px',
    textAlign: 'center',
  },
  filtersDateRowMobile: {
    width: '100%',
    maxWidth: '100%',
    boxSizing: 'border-box',
  },
  dateInputMobile: {
    border: '1px solid #d1d5db',
    borderRadius: '10px',
    padding: '8px 6px',
    fontSize: '13px',
  },
  filterButton: { border: '1px solid #d1d5db', backgroundColor: '#fff', borderRadius: '999px', padding: '8px 12px', cursor: 'pointer', textTransform: 'capitalize' },
  filterButtonActive: { backgroundColor: TavariStyles.colors.primary, borderColor: TavariStyles.colors.primary, color: '#fff' },
  dateInput: { border: '1px solid #d1d5db', borderRadius: '10px', padding: '8px 10px' },
  list: { display: 'flex', flexDirection: 'column', gap: '12px' },
  shiftCard: { display: 'flex', justifyContent: 'space-between', gap: '14px', alignItems: 'center', border: '1px solid #e5e7eb', borderRadius: '14px', padding: '14px' },
  shiftDate: { fontWeight: 800, color: '#111827', marginBottom: '4px' },
  shiftTime: { display: 'flex', gap: '6px', alignItems: 'center', color: '#374151', marginBottom: '4px' },
  meta: { color: '#6b7280', fontSize: '13px' },
  notes: { marginTop: '8px', color: '#4b5563', fontSize: '13px' },
  label: { display: 'block', color: '#374151', fontWeight: 700, fontSize: '14px', marginBottom: '6px' },
  input: { width: '100%', boxSizing: 'border-box', border: '1px solid #d1d5db', borderRadius: '10px', padding: '10px 12px', marginBottom: '12px' },
  textarea: { width: '100%', boxSizing: 'border-box', border: '1px solid #d1d5db', borderRadius: '10px', padding: '10px 12px', marginBottom: '12px', fontFamily: 'inherit' },
  twoColumns: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '12px' },
  checkboxLabel: { display: 'flex', gap: '8px', alignItems: 'center', margin: '0 0 12px', color: '#374151', fontWeight: 700 },
  tavariCheckboxRow: { margin: '0 0 12px', alignItems: 'center' },
  tavariCheckboxLabelBold: { fontWeight: 800, color: '#374151' },
  primaryButton: { backgroundColor: TavariStyles.colors.primary, color: '#fff', border: 'none', borderRadius: '10px', padding: '11px 14px', fontWeight: 800, cursor: 'pointer' },
  historyItem: { display: 'flex', flexDirection: 'column', gap: '4px', border: '1px solid #e5e7eb', borderRadius: '12px', padding: '12px' },
  empty: { color: '#6b7280', padding: '16px', backgroundColor: '#f9fafb', borderRadius: '12px', textAlign: 'center' },
  bodyText: { color: '#4b5563', lineHeight: 1.6 },
  activityItem: { display: 'flex', justifyContent: 'space-between', gap: '12px', border: '1px solid #e5e7eb', borderRadius: '12px', padding: '12px' },
  statusPill: { borderRadius: '999px', backgroundColor: '#eef2ff', color: TavariStyles.colors.primary, padding: '5px 9px', fontSize: '13px', fontWeight: 800, height: 'fit-content' },
  loadingCard: { display: 'flex', alignItems: 'center', gap: '8px', color: '#4b5563', backgroundColor: '#fff', border: '1px solid #e5e7eb', borderRadius: '16px', padding: '20px' },
  dayGroup: {
    marginBottom: TavariStyles.spacing.xl,
    borderRadius: '16px',
    border: `1px solid ${TavariStyles.colors.gray200}`,
    overflow: 'hidden',
    backgroundColor: TavariStyles.colors.white,
    boxShadow: '0 1px 3px rgba(0, 0, 0, 0.06)',
  },
  dayHeader: {
    fontWeight: 800,
    fontSize: '15px',
    letterSpacing: '-0.01em',
    lineHeight: 1.35,
    color: TavariStyles.colors.gray900,
    padding: '14px 16px 14px 14px',
    margin: 0,
    borderBottom: `1px solid ${TavariStyles.colors.gray200}`,
    borderLeft: `5px solid ${TavariStyles.colors.primary}`,
    background: `linear-gradient(100deg, rgba(0, 128, 128, 0.14) 0%, rgba(0, 128, 128, 0.06) 42%, ${TavariStyles.colors.gray50} 100%)`,
  },
  fullScheduleDayBody: {
    padding: TavariStyles.spacing.md,
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    backgroundColor: TavariStyles.colors.gray50,
  },
  fullScheduleCard: { display: 'flex', flexDirection: 'column', gap: '6px', border: '1px solid #e5e7eb', borderRadius: '14px', padding: '14px' },
  fsEmployeeName: { fontWeight: 800, color: '#111827', fontSize: '16px' },
  fsPosition: { color: '#4b5563', fontSize: '14px' },
  fsTimeLine: { color: '#374151', fontSize: '14px' },
  fsLengthLine: { color: '#6b7280', fontSize: '13px' },
  scheduleEventCard: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    border: '1px solid #bfdbfe',
    borderRadius: '14px',
    padding: '14px',
    backgroundColor: '#eff6ff',
    borderLeft: '4px solid #2563eb',
  },
  scheduleEventBadge: {
    alignSelf: 'flex-start',
    fontSize: '11px',
    fontWeight: 800,
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
    color: '#1d4ed8',
    backgroundColor: '#dbeafe',
    borderRadius: '999px',
    padding: '4px 10px',
  },
  scheduleEventName: { fontWeight: 800, color: '#0f172a', fontSize: '16px' },
  scheduleEventDesc: { color: '#334155', fontSize: '14px', lineHeight: 1.45 },
  timeOffBlockOverlay: {
    position: 'fixed',
    inset: 0,
    zIndex: 10050,
    backgroundColor: 'rgba(15, 23, 42, 0.55)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '20px',
    boxSizing: 'border-box',
  },
  timeOffBlockCard: {
    backgroundColor: '#fff',
    borderRadius: '16px',
    padding: '22px',
    maxWidth: '420px',
    width: '100%',
    boxShadow: '0 20px 50px rgba(0,0,0,0.2)',
    boxSizing: 'border-box',
  },
  timeOffBlockTitle: { margin: '0 0 12px', color: '#111827', fontSize: '20px', fontWeight: 800 },
  timeOffBlockMessage: { margin: '0 0 18px', color: '#374151', lineHeight: 1.5, fontSize: '15px' },
};

export default PortalScheduleSelfService;
