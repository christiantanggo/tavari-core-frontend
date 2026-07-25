import React, { useEffect, useMemo, useState } from 'react';
import { Calendar, Clock, MapPin, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import { supabase } from '../../supabaseClient';
import { TavariStyles } from '../../utils/TavariStyles';
import { getPublicUserId } from '../../utils/getPublicUserId';
import { getBusinessTimezone } from '../../utils/businessDateFormat';
import {
  ensureEmployeePortalSelectedProfile,
  getEmployeePortalSelectedBusinessId
} from '../../utils/employeeProfileSelection';
import DateDropdownInput from '../../components/UI/DateDropdownInput';

dayjs.extend(utc);
dayjs.extend(timezone);

/** Must match employee-notifications-action (business TZ calendar days, not browser local). */
const DEFAULT_BUSINESS_TZ = 'America/Toronto';

function getPresetRangeInBusinessTz(preset, tz) {
  const zone = tz || DEFAULT_BUSINESS_TZ;
  const now = dayjs().tz(zone);
  const today = now.format('YYYY-MM-DD');
  if (preset === 'today') return { startDate: today, endDate: today };
  if (preset === 'past30') {
    return { startDate: now.subtract(30, 'day').format('YYYY-MM-DD'), endDate: today };
  }
  if (preset === 'week') {
    const dow = now.day();
    const start = now.subtract(dow, 'day');
    return { startDate: start.format('YYYY-MM-DD'), endDate: start.add(6, 'day').format('YYYY-MM-DD') };
  }
  /* next30 (default) */
  return { startDate: today, endDate: now.add(30, 'day').format('YYYY-MM-DD') };
}

const getDefaultFilters = () => ({
  preset: 'next30',
  ...getPresetRangeInBusinessTz('next30', DEFAULT_BUSINESS_TZ)
});

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
  return date.toLocaleDateString('en-CA', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
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

const PortalSchedule = () => {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [business, setBusiness] = useState(null);
  const [employee, setEmployee] = useState(null);
  const [shifts, setShifts] = useState([]);
  const [filters, setFilters] = useState(getDefaultFilters);

  const loadSchedule = async ({ silent = false } = {}) => {
    try {
      if (silent) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }

      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (!authUser) return;

      const publicUserId = await getPublicUserId(authUser.email);
      if (!publicUserId) {
        toast.error('Employee profile not found');
        return;
      }

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
        role: row.role || 'employee'
      }));

      const resolved = ensureEmployeePortalSelectedProfile(profileList);
      const targetBusinessId = resolved?.business_id ?? getEmployeePortalSelectedBusinessId();

      const businessUser =
        businessUsers.find((row) => String(row.business_id) === String(targetBusinessId)) || businessUsers[0];

      if (!businessUser?.business_id) {
        toast.error('You are not associated with a business');
        return;
      }

      setBusiness(businessUser.businesses || { id: businessUser.business_id });
      setEmployee(businessUser.users || { id: publicUserId });

      const bizTz = getBusinessTimezone(businessUser.businesses || {});
      if (filters.preset !== 'custom') {
        const sync = getPresetRangeInBusinessTz(filters.preset, bizTz);
        if (sync.startDate !== filters.startDate || sync.endDate !== filters.endDate) {
          setFilters((prev) => ({ ...prev, ...sync }));
          setLoading(false);
          setRefreshing(false);
          return;
        }
      }

      const startDate = filters.startDate;
      const endDate = filters.endDate;
      const scheduleEmployeeIds = [...new Set([publicUserId, authUser.id].filter(Boolean))];

      const baseQuery = supabase
        .from('scheduling_shifts')
        .select('id, business_id, employee_id, shift_date, start_time, end_time, status, position, notes, is_published')
        .eq('business_id', businessUser.business_id)
        .in('employee_id', scheduleEmployeeIds)
        .gte('shift_date', startDate)
        .lte('shift_date', endDate)
        .order('shift_date', { ascending: true })
        .order('start_time', { ascending: true });

      let { data: shiftData, error: shiftError } = await baseQuery;

      if (shiftError?.message?.includes('is_published')) {
        const fallback = await supabase
          .from('scheduling_shifts')
          .select('id, business_id, employee_id, shift_date, start_time, end_time, status, position, notes')
          .eq('business_id', businessUser.business_id)
          .eq('employee_id', publicUserId)
          .gte('shift_date', startDate)
          .lte('shift_date', endDate)
          .order('shift_date', { ascending: true })
          .order('start_time', { ascending: true });

        shiftData = fallback.data;
        shiftError = fallback.error;
      }

      if (shiftError) throw shiftError;

      setShifts((shiftData || []).filter((shift) => shift.is_published !== false));
    } catch (error) {
      console.error('Error loading employee schedule:', error);
      toast.error('Could not load your schedule');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadSchedule();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.startDate, filters.endDate]);

  useEffect(() => {
    const onProfileChange = () => loadSchedule({ silent: true });
    window.addEventListener('employee-profile-selection-changed', onProfileChange);
    return () => window.removeEventListener('employee-profile-selection-changed', onProfileChange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.startDate, filters.endDate]);

  const applyPreset = (preset) => {
    const tz = getBusinessTimezone(business) || DEFAULT_BUSINESS_TZ;
    setFilters({
      preset,
      ...getPresetRangeInBusinessTz(preset, tz)
    });
  };

  const updateCustomDate = (field, value) => {
    setFilters((current) => ({
      ...current,
      preset: 'custom',
      [field]: value,
    }));
  };

  const nextShift = shifts[0] || null;
  const totalHours = useMemo(() => {
    return shifts.reduce((sum, shift) => {
      const hours = calculateHours(shift.start_time, shift.end_time);
      return sum + (hours || 0);
    }, 0);
  }, [shifts]);

  const styles = {
    page: {
      display: 'flex',
      flexDirection: 'column',
      gap: TavariStyles.spacing.lg,
      width: '100%',
      maxWidth: '100%',
      minWidth: 0,
      overflowX: 'hidden',
      boxSizing: 'border-box',
    },
    hero: {
      background: `linear-gradient(135deg, ${TavariStyles.colors.primary}, #0f766e)`,
      color: TavariStyles.colors.white,
      borderRadius: '24px',
      padding: TavariStyles.spacing.xl,
      boxShadow: TavariStyles.shadows?.lg || '0 10px 20px rgba(0,0,0,0.15)',
      width: '100%',
      maxWidth: '100%',
      minWidth: 0,
      boxSizing: 'border-box',
      overflowWrap: 'anywhere',
    },
    eyebrow: {
      fontSize: TavariStyles.typography.fontSize.sm,
      opacity: 0.85,
      marginBottom: TavariStyles.spacing.xs,
    },
    title: {
      fontSize: TavariStyles.typography.fontSize['2xl'],
      fontWeight: TavariStyles.typography.fontWeight.bold,
      margin: 0,
    },
    subtitle: {
      marginTop: TavariStyles.spacing.sm,
      opacity: 0.9,
    },
    summaryGrid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(min(160px, 100%), 1fr))',
      gap: TavariStyles.spacing.md,
      width: '100%',
      minWidth: 0,
    },
    summaryCard: {
      backgroundColor: TavariStyles.colors.white,
      border: `1px solid ${TavariStyles.colors.gray200}`,
      borderRadius: '18px',
      padding: TavariStyles.spacing.lg,
      boxShadow: TavariStyles.shadows?.sm || '0 1px 3px rgba(0,0,0,0.1)',
      minWidth: 0,
      boxSizing: 'border-box',
      overflowWrap: 'anywhere',
    },
    label: {
      color: TavariStyles.colors.gray600,
      fontSize: TavariStyles.typography.fontSize.sm,
      marginBottom: TavariStyles.spacing.xs,
    },
    value: {
      color: TavariStyles.colors.gray900,
      fontSize: TavariStyles.typography.fontSize.xl,
      fontWeight: TavariStyles.typography.fontWeight.bold,
    },
    sectionHeader: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: TavariStyles.spacing.md,
      flexWrap: 'wrap',
      minWidth: 0,
    },
    filtersCard: {
      backgroundColor: TavariStyles.colors.white,
      border: `1px solid ${TavariStyles.colors.gray200}`,
      borderRadius: '18px',
      padding: TavariStyles.spacing.lg,
      boxShadow: TavariStyles.shadows?.sm || '0 1px 3px rgba(0,0,0,0.1)',
      display: 'flex',
      flexDirection: 'column',
      gap: TavariStyles.spacing.md,
      minWidth: 0,
      boxSizing: 'border-box',
    },
    presetRow: {
      display: 'flex',
      flexWrap: 'wrap',
      gap: TavariStyles.spacing.sm,
    },
    presetButton: {
      border: `1px solid ${TavariStyles.colors.gray300}`,
      backgroundColor: TavariStyles.colors.white,
      borderRadius: '999px',
      padding: `${TavariStyles.spacing.sm} ${TavariStyles.spacing.md}`,
      color: TavariStyles.colors.gray700,
      cursor: 'pointer',
      fontWeight: TavariStyles.typography.fontWeight.medium,
    },
    presetButtonActive: {
      backgroundColor: TavariStyles.colors.primary + '15',
      borderColor: TavariStyles.colors.primary,
      color: TavariStyles.colors.primary,
    },
    dateRow: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(min(180px, 100%), 1fr))',
      gap: TavariStyles.spacing.md,
      minWidth: 0,
    },
    inputGroup: {
      display: 'flex',
      flexDirection: 'column',
      gap: TavariStyles.spacing.xs,
      minWidth: 0,
    },
    inputLabel: {
      color: TavariStyles.colors.gray600,
      fontSize: TavariStyles.typography.fontSize.sm,
      fontWeight: TavariStyles.typography.fontWeight.medium,
    },
    dateInput: {
      width: '100%',
      border: `1px solid ${TavariStyles.colors.gray300}`,
      borderRadius: '12px',
      padding: `${TavariStyles.spacing.sm} ${TavariStyles.spacing.md}`,
      color: TavariStyles.colors.gray900,
      boxSizing: 'border-box',
      fontSize: TavariStyles.typography.fontSize.base,
    },
    refreshButton: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: TavariStyles.spacing.xs,
      border: `1px solid ${TavariStyles.colors.gray300}`,
      backgroundColor: TavariStyles.colors.white,
      borderRadius: '999px',
      padding: `${TavariStyles.spacing.sm} ${TavariStyles.spacing.md}`,
      color: TavariStyles.colors.gray700,
      cursor: 'pointer',
      fontWeight: TavariStyles.typography.fontWeight.medium,
      flexShrink: 0,
    },
    shiftList: {
      display: 'flex',
      flexDirection: 'column',
      gap: TavariStyles.spacing.md,
      minWidth: 0,
    },
    shiftCard: {
      backgroundColor: TavariStyles.colors.white,
      border: `1px solid ${TavariStyles.colors.gray200}`,
      borderRadius: '18px',
      padding: TavariStyles.spacing.lg,
      boxShadow: TavariStyles.shadows?.sm || '0 1px 3px rgba(0,0,0,0.1)',
      minWidth: 0,
      maxWidth: '100%',
      boxSizing: 'border-box',
      overflowWrap: 'anywhere',
    },
    shiftTop: {
      display: 'flex',
      justifyContent: 'space-between',
      gap: TavariStyles.spacing.md,
      alignItems: 'flex-start',
      flexWrap: 'wrap',
      minWidth: 0,
    },
    shiftDate: {
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.gray900,
      fontSize: TavariStyles.typography.fontSize.lg,
    },
    shiftTime: {
      display: 'flex',
      alignItems: 'center',
      gap: TavariStyles.spacing.xs,
      color: TavariStyles.colors.gray700,
      marginTop: TavariStyles.spacing.xs,
      flexWrap: 'wrap',
      minWidth: 0,
    },
    pill: {
      borderRadius: '999px',
      padding: `${TavariStyles.spacing.xs} ${TavariStyles.spacing.md}`,
      backgroundColor: TavariStyles.colors.primary + '15',
      color: TavariStyles.colors.primary,
      fontSize: TavariStyles.typography.fontSize.sm,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      maxWidth: '100%',
      overflowWrap: 'anywhere',
    },
    notes: {
      marginTop: TavariStyles.spacing.md,
      color: TavariStyles.colors.gray600,
      lineHeight: 1.5,
    },
    empty: {
      textAlign: 'center',
      backgroundColor: TavariStyles.colors.white,
      border: `1px dashed ${TavariStyles.colors.gray300}`,
      borderRadius: '18px',
      padding: TavariStyles.spacing['2xl'],
      color: TavariStyles.colors.gray600,
      boxSizing: 'border-box',
      overflowWrap: 'anywhere',
    },
    loading: {
      textAlign: 'center',
      padding: TavariStyles.spacing['3xl'],
      color: TavariStyles.colors.gray600,
    },
  };

  if (loading) {
    return <div style={styles.loading}>Loading your schedule...</div>;
  }

  return (
    <div style={styles.page}>
      <section style={styles.hero}>
        <div style={styles.eyebrow}>{business?.name || 'Tavari'} Employee App</div>
        <h1 style={styles.title}>Your Schedule</h1>
        <div style={styles.subtitle}>
          {employee?.full_name ? `${employee.full_name}${employee.position ? ` · ${employee.position}` : ''}` : 'Upcoming shifts from your business schedule.'}
        </div>
      </section>

      <section style={styles.summaryGrid}>
        <div style={styles.summaryCard}>
          <div style={styles.label}>Next shift</div>
          <div style={styles.value}>{nextShift ? formatShiftDate(nextShift.shift_date) : 'None'}</div>
        </div>
        <div style={styles.summaryCard}>
          <div style={styles.label}>Upcoming shifts</div>
          <div style={styles.value}>{shifts.length}</div>
        </div>
        <div style={styles.summaryCard}>
          <div style={styles.label}>Scheduled hours</div>
          <div style={styles.value}>{totalHours ? totalHours.toFixed(1) : '0.0'}</div>
        </div>
      </section>

      <section style={styles.filtersCard}>
        <div>
          <h2 style={{ margin: 0, color: TavariStyles.colors.gray900 }}>Filter schedule</h2>
          <div style={{ color: TavariStyles.colors.gray600, marginTop: TavariStyles.spacing.xs }}>
            Choose a preset or enter a custom date range.
          </div>
        </div>
        <div style={styles.presetRow}>
          {[
            ['today', 'Today'],
            ['week', 'This week'],
            ['next30', 'Next 30 days'],
            ['past30', 'Past 30 days'],
          ].map(([preset, label]) => (
            <button
              key={preset}
              type="button"
              onClick={() => applyPreset(preset)}
              style={{
                ...styles.presetButton,
                ...(filters.preset === preset ? styles.presetButtonActive : {}),
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <div style={styles.dateRow}>
          <label style={styles.inputGroup}>
            <span style={styles.inputLabel}>Start date</span>
            <DateDropdownInput
              idPrefix="portal-schedule-filter-start"
              value={filters.startDate}
              onChange={(v) => updateCustomDate('startDate', v)}
              max={filters.endDate || undefined}
              selectStyle={styles.dateInput}
            />
          </label>
          <label style={styles.inputGroup}>
            <span style={styles.inputLabel}>End date</span>
            <DateDropdownInput
              idPrefix="portal-schedule-filter-end"
              value={filters.endDate}
              onChange={(v) => updateCustomDate('endDate', v)}
              min={filters.startDate || undefined}
              selectStyle={styles.dateInput}
            />
          </label>
        </div>
      </section>

      <section style={styles.sectionHeader}>
        <div>
          <h2 style={{ margin: 0, color: TavariStyles.colors.gray900 }}>Scheduled shifts</h2>
          <div style={{ color: TavariStyles.colors.gray600, marginTop: TavariStyles.spacing.xs }}>
            Showing {filters.startDate} to {filters.endDate}. Published shifts update here as managers change the schedule.
          </div>
        </div>
        <button type="button" onClick={() => loadSchedule({ silent: true })} style={styles.refreshButton} disabled={refreshing}>
          <RefreshCw size={16} />
          {refreshing ? 'Refreshing' : 'Refresh'}
        </button>
      </section>

      {shifts.length === 0 ? (
        <div style={styles.empty}>
          <Calendar size={32} style={{ color: TavariStyles.colors.primary, marginBottom: TavariStyles.spacing.sm }} />
          <div>No published shifts are scheduled for this date range.</div>
        </div>
      ) : (
        <div style={styles.shiftList}>
          {shifts.map((shift) => {
            const hours = calculateHours(shift.start_time, shift.end_time);
            return (
              <article key={shift.id} style={styles.shiftCard}>
                <div style={styles.shiftTop}>
                  <div>
                    <div style={styles.shiftDate}>{formatShiftDate(shift.shift_date)}</div>
                    <div style={styles.shiftTime}>
                      <Clock size={16} />
                      <span>{formatTime(shift.start_time)} - {formatTime(shift.end_time)}</span>
                      {hours ? <span>({hours.toFixed(1)} hrs)</span> : null}
                    </div>
                  </div>
                  <div style={styles.pill}>{shift.position || shift.status || 'Shift'}</div>
                </div>

                {business?.name && (
                  <div style={{ ...styles.shiftTime, marginTop: TavariStyles.spacing.md }}>
                    <MapPin size={16} />
                    <span>{business.name}</span>
                  </div>
                )}

                {shift.notes && <div style={styles.notes}>{shift.notes}</div>}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default PortalSchedule;

