import React, { useCallback, useEffect, useMemo, useState } from 'react';
import dayjs from 'dayjs';
import { ChevronLeft, ChevronRight, Plus, RefreshCw, Send, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { supabase } from '../../supabaseClient';
import { TavariStyles } from '../../utils/TavariStyles';
import { sendSchedulingNotification } from '../../helpers/Scheduling/schedulingNotificationService';
import { useBusinessPositions } from '../../hooks/useBusinessPositions';
import PositionLabel from '../../components/HR/PositionLabel';
import TavariCheckbox from '../../components/UI/TavariCheckbox';
import PositionSelectWithNew from '../HR/PositionSelectWithNew';
import { isSchedulingVisibleForWeek } from '../../utils/businessEmploymentStatus';

const getLocalDateString = (date = new Date()) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const addDaysToKey = (dateKey, days) => {
  const [y, m, d] = dateKey.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
};

const getWeekStartKey = (dateKey) => {
  const date = new Date(`${dateKey}T12:00:00`);
  date.setDate(date.getDate() - date.getDay());
  return getLocalDateString(date);
};

const formatTime = (timeString) => {
  if (!timeString) return '';
  const parts = String(timeString).split(':');
  const hours = Number(parts[0]);
  const minutes = parts[1] || '00';
  if (Number.isNaN(hours)) return '';
  const hour12 = hours % 12 || 12;
  const ampm = hours >= 12 ? 'PM' : 'AM';
  return `${hour12}:${minutes} ${ampm}`;
};

const formatDayHeader = (dateKey) => {
  const d = new Date(`${dateKey}T12:00:00`);
  return d.toLocaleDateString('en-CA', { weekday: 'long', month: 'short', day: 'numeric' });
};

const employeeDisplayName = (user) => {
  if (!user) return 'Employee';
  if (user.full_name?.trim()) return user.full_name.trim();
  return [user.first_name, user.last_name].filter(Boolean).join(' ').trim() || 'Employee';
};

const PortalScheduleManager = ({ businessId }) => {
  const [weekStart, setWeekStart] = useState(() => getWeekStartKey(getLocalDateString()));
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [shifts, setShifts] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [employeeNameById, setEmployeeNameById] = useState({});
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingShift, setEditingShift] = useState(null);

  const weekEnd = addDaysToKey(weekStart, 6);
  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDaysToKey(weekStart, i)),
    [weekStart],
  );

  const { rows: positionRows } = useBusinessPositions(businessId);

  const unpublishedCount = useMemo(
    () => shifts.filter((s) => s.is_published === false).length,
    [shifts],
  );

  const dayGroups = useMemo(() => {
    const byDate = new Map();
    for (const day of weekDays) byDate.set(day, []);
    for (const shift of shifts) {
      const d = String(shift.shift_date || '').slice(0, 10);
      if (byDate.has(d)) byDate.get(d).push(shift);
    }
    return weekDays.map((date) => ({
      date,
      shifts: (byDate.get(date) || []).sort((a, b) =>
        String(a.start_time || '').localeCompare(String(b.start_time || '')),
      ),
    }));
  }, [shifts, weekDays]);

  const loadEmployees = useCallback(async () => {
    if (!businessId) return;
    const { data: businessUsers, error } = await supabase
      .from('business_users')
      .select('user_id, role, employment_status, termination_date, employee_order, users!business_users_user_id_fkey(id, full_name, first_name, last_name, employment_status, position)')
      .eq('business_id', businessId);

    if (error) throw error;

    const map = new Map();
    for (const row of businessUsers || []) {
      const user = row.users;
      if (!user) continue;
      if (!isSchedulingVisibleForWeek({
        membership: row,
        user,
        role: row.role,
      })) continue;
      map.set(user.id, {
        id: user.id,
        full_name: employeeDisplayName(user),
        position: user.position || '',
        order: Number.isInteger(row.employee_order) ? row.employee_order : null,
      });
    }

    const list = [...map.values()].sort((a, b) => {
      if (a.order != null || b.order != null) {
        const oa = a.order ?? Number.MAX_SAFE_INTEGER;
        const ob = b.order ?? Number.MAX_SAFE_INTEGER;
        if (oa !== ob) return oa - ob;
      }
      return a.full_name.localeCompare(b.full_name);
    });

    setEmployees(list);
    const names = {};
    for (const emp of list) names[emp.id] = emp.full_name;
    setEmployeeNameById(names);
  }, [businessId]);

  const loadShifts = useCallback(async ({ silent = false } = {}) => {
    if (!businessId) return;
    try {
      if (silent) setRefreshing(true);
      else setLoading(true);

      const { data, error } = await supabase
        .from('scheduling_shifts')
        .select(`
          id, business_id, employee_id, shift_date, start_time, end_time, status, position,
          notes, notes_visible_to_staff, is_published, is_open_shift,
          users!scheduling_shifts_employee_id_fkey ( id, full_name, first_name, last_name )
        `)
        .eq('business_id', businessId)
        .gte('shift_date', weekStart)
        .lte('shift_date', weekEnd)
        .order('shift_date', { ascending: true })
        .order('start_time', { ascending: true });

      if (error) throw error;
      setShifts(data || []);
    } catch (e) {
      console.error('[PortalScheduleManager]', e);
      toast.error('Could not load schedule');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [businessId, weekStart, weekEnd]);

  useEffect(() => {
    if (!businessId) return;
    loadEmployees();
  }, [businessId, loadEmployees]);

  useEffect(() => {
    if (!businessId) return;
    loadShifts();
  }, [businessId, loadShifts]);

  const notifyPublishedShiftsForWeek = async (publishedShifts, weekStartDate) => {
    const weekEndDate = addDaysToKey(weekStartDate, 6);
    const shiftsByEmployee = (publishedShifts || []).reduce((map, shift) => {
      if (!shift.employee_id) return map;
      if (!map[shift.employee_id]) map[shift.employee_id] = [];
      map[shift.employee_id].push(shift);
      return map;
    }, {});

    let fullWeekShiftsByEmployee = {};
    const { data: fullWeekShifts, error: fullWeekError } = await supabase
      .from('scheduling_shifts')
      .select('id, employee_id, shift_date, start_time, end_time, position, status, is_published')
      .eq('business_id', businessId)
      .gte('shift_date', weekStartDate)
      .lte('shift_date', weekEndDate);

    if (!fullWeekError) {
      fullWeekShiftsByEmployee = (fullWeekShifts || [])
        .filter((shift) => shift.is_published !== false)
        .reduce((map, shift) => {
          if (!shift.employee_id) return map;
          if (!map[shift.employee_id]) map[shift.employee_id] = [];
          map[shift.employee_id].push(shift);
          return map;
        }, {});
    }

    await Promise.all(
      Object.entries(shiftsByEmployee).map(([employeeId, employeeShifts]) =>
        sendSchedulingNotification({
          businessId,
          eventKey: 'schedule_posted',
          employeeId,
          context: {
            weekStart: weekStartDate,
            weekEnd: weekEndDate,
            changedShiftCount: employeeShifts.length,
            shiftCount: fullWeekShiftsByEmployee[employeeId]?.length || 0,
            shifts: fullWeekShiftsByEmployee[employeeId] || [],
            changedShifts: employeeShifts,
          },
        }),
      ),
    );
  };

  const handlePublishWeek = async () => {
    if (!businessId) return;
    try {
      setSaving(true);
      const { data: auth } = await supabase.auth.getUser();
      const publishedAt = new Date().toISOString();
      const { data: publishedShifts, error } = await supabase
        .from('scheduling_shifts')
        .update({
          is_published: true,
          published_by: auth.user?.id,
          updated_at: publishedAt,
        })
        .eq('business_id', businessId)
        .is('is_published', false)
        .gte('shift_date', weekStart)
        .lte('shift_date', weekEnd)
        .select('id, employee_id, shift_date, start_time, end_time, position');

      if (error) throw error;

      const count = publishedShifts?.length || 0;
      if (count === 0) {
        toast.success('No pending shifts to publish');
      } else {
        toast.success(`Published ${count} shift${count === 1 ? '' : 's'}`);
        await notifyPublishedShiftsForWeek(publishedShifts, weekStart);
      }
      await loadShifts({ silent: true });
    } catch (e) {
      console.error('[PortalScheduleManager] publish', e);
      toast.error('Failed to publish shifts');
    } finally {
      setSaving(false);
    }
  };

  const handleCreateShift = async (form, publish = false) => {
    if (!businessId) return;
    try {
      setSaving(true);
      const { data: auth } = await supabase.auth.getUser();
      const publishedAt = publish ? new Date().toISOString() : undefined;
      const payload = {
        business_id: businessId,
        employee_id: form.employeeId,
        shift_date: form.shiftDate,
        start_time: `${form.startTime}:00`,
        end_time: `${form.endTime}:00`,
        position: form.position,
        notes: form.notes || '',
        notes_visible_to_staff: form.notesVisibleToStaff,
        status: 'scheduled',
        is_published: publish,
        created_by: auth.user?.id,
        ...(publish ? { published_by: auth.user?.id, updated_at: publishedAt } : {}),
      };

      const { data: inserted, error } = await supabase
        .from('scheduling_shifts')
        .insert(payload)
        .select('id, employee_id, shift_date, start_time, end_time, position');

      if (error) throw error;

      if (publish && inserted?.length) {
        await notifyPublishedShiftsForWeek(inserted, form.shiftDate);
      }

      toast.success(publish ? 'Shift saved and published' : 'Shift created (pending publication)');
      setShowCreateModal(false);
      if (form.shiftDate < weekStart || form.shiftDate > weekEnd) {
        setWeekStart(getWeekStartKey(form.shiftDate));
      } else {
        await loadShifts({ silent: true });
      }
    } catch (e) {
      console.error('[PortalScheduleManager] create', e);
      toast.error('Failed to create shift');
    } finally {
      setSaving(false);
    }
  };

  const handleUpdateShift = async (form) => {
    if (!editingShift?.id) return;
    try {
      setSaving(true);
      const wasPublished = editingShift.is_published === true;
      const payload = {
        employee_id: form.employeeId,
        shift_date: form.shiftDate,
        start_time: `${form.startTime}:00`,
        end_time: `${form.endTime}:00`,
        position: form.position,
        notes: form.notes || '',
        notes_visible_to_staff: form.notesVisibleToStaff,
        updated_at: new Date().toISOString(),
        ...(wasPublished ? { is_published: false } : {}),
      };

      const { error } = await supabase
        .from('scheduling_shifts')
        .update(payload)
        .eq('id', editingShift.id)
        .eq('business_id', businessId);

      if (error) throw error;

      toast.success(
        wasPublished
          ? 'Shift updated — publish again when ready'
          : 'Shift updated',
      );
      setEditingShift(null);
      if (form.shiftDate < weekStart || form.shiftDate > weekEnd) {
        setWeekStart(getWeekStartKey(form.shiftDate));
      } else {
        await loadShifts({ silent: true });
      }
    } catch (e) {
      console.error('[PortalScheduleManager] update', e);
      toast.error('Failed to update shift');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteShift = async () => {
    if (!editingShift?.id) return;
    if (!window.confirm('Delete this shift?')) return;
    try {
      setSaving(true);
      const { data, error } = await supabase
        .from('scheduling_shifts')
        .delete()
        .eq('id', editingShift.id)
        .eq('business_id', businessId)
        .select();

      if (error) throw error;
      if (!data?.length) {
        toast.error('Could not delete shift — permission denied');
        return;
      }
      toast.success('Shift deleted');
      setEditingShift(null);
      await loadShifts({ silent: true });
    } catch (e) {
      console.error('[PortalScheduleManager] delete', e);
      toast.error('Failed to delete shift');
    } finally {
      setSaving(false);
    }
  };

  const weekLabel = `${dayjs(weekStart).format('MMM D')} – ${dayjs(weekEnd).format('MMM D, YYYY')}`;

  if (loading && !shifts.length) {
    return (
      <div style={styles.loadingCard}>
        <RefreshCw size={18} className="spin" />
        Loading manager schedule…
      </div>
    );
  }

  return (
    <div style={styles.wrap}>
      <div style={styles.toolbar}>
        <div style={styles.weekNav}>
          <button type="button" style={styles.iconBtn} onClick={() => setWeekStart(addDaysToKey(weekStart, -7))} aria-label="Previous week">
            <ChevronLeft size={20} />
          </button>
          <div style={styles.weekLabel}>{weekLabel}</div>
          <button type="button" style={styles.iconBtn} onClick={() => setWeekStart(addDaysToKey(weekStart, 7))} aria-label="Next week">
            <ChevronRight size={20} />
          </button>
        </div>
        <div style={styles.toolbarActions}>
          <button
            type="button"
            style={styles.secondaryBtn}
            onClick={() => loadShifts({ silent: true })}
            disabled={refreshing}
          >
            <RefreshCw size={16} /> {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
          <button
            type="button"
            style={styles.publishBtn}
            onClick={handlePublishWeek}
            disabled={saving || unpublishedCount === 0}
          >
            <Send size={16} />
            Publish{unpublishedCount > 0 ? ` (${unpublishedCount})` : ''}
          </button>
          <button type="button" style={styles.primaryBtn} onClick={() => setShowCreateModal(true)}>
            <Plus size={16} /> Add shift
          </button>
        </div>
      </div>

      {unpublishedCount > 0 && (
        <div style={styles.pendingBanner}>
          {unpublishedCount} shift{unpublishedCount === 1 ? '' : 's'} pending publication this week
        </div>
      )}

      <div style={styles.dayList}>
        {dayGroups.map(({ date, shifts: dayShifts }) => (
          <div key={date} style={styles.dayGroup}>
            <div style={styles.dayHeader}>{formatDayHeader(date)}</div>
            <div style={styles.dayBody}>
              {dayShifts.length === 0 ? (
                <div style={styles.emptyDay}>No shifts</div>
              ) : (
                dayShifts.map((shift) => {
                  const name =
                    employeeDisplayName(shift.users) ||
                    employeeNameById[shift.employee_id] ||
                    'Unassigned';
                  const pending = shift.is_published === false;
                  return (
                    <button
                      key={shift.id}
                      type="button"
                      style={{
                        ...styles.shiftCard,
                        ...(pending ? styles.shiftCardPending : {}),
                      }}
                      onClick={() => setEditingShift(shift)}
                    >
                      <div style={styles.shiftCardTop}>
                        <span style={styles.shiftName}>{name}</span>
                        {pending && <span style={styles.pendingPill}>Pending</span>}
                      </div>
                      <div style={styles.shiftMeta}>
                        <PositionLabel businessId={businessId} value={shift.position} emptyFallback="No position" />
                      </div>
                      <div style={styles.shiftTime}>
                        {formatTime(shift.start_time)} – {formatTime(shift.end_time)}
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        ))}
      </div>

      {showCreateModal && (
        <ShiftFormModal
          title="Add shift"
          businessId={businessId}
          employees={employees}
          positionRows={positionRows}
          initial={{
            employeeId: employees[0]?.id || '',
            shiftDate: weekStart,
            startTime: '09:00',
            endTime: '17:00',
            position: employees[0]?.position || positionRows[0]?.position_name || '',
            notes: '',
            notesVisibleToStaff: false,
          }}
          saving={saving}
          onClose={() => setShowCreateModal(false)}
          onSave={(form, publish) => handleCreateShift(form, publish)}
          showPublishActions
        />
      )}

      {editingShift && (
        <ShiftFormModal
          title="Edit shift"
          businessId={businessId}
          employees={employees}
          positionRows={positionRows}
          initial={{
            employeeId: editingShift.employee_id || '',
            shiftDate: String(editingShift.shift_date).slice(0, 10),
            startTime: String(editingShift.start_time || '09:00:00').slice(0, 5),
            endTime: String(editingShift.end_time || '17:00:00').slice(0, 5),
            position: editingShift.position || '',
            notes: editingShift.notes || '',
            notesVisibleToStaff: editingShift.notes_visible_to_staff === true,
          }}
          saving={saving}
          onClose={() => setEditingShift(null)}
          onSave={(form) => handleUpdateShift(form)}
          onDelete={handleDeleteShift}
        />
      )}
    </div>
  );
};

const ShiftFormModal = ({
  title,
  businessId,
  employees,
  positionRows,
  initial,
  saving,
  onClose,
  onSave,
  onDelete,
  showPublishActions = false,
}) => {
  const [form, setForm] = useState(initial);

  useEffect(() => {
    setForm(initial);
  }, [initial]);

  const setField = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));

  const handleSubmit = (e, publish = false) => {
    e.preventDefault();
    if (!form.employeeId) {
      toast.error('Select an employee');
      return;
    }
    if (!form.shiftDate) {
      toast.error('Select a date');
      return;
    }
    onSave(form, publish);
  };

  return (
    <div style={modalStyles.overlay} onClick={onClose}>
      <div style={modalStyles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={modalStyles.header}>
          <h2 style={modalStyles.title}>{title}</h2>
          <button type="button" style={modalStyles.closeBtn} onClick={onClose}>×</button>
        </div>
        <form onSubmit={(e) => handleSubmit(e, false)} style={modalStyles.form}>
          <label style={modalStyles.label}>Employee</label>
          <select
            value={form.employeeId}
            onChange={(e) => setField('employeeId', e.target.value)}
            style={modalStyles.input}
            required
          >
            <option value="">Select employee…</option>
            {employees.map((emp) => (
              <option key={emp.id} value={emp.id}>{emp.full_name}</option>
            ))}
          </select>

          <label style={modalStyles.label}>Date</label>
          <input
            type="date"
            value={form.shiftDate}
            onChange={(e) => setField('shiftDate', e.target.value)}
            style={modalStyles.input}
            required
          />

          <div style={modalStyles.row}>
            <div style={modalStyles.col}>
              <label style={modalStyles.label}>Start</label>
              <input
                type="time"
                value={form.startTime}
                onChange={(e) => setField('startTime', e.target.value)}
                style={modalStyles.input}
                required
              />
            </div>
            <div style={modalStyles.col}>
              <label style={modalStyles.label}>End</label>
              <input
                type="time"
                value={form.endTime}
                onChange={(e) => setField('endTime', e.target.value)}
                style={modalStyles.input}
                required
              />
            </div>
          </div>

          <label style={modalStyles.label}>Position</label>
          <PositionSelectWithNew
            businessId={businessId}
            positions={positionRows}
            value={form.position}
            onChange={(v) => setField('position', v)}
            required
            selectStyle={modalStyles.input}
            rowStyle={modalStyles.positionRow}
          />

          <label style={modalStyles.label}>Notes</label>
          <textarea
            value={form.notes}
            onChange={(e) => setField('notes', e.target.value)}
            style={modalStyles.textarea}
            rows={3}
          />
          <TavariCheckbox
            id="portal-shift-notes-visible"
            appearance="native"
            checked={form.notesVisibleToStaff}
            onChange={(checked) => setField('notesVisibleToStaff', checked)}
            label="Show note to employees on punch clock and portal"
          />

          <div style={modalStyles.actions}>
            {onDelete && (
              <button type="button" style={modalStyles.deleteBtn} onClick={onDelete} disabled={saving}>
                <Trash2 size={16} /> Delete
              </button>
            )}
            <button type="button" style={modalStyles.cancelBtn} onClick={onClose} disabled={saving}>
              Cancel
            </button>
            {showPublishActions ? (
              <>
                <button type="submit" style={modalStyles.secondaryBtn} disabled={saving}>
                  {saving ? 'Saving…' : 'Save pending'}
                </button>
                <button
                  type="button"
                  style={modalStyles.primaryBtn}
                  disabled={saving}
                  onClick={(e) => handleSubmit(e, true)}
                >
                  {saving ? 'Publishing…' : 'Save & publish'}
                </button>
              </>
            ) : (
              <button type="submit" style={modalStyles.primaryBtn} disabled={saving}>
                {saving ? 'Saving…' : 'Save changes'}
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
};

const styles = {
  wrap: { display: 'flex', flexDirection: 'column', gap: TavariStyles.spacing.md },
  loadingCard: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    color: TavariStyles.colors.gray600,
    background: '#fff',
    border: `1px solid ${TavariStyles.colors.gray200}`,
    borderRadius: '16px',
    padding: '20px',
  },
  toolbar: {
    display: 'flex',
    flexDirection: 'column',
    gap: TavariStyles.spacing.sm,
    background: '#fff',
    border: `1px solid ${TavariStyles.colors.gray200}`,
    borderRadius: '16px',
    padding: TavariStyles.spacing.md,
  },
  weekNav: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' },
  weekLabel: { fontWeight: 800, color: TavariStyles.colors.gray900, textAlign: 'center', flex: 1 },
  iconBtn: {
    border: `1px solid ${TavariStyles.colors.gray300}`,
    background: '#fff',
    borderRadius: '10px',
    padding: '8px',
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  toolbarActions: { display: 'flex', flexWrap: 'wrap', gap: '8px' },
  secondaryBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    border: `1px solid ${TavariStyles.colors.gray300}`,
    background: '#fff',
    borderRadius: '10px',
    padding: '8px 12px',
    fontWeight: 700,
    cursor: 'pointer',
    fontSize: '13px',
  },
  publishBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    border: `1px solid ${TavariStyles.colors.primary}`,
    background: '#ecfdf5',
    color: TavariStyles.colors.primary,
    borderRadius: '10px',
    padding: '8px 12px',
    fontWeight: 700,
    cursor: 'pointer',
    fontSize: '13px',
  },
  primaryBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    border: 'none',
    background: TavariStyles.colors.primary,
    color: '#fff',
    borderRadius: '10px',
    padding: '8px 12px',
    fontWeight: 700,
    cursor: 'pointer',
    fontSize: '13px',
  },
  pendingBanner: {
    padding: '10px 14px',
    borderRadius: '12px',
    background: '#fffbeb',
    border: '1px solid #fcd34d',
    color: '#92400e',
    fontSize: '13px',
    fontWeight: 600,
  },
  dayList: { display: 'flex', flexDirection: 'column', gap: TavariStyles.spacing.md },
  dayGroup: {
    borderRadius: '16px',
    border: `1px solid ${TavariStyles.colors.gray200}`,
    overflow: 'hidden',
    background: '#fff',
  },
  dayHeader: {
    fontWeight: 800,
    fontSize: '15px',
    color: TavariStyles.colors.gray900,
    padding: '14px 16px',
    borderBottom: `1px solid ${TavariStyles.colors.gray200}`,
    borderLeft: `5px solid ${TavariStyles.colors.primary}`,
    background: TavariStyles.colors.gray50,
  },
  dayBody: { padding: TavariStyles.spacing.md, display: 'flex', flexDirection: 'column', gap: '10px' },
  emptyDay: { color: TavariStyles.colors.gray500, fontSize: '13px', textAlign: 'center', padding: '8px' },
  shiftCard: {
    textAlign: 'left',
    border: `1px solid ${TavariStyles.colors.gray200}`,
    borderRadius: '14px',
    padding: '12px 14px',
    background: '#fff',
    cursor: 'pointer',
    width: '100%',
  },
  shiftCardPending: { border: '2px dashed #f59e0b', background: '#fffbeb' },
  shiftCardTop: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' },
  shiftName: { fontWeight: 800, color: TavariStyles.colors.gray900 },
  pendingPill: {
    fontSize: '11px',
    fontWeight: 800,
    padding: '2px 8px',
    borderRadius: '999px',
    background: '#fef3c7',
    color: '#92400e',
  },
  shiftMeta: { fontSize: '13px', color: TavariStyles.colors.gray600, marginTop: '4px' },
  shiftTime: { fontSize: '13px', color: TavariStyles.colors.gray700, marginTop: '4px' },
};

const modalStyles = {
  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.45)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1200,
    padding: '16px',
    boxSizing: 'border-box',
  },
  modal: {
    background: '#fff',
    borderRadius: '16px',
    padding: '20px',
    width: '100%',
    maxWidth: '480px',
    maxHeight: 'min(90vh, 720px)',
    overflowY: 'auto',
    boxSizing: 'border-box',
  },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' },
  title: { margin: 0, fontSize: '18px', fontWeight: 800 },
  closeBtn: { border: 'none', background: 'transparent', fontSize: '28px', cursor: 'pointer', color: '#6b7280' },
  form: { display: 'flex', flexDirection: 'column', gap: '4px' },
  label: { display: 'block', fontSize: '13px', fontWeight: 700, color: TavariStyles.colors.gray700, marginBottom: '4px' },
  input: {
    width: '100%',
    boxSizing: 'border-box',
    border: `1px solid ${TavariStyles.colors.gray300}`,
    borderRadius: '10px',
    padding: '10px 12px',
    marginBottom: '10px',
    fontSize: '14px',
  },
  textarea: {
    width: '100%',
    boxSizing: 'border-box',
    border: `1px solid ${TavariStyles.colors.gray300}`,
    borderRadius: '10px',
    padding: '10px 12px',
    marginBottom: '10px',
    fontFamily: 'inherit',
    resize: 'vertical',
  },
  row: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' },
  col: { minWidth: 0 },
  positionRow: { display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '10px' },
  actions: { display: 'flex', flexWrap: 'wrap', gap: '8px', justifyContent: 'flex-end', marginTop: '12px' },
  cancelBtn: {
    border: `1px solid ${TavariStyles.colors.gray300}`,
    background: '#fff',
    borderRadius: '10px',
    padding: '10px 14px',
    fontWeight: 700,
    cursor: 'pointer',
  },
  secondaryBtn: {
    border: `1px solid ${TavariStyles.colors.primary}`,
    background: '#fff',
    color: TavariStyles.colors.primary,
    borderRadius: '10px',
    padding: '10px 14px',
    fontWeight: 700,
    cursor: 'pointer',
  },
  primaryBtn: {
    border: 'none',
    background: TavariStyles.colors.primary,
    color: '#fff',
    borderRadius: '10px',
    padding: '10px 14px',
    fontWeight: 700,
    cursor: 'pointer',
  },
  deleteBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    border: '1px solid #fca5a5',
    background: '#fef2f2',
    color: '#b91c1c',
    borderRadius: '10px',
    padding: '10px 14px',
    fontWeight: 700,
    cursor: 'pointer',
    marginRight: 'auto',
  },
};

export default PortalScheduleManager;
