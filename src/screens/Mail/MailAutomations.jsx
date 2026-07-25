import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import {
  FiBarChart2,
  FiCalendar,
  FiEdit3,
  FiEye,
  FiClock,
  FiGift,
  FiHeart,
  FiMail,
  FiMousePointer,
  FiSearch,
  FiRefreshCw,
  FiSend,
  FiStar,
  FiUsers,
  FiAward,
  FiChevronDown,
  FiSave
} from 'react-icons/fi';
import { supabase } from '../../supabaseClient';
import { usePermissions } from '../../hooks/usePermissions';
import { usePOSAuth } from '../../hooks/usePOSAuth';
import POSAuthWrapper from '../../components/Auth/POSAuthWrapper';
import MailModuleHeader from '../../components/Mail/MailModuleHeader';
import { MailModuleSubTabs } from '../../components/Mail/MailModuleNavigation';
import MailDailyDigestTab from '../../components/Mail/MailDailyDigestTab';
import NameOfDaySettingsModal from '../../components/Mail/NameOfDaySettingsModal';
import NameOfDayManualBuckets from '../../components/Mail/NameOfDayManualBuckets';
import { SecurityWrapper } from '../../Security';
import toast from 'react-hot-toast';
import { getBusinessTimezone } from '../../utils/businessDateFormat';
import {
  formatUnknownError,
  readEdgeFunctionErrorMessage
} from '../../helpers/edgeFunctionErrors';

dayjs.extend(utc);
dayjs.extend(timezone);

/** Stored server-side as minutes (max 7 days). */
const MAX_WAIVER_CHECKIN_DELAY_MINUTES = 10080;

function waiverDelayMinutesFromHours(hours) {
  const h = Number(hours);
  if (!Number.isFinite(h)) return 0;
  return Math.max(0, Math.min(MAX_WAIVER_CHECKIN_DELAY_MINUTES, Math.round(h * 60)));
}

function formatWaiverCheckInDelayShort(minutes) {
  const m = Math.max(0, Math.min(MAX_WAIVER_CHECKIN_DELAY_MINUTES, Number(minutes) || 0));
  if (m === 0) return 'send immediately after check-in';
  if (m % 60 === 0) {
    const hrs = m / 60;
    return `${hrs} hour${hrs === 1 ? '' : 's'} after check-in`;
  }
  return `${m} min after check-in`;
}

const AUTOMATION_BLUEPRINTS = [
  {
    id: 'birthday',
    title: 'Birthday Promotions',
    icon: FiGift,
    accent: '#ec4899',
    trigger: 'Send before a minor birthday',
    criteria: ['Minor DOB', 'Parent/guardian email', 'Marketing consent'],
    personalization: ['Recipient name', 'Minor first name', 'Loyalty points']
  },
  {
    id: 'day-camp',
    title: 'Day Camp Promotions',
    icon: FiCalendar,
    accent: '#0ea5e9',
    trigger: 'Send by season or registration window',
    criteria: ['Booking history', 'Age range', 'Camp-related activity history'],
    personalization: ['Recipient name', 'Loyalty points', 'Last camp/booking context']
  },
  {
    id: 'summer-camp',
    title: 'Summer Camp Promotions',
    icon: FiStar,
    accent: '#f59e0b',
    trigger: 'Send on summer campaign schedule',
    criteria: ['Minor DOB', 'Past seasonal bookings', 'Program interest'],
    personalization: ['Recipient name', 'Loyalty points', 'Age-relevant offer copy']
  },
  {
    id: 'we-miss-you',
    title: 'We Miss You',
    icon: FiHeart,
    accent: '#10b981',
    trigger: 'Send after inactivity window',
    criteria: ['No bookings in 30/60/90+ days', 'Booking history', 'Marketing consent'],
    personalization: ['Recipient name', 'Loyalty points', 'Last visit date']
  },
  {
    id: 'waiver-check-in-review',
    title: 'Post-Visit Review Request',
    icon: FiStar,
    accent: '#7c3aed',
    trigger: 'After waiver check-in — choose how long to wait before the email sends (below)',
    criteria: ['Waiver check-in', 'Customer email', 'Hard suppression check'],
    personalization: ['Recipient name', 'Checked-in name', 'Reputation review link'],
    automationType: 'custom',
    automationSource: 'waiver_check_in_review'
  },
  {
    id: 'name-of-day',
    title: 'Name of the Day Promotion',
    icon: FiAward,
    accent: '#f97316',
    trigger: 'Daily ~7:00 AM local — winners notified when a minor first name matches',
    criteria: ['Waiver minor first names', 'Guardian on marketing list', 'Composite score + cooldown'],
    personalization: ['Recipient name', 'Girl / boy picks', 'Winning minor first name(s)'],
    automationType: 'custom',
    automationSource: 'name_of_day'
  },
  {
    id: 'toddler-thursday',
    title: 'Toddler Thursday Promotion',
    icon: FiUsers,
    accent: '#14b8a6',
    trigger: 'Thursday 6:00–9:00 AM local — bi-weekly Toddler Thursday promos',
    criteria: [
      '≥1 toddler age 1–3 on any waiver',
      'Marketing consent',
      '50/50 cohort rotation',
      'Book Toddler Thursday slot 10 AM–1 PM online with code DCT2026'
    ],
    personalization: [
      'Recipient name',
      'Toddler names/count',
      'Promo code & booking window',
      '$7 each when 2+ toddlers booked online'
    ],
    automationType: 'custom',
    automationSource: 'toddler_thursday'
  }
];

const DATA_SIGNALS = [
  'Minor DOB',
  'Booking history',
  'Last booking date',
  'Days since last visit',
  'Parent/guardian contact email',
  'Loyalty points',
  'Recipient first name',
  'Minor first name',
  'Name-of-day cooldown & scoring signals'
];

const AUTOMATION_TABS = [
  { id: 'overview', label: 'Overview', icon: FiClock },
  { id: 'blueprints', label: 'Blueprints', icon: FiStar },
  { id: 'saved', label: 'Saved Automations', icon: FiRefreshCw },
  { id: 'data-signals', label: 'Data Signals', icon: FiUsers },
  { id: 'daily-digest', label: 'Daily digest', icon: FiBarChart2 }
];

const formatSendWindowTime = (hour = 0, minute = 0) => {
  const normalizedHour = Number(hour) || 0;
  const normalizedMinute = String(Number(minute) || 0).padStart(2, '0');
  const period = normalizedHour >= 12 ? 'PM' : 'AM';
  const displayHour = normalizedHour % 12 || 12;
  return `${displayHour}:${normalizedMinute} ${period}`;
};

const formatPreviewSendWindow = (sendWindow) => {
  if (!sendWindow) return '7:00 AM-7:00 PM local';
  const minuteOffset = Number(sendWindow.minute_offset) || 0;
  return `${formatSendWindowTime(sendWindow.start_hour, minuteOffset)}-${formatSendWindowTime(sendWindow.end_hour, minuteOffset)} local`;
};

const getDateRangeForFilter = (filter, customDate = '', timeZone = 'America/Toronto') => {
  if (filter === 'all') return {};
  const now = dayjs().tz(timeZone);
  const targetDate = filter === 'custom' && customDate
    ? dayjs.tz(customDate, timeZone)
    : now
      .add(filter === 'tomorrow' ? 1 : 0, 'day')
      .subtract(filter === 'yesterday' ? 1 : 0, 'day');
  const dateString = targetDate.format('YYYY-MM-DD');
  if (!dateString) return {};
  return {
    start: dayjs.tz(`${dateString}T00:00:00`, timeZone).utc().toISOString(),
    end: dayjs.tz(`${dateString}T23:59:59.999`, timeZone).utc().toISOString()
  };
};

const resolveAutomationPreviewKind = (automation) => {
  if (!automation) return null;
  if (automation.automation_type === 'birthday') return 'birthday';
  if (
    automation.automation_type === 'custom' &&
    String(automation.criteria?.source || '') === 'name_of_day'
  ) {
    return 'name_of_day';
  }
  if (
    automation.automation_type === 'custom' &&
    String(automation.criteria?.source || '') === 'toddler_thursday'
  ) {
    return 'toddler_thursday';
  }
  return 'other';
};

const NOD_PREVIEW_CAL_DAYS_BACK = 7;
const NOD_PREVIEW_CAL_DAYS_FORWARD = 21;

function normalizeNodPickToken(s) {
  return String(s || '')
    .trim()
    .toLowerCase();
}

function sanitizeNodPickMeta(obj) {
  try {
    return JSON.parse(JSON.stringify(obj ?? {}));
  } catch {
    return {};
  }
}

/** Full date range with editable fields; synthetic rows use pick_source pending until saved to DB. */
function mergeNodCalendarGridRows(dbRows, tz, startStr, endStr) {
  const map = new Map((dbRows || []).map((r) => [r.local_date, r]));
  const out = [];
  let cursor = dayjs.tz(startStr, tz).startOf('day');
  const end = dayjs.tz(endStr, tz).startOf('day');
  while (cursor.isBefore(end) || cursor.isSame(end, 'day')) {
    const ds = cursor.format('YYYY-MM-DD');
    const existing = map.get(ds);
    if (existing) {
      out.push({
        local_date: ds,
        girl_display_name: existing.girl_display_name ?? '',
        boy_display_name: existing.boy_display_name ?? '',
        pick_source: existing.pick_source ?? 'auto',
        meta: existing.meta && typeof existing.meta === 'object' ? existing.meta : {}
      });
    } else {
      out.push({
        local_date: ds,
        girl_display_name: '',
        boy_display_name: '',
        pick_source: 'pending',
        meta: {}
      });
    }
    cursor = cursor.add(1, 'day');
  }
  return out;
}

const MailAutomations = () => {
  const navigate = useNavigate();

  const {
    selectedBusinessId,
    businessData,
    authLoading,
    authError
  } = usePOSAuth({
    requiredRoles: ['owner', 'manager', 'admin', 'staff'],
    requireBusiness: true,
    componentName: 'MailAutomations'
  });

  const {
    hasPermission,
    hasAnyPermission,
    hasElevatedPrivileges,
    loading: permissionsLoading
  } = usePermissions();

  const canViewAutomations =
    hasAnyPermission(['mail.campaigns.view', 'mail.campaigns.create', 'mail.contacts.view']) ||
    hasElevatedPrivileges();
  const canCreateCampaigns = hasPermission('mail.campaigns.create') || hasElevatedPrivileges();
  const canManageContacts = hasPermission('mail.contacts.view') || hasElevatedPrivileges();
  const [automations, setAutomations] = useState([]);
  const [activeAutomationTab, setActiveAutomationTab] = useState('overview');
  const [loadingAutomations, setLoadingAutomations] = useState(false);
  const [automationLoadError, setAutomationLoadError] = useState('');
  const [previewState, setPreviewState] = useState({
    automationId: null,
    previewKind: null,
    date: new Date().toISOString().slice(0, 10),
    loading: false,
    error: '',
    result: null
  });
  const [nodCalendarGridRows, setNodCalendarGridRows] = useState([]);
  const [savingNodPickDate, setSavingNodPickDate] = useState(null);
  const [nodRegenerating, setNodRegenerating] = useState(false);
  const [nodForceQueuing, setNodForceQueuing] = useState(false);
  const [nameOfDayModalOpen, setNameOfDayModalOpen] = useState(false);
  /** Collapsible Name-of-Day calendar (dates / picks grid); default open so it is not buried below a long name pool */
  const [nodCalendarOpen, setNodCalendarOpen] = useState(true);
  /** Hours after check-in before review email sends (stored as minutes in reputation_settings). Default 2h for new setups. */
  const [waiverCheckInReviewDelayHours, setWaiverCheckInReviewDelayHours] = useState(2);
  const [waiverCheckInDelayLoading, setWaiverCheckInDelayLoading] = useState(false);
  const [waiverCheckInDelaySaving, setWaiverCheckInDelaySaving] = useState(false);
  const canEditNameOfDayPicks = canCreateCampaigns || hasElevatedPrivileges;
  const [historyState, setHistoryState] = useState({
    automationId: null,
    filter: 'all',
    statusFilter: 'all',
    customDate: new Date().toISOString().slice(0, 10),
    limit: 50,
    loading: false,
    error: '',
    rows: [],
    summary: null
  });
  const businessId =
    selectedBusinessId ||
    businessData?.id ||
    localStorage.getItem('currentBusinessId') ||
    localStorage.getItem('businessId');

  useEffect(() => {
    if (!authLoading && !permissionsLoading && !canViewAutomations) {
      toast.error('You do not have permission to access mail automations');
      navigate('/dashboard/mail/dashboard');
    }
  }, [authLoading, permissionsLoading, canViewAutomations, navigate]);

  useEffect(() => {
    if (!authLoading && !permissionsLoading && canViewAutomations && businessId) {
      loadAutomations();
    }
  }, [authLoading, permissionsLoading, canViewAutomations, businessId]);

  useEffect(() => {
    if (!businessId) return;
    let cancelled = false;
    (async () => {
      setWaiverCheckInDelayLoading(true);
      const { data, error } = await supabase
        .from('reputation_settings')
        .select('waiver_check_in_review_delay_minutes')
        .eq('business_id', businessId)
        .maybeSingle();
      if (cancelled) return;
      setWaiverCheckInDelayLoading(false);
      if (error) {
        console.error('[MailAutomations] reputation_settings delay load failed', error);
        return;
      }
      const mm = data?.waiver_check_in_review_delay_minutes;
      if (mm != null) {
        setWaiverCheckInReviewDelayHours(Number(mm) / 60);
      } else {
        setWaiverCheckInReviewDelayHours(2);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [businessId]);

  const saveWaiverCheckInReviewDelay = async () => {
    if (!businessId || !canCreateCampaigns) return;
    const clamped = waiverDelayMinutesFromHours(waiverCheckInReviewDelayHours);
    setWaiverCheckInReviewDelayHours(clamped / 60);
    setWaiverCheckInDelaySaving(true);
    try {
      const { error } = await supabase.from('reputation_settings').upsert(
        {
          business_id: businessId,
          waiver_check_in_review_delay_minutes: clamped,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'business_id' },
      );

      if (error) throw error;
      const hrsWhole = clamped / 60;
      toast.success(
        clamped === 0
          ? 'Review emails will send as soon as check-in is saved.'
          : clamped % 60 === 0
            ? `Review emails will send about ${hrsWhole} hour${hrsWhole === 1 ? '' : 's'} after check-in.`
            : `Review emails will send about ${clamped} minute${clamped === 1 ? '' : 's'} after check-in.`,
      );
    } catch (e) {
      console.error('[MailAutomations] save waiver check-in delay failed', e);
      toast.error(e?.message || 'Could not save delay');
    } finally {
      setWaiverCheckInDelaySaving(false);
    }
  };

  const loadNodCalendarRows = useCallback(async () => {
    if (
      !businessId ||
      !businessData ||
      previewState.previewKind !== 'name_of_day' ||
      !previewState.automationId
    ) {
      setNodCalendarGridRows([]);
      return;
    }
    const tz = getBusinessTimezone(businessData);
    const start = dayjs().tz(tz).subtract(NOD_PREVIEW_CAL_DAYS_BACK, 'day').format('YYYY-MM-DD');
    const end = dayjs().tz(tz).add(NOD_PREVIEW_CAL_DAYS_FORWARD, 'day').format('YYYY-MM-DD');
    const { data, error } = await supabase
      .from('mail_name_of_day_picks')
      .select('local_date, girl_display_name, boy_display_name, pick_source, meta')
      .eq('business_id', businessId)
      .gte('local_date', start)
      .lte('local_date', end)
      .order('local_date', { ascending: true });
    if (error) {
      console.error(error);
      setNodCalendarGridRows([]);
      return;
    }
    setNodCalendarGridRows(mergeNodCalendarGridRows(data || [], tz, start, end));
  }, [businessId, businessData, previewState.previewKind, previewState.automationId]);

  const updateNodCalendarPickField = useCallback((localDate, field, value) => {
    setNodCalendarGridRows((prev) =>
      prev.map((r) => (r.local_date === localDate ? { ...r, [field]: value } : r))
    );
  }, []);

  useEffect(() => {
    void loadNodCalendarRows().catch((err) =>
      console.error('[MailAutomations] Name-of-Day calendar load failed', err)
    );
  }, [loadNodCalendarRows]);

  const regenerateNameOfDayCalendarPicks = async () => {
    if (!businessId) return;
    if (!canEditNameOfDayPicks) {
      toast.error('Campaign creation or elevated access is required to add calendar picks.');
      return;
    }
    setNodRegenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke('mail-name-of-day', {
        body: { businessId, refreshAutoPicks: true }
      });
      if (error) throw error;
      const row = Array.isArray(data?.results) ? data.results[0] : null;
      if (row && typeof row === 'object') {
        console.info('[MailAutomations] mail-name-of-day refresh result', row);
      }
      const mp = row?.minor_pool_summary;
      const ins = row?.pregen_inserted;
      const skipped = row?.skipped ? String(row.skipped) : '';

      if (row?.error) {
        toast.error(formatUnknownError(row.error, 'Regeneration failed'));
      } else if (skipped === 'no_open_day_in_lookahead') {
        const n = row?.one_day_lookahead ?? 90;
        toast.success(
          `The next ${n} days already have names (or are saved as user-edited). The scheduled job can add farther-out days.`
        );
      } else if (
        skipped === 'empty_gender_pool' ||
        skipped === 'no_minors_in_pool' ||
        skipped === 'no_minors_in_pool_after_age_filter'
      ) {
        toast.error(
          skipped === 'no_minors_in_pool'
            ? 'No minors showed up in the waiver sample for this run — add participants or check waivers.'
            : skipped === 'no_minors_in_pool_after_age_filter'
              ? 'No minors in the pool after applying max child age from Mail Settings — raise the age limit or add younger waivers.'
              : 'Girl or boy name pool is empty with current data — if manual buckets are on, classify names below; otherwise check first names and scoring settings.'
        );
      } else if (row?.incremental_one_day && row?.target_local_date) {
        if (Number(ins) >= 1) {
          toast.success(
            `Added Name-of-Day picks for ${row.target_local_date}. Click again to fill the next open day.`
          );
        } else {
          const pr = Array.isArray(row.pregen_results) ? row.pregen_results[0] : null;
          const reason = pr?.reason ? String(pr.reason) : '';
          toast.error(
            reason
              ? `Could not add picks for ${row.target_local_date}: ${reason}`
              : `Could not add picks for ${row.target_local_date}.`
          );
        }
      } else if (mp) {
        const base = `Regenerated auto picks (${ins ?? 0} days updated). Minor pool: ${mp.total_rows} rows — ${mp.modern_waiver_participants} modern, ${mp.legacy_waivers_sourced} legacy.`;
        toast.success(skipped ? `${base} (note: ${skipped})` : base);
      } else {
        toast.success(skipped ? `Name-of-day job completed (${skipped})` : 'Name-of-day job completed.');
      }
      await loadNodCalendarRows();
    } catch (e) {
      console.error('[MailAutomations] regenerate calendar picks failed', e);
      const msg = await readEdgeFunctionErrorMessage(e, 'Could not regenerate calendar picks');
      toast.error(msg);
    } finally {
      setNodRegenerating(false);
    }
  };

  const forceQueueNameOfDaySends = async () => {
    if (!businessId) return;
    if (!canEditNameOfDayPicks) {
      toast.error('Campaign creation or elevated access is required to queue sends.');
      return;
    }
    setNodForceQueuing(true);
    try {
      const { data, error } = await supabase.functions.invoke('mail-name-of-day', {
        body: { businessId, forceQueue: true }
      });
      if (error) throw error;
      const row = Array.isArray(data?.results) ? data.results[0] : null;
      if (row && typeof row === 'object') {
        console.info('[MailAutomations] mail-name-of-day forceQueue result', row);
      }
      const skipped = row?.skipped ? String(row.skipped) : '';
      const queued = Number(row?.queued ?? 0);

      if (row?.error) {
        toast.error(formatUnknownError(row.error, 'Could not queue sends'));
      } else if (skipped === 'no_name_of_day_automation') {
        toast.error('No enabled Name-of-the-Day automation is linked to this business.');
      } else if (skipped === 'today_pick_missing_after_pregen') {
        toast.error('Today’s girl/boy pick row is missing — run picks first or check the calendar.');
      } else if (
        skipped === 'empty_gender_pool' ||
        skipped === 'no_minors_in_pool' ||
        skipped === 'no_minors_in_pool_after_age_filter'
      ) {
        toast.error(
          skipped === 'no_minors_in_pool'
            ? 'No minors in the waiver pool for scoring.'
            : skipped === 'no_minors_in_pool_after_age_filter'
              ? 'No minors under your max child age in the pool.'
              : 'Girl or boy name pool is empty (check manual buckets if enabled).'
        );
      } else if (skipped === 'outside_send_window') {
        toast.error('Unexpected: send window block — contact support.');
      } else {
        toast.success(
          queued > 0
            ? `Queued ${queued} email(s) for today’s Name-of-Day send (bypassed send clock).`
            : `No emails queued (${row?.winners ?? 0} matching guardian(s); check marketing consent / contacts).`
        );
      }
    } catch (e) {
      console.error('[MailAutomations] force queue Name-of-Day failed', e);
      const msg = await readEdgeFunctionErrorMessage(e, 'Could not force-queue sends');
      toast.error(msg);
    } finally {
      setNodForceQueuing(false);
    }
  };

  const loadAutomations = async () => {
    setLoadingAutomations(true);
    setAutomationLoadError('');
    try {
      const { data, error } = await supabase
        .from('mail_automations')
        .select(`
          id,
          name,
          automation_type,
          is_enabled,
          status,
          trigger_timing,
          days_offset,
          criteria,
          campaign_id,
          updated_at,
          campaign:mail_campaigns(name)
        `)
        .eq('business_id', businessId)
        .order('updated_at', { ascending: false });

      if (error) throw error;
      setAutomations(data || []);
    } catch (error) {
      console.error('Error loading automations:', error);
      setAutomations([]);
      setAutomationLoadError('Saved automations will appear after the mail automations migration is applied.');
    } finally {
      setLoadingAutomations(false);
    }
  };

  const openAutomationBuilder = (automationType = 'custom', automationSource = '') => {
    const sourceParam = automationSource ? `&automationSource=${encodeURIComponent(automationSource)}` : '';
    navigate(`/dashboard/mail/builder?mode=automation&automationType=${encodeURIComponent(automationType)}${sourceParam}`);
  };

  const editAutomation = (automation) => {
    const sourceParam = automation.criteria?.source ? `&automationSource=${encodeURIComponent(automation.criteria.source)}` : '';
    navigate(
      `/dashboard/mail/builder/${automation.campaign_id}?mode=automation&automationType=${encodeURIComponent(automation.automation_type)}${sourceParam}&automationId=${encodeURIComponent(automation.id)}`
    );
  };

  const toggleAutomationEnabled = async (automation) => {
    try {
      const nextEnabled = automation.is_enabled !== true;
      const { error } = await supabase
        .from('mail_automations')
        .update({
          is_enabled: nextEnabled,
          updated_at: new Date().toISOString()
        })
        .eq('id', automation.id)
        .eq('business_id', businessId);

      if (error) throw error;

      setAutomations((prev) => prev.map((item) => (
        item.id === automation.id
          ? { ...item, is_enabled: nextEnabled, updated_at: new Date().toISOString() }
          : item
      )));
      toast.success(nextEnabled ? 'Automation turned on' : 'Automation turned off');
    } catch (error) {
      console.error('Error toggling automation state:', error);
      toast.error('Unable to update automation switch');
    }
  };

  const loadAutomationPreview = async (automation, previewDate = previewState.date) => {
    if (!automation?.id || !businessId) return;

    const previewKind = resolveAutomationPreviewKind(automation);

    setPreviewState({
      automationId: automation.id,
      previewKind,
      date: previewDate,
      loading: true,
      error: '',
      result: null
    });

    try {
      const { data, error } = await supabase.functions.invoke('mail-automation-preview', {
        body: {
          businessId,
          automationId: automation.id,
          previewDate
        }
      });

      if (error) throw error;
      if (!data?.ok) {
        throw new Error(formatUnknownError(data?.error, 'Unable to preview automation'));
      }

      setPreviewState({
        automationId: automation.id,
        previewKind,
        date: previewDate,
        loading: false,
        error: '',
        result: data
      });
    } catch (error) {
      const msg = await readEdgeFunctionErrorMessage(error, 'Unable to preview automation');
      console.error('Error previewing automation:', msg, error);
      setPreviewState({
        automationId: automation.id,
        previewKind,
        date: previewDate,
        loading: false,
        error: msg,
        result: null
      });
      toast.error(msg);
    }
  };

  const updatePreviewDate = (automation, nextDate) => {
    setPreviewState((prev) => ({
      ...prev,
      automationId: automation.id,
      previewKind: resolveAutomationPreviewKind(automation),
      date: nextDate,
      error: '',
      result: null
    }));
  };

  const saveNodPickRow = useCallback(
    async (localDate) => {
      if (!businessId || !canEditNameOfDayPicks) return;
      const row = nodCalendarGridRows.find((r) => r.local_date === localDate);
      if (!row) return;
      const g = String(row.girl_display_name || '').trim();
      const b = String(row.boy_display_name || '').trim();
      if (!g || !b) {
        toast.error('Enter both a girl name and a boy name');
        return;
      }
      setSavingNodPickDate(localDate);
      try {
        const payload = {
          business_id: businessId,
          local_date: localDate,
          girl_display_name: g,
          boy_display_name: b,
          girl_normalized: normalizeNodPickToken(g),
          boy_normalized: normalizeNodPickToken(b),
          pick_source: 'user_edited',
          meta: sanitizeNodPickMeta(row.meta),
          updated_at: new Date().toISOString()
        };
        const { error } = await supabase.from('mail_name_of_day_picks').upsert(payload, {
          onConflict: 'business_id,local_date'
        });
        if (error) throw error;
        toast.success(`Saved picks for ${localDate}`);
        await loadNodCalendarRows();
        const auto = automations.find((a) => a.id === previewState.automationId);
        if (auto) await loadAutomationPreview(auto, previewState.date);
      } catch (e) {
        console.error(e);
        toast.error(e.message || 'Save failed');
      } finally {
        setSavingNodPickDate(null);
      }
    },
    [
      businessId,
      canEditNameOfDayPicks,
      nodCalendarGridRows,
      automations,
      previewState.automationId,
      previewState.date,
      loadNodCalendarRows,
      loadAutomationPreview
    ]
  );

  const loadAutomationHistory = async (
    automation,
    nextFilter = historyState.filter,
    nextCustomDate = historyState.customDate,
    nextLimit = historyState.limit,
    nextStatusFilter = historyState.statusFilter
  ) => {
    if (!automation?.id || !businessId) return;

    setHistoryState((prev) => ({
      ...prev,
      automationId: automation.id,
      filter: nextFilter,
      statusFilter: nextStatusFilter,
      customDate: nextCustomDate,
      limit: nextLimit,
      loading: true,
      error: ''
    }));

    try {
      const businessTimeZone = businessData?.timezone || 'America/Toronto';
      const range = getDateRangeForFilter(nextFilter, nextCustomDate, businessTimeZone);
      let query = supabase
        .from('mail_automation_runs')
        .select('id, campaign_id, contact_id, email_address, status, last_error, trigger_date, event_date, context, queued_at, sent_at, created_at, updated_at')
        .eq('business_id', businessId)
        .eq('automation_id', automation.id)
        .order('queued_at', { ascending: false })
        .limit(nextLimit);

      if (range.start && range.end) {
        query = query.gte('queued_at', range.start).lte('queued_at', range.end);
      }

      if (nextStatusFilter !== 'all') {
        query = query.eq('status', nextStatusFilter);
      }

      const { data: runs, error: runsError } = await query;
      if (runsError) throw runsError;

      const runIds = [...new Set((runs || []).map((run) => run.id).filter(Boolean))];
      const contactIds = [...new Set((runs || []).map((run) => run.contact_id).filter(Boolean))];
      const campaignId = automation.campaign_id;

      const [
        { data: queueRows, error: queueError },
        { data: sendRows, error: sendError },
        { data: analyticsRows, error: analyticsError },
        { count: totalCount, error: countError }
      ] = await Promise.all([
        runIds.length
          ? supabase
            .from('mail_sending_queue')
            .select('automation_run_id, status, error_message, scheduled_for, processed_at')
            .in('automation_run_id', runIds)
          : Promise.resolve({ data: [], error: null }),
        contactIds.length && campaignId
          ? supabase
            .from('mail_campaign_sends')
            .select('contact_id, status, sent_at, opened_at, clicked_at, error_message')
            .eq('campaign_id', campaignId)
            .in('contact_id', contactIds)
          : Promise.resolve({ data: [], error: null }),
        contactIds.length && campaignId
          ? supabase
            .from('mail_content_analytics')
            .select('contact_id, event_type, block_id, created_at')
            .eq('campaign_id', campaignId)
            .in('contact_id', contactIds)
          : Promise.resolve({ data: [], error: null }),
        (() => {
          let countQuery = supabase
            .from('mail_automation_runs')
            .select('id', { count: 'exact', head: true })
            .eq('business_id', businessId)
            .eq('automation_id', automation.id);
          if (range.start && range.end) {
            countQuery = countQuery.gte('queued_at', range.start).lte('queued_at', range.end);
          }
          if (nextStatusFilter !== 'all') {
            countQuery = countQuery.eq('status', nextStatusFilter);
          }
          return countQuery;
        })()
      ]);

      if (queueError) throw queueError;
      if (sendError) throw sendError;
      if (analyticsError) throw analyticsError;
      if (countError) throw countError;

      const queueByRunId = new Map((queueRows || []).map((row) => [row.automation_run_id, row]));
      const sendsByContactId = new Map();
      for (const row of sendRows || []) {
        const key = String(row.contact_id || '');
        if (!key) continue;
        const existing = sendsByContactId.get(key);
        if (!existing || String(row.sent_at || '') > String(existing.sent_at || '')) {
          sendsByContactId.set(key, row);
        }
      }

      const analyticsByContactId = new Map();
      for (const row of analyticsRows || []) {
        const key = String(row.contact_id || '');
        if (!key) continue;
        const current = analyticsByContactId.get(key) || { opens: 0, clicks: 0 };
        if (row.event_type === 'view' && row.block_id === 'email_open') current.opens += 1;
        if (row.event_type === 'click') current.clicks += 1;
        analyticsByContactId.set(key, current);
      }

      const mergedRows = (runs || []).map((run) => {
        const queue = queueByRunId.get(run.id) || {};
        const send = sendsByContactId.get(String(run.contact_id || '')) || {};
        const analytics = analyticsByContactId.get(String(run.contact_id || '')) || { opens: 0, clicks: 0 };
        return {
          ...run,
          queue_status: queue.status || null,
          queue_error: queue.error_message || null,
          scheduled_for: queue.scheduled_for || run.context?.scheduled_for || null,
          processed_at: queue.processed_at || null,
          send_status: send.status || null,
          opened_at: send.opened_at || null,
          clicked_at: send.clicked_at || null,
          send_error: send.error_message || null,
          opens: analytics.opens,
          clicks: analytics.clicks
        };
      });

      const statusCounts = mergedRows.reduce((acc, row) => {
        const key = row.status || row.queue_status || 'unknown';
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      }, {});
      const sentCount = mergedRows.filter((row) => row.status === 'sent').length;
      const openedCount = mergedRows.filter((row) => row.opens > 0 || row.opened_at).length;
      const clickedCount = mergedRows.filter((row) => row.clicks > 0 || row.clicked_at).length;

      setHistoryState((prev) => ({
        ...prev,
        automationId: automation.id,
        filter: nextFilter,
        statusFilter: nextStatusFilter,
        customDate: nextCustomDate,
        limit: nextLimit,
        loading: false,
        error: '',
        rows: mergedRows,
        summary: {
          total: totalCount || mergedRows.length,
          shown: mergedRows.length,
          sent: sentCount,
          opened: openedCount,
          clicked: clickedCount,
          openRate: sentCount > 0 ? (openedCount / sentCount) * 100 : 0,
          clickRate: sentCount > 0 ? (clickedCount / sentCount) * 100 : 0,
          statusCounts
        }
      }));
    } catch (error) {
      console.error('Error loading automation history:', error);
      setHistoryState((prev) => ({
        ...prev,
        automationId: automation.id,
        loading: false,
        error: error.message || 'Unable to load automation history'
      }));
      toast.error('Unable to load automation history');
    }
  };

  if (authLoading || permissionsLoading) {
    return (
      <POSAuthWrapper>
        <div style={styles.container}>
          <MailModuleHeader
            actionLabel="+ Automation"
            actionPath="/dashboard/mail/builder?mode=automation&automationType=custom"
          />
          <div style={styles.loadingState}>
            <FiRefreshCw style={styles.loadingIcon} />
            <p>Loading automations...</p>
          </div>
        </div>
      </POSAuthWrapper>
    );
  }

  if (authError) {
    return (
      <POSAuthWrapper>
        <div style={styles.container}>
          <MailModuleHeader
            actionLabel="+ Automation"
            actionPath="/dashboard/mail/builder?mode=automation&automationType=custom"
          />
          <div style={styles.errorCard}>
            <h2 style={styles.errorTitle}>Authentication Error</h2>
            <p style={styles.errorText}>{authError}</p>
          </div>
        </div>
      </POSAuthWrapper>
    );
  }

  if (!canViewAutomations) {
    return null;
  }

  return (
    <POSAuthWrapper>
      <SecurityWrapper componentName="MailAutomations" sensitiveComponent={false}>
        <div style={styles.container}>
          <MailModuleHeader
            actionLabel="+ Automation"
            actionPath="/dashboard/mail/builder?mode=automation&automationType=custom"
          />

          <MailModuleSubTabs
            tabs={AUTOMATION_TABS}
            activeTab={activeAutomationTab}
            onTabChange={setActiveAutomationTab}
            ariaLabel="Mail automations navigation"
          />

          {activeAutomationTab === 'daily-digest' && (
            <MailDailyDigestTab
              businessId={businessId}
              businessData={businessData}
              canManageDigest={canCreateCampaigns || hasElevatedPrivileges}
            />
          )}

          {activeAutomationTab !== 'daily-digest' && (
          <div style={styles.heroCard}>
            <div>
              <div style={styles.eyebrow}>Recurring Campaigns</div>
              <h1 style={styles.title}>Mail Automations</h1>
              <p style={styles.subtitle}>
                Keep recurring campaigns separate from one-time sends while reusing the same
                contacts, consent, reporting, and delivery infrastructure.
              </p>
            </div>
            <div style={styles.heroActions}>
              <button
                type="button"
                style={styles.primaryButton}
                onClick={() => openAutomationBuilder('custom')}
                disabled={!canCreateCampaigns}
              >
                <FiMail />
                Start From Builder
              </button>
              <button
                type="button"
                style={styles.secondaryButton}
                onClick={() => navigate('/dashboard/mail/contacts')}
                disabled={!canManageContacts}
              >
                <FiUsers />
                Review Contacts
              </button>
            </div>
          </div>
          )}

          {activeAutomationTab === 'overview' && (
            <div style={styles.infoGrid}>
              <div style={styles.infoPanel}>
                <div style={styles.infoHeader}>
                  <FiClock />
                  <span>Recommended Automations</span>
                </div>
                <p style={styles.infoText}>
                  Start with birthday promos, camp promotions, and inactive-customer win-back
                  campaigns. These map directly to the audience rules you described.
                </p>
              </div>
              <div style={styles.infoPanel}>
                <div style={styles.infoHeader}>
                  <FiStar />
                  <span>Default Personalization</span>
                </div>
                <p style={styles.infoText}>
                  Every automation should support recipient name and loyalty points at the top of
                  the email so messages feel personal before the main offer.
                </p>
              </div>
            </div>
          )}

          {activeAutomationTab === 'blueprints' && (
          <div style={styles.section}>
            <h2 style={styles.sectionTitle}>Automation Blueprints</h2>
            <div style={styles.cardGrid}>
              {AUTOMATION_BLUEPRINTS.map((automation) => {
                const Icon = automation.icon;
                return (
                  <div key={automation.id} style={styles.automationCard}>
                    <div style={styles.automationContent}>
                      <div style={styles.automationHeader}>
                        <div
                          style={{
                            ...styles.automationIconWrap,
                            backgroundColor: `${automation.accent}15`,
                            color: automation.accent
                          }}
                        >
                          <Icon />
                        </div>
                        <div>
                          <h3 style={styles.automationTitle}>{automation.title}</h3>
                          <div style={styles.metaLabel}>Trigger</div>
                          <p style={styles.metaText}>{automation.trigger}</p>
                        </div>
                      </div>

                      <div style={styles.automationDetails}>
                        <div>
                          <div style={styles.metaLabel}>Audience Criteria</div>
                          <div style={styles.tagWrap}>
                            {automation.criteria.map((item) => (
                              <span key={item} style={styles.tag}>{item}</span>
                            ))}
                          </div>
                        </div>

                        <div>
                          <div style={styles.metaLabel}>Top-of-Email Personalization</div>
                          <div style={styles.tagWrap}>
                            {automation.personalization.map((item) => (
                              <span key={item} style={styles.tag}>{item}</span>
                            ))}
                          </div>
                        </div>
                      </div>

                      {automation.id === 'waiver-check-in-review' && (
                        <div style={styles.blueprintReputationBlock}>
                          <div style={styles.metaLabel}>Delay after check-in (hours)</div>
                          <p style={styles.blueprintReputationHint}>
                            <strong>0</strong> sends as soon as check-in is saved. Otherwise the review email is queued
                            for that many hours after check-in (max 168 hours / 7 days). Stored with your reputation
                            settings — also under{' '}
                            <Link to="/dashboard/reputation/settings" style={{ color: '#7c3aed', fontWeight: 600 }}>
                              Reputation → settings
                            </Link>{' '}
                            (as minutes).
                          </p>
                          <div style={styles.blueprintDelayRow}>
                            <input
                              type="number"
                              min={0}
                              max={168}
                              step="any"
                              value={waiverCheckInReviewDelayHours}
                              disabled={waiverCheckInDelayLoading || !canCreateCampaigns}
                              onChange={(e) => {
                                const n = parseFloat(e.target.value);
                                setWaiverCheckInReviewDelayHours(Number.isFinite(n) ? n : 0);
                              }}
                              style={styles.blueprintDelayInput}
                              aria-label="Hours to wait after check-in before sending review email"
                            />
                            <button
                              type="button"
                              style={styles.blueprintDelaySaveButton}
                              onClick={() => void saveWaiverCheckInReviewDelay()}
                              disabled={
                                waiverCheckInDelayLoading ||
                                waiverCheckInDelaySaving ||
                                !canCreateCampaigns
                              }
                            >
                              {waiverCheckInDelaySaving ? 'Saving…' : 'Save delay'}
                            </button>
                          </div>
                          {waiverCheckInDelayLoading && (
                            <p style={styles.blueprintReputationMuted}>Loading current delay…</p>
                          )}
                        </div>
                      )}
                    </div>
                    <div style={styles.automationAction}>
                      <button
                        type="button"
                        style={styles.cardButton}
                        onClick={() => openAutomationBuilder(automation.automationType || automation.id, automation.automationSource || '')}
                        disabled={!canCreateCampaigns}
                      >
                        <FiEdit3 />
                        Build This Automation
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          )}

          {activeAutomationTab === 'saved' && (
          <div style={styles.section}>
            <div style={styles.savedSectionHeader}>
              <h2 style={{ ...styles.sectionTitle, marginBottom: 0 }}>Saved Automations</h2>
              <button
                type="button"
                style={styles.nameOfDaySettingsButton}
                onClick={() => setNameOfDayModalOpen(true)}
                disabled={!businessId}
              >
                <FiAward />
                Name of the Day scoring
              </button>
            </div>
            <p style={styles.savedToolbarHint}>
              Configure daily name picks, weekday profiles, and scoring weights for Name of the Day emails (stored per business).
            </p>
            <div style={styles.savedPanel}>
              {loadingAutomations ? (
                <div style={styles.savedState}>Loading saved automations...</div>
              ) : automationLoadError ? (
                <div style={styles.savedState}>{automationLoadError}</div>
              ) : automations.length === 0 ? (
                <div style={styles.savedState}>No automations saved yet. Start from a blueprint or use the builder to create one.</div>
              ) : (
                <div style={styles.savedList}>
                  {automations.map((automation) => {
                    const isBirthdayAutomation = automation.automation_type === 'birthday';
                    const isWaiverCheckInReview =
                      automation.automation_type === 'custom' &&
                      String(automation.criteria?.source || '') === 'waiver_check_in_review';
                    const isNameOfDayAutomation =
                      automation.automation_type === 'custom' &&
                      String(automation.criteria?.source || '') === 'name_of_day';
                    const isToddlerThursdayAutomation =
                      automation.automation_type === 'custom' &&
                      String(automation.criteria?.source || '') === 'toddler_thursday';
                    const isPreviewOpen = previewState.automationId === automation.id;
                    const isHistoryOpen = historyState.automationId === automation.id;
                    const preview = isPreviewOpen ? previewState.result?.preview : null;
                    const historySummary = isHistoryOpen ? historyState.summary : null;
                    const historyRows = isHistoryOpen ? historyState.rows : [];
                    const recipients = preview?.recipients || [];

                    return (
                      <div key={automation.id} style={styles.savedAutomationBlock}>
                        <div style={styles.savedItem}>
                          <div>
                            <div style={styles.savedTitle}>{automation.name}</div>
                            <div style={styles.savedMeta}>
                              {AUTOMATION_BLUEPRINTS.find((item) => item.automationSource === automation.criteria?.source || item.id === automation.automation_type)?.title || automation.automation_type}
                              {' · '}
                              {automation.trigger_timing.replace(/_/g, ' ')}
                              {' · '}
                              {isWaiverCheckInReview
                                ? formatWaiverCheckInDelayShort(
                                    waiverDelayMinutesFromHours(waiverCheckInReviewDelayHours),
                                  )
                                : isToddlerThursdayAutomation
                                  ? 'Thu 6–9 AM · bi-weekly Toddler Thursdays'
                                  : `offset ${automation.days_offset} days`}
                              {' · '}
                              campaign {automation.campaign?.name || 'Untitled'}
                            </div>
                          </div>
                          <div style={styles.savedActions}>
                            <span
                              style={{
                                ...styles.statusPill,
                                backgroundColor: automation.is_enabled ? '#ccfbf1' : '#f3f4f6',
                                color: automation.is_enabled ? '#115e59' : '#4b5563'
                              }}
                            >
                              {automation.is_enabled ? 'on' : 'off'}
                            </span>
                            <span style={styles.statusPill}>{automation.status}</span>
                            {(isBirthdayAutomation || isNameOfDayAutomation || isToddlerThursdayAutomation) && (
                              <button
                                type="button"
                                style={styles.secondaryButton}
                                onClick={() => loadAutomationPreview(automation)}
                              >
                                <FiSearch />
                                Preview Sends
                              </button>
                            )}
                            <button
                              type="button"
                              style={styles.secondaryButton}
                              onClick={() => {
                                if (isHistoryOpen) {
                                  setHistoryState((prev) => ({ ...prev, automationId: null }));
                                } else {
                                  loadAutomationHistory(automation, 'all', historyState.customDate, 50, 'all');
                                }
                              }}
                            >
                              <FiEye />
                              Sending History
                            </button>
                            <button
                              type="button"
                              style={styles.secondaryButton}
                              onClick={() => toggleAutomationEnabled(automation)}
                              disabled={!canCreateCampaigns}
                            >
                              <FiClock />
                              {automation.is_enabled ? 'Turn Off' : 'Turn On'}
                            </button>
                            <button type="button" style={styles.secondaryButton} onClick={() => editAutomation(automation)}>
                              <FiEdit3 />
                              Edit
                            </button>
                          </div>
                        </div>

                        {isHistoryOpen && (
                          <div style={styles.previewPanel}>
                            <div style={styles.previewHeader}>
                              <div>
                                <div style={styles.previewTitle}>Sending History</div>
                                <div style={styles.previewHelp}>
                                  Shows actual automation runs, delivery status, suppression/failure notes, and engagement for this saved automation.
                                </div>
                              </div>
                              <div style={styles.previewControls}>
                                {['all', 'today', 'tomorrow', 'yesterday'].map((filter) => (
                                  <button
                                    key={filter}
                                    type="button"
                                    style={{
                                      ...styles.filterButton,
                                      ...(historyState.filter === filter ? styles.filterButtonActive : {})
                                    }}
                                    onClick={() => loadAutomationHistory(automation, filter, historyState.customDate, 50, historyState.statusFilter)}
                                    disabled={historyState.loading}
                                  >
                                    {filter === 'all' ? 'All Time' : filter.charAt(0).toUpperCase() + filter.slice(1)}
                                  </button>
                                ))}
                                <input
                                  type="date"
                                  value={historyState.customDate}
                                  onChange={(event) => {
                                    const nextDate = event.target.value;
                                    setHistoryState((prev) => ({ ...prev, customDate: nextDate }));
                                    loadAutomationHistory(automation, 'custom', nextDate, 50, historyState.statusFilter);
                                  }}
                                  style={styles.dateInput}
                                />
                              </div>
                            </div>
                            <div style={styles.historyFilterRow}>
                              {[
                                ['all', 'All Statuses'],
                                ['queued', 'Queued'],
                                ['sent', 'Sent'],
                                ['retrying', 'Retrying'],
                                ['failed', 'Failed'],
                                ['cancelled', 'Cancelled']
                              ].map(([status, label]) => (
                                <button
                                  key={status}
                                  type="button"
                                  style={{
                                    ...styles.filterButton,
                                    ...(historyState.statusFilter === status ? styles.filterButtonActive : {})
                                  }}
                                  onClick={() => loadAutomationHistory(automation, historyState.filter, historyState.customDate, 50, status)}
                                  disabled={historyState.loading}
                                >
                                  {label}
                                </button>
                              ))}
                            </div>

                            {historyState.error ? (
                              <div style={styles.previewError}>{historyState.error}</div>
                            ) : historyState.loading ? (
                              <div style={styles.savedState}>Loading sending history...</div>
                            ) : historySummary ? (
                              <>
                                <div style={styles.previewSummaryGrid}>
                                  <div style={styles.previewSummaryCard}>
                                    <span style={styles.previewSummaryLabel}>Rows shown</span>
                                    <strong>{historySummary.shown} of {historySummary.total}</strong>
                                  </div>
                                  <div style={styles.previewSummaryCard}>
                                    <span style={styles.previewSummaryLabel}>Sent</span>
                                    <strong>{historySummary.sent}</strong>
                                  </div>
                                  <div style={styles.previewSummaryCard}>
                                    <span style={styles.previewSummaryLabel}>Open rate</span>
                                    <strong>{historySummary.openRate.toFixed(1)}%</strong>
                                  </div>
                                  <div style={styles.previewSummaryCard}>
                                    <span style={styles.previewSummaryLabel}>Click rate</span>
                                    <strong>{historySummary.clickRate.toFixed(1)}%</strong>
                                  </div>
                                  <div style={styles.previewSummaryCard}>
                                    <span style={styles.previewSummaryLabel}>Status mix</span>
                                    <strong>
                                      {Object.entries(historySummary.statusCounts || {})
                                        .map(([status, count]) => `${status}: ${count}`)
                                        .join(' · ') || 'No runs'}
                                    </strong>
                                  </div>
                                </div>

                                {historyRows.length === 0 ? (
                                  <div style={styles.savedState}>No sending history found for this filter.</div>
                                ) : (
                                  <>
                                    <div style={styles.previewTableWrap}>
                                      <table style={styles.previewTable}>
                                        <thead>
                                          <tr>
                                            <th style={styles.previewTh}>Queued</th>
                                            <th style={styles.previewTh}>Scheduled</th>
                                            <th style={styles.previewTh}>Email</th>
                                            <th style={styles.previewTh}>Status</th>
                                            <th style={styles.previewTh}>Sent</th>
                                            <th style={styles.previewTh}>Opens</th>
                                            <th style={styles.previewTh}>Clicks</th>
                                            <th style={styles.previewTh}>Details</th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {historyRows.map((row) => (
                                            <tr key={row.id}>
                                              <td style={styles.previewTd}>{row.queued_at ? new Date(row.queued_at).toLocaleString() : '-'}</td>
                                              <td style={styles.previewTd}>{row.scheduled_for ? new Date(row.scheduled_for).toLocaleString() : '-'}</td>
                                              <td style={styles.previewTd}>{row.email_address}</td>
                                              <td style={styles.previewTd}>
                                                <span
                                                  style={{
                                                    ...styles.statusPill,
                                                    backgroundColor: row.status === 'sent' ? '#dcfce7' : row.status === 'failed' ? '#fee2e2' : row.status === 'cancelled' ? '#fef3c7' : '#e0f2fe',
                                                    color: row.status === 'sent' ? '#166534' : row.status === 'failed' ? '#991b1b' : row.status === 'cancelled' ? '#92400e' : '#075985'
                                                  }}
                                                >
                                                  {row.status || row.queue_status || 'unknown'}
                                                </span>
                                              </td>
                                              <td style={styles.previewTd}>{row.sent_at ? new Date(row.sent_at).toLocaleString() : '-'}</td>
                                              <td style={styles.previewTd}>{row.opens || (row.opened_at ? 1 : 0)}</td>
                                              <td style={styles.previewTd}>{row.clicks || (row.clicked_at ? 1 : 0)}</td>
                                              <td style={styles.previewTd}>{row.last_error || row.queue_error || row.send_error || '-'}</td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    </div>
                                    {historySummary.total > historyState.limit && (
                                      <button
                                        type="button"
                                        style={{ ...styles.secondaryButton, marginTop: '12px' }}
                                        onClick={() => loadAutomationHistory(automation, historyState.filter, historyState.customDate, historyState.limit + 50, historyState.statusFilter)}
                                        disabled={historyState.loading}
                                      >
                                        <FiRefreshCw />
                                        Show More
                                      </button>
                                    )}
                                  </>
                                )}
                              </>
                            ) : null}
                          </div>
                        )}

                        {isPreviewOpen && (
                          <div style={styles.previewPanel}>
                            <div style={styles.previewHeader}>
                              <div>
                                <div style={styles.previewTitle}>Send Preview</div>
                                <div style={styles.previewHelp}>
                                  {previewState.previewKind === 'name_of_day'
                                    ? 'Pick a date and Check Date for recipients. First section: girl/boy names per calendar day; below that: optional manual name pool (Girl/Boy checkboxes).'
                                    : previewState.previewKind === 'toddler_thursday'
                                      ? 'Pick a Thursday send date to see which marketing contacts would receive this bi-weekly Toddler Thursday promo (50/50 cohort for that week). Sends 6–9 AM local on promo Thursdays.'
                                      : 'Pick a send date to see which parent/guardian emails would receive this birthday automation.'}
                                </div>
                              </div>
                              <div style={styles.previewControls}>
                                <input
                                  type="date"
                                  value={previewState.date}
                                  onChange={(event) => updatePreviewDate(automation, event.target.value)}
                                  style={styles.dateInput}
                                />
                                <button
                                  type="button"
                                  style={styles.primaryButton}
                                  onClick={() => loadAutomationPreview(automation, previewState.date)}
                                  disabled={previewState.loading || nodForceQueuing || nodRegenerating}
                                >
                                  <FiRefreshCw />
                                  {previewState.loading ? 'Checking...' : 'Check Date'}
                                </button>
                                {previewState.previewKind === 'name_of_day' ? (
                                  <button
                                    type="button"
                                    style={styles.secondaryButton}
                                    onClick={() => forceQueueNameOfDaySends()}
                                    disabled={
                                      !canEditNameOfDayPicks ||
                                      nodForceQueuing ||
                                      nodRegenerating ||
                                      previewState.loading
                                    }
                                    title={
                                      canEditNameOfDayPicks
                                        ? 'Enqueue today’s Name-of-Day emails now (ignores the daily send clock). Requires enabled automation + today’s picks.'
                                        : 'Campaign creation or elevated access required'
                                    }
                                  >
                                    <FiSend size={16} style={{ marginRight: 6, verticalAlign: 'middle' }} aria-hidden />
                                    {nodForceQueuing ? 'Queueing…' : 'Force queue today'}
                                  </button>
                                ) : null}
                              </div>
                            </div>

                            {previewState.previewKind === 'name_of_day' && businessData && (
                              <>
                              <div style={styles.nodCalendarSection}>
                                <button
                                  type="button"
                                  onClick={() => setNodCalendarOpen((o) => !o)}
                                  aria-expanded={nodCalendarOpen}
                                  style={{
                                    width: '100%',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    gap: '12px',
                                    padding: '12px 14px',
                                    marginBottom: nodCalendarOpen ? '12px' : '0',
                                    border: '1px solid #e2e8f0',
                                    borderRadius: '10px',
                                    backgroundColor: '#fff',
                                    cursor: 'pointer',
                                    textAlign: 'left'
                                  }}
                                >
                                  <span style={{ display: 'flex', alignItems: 'center', gap: '10px', fontWeight: 700, fontSize: '14px', color: '#0f172a' }}>
                                    <FiCalendar style={{ flexShrink: 0 }} aria-hidden />
                                    Name-of-Day picks by date
                                    <span style={{ fontWeight: 500, fontSize: '13px', color: '#64748b' }}>
                                      ({nodCalendarOpen ? 'hide' : 'show'} calendar)
                                    </span>
                                  </span>
                                  <FiChevronDown
                                    size={22}
                                    aria-hidden
                                    style={{
                                      flexShrink: 0,
                                      color: '#64748b',
                                      transform: nodCalendarOpen ? 'rotate(180deg)' : 'none',
                                      transition: 'transform 0.2s ease'
                                    }}
                                  />
                                </button>
                                {nodCalendarOpen ? (
                                  <>
                                    {nodRegenerating ? (
                                      <div
                                        role="status"
                                        aria-live="polite"
                                        style={{
                                          marginBottom: 16,
                                          marginTop: 14,
                                          padding: '12px 14px',
                                          borderRadius: 8,
                                          backgroundColor: '#eff6ff',
                                          border: '1px solid #93c5fd',
                                          color: '#1e3a8a',
                                          fontSize: 14,
                                          lineHeight: 1.45
                                        }}
                                      >
                                        <strong>Filling the next open day…</strong> One request adds one date (the first day from today
                                        forward that doesn&apos;t already have picks). Keep this tab open — usually a few seconds.
                                      </div>
                                    ) : null}
                                    <div style={{ ...styles.nodCalendarToolbar, marginTop: 14 }}>
                                      <div style={styles.nodCalendarToolbarText}>
                                        <p style={{ ...styles.nodCalendarHint, margin: 0 }}>
                                          <strong>This table is the daily mail merge pair</strong> (girl + boy for each calendar date). Type
                                          names and click <strong>Save row</strong>, or use <strong>Add next open day</strong> to auto-fill the next empty date.{' '}
                                          The checklist further down only controls which first names are allowed in the pool — it does not choose Ryan/Reagan for a specific day.
                                        </p>
                                      </div>
                                      <button
                                        type="button"
                                        style={styles.secondaryButton}
                                        onClick={() => regenerateNameOfDayCalendarPicks()}
                                        disabled={!canEditNameOfDayPicks || nodRegenerating || nodForceQueuing}
                                        title={
                                          canEditNameOfDayPicks
                                            ? 'Finds the first calendar day from today that needs picks and generates girl/boy names for that day only. Click again for the next day.'
                                            : 'Campaign creation or elevated access required'
                                        }
                                      >
                                        <FiRefreshCw
                                          size={16}
                                          style={{ opacity: nodRegenerating ? 0.6 : 1, verticalAlign: 'middle', marginRight: 6 }}
                                          aria-hidden
                                        />
                                        {nodRegenerating ? 'Working…' : 'Add next open day'}
                                      </button>
                                    </div>
                                    <div style={styles.previewTableWrap}>
                                      <table style={styles.previewTable}>
                                        <thead>
                                          <tr>
                                            <th style={styles.previewTh}>Date</th>
                                            <th style={styles.previewTh}>Girl name</th>
                                            <th style={styles.previewTh}>Boy name</th>
                                            <th style={styles.previewTh}>Source</th>
                                            <th style={styles.previewTh}> </th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {nodCalendarGridRows.map((row) => {
                                            const tz = getBusinessTimezone(businessData);
                                            const weekday = dayjs.tz(row.local_date, tz).format('ddd');
                                            const sourcePending = row.pick_source === 'pending';
                                            const sourceLabel = sourcePending
                                              ? 'Not picked yet'
                                              : row.pick_source === 'user_edited'
                                                ? 'User edited'
                                                : 'Auto';
                                            return (
                                              <tr
                                                key={row.local_date}
                                                style={
                                                  row.local_date === previewState.date
                                                    ? { backgroundColor: '#fffbeb' }
                                                    : undefined
                                                }
                                              >
                                                <td style={styles.previewTd}>
                                                  <strong>{weekday}</strong> {row.local_date}
                                                </td>
                                                <td style={styles.previewTd}>
                                                  <input
                                                    type="text"
                                                    aria-label={`Girl name for ${row.local_date}`}
                                                    style={styles.nodPickInput}
                                                    value={row.girl_display_name || ''}
                                                    onChange={(e) =>
                                                      updateNodCalendarPickField(
                                                        row.local_date,
                                                        'girl_display_name',
                                                        e.target.value
                                                      )
                                                    }
                                                    disabled={!canEditNameOfDayPicks}
                                                  />
                                                </td>
                                                <td style={styles.previewTd}>
                                                  <input
                                                    type="text"
                                                    aria-label={`Boy name for ${row.local_date}`}
                                                    style={styles.nodPickInput}
                                                    value={row.boy_display_name || ''}
                                                    onChange={(e) =>
                                                      updateNodCalendarPickField(
                                                        row.local_date,
                                                        'boy_display_name',
                                                        e.target.value
                                                      )
                                                    }
                                                    disabled={!canEditNameOfDayPicks}
                                                  />
                                                </td>
                                                <td style={styles.previewTd}>
                                                  {sourcePending ? (
                                                    <span style={styles.statusPillPending}>{sourceLabel}</span>
                                                  ) : row.pick_source === 'user_edited' ? (
                                                    <span style={{ ...styles.statusPillSaved, backgroundColor: '#dbeafe', color: '#1e40af' }}>
                                                      {sourceLabel}
                                                    </span>
                                                  ) : (
                                                    <span style={styles.statusPillSaved}>{sourceLabel}</span>
                                                  )}
                                                </td>
                                                <td style={styles.previewTd}>
                                                  <button
                                                    type="button"
                                                    style={{
                                                      ...styles.secondaryButton,
                                                      padding: '8px 12px',
                                                      fontSize: '13px',
                                                      display: 'inline-flex',
                                                      alignItems: 'center',
                                                      gap: 6,
                                                      whiteSpace: 'nowrap'
                                                    }}
                                                    onClick={() => void saveNodPickRow(row.local_date)}
                                                    disabled={
                                                      !canEditNameOfDayPicks || savingNodPickDate === row.local_date
                                                    }
                                                  >
                                                    <FiSave size={14} aria-hidden />
                                                    {savingNodPickDate === row.local_date ? '…' : 'Save row'}
                                                  </button>
                                                </td>
                                              </tr>
                                            );
                                          })}
                                        </tbody>
                                      </table>
                                    </div>
                                  </>
                                ) : null}
                              </div>
                              <NameOfDayManualBuckets
                                businessId={businessId}
                                businessName={businessData?.name || ''}
                                canEdit={canEditNameOfDayPicks}
                              />
                              </>
                            )}

                            {previewState.error ? (
                              <div style={styles.previewError}>{previewState.error}</div>
                            ) : previewState.loading ? (
                              <div style={styles.savedState}>Loading preview...</div>
                            ) : previewState.result?.supported === false ? (
                              <div style={styles.previewNote}>{previewState.result.message}</div>
                            ) : preview?.preview_kind === 'name_of_day' ? (
                              <>
                                <div style={styles.previewSummaryGrid}>
                                  <div style={styles.previewSummaryCard}>
                                    <span style={styles.previewSummaryLabel}>Calendar day</span>
                                    <strong>{preview.send_date}</strong>
                                  </div>
                                  <div style={styles.previewSummaryCard}>
                                    <span style={styles.previewSummaryLabel}>Girl name (day)</span>
                                    <strong>{preview.pick_status === 'picked' ? preview.girl_display_name : '—'}</strong>
                                  </div>
                                  <div style={styles.previewSummaryCard}>
                                    <span style={styles.previewSummaryLabel}>Boy name (day)</span>
                                    <strong>{preview.pick_status === 'picked' ? preview.boy_display_name : '—'}</strong>
                                  </div>
                                  <div style={styles.previewSummaryCard}>
                                    <span style={styles.previewSummaryLabel}>Emails that would send</span>
                                    <strong>{preview.counts?.recipients ?? 0}</strong>
                                  </div>
                                  <div style={styles.previewSummaryCard}>
                                    <span style={styles.previewSummaryLabel}>
                                      {preview.pick_status === 'picked'
                                        ? 'Minors matching names'
                                        : 'Minors in pool'}
                                    </span>
                                    <strong>
                                      {preview.counts?.minors_in_pool != null
                                        ? preview.counts.minors_in_pool
                                        : '—'}
                                    </strong>
                                  </div>
                                </div>
                                {preview.counts?.minors_in_pool_note ? (
                                  <div style={{ ...styles.previewNote, fontSize: '13px', marginTop: -6 }}>
                                    {preview.counts.minors_in_pool_note}
                                  </div>
                                ) : null}
                                <div style={styles.previewNote}>
                                  {preview.one_pair_per_day}
                                  {preview.pick_status === 'not_yet_picked' && preview.explanation
                                    ? ` ${preview.explanation}`
                                    : ''}
                                </div>
                                {preview.pick_status === 'not_yet_picked' ? (
                                  <div style={styles.savedState}>
                                    No girl/boy pair for this date yet—check the calendar above once the daily job has run.
                                  </div>
                                ) : recipients.length === 0 ? (
                                  <div style={styles.savedState}>
                                    No guardian emails would receive this send on this date (no matching minors with marketing-eligible contacts).
                                  </div>
                                ) : (
                                  <div style={styles.previewTableWrap}>
                                    <table style={styles.previewTable}>
                                      <thead>
                                        <tr>
                                          <th style={styles.previewTh}>Email</th>
                                          <th style={styles.previewTh}>Recipient</th>
                                          <th style={styles.previewTh}>Winning minors</th>
                                          <th style={styles.previewTh}>Points</th>
                                          <th style={styles.previewTh}>Already queued/sent</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {recipients.map((recipient) => (
                                          <tr key={`${recipient.contact_id}-${recipient.delivery_key}`}>
                                            <td style={styles.previewTd}>{recipient.email_address}</td>
                                            <td style={styles.previewTd}>
                                              {[recipient.recipient_first_name, recipient.recipient_last_name]
                                                .filter(Boolean)
                                                .join(' ') || 'No name'}
                                            </td>
                                            <td style={styles.previewTd}>
                                              {recipient.winning_slots || recipient.minor_first_name || '—'}
                                            </td>
                                            <td style={styles.previewTd}>{recipient.loyalty_points ?? 0}</td>
                                            <td style={styles.previewTd}>
                                              {recipient.already_has_run_for_date ? 'Yes' : 'No'}
                                            </td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                )}
                              </>
                            ) : preview?.preview_kind === 'toddler_thursday' ? (
                              <>
                                {preview.explanation ? (
                                  <div style={styles.previewNote}>{preview.explanation}</div>
                                ) : null}
                                <div style={styles.previewSummaryGrid}>
                                  <div style={styles.previewSummaryCard}>
                                    <span style={styles.previewSummaryLabel}>Send date (Thu)</span>
                                    <strong>{preview.send_date}</strong>
                                  </div>
                                  <div style={styles.previewSummaryCard}>
                                    <span style={styles.previewSummaryLabel}>Promo Thursday</span>
                                    <strong>{preview.promo_thursday_display || preview.event_date || '—'}</strong>
                                  </div>
                                  <div style={styles.previewSummaryCard}>
                                    <span style={styles.previewSummaryLabel}>Active cohort this week</span>
                                    <strong>{preview.active_cohort || '—'}</strong>
                                  </div>
                                  <div style={styles.previewSummaryCard}>
                                    <span style={styles.previewSummaryLabel}>New emails to queue</span>
                                    <strong>{preview.counts?.recipients_new ?? preview.counts?.recipients ?? 0}</strong>
                                  </div>
                                  <div style={styles.previewSummaryCard}>
                                    <span style={styles.previewSummaryLabel}>Eligible pool (all toddlers)</span>
                                    <strong>{preview.counts?.eligible_pool ?? 0}</strong>
                                  </div>
                                  <div style={styles.previewSummaryCard}>
                                    <span style={styles.previewSummaryLabel}>Inactive cohort (skipped)</span>
                                    <strong>{preview.counts?.inactive_cohort ?? 0}</strong>
                                  </div>
                                  <div style={styles.previewSummaryCard}>
                                    <span style={styles.previewSummaryLabel}>Toddler age band</span>
                                    <strong>{preview.toddler_age_band || '1-3'}</strong>
                                  </div>
                                  <div style={styles.previewSummaryCard}>
                                    <span style={styles.previewSummaryLabel}>Send window</span>
                                    <strong>{formatPreviewSendWindow(preview.send_window)}</strong>
                                  </div>
                                </div>
                                <div style={styles.previewNote}>
                                  Targets guardians with at least one toddler age {preview.toddler_age_band || '1–3'} on any waiver (including expired). Marketing consent required.
                                  {preview.counts?.segment_filtered > 0
                                    ? ` ${preview.counts.segment_filtered} contact(s) excluded by segment filter.`
                                    : ''}
                                  {preview.counts?.with_expired_waiver > 0
                                    ? ` ${preview.counts.with_expired_waiver} recipient(s) only have expired waivers but remain eligible.`
                                    : ''}
                                </div>
                                {recipients.length === 0 ? (
                                  <div style={styles.savedState}>
                                    {preview.schedule_status && preview.schedule_status !== 'ok'
                                      ? 'No send on this date — adjust the send date or promo anchor.'
                                      : 'No eligible Toddler Thursday emails would send on this date.'}
                                  </div>
                                ) : (
                                  <div style={styles.previewTableWrap}>
                                    <table style={styles.previewTable}>
                                      <thead>
                                        <tr>
                                          <th style={styles.previewTh}>Email</th>
                                          <th style={styles.previewTh}>Recipient</th>
                                          <th style={styles.previewTh}>Toddlers</th>
                                          <th style={styles.previewTh}>Names</th>
                                          <th style={styles.previewTh}>Cohort</th>
                                          <th style={styles.previewTh}>Already Queued</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {recipients.map((recipient) => (
                                          <tr key={`${recipient.contact_id}-${recipient.delivery_key}`}>
                                            <td style={styles.previewTd}>{recipient.email_address}</td>
                                            <td style={styles.previewTd}>
                                              {[recipient.recipient_first_name, recipient.recipient_last_name]
                                                .filter(Boolean)
                                                .join(' ') || 'No name'}
                                            </td>
                                            <td style={styles.previewTd}>{recipient.toddler_count ?? '—'}</td>
                                            <td style={styles.previewTd}>{recipient.toddler_names || '—'}</td>
                                            <td style={styles.previewTd}>{recipient.active_cohort || preview.active_cohort}</td>
                                            <td style={styles.previewTd}>
                                              {recipient.already_has_run_for_date ? 'Yes' : 'No'}
                                            </td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                )}
                              </>
                            ) : preview?.preview_kind === 'birthday' || preview?.event_date ? (
                              <>
                                <div style={styles.previewSummaryGrid}>
                                  <div style={styles.previewSummaryCard}>
                                    <span style={styles.previewSummaryLabel}>Send date</span>
                                    <strong>{preview.send_date}</strong>
                                  </div>
                                  <div style={styles.previewSummaryCard}>
                                    <span style={styles.previewSummaryLabel}>Birthday date targeted</span>
                                    <strong>{preview.event_date}</strong>
                                  </div>
                                  <div style={styles.previewSummaryCard}>
                                    <span style={styles.previewSummaryLabel}>New emails to queue today</span>
                                    <strong>{preview.counts?.recipients ?? 0}</strong>
                                  </div>
                                  <div style={styles.previewSummaryCard}>
                                    <span style={styles.previewSummaryLabel}>Already queued for this send date</span>
                                    <strong>{preview.counts?.recipients_already_queued_for_send_date ?? 0}</strong>
                                  </div>
                                  <div style={styles.previewSummaryCard}>
                                    <span style={styles.previewSummaryLabel}>Eligible after filters (cohort)</span>
                                    <strong>{preview.counts?.recipients_eligible_in_cohort ?? 0}</strong>
                                  </div>
                                  <div style={styles.previewSummaryCard}>
                                    <span style={styles.previewSummaryLabel}>Minor birthdays found (raw)</span>
                                    <strong>{preview.counts?.matching_minor_birthdays ?? 0}</strong>
                                  </div>
                                  <div style={styles.previewSummaryCard}>
                                    <span style={styles.previewSummaryLabel}>Data source</span>
                                    <strong>Modern minors + legacy minors</strong>
                                  </div>
                                  <div style={styles.previewSummaryCard}>
                                    <span style={styles.previewSummaryLabel}>Max age rule</span>
                                    <strong>{preview.max_child_age_rule_applied ? `On: ${preview.max_child_age} and under` : 'Off'}</strong>
                                  </div>
                                  <div style={styles.previewSummaryCard}>
                                    <span style={styles.previewSummaryLabel}>Send window</span>
                                    <strong>{formatPreviewSendWindow(preview.send_window)}</strong>
                                  </div>
                                </div>
                                <div style={styles.previewNote}>
                                  This preview uses modern <code>waiver_participants</code> where <code>participant_type = minor</code>, plus imported <code>legacy_waivers.legacy_minors</code>, and minors parsed from JSON in <code>legacy_waivers.info</code> / <code>legacy_waivers.notes</code> when those fields contain <code>minors</code>, <code>children</code>, or <code>child_participants</code> arrays (same shapes as the waiver dashboard). Adult/signature birthdates are not used for birthday automation targeting.
                                  {preview.send_window?.time_zone ? ` Emails are spread hourly between ${formatPreviewSendWindow(preview.send_window)} in ${preview.send_window.time_zone}.` : ''}
                                  {preview.counts?.legacy_minor_birthdays > 0 ? ` ${preview.counts.legacy_minor_birthdays} matching legacy minor birthday row(s) were found.` : ''}
                                  {preview.counts?.missing_or_unconsented_mail_contact > 0 ? ` ${preview.counts.missing_or_unconsented_mail_contact} matching minor birthday row(s) were excluded because the parent email is missing or not marketing-eligible.` : ''}
                                  {preview.counts?.segment_filtered > 0 ? ` ${preview.counts.segment_filtered} row(s) were filtered out by the selected segment.` : ''}
                                  {preview.counts?.max_child_age_filtered > 0 ? ` ${preview.counts.max_child_age_filtered} row(s) were filtered out because the birthday minor is over age ${preview.max_child_age}.` : ''}
                                  {preview.counts?.excluded_prior_send_suppression > 0
                                    ? ` ${preview.counts.excluded_prior_send_suppression} recipient(s) were excluded because this automation already sent (or queued) the same birthday cohort for them within the last 5 weeks.`
                                    : ''}
                                </div>
                                {preview.suggested_send_dates?.length > 0 && (
                                  <div style={styles.suggestedDates}>
                                    <div style={styles.suggestedDatesTitle}>
                                      Next 8 send dates — counts are new emails still to be queued (same rules as the
                                      worker; excludes rows already in Sending History for that date)
                                    </div>
                                    <div style={styles.suggestedDateButtons}>
                                      {preview.suggested_send_dates.map((suggestion) => (
                                        <button
                                          key={`${suggestion.send_date}-${suggestion.event_date}`}
                                          type="button"
                                          style={styles.suggestedDateButton}
                                          onClick={() => {
                                            updatePreviewDate(automation, suggestion.send_date);
                                            loadAutomationPreview(automation, suggestion.send_date);
                                          }}
                                        >
                                          {suggestion.send_date}
                                          <span>{suggestion.recipients} recipient{suggestion.recipients === 1 ? '' : 's'}</span>
                                        </button>
                                      ))}
                                    </div>
                                  </div>
                                )}
                                {recipients.length === 0 ? (
                                  <div style={styles.savedState}>No eligible birthday emails would send on this date.</div>
                                ) : (
                                  <div style={styles.previewTableWrap}>
                                    <table style={styles.previewTable}>
                                      <thead>
                                        <tr>
                                          <th style={styles.previewTh}>Email</th>
                                          <th style={styles.previewTh}>Recipient</th>
                                          <th style={styles.previewTh}>Minor</th>
                                          <th style={styles.previewTh}>Minor DOB</th>
                                          <th style={styles.previewTh}>Scheduled Local Time</th>
                                          <th style={styles.previewTh}>Source</th>
                                          <th style={styles.previewTh}>Points</th>
                                          <th style={styles.previewTh}>Already Queued/Sent</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {recipients.map((recipient) => (
                                          <tr key={`${recipient.contact_id}-${recipient.delivery_key}`}>
                                            <td style={styles.previewTd}>{recipient.email_address}</td>
                                            <td style={styles.previewTd}>
                                              {[recipient.recipient_first_name, recipient.recipient_last_name].filter(Boolean).join(' ') || 'No name'}
                                            </td>
                                            <td style={styles.previewTd}>
                                              {[recipient.minor_first_name, recipient.minor_last_name].filter(Boolean).join(' ') || 'Minor'}
                                            </td>
                                            <td style={styles.previewTd}>{recipient.minor_date_of_birth}</td>
                                            <td style={styles.previewTd}>{recipient.scheduled_local_time || 'Not scheduled'}</td>
                                            <td style={styles.previewTd}>
                                              {recipient.source === 'legacy_waivers.legacy_minors' ? 'Legacy minor' : 'Modern minor'}
                                            </td>
                                            <td style={styles.previewTd}>{recipient.loyalty_points ?? 0}</td>
                                            <td style={styles.previewTd}>{recipient.already_has_run_for_date ? 'Yes' : 'No'}</td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                )}
                              </>
                            ) : null}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
          )}

          {activeAutomationTab === 'data-signals' && (
            <>
            <div style={styles.section}>
              <h2 style={styles.sectionTitle}>Reusable Data Signals</h2>
              <div style={styles.signalPanel}>
                {DATA_SIGNALS.map((signal) => (
                  <span key={signal} style={styles.signalChip}>{signal}</span>
                ))}
              </div>
            </div>

            <div style={styles.section}>
              <h2 style={styles.sectionTitle}>Suggested Email Header Merge Fields</h2>
              <div style={styles.mergeCard}>
                <pre style={styles.mergePreview}>
{`Hi {{First Name}},

You currently have {{Loyalty Points}} loyalty points.

{{MinorFirstName ? "Here is an offer picked for your family." : "Here is a new offer for you."}}`}
                </pre>
                <p style={styles.mergeHelp}>
                  This screen sets up a dedicated automation home inside Mail. The recurring-campaign
                  engine can now live here without mixing with standard campaign sends.
                </p>
              </div>
            </div>
            </>
          )}
        </div>
        <NameOfDaySettingsModal
          open={nameOfDayModalOpen}
          onClose={() => setNameOfDayModalOpen(false)}
          businessId={businessId}
          businessData={businessData}
          canEdit={canCreateCampaigns || hasElevatedPrivileges}
        />
      </SecurityWrapper>
    </POSAuthWrapper>
  );
};

const styles = {
  container: {
    padding: '24px',
    backgroundColor: '#f7f8fb',
    minHeight: '100vh'
  },
  loadingState: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '40vh',
    color: '#475569'
  },
  loadingIcon: {
    fontSize: '28px',
    marginBottom: '12px',
    animation: 'spin 1s linear infinite'
  },
  errorCard: {
    backgroundColor: '#ffffff',
    borderRadius: '16px',
    padding: '24px',
    border: '1px solid #fecaca'
  },
  errorTitle: {
    margin: '0 0 8px 0',
    color: '#991b1b'
  },
  errorText: {
    margin: 0,
    color: '#7f1d1d'
  },
  heroCard: {
    backgroundColor: '#ffffff',
    borderRadius: '20px',
    padding: '28px',
    border: '1px solid #e2e8f0',
    display: 'flex',
    justifyContent: 'space-between',
    gap: '24px',
    flexWrap: 'wrap',
    marginBottom: '20px'
  },
  eyebrow: {
    fontSize: '13px',
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    color: '#7c3aed',
    marginBottom: '8px'
  },
  title: {
    margin: '0 0 10px 0',
    fontSize: '33px',
    color: '#0f172a'
  },
  subtitle: {
    margin: 0,
    maxWidth: '700px',
    color: '#475569',
    lineHeight: 1.6
  },
  heroActions: {
    display: 'flex',
    gap: '12px',
    alignItems: 'flex-start',
    flexWrap: 'wrap'
  },
  primaryButton: {
    border: 'none',
    borderRadius: '12px',
    padding: '12px 16px',
    backgroundColor: '#0f766e',
    color: '#ffffff',
    fontWeight: 700,
    display: 'inline-flex',
    alignItems: 'center',
    gap: '8px',
    cursor: 'pointer'
  },
  secondaryButton: {
    border: '1px solid #cbd5e1',
    borderRadius: '12px',
    padding: '12px 16px',
    backgroundColor: '#ffffff',
    color: '#0f172a',
    fontWeight: 700,
    display: 'inline-flex',
    alignItems: 'center',
    gap: '8px',
    cursor: 'pointer'
  },
  cardButton: {
    border: 'none',
    borderRadius: '10px',
    padding: '16px 22px',
    backgroundColor: '#e2e8f0',
    color: '#0f172a',
    fontWeight: 700,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    cursor: 'pointer',
    height: '100%',
    minHeight: '120px',
    width: '100%',
    whiteSpace: 'nowrap'
  },
  infoGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
    gap: '16px',
    marginBottom: '24px'
  },
  infoPanel: {
    backgroundColor: '#ffffff',
    borderRadius: '16px',
    padding: '18px 20px',
    border: '1px solid #e2e8f0'
  },
  infoHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontWeight: 700,
    color: '#0f172a',
    marginBottom: '10px'
  },
  infoText: {
    margin: 0,
    color: '#475569',
    lineHeight: 1.6
  },
  section: {
    marginBottom: '24px'
  },
  savedSectionHeader: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '12px',
    marginBottom: '8px'
  },
  savedToolbarHint: {
    margin: '0 0 16px 0',
    fontSize: '13px',
    color: '#64748b',
    lineHeight: 1.45
  },
  nameOfDaySettingsButton: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '8px',
    padding: '10px 14px',
    borderRadius: '10px',
    border: '1px solid #fdba74',
    backgroundColor: '#fff7ed',
    color: '#9a3412',
    fontWeight: 700,
    fontSize: '13px',
    cursor: 'pointer'
  },
  sectionTitle: {
    margin: '0 0 14px 0',
    fontSize: '23px',
    color: '#0f172a'
  },
  cardGrid: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px'
  },
  automationCard: {
    backgroundColor: '#ffffff',
    borderRadius: '18px',
    padding: '20px',
    border: '1px solid #e2e8f0',
    display: 'flex',
    alignItems: 'stretch',
    justifyContent: 'space-between',
    gap: '20px',
    width: '100%'
  },
  automationContent: {
    flex: '1 1 auto',
    minWidth: '280px'
  },
  automationHeader: {
    display: 'flex',
    gap: '14px',
    alignItems: 'flex-start',
    marginBottom: '4px'
  },
  automationDetails: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
    gap: '16px',
    marginTop: '14px'
  },
  blueprintReputationBlock: {
    marginTop: '18px',
    paddingTop: '16px',
    borderTop: '1px solid #e2e8f0'
  },
  blueprintReputationHint: {
    margin: '0 0 12px 0',
    fontSize: '13px',
    color: '#475569',
    lineHeight: 1.55
  },
  blueprintReputationMuted: {
    margin: '8px 0 0 0',
    fontSize: '13px',
    color: '#94a3b8'
  },
  blueprintDelayRow: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: '10px'
  },
  blueprintDelayInput: {
    width: '120px',
    maxWidth: '100%',
    padding: '10px 12px',
    borderRadius: '10px',
    border: '1px solid #cbd5e1',
    fontSize: '15px',
    fontWeight: 600,
    color: '#0f172a'
  },
  blueprintDelaySaveButton: {
    border: 'none',
    borderRadius: '10px',
    padding: '10px 16px',
    backgroundColor: '#7c3aed',
    color: '#ffffff',
    fontWeight: 700,
    cursor: 'pointer',
    fontSize: '14px'
  },
  automationAction: {
    flex: '0 0 230px',
    alignSelf: 'stretch',
    display: 'flex'
  },
  automationIconWrap: {
    width: '44px',
    height: '44px',
    borderRadius: '14px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '20px',
    flex: '0 0 44px'
  },
  automationTitle: {
    margin: '0 0 12px 0',
    fontSize: '18px',
    color: '#0f172a'
  },
  metaLabel: {
    fontSize: '13px',
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    color: '#64748b',
    marginBottom: '6px'
  },
  metaText: {
    margin: '0 0 14px 0',
    color: '#334155',
    lineHeight: 1.5
  },
  tagWrap: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '8px',
    marginBottom: '14px'
  },
  tag: {
    backgroundColor: '#f1f5f9',
    color: '#334155',
    borderRadius: '999px',
    padding: '6px 10px',
    fontSize: '13px',
    fontWeight: 600
  },
  signalPanel: {
    backgroundColor: '#ffffff',
    borderRadius: '18px',
    padding: '20px',
    border: '1px solid #e2e8f0',
    display: 'flex',
    flexWrap: 'wrap',
    gap: '10px'
  },
  signalChip: {
    backgroundColor: '#eef2ff',
    color: '#3730a3',
    borderRadius: '999px',
    padding: '8px 12px',
    fontSize: '13px',
    fontWeight: 700
  },
  mergeCard: {
    backgroundColor: '#ffffff',
    borderRadius: '18px',
    padding: '20px',
    border: '1px solid #e2e8f0'
  },
  mergePreview: {
    margin: 0,
    padding: '16px',
    borderRadius: '14px',
    backgroundColor: '#0f172a',
    color: '#e2e8f0',
    fontSize: '13px',
    lineHeight: 1.6,
    overflowX: 'auto'
  },
  mergeHelp: {
    margin: '14px 0 0 0',
    color: '#475569',
    lineHeight: 1.6
  },
  savedPanel: {
    backgroundColor: '#ffffff',
    borderRadius: '18px',
    padding: '20px',
    border: '1px solid #e2e8f0'
  },
  savedState: {
    color: '#475569',
    lineHeight: 1.6
  },
  savedList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px'
  },
  savedAutomationBlock: {
    border: '1px solid #e2e8f0',
    borderRadius: '14px',
    overflow: 'hidden'
  },
  savedItem: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: '16px',
    alignItems: 'center',
    padding: '14px 16px',
    flexWrap: 'wrap'
  },
  savedTitle: {
    fontWeight: 700,
    color: '#0f172a',
    marginBottom: '4px'
  },
  savedMeta: {
    fontSize: '13px',
    color: '#64748b'
  },
  savedActions: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    flexWrap: 'wrap'
  },
  statusPill: {
    textTransform: 'capitalize',
    backgroundColor: '#ede9fe',
    color: '#5b21b6',
    borderRadius: '999px',
    padding: '6px 10px',
    fontSize: '13px',
    fontWeight: 700
  },
  nodCalendarSection: {
    marginBottom: '20px',
    padding: '14px 16px',
    backgroundColor: '#f8fafc',
    borderRadius: '12px',
    border: '1px solid #e2e8f0'
  },
  nodCalendarToolbar: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: '12px',
    marginBottom: '12px'
  },
  nodCalendarToolbarText: {
    flex: '1 1 280px',
    minWidth: 0
  },
  nodCalendarTitle: {
    fontSize: '14px',
    fontWeight: 700,
    color: '#0f172a',
    marginBottom: '6px',
    display: 'flex',
    alignItems: 'center'
  },
  nodCalendarHint: {
    margin: '0 0 12px 0',
    fontSize: '13px',
    color: '#64748b',
    lineHeight: 1.5
  },
  statusPillSaved: {
    display: 'inline-block',
    padding: '2px 8px',
    borderRadius: '999px',
    fontSize: '11px',
    fontWeight: 600,
    backgroundColor: '#dcfce7',
    color: '#166534'
  },
  statusPillPending: {
    display: 'inline-block',
    padding: '2px 8px',
    borderRadius: '999px',
    fontSize: '11px',
    fontWeight: 600,
    backgroundColor: '#f1f5f9',
    color: '#64748b'
  },
  previewPanel: {
    borderTop: '1px solid #e2e8f0',
    backgroundColor: '#f8fafc',
    padding: '16px'
  },
  previewHeader: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: '16px',
    flexWrap: 'wrap',
    marginBottom: '14px'
  },
  previewTitle: {
    fontWeight: 800,
    color: '#0f172a',
    marginBottom: '4px'
  },
  previewHelp: {
    color: '#64748b',
    fontSize: '13px',
    lineHeight: 1.5
  },
  previewControls: {
    display: 'flex',
    gap: '10px',
    alignItems: 'center',
    flexWrap: 'wrap'
  },
  historyFilterRow: {
    display: 'flex',
    gap: '8px',
    flexWrap: 'wrap',
    margin: '0 0 14px 0'
  },
  dateInput: {
    border: '1px solid #cbd5e1',
    borderRadius: '10px',
    padding: '11px 12px',
    backgroundColor: '#ffffff',
    color: '#0f172a',
    fontWeight: 700
  },
  filterButton: {
    border: '1px solid #cbd5e1',
    borderRadius: '10px',
    padding: '10px 12px',
    backgroundColor: '#ffffff',
    color: '#334155',
    cursor: 'pointer',
    fontWeight: 800
  },
  filterButtonActive: {
    borderColor: '#2563eb',
    backgroundColor: '#dbeafe',
    color: '#1d4ed8'
  },
  previewError: {
    color: '#991b1b',
    backgroundColor: '#fee2e2',
    border: '1px solid #fecaca',
    borderRadius: '10px',
    padding: '10px 12px'
  },
  previewSummaryGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
    gap: '10px',
    marginBottom: '12px'
  },
  previewSummaryCard: {
    backgroundColor: '#ffffff',
    border: '1px solid #e2e8f0',
    borderRadius: '12px',
    padding: '12px',
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    color: '#0f172a'
  },
  previewSummaryLabel: {
    fontSize: '13px',
    color: '#64748b',
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.04em'
  },
  previewNote: {
    color: '#475569',
    fontSize: '13px',
    lineHeight: 1.5,
    marginBottom: '12px'
  },
  suggestedDates: {
    backgroundColor: '#ffffff',
    border: '1px solid #e2e8f0',
    borderRadius: '12px',
    padding: '12px',
    marginBottom: '12px'
  },
  suggestedDatesTitle: {
    color: '#334155',
    fontWeight: 800,
    fontSize: '13px',
    marginBottom: '10px'
  },
  suggestedDateButtons: {
    display: 'flex',
    gap: '8px',
    flexWrap: 'wrap'
  },
  suggestedDateButton: {
    border: '1px solid #cbd5e1',
    borderRadius: '10px',
    padding: '8px 10px',
    backgroundColor: '#f8fafc',
    color: '#0f172a',
    cursor: 'pointer',
    fontWeight: 800,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: '2px',
    fontSize: '13px'
  },
  previewTableWrap: {
    overflowX: 'auto',
    backgroundColor: '#ffffff',
    border: '1px solid #e2e8f0',
    borderRadius: '12px'
  },
  previewTable: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: '13px'
  },
  previewTh: {
    textAlign: 'left',
    padding: '10px 12px',
    backgroundColor: '#f1f5f9',
    color: '#334155',
    borderBottom: '1px solid #e2e8f0',
    whiteSpace: 'nowrap'
  },
  previewTd: {
    padding: '10px 12px',
    borderBottom: '1px solid #e2e8f0',
    color: '#0f172a',
    whiteSpace: 'nowrap'
  },
  nodPickInput: {
    width: '100%',
    minWidth: '96px',
    padding: '8px 10px',
    borderRadius: '8px',
    border: '1px solid #cbd5e1',
    fontSize: '14px',
    boxSizing: 'border-box'
  }
};

export default MailAutomations;
