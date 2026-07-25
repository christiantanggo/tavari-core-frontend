// src/components/Scheduling/SchedulesTab.jsx
// SINGLE 8-COLUMN GRID - SIMPLE AND ALIGNED
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Plus, Search, Filter, Send, GripVertical, Trash2, AlertTriangle, Eye, EyeOff } from 'lucide-react';
import { supabase } from '../../supabaseClient';
import { TavariStyles } from '../../utils/TavariStyles';
import { sendSchedulingNotification } from '../../helpers/Scheduling/schedulingNotificationService';
import { resolveShiftLeadForDay } from '../../helpers/Scheduling/shiftLeadResolution';
import PositionSelectWithNew from '../HR/PositionSelectWithNew';
import TavariCheckbox from '../UI/TavariCheckbox';
import { formatPositionDisplay, positionRowsToNameSet } from '../../utils/positionCatalog';
import { isSchedulingVisibleForWeek } from '../../utils/businessEmploymentStatus';
import toast from 'react-hot-toast';
import dayjs from 'dayjs';
import weekOfYear from 'dayjs/plugin/weekOfYear';

dayjs.extend(weekOfYear);

const TIME_OFF_TYPE_LABELS = {
  vacation: 'Vacation',
  sick: 'Sick',
  personal: 'Personal',
  bereavement: 'Bereavement',
  jury_duty: 'Jury Duty',
  other: 'Other'
};

const getScheduleWeekStart = (date = dayjs()) => {
  const day = dayjs(date);
  return day.startOf('day').subtract(day.day(), 'day');
};

const SchedulesTab = ({ businessId, readOnly = false, hideEmployeeHoursCap = false, supabaseClient, useKioskScheduleRpc = false }) => {
  const sb = supabaseClient ?? supabase;
  const [loading, setLoading] = useState(true);
  const [currentWeek, setCurrentWeek] = useState(getScheduleWeekStart());
  const [employees, setEmployees] = useState([]);
  const [shifts, setShifts] = useState([]);
  const [availability, setAvailability] = useState([]);
  const [timeOffRequests, setTimeOffRequests] = useState([]);
  const [savingAvailabilityId, setSavingAvailabilityId] = useState(null);
  const [savingTimeOffId, setSavingTimeOffId] = useState(null);
  const [scheduleViews, setScheduleViews] = useState([]);
  const [schedulingSettings, setSchedulingSettings] = useState(null);
  const [businessHours, setBusinessHours] = useState(null);
  const [holidayHours, setHolidayHours] = useState([]);
  const [events, setEvents] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [showShiftModal, setShowShiftModal] = useState(false);
  const [shiftModalVariant, setShiftModalVariant] = useState('grid');
  const [savingShift, setSavingShift] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showEventModal, setShowEventModal] = useState(false);
  const [selectedDate, setSelectedDate] = useState(null);
  const [selectedEmployee, setSelectedEmployee] = useState(null);
  const [editingShift, setEditingShift] = useState(null);
  const [draggedEmployee, setDraggedEmployee] = useState(null);
  const [draggedShiftId, setDraggedShiftId] = useState(null);
  const [availablePositions, setAvailablePositions] = useState([]);
  const [kioskScheduleError, setKioskScheduleError] = useState(null);

  const weekDays = Array.from({ length: 7 }, (_, i) => currentWeek.clone().add(i, 'days'));

  const loadEmployees = async () => {
    if (!businessId) return;
    try {
      const baseSelect = 'user_id, role, employment_status, termination_date, employee_order, users!business_users_user_id_fkey(id, full_name, employment_status, wage, position, hire_date, lieu_time_enabled, lieu_time_balance, max_paid_hours_per_period)';

      let businessUsers = [];
      let error;

      ({ data: businessUsers, error } = await sb
        .from('business_users')
        .select(baseSelect)
        .eq('business_id', businessId));

      if (error) {
        console.warn('Primary employee load failed, retrying with limited columns:', error?.message);
        ({ data: businessUsers, error } = await sb
          .from('business_users')
          .select('user_id, role, employment_status, termination_date, employee_order, users!business_users_user_id_fkey(id, full_name, employment_status, wage, position, hire_date)')
          .eq('business_id', businessId));
        if (error) throw error;
      }

      const employeeMap = new Map();

      (businessUsers || [])
        .filter((bu) => bu.users && isSchedulingVisibleForWeek({
          membership: bu,
          user: bu.users,
          role: bu.role,
        }))
        .forEach(bu => {
          employeeMap.set(bu.users.id, {
            id: bu.users.id,
            full_name: bu.users.full_name,
            wage: bu.users.wage || 0,
            position: bu.users.position,
            order: Number.isInteger(bu.employee_order) ? bu.employee_order : null,
            maxHours: bu.users.max_paid_hours_per_period ?? null,
            hireDate: bu.users.hire_date || null,
            lieuTimeEnabled: bu.users.lieu_time_enabled || false,
            lieuTimeBalance: bu.users.lieu_time_balance ?? 0
          });
        });

      const activeEmployees = Array.from(employeeMap.values())
        .sort((a, b) => {
          const hasOrderA = a.order !== null;
          const hasOrderB = b.order !== null;
          if (hasOrderA || hasOrderB) {
            const orderA = hasOrderA ? a.order : Number.MAX_SAFE_INTEGER;
            const orderB = hasOrderB ? b.order : Number.MAX_SAFE_INTEGER;
            if (orderA !== orderB) return orderA - orderB;
          }

          if (a.hireDate && b.hireDate) {
            const diff = new Date(a.hireDate).getTime() - new Date(b.hireDate).getTime();
            if (diff !== 0) return diff;
          } else if (a.hireDate && !b.hireDate) {
            return -1;
          } else if (!a.hireDate && b.hireDate) {
            return 1;
          }

          return a.full_name.localeCompare(b.full_name);
        });

      setEmployees(activeEmployees);
    } catch (error) {
      console.error('Error loading employees:', error);
      toast.error('Failed to load employees');
    }
  };

  const loadShifts = async () => {
    if (!businessId) return;
    try {
      const weekStart = currentWeek.format('YYYY-MM-DD');
      const weekEnd = currentWeek.clone().add(6, 'days').format('YYYY-MM-DD');
      const { data, error } = await sb
        .from('scheduling_shifts')
        .select('*')
        .eq('business_id', businessId)
        .gte('shift_date', weekStart)
        .lte('shift_date', weekEnd);

      if (error) throw error;
      setShifts(data || []);
    } catch (error) {
      console.error('Error loading shifts:', error);
    }
  };

  const loadBusinessHours = async () => {
    if (!businessId) return;
    try {
      const { data, error } = await sb
        .from('businesses')
        .select('operating_hours, holiday_hours')
        .eq('id', businessId)
        .single();

      if (error) throw error;
      setBusinessHours(data?.operating_hours || null);
      setHolidayHours(data?.holiday_hours || []);
    } catch (error) {
      console.error('Error loading business hours:', error);
    }
  };

  const loadEvents = async () => {
    if (!businessId) return;
    try {
      const weekStart = currentWeek.format('YYYY-MM-DD');
      const weekEnd = currentWeek.clone().add(6, 'days').format('YYYY-MM-DD');
      const { data, error } = await sb
        .from('scheduling_events')
        .select('*')
        .eq('business_id', businessId)
        .gte('event_date', weekStart)
        .lte('event_date', weekEnd);

      if (error) throw error;
      setEvents(data || []);
    } catch (error) {
      console.error('Error loading events:', error);
    }
  };

  const loadAvailability = async () => {
    if (!businessId) return;
    try {
      const { data, error } = await sb
        .from('scheduling_availability')
        .select('*')
        .eq('business_id', businessId)
        .or('status.eq.pending,status.eq.approved,status.is.null');

      if (error) throw error;
      setAvailability(data || []);
    } catch (error) {
      console.error('Error loading availability:', error);
    }
  };

  /** Employee portal stores time off in scheduling_time_off — load all statuses for the visible week. */
  const loadTimeOff = async () => {
    if (!businessId) return;
    try {
      const weekStart = currentWeek.format('YYYY-MM-DD');
      const weekEnd = currentWeek.clone().add(6, 'days').format('YYYY-MM-DD');
      const { data, error } = await sb
        .from('scheduling_time_off')
        .select('*')
        .eq('business_id', businessId)
        .lte('start_date', weekEnd)
        .gte('end_date', weekStart);

      if (error) throw error;
      setTimeOffRequests(data || []);
    } catch (error) {
      console.error('Error loading time off requests:', error);
    }
  };

  const handleAvailabilityDecision = async (availabilityItem, decision) => {
    if (readOnly) return;
    const denialReason = decision === 'denied'
      ? window.prompt('Reason for denial? This will be included with the request.', availabilityItem.denial_reason || '')
      : '';

    if (decision === 'denied' && denialReason === null) return;

    setSavingAvailabilityId(availabilityItem.id);
    try {
      const { data: { user } } = await sb.auth.getUser();
      const payload = decision === 'approved'
        ? {
            status: 'approved',
            approved_by: user?.id || null,
            approved_at: new Date().toISOString(),
            denied_by: null,
            denied_at: null,
            denial_reason: null,
            updated_at: new Date().toISOString()
          }
        : {
            status: 'denied',
            denied_by: user?.id || null,
            denied_at: new Date().toISOString(),
            approved_by: null,
            approved_at: null,
            denial_reason: denialReason || null,
            updated_at: new Date().toISOString()
          };

      const { data: updatedAvailability, error } = await sb
        .from('scheduling_availability')
        .update(payload)
        .eq('id', availabilityItem.id)
        .select('id, employee_id, day_of_week, is_available, start_time, end_time, all_day, effective_date, expiry_date, status, denial_reason')
        .maybeSingle();

      if (error) throw error;

      await sendSchedulingNotification({
        businessId,
        eventKey: decision === 'approved' ? 'availability_approved' : 'availability_denied',
        employeeId: availabilityItem.employee_id,
        context: {
          availability: updatedAvailability,
          denialReason: updatedAvailability?.denial_reason
        }
      });

      toast.success(`Availability ${decision}`);
      await loadAvailability();
    } catch (error) {
      console.error('Error updating availability status:', error);
      toast.error(`Failed to ${decision} availability`);
    } finally {
      setSavingAvailabilityId(null);
    }
  };

  const handleTimeOffDecision = async (request, decision) => {
    if (readOnly) return;
    const denialReason = decision === 'denied'
      ? window.prompt('Reason for denial? This will be visible in the request.', request.denial_reason || '')
      : '';

    if (decision === 'denied' && denialReason === null) return;

    setSavingTimeOffId(request.id);
    try {
      const { data: { user } } = await sb.auth.getUser();
      const updatePayload = decision === 'approved'
        ? {
            status: 'approved',
            approved_by: user?.id || null,
            approved_at: new Date().toISOString(),
            denied_by: null,
            denied_at: null,
            denial_reason: null,
            updated_at: new Date().toISOString()
          }
        : {
            status: 'denied',
            denied_by: user?.id || null,
            denied_at: new Date().toISOString(),
            approved_by: null,
            approved_at: null,
            denial_reason: denialReason || null,
            updated_at: new Date().toISOString()
          };

      const { data: updatedRequest, error } = await sb
        .from('scheduling_time_off')
        .update(updatePayload)
        .eq('id', request.id)
        .select('*')
        .single();

      if (error) throw error;

      const employeeRow = employees.find((e) => e.id === request.employee_id);
      await sendSchedulingNotification({
        businessId,
        eventKey: decision === 'approved' ? 'time_off_approved' : 'time_off_denied',
        employeeId: request.employee_id,
        context: {
          requestId: updatedRequest?.id ?? request.id,
          employeeName: employeeRow?.full_name,
          requestType: updatedRequest?.request_type,
          startDate: updatedRequest?.start_date,
          endDate: updatedRequest?.end_date,
          startTime: updatedRequest?.start_time,
          endTime: updatedRequest?.end_time,
          totalHours: updatedRequest?.total_hours,
          isPartialDay: updatedRequest?.is_partial_day,
          status: updatedRequest?.status,
          notes: updatedRequest?.notes,
          denialReason: updatedRequest?.denial_reason
        }
      });

      toast.success(`Time off ${decision}`);
      await loadTimeOff();
    } catch (error) {
      console.error('Error updating time off request:', error);
      toast.error(error.message || `Failed to ${decision} time off`);
    } finally {
      setSavingTimeOffId(null);
    }
  };

  const loadScheduleViews = async () => {
    if (!businessId) return;
    try {
      const { data, error } = await sb
        .from('scheduling_schedule_views')
        .select('employee_id, seen_at, week_start')
        .eq('business_id', businessId)
        .eq('week_start', currentWeek.format('YYYY-MM-DD'));

      if (error) throw error;
      setScheduleViews(data || []);
    } catch (error) {
      console.error('Error loading schedule seen statuses:', error);
      setScheduleViews([]);
    }
  };

  const loadSchedulingSettings = async () => {
    if (!businessId) return;
    try {
      const { data, error } = await sb
        .from('scheduling_settings')
        .select('*')
        .eq('business_id', businessId)
        .maybeSingle();

      if (error && error.code !== 'PGRST116') throw error;
      if (data) {
        setSchedulingSettings(data);
      } else {
        setSchedulingSettings(null);
      }
    } catch (error) {
      console.error('Error loading scheduling settings:', error);
    }
  };

  const loadPositions = async () => {
    if (!businessId) return;
    try {
      const { data, error } = await sb
        .from('positions')
        .select('*')
        .eq('business_id', businessId)
        .eq('is_active', true)
        .order('position_name', { ascending: true });
      
      if (error) throw error;
      const raw = data || [];
      setAvailablePositions(
        [...raw].sort((a, b) => {
          const hasA = a.display_order != null && a.display_order !== '';
          const hasB = b.display_order != null && b.display_order !== '';
          const na = hasA ? Number(a.display_order) : null;
          const nb = hasB ? Number(b.display_order) : null;
          if (na != null && !Number.isNaN(na) && nb != null && !Number.isNaN(nb) && na !== nb) return na - nb;
          if (na != null && !Number.isNaN(na) && (nb == null || Number.isNaN(nb))) return -1;
          if ((na == null || Number.isNaN(na)) && nb != null && !Number.isNaN(nb)) return 1;
          return (a.position_name || '').localeCompare(b.position_name || '', undefined, { sensitivity: 'base' });
        })
      );
    } catch (error) {
      console.error('Error loading positions:', error);
    }
  };

  const sortPositionRows = (raw) => (
    [...(raw || [])].sort((a, b) => {
      const hasA = a.display_order != null && a.display_order !== '';
      const hasB = b.display_order != null && b.display_order !== '';
      const na = hasA ? Number(a.display_order) : null;
      const nb = hasB ? Number(b.display_order) : null;
      if (na != null && !Number.isNaN(na) && nb != null && !Number.isNaN(nb) && na !== nb) return na - nb;
      if (na != null && !Number.isNaN(na) && (nb == null || Number.isNaN(nb))) return -1;
      if ((na == null || Number.isNaN(na)) && nb != null && !Number.isNaN(nb)) return 1;
      return (a.position_name || '').localeCompare(b.position_name || '', undefined, { sensitivity: 'base' });
    })
  );

  const loadKioskWeekSchedule = async () => {
    if (!businessId) return;
    setKioskScheduleError(null);
    try {
      const weekStart = currentWeek.format('YYYY-MM-DD');
      const { data, error } = await sb.rpc('time_clock_kiosk_fetch_team_schedule', {
        p_business_id: businessId,
        p_week_start: weekStart,
      });

      if (error) throw error;
      if (data?.error) {
        throw new Error(String(data.error));
      }

      setEmployees(Array.isArray(data?.employees) ? data.employees : []);
      setShifts(Array.isArray(data?.shifts) ? data.shifts : []);
      setEvents(Array.isArray(data?.events) ? data.events : []);
      setBusinessHours(data?.operating_hours || null);
      setHolidayHours(Array.isArray(data?.holiday_hours) ? data.holiday_hours : []);
      setAvailablePositions(sortPositionRows(data?.positions));
      setSchedulingSettings(
        data?.scheduling_settings && data.scheduling_settings !== null
          ? data.scheduling_settings
          : null
      );
      setAvailability([]);
      setTimeOffRequests([]);
      setScheduleViews([]);
    } catch (error) {
      console.error('Error loading kiosk week schedule:', error);
      setKioskScheduleError('Could not load the schedule for this kiosk. Try again or contact your manager.');
      toast.error('Failed to load team schedule');
    }
  };

  useEffect(() => {
    setLoading(true);
    if (useKioskScheduleRpc) {
      loadKioskWeekSchedule().finally(() => setLoading(false));
      return;
    }
    Promise.all([
      loadEmployees(),
      loadShifts(),
      loadBusinessHours(),
      loadEvents(),
      loadPositions(),
      loadAvailability(),
      loadTimeOff(),
      loadScheduleViews(),
      loadSchedulingSettings()
    ])
      .finally(() => setLoading(false));
  }, [businessId, currentWeek, useKioskScheduleRpc]);

  const navigateWeek = (direction) => setCurrentWeek(getScheduleWeekStart(currentWeek.clone().add(direction, 'week')));

  const filteredEmployees = employees.filter(emp =>
    emp.full_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    emp.position?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const parseTimeToMinutes = (timeString) => {
    if (!timeString) return null;
    const [hoursStr, minutesStr, secondsStr] = timeString.split(':');
    const hours = parseInt(hoursStr, 10);
    const minutes = parseInt(minutesStr || '0', 10);
    const seconds = parseInt(secondsStr || '0', 10);
    if (Number.isNaN(hours) || Number.isNaN(minutes)) {
      return null;
    }
    return hours * 60 + minutes + Math.floor(seconds / 60);
  };

  const timeStringToMinutes = (timeString) => {
    if (!timeString) return null;
    const parts = timeString.split(':').map(Number);
    const hours = parts[0];
    const minutes = parts[1] || 0;
    if (Number.isNaN(hours) || Number.isNaN(minutes)) return null;
    return hours * 60 + minutes;
  };

  const formatTimeLabel = (timeString) => {
    if (!timeString) return '';
    const [hours, minutes] = timeString.split(':').map(Number);
    if (Number.isNaN(hours) || Number.isNaN(minutes)) return '';
    const date = new Date();
    date.setHours(hours, minutes, 0, 0);
    return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  };

  const formatSeenAt = (value) => {
    if (!value) return '';
    return new Date(value).toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    });
  };

  const formatRequestedAt = (value) => {
    if (!value) return '';
    return new Date(value).toLocaleString([], {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    });
  };

  const sortShiftsByStartTime = (shiftList) => {
    return [...shiftList].sort((a, b) => {
      const aStart = parseTimeToMinutes(a.start_time) ?? Number.MAX_SAFE_INTEGER;
      const bStart = parseTimeToMinutes(b.start_time) ?? Number.MAX_SAFE_INTEGER;
      if (aStart !== bStart) return aStart - bStart;
      const aEnd = parseTimeToMinutes(a.end_time) ?? Number.MAX_SAFE_INTEGER;
      const bEnd = parseTimeToMinutes(b.end_time) ?? Number.MAX_SAFE_INTEGER;
      return aEnd - bEnd;
    });
  };

  const availabilityMap = useMemo(() => {
    const map = new Map();
    (availability || []).forEach((entry) => {
      if (!entry || !entry.employee_id) return;
      if (!map.has(entry.employee_id)) {
        map.set(entry.employee_id, []);
      }
      map.get(entry.employee_id).push(entry);
    });
    return map;
  }, [availability]);

  const timeOffMap = useMemo(() => {
    const map = new Map();
    (timeOffRequests || []).forEach((entry) => {
      if (!entry || !entry.employee_id) return;
      if (!map.has(entry.employee_id)) {
        map.set(entry.employee_id, []);
      }
      map.get(entry.employee_id).push(entry);
    });
    return map;
  }, [timeOffRequests]);

  const defaultSchedulingSettings = useMemo(() => ({
    shift_lead_enabled: true,
    shift_lead_position: 'Shift Lead',
    shift_lead_mode: 'relative',
    shift_lead_fixed_start: null,
    shift_lead_grace_before_open: 0,
    shift_lead_grace_after_close: 0,
    shift_lead_excluded_positions: ['President / CEO', 'Manager'],
    after_hours_enabled: true,
    after_hours_position: 'After Hours',
    after_hours_mode: 'relative',
    after_hours_fixed_start: null,
    after_hours_grace_after_close: 0,
    default_max_hours: 44
  }), []);

  const mergedSchedulingSettings = useMemo(() => {
    const settings = schedulingSettings || {};
    return {
      ...defaultSchedulingSettings,
      ...settings,
      shift_lead_excluded_positions: (settings.shift_lead_excluded_positions && settings.shift_lead_excluded_positions.length > 0)
        ? settings.shift_lead_excluded_positions
        : defaultSchedulingSettings.shift_lead_excluded_positions
    };
  }, [defaultSchedulingSettings, schedulingSettings]);

  const getDayKey = useCallback((day) => day.format('dddd').toLowerCase(), []);

  const getOperatingWindowForDay = useCallback((day) => {
    const key = getDayKey(day);
    const hours = businessHours?.[key];
    if (!hours || hours.closed) {
      return null;
    }
    const openMinutes = timeStringToMinutes(hours.open);
    const closeMinutes = timeStringToMinutes(hours.close);
    if (openMinutes === null || closeMinutes === null) {
      return null;
    }
    return {
      openMinutes,
      closeMinutes
    };
  }, [businessHours, getDayKey]);

  const computeShiftLeadWindow = useCallback((day) => {
    if (!mergedSchedulingSettings.shift_lead_enabled) return null;
    const hours = getOperatingWindowForDay(day);
    if (!hours) return null;

    const mode = mergedSchedulingSettings.shift_lead_mode;
    if (mode === 'fixed' && mergedSchedulingSettings.shift_lead_fixed_start) {
      const start = timeStringToMinutes(mergedSchedulingSettings.shift_lead_fixed_start);
      if (start === null) return null;
      const end = Math.max(start, hours.closeMinutes + (mergedSchedulingSettings.shift_lead_grace_after_close || 0));
      return { startMinutes: start, endMinutes: end };
    }

    const start = Math.max(0, hours.openMinutes - (mergedSchedulingSettings.shift_lead_grace_before_open || 0));
    const end = Math.max(start, hours.closeMinutes + (mergedSchedulingSettings.shift_lead_grace_after_close || 0));
    return { startMinutes: start, endMinutes: end };
  }, [getOperatingWindowForDay, mergedSchedulingSettings]);

  const computeAfterHoursStart = useCallback((day) => {
    if (!mergedSchedulingSettings.after_hours_enabled) return null;
    const hours = getOperatingWindowForDay(day);
    if (!hours) {
      // Business closed, treat entire day as after hours
      return 0;
    }
    if (mergedSchedulingSettings.after_hours_mode === 'fixed' && mergedSchedulingSettings.after_hours_fixed_start) {
      const fixed = timeStringToMinutes(mergedSchedulingSettings.after_hours_fixed_start);
      return fixed === null ? null : fixed;
    }
    const start = hours.closeMinutes + (mergedSchedulingSettings.after_hours_grace_after_close || 0);
    return start;
  }, [getOperatingWindowForDay, mergedSchedulingSettings]);

  const getShiftMinutes = (shift) => {
    const start = parseTimeToMinutes(shift.start_time?.length > 5 ? shift.start_time.substring(0, 5) : shift.start_time);
    const endRaw = parseTimeToMinutes(shift.end_time?.length > 5 ? shift.end_time.substring(0, 5) : shift.end_time);
    if (start === null || endRaw === null) return null;
    let end = endRaw;
    if (end <= start) {
      end += 24 * 60;
    }
    return { start, end };
  };

  const isAfterHoursShift = (shiftMinutes, afterHoursStart) => {
    if (afterHoursStart === null || shiftMinutes === null) return false;
    return shiftMinutes.end > afterHoursStart;
  };

  const intersectsWindow = (shiftMinutes, window) => {
    if (!window || !shiftMinutes) return false;
    return shiftMinutes.end > window.startMinutes && shiftMinutes.start < window.endMinutes;
  };

  /** Same winning employee for every row that calendar day (position-based priority). */
  const positionNameSet = useMemo(() => positionRowsToNameSet(availablePositions), [availablePositions]);

  const shiftLeadWinnerByDayKey = useMemo(() => {
    const map = {};
    const empMap = new Map(employees.map((e) => [e.id, e]));
    weekDays.forEach((day) => {
      const key = day.format('YYYY-MM-DD');
      const dayShifts = shifts.filter((s) => dayjs(s.shift_date).format('YYYY-MM-DD') === key);
      map[key] = resolveShiftLeadForDay({
        day,
        shifts: dayShifts,
        employeeById: empMap,
        positions: availablePositions,
        schedulingSettings: mergedSchedulingSettings,
        businessHours
      });
    });
    return map;
  }, [weekDays, shifts, employees, availablePositions, mergedSchedulingSettings, businessHours]);

  const employeeHoursMap = useMemo(() => {
    const result = {};
    const gapThresholdMinutes = 5;

    employees.forEach((emp) => {
      const empShifts = shifts.filter((shift) => shift.employee_id === emp.id);
      const shiftsByDate = empShifts.reduce((acc, shift) => {
        if (!shift.shift_date) return acc;
        const dateKey = dayjs(shift.shift_date).format('YYYY-MM-DD');
        if (!acc[dateKey]) acc[dateKey] = [];
        acc[dateKey].push(shift);
        return acc;
      }, {});

      let workedMinutes = 0;
      let deductedBreakMinutes = 0;

      Object.values(shiftsByDate).forEach((dayShifts) => {
        const intervals = dayShifts
          .map((shift) => {
            const start = parseTimeToMinutes(shift.start_time);
            const endRaw = parseTimeToMinutes(shift.end_time);
            if (start === null || endRaw === null) {
              return null;
            }
            let end = endRaw;
            if (end <= start) {
              end += 24 * 60; // Handle overnight shifts gracefully
            }
            return { start, end };
          })
          .filter(Boolean)
          .sort((a, b) => a.start - b.start);

        if (intervals.length === 0) return;

        const dayMinutes = intervals.reduce((sum, interval) => sum + (interval.end - interval.start), 0);

        let blockStart = intervals[0].start;
        let blockEnd = intervals[0].end;
        let dayBreakMinutes = 0;

        for (let i = 1; i < intervals.length; i += 1) {
          const interval = intervals[i];
          if (interval.start - blockEnd <= gapThresholdMinutes) {
            blockEnd = Math.max(blockEnd, interval.end);
          } else {
            const blockHours = (blockEnd - blockStart) / 60;
            if (blockHours > 10) {
              dayBreakMinutes += 60;
            } else if (blockHours > 5) {
              dayBreakMinutes += 30;
            }
            blockStart = interval.start;
            blockEnd = interval.end;
          }
        }

        const finalBlockHours = (blockEnd - blockStart) / 60;
        if (finalBlockHours > 10) {
          dayBreakMinutes += 60;
        } else if (finalBlockHours > 5) {
          dayBreakMinutes += 30;
        }

        dayBreakMinutes = Math.min(dayBreakMinutes, dayMinutes);
        deductedBreakMinutes += dayBreakMinutes;
        workedMinutes += Math.max(dayMinutes - dayBreakMinutes, 0);
      });

      const totalHours = Math.round((workedMinutes / 60) * 100) / 100;
      const maxHoursValue = emp.maxHours != null ? parseFloat(emp.maxHours) : mergedSchedulingSettings.default_max_hours;
      const overMax = maxHoursValue != null ? totalHours > maxHoursValue : false;

      result[emp.id] = {
        totalHours,
        overMax,
        maxHours: maxHoursValue,
        deductedBreakMinutes,
      };
    });

    return result;
  }, [employees, shifts, mergedSchedulingSettings.default_max_hours]);

  const scheduleViewsMap = useMemo(() => {
    return scheduleViews.reduce((map, view) => {
      map[view.employee_id] = view;
      return map;
    }, {});
  }, [scheduleViews]);

  const latestPublishedShiftUpdateMap = useMemo(() => {
    return shifts.reduce((map, shift) => {
      if (!shift.employee_id || shift.is_published === false) return map;
      const updatedAt = shift.updated_at || `${shift.shift_date}T${shift.start_time || '00:00:00'}`;
      const previous = map[shift.employee_id];
      if (!previous || new Date(updatedAt).getTime() > new Date(previous).getTime()) {
        map[shift.employee_id] = updatedAt;
      }
      return map;
    }, {});
  }, [shifts]);

  const getScheduleSeenStatus = (employeeId) => {
    const latestShiftUpdate = latestPublishedShiftUpdateMap[employeeId];
    if (!latestShiftUpdate) return null;

    const view = scheduleViewsMap[employeeId];
    if (!view?.seen_at) {
      return { seen: false, label: 'Schedule not seen yet' };
    }

    const seen = new Date(view.seen_at).getTime() >= new Date(latestShiftUpdate).getTime();
    return {
      seen,
      label: seen
        ? `Schedule seen ${formatSeenAt(view.seen_at)}`
        : 'Schedule changed since employee last viewed it'
    };
  };

  const handleAddShift = (date, employeeId = null) => {
    if (readOnly) return;
    setShiftModalVariant('grid');
    setSelectedDate(date);
    setSelectedEmployee(employeeId);
    setShowShiftModal(true);
  };

  const handleQuickAddShift = () => {
    if (readOnly) return;
    setShiftModalVariant('quick');
    setSelectedDate(dayjs());
    setSelectedEmployee(null);
    setShowShiftModal(true);
  };

  const notifyPublishedShiftsForWeek = async (publishedShifts, weekStartDate) => {
    const weekStart = getScheduleWeekStart(dayjs(weekStartDate)).format('YYYY-MM-DD');
    const weekEnd = getScheduleWeekStart(dayjs(weekStartDate)).clone().add(6, 'days').format('YYYY-MM-DD');

    const shiftsByEmployee = (publishedShifts || []).reduce((map, shift) => {
      if (!shift.employee_id) return map;
      if (!map[shift.employee_id]) map[shift.employee_id] = [];
      map[shift.employee_id].push(shift);
      return map;
    }, {});

    const affectedEmployeeIds = Object.keys(shiftsByEmployee);
    let fullWeekShiftsByEmployee = {};
    if (affectedEmployeeIds.length > 0) {
      const { data: fullWeekShifts, error: fullWeekError } = await sb
        .from('scheduling_shifts')
        .select('id, employee_id, shift_date, start_time, end_time, position, status, is_published')
        .eq('business_id', businessId)
        .in('employee_id', affectedEmployeeIds)
        .gte('shift_date', weekStart)
        .lte('shift_date', weekEnd)
        .order('shift_date', { ascending: true })
        .order('start_time', { ascending: true });

      if (fullWeekError) throw fullWeekError;

      fullWeekShiftsByEmployee = (fullWeekShifts || [])
        .filter((shift) => shift.is_published !== false)
        .reduce((map, shift) => {
          if (!shift.employee_id) return map;
          if (!map[shift.employee_id]) map[shift.employee_id] = [];
          map[shift.employee_id].push(shift);
          return map;
        }, {});
    }

    await Promise.all(Object.entries(shiftsByEmployee).map(([employeeId, employeeShifts]) => (
      sendSchedulingNotification({
        businessId,
        eventKey: 'schedule_posted',
        employeeId,
        context: {
          weekStart,
          weekEnd,
          changedShiftCount: employeeShifts.length,
          shiftCount: fullWeekShiftsByEmployee[employeeId]?.length || 0,
          shifts: fullWeekShiftsByEmployee[employeeId] || [],
          changedShifts: employeeShifts
        }
      })
    )));
  };

  const handleSaveShift = async (shiftData) => {
    if (savingShift) return;
    setSavingShift(true);
    try {
      const {
        additionalDates = [],
        publish = false,
        shiftDate: shiftDateOverride,
        employeeId: employeeIdOverride,
        ...baseShift
      } = shiftData;

      const primaryShiftDate = shiftDateOverride || selectedDate.format('YYYY-MM-DD');
      const resolvedEmployeeId = employeeIdOverride ?? selectedEmployee ?? baseShift.employee_id ?? null;

      const uniqueAdditionalDates = Array.from(new Set(additionalDates))
        .filter((dateIso) => dateIso && dateIso !== primaryShiftDate)
        .sort();

      const { data: { user } } = await sb.auth.getUser();
      const publishedAt = publish ? new Date().toISOString() : undefined;

      const buildPayload = (dateIso) => ({
        ...baseShift,
        business_id: businessId,
        shift_date: dateIso,
        employee_id: resolvedEmployeeId,
        is_open_shift: !resolvedEmployeeId,
        is_published: publish,
        created_by: user?.id,
        ...(publish ? { published_by: user?.id, updated_at: publishedAt } : {})
      });

      const payload = [buildPayload(primaryShiftDate), ...uniqueAdditionalDates.map(buildPayload)];

      const { data: insertedShifts, error } = await sb
        .from('scheduling_shifts')
        .insert(payload)
        .select('id, employee_id, shift_date, start_time, end_time, position');

      if (error) throw error;

      if (publish && insertedShifts?.length) {
        await notifyPublishedShiftsForWeek(insertedShifts, primaryShiftDate);
      }

      const createdCount = payload.length;
      if (publish) {
        toast.success(`${createdCount} shift${createdCount > 1 ? 's' : ''} saved and published`);
      } else {
        toast.success(`${createdCount} shift${createdCount > 1 ? 's' : ''} created (pending publication)`);
      }
      if (shiftDateOverride) {
        const shiftWeek = getScheduleWeekStart(dayjs(shiftDateOverride));
        if (!shiftWeek.isSame(currentWeek, 'day')) {
          setCurrentWeek(shiftWeek);
        } else {
          loadShifts();
          loadScheduleViews();
        }
      } else {
        loadShifts();
        loadScheduleViews();
      }
      setShowShiftModal(false);
    } catch (error) {
      console.error('Error creating shift:', error);
      toast.error('Failed to create shift');
    } finally {
      setSavingShift(false);
    }
  };

  const handleEditShift = async (shiftData) => {
    try {
      const payload = {
        ...shiftData,
        updated_at: new Date().toISOString(),
        ...(editingShift?.is_published ? { is_published: false } : {})
      };

      const { error } = await sb
        .from('scheduling_shifts')
        .update(payload)
        .eq('id', editingShift.id);

      if (error) throw error;

      toast.success(
        editingShift?.is_published
          ? 'Shift updated — pending publication until you publish again'
          : 'Shift updated successfully'
      );
      setShowEditModal(false);
      setEditingShift(null);
      loadShifts();
    } catch (error) {
      console.error('Error updating shift:', error);
      toast.error('Failed to update shift');
    }
  };

  const handleDeleteShift = async () => {
    if (!editingShift) {
      console.log('No shift to delete');
      return;
    }
    
    console.log('Attempting to delete shift with ID:', editingShift.id);
    
    if (!confirm('Are you sure you want to delete this shift?')) {
      console.log('User cancelled deletion');
      return;
    }

    try {
      console.log('Calling delete with:', { id: editingShift.id, business_id: businessId });
      
      // First check if the shift exists
      const { data: existingShift, error: checkError } = await sb
        .from('scheduling_shifts')
        .select('*')
        .eq('id', editingShift.id)
        .single();
      
      console.log('Existing shift check:', { existingShift, checkError });
      
      if (!existingShift && !checkError) {
        toast.error('Shift not found');
        return;
      }
      
      const { error, data } = await sb
        .from('scheduling_shifts')
        .delete()
        .eq('id', editingShift.id)
        .select(); // Add select to get the deleted row

      console.log('Delete result:', { error, data });

      if (error) {
        console.error('Delete error:', error);
        throw error;
      }
      
      // Check if delete was successful
      if (!data || data.length === 0) {
        console.warn('No rows deleted - RLS may be blocking');
        toast.error('Failed to delete shift - permission denied');
        return;
      }
      
      console.log('Shift deleted successfully, deleted rows:', data);
      toast.success('Shift deleted successfully');
      setShowEditModal(false);
      setEditingShift(null);
      loadShifts();
    } catch (error) {
      console.error('Error deleting shift:', error);
      toast.error('Failed to delete shift: ' + error.message);
    }
  };

  const handleClickShift = (shift) => {
    if (readOnly) return;
    setEditingShift(shift);
    setShowEditModal(true);
  };

  const handleEmployeeDragStart = (event, employeeId) => {
    if (readOnly) return;
    event.stopPropagation();
    setDraggedEmployee(employeeId);
    event.dataTransfer.setData('application/x-tavari-employee', String(employeeId));
    event.dataTransfer.effectAllowed = 'move';
  };

  const handleEmployeeDragOver = (e) => {
    if (!draggedEmployee && !e.dataTransfer.types?.includes('application/x-tavari-employee')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleEmployeeDragEnd = () => {
    setDraggedEmployee(null);
  };

  const handleEmployeeDrop = async (targetEmployeeId) => {
    if (readOnly) return;
    if (!draggedEmployee || draggedEmployee === targetEmployeeId) {
      setDraggedEmployee(null);
      return;
    }

    // Reorder the employees array
    const draggedIndex = employees.findIndex(e => e.id === draggedEmployee);
    const targetIndex = employees.findIndex(e => e.id === targetEmployeeId);

    const newEmployees = [...employees];
    const [removed] = newEmployees.splice(draggedIndex, 1);
    newEmployees.splice(targetIndex, 0, removed);

    // Update the employee order in the database
    try {
      const updates = newEmployees.map((emp, index) => {
        return sb
          .from('business_users')
          .update({ employee_order: index })
          .eq('business_id', businessId)
          .eq('user_id', emp.id);
      });

      await Promise.all(updates);
      
      // Update local state with new order - update the order property
      const reorderedEmployees = newEmployees.map((emp, index) => ({
        ...emp,
        order: index
      }));
      
      setEmployees(reorderedEmployees);
      toast.success('Employee order updated');
    } catch (error) {
      console.error('Error updating employee order:', error);
      toast.error('Failed to update employee order');
    }

    setDraggedEmployee(null);
  };

  const handleShiftDragStart = (event, shiftId) => {
    if (readOnly) return;
    event.stopPropagation();
    setDraggedShiftId(shiftId);
    event.dataTransfer.setData('application/x-tavari-shift', shiftId);
    event.dataTransfer.effectAllowed = 'move';
  };

  const clearShiftDrag = () => {
    setDraggedShiftId(null);
  };

  const handleDayCellDragOver = (event) => {
    const hasShiftData = event.dataTransfer.types?.includes('application/x-tavari-shift') || draggedShiftId;
    if (!hasShiftData) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  };

  const handleDayCellDrop = (event, day, employeeId) => {
    if (readOnly) return;
    event.preventDefault();
    event.stopPropagation();
    const shiftId = event.dataTransfer.getData('application/x-tavari-shift') || draggedShiftId;
    if (!shiftId) {
      clearShiftDrag();
      return;
    }

    handleShiftDrop({
      shiftId,
      targetDateIso: day.format('YYYY-MM-DD'),
      targetEmployeeId: employeeId
    });
  };

  const handleShiftDrop = async ({ shiftId, targetDateIso, targetEmployeeId }) => {
    const effectiveShiftId = shiftId || draggedShiftId;
    if (!effectiveShiftId) {
      clearShiftDrag();
      return;
    }

    try {
      const moved = shifts.find((s) => s.id === effectiveShiftId);
      const updates = {
        shift_date: targetDateIso,
        employee_id: targetEmployeeId || null,
        updated_at: new Date().toISOString(),
        ...(moved?.is_published ? { is_published: false } : {})
      };

      const { error } = await sb
        .from('scheduling_shifts')
        .update(updates)
        .eq('id', effectiveShiftId);

      if (error) throw error;

      if (moved?.is_published) {
        toast.success('Shift moved — pending publication until you publish again');
      }
      loadShifts();
    } catch (error) {
      console.error('Error moving shift:', error);
      toast.error('Failed to move shift');
    } finally {
      clearShiftDrag();
    }
  };

  const handlePublishShifts = async () => {
    if (readOnly) return;
    try {
      // Get current user
      const { data: { user } } = await sb.auth.getUser();
      
      const weekStart = currentWeek.format('YYYY-MM-DD');
      const weekEnd = currentWeek.clone().add(6, 'days').format('YYYY-MM-DD');
      
      // Publish all unpublished shifts for this week
      const publishedAt = new Date().toISOString();
      const { data: publishedShifts, error } = await sb
        .from('scheduling_shifts')
        .update({
          is_published: true,
          published_by: user?.id,
          updated_at: publishedAt
        })
        .eq('business_id', businessId)
        .is('is_published', false)
        .gte('shift_date', weekStart)
        .lte('shift_date', weekEnd)
        .select('id, employee_id, shift_date, start_time, end_time, position');

      if (error) throw error;
      
      toast.success('Shifts published successfully');
      await notifyPublishedShiftsForWeek(publishedShifts, weekStart);
      loadShifts();
      loadScheduleViews();
    } catch (error) {
      console.error('Error publishing shifts:', error);
      toast.error('Failed to publish shifts');
    }
  };

  const handleAddEvent = (date) => {
    if (readOnly) return;
    setSelectedDate(date);
    setShowEventModal(true);
  };

  const handleSaveEvent = async (eventName) => {
    try {
      const eventData = {
        business_id: businessId,
        event_date: selectedDate.format('YYYY-MM-DD'),
        event_name: eventName,
        event_type: 'event'
      };
      
      console.log('Creating event:', eventData);
      
      const { data, error } = await sb
        .from('scheduling_events')
        .insert([eventData]);

      console.log('Event insert result:', { data, error });

      if (error) throw error;
      
      toast.success('Event created successfully');
      setShowEventModal(false);
      loadEvents();
    } catch (error) {
      console.error('Error creating event:', error);
      toast.error('Failed to create event: ' + error.message);
    }
  };

  const handleDeleteEvent = async (eventId) => {
    try {
      const { error } = await sb
        .from('scheduling_events')
        .delete()
        .eq('id', eventId);

      if (error) throw error;
      
      toast.success('Event deleted successfully');
      loadEvents();
    } catch (error) {
      console.error('Error deleting event:', error);
      toast.error('Failed to delete event');
    }
  };

  const getShiftColor = (position) => {
    // Check if we have a color in availablePositions
    const positionData = availablePositions.find(p => p.position_name === position);
    if (positionData) {
      return positionData.color;
    }
    
    // Fallback to default color mapping
    const colorMap = {
      'President/CEO': '#dc3545',
      'Facility Director': '#fd7e14',
      'A-Shift Lead': '#28a745',
      'GEC Clerk': '#007bff',
      'A - Clerk': '#20c997',
      'Night Cleaner': '#6610f2',
      'Default': '#4a90e2'
    };
    return colorMap[position] || colorMap['Default'];
  };

  // Helper function to check if two shifts overlap in time
  const shiftsConflict = (shift1, shift2) => {
    if (!shift1.start_time || !shift1.end_time || !shift2.start_time || !shift2.end_time) {
      return false;
    }
    
    // Convert time strings to minutes for comparison
    const timeToMinutes = (timeStr) => {
      const parts = timeStr.substring(0, 5).split(':').map(Number);
      return parts[0] * 60 + parts[1];
    };
    
    const start1 = timeToMinutes(shift1.start_time);
    const end1 = timeToMinutes(shift1.end_time);
    const start2 = timeToMinutes(shift2.start_time);
    const end2 = timeToMinutes(shift2.end_time);
    
    // Check if shifts overlap
    return (start1 < end2 && end1 > start2);
  };

  // Check if a shift has conflicts with other shifts on the same day
  const hasConflict = (shift, allShifts) => {
    const sameDayShifts = allShifts.filter(s => 
      s.shift_date === shift.shift_date && s.id !== shift.id
    );
    
    return sameDayShifts.some(otherShift => {
      // Only check conflicts if both shifts have times
      if (!shift.start_time || !shift.end_time || !otherShift.start_time || !otherShift.end_time) {
        return false;
      }
      return shiftsConflict(shift, otherShift);
    });
  };

  const formatTo12Hour = (time24) => {
    if (!time24) return time24;
    const [hours, minutes] = time24.split(':');
    const hour = parseInt(hours);
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const hour12 = hour % 12 || 12;
    return `${hour12}:${minutes} ${ampm}`;
  };

  const getHolidayForDay = (day) => {
    const dayStr = day.format('YYYY-MM-DD');
    return holidayHours.find((h) => h.date === dayStr) || null;
  };

  const formatHolidayHoursLabel = (holiday) => {
    if (!holiday) return '';
    if (holiday.closed) return 'Closed';
    if (holiday.hours?.open && holiday.hours?.close) {
      return `${formatTo12Hour(holiday.hours.open)} - ${formatTo12Hour(holiday.hours.close)}`;
    }
    return 'Special hours';
  };

  const getHolidayColumnTheme = (holiday) => {
    if (!holiday) return null;
    if (holiday.closed) {
      return {
        backgroundColor: '#fef2f2',
        headerBackgroundColor: '#fee2e2',
        businessHoursBackgroundColor: '#fef2f2',
        eventsBackgroundColor: '#fee2e2',
        openShiftsBackgroundColor: '#fef2f2',
        accentColor: '#dc2626',
        eventChipBackground: '#dc2626',
        eventChipColor: '#ffffff'
      };
    }
    return {
      backgroundColor: '#fff7ed',
      headerBackgroundColor: '#ffedd5',
      businessHoursBackgroundColor: '#fff7ed',
      eventsBackgroundColor: '#ffedd5',
      openShiftsBackgroundColor: '#fff7ed',
      accentColor: '#ea580c',
      eventChipBackground: '#ea580c',
      eventChipColor: '#ffffff'
    };
  };

  const getDayBusinessHours = (day) => {
    if (!businessHours) return null;
    const dayName = day.format('dddd').toLowerCase();
    const hours = businessHours[dayName];
    
    // Check if it's a holiday
    const holiday = getHolidayForDay(day);
    
    if (holiday) {
      if (holiday.closed) {
        return 'CLOSED';
      }
      if (holiday.hours) {
        return `${formatTo12Hour(holiday.hours.open)} - ${formatTo12Hour(holiday.hours.close)}`;
      }
      return null;
    }
    
    if (hours && !hours.closed) {
      return `${formatTo12Hour(hours.open)} - ${formatTo12Hour(hours.close)}`;
    }
    
    if (hours && hours.closed) {
      return 'CLOSED';
    }
    
    return null;
  };

  /** All availability rows for that employee/day (available + unavailable). Portal often submits is_available: true. */
  const computeAvailabilityForDay = useCallback((employeeId, date) => {
    const entries = availabilityMap.get(employeeId) || [];
    if (!entries.length) return [];

    const targetDay = date.startOf ? date.startOf('day') : dayjs(date).startOf('day');
    const dayIndex = targetDay.day();

    return entries
      .filter((entry) => {
        let matchesDay = false;
        if (typeof entry.day_of_week === 'number') {
          matchesDay = entry.day_of_week === dayIndex;
        }
        if (!matchesDay && entry.availability_date) {
          matchesDay = dayjs(entry.availability_date).isSame(targetDay, 'day');
        }
        if (!matchesDay) return false;

        const effective = entry.effective_date ? dayjs(entry.effective_date) : null;
        const expiry = entry.expiry_date ? dayjs(entry.expiry_date) : null;
        if (effective && targetDay.isBefore(effective, 'day')) return false;
        if (expiry && targetDay.isAfter(expiry, 'day')) return false;

        return true;
      })
      .map((entry) => {
        const isWholeDay = Boolean(
          entry.all_day === true ||
          (!entry.start_time && !entry.end_time) ||
          (entry.start_time === '00:00' && (entry.end_time === '23:59' || entry.end_time === '24:00'))
        );
        return {
          ...entry,
          isWholeDay
        };
      });
  }, [availabilityMap]);

  const computeTimeOffForDay = useCallback((employeeId, date) => {
    const entries = timeOffMap.get(employeeId) || [];
    if (!entries.length) return [];

    const targetDay = date.startOf ? date.startOf('day') : dayjs(date).startOf('day');

    return entries
      .filter((entry) => {
        const start = entry.start_date ? dayjs(entry.start_date).startOf('day') : null;
        const endRaw = entry.end_date ? dayjs(entry.end_date).startOf('day') : null;
        if (!start?.isValid()) return false;
        const end = endRaw?.isValid() ? endRaw : start;
        return !targetDay.isBefore(start, 'day') && !targetDay.isAfter(end, 'day');
      })
      .map((entry) => {
        const start = dayjs(entry.start_date).startOf('day');
        const isFirstDayOfRange = targetDay.isSame(start, 'day');
        const showPartialTimes = Boolean(
          entry.is_partial_day &&
          entry.start_time &&
          entry.end_time &&
          isFirstDayOfRange
        );
        const timeSummary = showPartialTimes
          ? `${formatTimeLabel(entry.start_time)} - ${formatTimeLabel(entry.end_time)}`
          : 'All day';
        return {
          ...entry,
          timeSummary
        };
      });
  }, [timeOffMap]);

  if (loading) {
    return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
      <div>Loading...</div>
    </div>;
  }

  if (useKioskScheduleRpc && kioskScheduleError) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', padding: '24px', textAlign: 'center' }}>
        <div>
          <p style={{ margin: '0 0 8px', fontWeight: 600, color: '#111827' }}>{kioskScheduleError}</p>
          <button
            type="button"
            onClick={() => {
              setLoading(true);
              loadKioskWeekSchedule().finally(() => setLoading(false));
            }}
            style={{ marginTop: '12px', padding: '10px 16px', borderRadius: '8px', border: 'none', backgroundColor: '#0f766e', color: 'white', fontWeight: 600, cursor: 'pointer' }}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      {/* Top Bar */}
      <div style={styles.topBar}>
        <div style={styles.topBarLeft}>
          <button style={styles.todayButton} onClick={() => setCurrentWeek(getScheduleWeekStart())}>Today</button>
          <button style={styles.navButton} onClick={() => navigateWeek(-1)}>←</button>
          <span style={styles.weekLabel}>{currentWeek.format('MMM D')} - {currentWeek.clone().add(6, 'days').format('D, YYYY')}</span>
          <button style={styles.navButton} onClick={() => navigateWeek(1)}>→</button>
        </div>
        {!readOnly && (
          <div style={styles.topBarRight}>
            <button
              type="button"
              style={styles.addShiftToolbarButton}
              onClick={handleQuickAddShift}
              title="Add shift"
            >
              <Plus size={18} />
            </button>
            <button style={styles.filterButton}><Filter size={16} />Filters</button>
            <button style={styles.publishButton} onClick={handlePublishShifts}><Send size={16} />Publish</button>
          </div>
        )}
      </div>

      {/* SINGLE 8-COLUMN GRID */}
      <div style={styles.gridContainer}>
        {/* Header Row */}
        <div style={styles.gridHeader}>
          <div style={styles.headerCell}>Team Members</div>
          {weekDays.map(day => {
            const holiday = getHolidayForDay(day);
            const holidayTheme = getHolidayColumnTheme(holiday);
            return (
            <div
              key={day.format('YYYY-MM-DD')}
              style={{
                ...styles.headerCell,
                ...(holidayTheme ? {
                  backgroundColor: holidayTheme.headerBackgroundColor,
                  borderTop: `3px solid ${holidayTheme.accentColor}`,
                  color: holidayTheme.accentColor
                } : {})
              }}
            >
              <div>{day.format('ddd').toUpperCase()}</div>
              <div>{day.format('D')}</div>
              {holiday?.name ? (
                <div style={{ fontSize: '10px', fontWeight: 500, marginTop: '4px', lineHeight: 1.2 }}>
                  {holiday.name}
                </div>
              ) : null}
            </div>
            );
          })}
        </div>

                 {/* Business Hours Row */}
        <div style={styles.businessHoursRow}>
          <div style={styles.businessHoursLabel}>Business Hours</div>
          {weekDays.map(day => {
            const hours = getDayBusinessHours(day);
            const holiday = getHolidayForDay(day);
            const holidayTheme = getHolidayColumnTheme(holiday);
            return (
              <div
                key={day.format('YYYY-MM-DD')}
                style={{
                  ...styles.businessHoursCell,
                  ...(holidayTheme ? { backgroundColor: holidayTheme.businessHoursBackgroundColor } : {})
                }}
              >
                <div style={{ fontSize: '13px', color: hours === 'CLOSED' ? '#dc2626' : holidayTheme ? holidayTheme.accentColor : '#059669' }}>
                  {hours || 'N/A'}
                </div>
              </div>
            );
          })}
        </div>

        {/* Events Row */}
        <div style={styles.eventsRow}>
          <div style={styles.eventsLabel}>Events</div>
          {weekDays.map(day => {
            const dayStr = day.format('YYYY-MM-DD');
            const dayEvents = events.filter(e => e.event_date === dayStr);
            const holiday = getHolidayForDay(day);
            const holidayTheme = getHolidayColumnTheme(holiday);
            const holidayHoursLabel = formatHolidayHoursLabel(holiday);
            return (
              <div
                key={day.format('YYYY-MM-DD')}
                style={{
                  ...styles.eventsCell,
                  ...(holidayTheme ? { backgroundColor: holidayTheme.eventsBackgroundColor } : {})
                }}
              >
                {holiday && (
                  <div
                    style={{
                      padding: '4px 8px',
                      backgroundColor: holidayTheme.eventChipBackground,
                      color: holidayTheme.eventChipColor,
                      borderRadius: '4px',
                      fontSize: '13px',
                      marginBottom: '4px',
                      lineHeight: 1.35
                    }}
                    title="Holiday hours from Settings → Holiday Hours"
                  >
                    <div style={{ fontWeight: 700 }}>{holiday.name || 'Holiday'}</div>
                    <div style={{ fontSize: '11px', opacity: 0.95 }}>{holidayHoursLabel}</div>
                  </div>
                )}
                {dayEvents.map(event => (
                  <div 
                    key={event.id} 
                    style={{ 
                      padding: '4px 8px', 
                      backgroundColor: '#3b82f6', 
                      color: 'white', 
                      borderRadius: '4px', 
                      fontSize: '13px',
                      marginBottom: '4px',
                      cursor: readOnly ? 'default' : 'pointer'
                    }}
                    onClick={() => {
                      if (readOnly) return;
                      if (confirm('Delete this event?')) {
                        handleDeleteEvent(event.id);
                      }
                    }}
                  >
                    {event.event_name}
                  </div>
                ))}
                {dayEvents.length === 0 && !readOnly && (
                  <button 
                    style={{ 
                      width: '100%', 
                      padding: '8px', 
                      border: '1px dashed #6b7280', 
                      borderRadius: '4px',
                      backgroundColor: 'transparent',
                      color: '#6b7280',
                      cursor: 'pointer',
                      fontSize: '13px'
                    }}
                    onClick={() => handleAddEvent(day)}
                  >
                    + Add Event
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {/* Open Shifts Row */}
        <div style={styles.openShiftsRow}>
          <div style={styles.openShiftsLabel}>Open Shifts</div>
          {weekDays.map(day => {
            const dayStr = day.format('YYYY-MM-DD');
            const openShifts = shifts.filter(s => 
              dayjs(s.shift_date).format('YYYY-MM-DD') === dayStr && 
              (!s.employee_id || s.is_open_shift)
            );
            const sortedOpenShifts = sortShiftsByStartTime(openShifts);
            const holiday = getHolidayForDay(day);
            const holidayTheme = getHolidayColumnTheme(holiday);
            return (
              <div
                key={day.format('YYYY-MM-DD')}
                style={{
                  ...styles.openShiftsCell,
                  ...(holidayTheme ? { backgroundColor: holidayTheme.openShiftsBackgroundColor } : {})
                }}
                onMouseEnter={(e) => {
                  const btn = e.currentTarget.querySelector('button[data-add-open-shift]');
                  if (btn) btn.style.opacity = '1';
                }}
                onMouseLeave={(e) => {
                  const btn = e.currentTarget.querySelector('button[data-add-open-shift]');
                  if (btn) btn.style.opacity = '0';
                }}
              >
                {sortedOpenShifts.map(shift => {
                    let startTime = 'Time TBD';
                    let endTime = 'Time TBD';
                    
                    if (shift.start_time) {
                      // Handle both HH:mm:ss and HH:mm formats
                      const timeStr = shift.start_time.length > 5 ? shift.start_time.substring(0, 5) : shift.start_time;
                      const [hours, minutes] = timeStr.split(':').map(Number);
                      const hour12 = hours % 12 || 12;
                      const ampm = hours >= 12 ? 'pm' : 'am';
                      startTime = `${hour12}:${String(minutes).padStart(2, '0')}${ampm}`;
                    }
                    
                    if (shift.end_time) {
                      const timeStr = shift.end_time.length > 5 ? shift.end_time.substring(0, 5) : shift.end_time;
                      const [hours, minutes] = timeStr.split(':').map(Number);
                      const hour12 = hours % 12 || 12;
                      const ampm = hours >= 12 ? 'pm' : 'am';
                      endTime = `${hour12}:${String(minutes).padStart(2, '0')}${ampm}`;
                    }
                    
                    const conflict = hasConflict(shift, shifts);
                    
                    return (
                      <div key={shift.id} style={{ ...styles.openShiftBlock, backgroundColor: shift.is_published ? '#fbbf24' : '#fbbf24', opacity: shift.is_published ? 1 : 0.6, border: shift.is_published ? 'none' : '2px dashed #f59e0b', position: 'relative', cursor: readOnly ? 'default' : 'pointer' }} onClick={() => { if (!readOnly) handleClickShift(shift); }}>
                        {conflict && (
                          <div style={{ position: 'absolute', bottom: '4px', right: '4px', color: '#ef4444', zIndex: 10 }}>
                            <AlertTriangle size={16} fill="#ef4444" fillOpacity={0.2} />
                          </div>
                        )}
                        <div style={{ fontWeight: '600', marginBottom: '2px' }}>
                          {formatPositionDisplay(shift.position, positionNameSet) || 'Open'}
                          {!shift.is_published && <span style={{ fontSize: '10px', marginLeft: '4px' }}>(Pending)</span>}
                        </div>
                        <div style={{ fontSize: '14px', opacity: 0.95 }}>{startTime} - {endTime}</div>
                      </div>
                    );
                  })}
                {!readOnly && (
                <button
                  data-add-open-shift
                  style={{
                    ...styles.addButton,
                    marginTop: sortedOpenShifts.length > 0 ? '8px' : 'auto',
                    opacity: 0,
                    position: sortedOpenShifts.length > 0 ? 'absolute' : 'static',
                    bottom: sortedOpenShifts.length > 0 ? '8px' : 'auto',
                    right: sortedOpenShifts.length > 0 ? '8px' : 'auto'
                  }}
                  onClick={() => handleAddShift(day, null)}
                >
                  <Plus size={20} />
                </button>
                )}
              </div>
            );
          })}
        </div>

        {/* Employee Rows */}
        {filteredEmployees.map(employee => {
          const scheduleSeenStatus = getScheduleSeenStatus(employee.id);

          return (
          <div
            key={employee.id} 
            style={{
              ...styles.gridRow,
              opacity: draggedEmployee === employee.id ? 0.5 : 1
            }}
            onDragOver={readOnly ? undefined : handleEmployeeDragOver}
            onDrop={readOnly ? undefined : ((event) => {
              const isEmployeeDrag = draggedEmployee || event.dataTransfer.types?.includes('application/x-tavari-employee');
              if (!isEmployeeDrag) return;
              event.preventDefault();
              handleEmployeeDrop(employee.id);
            })}
          >
            {/* Employee Name Cell */}
            <div style={styles.employeeNameCell}>
              {!readOnly && (
              <div
                style={styles.dragHandle}
                draggable
                onDragStart={(event) => handleEmployeeDragStart(event, employee.id)}
                onDragEnd={handleEmployeeDragEnd}
              >
                <GripVertical size={16} />
              </div>
              )}
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <span style={styles.employeeNameLine}>
                  {employee.full_name}
                  {scheduleSeenStatus && (
                    <span
                      style={{
                        ...styles.scheduleSeenIcon,
                        ...(scheduleSeenStatus.seen ? styles.scheduleSeenIconSeen : styles.scheduleSeenIconUnseen)
                      }}
                      title={scheduleSeenStatus.label}
                      aria-label={scheduleSeenStatus.label}
                    >
                      {scheduleSeenStatus.seen ? <Eye size={14} /> : <EyeOff size={14} />}
                    </span>
                  )}
                </span>
                <span
                  style={{
                    ...styles.employeeHours,
                    ...(hideEmployeeHoursCap
                      ? {
                          color: TavariStyles.colors.gray500,
                          fontWeight: styles.employeeHours.fontWeight,
                        }
                      : {
                          color: employeeHoursMap[employee.id]?.overMax ? '#dc2626' : TavariStyles.colors.gray500,
                          fontWeight: employeeHoursMap[employee.id]?.overMax ? 700 : styles.employeeHours.fontWeight,
                        }),
                  }}
                >
                  {Number.isFinite(employeeHoursMap[employee.id]?.totalHours)
                    ? `${employeeHoursMap[employee.id].totalHours.toFixed(2)} hrs` : '—'}
                  {!hideEmployeeHoursCap && employeeHoursMap[employee.id]?.maxHours
                    ? ` / ${employeeHoursMap[employee.id].maxHours} hr max`
                    : ''}
                  {!hideEmployeeHoursCap && employeeHoursMap[employee.id]?.overMax ? ' • over' : ''}
                </span>
                {employee.lieuTimeEnabled && (
                  <span style={styles.employeeLieu}>
                    Lieu balance: {Number(employee.lieuTimeBalance || 0).toFixed(2)} hrs
                  </span>
                )}
              </div>
            </div>
            {/* Day Cells */}
            {weekDays.map(day => {
              const dayShifts = shifts.filter(s =>
                s.employee_id === employee.id &&
                dayjs(s.shift_date).format('YYYY-MM-DD') === day.format('YYYY-MM-DD')
              );
              const sortedDayShifts = sortShiftsByStartTime(dayShifts);
              const dayAvailability = computeAvailabilityForDay(employee.id, day);
              const dayTimeOff = computeTimeOffForDay(employee.id, day);
              const hasAvailabilityEntries = dayAvailability.length > 0;
              const hasTimeOffEntries = dayTimeOff.length > 0;
              const hasPendingAvailability = dayAvailability.some((e) => e.status === 'pending');
              const hasPendingTimeOff = dayTimeOff.some((e) => e.status === 'pending');
              const hasUnavailableEntry = dayAvailability.some((e) => e.is_available === false);
              const shiftLeadWindow = computeShiftLeadWindow(day);
              const afterHoursStart = computeAfterHoursStart(day);
              const shiftLeadWinner = shiftLeadWinnerByDayKey[day.format('YYYY-MM-DD')];
              const autoShiftLeadId = shiftLeadWinner?.employeeId ?? null;
              const holiday = getHolidayForDay(day);
              const holidayTheme = getHolidayColumnTheme(holiday);
              return (
                <div
                  key={day.format('YYYY-MM-DD')}
                  style={{
                    ...styles.dayCell,
                    position: 'relative',
                    backgroundColor: (hasPendingAvailability || hasPendingTimeOff)
                      ? '#fffbeb'
                      : hasUnavailableEntry
                        ? '#fff5f5'
                        : hasAvailabilityEntries
                          ? '#eff6ff'
                          : hasTimeOffEntries
                            ? '#faf5ff'
                            : holidayTheme?.backgroundColor || 'white',
                    ...(holidayTheme ? { boxShadow: `inset 0 3px 0 0 ${holidayTheme.accentColor}` } : {})
                  }}
                  onMouseEnter={(e) => {
                    const btn = e.currentTarget.querySelector('button[data-add-shift]');
                    if (btn) btn.style.opacity = '1';
                  }}
                  onMouseLeave={(e) => {
                    const btn = e.currentTarget.querySelector('button[data-add-shift]');
                    if (btn) btn.style.opacity = '0';
                  }}
                  onDragOver={readOnly ? undefined : handleDayCellDragOver}
                  onDrop={readOnly ? undefined : ((event) => handleDayCellDrop(event, day, employee.id))}
                >
                  {hasAvailabilityEntries && (
                    <div style={styles.unavailabilityContainer}>
                      {dayAvailability.map((entry) => {
                        const isUnavailable = entry.is_available === false;
                        const isPending = entry.status === 'pending';
                        const prefix = isUnavailable
                          ? (isPending ? 'Unavailable (pending) • ' : 'Unavailable • ')
                          : (isPending ? 'Available (pending) • ' : 'Available • ');
                        const badgeStyle = isUnavailable
                          ? {
                              ...styles.unavailabilityBadge,
                              ...(isPending ? styles.unavailabilityBadgePending : {})
                            }
                          : {
                              ...styles.availabilityBadgeAvailable,
                              ...(isPending ? styles.availabilityBadgeAvailablePending : {})
                            };
                        return (
                          <div key={entry.id} style={badgeStyle}>
                            <span style={{ flex: '1 1 auto', minWidth: 0 }}>
                              {prefix}
                              {entry.isWholeDay
                                ? 'Whole Day'
                                : `${formatTimeLabel(entry.start_time)} - ${formatTimeLabel(entry.end_time)}`}
                            </span>
                            {isPending && !readOnly && (
                              <span style={styles.availabilityDecisionActions}>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleAvailabilityDecision(entry, 'approved');
                                  }}
                                  disabled={savingAvailabilityId === entry.id}
                                  style={styles.availabilityApproveBtn}
                                >
                                  Approve
                                </button>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleAvailabilityDecision(entry, 'denied');
                                  }}
                                  disabled={savingAvailabilityId === entry.id}
                                  style={styles.availabilityDenyBtn}
                                >
                                  Deny
                                </button>
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {hasTimeOffEntries && (
                    <div style={styles.unavailabilityContainer}>
                      {dayTimeOff.map((entry) => {
                        const st = entry.status || 'pending';
                        const isPending = st === 'pending';
                        const isDenied = st === 'denied';
                        const typeLabel = TIME_OFF_TYPE_LABELS[entry.request_type] || entry.request_type || 'Time off';
                        const statusLabel = st === 'approved' ? 'Approved' : st === 'denied' ? 'Denied' : 'Pending';
                        const badgeStyle = isDenied
                          ? styles.timeOffBadgeDenied
                          : isPending
                            ? { ...styles.timeOffBadge, ...styles.timeOffBadgePending }
                            : styles.timeOffBadge;
                        return (
                          <div key={`time-off-${entry.id}`} style={badgeStyle}>
                            <span style={{ flex: '1 1 auto', minWidth: 0 }}>
                              <div>
                                {typeLabel} • {statusLabel} • {entry.timeSummary}
                              </div>
                              {entry.created_at ? (
                                <div style={{ fontSize: '10px', fontWeight: 500, marginTop: '2px', opacity: 0.9 }}>
                                  Requested {formatRequestedAt(entry.created_at)}
                                </div>
                              ) : null}
                            </span>
                            {isPending && !readOnly && (
                              <span style={styles.availabilityDecisionActions}>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleTimeOffDecision(entry, 'approved');
                                  }}
                                  disabled={savingTimeOffId === entry.id}
                                  style={styles.availabilityApproveBtn}
                                >
                                  Approve
                                </button>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleTimeOffDecision(entry, 'denied');
                                  }}
                                  disabled={savingTimeOffId === entry.id}
                                  style={styles.availabilityDenyBtn}
                                >
                                  Deny
                                </button>
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {sortedDayShifts.map(shift => {
                    let startTime = 'Time TBD';
                    let endTime = 'Time TBD';
                    
                    if (shift.start_time) {
                      const timeStr = shift.start_time.length > 5 ? shift.start_time.substring(0, 5) : shift.start_time;
                      const [hours, minutes] = timeStr.split(':').map(Number);
                      const hour12 = hours % 12 || 12;
                      const ampm = hours >= 12 ? 'pm' : 'am';
                      startTime = `${hour12}:${String(minutes).padStart(2, '0')}${ampm}`;
                    }
                    
                    if (shift.end_time) {
                      const timeStr = shift.end_time.length > 5 ? shift.end_time.substring(0, 5) : shift.end_time;
                      const [hours, minutes] = timeStr.split(':').map(Number);
                      const hour12 = hours % 12 || 12;
                      const ampm = hours >= 12 ? 'pm' : 'am';
                      endTime = `${hour12}:${String(minutes).padStart(2, '0')}${ampm}`;
                    }
                    
                    const conflict = hasConflict(shift, shifts);
                    const minutes = getShiftMinutes(shift);
                    const manualPosition = shift.position && shift.position.trim().length > 0;
                    const afterHours = isAfterHoursShift(minutes, afterHoursStart);
                    let effectivePosition = manualPosition
                      ? (formatPositionDisplay(shift.position, positionNameSet) || 'No Position')
                      : null;
                    if (!effectivePosition) {
                      if (afterHours && mergedSchedulingSettings.after_hours_enabled) {
                        effectivePosition = mergedSchedulingSettings.after_hours_position;
                      } else if (autoShiftLeadId && shift.employee_id === autoShiftLeadId && mergedSchedulingSettings.shift_lead_enabled) {
                        effectivePosition = mergedSchedulingSettings.shift_lead_position;
                      } else {
                        effectivePosition = shift.position || 'No Position';
                      }
                    }
 
                    return (
                      <div
                        key={shift.id}
                        style={{
                          ...styles.shiftBlock,
                          backgroundColor: getShiftColor(shift.position),
                          opacity: shift.is_published ? 1 : 0.6,
                          border: shift.is_published ? 'none' : '2px dashed #f59e0b',
                          position: 'relative',
                          cursor: readOnly ? 'default' : 'pointer',
                        }}
                        onClick={() => { if (!readOnly) handleClickShift(shift); }}
                        draggable={!readOnly}
                        onDragStart={readOnly ? undefined : ((event) => handleShiftDragStart(event, shift.id))}
                        onDragEnd={readOnly ? undefined : clearShiftDrag}
                      >
                        {conflict && (
                          <div style={{ position: 'absolute', bottom: '4px', right: '4px', color: '#ef4444', zIndex: 10 }}>
                            <AlertTriangle size={16} fill="#ef4444" fillOpacity={0.2} />
                          </div>
                        )}
                        <div style={{ fontWeight: '600', marginBottom: '2px' }}>
                          {effectivePosition}
                          {!shift.is_published && <span style={{ fontSize: '10px', marginLeft: '4px' }}>(Pending)</span>}
                        </div>
                        <div style={{ fontSize: '14px', opacity: 0.95 }}>{startTime} - {endTime}</div>
                      </div>
                    );
                  })}
                  {!readOnly && (
                  <button
                    data-add-shift
                    style={{
                      ...styles.addButton,
                      marginTop: sortedDayShifts.length > 0 ? '8px' : 'auto',
                      opacity: 0,
                      position: sortedDayShifts.length > 0 ? 'absolute' : 'static',
                      bottom: sortedDayShifts.length > 0 ? '8px' : 'auto',
                      right: sortedDayShifts.length > 0 ? '8px' : 'auto'
                    }}
                    onClick={() => handleAddShift(day, employee.id)}
                  >
                    <Plus size={20} />
                  </button>
                  )}
                </div>
              );
            })}
          </div>
          );
        })}
      </div>

      {/* Create Shift Modal */}
      {showShiftModal && selectedDate && (
        <CreateShiftModal
          variant={shiftModalVariant}
          date={selectedDate}
          employeeId={selectedEmployee}
          employees={employees}
          availablePositions={availablePositions}
          businessId={businessId}
          weekDays={weekDays}
          saving={savingShift}
          onClose={() => setShowShiftModal(false)}
          onSave={handleSaveShift}
        />
      )}

      {/* Edit Shift Modal */}
      {showEditModal && editingShift && (
        <EditShiftModal
          shift={editingShift}
          employees={employees}
          availablePositions={availablePositions}
          businessId={businessId}
          onClose={() => {
            setShowEditModal(false);
            setEditingShift(null);
          }}
          onSave={handleEditShift}
          onDelete={handleDeleteShift}
        />
      )}

      {/* Event Modal */}
      {showEventModal && (
        <EventModal
          date={selectedDate}
          onClose={() => setShowEventModal(false)}
          onSave={handleSaveEvent}
        />
      )}
    </div>
  );
};

const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    backgroundColor: TavariStyles.colors.background
  },
  topBar: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '12px 20px',
    backgroundColor: 'white',
    borderBottom: `1px solid ${TavariStyles.colors.gray200}`
  },
  topBarLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px'
  },
  topBarRight: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px'
  },
  todayButton: {
    padding: '6px 12px',
    backgroundColor: TavariStyles.colors.primary,
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer'
  },
  navButton: {
    padding: '6px 12px',
    border: 'none',
    fontSize: '18px',
    cursor: 'pointer',
    backgroundColor: 'transparent'
  },
  weekLabel: {
    fontSize: '15px',
    fontWeight: '500',
    minWidth: '200px'
  },
  filterButton: {
    display: 'flex',
    alignItems: 'center',
    padding: '6px 12px',
    border: `1px solid ${TavariStyles.colors.gray300}`,
    borderRadius: '6px',
    cursor: 'pointer'
  },
  publishButton: {
    display: 'flex',
    alignItems: 'center',
    padding: '6px 12px',
    backgroundColor: TavariStyles.colors.primary,
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer'
  },
  addShiftToolbarButton: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '36px',
    height: '36px',
    padding: 0,
    backgroundColor: TavariStyles.colors.primary,
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer'
  },
  gridContainer: {
    flex: 1,
    overflow: 'auto',
    backgroundColor: 'white'
  },
  gridHeader: {
    display: 'grid',
    gridTemplateColumns: '200px repeat(7, 1fr)',
    backgroundColor: TavariStyles.colors.gray50,
    position: 'sticky',
    top: 0,
    zIndex: 10,
    borderBottom: `2px solid ${TavariStyles.colors.gray300}`
  },
  headerCell: {
    padding: '12px',
    textAlign: 'center',
    borderRight: `1px solid ${TavariStyles.colors.gray200}`,
    fontWeight: '600',
    fontSize: '14px'
  },
  businessHoursRow: {
    display: 'grid',
    gridTemplateColumns: '200px repeat(7, 1fr)',
    backgroundColor: '#f0fdf4',
    borderBottom: `2px solid ${TavariStyles.colors.gray300}`
  },
  businessHoursLabel: {
    display: 'flex',
    alignItems: 'center',
    padding: '12px',
    borderRight: `1px solid ${TavariStyles.colors.gray200}`,
    backgroundColor: '#f0fdf4',
    fontWeight: '600',
    fontSize: '13px'
  },
  businessHoursCell: {
    padding: '12px',
    textAlign: 'center',
    borderRight: `1px solid ${TavariStyles.colors.gray200}`,
    backgroundColor: '#f0fdf4',
    fontWeight: '500'
  },
  eventsRow: {
    display: 'grid',
    gridTemplateColumns: '200px repeat(7, 1fr)',
    backgroundColor: '#dbeafe',
    borderBottom: `2px solid ${TavariStyles.colors.gray300}`
  },
  eventsLabel: {
    display: 'flex',
    alignItems: 'center',
    padding: '12px',
    borderRight: `1px solid ${TavariStyles.colors.gray200}`,
    backgroundColor: '#dbeafe',
    fontWeight: '600',
    fontSize: '13px'
  },
  eventsCell: {
    padding: '12px',
    textAlign: 'left',
    borderRight: `1px solid ${TavariStyles.colors.gray200}`,
    backgroundColor: '#dbeafe',
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    minHeight: '60px',
    position: 'relative'
  },
  openShiftsRow: {
    display: 'grid',
    gridTemplateColumns: '200px repeat(7, 1fr)',
    backgroundColor: '#fef3c7',
    borderBottom: `2px solid ${TavariStyles.colors.gray300}`
  },
  openShiftsLabel: {
    display: 'flex',
    alignItems: 'center',
    padding: '12px',
    borderRight: `1px solid ${TavariStyles.colors.gray200}`,
    backgroundColor: '#fef3c7',
    fontWeight: '600',
    fontSize: '13px'
  },
  openShiftsCell: {
    padding: '4px',
    borderRight: `1px solid ${TavariStyles.colors.gray200}`,
    backgroundColor: '#fef3c7',
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    minHeight: '60px',
    position: 'relative'
  },
  openShiftBlock: {
    padding: '8px',
    borderRadius: '4px',
    color: 'white',
    fontSize: '16px',
    cursor: 'pointer',
    fontWeight: '600'
  },
  gridRow: {
    display: 'grid',
    gridTemplateColumns: '200px repeat(7, 1fr)',
    borderBottom: `1px solid ${TavariStyles.colors.gray200}`,
    minHeight: '60px',
    cursor: 'move',
    transition: 'opacity 0.2s'
  },
  employeeNameCell: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '12px',
    borderRight: `1px solid ${TavariStyles.colors.gray200}`,
    backgroundColor: 'white'
  },
  employeeNameLine: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    minWidth: 0
  },
  scheduleSeenIcon: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '22px',
    height: '22px',
    borderRadius: '999px',
    flexShrink: 0
  },
  scheduleSeenIconSeen: {
    color: '#15803d',
    backgroundColor: '#dcfce7',
    border: '1px solid #86efac'
  },
  scheduleSeenIconUnseen: {
    color: '#92400e',
    backgroundColor: '#fef3c7',
    border: '1px solid #fcd34d'
  },
  dragHandle: {
    color: TavariStyles.colors.gray400,
    cursor: 'grab'
  },
  dayCell: {
    padding: '4px',
    borderRight: `1px solid ${TavariStyles.colors.gray200}`,
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    minHeight: '60px',
    position: 'relative'
  },
  unavailabilityContainer: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    marginBottom: '4px'
  },
  unavailabilityBadge: {
    fontSize: '11px',
    fontWeight: 600,
    color: '#b91c1c',
    backgroundColor: '#fee2e2',
    border: '1px solid #fecaca',
    borderRadius: '4px',
    padding: '4px 6px',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    flexWrap: 'wrap'
  },
  unavailabilityBadgePending: {
    color: '#92400e',
    backgroundColor: '#fef3c7',
    border: '1px solid #fde68a'
  },
  availabilityBadgeAvailable: {
    fontSize: '11px',
    fontWeight: 600,
    color: '#1d4ed8',
    backgroundColor: '#dbeafe',
    border: '1px solid #93c5fd',
    borderRadius: '4px',
    padding: '4px 6px',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    flexWrap: 'wrap'
  },
  availabilityBadgeAvailablePending: {
    color: '#92400e',
    backgroundColor: '#fef3c7',
    border: '1px solid #fde68a'
  },
  timeOffBadge: {
    fontSize: '11px',
    fontWeight: 600,
    color: '#6b21a8',
    backgroundColor: '#f3e8ff',
    border: '1px solid #d8b4fe',
    borderRadius: '4px',
    padding: '4px 6px',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    flexWrap: 'wrap'
  },
  timeOffBadgePending: {
    color: '#92400e',
    backgroundColor: '#fef3c7',
    border: '1px solid #fde68a'
  },
  timeOffBadgeDenied: {
    fontSize: '11px',
    fontWeight: 600,
    color: '#64748b',
    backgroundColor: '#f1f5f9',
    border: '1px solid #cbd5e1',
    borderRadius: '4px',
    padding: '4px 6px',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    flexWrap: 'wrap'
  },
  availabilityDecisionActions: {
    display: 'inline-flex',
    gap: '4px',
    flexShrink: 0
  },
  availabilityApproveBtn: {
    fontSize: '10px',
    fontWeight: 700,
    padding: '2px 6px',
    borderRadius: '4px',
    border: 'none',
    cursor: 'pointer',
    backgroundColor: '#16a34a',
    color: 'white'
  },
  availabilityDenyBtn: {
    fontSize: '10px',
    fontWeight: 700,
    padding: '2px 6px',
    borderRadius: '4px',
    border: 'none',
    cursor: 'pointer',
    backgroundColor: '#dc2626',
    color: 'white'
  },
  shiftBlock: {
    padding: '8px',
    borderRadius: '4px',
    color: 'white',
    fontSize: '16px',
    cursor: 'pointer'
  },
  addButton: {
    marginTop: 'auto',
    alignSelf: 'center',
    width: '32px',
    height: '32px',
    borderRadius: '50%',
    backgroundColor: TavariStyles.colors.primary,
    color: 'white',
    border: 'none',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '18px',
    transition: 'opacity 0.15s ease'
  },
  employeeHours: {
    fontSize: '13px',
    fontWeight: 500,
    marginTop: '2px'
  },
  employeeLieu: {
    fontSize: '11px',
    fontWeight: 500,
    color: TavariStyles.colors.gray500
  }
};

// Create Shift Modal Component
const CreateShiftModal = ({
  variant = 'grid',
  date,
  employeeId,
  employees,
  availablePositions,
  businessId,
  weekDays,
  saving = false,
  onClose,
  onSave
}) => {
  const isQuickAdd = variant === 'quick';
  const sortedEmployees = useMemo(
    () => [...employees].sort((a, b) => (a.full_name || '').localeCompare(b.full_name || '')),
    [employees]
  );

  const [selectedEmployeeId, setSelectedEmployeeId] = useState(employeeId || '');
  const [shiftDateIso, setShiftDateIso] = useState(date.format('YYYY-MM-DD'));
  const resolvedEmployeeId = isQuickAdd ? selectedEmployeeId : employeeId;
  const employee = employees.find(emp => emp.id === resolvedEmployeeId);

  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('17:00');
  const [position, setPosition] = useState(employee?.position || '');
  const [notes, setNotes] = useState('');
  const [notesVisibleToStaff, setNotesVisibleToStaff] = useState(false);
  const [selectedAdditionalDates, setSelectedAdditionalDates] = useState([]);

  useEffect(() => {
    setShiftDateIso(date.format('YYYY-MM-DD'));
  }, [date]);

  useEffect(() => {
    if (isQuickAdd) {
      setSelectedEmployeeId(employeeId || '');
    }
  }, [employeeId, isQuickAdd]);

  useEffect(() => {
    setPosition(employee?.position || '');
  }, [employee?.position, employee?.id]);

  useEffect(() => {
    if (!employee?.position && !position && availablePositions.length > 0) {
      setPosition(availablePositions[0].position_name);
    }
  }, [availablePositions, employee?.position, position]);

  const buildShiftPayload = (publish = false) => ({
    start_time: `${startTime}:00`,
    end_time: `${endTime}:00`,
    position,
    notes,
    notes_visible_to_staff: notesVisibleToStaff,
    status: 'scheduled',
    additionalDates: isQuickAdd ? [] : selectedAdditionalDates,
    ...(isQuickAdd ? {
      shiftDate: shiftDateIso,
      employeeId: selectedEmployeeId,
      publish
    } : {})
  });

  const handleSubmit = (e, publish = false) => {
    e.preventDefault();
    if (isQuickAdd && !selectedEmployeeId) {
      toast.error('Select an employee');
      return;
    }
    onSave(buildShiftPayload(publish));
  };

  const toggleAdditionalDate = (dateIso) => {
    setSelectedAdditionalDates(prev => (
      prev.includes(dateIso)
        ? prev.filter(d => d !== dateIso)
        : [...prev, dateIso]
    ));
  };

  const additionalDayButtons = (weekDays || [])
    .filter(day => day.format('YYYY-MM-DD') !== date.format('YYYY-MM-DD'))
    .map(day => {
      const iso = day.format('YYYY-MM-DD');
      const isSelected = selectedAdditionalDates.includes(iso);
      return (
        <button
          key={iso}
          type="button"
          onClick={() => toggleAdditionalDate(iso)}
          style={{
            ...modalStyles.dayToggle,
            ...(isSelected ? modalStyles.dayToggleActive : {})
          }}
        >
          {day.format('ddd')} {day.format('MMM D')}
        </button>
      );
    });
 
  return (
    <div style={modalStyles.overlay} onClick={onClose}>
      <div style={modalStyles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={modalStyles.header}>
          <h2>{isQuickAdd ? 'Add Shift' : `Create Shift - ${date.format('MMM D, YYYY')}`}</h2>
          <button type="button" style={modalStyles.closeButton} onClick={onClose}>×</button>
        </div>
        <form onSubmit={(e) => handleSubmit(e, false)} style={modalStyles.form}>
          {isQuickAdd && (
            <>
              <div style={modalStyles.formGroup}>
                <label>Employee</label>
                <select
                  value={selectedEmployeeId}
                  onChange={(e) => setSelectedEmployeeId(e.target.value)}
                  required
                  style={modalStyles.input}
                >
                  <option value="">Select employee...</option>
                  {sortedEmployees.map((emp) => (
                    <option key={emp.id} value={emp.id}>{emp.full_name}</option>
                  ))}
                </select>
              </div>
              <div style={modalStyles.formGroup}>
                <label>Shift Date</label>
                <input
                  type="date"
                  value={shiftDateIso}
                  onChange={(e) => setShiftDateIso(e.target.value)}
                  required
                  style={modalStyles.input}
                />
              </div>
            </>
          )}
          <div style={modalStyles.formGroup}>
            <label>Start Time</label>
            <input
              type="time"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              required
              style={modalStyles.input}
            />
          </div>
          <div style={modalStyles.formGroup}>
            <label>End Time</label>
            <input
              type="time"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              required
              style={modalStyles.input}
            />
          </div>
          <div style={modalStyles.formGroup}>
            <label>Position</label>
            <PositionSelectWithNew
              businessId={businessId}
              positions={availablePositions}
              value={position}
              onChange={setPosition}
              required
              selectStyle={modalStyles.selectInModalRow}
              rowStyle={modalStyles.positionRow}
            />
          </div>
          <div style={modalStyles.formGroup}>
            <label>Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              style={modalStyles.textarea}
              rows="3"
            />
            <div style={{ marginTop: '12px' }}>
              <TavariCheckbox
                id="create-shift-notes-staff-visible"
                appearance="native"
                checked={notesVisibleToStaff}
                onChange={(checked) => setNotesVisibleToStaff(checked)}
                label="Show this note to employees on the punch clock and portal (after they clock in)"
              />
            </div>
          </div>
          {!isQuickAdd && additionalDayButtons.length > 0 && (
            <div style={modalStyles.multiDaySection}>
              <div style={modalStyles.multiDayLabel}>Copy this shift to other days this week</div>
              <div style={modalStyles.multiDayButtons}>
                {additionalDayButtons}
              </div>
            </div>
          )}
          <div style={modalStyles.buttonGroup}>
            <button type="button" onClick={onClose} style={modalStyles.cancelButton} disabled={saving}>Cancel</button>
            {isQuickAdd ? (
              <>
                <button type="submit" style={modalStyles.secondaryButton} disabled={saving}>
                  {saving ? 'Saving...' : 'Save'}
                </button>
                <button
                  type="button"
                  style={modalStyles.saveButton}
                  disabled={saving}
                  onClick={(e) => handleSubmit(e, true)}
                >
                  {saving ? 'Publishing...' : 'Save & Publish'}
                </button>
              </>
            ) : (
              <button type="submit" style={modalStyles.saveButton} disabled={saving}>
                {saving ? 'Creating...' : 'Create Shift'}
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
};

const modalStyles = {
  overlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
    padding: '16px',
    boxSizing: 'border-box'
  },
  modal: {
    backgroundColor: 'white',
    borderRadius: '8px',
    padding: '24px',
    maxWidth: '500px',
    width: '100%',
    maxHeight: 'min(90vh, 900px)',
    overflowY: 'auto',
    boxShadow: '0 4px 20px rgba(0, 0, 0, 0.15)',
    boxSizing: 'border-box',
    minWidth: 0
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '20px',
    gap: '12px',
    minWidth: 0
  },
  closeButton: {
    background: 'none',
    border: 'none',
    fontSize: '28px',
    cursor: 'pointer',
    color: '#666',
    flexShrink: 0
  },
  form: {
    width: '100%',
    maxWidth: '100%',
    minWidth: 0,
    boxSizing: 'border-box'
  },
  formGroup: {
    marginBottom: '16px',
    minWidth: 0,
    maxWidth: '100%'
  },
  input: {
    width: '100%',
    maxWidth: '100%',
    padding: '8px 12px',
    border: `1px solid ${TavariStyles.colors.gray300}`,
    borderRadius: '6px',
    fontSize: '14px',
    boxSizing: 'border-box'
  },
  inlineField: {
    display: 'flex',
    gap: '8px',
    alignItems: 'center'
  },
  /** Position row: select shares row with "+ New Position" without overflowing modal */
  positionRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '8px',
    alignItems: 'center',
    width: '100%',
    maxWidth: '100%',
    minWidth: 0,
    boxSizing: 'border-box'
  },
  /** Select inside modal position row — do not use width 100% (breaks flex + button) */
  selectInModalRow: {
    flex: '1 1 160px',
    minWidth: 0,
    width: 'auto',
    maxWidth: '100%',
    padding: '8px 12px',
    border: `1px solid ${TavariStyles.colors.gray300}`,
    borderRadius: '6px',
    fontSize: '14px',
    boxSizing: 'border-box'
  },
  textarea: {
    width: '100%',
    maxWidth: '100%',
    padding: '8px 12px',
    border: `1px solid ${TavariStyles.colors.gray300}`,
    borderRadius: '6px',
    fontSize: '14px',
    resize: 'vertical',
    boxSizing: 'border-box'
  },
  buttonGroup: {
    display: 'flex',
    justifyContent: 'flex-end',
    flexWrap: 'wrap',
    gap: '12px'
  },
  secondaryButton: {
    padding: '8px 12px',
    borderRadius: '6px',
    border: `1px solid ${TavariStyles.colors.primary}`,
    backgroundColor: 'white',
    color: TavariStyles.colors.primary,
    cursor: 'pointer',
    fontWeight: 600,
    whiteSpace: 'nowrap'
  },
  cancelButton: {
    padding: '10px 18px',
    borderRadius: '6px',
    border: `1px solid ${TavariStyles.colors.gray300}`,
    backgroundColor: 'white',
    cursor: 'pointer'
  },
  saveButton: {
    padding: '10px 18px',
    borderRadius: '6px',
    border: 'none',
    backgroundColor: TavariStyles.colors.primary,
    color: 'white',
    cursor: 'pointer',
    fontWeight: '600'
  },
  deleteButton: {
    padding: '10px 18px',
    borderRadius: '6px',
    border: '1px solid #fca5a5',
    backgroundColor: '#fff1f2',
    color: '#b91c1c',
    cursor: 'pointer',
    fontWeight: '600',
    fontSize: '14px',
    fontFamily: 'inherit',
    lineHeight: 1.2,
    display: 'inline-flex',
    alignItems: 'center',
    gap: '8px',
    flexShrink: 0,
    WebkitAppearance: 'none',
    appearance: 'none'
  },
  multiDaySection: {
    marginTop: '16px',
    paddingTop: '12px',
    borderTop: `1px solid ${TavariStyles.colors.gray200}`,
    display: 'flex',
    flexDirection: 'column',
    gap: '8px'
  },
  multiDayLabel: {
    fontSize: '13px',
    fontWeight: 600,
    color: TavariStyles.colors.gray600
  },
  multiDayButtons: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '8px'
  },
  dayToggle: {
    padding: '6px 12px',
    borderRadius: '6px',
    border: `1px solid ${TavariStyles.colors.gray300}`,
    backgroundColor: 'white',
    cursor: 'pointer',
    fontSize: '13px',
    fontWeight: 600,
    color: TavariStyles.colors.gray600
  },
  dayToggleActive: {
    backgroundColor: TavariStyles.colors.primary,
    borderColor: TavariStyles.colors.primary,
    color: 'white'
  }
};

// Edit Shift Modal Component
const EditShiftModal = ({ shift, employees, availablePositions, businessId, onClose, onSave, onDelete }) => {
  const [startTime, setStartTime] = useState(shift.start_time ? shift.start_time.substring(0, 5) : '09:00');
  const [endTime, setEndTime] = useState(shift.end_time ? shift.end_time.substring(0, 5) : '17:00');
  const [position, setPosition] = useState(shift.position || '');
  const [notes, setNotes] = useState(shift.notes || '');
  const [notesVisibleToStaff, setNotesVisibleToStaff] = useState(shift.notes_visible_to_staff === true);

  const handleSubmit = (e) => {
    e.preventDefault();
    onSave({
      start_time: `${startTime}:00`,
      end_time: `${endTime}:00`,
      position: position,
      notes: notes,
      notes_visible_to_staff: notesVisibleToStaff
    });
  };

  return (
    <div style={modalStyles.overlay} onClick={onClose}>
      <div style={modalStyles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={modalStyles.header}>
          <h2>Edit Shift</h2>
          <button style={modalStyles.closeButton} onClick={onClose}>×</button>
        </div>
        <form onSubmit={handleSubmit} style={modalStyles.form}>
          <div style={modalStyles.formGroup}>
            <label>Start Time</label>
            <input
              type="time"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              required
              style={modalStyles.input}
            />
          </div>
          <div style={modalStyles.formGroup}>
            <label>End Time</label>
            <input
              type="time"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              required
              style={modalStyles.input}
            />
          </div>
          <div style={modalStyles.formGroup}>
            <label>Position</label>
            <PositionSelectWithNew
              businessId={businessId}
              positions={availablePositions}
              value={position}
              onChange={setPosition}
              required
              selectStyle={modalStyles.selectInModalRow}
              rowStyle={modalStyles.positionRow}
            />
          </div>
          <div style={modalStyles.formGroup}>
            <label>Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              style={modalStyles.textarea}
              rows="3"
            />
            <div style={{ marginTop: '12px' }}>
              <TavariCheckbox
                id="edit-shift-notes-staff-visible"
                appearance="native"
                checked={notesVisibleToStaff}
                onChange={(checked) => setNotesVisibleToStaff(checked)}
                label="Show this note to employees on the punch clock and portal (after they clock in)"
              />
            </div>
          </div>
          <div style={modalStyles.buttonGroup}>
            <button type="button" onClick={onDelete} style={modalStyles.deleteButton}>
              <Trash2 size={16} aria-hidden />
              Delete
            </button>
            <button type="button" onClick={onClose} style={modalStyles.cancelButton}>Cancel</button>
            <button type="submit" style={modalStyles.saveButton}>Save Changes</button>
          </div>
        </form>
      </div>
    </div>
  );
};

// Event Modal Component
const EventModal = ({ date, onClose, onSave }) => {
  const [eventName, setEventName] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!eventName.trim()) {
      toast.error('Please enter an event name');
      return;
    }
    onSave(eventName.trim());
  };

  return (
    <div style={modalStyles.overlay} onClick={onClose}>
      <div style={modalStyles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={modalStyles.header}>
          <h2>Add Event - {date.format('MMM D, YYYY')}</h2>
          <button style={modalStyles.closeButton} onClick={onClose}>×</button>
        </div>
        <form onSubmit={handleSubmit} style={modalStyles.form}>
          <div style={modalStyles.formGroup}>
            <label>Event Name</label>
            <input
              type="text"
              value={eventName}
              onChange={(e) => setEventName(e.target.value)}
              placeholder="Enter event name..."
              required
              autoFocus
              style={modalStyles.input}
            />
          </div>
          <div style={modalStyles.buttonGroup}>
            <button type="button" onClick={onClose} style={modalStyles.cancelButton}>Cancel</button>
            <button type="submit" style={modalStyles.saveButton}>Create Event</button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default SchedulesTab; 