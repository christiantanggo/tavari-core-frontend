import React from 'react';
import TavariCheckbox from '../UI/TavariCheckbox';
import { TavariStyles } from '../../utils/TavariStyles';
import TaskTemplateDailyScheduleTimes from './TaskTemplateDailyScheduleTimes';
import {
  TASK_DUE_SCHEDULE_MODES,
  TASK_SCHEDULE_TYPES,
  TASK_WEEKDAYS,
  TASK_WEEK_OF_MONTH,
  roundRobinGroupsForMode
} from '../../helpers/taskManagerSchedule';

const fieldStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  width: '100%',
  minWidth: 0,
  boxSizing: 'border-box'
};

const labelStyle = {
  fontWeight: 700,
  color: '#374151',
  fontSize: 13
};

const inputStyle = {
  border: '1px solid #d1d5db',
  borderRadius: 10,
  padding: '10px 12px',
  fontSize: 14,
  width: '100%',
  maxWidth: '100%',
  boxSizing: 'border-box'
};

const hintStyle = {
  margin: 0,
  color: TavariStyles.colors.gray600,
  fontSize: 13,
  lineHeight: 1.5
};

const sectionStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  width: '100%',
  minWidth: 0,
  padding: 14,
  border: '1px solid #e5e7eb',
  borderRadius: 12,
  background: '#fafafa',
  boxSizing: 'border-box'
};

const TaskDueScheduleFields = ({
  form,
  setForm,
  roundRobinGroups = [],
  businessTimezone,
  operatingHours,
  allowMultipleTimes = false,
  isKioskChecklistCategory = false,
  kioskChecklistLabel = ''
}) => {
  const filteredRoundRobinGroups = roundRobinGroupsForMode(roundRobinGroups, form.due_schedule_mode);

  if (isKioskChecklistCategory) {
    const buttonLabel = kioskChecklistLabel?.trim() || 'this checklist';
    return (
      <div style={sectionStyle}>
        <span style={labelStyle}>Kiosk checklist</span>
        <p style={hintStyle}>
          This task appears on the <strong>{buttonLabel}</strong> button at the bottom of the kiosk. Staff open the full list when they are ready — there is no fixed time and it is not part of the one-at-a-time task queue.
        </p>
        <p style={hintStyle}>
          Completed items reset each business day. List order follows the order tasks were added in this category.
        </p>
      </div>
    );
  }

  return (
  <div style={sectionStyle}>
    <label style={fieldStyle}>
      <span style={labelStyle}>When is this task due?</span>
      <select
        style={inputStyle}
        value={form.due_schedule_mode}
        onChange={(e) => setForm({ ...form, due_schedule_mode: e.target.value })}
      >
        {TASK_DUE_SCHEDULE_MODES.map((mode) => (
          <option key={mode.value} value={mode.value}>{mode.label}</option>
        ))}
      </select>
    </label>

    {form.due_schedule_mode === 'daily_required' && (
      <>
        <p style={hintStyle}>
          Timed daily tasks that appear automatically in the main kiosk queue at the scheduled time (tier 1). For opening, closing, or other run-around lists, mark the task&apos;s category as a kiosk checklist button instead.
        </p>
        <TaskTemplateDailyScheduleTimes
          label="Due times"
          hint="Add every time this task must be completed each day (e.g. opening and closing)."
          scheduleTimes={form.scheduleTimes || []}
          onChange={(scheduleTimes) => setForm({
            ...form,
            scheduleTimes,
            schedule_time: scheduleTimes[0] || form.schedule_time,
            schedule_type: 'daily'
          })}
          operatingHours={operatingHours}
        />
        <TavariCheckbox
          label="Allow due dates on weekends"
          checked={form.send_on_weekends}
          onChange={(checked) => setForm({ ...form, send_on_weekends: checked })}
        />
      </>
    )}

    {form.due_schedule_mode === 'specific_date' && (
      <>
        <p style={hintStyle}>
          Special one-off for a chosen day or night. On that date it appears on the kiosk after daily required tasks (tier 2). Times use your business timezone ({businessTimezone}).
        </p>
        <label style={fieldStyle}>
          <span style={labelStyle}>{allowMultipleTimes ? 'Due date' : 'Due date & time'}</span>
          <input
            type={allowMultipleTimes ? 'date' : 'datetime-local'}
            style={inputStyle}
            value={allowMultipleTimes ? String(form.due_at || '').slice(0, 10) : form.due_at}
            onChange={(e) => setForm({
              ...form,
              due_at: allowMultipleTimes
                ? `${e.target.value}T${(form.scheduleTimes?.[0] || form.schedule_time || '09:00').slice(0, 5)}`
                : e.target.value
            })}
          />
        </label>
        {allowMultipleTimes && (
          <TaskTemplateDailyScheduleTimes
            label="Due times"
            hint="Add every time this task should be completed on the selected date."
            scheduleTimes={form.scheduleTimes || []}
            onChange={(scheduleTimes) => setForm({
              ...form,
              scheduleTimes,
              schedule_time: scheduleTimes[0] || form.schedule_time,
              due_at: `${String(form.due_at || '').slice(0, 10) || new Date().toISOString().slice(0, 10)}T${(scheduleTimes[0] || form.schedule_time || '09:00').slice(0, 5)}`
            })}
            operatingHours={operatingHours}
          />
        )}
      </>
    )}

    {form.due_schedule_mode === 'frequency' && (
      <>
        <p style={hintStyle}>Recurring tasks use tier 3 on the kiosk when overdue, otherwise tier 4. Business timezone: {businessTimezone}.</p>
        <label style={fieldStyle}>
          <span style={labelStyle}>Frequency</span>
          <select
            style={inputStyle}
            value={form.schedule_type}
            onChange={(e) => setForm({ ...form, schedule_type: e.target.value })}
          >
            {TASK_SCHEDULE_TYPES.map((type) => (
              <option key={type.value} value={type.value}>{type.label}</option>
            ))}
          </select>
        </label>
        {allowMultipleTimes && form.schedule_type === 'daily' ? (
          <TaskTemplateDailyScheduleTimes
            label="Due times"
            hint="Add every time this task should be completed each day."
            scheduleTimes={form.scheduleTimes || []}
            onChange={(scheduleTimes) => setForm({ ...form, scheduleTimes, schedule_time: scheduleTimes[0] || form.schedule_time })}
            operatingHours={operatingHours}
          />
        ) : (
          <label style={fieldStyle}>
            <span style={labelStyle}>Due time</span>
            <input
              type="time"
              style={inputStyle}
              value={form.schedule_time}
              onChange={(e) => setForm({ ...form, schedule_time: e.target.value, scheduleTimes: [e.target.value] })}
            />
          </label>
        )}
        {form.schedule_type === 'daily' && (
          <p style={hintStyle}>Repeats every day at the chosen time. Use &quot;Allow due dates on weekends&quot; if the task should run Saturday and Sunday too.</p>
        )}
        {form.schedule_type === 'once' && (
          <label style={fieldStyle}>
            <span style={labelStyle}>Date</span>
            <input
              type="date"
              required
              style={inputStyle}
              value={form.schedule_once_date}
              onChange={(e) => setForm({ ...form, schedule_once_date: e.target.value })}
            />
          </label>
        )}
        {(form.schedule_type === 'weekly' || form.schedule_type === 'biweekly') && (
          <label style={fieldStyle}>
            <span style={labelStyle}>Day of week</span>
            <select
              style={inputStyle}
              value={form.schedule_day_of_week}
              onChange={(e) => setForm({ ...form, schedule_day_of_week: Number(e.target.value) })}
            >
              {TASK_WEEKDAYS.map((d) => (
                <option key={d.value} value={d.value}>{d.label}</option>
              ))}
            </select>
          </label>
        )}
        {form.schedule_type === 'biweekly' && (
          <p style={hintStyle}>Repeats every 14 days on the chosen weekday, anchored to your start date.</p>
        )}
        {form.schedule_type === 'monthly' && (
          <label style={fieldStyle}>
            <span style={labelStyle}>Day of month (31 = last day)</span>
            <input
              type="number"
              min={1}
              max={31}
              style={inputStyle}
              value={form.schedule_day_of_month}
              onChange={(e) => setForm({ ...form, schedule_day_of_month: Number(e.target.value) })}
            />
          </label>
        )}
        {form.schedule_type === 'monthly_weekday' && (
          <>
            <label style={fieldStyle}>
              <span style={labelStyle}>Which occurrence in the month</span>
              <select
                style={inputStyle}
                value={form.schedule_week_of_month}
                onChange={(e) => setForm({ ...form, schedule_week_of_month: Number(e.target.value) })}
              >
                {TASK_WEEK_OF_MONTH.map((w) => (
                  <option key={w.value} value={w.value}>{w.label}</option>
                ))}
              </select>
            </label>
            <label style={fieldStyle}>
              <span style={labelStyle}>Day of week</span>
              <select
                style={inputStyle}
                value={form.schedule_day_of_week}
                onChange={(e) => setForm({ ...form, schedule_day_of_week: Number(e.target.value) })}
              >
                {TASK_WEEKDAYS.map((d) => (
                  <option key={d.value} value={d.value}>{d.label}</option>
                ))}
              </select>
            </label>
          </>
        )}
        <label style={fieldStyle}>
          <span style={labelStyle}>Start date</span>
          <input
            type="date"
            style={inputStyle}
            value={form.starts_on}
            onChange={(e) => setForm({ ...form, starts_on: e.target.value })}
          />
        </label>
        <label style={fieldStyle}>
          <span style={labelStyle}>End</span>
          <select
            style={inputStyle}
            value={form.end_mode}
            onChange={(e) => setForm({ ...form, end_mode: e.target.value })}
          >
            <option value="indefinite">Indefinitely</option>
            <option value="end_date">End date</option>
            <option value="max_occurrences">Max occurrences</option>
          </select>
        </label>
        {form.end_mode === 'end_date' && (
          <label style={fieldStyle}>
            <span style={labelStyle}>End date</span>
            <input
              type="date"
              style={inputStyle}
              value={form.ends_on}
              onChange={(e) => setForm({ ...form, ends_on: e.target.value })}
            />
          </label>
        )}
        {form.end_mode === 'max_occurrences' && (
          <label style={fieldStyle}>
            <span style={labelStyle}>Max occurrences</span>
            <input
              type="number"
              min={1}
              style={inputStyle}
              value={form.max_occurrences}
              onChange={(e) => setForm({ ...form, max_occurrences: e.target.value })}
            />
          </label>
        )}
        <TavariCheckbox
          label="Allow due dates on weekends"
          checked={form.send_on_weekends}
          onChange={(checked) => setForm({ ...form, send_on_weekends: checked })}
        />
      </>
    )}

    {form.due_schedule_mode === 'round_robin' && (
      <>
        <p style={hintStyle}>
          Add this task to a rotating list. The kiosk shows one task at a time in list order (tier 4). When every task in the list is completed, the list restarts from the top.
        </p>
        <label style={fieldStyle}>
          <span style={labelStyle}>Round robin list</span>
          <select
            style={inputStyle}
            value={form.round_robin_group_id}
            onChange={(e) => setForm({ ...form, round_robin_group_id: e.target.value, round_robin_new_group_name: '' })}
          >
            <option value="">Create new list…</option>
            {filteredRoundRobinGroups.map((group) => (
              <option key={group.id} value={group.id}>{group.name}</option>
            ))}
          </select>
        </label>
        {!form.round_robin_group_id && (
          <label style={fieldStyle}>
            <span style={labelStyle}>New list name</span>
            <input
              type="text"
              style={inputStyle}
              placeholder="Opening checklist rotation"
              value={form.round_robin_new_group_name}
              onChange={(e) => setForm({ ...form, round_robin_new_group_name: e.target.value })}
            />
          </label>
        )}
      </>
    )}

    {form.due_schedule_mode === 'weekly_round_robin' && (
      <>
        <p style={hintStyle}>
          Weekly cleaning / rotation lists (tier 4 normally, tier 3 when overdue or carried over). Each Sunday (in {businessTimezone}) a fresh copy of every task is appended to the bottom. Unfinished tasks stay at the top until completed.
        </p>
        <label style={fieldStyle}>
          <span style={labelStyle}>Weekly round robin list</span>
          <select
            style={inputStyle}
            value={form.round_robin_group_id}
            onChange={(e) => setForm({ ...form, round_robin_group_id: e.target.value, round_robin_new_group_name: '' })}
          >
            <option value="">Create new list…</option>
            {filteredRoundRobinGroups.map((group) => (
              <option key={group.id} value={group.id}>{group.name}</option>
            ))}
          </select>
        </label>
        {!form.round_robin_group_id && (
          <label style={fieldStyle}>
            <span style={labelStyle}>New list name</span>
            <input
              type="text"
              style={inputStyle}
              placeholder="Weekly deep-clean rotation"
              value={form.round_robin_new_group_name}
              onChange={(e) => setForm({ ...form, round_robin_new_group_name: e.target.value })}
            />
          </label>
        )}
      </>
    )}

    {form.due_schedule_mode === 'biweekly_round_robin' && (
      <>
        <p style={hintStyle}>
          Bi-weekly rotation lists for work meant to cycle every 2 weeks (tier 4 normally, tier 3 when carried over). On the start of each 2-week period (Sunday-based, {businessTimezone}) a fresh copy of every task is appended to the bottom. Unfinished tasks stay at the top until completed — so staff are not buried by a new full list every week.
        </p>
        <label style={fieldStyle}>
          <span style={labelStyle}>Bi-weekly round robin list</span>
          <select
            style={inputStyle}
            value={form.round_robin_group_id}
            onChange={(e) => setForm({ ...form, round_robin_group_id: e.target.value, round_robin_new_group_name: '' })}
          >
            <option value="">Create new list…</option>
            {filteredRoundRobinGroups.map((group) => (
              <option key={group.id} value={group.id}>{group.name}</option>
            ))}
          </select>
        </label>
        {!form.round_robin_group_id && (
          <label style={fieldStyle}>
            <span style={labelStyle}>New list name</span>
            <input
              type="text"
              style={inputStyle}
              placeholder="Structure deep clean rotation"
              value={form.round_robin_new_group_name}
              onChange={(e) => setForm({ ...form, round_robin_new_group_name: e.target.value })}
            />
          </label>
        )}
      </>
    )}
  </div>
  );
};

export default TaskDueScheduleFields;
