// src/components/Scheduling/TimesheetsTab.jsx
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { supabase } from '../../supabaseClient';
import { useBusiness } from '../../contexts/BusinessContext';
import { ChevronLeft, ChevronRight, Plus, X, Download, KeyRound, CheckCircle2, Loader2 } from 'lucide-react';
import { TavariStyles } from '../../utils/TavariStyles';
import { sendSchedulingNotification } from '../../helpers/Scheduling/schedulingNotificationService';
import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';
import {
  normalizePositionName,
  resolveShiftLeadForDay,
  getShiftLeadPremiumPayableMinutes,
  findShiftLeadPremiumPositionRow,
  getShiftLeadPremiumRateRowForKeyChainEmployee,
  getShiftLeadPremiumEarnedIntervalsMinutes,
  subtractIntervalFromIntervals,
  computeShiftLeadContext,
  intersectWorkIntervalsWithGaps
} from '../../helpers/Scheduling/shiftLeadResolution';
import PositionSelectWithNew from '../HR/PositionSelectWithNew';
import {
  saveTimesheetApproval,
  fetchTimesheetApprovalRecord
} from '../../helpers/Scheduling/timesheetApprovalService';
import { resolveEmploymentFields } from '../../utils/businessEmploymentStatus';
import { isPayrollVisibleForPeriod } from '../../utils/payrollEmployeeEligibility';
import {
  buildHybridShiftsForShiftLead,
  resolveSyntheticClockOutIso
} from '../../helpers/Scheduling/shiftLeadHybridShifts';
import {
  computePaidMinutesForClock,
  isInvalidClockPair
} from '../../helpers/Scheduling/computeClockPaidMinutes';
import { computePremiumHoursForTimecardWithDayExclusive } from '../../helpers/Payroll/premiumDayRollup';
import {
  humanizeTimeClockNoteLines,
  parseTimeClockLocationPayload,
  formatLatLngPair,
  googleMapsLink,
  summarizeGeofenceForPoint,
  formatLocationCapturedAt,
  reverseGeocodeForDisplay,
} from '../../helpers/Scheduling/timeClockManagerView';
import TimesheetCalendarPicker from './TimesheetCalendarPicker';
import {
  findMatchingShiftForTimecard,
  findPositionLinkedPremiumRow,
  getPositionLinkedHoursByRole
} from '../../helpers/Scheduling/positionLinkedPremium';

dayjs.extend(utc);
dayjs.extend(timezone);

const NOMINATIM_GAP_MS = 1100;

const serializeBreakForCompare = (breakItem) => ({
  id: breakItem.id || breakItem.temp_id || null,
  _deleted: !!breakItem._deleted,
  break_start_time: breakItem.break_start_time || '',
  break_end_time: breakItem.break_end_time || '',
  break_type: breakItem.break_type || 'meal',
  is_paid: !!breakItem.is_paid,
  notes: breakItem.notes || '',
});

/** GPS + reverse address for timecard modal (employee app location JSON). */
function TimeClockGpsManagerSection({ styles, locationPayload, businessTimezone }) {
  const loc = useMemo(() => parseTimeClockLocationPayload(locationPayload), [locationPayload]);
  const [addrIn, setAddrIn] = useState(undefined);
  const [addrOut, setAddrOut] = useState(undefined);

  useEffect(() => {
    let cancelled = false;
    setAddrIn(undefined);
    setAddrOut(undefined);

    if (!loc.clockIn && !loc.clockOut) return undefined;

    (async () => {
      let resolvedIn = null;
      if (loc.clockIn) {
        setAddrIn('loading');
        resolvedIn = await reverseGeocodeForDisplay(loc.clockIn.latitude, loc.clockIn.longitude);
        if (cancelled) return;
        setAddrIn(resolvedIn ?? '');
      } else {
        setAddrIn(undefined);
      }

      if (loc.clockOut) {
        const same =
          loc.clockIn &&
          loc.clockIn.latitude === loc.clockOut.latitude &&
          loc.clockIn.longitude === loc.clockOut.longitude;
        if (same) {
          setAddrOut(resolvedIn ?? '');
        } else {
          setAddrOut('loading');
          await new Promise((r) => setTimeout(r, NOMINATIM_GAP_MS));
          if (cancelled) return;
          const resolvedOut = await reverseGeocodeForDisplay(loc.clockOut.latitude, loc.clockOut.longitude);
          if (cancelled) return;
          setAddrOut(resolvedOut ?? '');
        }
      } else {
        setAddrOut(undefined);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [locationPayload]);

  const formatAddrCell = useCallback((state) => {
    if (state === undefined || state === 'loading') {
      return <span style={{ color: '#6b7280' }}>Looking up address…</span>;
    }
    if (state === '') return <span style={{ color: '#6b7280' }}>Address unavailable</span>;
    return <span>{state}</span>;
  }, []);

  const row = (label, pt, addressState) => {
    if (!pt) return null;
    const href = googleMapsLink(pt.latitude, pt.longitude);
    return (
      <div
        key={label}
        style={{
          marginBottom: '12px',
          padding: '12px 14px',
          backgroundColor: '#f9fafb',
          borderRadius: '8px',
          border: '1px solid #e5e7eb',
        }}
      >
        <div style={{ fontWeight: '600', marginBottom: '8px', color: '#111827' }}>{label}</div>
        <div style={{ fontSize: '14px', color: '#111827', lineHeight: 1.45, marginBottom: '8px' }}>
          <span style={{ fontWeight: '600' }}>Approximately:</span>{' '}
          {formatAddrCell(addressState)}
        </div>
        <div style={{ fontSize: '14px', color: '#374151', wordBreak: 'break-all', lineHeight: 1.45 }}>
          {formatLatLngPair(pt)}
        </div>
        {href ? (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            style={{ fontSize: '13px', marginTop: '10px', display: 'inline-block', color: '#0f766e' }}
          >
            Open in Google Maps
          </a>
        ) : null}
      </div>
    );
  };

  const gfLine = summarizeGeofenceForPoint(loc.rootGeofence);
  const whenIn =
    loc.rootCapturedAt && formatLocationCapturedAt(loc.rootCapturedAt, businessTimezone);
  const whenUp = loc.rootUpdatedAt && formatLocationCapturedAt(loc.rootUpdatedAt, businessTimezone);
  const hasPts = loc.clockIn || loc.clockOut;

  return (
    <div style={styles.section}>
      <div style={styles.sectionTitle}>GPS &amp; job site check</div>
      <p style={{ fontSize: '13px', color: '#6b7280', marginTop: 0, marginBottom: '14px', lineHeight: 1.5 }}>
        For punches from the <strong>employee app</strong>, Tavari stores GPS at clock-in and clock-out (when required).
        Approximate street addresses are looked up automatically for a quick check; open the map link to confirm. Compare
        coordinates to your geofence / job site under <strong>Scheduling → Settings → Time clock</strong>.
      </p>
      {!hasPts && !loc.legacy && !loc.rawError ? (
        <div style={{ fontSize: '14px', color: '#6b7280' }}>
          No GPS coordinates are stored for this punch (for example, a tablet kiosk punch without location, or an older
          record).
        </div>
      ) : (
        <>
          {whenIn && (
            <div style={{ fontSize: '13px', color: '#6b7280', marginBottom: '8px' }}>
              First location capture: {whenIn}
              {whenUp && whenUp !== whenIn ? ` · Last update: ${whenUp}` : ''}
            </div>
          )}
          {row('Clock in (GPS)', loc.clockIn, addrIn)}
          {row('Clock out (GPS)', loc.clockOut, addrOut)}
          {gfLine ? (
            <div
              style={{
                fontSize: '14px',
                color: '#1e3a5f',
                padding: '12px 14px',
                backgroundColor: '#eff6ff',
                borderRadius: '8px',
                border: '1px solid #bfdbfe',
                lineHeight: 1.5,
              }}
            >
              <strong>Geofence result (latest check):</strong> {gfLine}
            </div>
          ) : null}
          {loc.legacy ? (
            <div style={{ fontSize: '13px', color: '#92400e', marginTop: '8px' }}>
              Legacy location field: {loc.legacy}
            </div>
          ) : null}
          {loc.rawError && !hasPts ? (
            <div style={{ fontSize: '13px', color: '#b45309' }}>Location data could not be read.</div>
          ) : null}
          <p style={{ fontSize: '11px', color: '#9ca3af', marginTop: '12px', marginBottom: 0 }}>
            Address lookup uses OpenStreetMap (approximate; not validated against your legal site address).
          </p>
        </>
      )}
    </div>
  );
}

function mergeEmployeesFromTimecards(timecards, existingEmployees) {
  const byId = new Map((existingEmployees || []).map((employee) => [employee.id, employee]));

  for (const timecard of timecards || []) {
    if (!timecard?.employee_id || byId.has(timecard.employee_id)) continue;
    const user = timecard.users;
    byId.set(timecard.employee_id, {
      id: timecard.employee_id,
      full_name: user?.full_name || 'Unknown Employee',
      wage: parseFloat(user?.wage ?? 0),
      position: user?.position || null,
      role: 'employee',
    });
  }

  return Array.from(byId.values()).sort((a, b) => a.full_name.localeCompare(b.full_name));
}

const TimesheetsTab = ({ businessId }) => {
  const { business } = useBusiness();
  const [activeSubTab, setActiveSubTab] = useState('daily');
  const [selectedDate, setSelectedDate] = useState(dayjs().format('YYYY-MM-DD'));
  const [startDate, setStartDate] = useState(dayjs().startOf('week').format('YYYY-MM-DD'));
  const [endDate, setEndDate] = useState(dayjs().endOf('week').format('YYYY-MM-DD'));
  const [timecards, setTimecards] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [positions, setPositions] = useState([]);
  const [employeePremiums, setEmployeePremiums] = useState([]);
  const [positionPremiumRules, setPositionPremiumRules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshingTimecards, setRefreshingTimecards] = useState(false);
  const loadTimecardsRequestId = useRef(0);
  const hasLoadedTimecardsOnce = useRef(false);
  const modalBaselineRef = useRef(null);
  const [showModal, setShowModal] = useState(false);
  const [selectedTimecard, setSelectedTimecard] = useState(null);
  const [editingMode, setEditingMode] = useState(false);
  
  // Modal state
  const [modalDate, setModalDate] = useState('');
  const [modalEmployee, setModalEmployee] = useState('');
  const [modalClockIn, setModalClockIn] = useState('');
  const [modalClockOut, setModalClockOut] = useState('');
  const [modalPosition, setModalPosition] = useState('');
  const [modalShiftStatus, setModalShiftStatus] = useState('scheduled');
  const [modalNotes, setModalNotes] = useState('');
  const [modalBreaks, setModalBreaks] = useState([]);
  const [modalPhotos, setModalPhotos] = useState([]);
  const [modalEditHistory, setModalEditHistory] = useState([]);
  const [businessTimezone, setBusinessTimezone] = useState('America/Toronto');
  const [schedulingSettings, setSchedulingSettings] = useState(null);
  const [operatingHours, setOperatingHours] = useState(null);
  const [scheduleShiftsForRange, setScheduleShiftsForRange] = useState([]);
  const [shiftPremiumRatesById, setShiftPremiumRatesById] = useState({});
  const [shiftPremiumDefsByName, setShiftPremiumDefsByName] = useState({});
  const [timesheetApproval, setTimesheetApproval] = useState(null);
  const [approvingTimesheets, setApprovingTimesheets] = useState(false);

  const acceptedMissedBreakNote = 'Missed break accepted as paid';

  const approvalPeriodStart = activeSubTab === 'daily' ? selectedDate : startDate;
  const approvalPeriodEnd = activeSubTab === 'daily' ? selectedDate : endDate;

  useEffect(() => {
    if (businessId) {
      loadBusinessTimezone();
      loadPositions();
      loadEmployeePremiums();
      loadPositionPremiumRules();
      loadSchedulingContext();
      loadShiftPremiumRates();
    }
  }, [businessId]);

  useEffect(() => {
    if (businessId) {
      loadEmployees();
    }
  }, [businessId, startDate, selectedDate, activeSubTab]);

  useEffect(() => {
    if (!businessId || !approvalPeriodStart || !approvalPeriodEnd) {
      setTimesheetApproval(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const row = await fetchTimesheetApprovalRecord(
          businessId,
          approvalPeriodStart,
          approvalPeriodEnd
        );
        if (!cancelled) setTimesheetApproval(row || null);
      } catch {
        if (!cancelled) setTimesheetApproval(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [businessId, approvalPeriodStart, approvalPeriodEnd]);

  const loadBusinessTimezone = async () => {
    try {
      const { data, error } = await supabase
        .from('businesses')
        .select('timezone')
        .eq('id', businessId)
        .single();

      if (error) throw error;
      if (data?.timezone) {
        setBusinessTimezone(data.timezone);
      }
    } catch (error) {
      console.error('Error loading business timezone:', error);
    }
  };

  useEffect(() => {
    if (businessId && businessTimezone) {
      loadTimecards();
    }
  }, [businessId, selectedDate, startDate, endDate, activeSubTab, businessTimezone]);

  useEffect(() => {
    hasLoadedTimecardsOnce.current = false;
  }, [businessId]);

  const loadSchedulingContext = async () => {
    if (!businessId) return;
    try {
      const [{ data: ss }, { data: biz }] = await Promise.all([
        supabase.from('scheduling_settings').select('*').eq('business_id', businessId).maybeSingle(),
        supabase.from('businesses').select('operating_hours').eq('id', businessId).maybeSingle()
      ]);
      setSchedulingSettings(ss || null);
      setOperatingHours(biz?.operating_hours || null);
    } catch (e) {
      console.warn('Scheduling context load:', e?.message || e);
    }
  };

  const loadShiftPremiumRates = async () => {
    if (!businessId) return;
    try {
      const { data, error } = await supabase
        .from('hr_shift_premiums')
        .select('*')
        .eq('business_id', businessId)
        .eq('is_active', true);
      if (error) throw error;
      const map = {};
      const byName = {};
      (data || []).forEach((row) => {
        map[row.id] = {
          rate: parseFloat(row.rate) || 0,
          name: row.name || 'Shift premium'
        };
        byName[row.name] = row;
      });
      setShiftPremiumRatesById(map);
      setShiftPremiumDefsByName(byName);
    } catch (e) {
      console.warn('Shift premiums load:', e?.message || e);
    }
  };

  const loadEmployees = async () => {
    if (!businessId) return;
    const periodStart = activeSubTab === 'daily' ? selectedDate : startDate;
    try {
      const { data, error } = await supabase
        .from('business_users')
        .select(`
          user_id,
          role,
          employment_status,
          termination_date,
          users!business_users_user_id_fkey (
            id,
            full_name,
            wage,
            position,
            is_active,
            employment_status,
            termination_date,
            hire_date
          )
        `)
        .eq('business_id', businessId);

      if (error) throw error;

      const { data: businessIdUsers, error: businessIdUsersError } = await supabase
        .from('users')
        .select('id, full_name, wage, position, is_active, employment_status, termination_date, hire_date')
        .eq('business_id', businessId);

      if (businessIdUsersError) {
        console.warn('Direct business employee load failed:', businessIdUsersError?.message);
      }

      const employeeMap = new Map();

      (data || [])
        .filter((entry) => {
          if (!entry.users) return false;
          if (entry.users.is_active === false) return false;
          const resolved = resolveEmploymentFields({ membership: entry, user: entry.users });
          return isPayrollVisibleForPeriod(resolved, periodStart);
        })
        .forEach((entry) => {
          employeeMap.set(entry.users.id, {
            id: entry.users.id,
            full_name: entry.users.full_name,
            wage: parseFloat(entry.users.wage ?? 0),
            position: entry.users.position || null,
            role: entry.role || 'employee'
          });
        });

      (businessIdUsers || [])
        .filter((user) => {
          if (user.is_active === false) return false;
          return isPayrollVisibleForPeriod(user, periodStart);
        })
        .forEach((user) => {
          if (!employeeMap.has(user.id)) {
            employeeMap.set(user.id, {
              id: user.id,
              full_name: user.full_name,
              wage: parseFloat(user.wage ?? 0),
              position: user.position || null,
              hireDate: user.hire_date || null,
              role: 'employee'
            });
          }
        });

      setEmployees(Array.from(employeeMap.values()).sort((a, b) => a.full_name.localeCompare(b.full_name)));
    } catch (error) {
      console.error('Error loading employees:', error);
    }
  };

  const loadPositions = async () => {
    try {
      const { data, error } = await supabase
        .from('positions')
        .select('*')
        .eq('business_id', businessId)
        .eq('is_active', true)
        .order('position_name', { ascending: true });

      if (error) throw error;
      const raw = data || [];
      setPositions(
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

  const loadEmployeePremiums = async () => {
    try {
      const { data, error } = await supabase
        .from('hrpayroll_employee_premiums')
        .select('*')
        .eq('business_id', businessId)
        .eq('is_active', true);

      if (error) throw error;
      setEmployeePremiums(data || []);
    } catch (error) {
      console.error('Error loading employee premiums:', error);
    }
  };

  const loadPositionPremiumRules = async () => {
    try {
      const { data, error } = await supabase
        .from('position_premium_rules')
        .select('*')
        .eq('business_id', businessId)
        .eq('is_active', true);

      if (error) throw error;
      setPositionPremiumRules(data || []);
    } catch (error) {
      console.error('Error loading position premium rules:', error);
    }
  };

  // Get employee's role from the database
  const getEmployeeRole = (employee) => {
    return employee?.role || 'employee';
  };

  // Check if employee has specific roles clocked in during the time period
  const hasRolesOnSite = async (timecard, rolesToCheck) => {
    if (!rolesToCheck || rolesToCheck.length === 0) return false;
    
    try {
      // Get the time range for this shift
      const startTime = dayjs(timecard.clock_in_time).toISOString();
      const endTime = timecard.clock_out_time 
        ? dayjs(timecard.clock_out_time).toISOString() 
        : dayjs().toISOString();
      
      // Query all timecards that overlap with this shift
      const { data: overlappingTimecards } = await supabase
        .from('scheduling_time_clocks')
        .select(`
          id,
          employee_id,
          clock_in_time,
          clock_out_time,
          users!inner(id, email)
        `)
        .eq('business_id', businessId)
        .gte('clock_in_time', startTime)
        .lt('clock_in_time', endTime)
        .neq('employee_id', timecard.employee_id);
      
      if (!overlappingTimecards || overlappingTimecards.length === 0) return false;
      
      // Check if any of these employees have the restricted roles
      // Note: This requires employee roles to be loaded/available
      // For now, we'll need to check employees array for roles
      const overlappingEmployeeIds = overlappingTimecards.map(tc => tc.employee_id);
      const overlappingEmployees = employees.filter(emp => overlappingEmployeeIds.includes(emp.id));
      
      for (const emp of overlappingEmployees) {
        const empRole = getEmployeeRole(emp);
        if (rolesToCheck.includes(empRole)) {
          return true;
        }
      }
      
      return false;
    } catch (error) {
      console.error('Error checking on-site roles:', error);
      return false;
    }
  };

  const defaultSchedulingSettings = useMemo(
    () => ({
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
      after_hours_grace_after_close: 0
    }),
    []
  );

  const mergedSchedulingSettings = useMemo(() => {
    const s = schedulingSettings || {};
    return {
      ...defaultSchedulingSettings,
      ...s,
      shift_lead_excluded_positions:
        s.shift_lead_excluded_positions?.length > 0
          ? s.shift_lead_excluded_positions
          : defaultSchedulingSettings.shift_lead_excluded_positions
    };
  }, [schedulingSettings, defaultSchedulingSettings]);

  const shiftsForShiftLeadResolution = useMemo(() => {
    const rs = activeSubTab === 'daily' ? selectedDate : startDate;
    const re = activeSubTab === 'daily' ? selectedDate : endDate;
    return buildHybridShiftsForShiftLead(
      timecards,
      scheduleShiftsForRange,
      rs,
      re,
      businessTimezone,
      operatingHours
    );
  }, [
    timecards,
    scheduleShiftsForRange,
    activeSubTab,
    selectedDate,
    startDate,
    endDate,
    businessTimezone,
    operatingHours
  ]);

  const shiftLeadWinnerByDate = useMemo(() => {
    const out = {};
    const rangeStart = activeSubTab === 'daily' ? selectedDate : startDate;
    const rangeEnd = activeSubTab === 'daily' ? selectedDate : endDate;
    const empMap = new Map(employees.map((e) => [e.id, e]));
    let cur = dayjs(rangeStart);
    const endD = dayjs(rangeEnd);
    while (cur.valueOf() <= endD.valueOf()) {
      const key = cur.format('YYYY-MM-DD');
      const dayShifts = shiftsForShiftLeadResolution.filter((s) => s.shift_date === key);
      out[key] = resolveShiftLeadForDay({
        day: cur,
        shifts: dayShifts,
        employeeById: empMap,
        positions,
        schedulingSettings: mergedSchedulingSettings,
        businessHours: operatingHours
      });
      cur = cur.add(1, 'day');
    }
    return out;
  }, [
    shiftsForShiftLeadResolution,
    employees,
    positions,
    mergedSchedulingSettings,
    operatingHours,
    activeSubTab,
    selectedDate,
    startDate,
    endDate
  ]);

  const getTimecardDate = (timecard) => {
    return dayjs(timecard.clock_in_time).tz(businessTimezone).format('YYYY-MM-DD');
  };

  const getShiftDateTime = (shift, timeField) => {
    if (!shift?.shift_date || !shift?.[timeField]) return null;
    return dayjs.tz(`${shift.shift_date}T${shift[timeField]}`, businessTimezone).toISOString();
  };

  const getTimecardPosition = (timecard, employee) => {
    return timecard.scheduled_shift?.position || timecard.position || employee?.position || '-';
  };

  const getTimecardEmployee = (timecard) => {
    const loadedEmployee = employees.find(e => e.id === timecard.employee_id);
    if (loadedEmployee) return loadedEmployee;

    if (timecard.users) {
      return {
        id: timecard.users.id,
        full_name: timecard.users.full_name,
        wage: parseFloat(timecard.users.wage ?? 0),
        position: timecard.users.position || null,
        role: 'employee'
      };
    }

    if (timecard.employee_id) {
      return {
        id: timecard.employee_id,
        full_name: 'Unknown Employee',
        wage: 0,
        position: null,
        role: 'employee'
      };
    }

    return null;
  };

  const createScheduledShiftTimecard = (shift) => ({
    id: `scheduled-shift-${shift.id}`,
    business_id: shift.business_id,
    employee_id: shift.employee_id,
    clock_in_time: getShiftDateTime(shift, 'start_time'),
    clock_out_time: getShiftDateTime(shift, 'end_time'),
    notes: shift.notes || '',
    users: shift.users,
    breaks: [],
    scheduled_shift: shift,
    is_scheduled_placeholder: true
  });

  const findMatchingShift = (timecard, shifts) =>
    findMatchingShiftForTimecard(timecard, shifts, businessTimezone);

  const loadTimecards = async () => {
    const requestId = ++loadTimecardsRequestId.current;
    try {
      if (hasLoadedTimecardsOnce.current) {
        setRefreshingTimecards(true);
      } else {
        setLoading(true);
      }
      const rangeStartDate = activeSubTab === 'daily' ? selectedDate : startDate;
      const rangeEndDate = activeSubTab === 'daily' ? selectedDate : endDate;
      let query = supabase
        .from('scheduling_time_clocks')
        .select(`
          *,
          users!scheduling_time_clocks_employee_id_fkey (
            id,
            full_name,
            wage,
            position
          )
        `)
        .eq('business_id', businessId)
        .order('clock_in_time', { ascending: false });

      if (activeSubTab === 'daily') {
        const start = dayjs.tz(`${selectedDate}T00:00:00`, businessTimezone).toISOString();
        const end = dayjs.tz(`${selectedDate}T23:59:59`, businessTimezone).toISOString();
        query = query
          .gte('clock_in_time', start)
          .lt('clock_in_time', end);
      } else {
        const start = dayjs.tz(`${startDate}T00:00:00`, businessTimezone).toISOString();
        const end = dayjs.tz(`${endDate}T23:59:59`, businessTimezone).toISOString();
        query = query
          .gte('clock_in_time', start)
          .lte('clock_in_time', end);
      }

      const { data, error } = await query;

      if (error) throw error;

      const { data: shifts, error: shiftsError } = await supabase
        .from('scheduling_shifts')
        .select(`
          id,
          business_id,
          employee_id,
          shift_date,
          start_time,
          end_time,
          position,
          status,
          notes,
          notes_visible_to_staff,
          break_duration_minutes,
          users!scheduling_shifts_employee_id_fkey (
            id,
            full_name,
            wage,
            position
          )
        `)
        .eq('business_id', businessId)
        .gte('shift_date', rangeStartDate)
        .lte('shift_date', rangeEndDate);

      if (shiftsError) throw shiftsError;

      // Load breaks for each timecard
      const timecardsWithBreaks = await Promise.all(
        (data || []).map(async (timecard) => {
          try {
            const { data: breaks } = await supabase
              .from('scheduling_break_tracking')
              .select('*')
              .eq('time_clock_id', timecard.id)
              .order('break_start_at', { ascending: true });

            return {
              ...timecard,
              scheduled_shift: findMatchingShift(timecard, shifts || []),
              breaks: breaks || []
            };
          } catch (error) {
            console.error('Error loading breaks for timecard:', error);
            return {
              ...timecard,
              scheduled_shift: findMatchingShift(timecard, shifts || []),
              breaks: []
            };
          }
        })
      );

      const timecardShiftIds = new Set(
        timecardsWithBreaks
          .map((timecard) => timecard.scheduled_shift?.id)
          .filter(Boolean)
      );
      const placeholderStatuses = ['scheduled', 'confirmed', 'sick', 'no_show', 'cancelled'];
      const scheduledShiftPlaceholders = (shifts || [])
        .filter((shift) => shift.employee_id)
        .filter((shift) => !timecardShiftIds.has(shift.id))
        .filter((shift) => placeholderStatuses.includes(shift.status || 'scheduled'))
        .map(createScheduledShiftTimecard);

      if (requestId !== loadTimecardsRequestId.current) return;

      setScheduleShiftsForRange(shifts || []);
      const mergedTimecards = [...timecardsWithBreaks, ...scheduledShiftPlaceholders];
      setTimecards(mergedTimecards);
      setEmployees((prev) => mergeEmployeesFromTimecards(mergedTimecards, prev));
    } catch (error) {
      if (requestId === loadTimecardsRequestId.current) {
        console.error('Error loading timecards:', error);
      }
    } finally {
      if (requestId === loadTimecardsRequestId.current) {
        setLoading(false);
        setRefreshingTimecards(false);
        hasLoadedTimecardsOnce.current = true;
      }
    }
  };

  const calculateBreakMinutes = (breaks) => {
    if (!breaks || breaks.length === 0) return 0;
    return breaks.reduce((total, breakItem) => {
      if (breakItem.duration_minutes && !breakItem.is_paid) {
        return total + breakItem.duration_minutes;
      }
      return total;
    }, 0);
  };

  const mergeIntervalsLocal = (intervals) => {
    if (!intervals?.length) return [];
    const sorted = [...intervals].sort((a, b) => a.start - b.start);
    const out = [];
    let cur = { ...sorted[0] };
    for (let i = 1; i < sorted.length; i++) {
      const n = sorted[i];
      if (n.start <= cur.end) cur.end = Math.max(cur.end, n.end);
      else {
        out.push(cur);
        cur = { ...n };
      }
    }
    out.push(cur);
    return out;
  };

  const effectiveClockOutIso = (timecard) => {
    if (timecard?.clock_out_time) return timecard.clock_out_time;
    if (!timecard?.clock_in_time || timecard.is_scheduled_placeholder) return null;
    const dateKey = dayjs(timecard.clock_in_time).tz(businessTimezone).format('YYYY-MM-DD');
    return resolveSyntheticClockOutIso({
      dateKey,
      clockInIso: timecard.clock_in_time,
      businessTimezone,
      operatingHours
    });
  };

  /** Paid work intervals (minutes from midnight) minus unpaid breaks that have start/end timestamps. */
  const buildPaidWorkIntervalsMinutes = (timecard) => {
    const coIso = effectiveClockOutIso(timecard);
    if (!timecard?.clock_in_time || !coIso) return [];
    const ci = dayjs(timecard.clock_in_time).tz(businessTimezone);
    const co = dayjs(coIso).tz(businessTimezone);
    if (!ci.isValid() || !co.isValid()) return [];
    const toMin = (d) => d.hour() * 60 + d.minute() + d.second() / 60;
    let startM = toMin(ci);
    let endM = toMin(co);
    if (endM <= startM) endM += 24 * 60;
    let intervals = [{ start: startM, end: endM }];
    const breaks = timecard.breaks || [];
    for (const b of breaks) {
      if (b.is_paid || b.break_type === 'paid') continue;
      if (!(b.break_start_at && b.break_end_at)) continue;
      const bs = dayjs(b.break_start_at).tz(businessTimezone);
      const be = dayjs(b.break_end_at).tz(businessTimezone);
      let bsM = toMin(bs);
      let beM = toMin(be);
      if (beM <= bsM) beM += 24 * 60;
      intervals = subtractIntervalFromIntervals(intervals, { start: bsM, end: beM });
    }
    return mergeIntervalsLocal(intervals).filter((i) => i.end > i.start);
  };

  // Calculate total paid hours (regular + overtime - breaks - lieu hours)
  const calculateTotalPaidHours = (timecard) => {
    if (timecard.is_scheduled_placeholder) return 0;
    const outIso = effectiveClockOutIso(timecard);
    if (!outIso) return 0;

    const paidMinutes = computePaidMinutesForClock({
      clockInIso: timecard.clock_in_time,
      clockOutIso: outIso,
      breakRows: timecard.breaks
    });
    return paidMinutes / 60;
  };

  const hasPaidBreakResolution = (breaks) => {
    return (breaks || []).some((breakItem) => breakItem.is_paid && !breakItem._deleted);
  };

  const calculateDiscrepancies = (timecard) => {
    const discrepancies = [];

    if (timecard.scheduled_shift?.status === 'sick') {
      discrepancies.push('Sick');
      return discrepancies;
    }

    if (timecard.is_scheduled_placeholder) {
      discrepancies.push('Scheduled - No Clock In');
      return discrepancies;
    }
    
    // Check for missing clock out
    if (!timecard.clock_out_time) {
      discrepancies.push('Missed Clock Out');
    } else if (isInvalidClockPair(timecard.clock_in_time, timecard.clock_out_time)) {
      discrepancies.push('Invalid Clock Out');
    }
    
    // Check for no show (clock in time is too late - could be customized based on schedule)
    // For now, checking if clock in is significantly late (more than 4 hours late)
    // You can customize this logic based on your business rules
    
    // Check for missed break (if shift is longer than 6 hours and no breaks)
    if (timecard.clock_out_time) {
      const shiftMinutes = calculateMinutes(timecard.clock_in_time, timecard.clock_out_time);
      const breakMinutes = calculateBreakMinutes(timecard.breaks);
      
      if (shiftMinutes > 360 && breakMinutes === 0 && !hasPaidBreakResolution(timecard.breaks)) {
        discrepancies.push('Missed Break');
      }
    }
    
    // Check for breaks without end time
    if (timecard.breaks && timecard.breaks.length > 0) {
      const incompleteBreaks = timecard.breaks.filter(b => !b.break_end_at);
      if (incompleteBreaks.length > 0) {
        discrepancies.push('Open Break');
      }
    }
    
    return discrepancies;
  };

  const handleApproveTimesheets = async () => {
    if (!businessId || !approvalPeriodStart || !approvalPeriodEnd) return;
    try {
      const {
        data: { user },
        error: authErr
      } = await supabase.auth.getUser();
      if (authErr || !user?.id) {
        window.alert('You must be signed in to approve time sheets.');
        return;
      }
      setApprovingTimesheets(true);
      await saveTimesheetApproval({
        businessId,
        periodStart: approvalPeriodStart,
        periodEnd: approvalPeriodEnd,
        approvedByUserId: user.id,
        notes: null
      });
      const row = await fetchTimesheetApprovalRecord(
        businessId,
        approvalPeriodStart,
        approvalPeriodEnd
      );
      setTimesheetApproval(row || null);
      window.alert(
        `Time sheets approved for ${approvalPeriodStart} through ${approvalPeriodEnd}. Payroll can use this snapshot when the pay period matches these dates.`
      );
    } catch (e) {
      console.error('Approve time sheets:', e);
      window.alert(e?.message || 'Could not approve time sheets.');
    } finally {
      setApprovingTimesheets(false);
    }
  };

  const exportToCSV = () => {
    // Prepare CSV data
    const csvRows = [];
    
    // CSV Headers
    csvRows.push(
      [
        'Employee',
        'Date',
        'Scheduled Shift',
        'Pay component',
        'Rate ($/hr)',
        'Clock In/Out',
        'Discrepancies',
        'Hours',
        'Estimated wages'
      ].join(',')
    );
    
    // Group timecards by employee
    const groupedByEmployee = {};
    timecards.forEach(timecard => {
      const employee = getTimecardEmployee(timecard);
      const employeeName = employee?.full_name || 'Unknown Employee';
      
      if (!groupedByEmployee[employeeName]) {
        groupedByEmployee[employeeName] = [];
      }
      groupedByEmployee[employeeName].push({ timecard, employee });
    });
    
    // CSV Rows
    Object.entries(groupedByEmployee)
      .sort(([nameA], [nameB]) => nameA.localeCompare(nameB))
      .forEach(([employeeName, employeeData]) => {
      const employee = employeeData[0]?.employee;
      let employeeTotalHours = 0;
      let employeeTotalWages = 0;
      
      const sortedEmployeeData = [...employeeData].sort((a, b) =>
        dayjs(a.timecard.clock_in_time).valueOf() - dayjs(b.timecard.clock_in_time).valueOf()
      );

      sortedEmployeeData.forEach(({ timecard }) => {
        const position = getTimecardPosition(timecard, employee);
        const discrepancies = calculateDiscrepancies(timecard);
        const breakdown = buildWageLineItems(timecard, employee, position);

        employeeTotalHours += breakdown.cardPaidHours;
        employeeTotalWages += breakdown.totalEstimated;

        const date = dayjs(timecard.clock_in_time).tz(businessTimezone).format('MMM D, YYYY');
        const discrepanciesText = discrepancies.length > 0 ? discrepancies.join('; ') : '';
        const scheduledShiftText = formatScheduledShiftForCsv(timecard);

        breakdown.lines.forEach((line, idx) => {
          csvRows.push(
            [
              employeeName,
              idx === 0 ? date : '',
              idx === 0 ? scheduledShiftText : '',
              line.label,
              `$${line.rate.toFixed(2)}`,
              line.clockLabel,
              idx === 0 ? discrepanciesText : '',
              line.hours.toFixed(2),
              `$${line.estimated.toFixed(2)}`
            ]
              .map((field) => `"${String(field).replace(/"/g, '""')}"`)
              .join(',')
          );
        });
      });
      
      // Add totals row for employee
      csvRows.push([
        employeeName,
        'TOTAL',
        '-',
        '-',
        '-',
        '-',
        '-',
        `${employeeTotalHours.toFixed(2)} hrs`,
        `$${employeeTotalWages.toFixed(2)}`
      ].map(field => `"${field}"`).join(','));
      
      // Add empty row for spacing
      csvRows.push([]);
    });
    
    // Create CSV content
    const csvContent = csvRows.join('\n');
    
    // Create blob and download
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    
    link.setAttribute('href', url);
    link.setAttribute('download', `timesheets_${dayjs().format('YYYY-MM-DD')}.csv`);
    link.style.visibility = 'hidden';
    
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const normalizeBreakType = (breakType) => {
    if (['meal', 'rest', 'other'].includes(breakType)) return breakType;
    if (breakType === 'paid') return 'rest';
    return 'meal';
  };

  const formatBreakForModal = (breakItem) => ({
    ...breakItem,
    break_start_time: breakItem.break_start_at
      ? dayjs(breakItem.break_start_at).tz(businessTimezone).format('HH:mm')
      : '',
    break_end_time: breakItem.break_end_at
      ? dayjs(breakItem.break_end_at).tz(businessTimezone).format('HH:mm')
      : '',
    break_type: normalizeBreakType(breakItem.break_type),
    is_paid: breakItem.is_paid || breakItem.break_type === 'paid',
    notes: breakItem.notes || ''
  });

  const buildModalBaselineFromTimecard = (timecard, employee) => ({
    modalDate: dayjs(timecard.clock_in_time).tz(businessTimezone).format('YYYY-MM-DD'),
    modalClockIn: dayjs(timecard.clock_in_time).tz(businessTimezone).format('HH:mm'),
    modalClockOut: timecard.clock_out_time
      ? dayjs(timecard.clock_out_time).tz(businessTimezone).format('HH:mm')
      : '',
    modalPosition: getTimecardPosition(timecard, employee) || '',
    modalShiftStatus: timecard.scheduled_shift?.status || 'scheduled',
    modalNotes: timecard.notes || '',
    modalBreaks: (timecard.breaks || []).map(formatBreakForModal).map(serializeBreakForCompare),
  });

  const captureModalBaseline = (timecard, employee) => {
    modalBaselineRef.current = buildModalBaselineFromTimecard(timecard, employee);
  };

  const getCurrentModalSnapshot = () => ({
    modalDate,
    modalClockIn,
    modalClockOut,
    modalPosition,
    modalShiftStatus,
    modalNotes,
    modalBreaks: modalBreaks.map(serializeBreakForCompare),
  });

  const isModalDirty = () => {
    if (!modalBaselineRef.current) return false;
    return JSON.stringify(getCurrentModalSnapshot()) !== JSON.stringify(modalBaselineRef.current);
  };

  const employeeTimecardNavList = useMemo(() => {
    if (!selectedTimecard?.employee_id) return [];
    return timecards
      .filter((timecard) => timecard.employee_id === selectedTimecard.employee_id)
      .sort((a, b) => dayjs(a.clock_in_time).valueOf() - dayjs(b.clock_in_time).valueOf());
  }, [timecards, selectedTimecard?.employee_id]);

  const currentTimecardNavIndex = useMemo(() => {
    if (!selectedTimecard?.id) return -1;
    return employeeTimecardNavList.findIndex((timecard) => timecard.id === selectedTimecard.id);
  }, [employeeTimecardNavList, selectedTimecard?.id]);

  const showTimecardNav = editingMode && selectedTimecard && employeeTimecardNavList.length > 1;
  const canNavigatePrevTimecard = showTimecardNav && currentTimecardNavIndex > 0;
  const canNavigateNextTimecard = showTimecardNav
    && currentTimecardNavIndex >= 0
    && currentTimecardNavIndex < employeeTimecardNavList.length - 1;

  const closeTimecardModal = () => {
    modalBaselineRef.current = null;
    setShowModal(false);
  };

  const handleAttemptCloseModal = () => {
    if (isModalDirty()) {
      const discard = window.confirm(
        'You have unsaved changes on this timecard. Discard them and close?'
      );
      if (!discard) return;
    }
    closeTimecardModal();
  };

  const handleNavigateTimecard = async (direction) => {
    if (!showTimecardNav || currentTimecardNavIndex < 0) return;
    const nextIndex = currentTimecardNavIndex + direction;
    if (nextIndex < 0 || nextIndex >= employeeTimecardNavList.length) return;

    if (isModalDirty()) {
      const discard = window.confirm(
        'You have unsaved changes on this timecard. Discard them and open the other timecard?'
      );
      if (!discard) return;
    }

    await handleOpenTimecard(employeeTimecardNavList[nextIndex]);
  };

  const handleOpenTimecard = async (timecard) => {
    const employee = getTimecardEmployee(timecard);
    setSelectedTimecard(timecard);
    setEditingMode(true);
    setModalDate(dayjs(timecard.clock_in_time).tz(businessTimezone).format('YYYY-MM-DD'));
    setModalEmployee(timecard.employee_id);
    setModalClockIn(dayjs(timecard.clock_in_time).tz(businessTimezone).format('HH:mm'));
    setModalClockOut(timecard.clock_out_time ? dayjs(timecard.clock_out_time).tz(businessTimezone).format('HH:mm') : '');
    setModalPosition(getTimecardPosition(timecard, employee) || '');
    setModalShiftStatus(timecard.scheduled_shift?.status || 'scheduled');
    setModalNotes(timecard.notes || '');
    setModalBreaks((timecard.breaks || []).map(formatBreakForModal));
    captureModalBaseline(timecard, employee);
    
    if (timecard.is_scheduled_placeholder) {
      setModalPhotos([]);
      setModalEditHistory([]);
      setShowModal(true);
      return;
    }

    // Load photos from timecard and breaks
    const photoEntries = [];
    
    const isEmployeeAppPunch = String(timecard.device_type || '') === 'employee_app';

    // Clock in — selfie then workplace (rear) for employee app / when stored
    if (timecard.photo_verification_url) {
      photoEntries.push({
        event: 'Clock In (selfie)',
        hasPhoto: true,
        url: timecard.photo_verification_url,
        timestamp: timecard.clock_in_time,
      });
    } else {
      photoEntries.push({ event: 'Clock In (selfie)', hasPhoto: false, timestamp: timecard.clock_in_time });
    }
    if (isEmployeeAppPunch || timecard.clock_in_environment_photo_url) {
      if (timecard.clock_in_environment_photo_url) {
        photoEntries.push({
          event: 'Clock In (workplace)',
          hasPhoto: true,
          url: timecard.clock_in_environment_photo_url,
          timestamp: timecard.clock_in_time,
        });
      } else {
        photoEntries.push({ event: 'Clock In (workplace)', hasPhoto: false, timestamp: timecard.clock_in_time });
      }
    }
    
    // Break photos or placeholders
    if (timecard.breaks && timecard.breaks.length > 0) {
      timecard.breaks.forEach((breakItem, idx) => {
        // Break start
        if (breakItem.photo_url_start) {
          photoEntries.push({ event: `Break ${idx + 1} - Out`, hasPhoto: true, url: breakItem.photo_url_start, timestamp: breakItem.break_start_at });
        } else {
          photoEntries.push({ event: `Break ${idx + 1} - Out`, hasPhoto: false, timestamp: breakItem.break_start_at });
        }
        
        // Break end
        if (breakItem.break_end_at) {
          if (breakItem.photo_url_end) {
            photoEntries.push({ event: `Break ${idx + 1} - In`, hasPhoto: true, url: breakItem.photo_url_end, timestamp: breakItem.break_end_at });
          } else {
            photoEntries.push({ event: `Break ${idx + 1} - In`, hasPhoto: false, timestamp: breakItem.break_end_at });
          }
        }
      });
    }
    
    // Clock out — selfie then workplace (rear) for employee app / when stored
    if (timecard.clock_out_time) {
      if (timecard.clock_out_photo_url) {
        photoEntries.push({
          event: 'Clock Out (selfie)',
          hasPhoto: true,
          url: timecard.clock_out_photo_url,
          timestamp: timecard.clock_out_time,
        });
      } else {
        photoEntries.push({ event: 'Clock Out (selfie)', hasPhoto: false, timestamp: timecard.clock_out_time });
      }
      if (isEmployeeAppPunch || timecard.clock_out_environment_photo_url) {
        if (timecard.clock_out_environment_photo_url) {
          photoEntries.push({
            event: 'Clock Out (workplace)',
            hasPhoto: true,
            url: timecard.clock_out_environment_photo_url,
            timestamp: timecard.clock_out_time,
          });
        } else {
          photoEntries.push({ event: 'Clock Out (workplace)', hasPhoto: false, timestamp: timecard.clock_out_time });
        }
      }
    }
    
    setModalPhotos(photoEntries);
    
    // Load edit history
    await loadEditHistory(timecard.id);
    
    setShowModal(true);
  };

  const loadEditHistory = async (timecardId) => {
    try {
      const { data, error } = await supabase
        .from('scheduling_time_clocks_audit')
        .select('*')
        .eq('time_clock_id', timecardId)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Error loading edit history:', error);
        setModalEditHistory([]);
        return;
      }

      // Load user names separately
      if (data && data.length > 0) {
        const userIds = [...new Set(data.map(item => item.changed_by))];
        const { data: userData } = await supabase
          .from('users')
          .select('id, full_name')
          .in('id', userIds);

        const userMap = {};
        userData?.forEach(user => {
          userMap[user.id] = user.full_name;
        });

        const historyWithUsers = data.map(item => ({
          ...item,
          changed_by_name: userMap[item.changed_by] || 'Unknown User'
        }));

        setModalEditHistory(historyWithUsers);
      } else {
        setModalEditHistory([]);
      }
    } catch (error) {
      console.error('Error loading edit history:', error);
      setModalEditHistory([]);
    }
  };

  const handleAddNewTimecard = () => {
    modalBaselineRef.current = null;
    setSelectedTimecard(null);
    setEditingMode(false);
    setModalDate(selectedDate);
    setModalEmployee('');
    setModalClockIn('09:00');
    setModalClockOut('');
    setModalPosition('');
    setModalShiftStatus('scheduled');
    setModalNotes('');
    setModalBreaks([]);
    setModalPhotos([]);
    setModalEditHistory([]);
    setShowModal(true);
  };

  const buildBreakDateTime = (timeValue) => {
    if (!timeValue) return null;
    return dayjs.tz(`${modalDate}T${timeValue}`, businessTimezone).toISOString();
  };

  const calculateModalBreakDuration = (breakItem) => {
    const startAt = buildBreakDateTime(breakItem.break_start_time);
    const endAt = buildBreakDateTime(breakItem.break_end_time);
    if (!startAt || !endAt) return null;

    const duration = dayjs(endAt).diff(dayjs(startAt), 'minute');
    return duration > 0 ? duration : null;
  };

  const handleAddBreak = () => {
    setModalBreaks(prev => ([
      ...prev,
      {
        temp_id: `new-${Date.now()}`,
        break_type: 'meal',
        break_start_time: modalClockIn ? dayjs(`${modalDate}T${modalClockIn}`).add(30, 'minute').format('HH:mm') : '12:00',
        break_end_time: modalClockIn ? dayjs(`${modalDate}T${modalClockIn}`).add(60, 'minute').format('HH:mm') : '12:30',
        is_paid: false,
        notes: 'Manual break entry'
      }
    ]));
  };

  const shouldShowAcceptPaidMissedBreak = () => {
    if (!modalClockIn || !modalClockOut) return false;
    const shiftMinutes = calculateMinutes(
      dayjs.tz(`${modalDate}T${modalClockIn}`, businessTimezone).toISOString(),
      dayjs.tz(`${modalDate}T${modalClockOut}`, businessTimezone).toISOString()
    );
    const unpaidBreakMinutes = getModalBreakMinutes();
    return shiftMinutes > 360 && unpaidBreakMinutes === 0 && !hasPaidBreakResolution(modalBreaks);
  };

  const handleAcceptPaidMissedBreak = () => {
    const anchorTime = modalClockOut || modalClockIn || '12:00';
    setModalBreaks(prev => ([
      ...prev,
      {
        temp_id: `paid-missed-${Date.now()}`,
        break_type: 'rest',
        break_start_time: anchorTime,
        break_end_time: anchorTime,
        is_paid: true,
        notes: acceptedMissedBreakNote
      }
    ]));
  };

  const handleUpdateBreak = (index, updates) => {
    setModalBreaks(prev => prev.map((breakItem, idx) => (
      idx === index ? { ...breakItem, ...updates } : breakItem
    )));
  };

  const handleRemoveBreak = (index) => {
    setModalBreaks(prev => prev
      .map((breakItem, idx) => (
        idx === index
          ? { ...breakItem, _deleted: true }
          : breakItem
      ))
      .filter((breakItem) => breakItem.id || !breakItem._deleted)
    );
  };

  const saveBreaksForTimecard = async (timecardId, employeeId) => {
    for (const breakItem of modalBreaks) {
      if (breakItem.id && breakItem._deleted) {
        const { error } = await supabase
          .from('scheduling_break_tracking')
          .delete()
          .eq('id', breakItem.id);

        if (error) throw error;
        continue;
      }

      if (breakItem._deleted) continue;

      const breakStartAt = buildBreakDateTime(breakItem.break_start_time);
      const breakEndAt = buildBreakDateTime(breakItem.break_end_time);

      if (!breakStartAt) {
        throw new Error('Break start time is required.');
      }

      const breakType = normalizeBreakType(breakItem.break_type);
      const breakPayload = {
        business_id: businessId,
        employee_id: employeeId,
        time_clock_id: timecardId,
        break_type: breakType,
        break_start_at: breakStartAt,
        break_end_at: breakEndAt,
        duration_minutes: calculateModalBreakDuration(breakItem),
        is_paid: !!breakItem.is_paid,
        notes: breakItem.notes || null
      };

      if (breakItem.id) {
        const { error } = await supabase
          .from('scheduling_break_tracking')
          .update(breakPayload)
          .eq('id', breakItem.id);

        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('scheduling_break_tracking')
          .insert(breakPayload);

        if (error) throw error;
      }
    }
  };

  const getModalBreakMinutes = () => {
    return modalBreaks.reduce((total, breakItem) => {
      if (breakItem._deleted || breakItem.is_paid) return total;
      return total + (calculateModalBreakDuration(breakItem) || 0);
    }, 0);
  };

  const handleSaveTimecard = async () => {
    try {
      const clockInDateTime = dayjs(`${modalDate}T${modalClockIn}`).toISOString();
      const clockOutDateTime = modalClockOut ? dayjs(`${modalDate}T${modalClockOut}`).toISOString() : null;

      if (selectedTimecard) {
        const existingPosition = selectedTimecard.scheduled_shift?.position || '';
        const existingShiftStatus = selectedTimecard.scheduled_shift?.status || 'scheduled';
        if (selectedTimecard.is_scheduled_placeholder) {
          const { error: shiftError } = await supabase
            .from('scheduling_shifts')
            .update({
              start_time: `${modalClockIn}:00`,
              end_time: modalClockOut ? `${modalClockOut}:00` : selectedTimecard.scheduled_shift?.end_time,
              position: modalPosition || null,
              status: modalShiftStatus,
              notes: modalNotes || null
            })
            .eq('id', selectedTimecard.scheduled_shift.id)
            .eq('business_id', businessId);

          if (shiftError) throw shiftError;

          if (modalShiftStatus !== 'sick' && modalShiftStatus !== 'cancelled') {
            const { data: insertedTimecard, error: insertError } = await supabase
              .from('scheduling_time_clocks')
              .insert({
                business_id: businessId,
                employee_id: selectedTimecard.employee_id,
                clock_in_time: clockInDateTime,
                clock_out_time: clockOutDateTime,
                break_duration_minutes: getModalBreakMinutes(),
                notes: modalNotes || null
              })
              .select('id, employee_id')
              .single();

            if (insertError) throw insertError;

            if (insertedTimecard?.id) {
              await saveBreaksForTimecard(insertedTimecard.id, insertedTimecard.employee_id);
            }
          }

          if (modalShiftStatus === 'sick' && existingShiftStatus !== 'sick') {
            await sendSchedulingNotification({
              businessId,
              eventKey: 'shift_marked_sick',
              employeeId: selectedTimecard.employee_id,
              context: {
                shiftId: selectedTimecard.scheduled_shift.id,
                shiftDate: modalDate,
                position: modalPosition || null
              }
            });
          }

          closeTimecardModal();
          loadTimecards();
          return;
        }

        const nextValues = {
          clock_in_time: clockInDateTime,
          clock_out_time: clockOutDateTime,
          break_duration_minutes: getModalBreakMinutes(),
          notes: modalNotes
        };

        // Update existing
        const { error } = await supabase
          .from('scheduling_time_clocks')
          .update(nextValues)
          .eq('id', selectedTimecard.id);

        if (error) throw error;

        await saveBreaksForTimecard(selectedTimecard.id, selectedTimecard.employee_id);

        if (
          selectedTimecard.scheduled_shift?.id &&
          (modalPosition !== existingPosition || modalShiftStatus !== existingShiftStatus)
        ) {
          const { error: shiftError } = await supabase
            .from('scheduling_shifts')
            .update({
              position: modalPosition || null,
              status: modalShiftStatus
            })
            .eq('id', selectedTimecard.scheduled_shift.id)
            .eq('business_id', businessId);

          if (shiftError) throw shiftError;
          if (modalShiftStatus === 'sick' && existingShiftStatus !== 'sick') {
            await sendSchedulingNotification({
              businessId,
              eventKey: 'shift_marked_sick',
              employeeId: selectedTimecard.employee_id,
              context: {
                shiftId: selectedTimecard.scheduled_shift.id,
                shiftDate: modalDate,
                position: modalPosition || null
              }
            });
          }
        }
      } else {
        // Insert new
        const { data: insertedTimecard, error } = await supabase
          .from('scheduling_time_clocks')
          .insert({
            business_id: businessId,
            employee_id: modalEmployee,
            clock_in_time: clockInDateTime,
            clock_out_time: clockOutDateTime,
            break_duration_minutes: getModalBreakMinutes(),
            notes: modalNotes
          })
          .select('id, employee_id')
          .single();

        if (error) throw error;

        if (insertedTimecard?.id) {
          await saveBreaksForTimecard(insertedTimecard.id, insertedTimecard.employee_id);
        }
      }

      closeTimecardModal();
      loadTimecards();
    } catch (error) {
      console.error('Error saving timecard:', error);
    }
  };

  const handleDeleteTimecard = async () => {
    if (!selectedTimecard) return;

    try {
      if (selectedTimecard.is_scheduled_placeholder) {
        const shiftId = selectedTimecard.scheduled_shift?.id;
        if (!shiftId) {
          throw new Error('Scheduled shift id is missing.');
        }

        const { error } = await supabase
          .from('scheduling_shifts')
          .delete()
          .eq('id', shiftId);

        if (error) throw error;
        closeTimecardModal();
        loadTimecards();
        return;
      }

      await supabase
        .from('scheduling_break_tracking')
        .delete()
        .eq('time_clock_id', selectedTimecard.id);

      const { error } = await supabase
        .from('scheduling_time_clocks')
        .delete()
        .eq('id', selectedTimecard.id);

      if (error) throw error;
      closeTimecardModal();
      loadTimecards();
    } catch (error) {
      console.error('Error deleting timecard:', error);
    }
  };

  const navigateDate = (direction) => {
    const currentDate = activeSubTab === 'daily' ? selectedDate : startDate;
    const newDate = dayjs(currentDate).add(direction, 'day');
    
    if (activeSubTab === 'daily') {
      setSelectedDate(newDate.format('YYYY-MM-DD'));
    } else {
      const daysDiff = dayjs(endDate).diff(dayjs(startDate), 'day');
      setStartDate(newDate.format('YYYY-MM-DD'));
      setEndDate(newDate.add(daysDiff, 'day').format('YYYY-MM-DD'));
    }
  };

  const formatTime = (time) => {
    if (!time) return '-';
    return dayjs(time).tz(businessTimezone).format('h:mm A');
  };

  /** One-line scheduled shift for CSV: date · times · position · status */
  const formatScheduledShiftForCsv = (timecard) => {
    const s = timecard.scheduled_shift;
    if (!s) return '';
    const datePart = s.shift_date ? dayjs(s.shift_date).format('MMM D, YYYY') : '';
    let timeRange = '';
    if (s.start_time && s.end_time) {
      const d = s.shift_date || dayjs(timecard.clock_in_time).tz(businessTimezone).format('YYYY-MM-DD');
      const startT = String(s.start_time).trim();
      const endT = String(s.end_time).trim();
      const startLabel = dayjs.tz(`${d}T${startT}`, businessTimezone).format('h:mm A');
      const endLabel = dayjs.tz(`${d}T${endT}`, businessTimezone).format('h:mm A');
      timeRange = `${startLabel} - ${endLabel}`;
    }
    const pos = (s.position || '').trim();
    const status =
      s.status && String(s.status).toLowerCase() !== 'scheduled'
        ? String(s.status).replace(/_/g, ' ')
        : '';
    return [datePart, timeRange, pos, status].filter(Boolean).join(' · ');
  };

  const formatClockInOut = (timecard) => {
    if (timecard.scheduled_shift?.status === 'sick') {
      return `Sick: ${formatTime(timecard.clock_in_time)} - ${formatTime(timecard.clock_out_time)}`;
    }

    if (timecard.is_scheduled_placeholder) {
      return `Scheduled: ${formatTime(timecard.clock_in_time)} - ${formatTime(timecard.clock_out_time)}`;
    }

    return timecard.clock_out_time
      ? `${formatTime(timecard.clock_in_time)} - ${formatTime(timecard.clock_out_time)}`
      : `${formatTime(timecard.clock_in_time)} - Open`;
  };

  const formatMinuteIntervalsClock = (dateKey, intervals) => {
    if (!intervals?.length) return '—';
    return mergeIntervalsLocal(intervals)
      .map((iv) => {
        const start = dayjs.tz(`${dateKey}T00:00:00`, businessTimezone).add(iv.start, 'minute');
        const end = dayjs.tz(`${dateKey}T00:00:00`, businessTimezone).add(iv.end, 'minute');
        return `${start.format('h:mm A')} - ${end.format('h:mm A')}`;
      })
      .join('; ');
  };

  const shiftPremiumRateAndName = (pid) => {
    const raw = shiftPremiumRatesById[pid];
    if (raw == null) return { rate: 0, name: 'Shift premium' };
    if (typeof raw === 'number') return { rate: raw, name: 'Shift premium' };
    return {
      rate: parseFloat(raw.rate) || 0,
      name: raw.name || 'Shift premium'
    };
  };

  /** Separate rows: base hourly, position rules, employee premiums, prorated shift-lead (matches payroll logic). */
  const buildWageLineItems = (timecard, employee, positionName) => {
    if (!employee) {
      return { lines: [], totalEstimated: 0, cardPaidHours: 0 };
    }

    const paidHours = calculateTotalPaidHours(timecard);
    const clockFull = formatClockInOut(timecard);
    const baseWage = parseFloat(employee?.wage || 0);
    const employeeRole = getEmployeeRole(employee);

    if (timecard.is_scheduled_placeholder) {
      const placeholderPos = timecard.scheduled_shift?.position || positionName;
      const placeholderHours =
        paidHours > 0
          ? paidHours
          : (() => {
              const s = timecard.scheduled_shift;
              if (!s?.start_time || !s?.end_time) return 0;
              const start = dayjs.tz(`${s.shift_date}T${s.start_time}`, businessTimezone);
              const end = dayjs.tz(`${s.shift_date}T${s.end_time}`, businessTimezone);
              return Math.max(0, end.diff(start, 'minute', true) / 60);
            })();
      const lines = [
        {
          key: 'base',
          label: positionName || 'Base',
          rate: baseWage,
          hours: placeholderHours,
          clockLabel: clockFull,
          estimated: baseWage * placeholderHours
        }
      ];
      const linkedRow = findPositionLinkedPremiumRow(placeholderPos, positions);
      if (linkedRow?.shift_premium_id && placeholderHours > 0) {
        const { rate, name: premiumName } = shiftPremiumRateAndName(linkedRow.shift_premium_id);
        if (rate > 0) {
          lines.push({
            key: `pos-linked-${linkedRow.id}`,
            label: premiumName || placeholderPos,
            rate,
            hours: placeholderHours,
            clockLabel: clockFull,
            estimated: rate * placeholderHours
          });
        }
      }
      return {
        lines,
        totalEstimated: lines.reduce((s, l) => s + l.estimated, 0),
        cardPaidHours: placeholderHours
      };
    }

    const dateKey = dayjs(timecard.clock_in_time).tz(businessTimezone).format('YYYY-MM-DD');

    const lines = [
      {
        key: 'base',
        label: positionName || 'Base',
        rate: baseWage,
        hours: paidHours,
        clockLabel: clockFull,
        estimated: baseWage * paidHours
      }
    ];

    const position = positions.find((p) => p.position_name === positionName);
    if (position && positionPremiumRules.length > 0) {
      const applicableRules = positionPremiumRules.filter(
        (rule) =>
          rule.position_id === position.id &&
          !(rule.excluded_roles && rule.excluded_roles.includes(employeeRole))
      );
      for (const rule of applicableRules) {
        const rate = parseFloat(rule.premium_rate || 0);
        lines.push({
          key: `pos-rule-${rule.id}`,
          label: rule.premium_name || 'Position premium',
          rate,
          hours: paidHours,
          clockLabel: clockFull,
          estimated: rate * paidHours
        });
      }
    }

    const roleSegments = getPositionLinkedHoursByRole({
      timecard,
      scheduledShifts: scheduleShiftsForRange,
      businessTimezone,
      paidWorkIntervalsMinutes: buildPaidWorkIntervalsMinutes(timecard)
    });
    const linkedByPremiumId = new Map();
    for (const seg of roleSegments) {
      const linkedPositionRow = findPositionLinkedPremiumRow(seg.position, positions);
      if (!linkedPositionRow?.shift_premium_id || seg.hours <= 0) continue;
      const pid = String(linkedPositionRow.shift_premium_id);
      const prev = linkedByPremiumId.get(pid) || {
        row: linkedPositionRow,
        hours: 0,
        position: seg.position
      };
      prev.hours += seg.hours;
      linkedByPremiumId.set(pid, prev);
    }
    for (const [, { row: linkedPositionRow, hours, position }] of linkedByPremiumId) {
      const { rate, name: premiumName } = shiftPremiumRateAndName(linkedPositionRow.shift_premium_id);
      if (rate > 0 && hours > 0) {
        lines.push({
          key: `pos-linked-${linkedPositionRow.id}`,
          label: premiumName || position,
          rate,
          hours,
          clockLabel: clockFull,
          estimated: rate * hours
        });
      }
    }

    const empPremiumsList = employeePremiums.filter(
      (ep) => ep.user_id === employee.id && ep.applies_to_all_hours
    );
    const siblingSameDay = timecards.filter(
      (tc) =>
        !tc.is_scheduled_placeholder &&
        tc.employee_id === employee.id &&
        tc.clock_in_time &&
        tc.clock_out_time &&
        dayjs(tc.clock_in_time).tz(businessTimezone).format('YYYY-MM-DD') === dateKey
    );
    const premiumHoursByName =
      empPremiumsList.length > 0 && Object.keys(shiftPremiumDefsByName || {}).length > 0
        ? computePremiumHoursForTimecardWithDayExclusive({
            timecard,
            siblingTimecardsSameEmployeeDay: siblingSameDay,
            operatingHours,
            tz: businessTimezone,
            premiumByName: shiftPremiumDefsByName,
            assignmentsForEmployee: empPremiumsList
          })
        : {};

    for (const ep of empPremiumsList) {
      const rate = parseFloat(ep.premium_rate || 0);
      const def = shiftPremiumDefsByName[ep.premium_name];
      const qh = premiumHoursByName[ep.premium_name];
      const hoursRow =
        def != null ? (qh != null && !Number.isNaN(qh) ? qh : 0) : paidHours;
      lines.push({
        key: `emp-prem-${ep.id}`,
        label: ep.premium_name || 'Premium',
        rate,
        hours: hoursRow,
        clockLabel: clockFull,
        estimated: rate * hoursRow
      });
    }

    const keyChainActive = positions.some((p) => p.shift_lead_eligible === true);
    const win = shiftLeadWinnerByDate[dateKey];

    const dayShifts = shiftsForShiftLeadResolution.filter((s) => s.shift_date === dateKey);
    const empMap = new Map(employees.map((e) => [e.id, e]));
    const day = dayjs.tz(`${dateKey}T12:00:00`, businessTimezone);
    const breaks = timecard.breaks || [];
    const unpaidBreaks = breaks.filter((b) => !b.is_paid && b.break_type !== 'paid');
    const allUnpaidHaveTimes =
      unpaidBreaks.length === 0 ||
      unpaidBreaks.every((b) => b.break_start_at && b.break_end_at);

    let payableMin = 0;
    if (allUnpaidHaveTimes) {
      payableMin = getShiftLeadPremiumPayableMinutes({
        day,
        shifts: dayShifts,
        employeeById: empMap,
        positions,
        schedulingSettings: mergedSchedulingSettings,
        businessHours: operatingHours,
        employeeId: employee.id,
        clockedPositionName: positionName,
        paidWorkIntervalsMinutes: buildPaidWorkIntervalsMinutes(timecard)
      });
    } else {
      const coIso = effectiveClockOutIso(timecard);
      const ci = dayjs(timecard.clock_in_time).tz(businessTimezone);
      const co = dayjs(coIso).tz(businessTimezone);
      const toMin = (d) => d.hour() * 60 + d.minute() + d.second() / 60;
      let startM = toMin(ci);
      let endM = toMin(co);
      if (endM <= startM) endM += 24 * 60;
      const grossOverlapMin = getShiftLeadPremiumPayableMinutes({
        day,
        shifts: dayShifts,
        employeeById: empMap,
        positions,
        schedulingSettings: mergedSchedulingSettings,
        businessHours: operatingHours,
        employeeId: employee.id,
        clockedPositionName: positionName,
        paidWorkIntervalsMinutes: [{ start: startM, end: endM }]
      });
      const grossMin = endM - startM;
      const paidMin = Math.max(0, grossMin - calculateBreakMinutes(breaks));
      payableMin = grossMin > 0 ? grossOverlapMin * (paidMin / grossMin) : 0;
    }

    const premiumPositionRow = keyChainActive
      ? getShiftLeadPremiumRateRowForKeyChainEmployee({
          employeeId: employee.id,
          dayShifts,
          employeeById: empMap,
          positions
        })
      : win?.employeeId === employee.id
        ? findShiftLeadPremiumPositionRow(win, positionName, positions, mergedSchedulingSettings)
        : null;

    const pid = premiumPositionRow?.shift_premium_id;
    if (payableMin > 0 && pid != null) {
      const { rate, name: premiumName } = shiftPremiumRateAndName(pid);
      if (rate > 0) {
        const payableHours = payableMin / 60;
        const ctx = computeShiftLeadContext({
          day,
          shifts: dayShifts,
          employeeById: empMap,
          positions,
          schedulingSettings: mergedSchedulingSettings,
          businessHours: operatingHours
        });

        let intervalsForClock = [];
        if (ctx?.gaps?.length) {
          if (keyChainActive) {
            const paidForIntervals = allUnpaidHaveTimes
              ? buildPaidWorkIntervalsMinutes(timecard)
              : (() => {
                  const coIso = effectiveClockOutIso(timecard);
                  const ci = dayjs(timecard.clock_in_time).tz(businessTimezone);
                  const co = dayjs(coIso).tz(businessTimezone);
                  const tm = (d) => d.hour() * 60 + d.minute() + d.second() / 60;
                  let sm = tm(ci);
                  let em = tm(co);
                  if (em <= sm) em += 24 * 60;
                  return [{ start: sm, end: em }];
                })();
            intervalsForClock = getShiftLeadPremiumEarnedIntervalsMinutes({
              day,
              shifts: dayShifts,
              employeeById: empMap,
              positions,
              schedulingSettings: mergedSchedulingSettings,
              businessHours: operatingHours,
              employeeId: employee.id,
              clockedPositionName: positionName,
              paidWorkIntervalsMinutes: paidForIntervals
            });
          } else if (allUnpaidHaveTimes) {
            intervalsForClock = intersectWorkIntervalsWithGaps(
              buildPaidWorkIntervalsMinutes(timecard),
              ctx.gaps
            );
          } else {
            const coIso = effectiveClockOutIso(timecard);
            const ci = dayjs(timecard.clock_in_time).tz(businessTimezone);
            const co = dayjs(coIso).tz(businessTimezone);
            const toMin = (d) => d.hour() * 60 + d.minute() + d.second() / 60;
            let startM = toMin(ci);
            let endM = toMin(co);
            if (endM <= startM) endM += 24 * 60;
            intervalsForClock = intersectWorkIntervalsWithGaps(
              [{ start: startM, end: endM }],
              ctx.gaps
            );
          }
        }

        const clockLabel =
          payableHours > 0 ? formatMinuteIntervalsClock(dateKey, intervalsForClock) : '—';

        if (payableHours > 0) {
          lines.push({
            key: 'shift-lead',
            label: premiumName,
            rate,
            hours: payableHours,
            clockLabel,
            estimated: rate * payableHours
          });
        }
      }
    }

    const totalEstimated = lines.reduce((s, l) => s + l.estimated, 0);
    return { lines, totalEstimated, cardPaidHours: paidHours };
  };

  const calculateEstimatedWages = (timecard, employee, positionName) => {
    if (timecard.is_scheduled_placeholder) return 0;
    return buildWageLineItems(timecard, employee, positionName).totalEstimated;
  };

  const formatAuditDateTime = (time) => {
    if (!time) return '-';
    return dayjs(time).tz(businessTimezone).format('MMM D, YYYY h:mm A');
  };

  const formatAuditField = (field) => {
    const labels = {
      clock_in_time: 'Clock In',
      clock_out_time: 'Clock Out',
      notes: 'Notes'
    };
    return labels[field] || field;
  };

  const formatAuditValue = (field, value) => {
    if (field === 'clock_in_time' || field === 'clock_out_time') {
      return formatAuditDateTime(value);
    }
    if (field === 'notes' && value != null && value !== '') {
      return humanizeTimeClockNoteLines(value, {
        scheduledShift: selectedTimecard?.scheduled_shift,
      }).join(' · ');
    }
    return value || '-';
  };

  const renderHumanizedNotesList = (value) => {
    if (value == null || value === '') {
      return <span style={{ color: '#9ca3af' }}>—</span>;
    }
    const lines = humanizeTimeClockNoteLines(value, {
      scheduledShift: selectedTimecard?.scheduled_shift,
    });
    return (
      <ul style={{ margin: '4px 0 0', paddingLeft: '18px', color: '#374151', lineHeight: 1.45 }}>
        {lines.map((line, i) => (
          <li key={i}>{line}</li>
        ))}
      </ul>
    );
  };

  const calculateMinutes = (start, end) => {
    if (!start || !end) return 0;
    return dayjs(end).diff(dayjs(start), 'minute');
  };

  const styles = {
    container: {
      padding: '20px',
      backgroundColor: TavariStyles.colors.background
    },
    subTabs: {
      display: 'flex',
      gap: '2px',
      marginBottom: '20px',
      backgroundColor: '#e5e7eb',
      borderRadius: '8px',
      padding: '4px'
    },
    subTabButton: {
      flex: 1,
      padding: '12px 20px',
      backgroundColor: 'white',
      color: '#008080',
      border: 'none',
      borderRadius: '6px',
      fontSize: '14px',
      fontWeight: 'bold',
      cursor: 'pointer',
      transition: 'all 0.2s ease',
      boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
    },
    dateSelector: {
      display: 'flex',
      alignItems: 'center',
      flexWrap: 'wrap',
      gap: '12px',
      marginBottom: '20px'
    },
    dateInput: {
      padding: '10px',
      border: '1px solid #e5e7eb',
      borderRadius: '6px',
      fontSize: '14px'
    },
    navButton: {
      padding: '8px',
      backgroundColor: '#008080',
      color: 'white',
      border: 'none',
      borderRadius: '6px',
      cursor: 'pointer',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center'
    },
    grid: {
      display: 'grid',
      gridTemplateColumns: '1.2fr 1.2fr 1fr 1.5fr 1.8fr 1fr 1fr',
      gap: '1px',
      backgroundColor: '#e5e7eb'
    },
    totalsRow: {
      display: 'grid',
      gridTemplateColumns: '1.2fr 1.2fr 1fr 1.5fr 1.8fr 1fr 1fr',
      gap: '1px',
      backgroundColor: '#f9fafb',
      fontWeight: '600',
      padding: '12px',
      borderTop: '2px solid #e5e7eb'
    },
    totalsCell: {
      padding: '12px',
      backgroundColor: '#f9fafb',
      fontSize: '14px',
      fontWeight: '600'
    },
    grandTotalsRow: {
      display: 'grid',
      gridTemplateColumns: '1.2fr 1.2fr 1fr 1.5fr 1.8fr 1fr 1fr',
      gap: '1px',
      backgroundColor: '#e5e7eb',
      fontWeight: '700',
      padding: '12px',
      marginTop: '8px',
      borderTop: '3px solid #374151',
      borderRadius: '6px'
    },
    grandTotalsCell: {
      padding: '12px',
      backgroundColor: '#f3f4f6',
      fontSize: '14px',
      fontWeight: '700',
      color: '#111827'
    },
    mainHeaderContainer: {
      marginBottom: '20px'
    },
    employeeSection: {
      marginBottom: '16px'
    },
    employeeHeader: {
      padding: '12px 16px',
      backgroundColor: '#f9fafb',
      color: '#111827',
      fontSize: '16px',
      fontWeight: '600',
      borderBottom: '2px solid #e5e7eb',
      borderLeft: '2px solid #e5e7eb',
      borderRight: '2px solid #e5e7eb',
      borderTopLeftRadius: '6px',
      borderTopRightRadius: '6px'
    },
    employeeGrid: {
      borderLeft: '2px solid #e5e7eb',
      borderRight: '2px solid #e5e7eb',
      borderBottom: '2px solid #e5e7eb',
      borderBottomLeftRadius: '6px',
      borderBottomRightRadius: '6px'
    },
    gridHeader: {
      padding: '12px',
      backgroundColor: TavariStyles.colors.primary,
      color: 'white',
      fontWeight: '600',
      textAlign: 'center',
      fontSize: '14px'
    },
    gridCell: {
      padding: '12px',
      backgroundColor: 'white',
      fontSize: '14px'
    },
    modalOverlay: {
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000
    },
    modalShell: {
      position: 'relative',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '16px',
      maxWidth: 'min(960px, 96vw)',
      width: '100%',
    },
    modalNavArrow: {
      flexShrink: 0,
      width: '48px',
      height: '48px',
      borderRadius: '50%',
      border: 'none',
      backgroundColor: 'white',
      color: TavariStyles.colors.primary,
      cursor: 'pointer',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      boxShadow: '0 4px 16px rgba(0, 0, 0, 0.18)',
      transition: 'opacity 0.2s ease, transform 0.2s ease',
    },
    modalNavArrowDisabled: {
      opacity: 0.35,
      cursor: 'not-allowed',
      boxShadow: '0 2px 8px rgba(0, 0, 0, 0.08)',
    },
    modalContent: {
      backgroundColor: 'white',
      borderRadius: '12px',
      width: '100%',
      maxWidth: '800px',
      maxHeight: '90vh',
      overflowY: 'auto',
      padding: '24px',
      flex: '1 1 auto',
      minWidth: 0,
    },
    section: {
      marginBottom: '24px',
      paddingBottom: '24px',
      borderBottom: '1px solid #e5e7eb'
    },
    sectionTitle: {
      fontSize: '18px',
      fontWeight: '600',
      marginBottom: '12px'
    },
    input: {
      width: '100%',
      boxSizing: 'border-box',
      padding: '10px',
      border: '1px solid #e5e7eb',
      borderRadius: '6px',
      fontSize: '14px',
      marginBottom: '12px'
    },
    buttonGroup: {
      display: 'flex',
      gap: '12px',
      justifyContent: 'flex-end'
    },
    button: {
      padding: '10px 20px',
      border: 'none',
      borderRadius: '6px',
      cursor: 'pointer',
      fontWeight: '600'
    }
  };

  if (loading) {
    return <div style={{ padding: '40px', textAlign: 'center' }}>Loading...</div>;
  }

  return (
    <div style={styles.container}>
      {/* Sub-tabs */}
      <div style={styles.subTabs}>
        <button
          onClick={() => setActiveSubTab('daily')}
          style={{
            ...styles.subTabButton,
            backgroundColor: activeSubTab === 'daily' ? 'white' : 'transparent',
            color: activeSubTab === 'daily' ? '#008080' : '#6b7280'
          }}
        >
          Daily Review
        </button>
        <button
          onClick={() => setActiveSubTab('period')}
          style={{
            ...styles.subTabButton,
            backgroundColor: activeSubTab === 'period' ? 'white' : 'transparent',
            color: activeSubTab === 'period' ? '#008080' : '#6b7280'
          }}
        >
          Pay Period Review
        </button>
      </div>

      {/* Date selector */}
      <div style={styles.dateSelector}>
        {activeSubTab === 'daily' ? (
          <>
            <button onClick={() => navigateDate(-1)} style={styles.navButton}>
              <ChevronLeft size={20} />
            </button>
            <TimesheetCalendarPicker
              value={selectedDate}
              onChange={setSelectedDate}
              businessTimezone={businessTimezone}
              ariaLabel="Choose day for daily review"
            />
            <button onClick={() => navigateDate(1)} style={styles.navButton}>
              <ChevronRight size={20} />
            </button>
          </>
        ) : (
          <>
            <button onClick={() => navigateDate(-1)} style={styles.navButton}>
              <ChevronLeft size={20} />
            </button>
            <TimesheetCalendarPicker
              value={startDate}
              onChange={setStartDate}
              businessTimezone={businessTimezone}
              ariaLabel="Choose pay period start date"
              compact
            />
            <span>to</span>
            <TimesheetCalendarPicker
              value={endDate}
              onChange={setEndDate}
              businessTimezone={businessTimezone}
              ariaLabel="Choose pay period end date"
              compact
            />
            <button onClick={() => navigateDate(1)} style={styles.navButton}>
              <ChevronRight size={20} />
            </button>
          </>
        )}
        {refreshingTimecards ? (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '13px',
              color: '#6b7280',
              flexShrink: 0
            }}
          >
            <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} aria-hidden />
            Updating…
          </span>
        ) : null}
        <div
          style={{
            marginLeft: 'auto',
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: '12px'
          }}
        >
          {timesheetApproval?.approved_at && (
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                fontSize: '13px',
                color: '#166534',
                backgroundColor: '#dcfce7',
                padding: '6px 10px',
                borderRadius: '8px',
                border: '1px solid #86efac'
              }}
            >
              <CheckCircle2 size={16} aria-hidden />
              Approved{' '}
              {dayjs(timesheetApproval.approved_at).format('MMM D, YYYY h:mm A')}
            </span>
          )}
          <button
            type="button"
            onClick={handleApproveTimesheets}
            disabled={approvingTimesheets || !businessId}
            title="Saves a snapshot of hours and premiums for this date range. Payroll uses it when the pay period matches these dates."
            style={{
              ...styles.button,
              backgroundColor: '#047857',
              color: 'white',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              ...(approvingTimesheets ? { opacity: 0.7, cursor: 'wait' } : {})
            }}
          >
            {approvingTimesheets ? <Loader2 size={20} aria-hidden /> : <CheckCircle2 size={20} aria-hidden />}
            Approve time sheets
          </button>
          <button
            onClick={exportToCSV}
            style={{
              ...styles.button,
              backgroundColor: '#6b7280',
              color: 'white',
              display: 'flex',
              alignItems: 'center',
              gap: '8px'
            }}
          >
            <Download size={20} />
            Export CSV
          </button>
          <button
            onClick={handleAddNewTimecard}
            style={{
              ...styles.button,
              backgroundColor: TavariStyles.colors.primary,
              color: 'white',
              display: 'flex',
              alignItems: 'center',
              gap: '8px'
            }}
          >
            <Plus size={20} />
            Add Timecard
          </button>
        </div>
      </div>

      {/* Designated shift lead — matches wage estimate logic (scheduled shifts + positions) */}
      <div
        style={{
          marginBottom: '16px',
          padding: '12px 16px',
          borderRadius: '8px',
          border: `1px solid ${TavariStyles.colors.gray200}`,
          backgroundColor: TavariStyles.colors.gray50,
          display: 'flex',
          alignItems: 'flex-start',
          gap: '12px'
        }}
      >
        <KeyRound
          size={22}
          aria-hidden
          style={{ color: TavariStyles.colors.primary, flexShrink: 0, marginTop: '2px' }}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontWeight: 600,
              fontSize: '14px',
              color: TavariStyles.colors.gray800,
              marginBottom: '6px'
            }}
          >
            Designated shift lead
          </div>
          {!mergedSchedulingSettings.shift_lead_enabled ? (
            <p style={{ margin: 0, fontSize: '14px', color: TavariStyles.colors.gray500 }}>
              Shift lead is turned off in scheduling settings.
            </p>
          ) : activeSubTab === 'daily' ? (
            (() => {
              const win = shiftLeadWinnerByDate[selectedDate];
              const labelDate = dayjs
                .tz(`${selectedDate}T12:00:00`, businessTimezone)
                .format('MMMM D, YYYY');
              if (!win) {
                return (
                  <p style={{ margin: 0, fontSize: '14px', color: TavariStyles.colors.gray500, lineHeight: 1.45 }}>
                    No designated shift lead for{' '}
                    <strong style={{ color: TavariStyles.colors.gray700 }}>{labelDate}</strong>. Typical
                    reasons: management covers the full shift-lead window, no shifts overlap the window, or no
                    eligible key-holder is working during uncovered time.
                  </p>
                );
              }
              const emp = employees.find((e) => e.id === win.employeeId);
              return (
                <p style={{ margin: 0, fontSize: '14px', color: TavariStyles.colors.gray800, lineHeight: 1.45 }}>
                  <strong>{emp?.full_name || 'Unknown employee'}</strong>
                  <span style={{ color: TavariStyles.colors.gray500 }}>
                    {' '}
                    — {win.positionName}
                  </span>
                  <span style={{ color: TavariStyles.colors.gray500, fontSize: '13px', display: 'block', marginTop: '4px' }}>
                    ({labelDate})
                  </span>
                </p>
              );
            })()
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {(() => {
                const start = dayjs(startDate);
                const end = dayjs(endDate);
                if (!start.isValid() || !end.isValid() || end.isBefore(start)) {
                  return (
                    <p style={{ margin: 0, fontSize: '14px', color: TavariStyles.colors.gray500 }}>
                      Choose a valid date range to see shift leads by day.
                    </p>
                  );
                }
                const rows = [];
                let cur = start;
                while (cur.valueOf() <= end.valueOf()) {
                  const key = cur.format('YYYY-MM-DD');
                  const win = shiftLeadWinnerByDate[key];
                  const emp = win ? employees.find((e) => e.id === win.employeeId) : null;
                  rows.push(
                    <div
                      key={key}
                      style={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        alignItems: 'baseline',
                        gap: '8px',
                        fontSize: '14px',
                        padding: '4px 0',
                        borderBottom: `1px solid ${TavariStyles.colors.gray100}`
                      }}
                    >
                      <span
                        style={{
                          fontWeight: 600,
                          minWidth: '132px',
                          color: TavariStyles.colors.gray700
                        }}
                      >
                        {cur.format('ddd, MMM D')}
                      </span>
                      {!win ? (
                        <span style={{ color: TavariStyles.colors.gray500 }}>None</span>
                      ) : (
                        <>
                          <span style={{ color: TavariStyles.colors.gray800 }}>
                            {emp?.full_name || 'Unknown employee'}
                          </span>
                          <span style={{ color: TavariStyles.colors.gray500 }}>({win.positionName})</span>
                        </>
                      )}
                    </div>
                  );
                  cur = cur.add(1, 'day');
                }
                return rows;
              })()}
            </div>
          )}
        </div>
      </div>

      {/* Main Table Headers */}
      <div style={{ ...styles.mainHeaderContainer, opacity: refreshingTimecards ? 0.65 : 1, transition: 'opacity 0.15s ease' }}>
        <div style={styles.grid}>
          <div style={styles.gridHeader}>Date</div>
          <div style={styles.gridHeader}>Pay component</div>
          <div style={styles.gridHeader}>Rate ($/hr)</div>
          <div style={styles.gridHeader}>Clock In/Out</div>
          <div style={styles.gridHeader}>Discrepancies</div>
          <div style={styles.gridHeader}>Total Paid Hours</div>
          <div style={styles.gridHeader}>Estimated Wages</div>
        </div>
      </div>

      {/* Employee Sections - Grouped by Employee */}
      {(() => {
        // Group timecards by employee
        const groupedByEmployee = {};
        timecards.forEach(timecard => {
          const employee = getTimecardEmployee(timecard);
          const employeeName = employee?.full_name || 'Unknown Employee';
          
          if (!groupedByEmployee[employeeName]) {
            groupedByEmployee[employeeName] = [];
          }
          groupedByEmployee[employeeName].push({ timecard, employee });
        });

        let grandTotalHours = 0;
        let grandTotalWages = 0;

        const employeeSections = Object.entries(groupedByEmployee)
          .sort(([nameA], [nameB]) => nameA.localeCompare(nameB))
          .map(([employeeName, employeeData]) => {
          const employee = employeeData[0]?.employee;
          const sortedEmployeeData = [...employeeData].sort((a, b) =>
            dayjs(a.timecard.clock_in_time).valueOf() - dayjs(b.timecard.clock_in_time).valueOf()
          );
          let totalHours = 0;
          let totalWages = 0;

          const section = (
            <div key={employeeName} style={styles.employeeSection}>
              <div style={styles.employeeHeader}>{employeeName}</div>
              <div style={{ ...styles.grid, ...styles.employeeGrid }}>
                {sortedEmployeeData.map(({ timecard }) => {
                  const positionName = getTimecardPosition(timecard, employee);
                  const discrepancies = calculateDiscrepancies(timecard);
                  const breakdown = buildWageLineItems(timecard, employee, positionName);

                  totalHours += breakdown.cardPaidHours;
                  totalWages += breakdown.totalEstimated;

                  const dateLabel = dayjs(timecard.clock_in_time).tz(businessTimezone).format('MMM D, YYYY');

                  return breakdown.lines.map((line, idx) => (
                    <React.Fragment key={`${timecard.id}-${line.key}-${idx}`}>
                      <div
                        style={{ ...styles.gridCell, cursor: 'pointer' }}
                        onClick={() => handleOpenTimecard(timecard)}
                      >
                        {idx === 0 ? dateLabel : ''}
                      </div>
                      <div
                        style={{
                          ...styles.gridCell,
                          cursor: 'pointer',
                          paddingLeft: idx > 0 ? 28 : 12
                        }}
                        onClick={() => handleOpenTimecard(timecard)}
                      >
                        {idx > 0 ? '↳ ' : ''}
                        {line.label}
                      </div>
                      <div style={{ ...styles.gridCell, cursor: 'pointer' }} onClick={() => handleOpenTimecard(timecard)}>
                        ${line.rate.toFixed(2)}
                      </div>
                      <div style={{ ...styles.gridCell, cursor: 'pointer' }} onClick={() => handleOpenTimecard(timecard)}>
                        {line.clockLabel}
                      </div>
                      <div style={{ ...styles.gridCell, cursor: 'pointer' }} onClick={() => handleOpenTimecard(timecard)}>
                        {idx === 0 ? (discrepancies.length > 0 ? discrepancies.join(', ') : '-') : '—'}
                      </div>
                      <div style={{ ...styles.gridCell, cursor: 'pointer' }} onClick={() => handleOpenTimecard(timecard)}>
                        {line.hours.toFixed(2)}
                      </div>
                      <div style={{ ...styles.gridCell, cursor: 'pointer' }} onClick={() => handleOpenTimecard(timecard)}>
                        ${line.estimated.toFixed(2)}
                      </div>
                    </React.Fragment>
                  ));
                })}
              </div>
              
              {/* Totals Row for Employee */}
              <div style={styles.totalsRow}>
                <div style={styles.totalsCell}>{employeeName}</div>
                <div style={styles.totalsCell}>Total</div>
                <div style={styles.totalsCell}>-</div>
                <div style={styles.totalsCell}>-</div>
                <div style={styles.totalsCell}>-</div>
                <div style={styles.totalsCell}>{totalHours.toFixed(2)} hrs</div>
                <div style={styles.totalsCell}>${totalWages.toFixed(2)}</div>
              </div>
            </div>
          );

          grandTotalHours += totalHours;
          grandTotalWages += totalWages;
          return section;
        });

        return (
          <>
            {employeeSections}
            {employeeSections.length > 0 && (
              <div style={styles.grandTotalsRow}>
                <div style={styles.grandTotalsCell}>All staff</div>
                <div style={styles.grandTotalsCell}>Grand total</div>
                <div style={styles.grandTotalsCell}>-</div>
                <div style={styles.grandTotalsCell}>-</div>
                <div style={styles.grandTotalsCell}>-</div>
                <div style={styles.grandTotalsCell}>{grandTotalHours.toFixed(2)} hrs</div>
                <div style={styles.grandTotalsCell}>${grandTotalWages.toFixed(2)}</div>
              </div>
            )}
          </>
        );
      })()}

      {/* Modal */}
      {showModal && (
        <div style={styles.modalOverlay} onClick={handleAttemptCloseModal}>
          <div style={styles.modalShell} onClick={(e) => e.stopPropagation()}>
            {showTimecardNav && (
              <button
                type="button"
                aria-label="Previous timecard for this employee"
                title="Previous timecard"
                disabled={!canNavigatePrevTimecard}
                onClick={() => handleNavigateTimecard(-1)}
                style={{
                  ...styles.modalNavArrow,
                  ...(!canNavigatePrevTimecard ? styles.modalNavArrowDisabled : {}),
                }}
              >
                <ChevronLeft size={28} aria-hidden />
              </button>
            )}

            <div style={styles.modalContent}>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
              <div>
                <h2 style={{ margin: 0 }}>{editingMode ? 'Edit Timecard' : 'Add Timecard'}</h2>
                {showTimecardNav && currentTimecardNavIndex >= 0 && (
                  <div style={{ marginTop: '4px', fontSize: '13px', color: '#6b7280' }}>
                    {currentTimecardNavIndex + 1} of {employeeTimecardNavList.length} for{' '}
                    {employees.find((e) => e.id === modalEmployee)?.full_name
                      || selectedTimecard?.users?.full_name
                      || 'employee'}
                  </div>
                )}
              </div>
              <button onClick={handleAttemptCloseModal} style={{ border: 'none', backgroundColor: 'transparent', cursor: 'pointer' }}>
                <X size={24} />
              </button>
            </div>

            {/* Section 1: Employee and Position */}
            <div style={styles.section}>
              <div style={styles.sectionTitle}>Employee & Position</div>
              {editingMode && selectedTimecard && (
                <>
                  <input
                    value={employees.find(e => e.id === modalEmployee)?.full_name || selectedTimecard?.users?.full_name || ''}
                    disabled
                    style={styles.input}
                    placeholder="Employee Name"
                  />
                  <PositionSelectWithNew
                    businessId={businessId}
                    positions={positions}
                    value={modalPosition}
                    onChange={setModalPosition}
                    selectStyle={{ ...styles.input, width: '100%' }}
                  />
                </>
              )}
              {!editingMode && (
                <>
                  <input
                    type="date"
                    value={modalDate}
                    onChange={(e) => setModalDate(e.target.value)}
                    style={styles.input}
                  />
                  <select
                    value={modalEmployee}
                    onChange={(e) => setModalEmployee(e.target.value)}
                    style={styles.input}
                  >
                    <option value="">Select Employee</option>
                    {employees.map(emp => (
                      <option key={emp.id} value={emp.id}>{emp.full_name}</option>
                    ))}
                  </select>
                  <PositionSelectWithNew
                    businessId={businessId}
                    positions={positions}
                    value={modalPosition}
                    onChange={setModalPosition}
                    selectStyle={{ ...styles.input, width: '100%' }}
                  />
                </>
              )}
            </div>

            {/* Section 2: Clock In/Out */}
            <div style={styles.section}>
              <div style={styles.sectionTitle}>Time & Schedule</div>
              {selectedTimecard?.scheduled_shift && (
                <div style={{ marginBottom: '12px' }}>
                  <div style={{ fontSize: '14px', color: '#374151', fontWeight: 600, marginBottom: '4px' }}>
                    {dayjs.tz(
                      `${selectedTimecard.scheduled_shift.shift_date || modalDate}T12:00:00`,
                      businessTimezone
                    ).format('dddd, MMM D, YYYY')}
                  </div>
                  <div style={{ fontSize: '14px', color: '#6b7280', marginBottom: '8px' }}>
                    Scheduled: {formatTime(getShiftDateTime(selectedTimecard.scheduled_shift, 'start_time'))} - {formatTime(getShiftDateTime(selectedTimecard.scheduled_shift, 'end_time'))}
                  </div>
                  <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
                    <select
                      value={modalShiftStatus}
                      onChange={(e) => setModalShiftStatus(e.target.value)}
                      style={{ ...styles.input, maxWidth: '220px', marginBottom: 0 }}
                    >
                      <option value="scheduled">Scheduled</option>
                      <option value="confirmed">Confirmed</option>
                      <option value="sick">Sick</option>
                      <option value="no_show">No Show</option>
                      <option value="cancelled">Cancelled</option>
                    </select>
                    <button
                      type="button"
                      onClick={() => setModalShiftStatus(modalShiftStatus === 'sick' ? 'scheduled' : 'sick')}
                      style={{
                        ...styles.button,
                        backgroundColor: modalShiftStatus === 'sick' ? '#6b7280' : '#ef4444',
                        color: 'white'
                      }}
                    >
                      {modalShiftStatus === 'sick' ? 'Clear Sick' : 'Mark Sick'}
                    </button>
                  </div>
                  {String(selectedTimecard.scheduled_shift?.notes || '').trim() !== '' && (
                    <div
                      style={{
                        marginTop: '12px',
                        padding: '12px 14px',
                        borderRadius: '8px',
                        backgroundColor: '#f8fafc',
                        border: '1px solid #e2e8f0',
                      }}
                    >
                      <div style={{ fontSize: '13px', fontWeight: 700, color: '#475569', marginBottom: '6px' }}>
                        Shift notes (manager)
                      </div>
                      <div style={{ fontSize: '14px', color: '#1e293b', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
                        {String(selectedTimecard.scheduled_shift.notes).trim()}
                      </div>
                      {selectedTimecard.scheduled_shift.notes_visible_to_staff === true ? (
                        <div style={{ fontSize: '13px', color: '#047857', marginTop: '8px' }}>
                          Shown to staff on punch clock and employee portal after clock-in.
                        </div>
                      ) : (
                        <div style={{ fontSize: '13px', color: '#64748b', marginTop: '8px' }}>
                          Not shown to staff on punch clock / portal — timesheets and schedule only.
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
              <label style={{ display: 'block', marginBottom: '6px', fontWeight: '600' }}>Clock In</label>
              <input
                type="time"
                value={modalClockIn}
                onChange={(e) => setModalClockIn(e.target.value)}
                style={styles.input}
              />
              <label style={{ display: 'block', marginBottom: '6px', fontWeight: '600' }}>Clock Out</label>
              <input
                type="time"
                value={modalClockOut}
                onChange={(e) => setModalClockOut(e.target.value)}
                style={styles.input}
              />
            </div>

            {/* Section 3: Breaks */}
            <div style={styles.section}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '12px' }}>
                <div style={{ ...styles.sectionTitle, marginBottom: 0 }}>Breaks</div>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  {shouldShowAcceptPaidMissedBreak() && (
                    <button
                      type="button"
                      onClick={handleAcceptPaidMissedBreak}
                      style={{
                        ...styles.button,
                        backgroundColor: '#059669',
                        color: 'white',
                        padding: '8px 12px'
                      }}
                    >
                      Accept Missed Break as Paid
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={handleAddBreak}
                    style={{
                      ...styles.button,
                      backgroundColor: TavariStyles.colors.primary,
                      color: 'white',
                      padding: '8px 12px'
                    }}
                  >
                    Add Break
                  </button>
                </div>
              </div>
              {modalBreaks && modalBreaks.filter(breakItem => !breakItem._deleted).length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {modalBreaks.map((breakItem, idx) => breakItem._deleted ? null : (
                    <div key={idx} style={{ 
                      padding: '12px', 
                      backgroundColor: '#f3f4f6', 
                      borderRadius: '6px',
                      fontSize: '14px'
                    }}>
                      <div style={{
                        display: 'grid',
                        gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr) 42px',
                        columnGap: '18px',
                        rowGap: '12px',
                        alignItems: 'end'
                      }}>
                        <div style={{ minWidth: 0 }}>
                          <label style={{ display: 'block', marginBottom: '4px', fontWeight: '600' }}>Break Out</label>
                          <input
                            type="time"
                            value={breakItem.break_start_time || ''}
                            onChange={(e) => handleUpdateBreak(idx, { break_start_time: e.target.value })}
                            style={{ ...styles.input, marginBottom: 0 }}
                          />
                        </div>
                        <div style={{ minWidth: 0 }}>
                          <label style={{ display: 'block', marginBottom: '4px', fontWeight: '600' }}>Break In</label>
                          <input
                            type="time"
                            value={breakItem.break_end_time || ''}
                            onChange={(e) => handleUpdateBreak(idx, { break_end_time: e.target.value })}
                            style={{ ...styles.input, marginBottom: 0 }}
                          />
                        </div>
                        <div style={{ minWidth: 0 }}>
                          <label style={{ display: 'block', marginBottom: '4px', fontWeight: '600' }}>Type</label>
                          <select
                            value={normalizeBreakType(breakItem.break_type)}
                            onChange={(e) => handleUpdateBreak(idx, {
                              break_type: e.target.value,
                              is_paid: e.target.value === 'rest'
                            })}
                            style={{ ...styles.input, marginBottom: 0 }}
                          >
                            <option value="meal">Meal / Unpaid</option>
                            <option value="rest">Rest / Paid</option>
                            <option value="other">Other</option>
                          </select>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleRemoveBreak(idx)}
                          style={{
                            ...styles.button,
                            backgroundColor: '#ef4444',
                            color: 'white',
                            padding: '8px',
                            marginTop: '22px'
                          }}
                          title="Remove break"
                        >
                          <X size={16} />
                        </button>
                      </div>
                      <input
                        value={breakItem.notes || ''}
                        onChange={(e) => handleUpdateBreak(idx, { notes: e.target.value })}
                        style={{ ...styles.input, marginTop: '8px', marginBottom: 0 }}
                        placeholder="Break notes"
                      />
                      <div style={{ marginTop: '8px', color: '#6b7280' }}>
                        <strong>Duration:</strong> {calculateModalBreakDuration(breakItem) || 0} minutes
                        {breakItem.is_paid ? ' (paid)' : ''}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ fontSize: '14px', color: '#6b7280' }}>No breaks recorded. Use Add Break to create one manually.</div>
              )}
            </div>

            {/* Section 4: Notes */}
            <div style={styles.section}>
              <div style={styles.sectionTitle}>Notes</div>
              {modalNotes?.trim() ? (
                <>
                  <div
                    style={{
                      marginBottom: '12px',
                      padding: '12px 14px',
                      backgroundColor: '#f0fdf4',
                      border: '1px solid #bbf7d0',
                      borderRadius: '8px',
                      fontSize: '14px',
                      color: '#166534',
                    }}
                  >
                    <div style={{ fontWeight: '600', marginBottom: '8px' }}>What this means</div>
                    <ul style={{ margin: 0, paddingLeft: '18px', lineHeight: 1.55 }}>
                      {humanizeTimeClockNoteLines(modalNotes, {
                        scheduledShift: selectedTimecard?.scheduled_shift,
                      }).map((line, i) => (
                        <li key={i}>{line}</li>
                      ))}
                    </ul>
                  </div>
                  <details style={{ marginBottom: '12px', fontSize: '13px', color: '#6b7280' }}>
                    <summary style={{ cursor: 'pointer', fontWeight: '500' }}>Exact text stored on the timecard</summary>
                    <pre
                      style={{
                        whiteSpace: 'pre-wrap',
                        fontFamily: 'ui-monospace, monospace',
                        fontSize: '13px',
                        backgroundColor: '#f9fafb',
                        padding: '10px',
                        borderRadius: '6px',
                        marginTop: '8px',
                        color: '#374151',
                      }}
                    >
                      {modalNotes}
                    </pre>
                  </details>
                </>
              ) : null}
              <label style={{ display: 'block', marginBottom: '6px', fontWeight: '600' }}>Edit notes</label>
              <textarea
                value={modalNotes}
                onChange={(e) => setModalNotes(e.target.value)}
                rows={4}
                style={styles.input}
                placeholder="Add or edit notes for managers…"
              />
            </div>

            {/* Section 4b: GPS (employee app punches) */}
            {!selectedTimecard?.is_scheduled_placeholder && (
              <TimeClockGpsManagerSection
                styles={styles}
                locationPayload={selectedTimecard?.location}
                businessTimezone={businessTimezone}
              />
            )}

            {/* Section 5: Photos */}
            <div style={styles.section}>
              <div style={styles.sectionTitle}>Photos</div>
              {modalPhotos && modalPhotos.length > 0 ? (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '12px' }}>
                  {modalPhotos.map((photo, idx) => (
                    <div key={idx} style={{ 
                      border: '1px solid #e5e7eb', 
                      borderRadius: '8px',
                      overflow: 'hidden'
                    }}>
                      {photo.hasPhoto && photo.url ? (
                        <img 
                          src={photo.url} 
                          alt={photo.event}
                          style={{ 
                            width: '100%', 
                            height: '200px', 
                            objectFit: 'cover',
                            display: 'block'
                          }}
                          onError={(e) => {
                            e.target.style.display = 'none';
                            e.target.parentElement.innerHTML = '<div style="padding: 20px; text-align: center; color: #6b7280;">Failed to load image</div>';
                          }}
                        />
                      ) : (
                        <div style={{ 
                          width: '100%', 
                          height: '200px', 
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          backgroundColor: '#f3f4f6',
                          color: '#6b7280'
                        }}>
                          No image taken
                        </div>
                      )}
                      <div style={{ padding: '8px', fontSize: '13px', color: '#6b7280' }}>
                        <div><strong>{photo.event}</strong></div>
                        {photo.timestamp && (
                          <div>{formatTime(photo.timestamp)}</div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ fontSize: '14px', color: '#6b7280' }}>No photos available</div>
              )}
            </div>

            {/* Section 6: Edit History */}
            <div style={styles.section}>
              <div style={styles.sectionTitle}>Edit History</div>
              {modalEditHistory && modalEditHistory.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {modalEditHistory.map((edit, idx) => (
                    <div key={idx} style={{ 
                      padding: '12px', 
                      backgroundColor: '#f3f4f6', 
                      borderRadius: '6px',
                      fontSize: '14px'
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                        <div><strong>{edit.changed_by_name || 'Unknown User'}</strong></div>
                        <div style={{ color: '#6b7280' }}>{dayjs(edit.created_at).format('MMM D, YYYY h:mm A')}</div>
                      </div>
                      {edit.changes && (
                        <div style={{ color: '#6b7280', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                          {Object.entries(edit.changes).map(([field, change]) => (
                            <div key={field}>
                              {field === 'notes' ? (
                                <div style={{ color: '#374151' }}>
                                  <strong>{formatAuditField(field)}</strong>
                                  <div style={{ marginTop: '6px', fontSize: '13px', color: '#6b7280' }}>Before</div>
                                  {renderHumanizedNotesList(change?.from)}
                                  <div style={{ marginTop: '8px', fontSize: '13px', color: '#6b7280' }}>After</div>
                                  {renderHumanizedNotesList(change?.to)}
                                </div>
                              ) : (
                                <>
                                  <strong>{formatAuditField(field)}:</strong>{' '}
                                  {formatAuditValue(field, change?.from)} -&gt; {formatAuditValue(field, change?.to)}
                                </>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                      {edit.reason && (
                        <div style={{ marginTop: '4px', fontSize: '13px', color: '#6b7280' }}>
                          <strong>Reason:</strong> {edit.reason}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ fontSize: '14px', color: '#6b7280' }}>No edits recorded</div>
              )}
            </div>

            {/* Buttons */}
            <div style={styles.buttonGroup}>
              {selectedTimecard && (
                <button
                  onClick={handleDeleteTimecard}
                  style={{ ...styles.button, backgroundColor: '#ef4444', color: 'white' }}
                >
                  Delete
                </button>
              )}
              <button
                onClick={handleAttemptCloseModal}
                style={{ ...styles.button, backgroundColor: 'white', border: '1px solid #e5e7eb' }}
              >
                Cancel
              </button>
              <button
                onClick={handleSaveTimecard}
                style={{ ...styles.button, backgroundColor: TavariStyles.colors.primary, color: 'white' }}
              >
                Save
              </button>
            </div>
            </div>

            {showTimecardNav && (
              <button
                type="button"
                aria-label="Next timecard for this employee"
                title="Next timecard"
                disabled={!canNavigateNextTimecard}
                onClick={() => handleNavigateTimecard(1)}
                style={{
                  ...styles.modalNavArrow,
                  ...(!canNavigateNextTimecard ? styles.modalNavArrowDisabled : {}),
                }}
              >
                <ChevronRight size={28} aria-hidden />
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default TimesheetsTab;

