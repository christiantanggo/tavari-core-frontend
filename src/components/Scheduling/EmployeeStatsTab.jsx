import React, { useEffect, useMemo, useState } from 'react';
import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';
import { supabase } from '../../supabaseClient';
import { TavariStyles } from '../../utils/TavariStyles';
import { resolveEmploymentFields } from '../../utils/businessEmploymentStatus';
import { isPayrollVisibleForPeriod } from '../../utils/payrollEmployeeEligibility';

dayjs.extend(utc);
dayjs.extend(timezone);

const LATE_THRESHOLD_MINUTES = 5;
const MISSED_BREAK_MINUTES = 360;

const EmployeeStatsTab = ({ businessId }) => {
  const [loading, setLoading] = useState(true);
  const [businessTimezone, setBusinessTimezone] = useState('America/Toronto');
  const [startDate, setStartDate] = useState(dayjs().subtract(30, 'day').format('YYYY-MM-DD'));
  const [endDate, setEndDate] = useState(dayjs().format('YYYY-MM-DD'));
  const [employees, setEmployees] = useState([]);
  const [shifts, setShifts] = useState([]);
  const [timecards, setTimecards] = useState([]);
  const [breaks, setBreaks] = useState([]);

  useEffect(() => {
    if (!businessId) return;
    loadStats();
  }, [businessId, startDate, endDate]);

  const loadStats = async () => {
    try {
      setLoading(true);

      const businessResult = await supabase
        .from('businesses')
        .select('timezone')
        .eq('id', businessId)
        .maybeSingle();
      if (businessResult.error && businessResult.error.code !== 'PGRST116') throw businessResult.error;

      const timeZone = businessResult.data?.timezone || businessTimezone || 'America/Toronto';
      setBusinessTimezone(timeZone);

      const clockStart = dayjs.tz(`${startDate}T00:00:00`, timeZone).toISOString();
      const clockEnd = dayjs.tz(`${endDate}T23:59:59`, timeZone).toISOString();

      const [
        employeeResult,
        businessIdUsersResult,
        shiftResult,
        timecardResult,
        breakResult
      ] = await Promise.all([
        supabase
          .from('business_users')
          .select(`
            user_id,
            role,
            employment_status,
            termination_date,
            users!business_users_user_id_fkey (
              id,
              full_name,
              position,
              is_active,
              employment_status,
              termination_date
            )
          `)
          .eq('business_id', businessId),
        supabase
          .from('users')
          .select('id, full_name, position, is_active, employment_status, termination_date')
          .eq('business_id', businessId),
        supabase
          .from('scheduling_shifts')
          .select('id, employee_id, shift_date, start_time, end_time, status, position')
          .eq('business_id', businessId)
          .gte('shift_date', startDate)
          .lte('shift_date', endDate),
        supabase
          .from('scheduling_time_clocks')
          .select('id, employee_id, clock_in_time, clock_out_time, break_duration_minutes')
          .eq('business_id', businessId)
          .gte('clock_in_time', clockStart)
          .lte('clock_in_time', clockEnd),
        supabase
          .from('scheduling_break_tracking')
          .select('id, employee_id, time_clock_id, duration_minutes, is_paid, break_type')
          .eq('business_id', businessId)
      ]);

      if (employeeResult.error) throw employeeResult.error;
      if (businessIdUsersResult.error) throw businessIdUsersResult.error;
      if (shiftResult.error) throw shiftResult.error;
      if (timecardResult.error) throw timecardResult.error;
      if (breakResult.error) throw breakResult.error;

      const employeeMap = new Map();

      (employeeResult.data || [])
        .filter((entry) => {
          if (entry.users?.is_active === false) return false;
          const resolved = resolveEmploymentFields({ membership: entry, user: entry.users });
          return isPayrollVisibleForPeriod(resolved, startDate);
        })
        .forEach((entry) => {
          employeeMap.set(entry.users.id, {
            id: entry.users.id,
            full_name: entry.users.full_name || 'Unknown Employee',
            position: entry.users.position || '',
            role: entry.role || 'employee'
          });
        });

      (businessIdUsersResult.data || [])
        .filter((user) => {
          if (user.is_active === false) return false;
          return isPayrollVisibleForPeriod(user, startDate);
        })
        .forEach((user) => {
          if (!employeeMap.has(user.id)) {
            employeeMap.set(user.id, {
              id: user.id,
              full_name: user.full_name || 'Unknown Employee',
              position: user.position || '',
              role: 'employee'
            });
          }
        });

      setEmployees(Array.from(employeeMap.values()).sort((a, b) => a.full_name.localeCompare(b.full_name)));
      setShifts(shiftResult.data || []);
      setTimecards(timecardResult.data || []);
      setBreaks(breakResult.data || []);
    } catch (error) {
      console.error('Error loading employee stats:', error);
    } finally {
      setLoading(false);
    }
  };

  const stats = useMemo(() => {
    const employeeMap = new Map(employees.map((employee) => [employee.id, employee]));
    const breaksByTimecard = breaks.reduce((acc, breakItem) => {
      if (!acc[breakItem.time_clock_id]) acc[breakItem.time_clock_id] = [];
      acc[breakItem.time_clock_id].push(breakItem);
      return acc;
    }, {});

    const timecardsByEmployeeDate = timecards.reduce((acc, timecard) => {
      const date = dayjs(timecard.clock_in_time).tz(businessTimezone).format('YYYY-MM-DD');
      const key = `${timecard.employee_id}:${date}`;
      if (!acc[key]) acc[key] = [];
      acc[key].push(timecard);
      return acc;
    }, {});

    const rowsByEmployee = employees.reduce((acc, employee) => {
      acc[employee.id] = {
        employeeId: employee.id,
        name: employee.full_name,
        late: 0,
        missedBreaks: 0,
        sick: 0,
        noClockIn: 0,
        shifts: 0,
        timecards: 0
      };
      return acc;
    }, {});

    shifts.forEach((shift) => {
      if (!rowsByEmployee[shift.employee_id]) {
        const fallback = employeeMap.get(shift.employee_id);
        rowsByEmployee[shift.employee_id] = {
          employeeId: shift.employee_id,
          name: fallback?.full_name || 'Unknown Employee',
          late: 0,
          missedBreaks: 0,
          sick: 0,
          noClockIn: 0,
          shifts: 0,
          timecards: 0
        };
      }

      const row = rowsByEmployee[shift.employee_id];
      row.shifts += 1;

      if (shift.status === 'sick') {
        row.sick += 1;
        return;
      }

      const matchingTimecards = timecardsByEmployeeDate[`${shift.employee_id}:${shift.shift_date}`] || [];
      const bestTimecard = findClosestTimecard(shift, matchingTimecards, businessTimezone);

      if (!bestTimecard) {
        if (['scheduled', 'confirmed', 'no_show'].includes(shift.status || 'scheduled')) {
          row.noClockIn += 1;
        }
        return;
      }

      const shiftStart = dayjs.tz(`${shift.shift_date}T${shift.start_time}`, businessTimezone);
      const clockIn = dayjs(bestTimecard.clock_in_time).tz(businessTimezone);
      const minutesLate = clockIn.diff(shiftStart, 'minute');
      if (minutesLate > LATE_THRESHOLD_MINUTES) {
        row.late += 1;
      }

      if (bestTimecard.clock_out_time) {
        const workedMinutes = dayjs(bestTimecard.clock_out_time).diff(dayjs(bestTimecard.clock_in_time), 'minute');
        const timecardBreaks = breaksByTimecard[bestTimecard.id] || [];
        const unpaidBreakMinutes = timecardBreaks
          .filter((breakItem) => !breakItem.is_paid && breakItem.break_type !== 'paid')
          .reduce((total, breakItem) => total + Number(breakItem.duration_minutes || 0), 0);
        const hasPaidBreakResolution = timecardBreaks.some((breakItem) => breakItem.is_paid);

        if (workedMinutes > MISSED_BREAK_MINUTES && unpaidBreakMinutes === 0 && !hasPaidBreakResolution) {
          row.missedBreaks += 1;
        }
      }
    });

    timecards.forEach((timecard) => {
      if (!rowsByEmployee[timecard.employee_id]) {
        rowsByEmployee[timecard.employee_id] = {
          employeeId: timecard.employee_id,
          name: employeeMap.get(timecard.employee_id)?.full_name || 'Unknown Employee',
          late: 0,
          missedBreaks: 0,
          sick: 0,
          noClockIn: 0,
          shifts: 0,
          timecards: 0
        };
      }
      rowsByEmployee[timecard.employee_id].timecards += 1;
    });

    return Object.values(rowsByEmployee).sort((a, b) => a.name.localeCompare(b.name));
  }, [employees, shifts, timecards, breaks, businessTimezone]);

  const totals = useMemo(() => stats.reduce((acc, row) => ({
    late: acc.late + row.late,
    missedBreaks: acc.missedBreaks + row.missedBreaks,
    sick: acc.sick + row.sick,
    noClockIn: acc.noClockIn + row.noClockIn,
    shifts: acc.shifts + row.shifts
  }), { late: 0, missedBreaks: 0, sick: 0, noClockIn: 0, shifts: 0 }), [stats]);

  if (!businessId) {
    return <div style={styles.emptyState}>Select a business to view employee stats.</div>;
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <div>
          <h2 style={styles.title}>Employee Stats</h2>
          <p style={styles.subtitle}>
            Track attendance signals like late arrivals, missed breaks, sick shifts, and scheduled shifts with no clock-in.
          </p>
        </div>
        <div style={styles.dateControls}>
          <input
            type="date"
            value={startDate}
            onChange={(event) => setStartDate(event.target.value)}
            style={styles.input}
          />
          <span style={styles.toLabel}>to</span>
          <input
            type="date"
            value={endDate}
            onChange={(event) => setEndDate(event.target.value)}
            style={styles.input}
          />
        </div>
      </div>

      {loading ? (
        <div style={styles.emptyState}>Loading employee stats...</div>
      ) : (
        <>
          <div style={styles.summaryGrid}>
            <MetricCard label="Scheduled Shifts" value={totals.shifts} />
            <MetricCard label="Times Late" value={totals.late} />
            <MetricCard label="Missed Breaks" value={totals.missedBreaks} />
            <MetricCard label="Sick Shifts" value={totals.sick} />
            <MetricCard label="No Clock-In" value={totals.noClockIn} />
          </div>

          <div style={styles.chartCard}>
            <h3 style={styles.cardTitle}>Employee Attendance Signals</h3>
            <div style={styles.chartWrap}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={stats} margin={{ top: 16, right: 24, left: 0, bottom: 50 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="name" angle={-30} textAnchor="end" interval={0} height={70} />
                  <YAxis allowDecimals={false} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="late" name="Times Late" fill="#f59e0b" />
                  <Bar dataKey="missedBreaks" name="Missed Breaks" fill="#ef4444" />
                  <Bar dataKey="sick" name="Sick" fill="#8b5cf6" />
                  <Bar dataKey="noClockIn" name="No Clock-In" fill="#6b7280" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div style={styles.tableCard}>
            <h3 style={styles.cardTitle}>Employee Detail</h3>
            <div style={styles.table}>
              <div style={styles.tableHeader}>Employee</div>
              <div style={styles.tableHeader}>Shifts</div>
              <div style={styles.tableHeader}>Timecards</div>
              <div style={styles.tableHeader}>Times Late</div>
              <div style={styles.tableHeader}>Missed Breaks</div>
              <div style={styles.tableHeader}>Sick</div>
              <div style={styles.tableHeader}>No Clock-In</div>
              {stats.map((row) => (
                <React.Fragment key={row.employeeId}>
                  <div style={styles.tableCell}>{row.name}</div>
                  <div style={styles.tableCell}>{row.shifts}</div>
                  <div style={styles.tableCell}>{row.timecards}</div>
                  <div style={styles.tableCell}>{row.late}</div>
                  <div style={styles.tableCell}>{row.missedBreaks}</div>
                  <div style={styles.tableCell}>{row.sick}</div>
                  <div style={styles.tableCell}>{row.noClockIn}</div>
                </React.Fragment>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
};

const findClosestTimecard = (shift, timecards, businessTimezone) => {
  if (!timecards.length) return null;
  if (timecards.length === 1) return timecards[0];

  const shiftStart = dayjs.tz(`${shift.shift_date}T${shift.start_time}`, businessTimezone);
  return timecards.reduce((closest, timecard) => {
    const currentDiff = Math.abs(dayjs(timecard.clock_in_time).diff(shiftStart, 'minute'));
    const closestDiff = Math.abs(dayjs(closest.clock_in_time).diff(shiftStart, 'minute'));
    return currentDiff < closestDiff ? timecard : closest;
  }, timecards[0]);
};

const MetricCard = ({ label, value }) => (
  <div style={styles.metricCard}>
    <div style={styles.metricValue}>{value}</div>
    <div style={styles.metricLabel}>{label}</div>
  </div>
);

const styles = {
  container: {
    padding: '24px',
    backgroundColor: TavariStyles.colors.background
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: '16px',
    marginBottom: '20px',
    flexWrap: 'wrap'
  },
  title: {
    margin: 0,
    color: '#111827',
    fontSize: '24px'
  },
  subtitle: {
    margin: '6px 0 0',
    color: '#6b7280',
    fontSize: '14px'
  },
  dateControls: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    flexWrap: 'wrap'
  },
  input: {
    padding: '10px',
    border: '1px solid #e5e7eb',
    borderRadius: '6px',
    fontSize: '14px',
    boxSizing: 'border-box'
  },
  toLabel: {
    color: '#6b7280'
  },
  summaryGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
    gap: '12px',
    marginBottom: '20px'
  },
  metricCard: {
    backgroundColor: 'white',
    border: '1px solid #e5e7eb',
    borderRadius: '10px',
    padding: '16px'
  },
  metricValue: {
    fontSize: '28px',
    fontWeight: 700,
    color: '#008080'
  },
  metricLabel: {
    color: '#6b7280',
    fontSize: '13px',
    marginTop: '4px'
  },
  chartCard: {
    backgroundColor: 'white',
    border: '1px solid #e5e7eb',
    borderRadius: '10px',
    padding: '18px',
    marginBottom: '20px'
  },
  cardTitle: {
    margin: '0 0 14px',
    fontSize: '18px',
    color: '#111827'
  },
  chartWrap: {
    height: '360px'
  },
  tableCard: {
    backgroundColor: 'white',
    border: '1px solid #e5e7eb',
    borderRadius: '10px',
    padding: '18px'
  },
  table: {
    display: 'grid',
    gridTemplateColumns: '2fr repeat(6, 1fr)',
    border: '1px solid #e5e7eb',
    borderRadius: '8px',
    overflow: 'auto'
  },
  tableHeader: {
    padding: '10px',
    backgroundColor: '#008080',
    color: 'white',
    fontWeight: 700,
    fontSize: '13px'
  },
  tableCell: {
    padding: '10px',
    borderTop: '1px solid #e5e7eb',
    backgroundColor: 'white',
    fontSize: '13px'
  },
  emptyState: {
    padding: '40px',
    textAlign: 'center',
    color: '#6b7280'
  }
};

export default EmployeeStatsTab;
