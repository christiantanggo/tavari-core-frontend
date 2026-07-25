import React, { useEffect, useMemo, useState } from 'react';
import { FiCalendar, FiCheckSquare, FiHome, FiList, FiMenu, FiPlus, FiSearch, FiSettings, FiTag, FiTablet, FiX } from 'react-icons/fi';
import toast from 'react-hot-toast';
import { supabase } from '../../supabaseClient';
import { useBusinessContext } from '../../contexts/BusinessContext';
import { useModuleEnabled } from '../../hooks/useModuleEnabled';
import { usePOSAuth } from '../../hooks/usePOSAuth';
import TavariModuleHeader from '../../components/UI/TavariModuleHeader';
import TavariCheckbox from '../../components/UI/TavariCheckbox';
import TavariTabSystemComponent from '../../components/UI/TavariTabSystemComponent';
import TaskDueScheduleFields from '../../components/Tasks/TaskDueScheduleFields';
import { DEFAULT_OPERATING_HOURS } from '../../helpers/Bookings/operatingHoursTimeOptions';
import {
  buildFrequencyDueTimes,
  businessBiweeklyPeriodStart,
  businessWeekStartDate,
  formatDueScheduleLabel,
  formatZonedDateTime,
  getDateInTimeZone,
  isPeriodRoundRobinMode,
  KIOSK_CHECKLIST_SCHEDULE_MODE,
  TODAY_PRIORITY_SCHEDULE_MODE,
  roundRobinResetCadenceForMode,
  scheduleFieldsForInsert,
  utcIsoToFormDatetimeLocal,
  utcIsoToFormTime,
  zonedDateTimeToUtc
} from '../../helpers/taskManagerSchedule';
import { deleteTrainingWithManagerPin } from '../../helpers/deleteTrainingWithManagerPin';
import { getTaskManagerModuleLink, getTaskManagerModuleLinkOptions } from '../../helpers/taskManagerModuleLinks';
import { TavariStyles } from '../../utils/TavariStyles';
import ModuleSettingsTabContent from '../../components/Modules/ModuleSettingsTabContent';

const TASK_TRAINING_MEDIA_BUCKET = 'task-training-media';

/** Tab defs for TavariTabSystemComponent (same pattern as WaiversModuleLayout). */
const TASK_MANAGER_TABS = [
  { id: 'overview', label: 'Overview', icon: FiHome },
  { id: 'today', label: "Today's Tasks", icon: FiCalendar },
  { id: 'categories', label: 'Categories', icon: FiTag },
  { id: 'tasks', label: 'Tasks', icon: FiPlus },
  { id: 'reviews', label: 'Reviews', icon: FiCheckSquare },
  { id: 'kiosk', label: 'Kiosk', icon: FiTablet },
  { id: 'settings', label: 'Settings', icon: FiSettings }
];

const EMPTY_CATEGORY_FORM = {
  name: '',
  description: '',
  employeeIds: [],
  kiosk_checklist_button: false,
  kiosk_button_label: '',
  checklist_window_start: '',
  checklist_window_end: '',
  location_sensitivity: 'none'
};

const LOCATION_SENSITIVITY_OPTIONS = [
  { value: 'none', label: 'None — not affected by sales traffic' },
  { value: 'customer_area', label: 'Customer / play area — deprioritize when admissions are busy' },
  { value: 'kitchen', label: 'Kitchen — deprioritize when food orders are busy' },
  { value: 'concession', label: 'Concession — usually safe during busy periods' },
  { value: 'back_of_house', label: 'Back of house — usually safe during busy periods' }
];

const EMPTY_TODAY_TASK_FORM = {
  title: '',
  description: '',
  category_id: '',
  priority: 'urgent',
  instructions: '',
  requires_notes: false,
  requires_photo: false
};

const TODAY_TASK_OPEN_STATUSES = ['to_do', 'in_progress', 'blocked'];

const TODAY_TASK_EDITABLE_STATUSES = ['to_do', 'blocked'];

const compareTodayPriorityTasks = (a, b) => {
  const sortA = Number.isFinite(a.today_priority_sort_order) ? a.today_priority_sort_order : Number.MAX_SAFE_INTEGER;
  const sortB = Number.isFinite(b.today_priority_sort_order) ? b.today_priority_sort_order : Number.MAX_SAFE_INTEGER;
  if (sortA !== sortB) return sortA - sortB;
  return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
};

const isTodayPriorityTask = (task) => task?.due_schedule_mode === TODAY_PRIORITY_SCHEDULE_MODE;

const taskToTodayForm = (task) => ({
  title: task?.title || '',
  description: task?.description || '',
  category_id: task?.category_id || '',
  priority: task?.priority || 'urgent',
  instructions: task?.instructions || '',
  requires_notes: !!task?.requires_notes,
  requires_photo: task?.photo_requirement_mode === 'always' || (!task?.photo_requirement_mode && !!task?.requires_photo)
});

const getTaskCompletionPhotoUrl = (task) => {
  const evidence = task?.completion_summary?.evidence;
  if (!evidence) return '';
  return evidence.photo_data_url || evidence.photo_url || '';
};

const canEditTodayTask = (task) => TODAY_TASK_EDITABLE_STATUSES.includes(task?.status);

const taskOnBusinessDay = (isoValue, businessTimezone, businessTodayKey) => {
  if (!isoValue) return false;
  return getDateInTimeZone(new Date(isoValue), businessTimezone) === businessTodayKey;
};

const EMPTY_QUEUE_SETTINGS = {
  sales_aware_queue_enabled: true,
  admission_lookback_minutes: 180,
  kitchen_lookback_minutes: 60,
  admission_busy_threshold: 15,
  kitchen_busy_threshold: 8,
  admission_slow_threshold: 5,
  kitchen_slow_threshold: 3
};

const locationSensitivityLabel = (value) =>
  LOCATION_SENSITIVITY_OPTIONS.find((option) => option.value === value)?.label || 'None';

const dbTimeToInput = (value) => (value ? String(value).slice(0, 5) : '');

const inputTimeToDb = (value) => (value && String(value).trim() ? String(value).trim().slice(0, 5) : null);

const todayDateString = () => new Date().toISOString().slice(0, 10);

const datetimeLocalDatePart = (value) => String(value || '').slice(0, 10);
const datetimeLocalTimePart = (value) => String(value || '').slice(11, 16);

const checklistToText = (checklist) => {
  if (!Array.isArray(checklist)) return '';
  return checklist.map((item) => (typeof item === 'string' ? item : item?.label || '')).filter(Boolean).join('\n');
};

const normalizeTaskTrainingResources = (resources = []) =>
  (Array.isArray(resources) ? resources : [])
    .filter((resource) => !resource.hr_training_item_id)
    .map((resource) => ({
      id: resource.id || null,
      title: resource.title || '',
      resource_type: resource.resource_type || 'document',
      resource_url: resource.resource_url || '',
      uploadFile: resource.uploadFile || null,
      uploadFileName: resource.uploadFileName || '',
      content: resource.content || '',
      is_required: resource.is_required !== false
    }))
    .filter((resource) => resource.title || resource.resource_url || resource.uploadFile || resource.content);

const taskToForm = (task, timeZone = 'America/Toronto', categories = []) => {
  const displayAt = task.scheduled_for || task.due_at;
  const category = categories.find((item) => item.id === task.category_id);
  const isKioskChecklist = !!category?.kiosk_checklist_button;
  const dueScheduleMode = isKioskChecklist
    ? KIOSK_CHECKLIST_SCHEDULE_MODE
    : (task.due_schedule_mode || (task.round_robin_group_id ? 'round_robin' : displayAt ? 'specific_date' : 'specific_date'));
  return {
  title: task.title || '',
  description: task.description || '',
  category_id: task.category_id || '',
  priority: task.priority || 'medium',
  assignment_scope: task.assignment_scope || 'facility',
  assigned_to: task.assigned_to || '',
  due_schedule_mode: dueScheduleMode,
  due_at: utcIsoToFormDatetimeLocal(displayAt, timeZone),
  scheduleTimes: task.due_schedule_mode === 'daily_required'
    ? [task.schedule_time || utcIsoToFormTime(displayAt, timeZone) || '09:00'].filter(Boolean)
    : displayAt
      ? [task.schedule_time || utcIsoToFormTime(displayAt, timeZone)].filter(Boolean)
      : ['09:00'],
  schedule_type: task.due_schedule_mode === 'daily_required' ? 'daily' : (task.schedule_type || 'weekly'),
  schedule_time: task.schedule_time || '09:00',
  schedule_day_of_week: task.schedule_day_of_week ?? 1,
  schedule_day_of_month: task.schedule_day_of_month ?? 1,
  schedule_week_of_month: task.schedule_week_of_month ?? 1,
  schedule_once_date: task.schedule_once_date || '',
  starts_on: task.starts_on || todayDateString(),
  ends_on: task.ends_on || '',
  end_mode: task.ends_on ? 'end_date' : task.max_occurrences != null ? 'max_occurrences' : 'indefinite',
  max_occurrences: task.max_occurrences != null ? String(task.max_occurrences) : '',
  send_on_weekends: !!task.send_on_weekends,
  round_robin_group_id: task.round_robin_group_id || '',
  round_robin_new_group_name: '',
  requires_photo: task.photo_requirement_mode === 'always' || (!task.photo_requirement_mode && !!task.requires_photo),
  photo_requirement_mode: task.photo_requirement_mode || (task.requires_photo ? 'always' : 'random'),
  requires_notes: !!task.requires_notes,
  peer_review_required: !!task.peer_review_required,
  instructions: task.instructions || '',
  checklistText: checklistToText(task.checklist),
  required_form_id: task.required_form_id || '',
  module_link_key: task.module_link_key || '',
  hrTrainingItemIds: [
    ...new Set((task.task_training_resources || task.training_resources || [])
      .map((resource) => resource.hr_training_item_id)
      .filter(Boolean))
  ],
  trainingResources: normalizeTaskTrainingResources(task.task_training_resources || task.training_resources || [])
  };
};

const EMPTY_TASK_FORM = {
  title: '',
  description: '',
  category_id: '',
  priority: 'medium',
  assignment_scope: 'facility',
  assigned_to: '',
  due_schedule_mode: 'specific_date',
  due_at: '',
  scheduleTimes: ['09:00'],
  schedule_type: 'weekly',
  schedule_time: '09:00',
  schedule_day_of_week: 1,
  schedule_day_of_month: 1,
  schedule_week_of_month: 1,
  schedule_once_date: '',
  starts_on: todayDateString(),
  ends_on: '',
  end_mode: 'indefinite',
  max_occurrences: '',
  send_on_weekends: false,
  round_robin_group_id: '',
  round_robin_new_group_name: '',
  requires_photo: false,
  photo_requirement_mode: 'random',
  requires_notes: false,
  peer_review_required: false,
  instructions: '',
  checklistText: '',
  required_form_id: '',
  module_link_key: '',
  hrTrainingItemIds: [],
  trainingResources: []
};

const isAssignableTaskEmployee = (user) => {
  if (!user) return false;
  const status = String(user.employment_status || '').toLowerCase();
  if (status === 'terminated' || status === 'suspended') return false;
  if (user.is_active === false) return false;
  if (user.termination_date) return false;
  return true;
};

const TASK_PRIORITY_RANK = { urgent: 4, high: 3, medium: 2, low: 1 };

const sortDueOpenTasks = (tasks = []) => [...tasks].sort((a, b) => {
  const priorityDiff = (TASK_PRIORITY_RANK[b.priority] || 0) - (TASK_PRIORITY_RANK[a.priority] || 0);
  if (priorityDiff !== 0) return priorityDiff;
  const aTime = a.available_at ? new Date(a.available_at).getTime() : 0;
  const bTime = b.available_at ? new Date(b.available_at).getTime() : 0;
  if (aTime !== bTime) return aTime - bTime;
  return String(a.title || '').localeCompare(String(b.title || ''));
});

function taskMatchesSearch(task, query, { categoryNameById = {}, employeeNameById = {} } = {}) {
  if (!query) return true;
  const haystack = [
    task.title,
    task.description,
    task.category,
    categoryNameById[task.category_id],
    task.instructions,
    task.priority,
    task.status,
    task.assignment_scope,
    employeeNameById[task.assigned_to],
    formatDueScheduleLabel(task)
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return haystack.includes(query);
}

const TasksDashboard = () => {
  const { selectedBusinessId, selectedBusiness } = useBusinessContext();
  const [loadedBusinessTimezone, setLoadedBusinessTimezone] = useState('America/Toronto');
  const businessTimezone = selectedBusiness?.timezone || loadedBusinessTimezone || 'America/Toronto';
  const { isEnabled: tasksEnabled, loading: moduleLoading } = useModuleEnabled('tasks');
  const { authLoading, authUser, userRole, authError } = usePOSAuth({
    requiredRoles: ['owner', 'manager', 'admin'],
    requireBusiness: true,
    componentName: 'TasksDashboard'
  });

  const [activeTab, setActiveTab] = useState('overview');
  const [loading, setLoading] = useState(true);
  const [tasks, setTasks] = useState([]);
  const [openDueTasks, setOpenDueTasks] = useState([]);
  const [signingOffTaskId, setSigningOffTaskId] = useState(null);
  const [quickViewOpen, setQuickViewOpen] = useState(false);
  const [quickViewTab, setQuickViewTab] = useState('facility');
  const [quickViewRows, setQuickViewRows] = useState([]);
  const [quickViewLoading, setQuickViewLoading] = useState(false);
  const [overviewSearch, setOverviewSearch] = useState('');
  const [tasksTabSearch, setTasksTabSearch] = useState('');
  const [reviews, setReviews] = useState([]);
  const [peerReviewSubmissions, setPeerReviewSubmissions] = useState([]);
  const [peerReviewSettings, setPeerReviewSettings] = useState({
    reviews_per_login: 5,
    new_hire_sample_rate: 0.25,
    experienced_sample_rate: 0.05,
    new_hire_days: 90
  });
  const [peerReviewWeights, setPeerReviewWeights] = useState([]);
  const [peerReviewPool, setPeerReviewPool] = useState([]);
  const [completedTodayTasks, setCompletedTodayTasks] = useState([]);
  const [todayPriorityTasks, setTodayPriorityTasks] = useState([]);
  const [todayTasksLoading, setTodayTasksLoading] = useState(false);
  const [todayTaskForm, setTodayTaskForm] = useState(EMPTY_TODAY_TASK_FORM);
  const [editingTodayTaskId, setEditingTodayTaskId] = useState(null);
  const [todayCompletionDetail, setTodayCompletionDetail] = useState(null);
  const [savingTodayTask, setSavingTodayTask] = useState(false);
  const [cancellingTodayTaskId, setCancellingTodayTaskId] = useState(null);
  const [draggedTodayTaskIndex, setDraggedTodayTaskIndex] = useState(null);
  const [dragOverTodayTaskIndex, setDragOverTodayTaskIndex] = useState(null);
  const [savingTodayTaskOrder, setSavingTodayTaskOrder] = useState(false);
  const [overviewStatDetail, setOverviewStatDetail] = useState(null);
  const [checklistAlertSettings, setChecklistAlertSettings] = useState({
    enabled: true,
    minutes_before_close: 60
  });
  const [checklistAlertRecipients, setChecklistAlertRecipients] = useState([]);
  const [queueSettings, setQueueSettings] = useState(EMPTY_QUEUE_SETTINGS);
  const [facilityBusySignals, setFacilityBusySignals] = useState(null);
  const [alertRecipientEmployees, setAlertRecipientEmployees] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [categories, setCategories] = useState([]);
  const [categoryEmployees, setCategoryEmployees] = useState([]);
  const [categoryForm, setCategoryForm] = useState(EMPTY_CATEGORY_FORM);
  const [editingCategoryId, setEditingCategoryId] = useState(null);
  const [editingTaskId, setEditingTaskId] = useState(null);
  const [roundRobinGroups, setRoundRobinGroups] = useState([]);
  const [operatingHours, setOperatingHours] = useState(DEFAULT_OPERATING_HOURS);
  const [taskForm, setTaskForm] = useState(EMPTY_TASK_FORM);
  const [saving, setSaving] = useState(false);
  const [kioskCode, setKioskCode] = useState('');
  const [formsCatalog, setFormsCatalog] = useState([]);
  const [hrTrainingCatalog, setHrTrainingCatalog] = useState([]);

  const taskManagerSubdomain = import.meta.env.VITE_TASK_MANAGER_SUBDOMAIN_URL || 'https://task-manager.tavarios.ca';
  const canManageTasks = ['owner', 'manager', 'admin'].includes(userRole);
  const kioskUrl = kioskCode
    ? `${window.location.origin}/task-manager-kiosk/index.html?code=${encodeURIComponent(kioskCode)}`
    : '';
  const subdomainKioskUrl = kioskCode ? `${taskManagerSubdomain.replace(/\/$/, '')}/?code=${encodeURIComponent(kioskCode)}` : '';

  const employeeNameById = useMemo(() => {
    const map = {};
    employees.forEach((employee) => {
      map[employee.id] = employee.full_name || [employee.first_name, employee.last_name].filter(Boolean).join(' ') || employee.email || 'Employee';
    });
    return map;
  }, [employees]);

  const categoryNameById = useMemo(() => {
    const map = {};
    categories.forEach((category) => {
      map[category.id] = category.name;
    });
    return map;
  }, [categories]);

  const employeesByCategoryId = useMemo(() => {
    const map = {};
    categoryEmployees.forEach((row) => {
      if (!map[row.category_id]) map[row.category_id] = [];
      map[row.category_id].push(row.employee_id);
    });
    return map;
  }, [categoryEmployees]);

  const activeCategories = useMemo(
    () => categories.filter((category) => category.is_active !== false),
    [categories]
  );

  const editingTask = useMemo(
    () => tasks.find((task) => task.id === editingTaskId) || null,
    [tasks, editingTaskId]
  );

  const assignedPreviewEmployees = useMemo(() => {
    const ids = new Set();
    openDueTasks.forEach((task) => {
      if (task.assigned_to) ids.add(task.assigned_to);
    });
    return employees.filter((employee) => ids.has(employee.id));
  }, [employees, openDueTasks]);

  const sortedOpenDueTasks = useMemo(
    () => sortDueOpenTasks(openDueTasks),
    [openDueTasks]
  );

  const overviewSearchQuery = overviewSearch.trim().toLowerCase();

  const filteredOverviewTasks = useMemo(() => {
    if (!overviewSearchQuery) return sortedOpenDueTasks;
    return sortedOpenDueTasks.filter((task) => taskMatchesSearch(task, overviewSearchQuery, {
      categoryNameById,
      employeeNameById
    }));
  }, [sortedOpenDueTasks, overviewSearchQuery, categoryNameById, employeeNameById]);

  const visibleTasks = useMemo(
    () => tasks.filter((task) => task.status !== 'cancelled'),
    [tasks]
  );

  const tasksTabSearchQuery = tasksTabSearch.trim().toLowerCase();

  const filteredVisibleTasks = useMemo(() => {
    if (!tasksTabSearchQuery) return visibleTasks;
    return visibleTasks.filter((task) => taskMatchesSearch(task, tasksTabSearchQuery, {
      categoryNameById,
      employeeNameById
    }));
  }, [visibleTasks, tasksTabSearchQuery, categoryNameById, employeeNameById]);

  const businessTodayKey = useMemo(
    () => new Date().toLocaleDateString('en-CA', { timeZone: businessTimezone }),
    [businessTimezone]
  );

  const openTodayPriorityTasks = useMemo(() => (
    todayPriorityTasks
      .filter((task) => (
        TODAY_TASK_OPEN_STATUSES.includes(task.status)
        && taskOnBusinessDay(task.created_at, businessTimezone, businessTodayKey)
      ))
      .sort(compareTodayPriorityTasks)
  ), [businessTodayKey, businessTimezone, todayPriorityTasks]);

  const completedTodayPriorityTasks = useMemo(() => (
    todayPriorityTasks
      .filter((task) => (
        task.status === 'done'
        && taskOnBusinessDay(task.completed_at, businessTimezone, businessTodayKey)
      ))
      .sort((a, b) => new Date(b.completed_at).getTime() - new Date(a.completed_at).getTime())
  ), [businessTodayKey, businessTimezone, todayPriorityTasks]);

  const taskTitleById = useMemo(() => {
    const map = {};
    tasks.forEach((task) => { map[task.id] = task.title; });
    completedTodayTasks.forEach((task) => { map[task.id] = task.title; });
    openDueTasks.forEach((task) => { map[task.id] = task.title; });
    peerReviewPool.forEach((row) => { map[row.task_id] = row.task_title; });
    return map;
  }, [completedTodayTasks, openDueTasks, peerReviewPool, tasks]);

  const stats = useMemo(() => {
    const now = new Date();
    return {
      open: openDueTasks.length,
      overdue: openDueTasks.filter((task) => task.due_at && new Date(task.due_at) < now).length,
      incomplete: tasks.filter((task) => task.status === 'incomplete').length,
      completedToday: completedTodayTasks.length,
      pendingReviews: peerReviewPool.length,
      peerReviewsToday: peerReviewSubmissions.filter((row) => {
        const rowDay = row.created_at
          ? new Date(row.created_at).toLocaleDateString('en-CA', { timeZone: businessTimezone })
          : '';
        return rowDay === businessTodayKey;
      }).length
    };
  }, [businessTodayKey, businessTimezone, completedTodayTasks, openDueTasks, peerReviewPool, peerReviewSubmissions, tasks]);

  const overviewStatLists = useMemo(() => {
    const now = new Date();
    const peerReviewsTodayList = peerReviewSubmissions.filter((row) => {
      const rowDay = row.created_at
        ? new Date(row.created_at).toLocaleDateString('en-CA', { timeZone: businessTimezone })
        : '';
      return rowDay === businessTodayKey;
    });
    return {
      open: sortedOpenDueTasks,
      overdue: sortedOpenDueTasks.filter((task) => task.due_at && new Date(task.due_at) < now),
      incomplete: tasks.filter((task) => task.status === 'incomplete'),
      completedToday: completedTodayTasks,
      pendingReviews: peerReviewPool,
      peerReviewsToday: peerReviewsTodayList
    };
  }, [businessTodayKey, businessTimezone, completedTodayTasks, peerReviewPool, peerReviewSubmissions, sortedOpenDueTasks, tasks]);

  useEffect(() => {
    if (!authLoading && !moduleLoading && selectedBusinessId && canManageTasks) {
      loadData();
    }
  }, [authLoading, moduleLoading, selectedBusinessId, canManageTasks]);

  useEffect(() => {
    if (
      activeTab === 'today'
      && selectedBusinessId
      && canManageTasks
      && !authLoading
      && !moduleLoading
    ) {
      loadTodayPriorityTasks();
    }
  }, [activeTab, selectedBusinessId, canManageTasks, authLoading, moduleLoading, businessTodayKey]);

  const getTodayStartIso = () => {
    const loadTimezone = selectedBusiness?.timezone || loadedBusinessTimezone || 'America/Toronto';
    const todayKey = new Date().toLocaleDateString('en-CA', { timeZone: loadTimezone });
    return zonedDateTimeToUtc(todayKey, '00:00:00', loadTimezone).toISOString();
  };

  const loadTodayPriorityTasks = async ({ silent = false } = {}) => {
    if (!selectedBusinessId) return;
    if (!silent) setTodayTasksLoading(true);
    try {
      const todayStartIso = getTodayStartIso();
      const { data, error } = await supabase
        .from('task_manager_tasks')
        .select('*')
        .eq('business_id', selectedBusinessId)
        .eq('due_schedule_mode', TODAY_PRIORITY_SCHEDULE_MODE)
        .or(`created_at.gte.${todayStartIso},completed_at.gte.${todayStartIso}`)
        .order('today_priority_sort_order', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: true })
        .limit(200);
      if (error) throw error;
      setTodayPriorityTasks(data || []);
    } catch (error) {
      console.error('Failed to load today tasks:', error);
      if (!silent) toast.error(error.message || 'Failed to load today\'s tasks');
    } finally {
      if (!silent) setTodayTasksLoading(false);
    }
  };

  const loadData = async () => {
    if (!selectedBusinessId) return;
    setLoading(true);
    try {
      await supabase.rpc('task_manager_generate_due_tasks', { p_business_id: selectedBusinessId });

      const nowIso = new Date().toISOString();
      const loadTimezone = selectedBusiness?.timezone || loadedBusinessTimezone || 'America/Toronto';
      const todayKey = new Date().toLocaleDateString('en-CA', { timeZone: loadTimezone });
      const todayStartIso = zonedDateTimeToUtc(todayKey, '00:00:00', loadTimezone).toISOString();
      const [taskResult, openDueResult, completedTodayResult, trainingResult, reviewResult, peerSubmissionResult, peerSettingsResult, peerWeightsResult, peerPoolResult, checklistAlertSettingsResult, checklistAlertRecipientsResult, queueSettingsResult, busySignalsResult, employeeResult, categoryResult, categoryEmployeeResult, roundRobinResult, businessResult, formsResult, hrTrainingResult] = await Promise.all([
        supabase.from('task_manager_tasks').select('*').eq('business_id', selectedBusinessId).order('created_at', { ascending: false }).limit(200),
        supabase.from('task_manager_tasks').select('*').eq('business_id', selectedBusinessId).in('status', ['to_do', 'in_progress', 'blocked']).or(`available_at.is.null,available_at.lte.${nowIso}`).order('available_at', { ascending: true }).limit(500),
        supabase.from('task_manager_tasks').select('*').eq('business_id', selectedBusinessId).eq('status', 'done').gte('completed_at', todayStartIso).order('completed_at', { ascending: false }).limit(200),
        supabase.from('task_manager_training_resources').select('*').eq('business_id', selectedBusinessId).order('created_at', { ascending: false }),
        supabase.from('task_manager_reviews').select('*').eq('business_id', selectedBusinessId).eq('review_type', 'manager').order('created_at', { ascending: false }).limit(50),
        supabase.from('task_manager_peer_review_submissions').select('*').eq('business_id', selectedBusinessId).order('created_at', { ascending: false }).limit(200),
        supabase.from('task_manager_peer_review_settings').select('*').eq('business_id', selectedBusinessId).maybeSingle(),
        supabase.from('task_manager_employee_peer_review_weights').select('*').eq('business_id', selectedBusinessId).order('created_at', { ascending: false }),
        supabase.from('task_manager_peer_review_pool').select('*').eq('business_id', selectedBusinessId).eq('status', 'pending').order('added_at', { ascending: true }).limit(200),
        supabase.from('task_manager_checklist_alert_settings').select('*').eq('business_id', selectedBusinessId).maybeSingle(),
        supabase.from('task_manager_checklist_alert_recipients').select('category_id, employee_id').eq('business_id', selectedBusinessId),
        supabase.from('task_manager_queue_settings').select('*').eq('business_id', selectedBusinessId).maybeSingle(),
        supabase.rpc('task_manager_facility_busy_signals', { p_business_id: selectedBusinessId }),
        supabase.from('business_users').select('user_id, role, users!inner(id, full_name, first_name, last_name, email, employee_number, position, hire_date, employment_status, termination_date, is_active)').eq('business_id', selectedBusinessId),
        supabase.from('task_manager_categories').select('*').eq('business_id', selectedBusinessId).order('sort_order', { ascending: true }).order('name', { ascending: true }),
        supabase.from('task_manager_category_employees').select('category_id, employee_id').eq('business_id', selectedBusinessId),
        supabase.from('task_manager_round_robin_groups').select('id, name, reset_cadence').eq('business_id', selectedBusinessId).order('name', { ascending: true }),
        supabase.from('businesses').select('operating_hours, timezone').eq('id', selectedBusinessId).maybeSingle(),
        supabase.from('forms_templates').select('id, title').eq('business_id', selectedBusinessId).eq('status', 'active').order('title'),
        supabase.from('hr_training_items').select('id, title, description').eq('business_id', selectedBusinessId).eq('is_active', true).order('title')
      ]);

      if (taskResult.error) throw taskResult.error;
      if (openDueResult.error) throw openDueResult.error;
      if (completedTodayResult.error) throw completedTodayResult.error;
      if (trainingResult.error) throw trainingResult.error;
      if (reviewResult.error) throw reviewResult.error;
      if (peerSubmissionResult.error) throw peerSubmissionResult.error;
      if (peerSettingsResult.error && peerSettingsResult.error.code !== 'PGRST116') throw peerSettingsResult.error;
      if (peerWeightsResult.error) throw peerWeightsResult.error;
      if (peerPoolResult.error) throw peerPoolResult.error;
      if (checklistAlertSettingsResult.error && checklistAlertSettingsResult.error.code !== 'PGRST116') throw checklistAlertSettingsResult.error;
      if (checklistAlertRecipientsResult.error) throw checklistAlertRecipientsResult.error;
      if (queueSettingsResult.error && queueSettingsResult.error.code !== 'PGRST116') throw queueSettingsResult.error;
      if (busySignalsResult.error) throw busySignalsResult.error;
      if (employeeResult.error) throw employeeResult.error;
      if (categoryResult.error) throw categoryResult.error;
      if (categoryEmployeeResult.error) throw categoryEmployeeResult.error;
      if (roundRobinResult.error) throw roundRobinResult.error;
      if (businessResult.error) throw businessResult.error;
      if (formsResult.error && formsResult.error.code !== '42P01') throw formsResult.error;
      if (hrTrainingResult.error && hrTrainingResult.error.code !== '42P01') throw hrTrainingResult.error;

      if (businessResult.data?.operating_hours && typeof businessResult.data.operating_hours === 'object') {
        setOperatingHours(businessResult.data.operating_hours);
      } else {
        setOperatingHours(DEFAULT_OPERATING_HOURS);
      }

      if (businessResult.data?.timezone) {
        setLoadedBusinessTimezone(businessResult.data.timezone);
      }

      const allTrainingResources = trainingResult.data || [];
      const taskTrainingById = allTrainingResources.reduce((acc, resource) => {
        if (!resource.task_id) return acc;
        if (!acc[resource.task_id]) acc[resource.task_id] = [];
        acc[resource.task_id].push(resource);
        return acc;
      }, {});

      setTasks((taskResult.data || []).map((task) => ({
        ...task,
        task_training_resources: taskTrainingById[task.id] || []
      })));
      setOpenDueTasks(openDueResult.data || []);
      setCompletedTodayTasks(completedTodayResult.data || []);
      setReviews(reviewResult.data || []);
      setPeerReviewSubmissions(peerSubmissionResult.data || []);
      if (peerSettingsResult.data) {
        setPeerReviewSettings({
          reviews_per_login: peerSettingsResult.data.reviews_per_login ?? 5,
          new_hire_sample_rate: Number(peerSettingsResult.data.new_hire_sample_rate ?? 0.25),
          experienced_sample_rate: Number(peerSettingsResult.data.experienced_sample_rate ?? 0.05),
          new_hire_days: peerSettingsResult.data.new_hire_days ?? 90
        });
      }
      setPeerReviewWeights(peerWeightsResult.data || []);
      setPeerReviewPool(peerPoolResult.data || []);
      if (checklistAlertSettingsResult.data) {
        setChecklistAlertSettings({
          enabled: checklistAlertSettingsResult.data.enabled !== false,
          minutes_before_close: checklistAlertSettingsResult.data.minutes_before_close ?? 60
        });
      } else {
        setChecklistAlertSettings({ enabled: true, minutes_before_close: 60 });
      }
      setChecklistAlertRecipients(checklistAlertRecipientsResult.data || []);
      if (queueSettingsResult.data) {
        setQueueSettings({
          sales_aware_queue_enabled: queueSettingsResult.data.sales_aware_queue_enabled !== false,
          admission_lookback_minutes: queueSettingsResult.data.admission_lookback_minutes ?? 180,
          kitchen_lookback_minutes: queueSettingsResult.data.kitchen_lookback_minutes ?? 60,
          admission_busy_threshold: queueSettingsResult.data.admission_busy_threshold ?? 15,
          kitchen_busy_threshold: queueSettingsResult.data.kitchen_busy_threshold ?? 8,
          admission_slow_threshold: queueSettingsResult.data.admission_slow_threshold ?? 5,
          kitchen_slow_threshold: queueSettingsResult.data.kitchen_slow_threshold ?? 3
        });
      } else {
        setQueueSettings(EMPTY_QUEUE_SETTINGS);
      }
      setFacilityBusySignals(busySignalsResult.data || null);
      setAlertRecipientEmployees(
        (employeeResult.data || [])
          .filter((row) => row.users?.email && isAssignableTaskEmployee(row.users))
          .map((row) => ({ ...row.users, business_role: row.role }))
      );
      setEmployees(
        (employeeResult.data || [])
          .filter((row) => isAssignableTaskEmployee(row.users))
          .map((row) => ({ ...row.users, business_role: row.role }))
      );
      setCategories(categoryResult.data || []);
      setCategoryEmployees(categoryEmployeeResult.data || []);
      setRoundRobinGroups(roundRobinResult.data || []);
      setFormsCatalog(formsResult.error ? [] : (formsResult.data || []));
      setHrTrainingCatalog(hrTrainingResult.error ? [] : (hrTrainingResult.data || []));

      if (canManageTasks) {
        const { data: kioskRaw, error: kioskError } = await supabase.rpc('task_manager_ensure_kiosk_code', {
          p_business_id: selectedBusinessId
        });
        if (kioskError) throw kioskError;
        const kioskPayload = typeof kioskRaw === 'string' ? JSON.parse(kioskRaw) : kioskRaw;
        setKioskCode(kioskPayload?.code || '');
      } else {
        setKioskCode('');
      }
    } catch (error) {
      console.error('Failed to load task manager:', error);
      toast.error(error.message || 'Failed to load task manager');
    } finally {
      setLoading(false);
    }
  };

  const resolveCategoryFields = (categoryId) => {
    const id = categoryId || null;
    return {
      category_id: id,
      category: id ? categoryNameById[id] || null : null
    };
  };

  const applyCategoryAssignmentHint = (form, categoryId, assignField) => {
    const assignedEmployees = employeesByCategoryId[categoryId] || [];
    if (assignedEmployees.length !== 1) return form;
    return {
      ...form,
      assignment_scope: 'assigned',
      [assignField]: assignedEmployees[0]
    };
  };

  const saveCategory = async (event) => {
    event.preventDefault();
    const normalizedName = categoryForm.name.trim();
    if (!normalizedName) {
      toast.error('Category name is required');
      return;
    }

    const nameMatches = (left, right) => String(left || '').trim().toLowerCase() === String(right || '').trim().toLowerCase();
    const duplicateCategory = categories.find(
      (category) => nameMatches(category.name, normalizedName) && category.id !== editingCategoryId
    );

    if (duplicateCategory && duplicateCategory.is_active !== false) {
      toast.error(`A category named "${duplicateCategory.name}" already exists. Edit that category instead.`);
      return;
    }

    if (categoryForm.kiosk_checklist_button) {
      if (!inputTimeToDb(categoryForm.checklist_window_start)
        || !inputTimeToDb(categoryForm.checklist_window_end)) {
        toast.error('Kiosk checklist categories need an available window start and end time.');
        return;
      }
    }

    setSaving(true);
    try {
      let categoryId = editingCategoryId;
      const payload = {
        business_id: selectedBusinessId,
        name: normalizedName,
        description: optionalText(categoryForm.description),
        kiosk_checklist_button: !!categoryForm.kiosk_checklist_button,
        kiosk_button_label: optionalText(categoryForm.kiosk_button_label),
        checklist_window_start: categoryForm.kiosk_checklist_button ? inputTimeToDb(categoryForm.checklist_window_start) : null,
        checklist_window_end: categoryForm.kiosk_checklist_button ? inputTimeToDb(categoryForm.checklist_window_end) : null,
        checklist_audit_time: null,
        location_sensitivity: categoryForm.location_sensitivity || 'none',
        is_active: true,
        created_by: authUser?.id || null
      };

      if (editingCategoryId) {
        const { error } = await supabase
          .from('task_manager_categories')
          .update({
            name: payload.name,
            description: payload.description,
            kiosk_checklist_button: payload.kiosk_checklist_button,
            kiosk_button_label: payload.kiosk_button_label,
            checklist_window_start: payload.checklist_window_start,
            checklist_window_end: payload.checklist_window_end,
            checklist_audit_time: null,
            location_sensitivity: payload.location_sensitivity
          })
          .eq('id', editingCategoryId)
          .eq('business_id', selectedBusinessId);
        if (error) throw error;
      } else if (duplicateCategory) {
        const { error } = await supabase
          .from('task_manager_categories')
          .update({
            name: payload.name,
            description: payload.description,
            kiosk_checklist_button: payload.kiosk_checklist_button,
            kiosk_button_label: payload.kiosk_button_label,
            checklist_window_start: payload.checklist_window_start,
            checklist_window_end: payload.checklist_window_end,
            checklist_audit_time: null,
            location_sensitivity: payload.location_sensitivity,
            is_active: true
          })
          .eq('id', duplicateCategory.id)
          .eq('business_id', selectedBusinessId);
        if (error) throw error;
        categoryId = duplicateCategory.id;
      } else {
        const { data, error } = await supabase
          .from('task_manager_categories')
          .insert(payload)
          .select('id')
          .single();
        if (error) throw error;
        categoryId = data.id;
      }

      await supabase
        .from('task_manager_category_employees')
        .delete()
        .eq('category_id', categoryId)
        .eq('business_id', selectedBusinessId);

      if (categoryForm.employeeIds.length > 0) {
        const { error: assignError } = await supabase.from('task_manager_category_employees').insert(
          categoryForm.employeeIds.map((employeeId) => ({
            business_id: selectedBusinessId,
            category_id: categoryId,
            employee_id: employeeId
          }))
        );
        if (assignError) throw assignError;
      }

      toast.success(
        editingCategoryId
          ? 'Category updated'
          : duplicateCategory
            ? `"${duplicateCategory.name}" reactivated`
            : 'Category created'
      );
      setCategoryForm(EMPTY_CATEGORY_FORM);
      setEditingCategoryId(null);
      await loadData();
    } catch (error) {
      console.error('Failed to save category:', error);
      if (error.code === '23505') {
        toast.error('That category name is already in use. Check inactive categories below or pick a different name.');
      } else {
        toast.error(error.message || 'Failed to save category');
      }
    } finally {
      setSaving(false);
    }
  };

  const editCategory = (category) => {
    const activeEmployeeIds = new Set(employees.map((employee) => employee.id));
    setEditingCategoryId(category.id);
    setCategoryForm({
      name: category.name,
      description: category.description || '',
      employeeIds: (employeesByCategoryId[category.id] || []).filter((id) => activeEmployeeIds.has(id)),
      kiosk_checklist_button: !!category.kiosk_checklist_button,
      kiosk_button_label: category.kiosk_button_label || '',
      checklist_window_start: dbTimeToInput(category.checklist_window_start),
      checklist_window_end: dbTimeToInput(category.checklist_window_end),
      location_sensitivity: category.location_sensitivity || 'none'
    });
  };

  const reactivateCategory = async (category) => {
    try {
      const { error } = await supabase
        .from('task_manager_categories')
        .update({ is_active: true })
        .eq('id', category.id)
        .eq('business_id', selectedBusinessId);
      if (error) throw error;
      toast.success(`"${category.name}" reactivated`);
      await loadData();
    } catch (error) {
      console.error('Failed to reactivate category:', error);
      toast.error(error.message || 'Failed to reactivate category');
    }
  };

  const deactivateCategory = async (category) => {
    if (!window.confirm(`Deactivate "${category.name}"? Existing tasks keep their category label.`)) return;
    try {
      const { error } = await supabase
        .from('task_manager_categories')
        .update({ is_active: false })
        .eq('id', category.id)
        .eq('business_id', selectedBusinessId);
      if (error) throw error;
      if (editingCategoryId === category.id) {
        setEditingCategoryId(null);
        setCategoryForm(EMPTY_CATEGORY_FORM);
      }
      toast.success('Category deactivated');
      await loadData();
    } catch (error) {
      console.error('Failed to deactivate category:', error);
      toast.error(error.message || 'Failed to deactivate category');
    }
  };

  const editTask = (task) => {
    setEditingTaskId(task.id);
    setTaskForm(taskToForm(task, businessTimezone, categories));
    setActiveTab('tasks');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const cancelTaskEdit = () => {
    setEditingTaskId(null);
    setTaskForm(EMPTY_TASK_FORM);
  };

  const deleteTask = async (task) => {
    const isRecurringInstance = Boolean(task.template_id);
    const confirmed = window.confirm(
      isRecurringInstance
        ? `Remove "${task.title}" from the schedule? This recurring slot will not reappear on the kiosk.`
        : `Permanently delete "${task.title}"? This cannot be undone.`
    );
    if (!confirmed) return;
    try {
      const { error } = isRecurringInstance
        ? await supabase
          .from('task_manager_tasks')
          .update({ status: 'cancelled' })
          .eq('id', task.id)
          .eq('business_id', selectedBusinessId)
        : await supabase
          .from('task_manager_tasks')
          .delete()
          .eq('id', task.id)
          .eq('business_id', selectedBusinessId);
      if (error) throw error;
      if (editingTaskId === task.id) {
        setEditingTaskId(null);
        setTaskForm(EMPTY_TASK_FORM);
      }
      toast.success(isRecurringInstance ? 'Task removed from schedule' : 'Task deleted');
      await loadData();
    } catch (error) {
      console.error('Failed to delete task:', error);
      toast.error(error.message || 'Failed to delete task');
    }
  };

  const saveTodayTask = async (event) => {
    event.preventDefault();
    if (!todayTaskForm.title.trim()) {
      toast.error('Task title is required');
      return;
    }

    setSavingTodayTask(true);
    try {
      const categoryFields = todayTaskForm.category_id
        ? resolveCategoryFields(todayTaskForm.category_id)
        : { category_id: null, category: "Today's Tasks" };

      const payload = {
        title: todayTaskForm.title.trim(),
        description: optionalText(todayTaskForm.description),
        ...categoryFields,
        priority: todayTaskForm.priority || 'urgent',
        requires_photo: !!todayTaskForm.requires_photo,
        photo_requirement_mode: todayTaskForm.requires_photo ? 'always' : 'never',
        requires_notes: !!todayTaskForm.requires_notes,
        instructions: optionalText(todayTaskForm.instructions)
      };

      if (editingTodayTaskId) {
        const { data: updatedTask, error } = await supabase
          .from('task_manager_tasks')
          .update(payload)
          .eq('id', editingTodayTaskId)
          .eq('business_id', selectedBusinessId)
          .in('status', TODAY_TASK_EDITABLE_STATUSES)
          .select('*')
          .single();

        if (error) throw error;
        if (!updatedTask) {
          toast.error('This task can no longer be edited.');
          setEditingTodayTaskId(null);
          setTodayTaskForm(EMPTY_TODAY_TASK_FORM);
          loadTodayPriorityTasks({ silent: true });
          return;
        }
        toast.success('Tonight\'s task updated');
        setEditingTodayTaskId(null);
        setTodayTaskForm(EMPTY_TODAY_TASK_FORM);
        setTodayPriorityTasks((prev) => prev.map((task) => (task.id === updatedTask.id ? updatedTask : task)));
        return;
      }

      const nowIso = new Date().toISOString();
      const nextSortOrder = openTodayPriorityTasks.reduce((min, task) => {
        if (!Number.isFinite(task.today_priority_sort_order)) return min;
        return Math.min(min, task.today_priority_sort_order);
      }, 0) - 1;
      const { data: newTask, error } = await supabase
        .from('task_manager_tasks')
        .insert({
          business_id: selectedBusinessId,
          assignment_scope: 'facility',
          assigned_to: null,
          status: 'to_do',
          ...scheduleFieldsForInsert({ due_schedule_mode: TODAY_PRIORITY_SCHEDULE_MODE }),
          available_at: nowIso,
          due_at: null,
          today_priority_sort_order: openTodayPriorityTasks.length === 0 ? 0 : nextSortOrder,
          peer_review_required: false,
          checklist: [],
          ...payload
        })
        .select('*')
        .single();

      if (error) throw error;
      toast.success("Added to tonight's kiosk queue");
      setTodayTaskForm(EMPTY_TODAY_TASK_FORM);
      if (newTask) {
        setTodayPriorityTasks((prev) => [newTask, ...prev.filter((task) => task.id !== newTask.id)]);
      } else {
        loadTodayPriorityTasks({ silent: true });
      }
    } catch (error) {
      console.error('Failed to save today task:', error);
      toast.error(error.message || 'Failed to save task');
    } finally {
      setSavingTodayTask(false);
    }
  };

  const editTodayTask = (task) => {
    if (!canEditTodayTask(task)) return;
    setEditingTodayTaskId(task.id);
    setTodayTaskForm(taskToTodayForm(task));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const cancelTodayTaskEdit = () => {
    setEditingTodayTaskId(null);
    setTodayTaskForm(EMPTY_TODAY_TASK_FORM);
  };

  const persistTodayPriorityOrder = async (orderedTasks) => {
    if (!selectedBusinessId || !orderedTasks.length) return;
    setSavingTodayTaskOrder(true);
    const sortById = orderedTasks.reduce((acc, task, index) => {
      acc[task.id] = index;
      return acc;
    }, {});
    const previousTasks = todayPriorityTasks;
    setTodayPriorityTasks((prev) => prev.map((task) => (
      sortById[task.id] == null
        ? task
        : { ...task, today_priority_sort_order: sortById[task.id] }
    )));
    try {
      const results = await Promise.all(
        orderedTasks.map((task, index) => supabase
          .from('task_manager_tasks')
          .update({ today_priority_sort_order: index })
          .eq('id', task.id)
          .eq('business_id', selectedBusinessId))
      );
      const failed = results.find((result) => result.error);
      if (failed?.error) throw failed.error;
    } catch (error) {
      console.error('Failed to reorder tonight\'s tasks:', error);
      setTodayPriorityTasks(previousTasks);
      toast.error(error.message || 'Failed to save task order');
    } finally {
      setSavingTodayTaskOrder(false);
    }
  };

  const handleTodayTaskDragStart = (index) => {
    if (savingTodayTaskOrder) return;
    setDraggedTodayTaskIndex(index);
  };

  const handleTodayTaskDragOver = (event, index) => {
    event.preventDefault();
    if (savingTodayTaskOrder) return;
    if (draggedTodayTaskIndex !== null && draggedTodayTaskIndex !== index) {
      setDragOverTodayTaskIndex(index);
    }
  };

  const handleTodayTaskDrop = (dropIndex) => {
    if (draggedTodayTaskIndex === null || draggedTodayTaskIndex === dropIndex) {
      setDraggedTodayTaskIndex(null);
      setDragOverTodayTaskIndex(null);
      return;
    }
    const reordered = [...openTodayPriorityTasks];
    const [movedTask] = reordered.splice(draggedTodayTaskIndex, 1);
    reordered.splice(dropIndex, 0, movedTask);
    setDraggedTodayTaskIndex(null);
    setDragOverTodayTaskIndex(null);
    persistTodayPriorityOrder(reordered);
  };

  const handleTodayTaskDragEnd = () => {
    setDraggedTodayTaskIndex(null);
    setDragOverTodayTaskIndex(null);
  };

  const cancelTodayTask = async (task) => {
    if (!isTodayPriorityTask(task)) return;
    const confirmed = window.confirm(`Remove "${task.title}" from tonight's list?`);
    if (!confirmed) return;

    setCancellingTodayTaskId(task.id);
    const previousTasks = todayPriorityTasks;
    if (editingTodayTaskId === task.id) {
      cancelTodayTaskEdit();
    }
    setTodayPriorityTasks((prev) => prev.map((row) => (
      row.id === task.id ? { ...row, status: 'cancelled' } : row
    )));
    try {
      const { error } = await supabase
        .from('task_manager_tasks')
        .update({ status: 'cancelled' })
        .eq('id', task.id)
        .eq('business_id', selectedBusinessId);
      if (error) throw error;
      toast.success('Task removed from tonight\'s list');
    } catch (error) {
      console.error('Failed to cancel today task:', error);
      setTodayPriorityTasks(previousTasks);
      toast.error(error.message || 'Failed to remove task');
    } finally {
      setCancellingTodayTaskId(null);
    }
  };

  const deleteTrainingModule = async (trainingItem) => {
    setSaving(true);
    try {
      const deleted = await deleteTrainingWithManagerPin({ businessId: selectedBusinessId, trainingItem });
      if (deleted) {
        setTaskForm((current) => ({
          ...current,
          hrTrainingItemIds: (current.hrTrainingItemIds || []).filter((id) => id !== trainingItem.id)
        }));
        await loadData();
      }
    } catch (error) {
      console.error('Failed to delete training:', error);
      toast.error(error.message || 'Failed to delete training');
    } finally {
      setSaving(false);
    }
  };

  const saveHrTrainingLinksForTarget = async ({ taskId = null, templateId = null, trainingItemIds = [] }) => {
    if (!taskId && !templateId) return;
    const normalizedIds = [...new Set((trainingItemIds || []).filter(Boolean))];

    let deleteQuery = supabase
      .from('task_manager_training_resources')
      .delete()
      .eq('business_id', selectedBusinessId)
      .not('hr_training_item_id', 'is', null);

    if (taskId) deleteQuery = deleteQuery.eq('task_id', taskId);
    if (templateId) deleteQuery = deleteQuery.eq('template_id', templateId).is('task_id', null);

    const { error: deleteError } = await deleteQuery;
    if (deleteError) throw deleteError;

    if (normalizedIds.length === 0) return;

    const trainingById = Object.fromEntries(hrTrainingCatalog.map((item) => [item.id, item]));
    const rows = normalizedIds.map((trainingItemId) => {
      const training = trainingById[trainingItemId];
      return {
        business_id: selectedBusinessId,
        task_id: taskId,
        template_id: templateId,
        hr_training_item_id: trainingItemId,
        title: training?.title || 'Training module',
        resource_type: 'text',
        content: training?.description || null,
        is_required: true,
        created_by: authUser?.id || null
      };
    });

    const { error: insertError } = await supabase.from('task_manager_training_resources').insert(rows);
    if (insertError) throw insertError;
  };

  const saveTaskTrainingResources = async (taskId, resources) => {
    if (!taskId) return;
    const normalized = normalizeTaskTrainingResources(resources);
    const existingBridgeIds = normalized.map((resource) => resource.id).filter(Boolean);
    const createdTrainingItemIds = [];

    let deleteLegacyQuery = supabase
      .from('task_manager_training_resources')
      .delete()
      .eq('business_id', selectedBusinessId)
      .eq('task_id', taskId)
      .is('hr_training_item_id', null);
    if (existingBridgeIds.length > 0) {
      deleteLegacyQuery = deleteLegacyQuery.not('id', 'in', `(${existingBridgeIds.join(',')})`);
    }
    const { error: deleteError } = await deleteLegacyQuery;
    if (deleteError) throw deleteError;

    for (const resource of normalized) {
      let resourceUrl = resource.resource_url;
      if (resource.uploadFile) {
        const safeName = String(resource.uploadFile.name || resource.uploadFileName || 'training-media')
          .replace(/[^a-zA-Z0-9._-]/g, '_')
          .slice(0, 120);
        const path = `${selectedBusinessId}/tasks/${taskId}/${crypto.randomUUID()}_${safeName}`;
        const { error: uploadError } = await supabase.storage
          .from(TASK_TRAINING_MEDIA_BUCKET)
          .upload(path, resource.uploadFile, {
            cacheControl: '3600',
            upsert: false,
            contentType: resource.uploadFile.type || undefined
          });
        if (uploadError) throw uploadError;
        const { data: urlData } = supabase.storage.from(TASK_TRAINING_MEDIA_BUCKET).getPublicUrl(path);
        resourceUrl = urlData?.publicUrl || '';
        if (!resourceUrl) throw new Error('Failed to generate training media URL');
      }

      const { data: hrTraining, error: hrTrainingError } = await supabase
        .from('hr_training_items')
        .insert({
          business_id: selectedBusinessId,
          title: resource.title.trim(),
          description: optionalText(resource.content) || `Created from Task Manager task training.`,
          content: optionalText(resource.content),
          resource_url: optionalText(resourceUrl),
          requires_acknowledgement: resource.is_required !== false,
          is_active: true,
          created_by: authUser?.id || null,
          sections: {
            overview: {
              text: optionalText(resource.content),
              image_url: resource.resource_type === 'document' ? optionalText(resourceUrl) : null
            },
            objectives: { text: null, image_url: null },
            notes: { text: 'Created from Task Manager task training.', image_url: null }
          },
          steps: [{
            id: crypto.randomUUID(),
            order: 1,
            title: resource.title.trim(),
            body: optionalText(resource.content),
            resource_url: resource.resource_type === 'link' ? optionalText(resourceUrl) : null,
            image_url: resource.resource_type === 'document' ? optionalText(resourceUrl) : null,
            file_url: resource.resource_type !== 'link' && resource.resource_type !== 'document' ? optionalText(resourceUrl) : null,
            is_required: resource.is_required !== false
          }],
          quiz: {},
          task_manager_enabled: true,
          task_link_mode: 'existing_task',
          task_manager_task_id: taskId
        })
        .select('id, title, description')
        .single();
      if (hrTrainingError) throw hrTrainingError;
      createdTrainingItemIds.push(hrTraining.id);

      const bridgePayload = {
        business_id: selectedBusinessId,
        task_id: taskId,
        template_id: null,
        hr_training_item_id: hrTraining.id,
        title: hrTraining.title,
        resource_type: 'text',
        resource_url: null,
        content: hrTraining.description,
        is_required: resource.is_required !== false,
        created_by: authUser?.id || null
      };

      const { error } = await supabase.from('task_manager_training_resources').insert(bridgePayload);
      if (error) throw error;
    }

    return createdTrainingItemIds;
  };

  const getTaskScheduleTimes = () => {
    const rawTimes = Array.isArray(taskForm.scheduleTimes) && taskForm.scheduleTimes.length
      ? taskForm.scheduleTimes
      : [taskForm.schedule_time || datetimeLocalTimePart(taskForm.due_at) || '09:00'];
    return [...new Set(rawTimes.map((time) => String(time || '').slice(0, 5)).filter(Boolean))];
  };

  const isKioskChecklistCategory = (categoryId) => {
    const category = categories.find((item) => item.id === categoryId);
    return !!category?.kiosk_checklist_button;
  };

  const buildTaskTiming = (timeOverride = null) => {
    let dueAt = null;
    let availableAt = null;
    const time = timeOverride || taskForm.schedule_time || '09:00';

    if (taskForm.due_schedule_mode === 'specific_date') {
      const date = datetimeLocalDatePart(taskForm.due_at);
      if (date) {
        dueAt = zonedDateTimeToUtc(date, `${String(time).slice(0, 5)}:00`, businessTimezone).toISOString();
        availableAt = dueAt;
      }
    } else if (taskForm.due_schedule_mode === 'daily_required') {
      const duePreview = buildFrequencyDueTimes(
        { ...taskForm, schedule_type: 'daily', schedule_time: time },
        businessTimezone
      );
      dueAt = duePreview?.due_at || null;
      availableAt = duePreview?.available_at || null;
    } else if (taskForm.due_schedule_mode === 'frequency') {
      const duePreview = buildFrequencyDueTimes({ ...taskForm, schedule_time: time }, businessTimezone);
      dueAt = duePreview?.due_at || null;
      availableAt = duePreview?.available_at || null;
    } else if (taskForm.due_schedule_mode === 'round_robin' || isPeriodRoundRobinMode(taskForm.due_schedule_mode)) {
      availableAt = new Date().toISOString();
    } else if (isKioskChecklistCategory(taskForm.category_id) || taskForm.due_schedule_mode === KIOSK_CHECKLIST_SCHEDULE_MODE) {
      availableAt = new Date().toISOString();
    }

    return { dueAt, availableAt };
  };

  const saveTask = async (event) => {
    event.preventDefault();
    if (!taskForm.title.trim()) {
      toast.error('Task title is required');
      return;
    }
    if (!taskForm.category_id) {
      toast.error('Choose a category');
      return;
    }

    const kioskChecklistTask = isKioskChecklistCategory(taskForm.category_id);
    const scheduleForm = kioskChecklistTask
      ? { ...taskForm, due_schedule_mode: KIOSK_CHECKLIST_SCHEDULE_MODE }
      : taskForm;

    if (!kioskChecklistTask && scheduleForm.due_schedule_mode === 'daily_required') {
      const duePreview = buildFrequencyDueTimes(
        { ...taskForm, schedule_type: 'daily', schedule_time: getTaskScheduleTimes()[0] || taskForm.schedule_time },
        businessTimezone
      );
      if (!duePreview) {
        toast.error('Could not compute a valid due time for this daily task');
        return;
      }
    }

    if (!kioskChecklistTask && scheduleForm.due_schedule_mode === 'frequency') {
      if (scheduleForm.schedule_type === 'once' && !scheduleForm.schedule_once_date) {
        toast.error('Choose a date for the one-time schedule');
        return;
      }
      const duePreview = buildFrequencyDueTimes({ ...scheduleForm, schedule_time: getTaskScheduleTimes()[0] || scheduleForm.schedule_time }, businessTimezone);
      if (!duePreview) {
        toast.error('Could not compute a valid due date from this schedule');
        return;
      }
    }

    if (!editingTaskId && !kioskChecklistTask && (
      scheduleForm.due_schedule_mode === 'specific_date'
      || scheduleForm.due_schedule_mode === 'daily_required'
      || (scheduleForm.due_schedule_mode === 'frequency' && scheduleForm.schedule_type === 'daily')
    ) && getTaskScheduleTimes().length === 0) {
      toast.error('Add at least one due time');
      return;
    }

    if (!editingTaskId && !kioskChecklistTask && (scheduleForm.due_schedule_mode === 'round_robin' || isPeriodRoundRobinMode(scheduleForm.due_schedule_mode)) && !scheduleForm.round_robin_group_id && !scheduleForm.round_robin_new_group_name.trim()) {
      toast.error('Select an existing round robin list or enter a name for a new list');
      return;
    }

    if (!editingTaskId && !kioskChecklistTask && scheduleForm.round_robin_group_id) {
      const selectedGroup = roundRobinGroups.find((group) => group.id === scheduleForm.round_robin_group_id);
      const expectedCadence = roundRobinResetCadenceForMode(scheduleForm.due_schedule_mode);
      if (selectedGroup && (selectedGroup.reset_cadence || 'on_complete') !== expectedCadence) {
        const cadenceLabel = scheduleForm.due_schedule_mode === 'weekly_round_robin'
          ? 'weekly'
          : scheduleForm.due_schedule_mode === 'biweekly_round_robin'
            ? 'bi-weekly'
            : 'standard';
        toast.error(`That list uses a different rotation cadence. Choose a ${cadenceLabel} list or create a new one.`);
        return;
      }
    }

    setSaving(true);
    try {
      let roundRobinGroupId = scheduleForm.round_robin_group_id || null;
      let roundRobinSortOrder = null;
      let roundRobinSlotOrder = null;
      let checklistSortOrder = null;

      if (!editingTaskId && kioskChecklistTask) {
        const { data: checklistSortRows, error: checklistSortError } = await supabase
          .from('task_manager_tasks')
          .select('checklist_sort_order')
          .eq('business_id', selectedBusinessId)
          .eq('category_id', taskForm.category_id)
          .order('checklist_sort_order', { ascending: false })
          .limit(1);
        if (checklistSortError) throw checklistSortError;
        checklistSortOrder = ((checklistSortRows?.[0]?.checklist_sort_order ?? -1) + 1);
      }

      if (!editingTaskId && !kioskChecklistTask && (scheduleForm.due_schedule_mode === 'round_robin' || isPeriodRoundRobinMode(scheduleForm.due_schedule_mode))) {
        if (!roundRobinGroupId) {
          const { data: newGroup, error: groupError } = await supabase
            .from('task_manager_round_robin_groups')
            .insert({
              business_id: selectedBusinessId,
              name: scheduleForm.round_robin_new_group_name.trim(),
              reset_cadence: roundRobinResetCadenceForMode(scheduleForm.due_schedule_mode)
            })
            .select('id')
            .single();
          if (groupError) throw groupError;
          roundRobinGroupId = newGroup.id;
        }

        const { data: sortRows, error: sortError } = await supabase
          .from('task_manager_tasks')
          .select('round_robin_sort_order, round_robin_slot_order')
          .eq('business_id', selectedBusinessId)
          .eq('round_robin_group_id', roundRobinGroupId)
          .order('round_robin_sort_order', { ascending: false })
          .limit(1);
        if (sortError) throw sortError;
        roundRobinSortOrder = ((sortRows?.[0]?.round_robin_sort_order ?? -1) + 1);

        if (isPeriodRoundRobinMode(scheduleForm.due_schedule_mode)) {
          const { data: slotRows, error: slotError } = await supabase
            .from('task_manager_tasks')
            .select('round_robin_slot_order')
            .eq('business_id', selectedBusinessId)
            .eq('round_robin_group_id', roundRobinGroupId)
            .not('round_robin_slot_order', 'is', null)
            .order('round_robin_slot_order', { ascending: false })
            .limit(1);
          if (slotError) throw slotError;
          roundRobinSlotOrder = ((slotRows?.[0]?.round_robin_slot_order ?? -1) + 1);
        }
      }

      const initialTiming = buildTaskTiming(getTaskScheduleTimes()[0]);
      const payload = {
        title: taskForm.title.trim(),
        description: optionalText(taskForm.description),
        ...resolveCategoryFields(taskForm.category_id),
        priority: taskForm.priority,
        assignment_scope: taskForm.assignment_scope,
        assigned_to: taskForm.assignment_scope === 'assigned' ? taskForm.assigned_to || null : null,
        ...scheduleFieldsForInsert({ ...scheduleForm, schedule_time: getTaskScheduleTimes()[0] || scheduleForm.schedule_time }),
        due_at: initialTiming.dueAt,
        available_at: initialTiming.availableAt,
        requires_photo: taskForm.photo_requirement_mode === 'always',
        photo_requirement_mode: taskForm.photo_requirement_mode || 'never',
        requires_notes: taskForm.requires_notes,
        peer_review_required: taskForm.peer_review_required,
        instructions: optionalText(taskForm.instructions),
        checklist: parseChecklist(taskForm.checklistText),
        required_form_id: taskForm.required_form_id || null,
        module_link_key: taskForm.module_link_key || null
      };

      if (editingTaskId) {
        const { error } = await supabase
          .from('task_manager_tasks')
          .update(payload)
          .eq('id', editingTaskId)
          .eq('business_id', selectedBusinessId);
        if (error) throw error;
        await saveHrTrainingLinksForTarget({ taskId: editingTaskId, trainingItemIds: taskForm.hrTrainingItemIds });
        const createdTrainingItemIds = await saveTaskTrainingResources(editingTaskId, taskForm.trainingResources);
        if (createdTrainingItemIds?.length) {
          await saveHrTrainingLinksForTarget({
            taskId: editingTaskId,
            trainingItemIds: [...(taskForm.hrTrainingItemIds || []), ...createdTrainingItemIds]
          });
        }
        toast.success('Task updated');
        setEditingTaskId(null);
        setTaskForm(EMPTY_TASK_FORM);
      } else {
        const times = kioskChecklistTask
          ? [getTaskScheduleTimes()[0] || scheduleForm.schedule_time || '09:00']
          : (
          scheduleForm.due_schedule_mode === 'specific_date'
          || scheduleForm.due_schedule_mode === 'daily_required'
          || (scheduleForm.due_schedule_mode === 'frequency' && scheduleForm.schedule_type === 'daily')
        )
          ? getTaskScheduleTimes()
          : [getTaskScheduleTimes()[0] || scheduleForm.schedule_time || '09:00'];
        const rows = times.map((time, index) => {
          const timing = buildTaskTiming(time);
          return {
            business_id: selectedBusinessId,
            ...payload,
            ...scheduleFieldsForInsert({ ...scheduleForm, schedule_time: time }),
            schedule_time: scheduleForm.due_schedule_mode === 'frequency' ? time : null,
            due_at: timing.dueAt,
            available_at: timing.availableAt,
            round_robin_group_id: kioskChecklistTask ? null : roundRobinGroupId,
            round_robin_sort_order: roundRobinSortOrder == null ? null : roundRobinSortOrder + index,
            round_robin_slot_order: roundRobinSlotOrder == null ? null : roundRobinSlotOrder + index,
            round_robin_week_start: scheduleForm.due_schedule_mode === 'weekly_round_robin'
              ? businessWeekStartDate(businessTimezone)
              : scheduleForm.due_schedule_mode === 'biweekly_round_robin'
                ? businessBiweeklyPeriodStart(businessTimezone)
                : null,
            checklist_sort_order: checklistSortOrder == null ? null : checklistSortOrder + index,
            review_status: 'not_required',
            created_by: authUser?.id || null
          };
        });
        const { data: newTasks, error } = await supabase.from('task_manager_tasks').insert(rows).select('id');
        if (error) throw error;
        for (const newTask of newTasks || []) {
          await saveHrTrainingLinksForTarget({ taskId: newTask.id, trainingItemIds: taskForm.hrTrainingItemIds });
          const createdTrainingItemIds = await saveTaskTrainingResources(newTask.id, taskForm.trainingResources);
          if (createdTrainingItemIds?.length) {
            await saveHrTrainingLinksForTarget({
              taskId: newTask.id,
              trainingItemIds: [...(taskForm.hrTrainingItemIds || []), ...createdTrainingItemIds]
            });
          }
        }
        toast.success(rows.length > 1 ? `${rows.length} tasks created` : 'Task created');
        setTaskForm(EMPTY_TASK_FORM);
        setActiveTab('overview');
      }

      await loadData();
    } catch (error) {
      console.error('Failed to save task:', error);
      toast.error(error.message || 'Failed to save task');
    } finally {
      setSaving(false);
    }
  };

  const updateTaskStatus = async (task, status) => {
    try {
      const { error } = await supabase
        .from('task_manager_tasks')
        .update({ status })
        .eq('id', task.id)
        .eq('business_id', selectedBusinessId);
      if (error) throw error;
      toast.success('Task updated');
      await loadData();
    } catch (error) {
      console.error('Failed to update task:', error);
      toast.error(error.message || 'Failed to update task');
    }
  };

  const managerSignOffTask = async (task, employeeId, notes) => {
    if (!selectedBusinessId || !task?.id) return;
    if (!employeeId) {
      toast.error('Select the employee who completed this task');
      return;
    }
    setSigningOffTaskId(task.id);
    try {
      const { data, error } = await supabase.rpc('task_manager_manager_sign_off_task', {
        p_business_id: selectedBusinessId,
        p_task_id: task.id,
        p_completed_by: employeeId,
        p_notes: notes?.trim() || null
      });
      if (error) throw error;
      if (!data?.success) {
        throw new Error(data?.error || 'Failed to mark task complete');
      }
      toast.success(`Marked complete for ${employeeNameById[employeeId] || 'staff'}`);
      await loadData();
    } catch (error) {
      console.error('Failed to sign off task:', error);
      toast.error(error.message || 'Failed to mark task complete');
    } finally {
      setSigningOffTaskId(null);
    }
  };

  const loadQuickViewPreview = async (tab = quickViewTab) => {
    if (!selectedBusinessId) return;
    setQuickViewLoading(true);
    try {
      const employeeId = tab === 'facility' ? null : tab;
      const { data, error } = await supabase.rpc('task_manager_get_kiosk_queue_preview', {
        p_business_id: selectedBusinessId,
        p_employee_id: employeeId
      });
      if (error) throw error;
      setQuickViewRows(data || []);
    } catch (error) {
      console.error('Failed to load kiosk queue preview:', error);
      toast.error(error.message || 'Failed to load quick view');
      setQuickViewRows([]);
    } finally {
      setQuickViewLoading(false);
    }
  };

  const openQuickView = async () => {
    setQuickViewTab('facility');
    setQuickViewOpen(true);
    await loadQuickViewPreview('facility');
  };

  const handleQuickViewTabChange = async (tab) => {
    setQuickViewTab(tab);
    await loadQuickViewPreview(tab);
  };

  const saveChecklistAlertSettings = async (event) => {
    event.preventDefault();
    if (!selectedBusinessId) return;
    setSaving(true);
    try {
      const minutesBeforeClose = Math.min(480, Math.max(5, Number(checklistAlertSettings.minutes_before_close) || 60));
      const { error: settingsError } = await supabase.from('task_manager_checklist_alert_settings').upsert({
        business_id: selectedBusinessId,
        enabled: checklistAlertSettings.enabled !== false,
        minutes_before_close: minutesBeforeClose,
        updated_at: new Date().toISOString()
      });
      if (settingsError) throw settingsError;

      const { error: deleteError } = await supabase
        .from('task_manager_checklist_alert_recipients')
        .delete()
        .eq('business_id', selectedBusinessId);
      if (deleteError) throw deleteError;

      const recipientRows = (checklistAlertRecipients || [])
        .filter((row) => row.category_id && row.employee_id)
        .map((row) => ({
          business_id: selectedBusinessId,
          category_id: row.category_id,
          employee_id: row.employee_id
        }));

      if (recipientRows.length) {
        const { error: insertError } = await supabase
          .from('task_manager_checklist_alert_recipients')
          .insert(recipientRows);
        if (insertError) throw insertError;
      }

      toast.success('Checklist alert settings saved');
      await loadData();
    } catch (error) {
      console.error('Failed to save checklist alert settings:', error);
      toast.error(error.message || 'Failed to save checklist alert settings');
    } finally {
      setSaving(false);
    }
  };

  const toggleChecklistAlertRecipient = (categoryId, employeeId) => {
    setChecklistAlertRecipients((prev) => {
      const exists = prev.some((row) => row.category_id === categoryId && row.employee_id === employeeId);
      if (exists) {
        return prev.filter((row) => !(row.category_id === categoryId && row.employee_id === employeeId));
      }
      return [...prev, { category_id: categoryId, employee_id: employeeId }];
    });
  };

  const saveQueueSettings = async (event) => {
    event.preventDefault();
    if (!selectedBusinessId) return;
    setSaving(true);
    try {
      const payload = {
        business_id: selectedBusinessId,
        sales_aware_queue_enabled: queueSettings.sales_aware_queue_enabled !== false,
        admission_lookback_minutes: Math.min(720, Math.max(15, Number(queueSettings.admission_lookback_minutes) || 180)),
        kitchen_lookback_minutes: Math.min(240, Math.max(5, Number(queueSettings.kitchen_lookback_minutes) || 60)),
        admission_busy_threshold: Math.min(500, Math.max(1, Number(queueSettings.admission_busy_threshold) || 15)),
        kitchen_busy_threshold: Math.min(500, Math.max(1, Number(queueSettings.kitchen_busy_threshold) || 8)),
        admission_slow_threshold: Math.min(500, Math.max(0, Number(queueSettings.admission_slow_threshold) || 5)),
        kitchen_slow_threshold: Math.min(500, Math.max(0, Number(queueSettings.kitchen_slow_threshold) || 3)),
        updated_at: new Date().toISOString()
      };
      const { error } = await supabase.from('task_manager_queue_settings').upsert(payload);
      if (error) throw error;
      toast.success('Queue settings saved');
      await loadData();
    } catch (error) {
      console.error('Failed to save queue settings:', error);
      toast.error(error.message || 'Failed to save queue settings');
    } finally {
      setSaving(false);
    }
  };

  const savePeerReviewSettings = async (event) => {
    event.preventDefault();
    if (!selectedBusinessId) return;
    setSaving(true);
    try {
      const payload = {
        business_id: selectedBusinessId,
        reviews_per_login: Number(peerReviewSettings.reviews_per_login) || 5,
        new_hire_sample_rate: Number(peerReviewSettings.new_hire_sample_rate) || 0,
        experienced_sample_rate: Number(peerReviewSettings.experienced_sample_rate) || 0,
        new_hire_days: Number(peerReviewSettings.new_hire_days) || 90,
        updated_at: new Date().toISOString()
      };
      const { error } = await supabase.from('task_manager_peer_review_settings').upsert(payload);
      if (error) throw error;
      toast.success('Peer review settings saved');
      await loadData();
    } catch (error) {
      console.error('Failed to save peer review settings:', error);
      toast.error(error.message || 'Failed to save peer review settings');
    } finally {
      setSaving(false);
    }
  };

  const savePeerReviewWeight = async ({ employeeId, sampleRate, expiresAt, reason }) => {
    if (!selectedBusinessId || !employeeId) {
      toast.error('Select an employee');
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase.from('task_manager_employee_peer_review_weights').upsert({
        business_id: selectedBusinessId,
        employee_id: employeeId,
        sample_rate: Number(sampleRate),
        expires_at: expiresAt || null,
        reason: reason || null,
        created_by: authUser?.id || null,
        updated_at: new Date().toISOString()
      }, { onConflict: 'business_id,employee_id' });
      if (error) throw error;
      toast.success('Employee peer review weight saved');
      await loadData();
    } catch (error) {
      console.error('Failed to save peer review weight:', error);
      toast.error(error.message || 'Failed to save employee weight');
    } finally {
      setSaving(false);
    }
  };

  const deletePeerReviewWeight = async (weightId) => {
    if (!selectedBusinessId || !weightId) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from('task_manager_employee_peer_review_weights')
        .delete()
        .eq('id', weightId)
        .eq('business_id', selectedBusinessId);
      if (error) throw error;
      toast.success('Employee weight removed');
      await loadData();
    } catch (error) {
      console.error('Failed to delete peer review weight:', error);
      toast.error(error.message || 'Failed to delete employee weight');
    } finally {
      setSaving(false);
    }
  };

  if (authLoading || moduleLoading || loading) {
    return <LoadingState label="Loading Tavari Task Manager..." />;
  }

  if (authError) {
    return <ErrorState message={authError} />;
  }

  if (!canManageTasks) {
    return <ErrorState message="You do not have permission to manage Tavari Task Manager." />;
  }

  if (!tasksEnabled) {
    return <ErrorState message="Tavari Task Manager is not enabled for this business yet. Enable it from Modules first." />;
  }

  return (
    <div style={styles.container}>
      <TavariModuleHeader
        title="Tavari Task Manager"
        description="Create prioritized staff work, recurring facility checks, PIN-based kiosk completion, and review workflows."
        actionLabel="Quick View"
        actionIcon={<FiList />}
        onAction={openQuickView}
      />

      <TaskQuickViewModal
        open={quickViewOpen}
        onClose={() => setQuickViewOpen(false)}
        loading={quickViewLoading}
        rows={quickViewRows}
        activeTab={quickViewTab}
        onTabChange={handleQuickViewTabChange}
        onRefresh={() => loadQuickViewPreview(quickViewTab)}
        assignedEmployees={assignedPreviewEmployees}
        employeeNameById={employeeNameById}
        businessTimezone={businessTimezone}
      />

      <TavariTabSystemComponent
        tabs={TASK_MANAGER_TABS}
        mode="state"
        activeTab={activeTab}
        onTabChange={setActiveTab}
        ariaLabel="Task Manager module"
      />

      {activeTab === 'overview' && (
        <>
          <div style={styles.statGrid}>
            <StatCard label="Open Tasks" value={stats.open} onClick={() => setOverviewStatDetail('open')} />
            <StatCard label="Overdue" value={stats.overdue} tone={stats.overdue > 0 ? 'danger' : 'default'} onClick={() => setOverviewStatDetail('overdue')} />
            <StatCard label="Incomplete (audit)" value={stats.incomplete} tone={stats.incomplete > 0 ? 'warning' : 'default'} onClick={() => setOverviewStatDetail('incomplete')} />
            <StatCard label="Completed Today" value={stats.completedToday} onClick={() => setOverviewStatDetail('completedToday')} />
            <StatCard label="Pending Reviews" value={stats.pendingReviews} tone={stats.pendingReviews > 0 ? 'warning' : 'default'} onClick={() => setOverviewStatDetail('pendingReviews')} />
            <StatCard label="Peer Reviews Today" value={stats.peerReviewsToday} onClick={() => setOverviewStatDetail('peerReviewsToday')} />
          </div>
          {overviewStatDetail && (
            <OverviewStatDetailModal
              statKey={overviewStatDetail}
              items={overviewStatLists[overviewStatDetail] || []}
              employeeNameById={employeeNameById}
              categoryNameById={categoryNameById}
              taskTitleById={taskTitleById}
              businessTimezone={businessTimezone}
              onClose={() => setOverviewStatDetail(null)}
            />
          )}
          <TaskSearchBar
            id="overview-task-search"
            value={overviewSearch}
            onChange={setOverviewSearch}
            filteredCount={filteredOverviewTasks.length}
            totalCount={sortedOpenDueTasks.length}
            metaLabel="due tasks"
          />
          <TaskList
            tasks={filteredOverviewTasks}
            employeeNameById={employeeNameById}
            categoryNameById={categoryNameById}
            businessTimezone={businessTimezone}
            onEdit={editTask}
            editingTaskId={editingTaskId}
            title="Due now"
            description={overviewSearchQuery
              ? 'Filtered open tasks matching your search. Use manager sign-off when work was done but not recorded on the kiosk.'
              : 'Open tasks that are available and not yet completed. Use manager sign-off when work was done but not recorded on the kiosk.'}
            emptyText={overviewSearchQuery && sortedOpenDueTasks.length > 0
              ? 'No tasks match your search. Try a different title, category, or assignee.'
              : undefined}
            showSignOff
            employees={employees}
            onSignOff={managerSignOffTask}
            signingOffTaskId={signingOffTaskId}
          />
        </>
      )}

      {activeTab === 'today' && (
        <>
          {todayCompletionDetail && (
            <TodayTaskCompletionModal
              task={todayCompletionDetail}
              employeeNameById={employeeNameById}
              categoryNameById={categoryNameById}
              businessTimezone={businessTimezone}
              onClose={() => setTodayCompletionDetail(null)}
            />
          )}
        <div style={styles.twoColumn}>
          <Panel
            title={editingTodayTaskId ? 'Edit tonight\'s task' : 'Add to tonight\'s list'}
            description={editingTodayTaskId
              ? 'Update this task before staff complete it on the kiosk.'
              : 'One-off tasks added here go to the top of the task manager kiosk queue for today. Staff complete them through the normal kiosk flow (PIN, photos, notes).'}
          >
            <TodayTaskForm
              form={todayTaskForm}
              setForm={setTodayTaskForm}
              categories={activeCategories}
              onSubmit={saveTodayTask}
              saving={savingTodayTask}
              editing={Boolean(editingTodayTaskId)}
              onCancel={cancelTodayTaskEdit}
            />
          </Panel>
          <div style={styles.todayTasksColumn}>
            <Panel
              title={`On tonight's list (${openTodayPriorityTasks.length})`}
              description="Drag tasks to set the order employees see them on the kiosk. Top of the list goes first."
              action={(
                <button
                  type="button"
                  style={styles.secondaryButton}
                  disabled={todayTasksLoading || savingTodayTaskOrder}
                  onClick={() => loadTodayPriorityTasks()}
                >
                  {todayTasksLoading ? 'Refreshing…' : savingTodayTaskOrder ? 'Saving order…' : 'Refresh'}
                </button>
              )}
            >
              {todayTasksLoading && todayPriorityTasks.length === 0 ? (
                <EmptyState text="Loading tonight's list…" />
              ) : openTodayPriorityTasks.length === 0 ? (
                <EmptyState text="No tasks on tonight's list yet. Add one on the left." />
              ) : (
                <div style={styles.list}>
                  {openTodayPriorityTasks.map((task, index) => (
                    <article
                      key={task.id}
                      draggable={!savingTodayTaskOrder}
                      onDragStart={() => handleTodayTaskDragStart(index)}
                      onDragOver={(event) => handleTodayTaskDragOver(event, index)}
                      onDrop={() => handleTodayTaskDrop(index)}
                      onDragEnd={handleTodayTaskDragEnd}
                      style={{
                        ...styles.taskCard,
                        ...(editingTodayTaskId === task.id ? styles.taskCardEditing : {}),
                        ...(draggedTodayTaskIndex === index ? styles.taskCardDragging : {}),
                        ...(dragOverTodayTaskIndex === index ? styles.taskCardDragOver : {})
                      }}
                    >
                      <div style={styles.taskHeader}>
                        <div style={styles.todayTaskTitleRow}>
                          <button
                            type="button"
                            style={styles.dragHandle}
                            draggable={false}
                            aria-label={`Drag to reorder ${task.title}`}
                            title="Drag to reorder"
                            disabled={savingTodayTaskOrder}
                          >
                            <FiMenu />
                          </button>
                          <div>
                            <h3 style={styles.taskTitle}>
                              <span style={styles.todayTaskQueueNumber}>#{index + 1}</span>
                              {' '}
                              {task.title}
                            </h3>
                            <p style={styles.taskMeta}>
                              Added {formatZonedDateTime(task.created_at, businessTimezone)}
                              {task.category_id ? ` • ${categoryNameById[task.category_id] || task.category}` : ''}
                              {task.status === 'in_progress' ? ' • In progress on kiosk' : ''}
                            </p>
                          </div>
                        </div>
                        <div style={styles.badgeRow}>
                          <Badge label="kiosk priority" tone="success" />
                          <Badge label={task.priority} tone={priorityTone(task.priority)} />
                          {task.requires_photo && <Badge label="photo required" tone="warning" />}
                          {task.requires_notes && <Badge label="notes required" tone="warning" />}
                        </div>
                      </div>
                      {task.description && <p style={styles.taskDescription}>{task.description}</p>}
                      {task.instructions && (
                        <p style={styles.taskMeta}>Instructions: {task.instructions}</p>
                      )}
                      <div style={styles.cardActions}>
                        {canEditTodayTask(task) && (
                          <button
                            type="button"
                            style={styles.secondaryButton}
                            onClick={() => editTodayTask(task)}
                          >
                            Edit
                          </button>
                        )}
                        <button
                          type="button"
                          style={styles.dangerButtonSmall}
                          disabled={cancellingTodayTaskId === task.id || savingTodayTaskOrder}
                          onClick={() => cancelTodayTask(task)}
                        >
                          {cancellingTodayTaskId === task.id ? 'Removing…' : 'Remove'}
                        </button>
                      </div>
                      {task.status === 'in_progress' && (
                        <p style={styles.hintText}>In progress on the kiosk — wait for staff to finish or hand off before editing.</p>
                      )}
                    </article>
                  ))}
                </div>
              )}
            </Panel>
            <Panel
              title={`Completed tonight (${completedTodayPriorityTasks.length})`}
              description="Tap a completed task to view notes and completion photo."
            >
              {todayTasksLoading && todayPriorityTasks.length === 0 ? (
                <EmptyState text="Loading completed tasks…" />
              ) : completedTodayPriorityTasks.length === 0 ? (
                <EmptyState text="Nothing completed from tonight's list yet." />
              ) : (
                <div style={styles.list}>
                  {completedTodayPriorityTasks.map((task) => {
                    const photoUrl = getTaskCompletionPhotoUrl(task);
                    const notes = task.completion_summary?.notes;
                    return (
                    <article
                      key={task.id}
                      style={{ ...styles.taskCard, ...styles.taskCardClickable }}
                      role="button"
                      tabIndex={0}
                      onClick={() => setTodayCompletionDetail(task)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          setTodayCompletionDetail(task);
                        }
                      }}
                    >
                      <div style={styles.taskHeader}>
                        <div>
                          <h3 style={styles.taskTitle}>{task.title}</h3>
                          <p style={styles.taskMeta}>
                            Completed by {employeeNameById[task.completed_by] || 'Staff'}
                            {' • '}
                            {formatDateTime(task.completed_at)}
                          </p>
                        </div>
                        <Badge label="done" tone="success" />
                      </div>
                      {task.description && <p style={styles.taskDescription}>{task.description}</p>}
                      {(notes || photoUrl) ? (
                        <p style={styles.taskMeta}>
                          {notes ? 'Notes recorded' : 'No notes'}
                          {' • '}
                          {photoUrl ? 'Photo attached' : 'No photo'}
                          {' • '}
                          Tap to view
                        </p>
                      ) : (
                        <p style={styles.taskMeta}>Tap to view completion details</p>
                      )}
                    </article>
                    );
                  })}
                </div>
              )}
            </Panel>
          </div>
        </div>
        </>
      )}

      {activeTab === 'categories' && (
        <div style={styles.twoColumn}>
          <Panel title={editingCategoryId ? 'Edit Category' : 'Create Category'} description="Define standardized categories. Assign employees so only they see facility tasks in that category on the kiosk. Mark a category as a kiosk checklist button for opening, closing, or shift checklists — then set when staff can open it. Submissions are timestamped when staff actually submit.">
            <CategoryForm
              form={categoryForm}
              setForm={setCategoryForm}
              employees={employees}
              onSubmit={saveCategory}
              saving={saving}
              editing={Boolean(editingCategoryId)}
              onCancel={() => {
                setEditingCategoryId(null);
                setCategoryForm(EMPTY_CATEGORY_FORM);
              }}
            />
          </Panel>
          <Panel title="Your Categories" description="Tasks must use one of these categories. Leave employee assignment empty to allow any staff member. Kiosk checklist categories appear as bottom buttons on the tablet.">
            <CategoryList
              categories={categories}
              employeesByCategoryId={employeesByCategoryId}
              employeeNameById={employeeNameById}
              onEdit={editCategory}
              onDeactivate={deactivateCategory}
              onReactivate={reactivateCategory}
            />
          </Panel>
        </div>
      )}

      {activeTab === 'tasks' && (
        <div style={styles.twoColumn}>
          <Panel
            title={editingTaskId ? 'Edit Task' : 'Create Task'}
            description={editingTaskId
              ? 'Update this task. Changes apply to this task only.'
              : 'Create one-off tasks, recurring schedules (frequency), round robin lists, or checklist items for kiosk button categories.'}
          >
            {activeCategories.length === 0 ? (
              <EmptyState text="Create at least one category before adding tasks." />
            ) : (
              <TaskForm
                form={taskForm}
                setForm={setTaskForm}
                employees={employees}
                categories={activeCategories}
                employeesByCategoryId={employeesByCategoryId}
                roundRobinGroups={roundRobinGroups}
                businessTimezone={businessTimezone}
                operatingHours={operatingHours}
                formsCatalog={formsCatalog}
                hrTrainingCatalog={hrTrainingCatalog}
                onDeleteTrainingModule={deleteTrainingModule}
                onCategoryChange={(categoryId) => setTaskForm((prev) => {
                  const next = applyCategoryAssignmentHint({ ...prev, category_id: categoryId }, categoryId, 'assigned_to');
                  const category = activeCategories.find((item) => item.id === categoryId);
                  if (category?.kiosk_checklist_button) {
                    next.due_schedule_mode = KIOSK_CHECKLIST_SCHEDULE_MODE;
                  } else if (prev.due_schedule_mode === KIOSK_CHECKLIST_SCHEDULE_MODE) {
                    next.due_schedule_mode = 'specific_date';
                  }
                  return next;
                })}
                onSubmit={saveTask}
                saving={saving}
                editing={Boolean(editingTaskId)}
                onCancel={cancelTaskEdit}
                isTemplateInstance={Boolean(editingTask?.template_id)}
              />
            )}
          </Panel>
          <TaskList
            tasks={filteredVisibleTasks}
            employeeNameById={employeeNameById}
            categoryNameById={categoryNameById}
            businessTimezone={businessTimezone}
            onStatusChange={updateTaskStatus}
            onEdit={editTask}
            onDelete={deleteTask}
            editingTaskId={editingTaskId}
            title="Your Tasks"
            description={tasksTabSearchQuery
              ? 'Filtered tasks matching your search. Edit or delete any task. Due times are shown in your business timezone.'
              : 'Edit or delete any task. Due times are shown in your business timezone. Deleting a recurring task removes that slot from the kiosk for the day.'}
            emptyText={tasksTabSearchQuery && visibleTasks.length > 0
              ? 'No tasks match your search. Try a different title, category, or assignee.'
              : undefined}
            searchValue={tasksTabSearch}
            onSearchChange={setTasksTabSearch}
            searchInputId="your-tasks-search"
            searchTotalCount={visibleTasks.length}
            searchMetaLabel="tasks"
          />
        </div>
      )}

      {activeTab === 'reviews' && (
        <div style={styles.twoColumn}>
          <PeerReviewSettingsPanel
            settings={peerReviewSettings}
            setSettings={setPeerReviewSettings}
            weights={peerReviewWeights}
            employees={employees}
            employeeNameById={employeeNameById}
            saving={saving}
            onSaveSettings={savePeerReviewSettings}
            onSaveWeight={savePeerReviewWeight}
            onDeleteWeight={deletePeerReviewWeight}
          />
          <PeerReviewHistoryList
            submissions={peerReviewSubmissions}
            tasks={tasks}
            employeeNameById={employeeNameById}
          />
        </div>
      )}

      {activeTab === 'kiosk' && (
        <Panel title="Dedicated Task Kiosk" description="Staff use their existing POS PIN. The kiosk shows one prioritized task at a time. Categories marked as checklist buttons appear at the bottom for opening, closing, or shift lists.">
          {facilityBusySignals && (
            <div style={styles.facilityBusyCard}>
              <strong>Live facility traffic</strong>
              <p style={styles.taskMeta}>
                Admissions/check-ins ({facilityBusySignals.admission_lookback_minutes} min): {facilityBusySignals.admission_activity_count ?? 0}
                {facilityBusySignals.play_area_busy ? ' · Play area busy' : facilityBusySignals.play_area_slow ? ' · Play area slow' : ''}
              </p>
              <p style={styles.taskMeta}>
                Kitchen orders ({facilityBusySignals.kitchen_lookback_minutes} min): {facilityBusySignals.kitchen_order_count ?? 0}
                {facilityBusySignals.kitchen_busy ? ' · Kitchen busy' : facilityBusySignals.kitchen_slow ? ' · Kitchen slow' : ''}
              </p>
              {facilityBusySignals.sales_aware_queue_enabled === false && (
                <p style={styles.hintText}>Sales-aware queue ordering is turned off in Settings.</p>
              )}
            </div>
          )}
          <div style={styles.kioskCard}>
            <div style={styles.kioskCodeCard}>
              <div style={styles.kioskCodeCardLabel}>Kiosk code</div>
              <div style={styles.kioskCodeDigits}>{kioskCode || '------'}</div>
              <p style={styles.kioskCodeHint}>Enter this 6-digit code on the kiosk tablet, or open the link below once and bookmark it.</p>
            </div>
            <div>
              <div style={styles.kioskLabel}>Production subdomain</div>
              <code style={styles.codeBlock}>{subdomainKioskUrl || 'Loading kiosk code…'}</code>
            </div>
            <div>
              <div style={styles.kioskLabel}>Same-origin test link</div>
              <code style={styles.codeBlock}>{kioskUrl || 'Loading kiosk code…'}</code>
            </div>
            <div style={styles.kioskActions}>
              <button type="button" style={styles.primaryButton} disabled={!kioskUrl} onClick={() => window.open(kioskUrl, '_blank')}>
                Open Kiosk
              </button>
              <button
                type="button"
                style={styles.secondaryButton}
                disabled={!kioskCode}
                onClick={() => navigator.clipboard?.writeText(kioskCode).then(() => toast.success('Kiosk code copied'))}
              >
                Copy Code
              </button>
              <button
                type="button"
                style={styles.secondaryButton}
                disabled={!subdomainKioskUrl}
                onClick={() => navigator.clipboard?.writeText(subdomainKioskUrl).then(() => toast.success('Kiosk link copied'))}
              >
                Copy Subdomain Link
              </button>
            </div>
          </div>
        </Panel>
      )}

      {activeTab === 'settings' && (
        <TaskManagerSettingsTab
          checklistAlertSettings={checklistAlertSettings}
          setChecklistAlertSettings={setChecklistAlertSettings}
          checklistAlertRecipients={checklistAlertRecipients}
          onToggleChecklistAlertRecipient={toggleChecklistAlertRecipient}
          queueSettings={queueSettings}
          setQueueSettings={setQueueSettings}
          facilityBusySignals={facilityBusySignals}
          categories={categories}
          employees={alertRecipientEmployees}
          employeeNameById={employeeNameById}
          saving={saving}
          onSaveChecklistAlertSettings={saveChecklistAlertSettings}
          onSaveQueueSettings={saveQueueSettings}
        />
      )}
    </div>
  );
};

const TaskForm = ({
  form,
  setForm,
  employees,
  categories,
  employeesByCategoryId,
  roundRobinGroups,
  businessTimezone,
  operatingHours,
  formsCatalog = [],
  hrTrainingCatalog = [],
  onDeleteTrainingModule,
  onCategoryChange,
  onSubmit,
  saving,
  editing = false,
  onCancel,
  isTemplateInstance = false
}) => {
  const selectedCategory = categories.find((category) => category.id === form.category_id);
  const isKioskChecklistCategory = !!selectedCategory?.kiosk_checklist_button;

  return (
  <form style={styles.form} onSubmit={onSubmit}>
    {isTemplateInstance && (
      <p style={styles.hintText}>This task was generated from a template. Your edits apply to this occurrence only.</p>
    )}
    <TextInput label="Title" value={form.title} onChange={(value) => setForm({ ...form, title: value })} required />
    <TextArea label="Description" value={form.description} onChange={(value) => setForm({ ...form, description: value })} />
    {formsCatalog.length > 0 && (
      <Select
        label="Required form (Tavari Forms)"
        value={form.required_form_id}
        onChange={(value) => setForm({ ...form, required_form_id: value })}
        options={[{ value: '', label: 'None — checklist only' }, ...formsCatalog.map((f) => ({ value: f.id, label: f.title }))]}
      />
    )}
    {formsCatalog.length === 0 && (
      <p style={styles.hintText}>Create a form in Tavari Forms to require a structured checklist before this task can be completed on the kiosk.</p>
    )}
    {form.required_form_id && (
      <p style={styles.hintText}>On the kiosk, staff will fill out this form instead of a plain checklist. Submitting the form completes the task.</p>
    )}
    <Select
      label="In-app page link (optional)"
      value={form.module_link_key}
      onChange={(value) => setForm({ ...form, module_link_key: value })}
      options={getTaskManagerModuleLinkOptions()}
    />
    {form.module_link_key && (
      <p style={styles.hintText}>
        On the kiosk, staff can open{' '}
        {getTaskManagerModuleLink(form.module_link_key)?.label || 'the linked page'}
        , then return and tap Complete. If they lack permission, they will be told to ask a manager.
      </p>
    )}
    {form.category_id && (employeesByCategoryId[form.category_id] || []).length > 0 && (
      <p style={styles.hintText}>
        Kiosk: only {formatEmployeeList(employeesByCategoryId[form.category_id], employees)} see facility tasks in this category.
      </p>
    )}
    <div style={styles.formGrid}>
      <Select label="Category" value={form.category_id} onChange={onCategoryChange} options={categoryOptions(categories)} required />
      <Select label="Priority" value={form.priority} onChange={(value) => setForm({ ...form, priority: value })} options={priorityOptions()} />
      <Select label="Visibility" value={form.assignment_scope} onChange={(value) => setForm({ ...form, assignment_scope: value, assigned_to: '' })} options={scopeOptions()} />
      {form.assignment_scope === 'assigned' && (
        <Select label="Assigned Employee" value={form.assigned_to} onChange={(value) => setForm({ ...form, assigned_to: value })} options={employeeOptions(employees)} />
      )}
    </div>
    <TaskDueScheduleFields
      form={form}
      setForm={setForm}
      roundRobinGroups={roundRobinGroups}
      businessTimezone={businessTimezone}
      operatingHours={operatingHours}
      isKioskChecklistCategory={isKioskChecklistCategory}
      kioskChecklistLabel={selectedCategory?.kiosk_button_label || selectedCategory?.name || ''}
      allowMultipleTimes={
        !isKioskChecklistCategory && (
        form.due_schedule_mode === 'daily_required'
        || form.due_schedule_mode === 'specific_date'
        || (form.due_schedule_mode === 'frequency' && form.schedule_type === 'daily')
        )
      }
    />
    <TextArea label="Completion Instructions" value={form.instructions} onChange={(value) => setForm({ ...form, instructions: value })} />
    <TextArea label="Checklist Items (one per line)" value={form.checklistText} onChange={(value) => setForm({ ...form, checklistText: value })} />
    <TrainingLibrarySelector form={form} setForm={setForm} hrTrainingCatalog={hrTrainingCatalog} onDeleteTrainingModule={onDeleteTrainingModule} />
    <TaskTrainingResourcesEditor form={form} setForm={setForm} />
    <CheckboxRow form={form} setForm={setForm} />
    <div style={styles.cardActions}>
      <button type="submit" style={styles.primaryButton} disabled={saving}>{saving ? 'Saving...' : editing ? 'Update Task' : 'Create Task'}</button>
      {editing && onCancel && (
        <button type="button" style={styles.secondaryButton} onClick={onCancel}>Cancel Edit</button>
      )}
    </div>
  </form>
  );
};

const TrainingLibrarySelector = ({ form, setForm, hrTrainingCatalog, onDeleteTrainingModule }) => {
  const selectedIds = Array.isArray(form.hrTrainingItemIds) ? form.hrTrainingItemIds : [];
  const setSelected = (trainingItemId, checked) => {
    setForm({
      ...form,
      hrTrainingItemIds: checked
        ? [...new Set([...selectedIds, trainingItemId])]
        : selectedIds.filter((id) => id !== trainingItemId)
    });
  };

  return (
    <div style={styles.trainingEditor}>
      <div style={styles.trainingEditorHeader}>
        <div>
          <h3 style={styles.subTitle}>Training Library Modules</h3>
          <p style={styles.hintText}>Attach HR Training modules here. The same module can be opened from HR, Task Manager, or the kiosk.</p>
        </div>
      </div>
      {hrTrainingCatalog.length === 0 ? (
        <p style={styles.emptyText}>No HR training modules yet. Create one under HR → Training, then attach it here.</p>
      ) : (
        <div style={styles.employeeCheckboxList}>
          {hrTrainingCatalog.map((training) => (
            <div key={training.id} style={styles.trainingLibraryRow}>
              <TavariCheckbox
                id={`task-hr-training-${training.id}`}
                checked={selectedIds.includes(training.id)}
                onChange={(checked) => setSelected(training.id, checked)}
                label={training.title}
              />
              {onDeleteTrainingModule && (
                <button type="button" style={styles.dangerButtonSmall} onClick={() => onDeleteTrainingModule(training)}>
                  Delete
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const TaskTrainingResourcesEditor = ({ form, setForm }) => {
  const resources = Array.isArray(form.trainingResources) ? form.trainingResources : [];

  const updateResource = (index, patch) => {
    setForm({
      ...form,
      trainingResources: resources.map((resource, idx) => (idx === index ? { ...resource, ...patch } : resource))
    });
  };

  const addResource = () => {
    setForm({
      ...form,
      trainingResources: [
        ...resources,
        {
          title: '',
          resource_type: 'document',
          resource_url: '',
          uploadFile: null,
          uploadFileName: '',
          content: '',
          is_required: true
        }
      ]
    });
  };

  const removeResource = (index) => {
    setForm({
      ...form,
      trainingResources: resources.filter((_, idx) => idx !== index)
    });
  };

  return (
    <div style={styles.trainingEditor}>
      <div style={styles.trainingEditorHeader}>
        <div>
          <h3 style={styles.subTitle}>Task-Specific Supplemental Docs</h3>
          <p style={styles.hintText}>Use this only for one-off notes or media that should not become a reusable HR training module.</p>
        </div>
        <button type="button" style={styles.secondaryButton} onClick={addResource}>Add Supplemental Doc</button>
      </div>
      {resources.length === 0 ? (
        <p style={styles.emptyText}>No supplemental task-only docs attached.</p>
      ) : resources.map((resource, index) => (
        <div key={resource.id || `task-training-${index}`} style={styles.trainingResourceCard}>
          <div style={styles.formGrid}>
            <TextInput label="Title" value={resource.title} onChange={(value) => updateResource(index, { title: value })} placeholder="How to clean the slide mats" />
            <Select label="Type" value={resource.resource_type} onChange={(value) => updateResource(index, { resource_type: value })} options={[
              { value: 'document', label: 'Document / image' },
              { value: 'video', label: 'Video' },
              { value: 'link', label: 'Link' },
              { value: 'text', label: 'Instructions only' }
            ]} />
          </div>
          <TextInput label="Resource URL" value={resource.resource_url} onChange={(value) => updateResource(index, { resource_url: value })} placeholder="https://..." />
          <label style={styles.field}>
            <span style={styles.label}>Upload image, video, or file</span>
            <input
              type="file"
              accept="image/*,video/*,.pdf,.doc,.docx,.ppt,.pptx"
              style={styles.input}
              onChange={(event) => {
                const file = event.target.files?.[0] || null;
                updateResource(index, {
                  uploadFile: file,
                  uploadFileName: file?.name || ''
                });
              }}
            />
            {resource.uploadFileName && <span style={styles.hintText}>Selected: {resource.uploadFileName}</span>}
            {resource.resource_url && !resource.uploadFileName && <span style={styles.hintText}>Current media will stay attached unless you upload a replacement.</span>}
          </label>
          <TextArea label="Instructions / Notes" value={resource.content} onChange={(value) => updateResource(index, { content: value })} />
          <div style={styles.trainingResourceActions}>
            <TavariCheckbox
              id={`task-training-required-${index}`}
              checked={resource.is_required !== false}
              onChange={(checked) => updateResource(index, { is_required: checked })}
              label="Required before completion"
            />
            <button type="button" style={styles.secondaryButton} onClick={() => removeResource(index)}>Remove</button>
          </div>
        </div>
      ))}
    </div>
  );
};

const CategoryForm = ({ form, setForm, employees, onSubmit, saving, editing, onCancel }) => {
  const setEmployeeSelected = (employeeId, checked) => {
    setForm({
      ...form,
      employeeIds: checked
        ? [...new Set([...form.employeeIds, employeeId])]
        : form.employeeIds.filter((id) => id !== employeeId)
    });
  };

  return (
    <form style={styles.form} onSubmit={onSubmit}>
      <div style={styles.categoryFormSection}>
        <TextInput label="Category Name" value={form.name} onChange={(value) => setForm({ ...form, name: value })} required placeholder="Cleaning, Food Safety, Opening..." />
        <TextArea label="Description (optional)" value={form.description} onChange={(value) => setForm({ ...form, description: value })} />
      </div>
      {!form.kiosk_checklist_button && (
        <Select
          label="Location sensitivity (kiosk queue)"
          value={form.location_sensitivity || 'none'}
          onChange={(value) => setForm({ ...form, location_sensitivity: value })}
          options={LOCATION_SENSITIVITY_OPTIONS}
        />
      )}
      <div style={styles.field}>
        <TavariCheckbox
          id="category-kiosk-checklist-button"
          checked={!!form.kiosk_checklist_button}
          onChange={(checked) => setForm({ ...form, kiosk_checklist_button: checked })}
          label="Show as kiosk bottom button (checklist)"
        />
        <p style={styles.hintText}>Staff tap this button on the tablet to run the full checklist (opening, closing, after lunch, etc.). Tasks in this category are excluded from the one-at-a-time queue.</p>
        {form.kiosk_checklist_button && (
          <>
            <TextInput
              label="Kiosk button label (optional)"
              value={form.kiosk_button_label}
              onChange={(value) => setForm({ ...form, kiosk_button_label: value })}
              placeholder={form.name || 'Opening, Closing, After lunch...'}
            />
            <div style={styles.checklistWindowGrid}>
              <label style={styles.timeField}>
                <span style={styles.label}>Available from</span>
                <input
                  type="time"
                  required
                  value={form.checklist_window_start}
                  onChange={(e) => setForm({ ...form, checklist_window_start: e.target.value })}
                  style={styles.timeInput}
                />
              </label>
              <label style={styles.timeField}>
                <span style={styles.label}>Available until</span>
                <input
                  type="time"
                  required
                  value={form.checklist_window_end}
                  onChange={(e) => setForm({ ...form, checklist_window_end: e.target.value })}
                  style={styles.timeInput}
                />
              </label>
            </div>
            <p style={styles.hintText}>
              Staff can only open this checklist during that window (e.g. Opening 6:00 AM–11:00 AM, Closing 4:00 PM–10:00 PM). Form submissions are logged at the actual time staff submit.
            </p>
          </>
        )}
      </div>
      <div style={styles.field}>
        <span style={styles.label}>Assigned Employees (optional)</span>
        <p style={styles.hintText}>If you select employees, only they will see facility-queue tasks in this category on the kiosk. Leave empty for all staff.</p>
        <div style={styles.employeeCheckboxList}>
          {employees.length === 0 ? (
            <EmptyState text="No employees found for this business." />
          ) : employees.map((employee) => {
            const employeeLabel = employee.full_name || [employee.first_name, employee.last_name].filter(Boolean).join(' ') || employee.email || 'Employee';
            return (
              <TavariCheckbox
                key={employee.id}
                id={`task-category-employee-${employee.id}`}
                checked={form.employeeIds.includes(employee.id)}
                onChange={(checked) => setEmployeeSelected(employee.id, checked)}
                label={employeeLabel}
              />
            );
          })}
        </div>
      </div>
      <div style={styles.cardActions}>
        <button type="submit" style={styles.primaryButton} disabled={saving}>{saving ? 'Saving...' : editing ? 'Update Category' : 'Create Category'}</button>
        {editing && (
          <button type="button" style={styles.secondaryButton} onClick={onCancel}>Cancel Edit</button>
        )}
      </div>
    </form>
  );
};

const CategoryList = ({ categories, employeesByCategoryId, employeeNameById, onEdit, onDeactivate, onReactivate }) => (
  <div style={styles.list}>
    {categories.length === 0 ? (
      <EmptyState text="No categories yet. Create your first category to standardize tasks." />
    ) : categories.map((category) => {
      const assignedIds = employeesByCategoryId[category.id] || [];
      const assignedLabel = assignedIds.length === 0
        ? 'All staff (facility queue)'
        : assignedIds.map((id) => employeeNameById[id] || 'Employee').join(', ');
      return (
        <article key={category.id} style={{ ...styles.taskCard, ...(category.is_active === false ? styles.categoryInactive : {}) }}>
          <div style={styles.taskHeader}>
            <div>
              <h3 style={styles.taskTitle}>{category.name}</h3>
              {category.description && <p style={styles.taskDescription}>{category.description}</p>}
              <p style={styles.taskMeta}>Kiosk access: {assignedLabel}</p>
              {!category.kiosk_checklist_button && category.location_sensitivity && category.location_sensitivity !== 'none' && (
                <p style={styles.taskMeta}>Queue zone: {locationSensitivityLabel(category.location_sensitivity)}</p>
              )}
              {category.kiosk_checklist_button && (
                <>
                  <p style={styles.taskMeta}>Kiosk button: {category.kiosk_button_label?.trim() || category.name}</p>
                  <p style={styles.taskMeta}>
                    Window: {dbTimeToInput(category.checklist_window_start) || '—'} – {dbTimeToInput(category.checklist_window_end) || '—'}
                  </p>
                </>
              )}
            </div>
            {category.is_active === false && <Badge label="inactive" />}
          </div>
          {category.is_active !== false ? (
            <div style={styles.cardActions}>
              <button type="button" style={styles.secondaryButton} onClick={() => onEdit(category)}>Edit</button>
              <button type="button" style={styles.secondaryButton} onClick={() => onDeactivate(category)}>Deactivate</button>
            </div>
          ) : onReactivate && (
            <div style={styles.cardActions}>
              <button type="button" style={styles.primaryButtonSmall} onClick={() => onReactivate(category)}>Reactivate</button>
              <button type="button" style={styles.secondaryButton} onClick={() => onEdit(category)}>Edit</button>
            </div>
          )}
        </article>
      );
    })}
  </div>
);

const PHOTO_REQUIREMENT_OPTIONS = [
  { value: 'always', label: 'Require photo every time' },
  { value: 'random', label: 'Randomly require photo' },
  { value: 'never', label: 'Do not require photo' }
];

const CheckboxRow = ({ form, setForm }) => (
  <div style={styles.checkboxGrid}>
    <fieldset style={styles.photoRequirementFieldset}>
      <legend style={styles.photoRequirementLegend}>Completion photo</legend>
      {PHOTO_REQUIREMENT_OPTIONS.map((option) => (
        <label key={option.value} style={styles.photoRequirementOption}>
          <input
            type="radio"
            name="task-photo-requirement-mode"
            value={option.value}
            checked={(form.photo_requirement_mode || 'never') === option.value}
            onChange={() => setForm({
              ...form,
              photo_requirement_mode: option.value,
              requires_photo: option.value === 'always'
            })}
          />
          <span>{option.label}</span>
        </label>
      ))}
      {(form.photo_requirement_mode || 'never') === 'random' && (
        <p style={styles.hintText}>Uses the same staff weighting as peer review — newer employees are asked for photos more often. Configure rates under the Reviews tab.</p>
      )}
    </fieldset>
    <TavariCheckbox
      id="task-requires-notes"
      checked={form.requires_notes}
      onChange={(checked) => setForm({ ...form, requires_notes: checked })}
      label="Require notes"
    />
    <TavariCheckbox
      id="task-peer-review-required"
      checked={form.peer_review_required}
      onChange={(checked) => setForm({ ...form, peer_review_required: checked })}
      label="Require peer review (kiosk pool)"
    />
    {form.peer_review_required && (
      <p style={styles.hintText}>When another employee reviews this work on the kiosk, they must upload a verification photo. Completion photos follow the setting above.</p>
    )}
  </div>
);

const TaskSearchBar = ({
  id,
  value,
  onChange,
  filteredCount,
  totalCount,
  metaLabel = 'tasks',
  placeholder = 'Search by title, category, description, priority…'
}) => {
  const query = value.trim().toLowerCase();
  return (
    <div style={styles.overviewSearchRow}>
      <label style={styles.overviewSearchLabel} htmlFor={id}>
        <FiSearch aria-hidden="true" />
        <span>Search tasks</span>
      </label>
      <div style={styles.overviewSearchInputWrap}>
        <input
          id={id}
          type="search"
          style={styles.overviewSearchInput}
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        {value && (
          <button
            type="button"
            style={styles.overviewSearchClear}
            onClick={() => onChange('')}
            aria-label="Clear search"
          >
            <FiX />
          </button>
        )}
      </div>
      {query && filteredCount != null && totalCount != null && (
        <p style={styles.overviewSearchMeta}>
          Showing {filteredCount} of {totalCount} {metaLabel}
        </p>
      )}
    </div>
  );
};

const TaskList = ({
  tasks,
  employeeNameById,
  categoryNameById,
  businessTimezone = 'America/Toronto',
  onStatusChange,
  onEdit,
  onDelete,
  editingTaskId = null,
  title = 'Recent Tasks',
  description = 'Assigned tasks are private to the employee and managers. Facility tasks appear in the kiosk queue one at a time.',
  emptyText,
  searchValue,
  onSearchChange,
  searchInputId = 'task-list-search',
  searchTotalCount,
  searchMetaLabel = 'tasks',
  showSignOff = false,
  employees = [],
  onSignOff,
  signingOffTaskId = null
}) => {
  const [signOffDrafts, setSignOffDrafts] = useState({});

  const updateSignOffDraft = (taskId, patch) => {
    setSignOffDrafts((prev) => ({
      ...prev,
      [taskId]: { employeeId: '', notes: '', ...(prev[taskId] || {}), ...patch }
    }));
  };

  return (
  <Panel title={title} description={description}>
    {onSearchChange && (
      <TaskSearchBar
        id={searchInputId}
        value={searchValue || ''}
        onChange={onSearchChange}
        filteredCount={tasks.length}
        totalCount={searchTotalCount}
        metaLabel={searchMetaLabel}
      />
    )}
    <div style={styles.list}>
      {tasks.length === 0 ? (
        <EmptyState text={emptyText || (showSignOff ? 'No open due tasks right now.' : 'No tasks yet. Create a task or set up a recurring schedule to start.')} />
      ) : tasks.map((task) => {
        const isEditing = editingTaskId === task.id;
        const draft = signOffDrafts[task.id] || { employeeId: '', notes: '' };
        const isSigningOff = signingOffTaskId === task.id;
        return (
        <article key={task.id} style={{ ...styles.taskCard, ...(isEditing ? styles.taskCardEditing : null) }}>
          <div style={styles.taskHeader}>
            <div>
              <h3 style={styles.taskTitle}>{task.title}</h3>
              <p style={styles.taskMeta}>
                {categoryNameById[task.category_id] || task.category || 'Uncategorized'}
                {' • '}
                {task.assignment_scope === 'assigned' ? `Assigned to ${employeeNameById[task.assigned_to] || 'Employee'}` : 'Facility queue'}
                {' • '}
                {formatDueScheduleLabel(task, businessTimezone)}
                {task.claimed_by && task.status === 'in_progress' ? ` • Claimed by ${employeeNameById[task.claimed_by] || 'Staff'}` : ''}
              </p>
            </div>
            <div style={styles.badgeRow}>
              <Badge label={task.priority} tone={priorityTone(task.priority)} />
              <Badge label={task.status.replace('_', ' ')} tone={task.status === 'incomplete' ? 'danger' : 'default'} />
              {task.review_status !== 'not_required' && <Badge label={task.review_status.replace('_', ' ')} tone="warning" />}
            </div>
          </div>
          {task.description && <p style={styles.taskDescription}>{task.description}</p>}
          {showSignOff ? (
            <div style={styles.signOffRow}>
              <label style={styles.signOffField}>
                <span style={styles.signOffLabel}>Completed by</span>
                <select
                  style={styles.signOffSelect}
                  value={draft.employeeId}
                  onChange={(e) => updateSignOffDraft(task.id, { employeeId: e.target.value })}
                  disabled={isSigningOff}
                >
                  <option value="">Select staff member…</option>
                  {employees.map((employee) => (
                    <option key={employee.id} value={employee.id}>
                      {employeeNameById[employee.id] || employee.email || 'Employee'}
                    </option>
                  ))}
                </select>
              </label>
              <label style={styles.signOffField}>
                <span style={styles.signOffLabel}>Note (optional)</span>
                <input
                  type="text"
                  style={styles.signOffInput}
                  placeholder="e.g. Done on night shift, no kiosk sign-off"
                  value={draft.notes}
                  onChange={(e) => updateSignOffDraft(task.id, { notes: e.target.value })}
                  disabled={isSigningOff}
                />
              </label>
              <div style={styles.signOffActions}>
                {onEdit && <button type="button" style={styles.secondaryButton} onClick={() => onEdit(task)} disabled={isSigningOff}>Edit</button>}
                <button
                  type="button"
                  style={styles.primaryButtonSmall}
                  disabled={isSigningOff || !draft.employeeId}
                  onClick={() => onSignOff?.(task, draft.employeeId, draft.notes)}
                >
                  {isSigningOff ? 'Saving…' : 'Mark complete'}
                </button>
              </div>
            </div>
          ) : (
            <div style={styles.cardActions}>
              {onEdit && <button type="button" style={styles.secondaryButton} onClick={() => onEdit(task)}>Edit</button>}
              {onDelete && <button type="button" style={styles.dangerButton} onClick={() => onDelete(task)}>Delete</button>}
              {onStatusChange && task.status !== 'done' && <button type="button" style={styles.secondaryButton} onClick={() => onStatusChange(task, 'blocked')}>Block</button>}
              {onStatusChange && task.status !== 'done' && task.status !== 'cancelled' && <button type="button" style={styles.secondaryButton} onClick={() => onStatusChange(task, 'cancelled')}>Cancel</button>}
              {onStatusChange && task.status === 'blocked' && <button type="button" style={styles.primaryButtonSmall} onClick={() => onStatusChange(task, 'to_do')}>Reopen</button>}
            </div>
          )}
        </article>
        );
      })}
    </div>
  </Panel>
  );
};

const QUICK_VIEW_STATUS_LABELS = {
  today_priority: "Today's task",
  overdue: 'Overdue',
  not_completed: 'Not completed'
};

const TaskQuickViewModal = ({
  open,
  onClose,
  loading,
  rows,
  activeTab,
  onTabChange,
  onRefresh,
  assignedEmployees,
  employeeNameById,
  businessTimezone
}) => {
  if (!open) return null;

  const tabs = [
    { id: 'facility', label: 'Facility queue' },
    ...assignedEmployees.map((employee) => ({
      id: employee.id,
      label: employeeNameById[employee.id] || employee.email || 'Employee'
    }))
  ];

  return (
    <div style={styles.modalOverlay} onClick={onClose} role="presentation">
      <div
        style={styles.quickViewModal}
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Task quick view"
      >
        <div style={styles.quickViewHeader}>
          <div>
            <h2 style={styles.quickViewTitle}>Quick View</h2>
            <p style={styles.quickViewSubtitle}>
              Open tasks in kiosk order. The next task on the tablet appears at the top.
            </p>
          </div>
          <button type="button" style={styles.modalCloseButton} onClick={onClose} aria-label="Close">
            <FiX />
          </button>
        </div>

        <div style={styles.quickViewTabs}>
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              style={{
                ...styles.quickViewTab,
                ...(activeTab === tab.id ? styles.quickViewTabActive : null)
              }}
              onClick={() => onTabChange(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div style={styles.quickViewBody}>
          {loading ? (
            <p style={styles.hintText}>Loading kiosk queue…</p>
          ) : rows.length === 0 ? (
            <EmptyState text="No open tasks in this queue right now." />
          ) : (
            <div style={styles.quickViewList}>
              {rows.map((row) => (
                <article
                  key={row.task_id}
                  style={{
                    ...styles.quickViewRow,
                    ...(row.queue_position === 1 ? styles.quickViewRowNext : null)
                  }}
                >
                  <div style={styles.quickViewRowMain}>
                    <div style={styles.quickViewRowTitleWrap}>
                      {row.queue_position === 1 && <span style={styles.quickViewNextBadge}>Next on kiosk</span>}
                      <h3 style={styles.quickViewRowTitle}>{row.title}</h3>
                    </div>
                    <Badge
                      label={QUICK_VIEW_STATUS_LABELS[row.status_flag] || 'Not completed'}
                      tone={row.status_flag === 'overdue' ? 'danger' : row.status_flag === 'today_priority' ? 'success' : 'default'}
                    />
                  </div>
                  <p style={styles.quickViewRowMeta}>
                    #{row.queue_position}
                    {row.category ? ` • ${row.category}` : ''}
                    {row.priority ? ` • ${row.priority} priority` : ''}
                    {' • Last completed: '}
                    {row.last_completed_at
                      ? formatZonedDateTime(row.last_completed_at, businessTimezone)
                      : '---'}
                  </p>
                </article>
              ))}
            </div>
          )}
        </div>

        <div style={styles.quickViewFooter}>
          <button type="button" style={styles.secondaryButton} onClick={onRefresh} disabled={loading}>
            Refresh
          </button>
          <button type="button" style={styles.primaryButtonSmall} onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

const PEER_REVIEW_OUTCOME_LABELS = {
  approved: 'Approved — completed',
  not_completed: 'Flagged — not completed',
  redo_required: 'Flagged — redo required'
};

const PeerReviewHistoryList = ({ submissions, tasks, employeeNameById }) => {
  const taskById = Object.fromEntries(tasks.map((task) => [task.id, task]));
  return (
    <Panel title="Peer Review History" description="Completed kiosk peer reviews submitted by staff. Pending items wait in the pool until another employee reviews them on login.">
      <div style={styles.list}>
        {submissions.length === 0 ? (
          <EmptyState text="No peer reviews submitted yet." />
        ) : submissions.map((submission) => {
          const task = taskById[submission.task_id];
          const photoUrl = submission.verification_evidence?.photo_data_url || submission.verification_evidence?.photo_url;
          return (
            <article key={submission.id} style={styles.taskCard}>
              <div style={styles.taskHeader}>
                <div>
                  <h3 style={styles.taskTitle}>{task?.title || submission.task_id}</h3>
                  <p style={styles.taskMeta}>
                    Reviewer: {employeeNameById[submission.reviewer_id] || 'Staff'} •
                    Completed by: {employeeNameById[submission.completer_id] || 'Staff'} •
                    {formatDateTime(submission.created_at)}
                  </p>
                </div>
                <Badge label={PEER_REVIEW_OUTCOME_LABELS[submission.outcome] || submission.outcome} tone={submission.outcome === 'approved' ? 'success' : 'danger'} />
              </div>
              {submission.notes && <p style={styles.taskDescription}>{submission.notes}</p>}
              {photoUrl && (
                <p style={styles.taskMeta}>
                  <a href={photoUrl} target="_blank" rel="noreferrer">View verification photo</a>
                </p>
              )}
            </article>
          );
        })}
      </div>
    </Panel>
  );
};

const TaskManagerSettingsTab = ({
  checklistAlertSettings,
  setChecklistAlertSettings,
  checklistAlertRecipients,
  onToggleChecklistAlertRecipient,
  queueSettings,
  setQueueSettings,
  facilityBusySignals,
  categories,
  employees,
  employeeNameById,
  saving,
  onSaveChecklistAlertSettings,
  onSaveQueueSettings
}) => {
  const checklistCategories = (categories || []).filter(
    (category) => category.kiosk_checklist_button && category.checklist_window_start && category.checklist_window_end
  );

  return (
    <div style={styles.settingsStack}>
      <Panel
        title="Sales-aware task queue"
        description="The kiosk reorders open tasks using live POS admissions and kitchen orders. Tag each category under Categories with a location sensitivity."
      >
        {facilityBusySignals && (
          <div style={styles.facilityBusyCard}>
            <strong>Current traffic snapshot</strong>
            <p style={styles.taskMeta}>
              Admissions/check-ins ({facilityBusySignals.admission_lookback_minutes} min): {facilityBusySignals.admission_activity_count ?? 0}
              {facilityBusySignals.play_area_busy ? ' · Play area busy' : facilityBusySignals.play_area_slow ? ' · Play area slow' : ''}
            </p>
            <p style={styles.taskMeta}>
              Kitchen orders ({facilityBusySignals.kitchen_lookback_minutes} min): {facilityBusySignals.kitchen_order_count ?? 0}
              {facilityBusySignals.kitchen_busy ? ' · Kitchen busy' : facilityBusySignals.kitchen_slow ? ' · Kitchen slow' : ''}
            </p>
          </div>
        )}
        <form onSubmit={onSaveQueueSettings} style={styles.form}>
          <TavariCheckbox
            id="sales-aware-queue-enabled"
            checked={queueSettings.sales_aware_queue_enabled !== false}
            onChange={(checked) => setQueueSettings({ ...queueSettings, sales_aware_queue_enabled: checked })}
            label="Use sales-aware queue ordering on the kiosk"
          />
          <div style={styles.formGrid}>
            <label style={styles.field}>
              <span style={styles.label}>Admission lookback (minutes)</span>
              <input type="number" min="15" max="720" value={queueSettings.admission_lookback_minutes} onChange={(e) => setQueueSettings({ ...queueSettings, admission_lookback_minutes: e.target.value })} style={styles.input} />
            </label>
            <label style={styles.field}>
              <span style={styles.label}>Kitchen lookback (minutes)</span>
              <input type="number" min="5" max="240" value={queueSettings.kitchen_lookback_minutes} onChange={(e) => setQueueSettings({ ...queueSettings, kitchen_lookback_minutes: e.target.value })} style={styles.input} />
            </label>
            <label style={styles.field}>
              <span style={styles.label}>Play area busy threshold</span>
              <input type="number" min="1" max="500" value={queueSettings.admission_busy_threshold} onChange={(e) => setQueueSettings({ ...queueSettings, admission_busy_threshold: e.target.value })} style={styles.input} />
            </label>
            <label style={styles.field}>
              <span style={styles.label}>Kitchen busy threshold</span>
              <input type="number" min="1" max="500" value={queueSettings.kitchen_busy_threshold} onChange={(e) => setQueueSettings({ ...queueSettings, kitchen_busy_threshold: e.target.value })} style={styles.input} />
            </label>
            <label style={styles.field}>
              <span style={styles.label}>Play area slow threshold</span>
              <input type="number" min="0" max="500" value={queueSettings.admission_slow_threshold} onChange={(e) => setQueueSettings({ ...queueSettings, admission_slow_threshold: e.target.value })} style={styles.input} />
            </label>
            <label style={styles.field}>
              <span style={styles.label}>Kitchen slow threshold</span>
              <input type="number" min="0" max="500" value={queueSettings.kitchen_slow_threshold} onChange={(e) => setQueueSettings({ ...queueSettings, kitchen_slow_threshold: e.target.value })} style={styles.input} />
            </label>
          </div>
          <p style={styles.hintText}>
            When admissions or check-ins exceed the busy threshold, customer/play-area tasks move down the queue. When below the slow threshold, those tasks move up. Kitchen categories behave the same way using food orders.
          </p>
          <button type="submit" style={styles.primaryButton} disabled={saving}>Save queue settings</button>
        </form>
      </Panel>
      <Panel
        title="Checklist incomplete alerts"
        description="Email selected managers when a kiosk checklist still has open items before its window closes. Alerts send once per checklist per business day."
      >
        <form onSubmit={onSaveChecklistAlertSettings} style={styles.form}>
          <TavariCheckbox
            id="checklist-alerts-enabled"
            checked={checklistAlertSettings.enabled !== false}
            onChange={(checked) => setChecklistAlertSettings({ ...checklistAlertSettings, enabled: checked })}
            label="Send checklist incomplete alerts"
          />
          <label style={styles.field}>
            <span style={styles.label}>Minutes before window closes</span>
            <input
              type="number"
              min="5"
              max="480"
              value={checklistAlertSettings.minutes_before_close}
              onChange={(e) => setChecklistAlertSettings({
                ...checklistAlertSettings,
                minutes_before_close: e.target.value
              })}
              style={styles.input}
            />
          </label>
          <p style={styles.hintText}>
            Example: with 60 minutes, opening checklist (closes 2:00 PM) alerts at 1:00 PM if items remain incomplete.
          </p>

          {checklistCategories.length === 0 ? (
            <EmptyState text="Create a kiosk checklist category with an available window to configure alert recipients." />
          ) : (
            <div style={styles.checklistAlertRecipientGrid}>
              {checklistCategories.map((category) => (
                <div key={category.id} style={styles.checklistAlertCategoryCard}>
                  <div style={styles.checklistAlertCategoryHeader}>
                    <strong>{category.kiosk_button_label || category.name}</strong>
                    <span style={styles.taskMeta}>
                      {dbTimeToInput(category.checklist_window_start)} – {dbTimeToInput(category.checklist_window_end)}
                    </span>
                  </div>
                  <div style={styles.checklistAlertRecipientList}>
                    {employees.map((employee) => {
                      const checked = checklistAlertRecipients.some(
                        (row) => row.category_id === category.id && row.employee_id === employee.id
                      );
                      return (
                        <TavariCheckbox
                          key={`${category.id}-${employee.id}`}
                          id={`checklist-alert-recipient-${category.id}-${employee.id}`}
                          checked={checked}
                          onChange={() => onToggleChecklistAlertRecipient(category.id, employee.id)}
                          label={`${employeeNameById[employee.id] || employee.full_name || employee.email}${employee.email ? ` (${employee.email})` : ''}`}
                          style={styles.checklistAlertRecipientOption}
                        />
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}

          <button type="submit" style={styles.primaryButton} disabled={saving}>Save alert settings</button>
        </form>
      </Panel>
      <ModuleSettingsTabContent moduleKey="tasks" />
    </div>
  );
};

const PeerReviewSettingsPanel = ({
  settings,
  setSettings,
  weights,
  employees,
  employeeNameById,
  saving,
  onSaveSettings,
  onSaveWeight,
  onDeleteWeight
}) => {
  const [weightForm, setWeightForm] = React.useState({
    employeeId: '',
    sampleRate: '0.25',
    expiresAt: '',
    reason: ''
  });

  return (
    <Panel title="Peer Review Settings" description="Configure how many reviews staff do at kiosk login and what percentage of each employee&apos;s completed tasks enter the review pool.">
      <form onSubmit={onSaveSettings} style={styles.form}>
        <label style={styles.field}>
          <span style={styles.label}>Reviews per login</span>
          <input
            type="number"
            min="0"
            max="20"
            value={settings.reviews_per_login}
            onChange={(e) => setSettings({ ...settings, reviews_per_login: e.target.value })}
            style={styles.input}
          />
        </label>
        <label style={styles.field}>
          <span style={styles.label}>New hire sample rate (0–1)</span>
          <input
            type="number"
            min="0"
            max="1"
            step="0.01"
            value={settings.new_hire_sample_rate}
            onChange={(e) => setSettings({ ...settings, new_hire_sample_rate: e.target.value })}
            style={styles.input}
          />
        </label>
        <label style={styles.field}>
          <span style={styles.label}>Experienced staff sample rate (0–1)</span>
          <input
            type="number"
            min="0"
            max="1"
            step="0.01"
            value={settings.experienced_sample_rate}
            onChange={(e) => setSettings({ ...settings, experienced_sample_rate: e.target.value })}
            style={styles.input}
          />
        </label>
        <label style={styles.field}>
          <span style={styles.label}>New hire period (days)</span>
          <input
            type="number"
            min="0"
            value={settings.new_hire_days}
            onChange={(e) => setSettings({ ...settings, new_hire_days: e.target.value })}
            style={styles.input}
          />
        </label>
        <button type="submit" style={styles.primaryButton} disabled={saving}>Save settings</button>
      </form>

      <div style={{ marginTop: 24 }}>
        <h3 style={styles.panelTitle}>Employee weight overrides</h3>
        <p style={styles.panelDescription}>Raise or lower how often a specific employee&apos;s completions enter the peer review pool. Leave expiry blank for indefinite.</p>
        <div style={styles.form}>
          <label style={styles.field}>
            <span style={styles.label}>Employee</span>
            <select
              value={weightForm.employeeId}
              onChange={(e) => setWeightForm({ ...weightForm, employeeId: e.target.value })}
              style={styles.input}
            >
              <option value="">Select employee</option>
              {employees.map((employee) => (
                <option key={employee.id} value={employee.id}>{employeeNameById[employee.id]}</option>
              ))}
            </select>
          </label>
          <label style={styles.field}>
            <span style={styles.label}>Sample rate (0–1)</span>
            <input
              type="number"
              min="0"
              max="1"
              step="0.01"
              value={weightForm.sampleRate}
              onChange={(e) => setWeightForm({ ...weightForm, sampleRate: e.target.value })}
              style={styles.input}
            />
          </label>
          <label style={styles.field}>
            <span style={styles.label}>Expires (optional)</span>
            <input
              type="datetime-local"
              value={weightForm.expiresAt}
              onChange={(e) => setWeightForm({ ...weightForm, expiresAt: e.target.value })}
              style={styles.input}
            />
          </label>
          <label style={styles.field}>
            <span style={styles.label}>Reason</span>
            <input
              type="text"
              value={weightForm.reason}
              onChange={(e) => setWeightForm({ ...weightForm, reason: e.target.value })}
              style={styles.input}
            />
          </label>
          <button
            type="button"
            style={styles.secondaryButton}
            disabled={saving}
            onClick={() => onSaveWeight({
              employeeId: weightForm.employeeId,
              sampleRate: weightForm.sampleRate,
              expiresAt: weightForm.expiresAt ? new Date(weightForm.expiresAt).toISOString() : null,
              reason: weightForm.reason
            })}
          >
            Save employee override
          </button>
        </div>
        {weights.length > 0 && (
          <div style={{ ...styles.list, marginTop: 16 }}>
            {weights.map((weight) => (
              <article key={weight.id} style={styles.taskCard}>
                <div style={styles.taskHeader}>
                  <div>
                    <h3 style={styles.taskTitle}>{employeeNameById[weight.employee_id] || 'Employee'}</h3>
                    <p style={styles.taskMeta}>
                      Rate: {(Number(weight.sample_rate) * 100).toFixed(0)}%
                      {weight.expires_at ? ` • until ${formatDateTime(weight.expires_at)}` : ' • indefinite'}
                      {weight.reason ? ` • ${weight.reason}` : ''}
                    </p>
                  </div>
                  <button type="button" style={styles.secondaryButton} onClick={() => onDeleteWeight(weight.id)}>Remove</button>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </Panel>
  );
};

const TodayTaskForm = ({ form, setForm, categories, onSubmit, saving, editing = false, onCancel }) => (
  <form style={styles.form} onSubmit={onSubmit}>
    <label style={styles.field}>
      <span style={styles.label}>Task *</span>
      <input
        style={styles.input}
        value={form.title}
        onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))}
        placeholder="e.g. Restock napkins at front desk"
        required
      />
    </label>
    <label style={styles.field}>
      <span style={styles.label}>Details (optional)</span>
      <textarea
        style={styles.textarea}
        value={form.description}
        onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))}
        placeholder="Extra context for staff"
      />
    </label>
    <label style={styles.field}>
      <span style={styles.label}>Instructions for kiosk (optional)</span>
      <textarea
        style={styles.textarea}
        value={form.instructions}
        onChange={(event) => setForm((prev) => ({ ...prev, instructions: event.target.value }))}
        placeholder="Shown to staff when they open the task"
      />
    </label>
    <div style={styles.formGrid}>
      <label style={styles.field}>
        <span style={styles.label}>Category (optional)</span>
        <select
          style={styles.input}
          value={form.category_id}
          onChange={(event) => setForm((prev) => ({ ...prev, category_id: event.target.value }))}
        >
          <option value="">General — any staff</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>{category.name}</option>
          ))}
        </select>
      </label>
      <label style={styles.field}>
        <span style={styles.label}>Priority</span>
        <select
          style={styles.input}
          value={form.priority}
          onChange={(event) => setForm((prev) => ({ ...prev, priority: event.target.value }))}
        >
          <option value="urgent">Urgent</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
      </label>
    </div>
    <div style={styles.checkboxGrid}>
      <TavariCheckbox
        id="today-task-requires-photo"
        checked={form.requires_photo}
        onChange={(checked) => setForm((prev) => ({ ...prev, requires_photo: checked }))}
        label="Require photo on kiosk"
      />
      <TavariCheckbox
        id="today-task-requires-notes"
        checked={form.requires_notes}
        onChange={(checked) => setForm((prev) => ({ ...prev, requires_notes: checked }))}
        label="Require completion notes on kiosk"
      />
    </div>
    <div style={styles.formActions}>
      {editing && onCancel && (
        <button type="button" style={styles.secondaryButton} onClick={onCancel} disabled={saving}>
          Cancel edit
        </button>
      )}
      <button type="submit" style={styles.primaryButton} disabled={saving}>
        {saving ? 'Saving…' : editing ? 'Save changes' : 'Add to tonight\'s list'}
      </button>
    </div>
  </form>
);

const TodayTaskCompletionModal = ({
  task,
  employeeNameById,
  categoryNameById,
  businessTimezone,
  onClose
}) => {
  if (!task) return null;
  const photoUrl = getTaskCompletionPhotoUrl(task);
  const notes = task.completion_summary?.notes;

  return (
    <div style={styles.statDetailOverlay} role="dialog" aria-modal="true" aria-labelledby="today-task-completion-title">
      <button type="button" style={styles.statDetailBackdrop} aria-label="Close" onClick={onClose} />
      <section style={styles.statDetailPanel}>
        <div style={styles.statDetailHeader}>
          <div>
            <h2 id="today-task-completion-title" style={styles.statDetailTitle}>{task.title}</h2>
            <p style={styles.statDetailDescription}>
              Completed by {employeeNameById[task.completed_by] || 'Staff'}
              {' • '}
              {formatDateTime(task.completed_at)}
              {task.category_id ? ` • ${categoryNameById[task.category_id] || task.category}` : ''}
            </p>
          </div>
          <button type="button" style={styles.statDetailClose} onClick={onClose} aria-label="Close">
            <FiX size={20} />
          </button>
        </div>
        <div style={styles.statDetailList}>
          {task.description && (
            <div style={styles.taskCard}>
              <h3 style={styles.subTitle}>Details</h3>
              <p style={styles.taskDescription}>{task.description}</p>
            </div>
          )}
          {task.instructions && (
            <div style={styles.taskCard}>
              <h3 style={styles.subTitle}>Kiosk instructions</h3>
              <p style={styles.taskDescription}>{task.instructions}</p>
            </div>
          )}
          <div style={styles.taskCard}>
            <h3 style={styles.subTitle}>Completion notes</h3>
            {notes ? (
              <p style={styles.taskDescription}>{notes}</p>
            ) : (
              <p style={styles.taskMeta}>No notes were recorded.</p>
            )}
          </div>
          <div style={styles.taskCard}>
            <h3 style={styles.subTitle}>Completion photo</h3>
            {photoUrl ? (
              <>
                <img src={photoUrl} alt="Task completion" style={styles.completionPhoto} />
                <p style={styles.taskMeta}>
                  <a href={photoUrl} target="_blank" rel="noreferrer">Open full size</a>
                </p>
              </>
            ) : (
              <p style={styles.taskMeta}>No photo was recorded.</p>
            )}
          </div>
        </div>
      </section>
    </div>
  );
};

const Panel = ({ title, description, action, children }) => (
  <section style={styles.panel}>
    <div style={styles.panelHeader}>
      <div style={styles.panelHeaderRow}>
        <div>
          <h2 style={styles.panelTitle}>{title}</h2>
          {description && <p style={styles.panelDescription}>{description}</p>}
        </div>
        {action}
      </div>
    </div>
    {children}
  </section>
);

const OVERVIEW_STAT_META = {
  open: {
    title: 'Open Tasks',
    description: 'Tasks available now that are not yet completed.',
    empty: 'No open tasks right now.'
  },
  overdue: {
    title: 'Overdue Tasks',
    description: 'Open tasks past their due time.',
    empty: 'No overdue tasks.'
  },
  incomplete: {
    title: 'Incomplete (audit)',
    description: 'Tasks flagged incomplete during audit or peer review.',
    empty: 'No incomplete tasks.'
  },
  completedToday: {
    title: 'Completed Today',
    description: 'Tasks completed today in the business timezone, with who completed them.',
    empty: 'No tasks completed yet today.'
  },
  pendingReviews: {
    title: 'Pending Peer Reviews',
    description: 'Completed work waiting for another staff member to verify on the kiosk.',
    empty: 'No peer reviews waiting in the pool.'
  },
  peerReviewsToday: {
    title: 'Peer Reviews Today',
    description: 'Peer reviews submitted by staff today.',
    empty: 'No peer reviews submitted yet today.'
  }
};

const OverviewStatDetailModal = ({
  statKey,
  items,
  employeeNameById,
  categoryNameById,
  taskTitleById,
  businessTimezone,
  onClose
}) => {
  const meta = OVERVIEW_STAT_META[statKey] || { title: 'Details', description: '', empty: 'Nothing to show.' };

  const renderRow = (item) => {
    if (statKey === 'pendingReviews') {
      return (
        <article key={item.id} style={styles.taskCard}>
          <h3 style={styles.taskTitle}>{item.task_title}</h3>
          <p style={styles.taskMeta}>
            Completed by {employeeNameById[item.completer_id] || 'Staff'}
            {' • '}
            Added {formatDateTime(item.added_at)}
            {item.times_peer_reviewed ? ` • Reviewed ${item.times_peer_reviewed} time(s) before` : ''}
          </p>
        </article>
      );
    }

    if (statKey === 'peerReviewsToday') {
      const photoUrl = item.verification_evidence?.photo_data_url || item.verification_evidence?.photo_url;
      return (
        <article key={item.id} style={styles.taskCard}>
          <div style={styles.taskHeader}>
            <div>
              <h3 style={styles.taskTitle}>{taskTitleById[item.task_id] || 'Task'}</h3>
              <p style={styles.taskMeta}>
                Reviewer: {employeeNameById[item.reviewer_id] || 'Staff'}
                {' • '}
                Original completer: {employeeNameById[item.completer_id] || 'Staff'}
                {' • '}
                {formatDateTime(item.created_at)}
              </p>
            </div>
            <Badge label={PEER_REVIEW_OUTCOME_LABELS[item.outcome] || item.outcome} tone={item.outcome === 'approved' ? 'success' : 'danger'} />
          </div>
          {item.notes && <p style={styles.taskDescription}>{item.notes}</p>}
          {photoUrl && (
            <p style={styles.taskMeta}>
              <a href={photoUrl} target="_blank" rel="noreferrer">View verification photo</a>
            </p>
          )}
        </article>
      );
    }

    const task = item;
    const completedById = task.completed_by || task.claimed_by;
    const whoLabel = statKey === 'completedToday'
      ? `Completed by ${employeeNameById[completedById] || 'Unknown'}`
      : task.assignment_scope === 'assigned'
        ? `Assigned to ${employeeNameById[task.assigned_to] || 'Employee'}`
        : 'Facility queue';
    const whenLabel = statKey === 'completedToday' && task.completed_at
      ? formatDateTime(task.completed_at)
      : task.due_at
        ? `Due ${formatZonedDateTime(task.due_at, businessTimezone)}`
        : formatDueScheduleLabel(task, businessTimezone);

    return (
      <article key={task.id} style={styles.taskCard}>
        <div style={styles.taskHeader}>
          <div>
            <h3 style={styles.taskTitle}>{task.title}</h3>
            <p style={styles.taskMeta}>
              {categoryNameById[task.category_id] || task.category || 'Uncategorized'}
              {' • '}
              {whoLabel}
              {' • '}
              {whenLabel}
            </p>
          </div>
          <div style={styles.badgeRow}>
            <Badge label={task.priority} tone={priorityTone(task.priority)} />
            <Badge label={task.status.replace('_', ' ')} tone={task.status === 'incomplete' ? 'danger' : 'default'} />
          </div>
        </div>
        {task.description && <p style={styles.taskDescription}>{task.description}</p>}
      </article>
    );
  };

  return (
    <div style={styles.statDetailOverlay} role="dialog" aria-modal="true" aria-labelledby="overview-stat-detail-title">
      <button type="button" style={styles.statDetailBackdrop} aria-label="Close" onClick={onClose} />
      <section style={styles.statDetailPanel}>
        <div style={styles.statDetailHeader}>
          <div>
            <h2 id="overview-stat-detail-title" style={styles.statDetailTitle}>{meta.title}</h2>
            <p style={styles.statDetailDescription}>{meta.description}</p>
            <p style={styles.statDetailCount}>{items.length} item{items.length === 1 ? '' : 's'}</p>
          </div>
          <button type="button" style={styles.statDetailClose} onClick={onClose} aria-label="Close">
            <FiX size={20} />
          </button>
        </div>
        <div style={styles.statDetailList}>
          {items.length === 0 ? (
            <EmptyState text={meta.empty} />
          ) : items.map(renderRow)}
        </div>
      </section>
    </div>
  );
};

const StatCard = ({ label, value, tone = 'default', onClick }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={!onClick}
    style={{
      ...styles.statCard,
      ...(tone === 'danger' ? styles.statDanger : tone === 'warning' ? styles.statWarning : {}),
      ...(onClick ? styles.statCardClickable : styles.statCardStatic),
      textAlign: 'left',
      width: '100%'
    }}
  >
    <div style={styles.statValue}>{value}</div>
    <div style={styles.statLabel}>{label}</div>
    {onClick ? <div style={styles.statHint}>Tap to view details</div> : null}
  </button>
);

const TextInput = ({ label, value, onChange, type = 'text', required = false, placeholder = '', step }) => (
  <label style={styles.field}>
    <span style={styles.label}>{label}</span>
    <input
      type={type}
      required={required}
      value={value}
      step={step}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
      style={styles.input}
    />
  </label>
);

const TextArea = ({ label, value, onChange }) => (
  <label style={styles.field}>
    <span style={styles.label}>{label}</span>
    <textarea value={value} onChange={(event) => onChange(event.target.value)} style={styles.textarea} />
  </label>
);

const Select = ({ label, value, onChange, options, required = false }) => (
  <label style={styles.field}>
    <span style={styles.label}>{label}</span>
    <select required={required} value={value} onChange={(event) => onChange(event.target.value)} style={styles.input}>
      {options.map((option) => (
        <option key={option.value} value={option.value}>{option.label}</option>
      ))}
    </select>
  </label>
);

const Badge = ({ label, tone = 'default' }) => (
  <span style={{ ...styles.badge, ...(tone === 'danger' ? styles.badgeDanger : tone === 'warning' ? styles.badgeWarning : tone === 'success' ? styles.badgeSuccess : {}) }}>
    {label}
  </span>
);

const EmptyState = ({ text }) => <p style={styles.emptyText}>{text}</p>;

const LoadingState = ({ label }) => (
  <div style={styles.centered}>
    <div style={styles.spinner} />
    <p style={styles.centerText}>{label}</p>
  </div>
);

const ErrorState = ({ message }) => (
  <div style={styles.centered}>
    <h1 style={styles.errorTitle}>Task Manager</h1>
    <p style={styles.centerText}>{message}</p>
  </div>
);

const optionalText = (value) => {
  const text = String(value || '').trim();
  return text || null;
};

const parseChecklist = (value) => String(value || '')
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean)
  .map((label, index) => ({ id: `item-${index + 1}`, label }));

const employeeOptions = (employees) => [
  { value: '', label: 'Choose employee' },
  ...employees.map((employee) => ({
    value: employee.id,
    label: employee.full_name || [employee.first_name, employee.last_name].filter(Boolean).join(' ') || employee.email || 'Employee'
  }))
];

const categoryOptions = (categories) => [
  { value: '', label: 'Choose category' },
  ...categories.map((category) => ({ value: category.id, label: category.name }))
];

const formatEmployeeList = (employeeIds, employees) => {
  const nameById = Object.fromEntries(
    employees.map((employee) => [
      employee.id,
      employee.full_name || [employee.first_name, employee.last_name].filter(Boolean).join(' ') || employee.email || 'Employee'
    ])
  );
  return employeeIds.map((id) => nameById[id] || 'Employee').join(', ');
};

const priorityOptions = () => [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'urgent', label: 'Urgent' }
];

const scopeOptions = () => [
  { value: 'facility', label: 'Facility queue: anyone can complete' },
  { value: 'assigned', label: 'Assigned: specific employee only' }
];

const priorityTone = (priority) => {
  if (priority === 'urgent' || priority === 'high') return 'danger';
  if (priority === 'medium') return 'warning';
  return 'success';
};

const formatDateTime = (value) => {
  if (!value) return '';
  return new Date(value).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
};

const styles = {
  container: {
    minHeight: '100vh',
    backgroundColor: TavariStyles.colors.gray50 || '#f9fafb',
    padding: '20px',
    paddingTop: '80px',
    boxSizing: 'border-box'
  },
  centered: { minHeight: '100vh', backgroundColor: '#f9fafb', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24, textAlign: 'center' },
  spinner: { width: 32, height: 32, borderRadius: '50%', border: '3px solid #14B8A6', borderTopColor: 'transparent', animation: 'spin 1s linear infinite' },
  centerText: { color: TavariStyles.colors.gray600, marginTop: 12 },
  errorTitle: { margin: 0, color: TavariStyles.colors.gray900 },
  statGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 14, marginBottom: 18 },
  overviewSearchRow: { display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 18 },
  overviewSearchLabel: { display: 'inline-flex', alignItems: 'center', gap: 8, fontWeight: 700, color: '#374151', fontSize: 14 },
  overviewSearchInputWrap: { position: 'relative', width: '100%', maxWidth: 520 },
  overviewSearchInput: { width: '100%', border: '1px solid #d1d5db', borderRadius: 10, padding: '11px 40px 11px 12px', fontSize: 14, boxSizing: 'border-box' },
  overviewSearchClear: { position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', border: 'none', background: '#f3f4f6', borderRadius: 999, width: 28, height: 28, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#6b7280' },
  overviewSearchMeta: { margin: 0, color: '#6b7280', fontSize: 13 },
  statCard: { background: 'white', border: '1px solid #e5e7eb', borderRadius: 14, padding: 18 },
  statCardClickable: { cursor: 'pointer', transition: 'box-shadow 0.15s ease, border-color 0.15s ease' },
  statCardStatic: { cursor: 'default' },
  statHint: { marginTop: 8, fontSize: 13, color: '#9ca3af', fontWeight: 600 },
  statDetailOverlay: { position: 'fixed', inset: 0, zIndex: 1200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 },
  statDetailBackdrop: { position: 'absolute', inset: 0, border: 'none', background: 'rgba(15, 23, 42, 0.45)', cursor: 'pointer' },
  statDetailPanel: { position: 'relative', width: 'min(720px, 100%)', maxHeight: 'min(80vh, 900px)', background: 'white', borderRadius: 16, border: '1px solid #e5e7eb', boxShadow: '0 24px 48px rgba(15, 23, 42, 0.18)', display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  statDetailHeader: { display: 'flex', justifyContent: 'space-between', gap: 12, padding: '18px 20px', borderBottom: '1px solid #e5e7eb' },
  statDetailTitle: { margin: '0 0 6px', color: '#111827', fontSize: 20 },
  statDetailDescription: { margin: '0 0 4px', color: '#6b7280', lineHeight: 1.5 },
  statDetailCount: { margin: 0, color: '#374151', fontWeight: 700, fontSize: 13 },
  statDetailClose: { border: 'none', background: '#f3f4f6', borderRadius: 10, width: 36, height: 36, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#374151', flexShrink: 0 },
  statDetailList: { padding: 16, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12 },
  statDanger: { borderColor: '#fecaca', background: '#fef2f2' },
  statWarning: { borderColor: '#fde68a', background: '#fffbeb' },
  statValue: { fontSize: 30, fontWeight: 800, color: '#111827' },
  statLabel: { color: '#6b7280', fontWeight: 700 },
  twoColumn: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 18, alignItems: 'start' },
  todayTasksColumn: { display: 'flex', flexDirection: 'column', gap: 18, minWidth: 0 },
  panel: { background: 'white', border: '1px solid #e5e7eb', borderRadius: 16, padding: 18, boxShadow: '0 8px 22px rgba(15, 23, 42, 0.04)', minWidth: 0, overflow: 'hidden', boxSizing: 'border-box' },
  panelHeader: { marginBottom: 16 },
  panelHeaderRow: { display: 'flex', gap: 12, alignItems: 'flex-start', justifyContent: 'space-between' },
  panelTitle: { margin: '0 0 6px', color: '#111827' },
  subTitle: { margin: '0 0 4px', color: '#111827', fontSize: 16 },
  panelDescription: { margin: 0, color: '#6b7280', lineHeight: 1.5 },
  form: { display: 'flex', flexDirection: 'column', gap: 12, width: '100%', minWidth: 0, boxSizing: 'border-box' },
  formGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 },
  categoryFormSection: { display: 'flex', flexDirection: 'column', gap: 12, width: '100%', minWidth: 0, boxSizing: 'border-box' },
  field: { display: 'flex', flexDirection: 'column', gap: 6, width: '100%', minWidth: 0, boxSizing: 'border-box' },
  label: { fontWeight: 700, color: '#374151', fontSize: 13 },
  input: { border: '1px solid #d1d5db', borderRadius: 10, padding: '10px 12px', fontSize: 14, width: '100%', maxWidth: '100%', boxSizing: 'border-box' },
  textarea: { border: '1px solid #d1d5db', borderRadius: 10, padding: '10px 12px', fontSize: 14, minHeight: 94, resize: 'vertical', width: '100%', maxWidth: '100%', boxSizing: 'border-box' },
  checkboxGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 },
  settingsStack: { display: 'flex', flexDirection: 'column', gap: 18 },
  checklistAlertRecipientGrid: { display: 'flex', flexDirection: 'column', gap: 14, marginTop: 8 },
  checklistAlertCategoryCard: { border: '1px solid #e5e7eb', borderRadius: 12, padding: 14, background: '#fafafa' },
  checklistAlertCategoryHeader: { display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 10 },
  checklistAlertRecipientList: { display: 'flex', flexDirection: 'column', gap: 8 },
  checklistAlertRecipientOption: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: '#374151', cursor: 'pointer' },
  photoRequirementFieldset: { border: '1px solid #e5e7eb', borderRadius: 12, padding: '12px 14px', margin: 0, gridColumn: '1 / -1' },
  photoRequirementLegend: { fontWeight: 700, color: '#374151', padding: '0 6px' },
  photoRequirementOption: { display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, cursor: 'pointer', fontSize: 14, color: '#374151' },
  checkboxLabel: { display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, color: '#374151' },
  primaryButton: { border: 'none', borderRadius: 10, padding: '11px 16px', background: '#008080', color: 'white', fontWeight: 800, cursor: 'pointer' },
  primaryButtonSmall: { border: 'none', borderRadius: 10, padding: '9px 12px', background: '#008080', color: 'white', fontWeight: 800, cursor: 'pointer' },
  secondaryButton: { border: '1px solid #d1d5db', borderRadius: 10, padding: '9px 12px', background: 'white', color: '#374151', fontWeight: 700, cursor: 'pointer' },
  dangerButton: { border: '1px solid #fecaca', borderRadius: 10, padding: '9px 12px', background: '#fef2f2', color: '#991b1b', fontWeight: 700, cursor: 'pointer' },
  dangerButtonSmall: { border: '1px solid #fecaca', borderRadius: 8, padding: '5px 8px', background: '#fef2f2', color: '#991b1b', fontWeight: 700, cursor: 'pointer', fontSize: 13 },
  taskCardEditing: { borderColor: '#14B8A6', background: '#f0fdfa', boxShadow: '0 0 0 1px #14B8A6' },
  list: { display: 'flex', flexDirection: 'column', gap: 12 },
  taskCard: { border: '1px solid #e5e7eb', borderRadius: 12, padding: 14, background: '#fff' },
  taskCardDragging: { opacity: 0.55 },
  taskCardDragOver: { borderColor: '#14B8A6', boxShadow: '0 0 0 2px rgba(20, 184, 166, 0.25)' },
  todayTaskTitleRow: { display: 'flex', gap: 10, alignItems: 'flex-start' },
  todayTaskQueueNumber: { color: '#008080', fontWeight: 800, fontSize: 14 },
  dragHandle: {
    border: '1px solid #d1d5db',
    borderRadius: 8,
    background: '#f9fafb',
    color: '#6b7280',
    padding: '6px 8px',
    cursor: 'grab',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0
  },
  taskCardClickable: { cursor: 'pointer', transition: 'border-color 0.15s ease, box-shadow 0.15s ease' },
  completionPhoto: { width: '100%', maxHeight: 420, objectFit: 'contain', borderRadius: 10, border: '1px solid #e5e7eb', background: '#f9fafb' },
  formActions: { display: 'flex', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' },
  taskHeader: { display: 'flex', gap: 12, alignItems: 'flex-start', justifyContent: 'space-between' },
  taskTitle: { margin: 0, color: '#111827', fontSize: 18 },
  taskMeta: { margin: '6px 0 0', color: '#6b7280', fontSize: 13, fontWeight: 600 },
  taskDescription: { margin: '10px 0 0', color: '#4b5563', lineHeight: 1.5 },
  badgeRow: { display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' },
  badge: { display: 'inline-flex', borderRadius: 999, padding: '4px 8px', background: '#f3f4f6', color: '#374151', fontSize: 13, fontWeight: 800, textTransform: 'capitalize' },
  badgeDanger: { background: '#fee2e2', color: '#991b1b' },
  badgeWarning: { background: '#fef3c7', color: '#92400e' },
  badgeSuccess: { background: '#dcfce7', color: '#166534' },
  cardActions: { display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 },
  signOffRow: {
    display: 'grid',
    gridTemplateColumns: 'minmax(180px, 1fr) minmax(220px, 1.4fr) auto',
    gap: 12,
    alignItems: 'end',
    marginTop: 12
  },
  signOffField: { display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 },
  signOffLabel: { fontSize: 13, fontWeight: 700, color: '#374151' },
  signOffSelect: {
    border: '1px solid #d1d5db',
    borderRadius: 10,
    padding: '10px 12px',
    fontSize: 14,
    width: '100%',
    boxSizing: 'border-box'
  },
  signOffInput: {
    border: '1px solid #d1d5db',
    borderRadius: 10,
    padding: '10px 12px',
    fontSize: 14,
    width: '100%',
    boxSizing: 'border-box'
  },
  signOffActions: { display: 'flex', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' },
  modalOverlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(15, 23, 42, 0.55)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    zIndex: 1200
  },
  quickViewModal: {
    width: 'min(760px, 100%)',
    maxHeight: 'min(85vh, 900px)',
    background: '#fff',
    borderRadius: 16,
    boxShadow: '0 24px 60px rgba(15, 23, 42, 0.25)',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden'
  },
  quickViewHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 16,
    padding: '20px 24px 12px',
    borderBottom: '1px solid #e5e7eb'
  },
  quickViewTitle: { margin: 0, fontSize: 23, color: '#111827' },
  quickViewSubtitle: { margin: '6px 0 0', color: '#6b7280', fontSize: 14, lineHeight: 1.5 },
  modalCloseButton: {
    border: 'none',
    background: '#f3f4f6',
    borderRadius: 999,
    width: 36,
    height: 36,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    flexShrink: 0
  },
  quickViewTabs: {
    display: 'flex',
    gap: 8,
    flexWrap: 'wrap',
    padding: '12px 24px',
    borderBottom: '1px solid #e5e7eb',
    background: '#fafafa'
  },
  quickViewTab: {
    border: '1px solid #d1d5db',
    background: '#fff',
    borderRadius: 999,
    padding: '8px 14px',
    fontSize: 13,
    fontWeight: 600,
    color: '#374151',
    cursor: 'pointer'
  },
  quickViewTabActive: {
    background: '#111827',
    borderColor: '#111827',
    color: '#fff'
  },
  quickViewBody: {
    padding: '16px 24px',
    overflowY: 'auto',
    flex: 1
  },
  quickViewFooter: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: 8,
    padding: '16px 24px',
    borderTop: '1px solid #e5e7eb'
  },
  quickViewList: { display: 'flex', flexDirection: 'column', gap: 10 },
  quickViewRow: {
    border: '1px solid #e5e7eb',
    borderRadius: 12,
    padding: '12px 14px',
    background: '#fff'
  },
  quickViewRowNext: {
    borderColor: '#2563eb',
    background: '#eff6ff'
  },
  quickViewRowMain: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 12,
    alignItems: 'flex-start'
  },
  quickViewRowTitleWrap: { display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 },
  quickViewNextBadge: {
    alignSelf: 'flex-start',
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: 0.3,
    textTransform: 'uppercase',
    color: '#1d4ed8'
  },
  quickViewRowTitle: { margin: 0, fontSize: 16, color: '#111827', lineHeight: 1.35 },
  quickViewRowMeta: { margin: '8px 0 0', fontSize: 13, color: '#6b7280', lineHeight: 1.45 },
  emptyText: { color: '#6b7280', margin: 0 },
  hintText: { margin: 0, color: '#6b7280', fontSize: 13, lineHeight: 1.5 },
  checklistWindowGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
    gap: 12,
    marginTop: 8
  },
  timeField: { display: 'flex', flexDirection: 'column', gap: 6 },
  timeInput: {
    border: '1px solid #d1d5db',
    borderRadius: 10,
    padding: '10px 12px',
    fontSize: 14,
    width: '100%',
    boxSizing: 'border-box'
  },
  employeeCheckboxList: { display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 220, overflowY: 'auto', border: '1px solid #e5e7eb', borderRadius: 10, padding: 10, width: '100%', boxSizing: 'border-box' },
  categoryInactive: { opacity: 0.65, background: '#f9fafb' },
  trainingList: { marginTop: 16, display: 'flex', flexDirection: 'column', gap: 8 },
  trainingItem: { border: '1px solid #e5e7eb', borderRadius: 10, padding: 10, display: 'flex', flexDirection: 'column', gap: 4, color: '#4b5563' },
  trainingEditor: { border: '1px solid #ccfbf1', borderRadius: 12, padding: 14, background: '#f0fdfa', display: 'flex', flexDirection: 'column', gap: 12 },
  trainingEditorHeader: { display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' },
  trainingLibraryRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  trainingResourceCard: { background: '#fff', border: '1px solid #99f6e4', borderRadius: 12, padding: 12, display: 'flex', flexDirection: 'column', gap: 10 },
  trainingResourceActions: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' },
  kioskCard: { display: 'grid', gap: 16 },
  facilityBusyCard: {
    border: '1px solid #99f6e4',
    background: '#f0fdfa',
    borderRadius: 10,
    padding: '12px 14px',
    marginBottom: 16
  },
  kioskCodeCard: {
    padding: 20,
    borderRadius: 12,
    background: 'linear-gradient(145deg, #115e59 0%, #0f766e 100%)',
    color: 'white',
    textAlign: 'center'
  },
  kioskCodeCardLabel: { fontWeight: 700, marginBottom: 8, opacity: 0.92, fontSize: 13 },
  kioskCodeDigits: {
    fontSize: 43,
    fontWeight: 800,
    letterSpacing: '0.22em',
    fontVariantNumeric: 'tabular-nums',
    marginBottom: 8
  },
  kioskCodeHint: { margin: 0, fontSize: 13, lineHeight: 1.5, opacity: 0.92 },
  kioskLabel: { color: '#6b7280', fontWeight: 700, marginBottom: 6 },
  codeBlock: { display: 'block', padding: 12, border: '1px solid #ccfbf1', borderRadius: 10, background: '#f0fdfa', color: '#0f766e', wordBreak: 'break-all' },
  kioskActions: { display: 'flex', flexWrap: 'wrap', gap: 10 }
};

export default TasksDashboard;
