// src/screens/Bookings/BookingsDashboard.jsx - TABBED VERSION
import React, { useState, useEffect, useMemo, lazy, Suspense } from 'react';
import { useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import { usePOSAuth } from '../../hooks/usePOSAuth';
import { usePermissions } from '../../hooks/usePermissions';
import { SecurityWrapper, useSecurityContext } from '../../Security';
import POSAuthWrapper from '../../components/Auth/POSAuthWrapper';
import bookingService from '../../services/Bookings/BookingService';
import BookingListScreen from './BookingListScreen';
import CamperRegistrationFormSettings from './CamperRegistrationFormSettings';
import POSCustomersScreen from '../POS/POSCustomersScreen';
import { TavariStyles } from '../../utils/TavariStyles';
import TavariModuleHeader from '../../components/UI/TavariModuleHeader';
import TavariTabSystemComponent from '../../components/UI/TavariTabSystemComponent';
import { FiCalendar, FiPlus, FiClock, FiDollarSign, FiUsers, FiList, FiSettings, FiCheckCircle, FiLayout, FiMail, FiEdit3 } from 'react-icons/fi';
import toast from 'react-hot-toast';
import { supabase } from '../../supabaseClient';
import bookingActivityService from '../../services/Bookings/BookingActivityService';
import { formatDateShort, formatDateTimeForBusiness, getBusinessTimezone } from '../../utils/businessDateFormat';
import { getParticipantDisplayName, getBookingAdultDisplayName, participantTicketLabel } from '../../helpers/Bookings/participantIdentity';
import { useBookingDetailModal } from '../../contexts/BookingDetailModalContext';
import { formatBookingTimeRangeLabel } from '../../utils/bookingTimeRange';
import { buildBookingPaymentDashboardQueues, PAYMENT_DASHBOARD_BUCKETS } from '../../utils/bookingPaymentDashboard';
import { BOOKING_HISTORY_ACTIONS } from '../../helpers/Bookings/bookingHistory';
import {
  buildDashboardMessageFromHistoryEntry,
  buildSyntheticCancelMessage,
} from '../../helpers/Bookings/bookingDashboardMessages';
import BookingPaymentFollowUpsModal from '../../components/Bookings/BookingPaymentFollowUpsModal';
import BookingRestoreButton from '../../components/Bookings/BookingRestoreButton';

/** Heavy screens — load only when their tab is opened (keeps bookings dashboard boot fast). */
const BookingsScheduleView = lazy(() => import('./BookingsScheduleView'));
const BookingSettingsScreen = lazy(() => import('./BookingSettingsScreen'));

const TAB_LAZY_FALLBACK = (
  <div style={{ padding: '40px', textAlign: 'center', color: '#6b7280' }}>Loading…</div>
);

const APPROVAL_FOLLOW_UP_OPTIONS = [
  { value: 'pending', label: 'Pending', bg: '#ede9fe', color: '#6d28d9', border: '#c4b5fd' },
  { value: 'contacted', label: 'Contacted', bg: '#fef9c3', color: '#854d0e', border: '#fde047' },
];

const getApprovalFollowUpStyle = (status) =>
  APPROVAL_FOLLOW_UP_OPTIONS.find((option) => option.value === status)
  || APPROVAL_FOLLOW_UP_OPTIONS[0];

/** Booker name for Messages feed — prefers booking fields, then lead participant. */
function bookerNameForDashboardMessage(booking) {
  const fn = String(booking.first_name ?? '').trim();
  const ln = String(booking.last_name ?? '').trim();
  if (fn || ln) return [fn, ln].filter(Boolean).join(' ');
  const cn = String(booking.customer_name ?? '').trim();
  if (cn) return cn;
  const parts = booking.booking_participants || [];
  if (parts.length) {
    const nm = getParticipantDisplayName(parts[0], 0);
    if (nm) return nm;
  }
  const email = String(booking.customer_email ?? '').trim();
  if (email) return email;
  const phone = String(booking.customer_phone ?? '').trim();
  return phone || 'Guest';
}

function formatVisitDatePart(booking, businessTimezone) {
  return booking.booking_date
    ? formatDateShort(booking.booking_date, businessTimezone)
    : '—';
}

function formatVisitTimePart(booking) {
  const range = formatBookingTimeRangeLabel(booking);
  if (range) return range;
  const raw = booking.booking_time != null ? String(booking.booking_time) : '';
  const hm = raw.length >= 5 ? raw.slice(0, 5) : raw;
  if (!hm) return '—';
  const [hh, mm] = hm.split(':').map((x) => parseInt(x, 10));
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return hm;
  const suffix = hh >= 12 ? 'PM' : 'AM';
  const h12 = hh % 12 || 12;
  const min = String(mm).padStart(2, '0');
  return `${h12}:${min} ${suffix}`;
}

function ticketsLineForDashboardMessage(booking) {
  const parts = booking.booking_participants || [];
  if (!parts.length) return 'Tickets: none on file yet';
  const counts = {};
  parts.forEach((p) => {
    const label = participantTicketLabel(p);
    counts[label] = (counts[label] || 0) + 1;
  });
  const bits = Object.entries(counts).map(([label, n]) => (n > 1 ? `${n}× ${label}` : label));
  return `Tickets (${parts.length}): ${bits.join(', ')}`;
}

function buildBookingMessageContext(booking, businessTimezone) {
  const ref = booking.booking_number || booking.id?.slice(0, 8) || '—';
  return {
    customerId: booking.customer_id || null,
    bookingRef: ref,
    booker: bookerNameForDashboardMessage(booking),
    activity: booking.booking_activities?.activity_name || 'Activity',
    visitDate: formatVisitDatePart(booking, businessTimezone),
    visitTime: formatVisitTimePart(booking),
    tickets: ticketsLineForDashboardMessage(booking),
    savedInSystem: booking.created_at
      ? formatDateTimeForBusiness(booking.created_at, businessTimezone)
      : '—',
  };
}

const BookingsDashboard = () => {
  const navigate = useNavigate();
  const { openBookingDetail } = useBookingDetailModal();
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const [viewportWidth, setViewportWidth] = useState(
    typeof window !== 'undefined' ? window.innerWidth : 1440
  );

  // Authentication
  const auth = usePOSAuth({
    requiredRoles: ['employee', 'manager', 'owner'],
    requireBusiness: true,
    componentName: 'BookingsDashboard'
  });

  // Security context
  const {
    recordAction,
    logSecurityEvent
  } = useSecurityContext({
    componentName: 'BookingsDashboard',
    sensitiveComponent: false,
    enableRateLimiting: false,
    enableAuditLogging: true,
    securityLevel: 'low'
  });

  // Permissions
  const { 
    hasPermission, 
    hasAnyPermission,
    hasElevatedPrivileges,
    isManager,
    loading: permissionsLoading 
  } = usePermissions();

  const canViewBookings = hasAnyPermission([
    'bookings.view',
    'bookings.view_all'
  ]) || hasElevatedPrivileges();

  const canCreateBookings = hasPermission('bookings.create') || hasElevatedPrivileges();
  // Match sidebar: managers/owners can open booking settings (not only bookings.settings.edit).
  const canManageSettings =
    hasPermission('bookings.settings.edit') ||
    hasElevatedPrivileges() ||
    isManager();
  const canViewRegistrationForms =
    canManageSettings ||
    hasAnyPermission(['bookings.view', 'bookings.view_all']);

  // Active Tab
  const [activeTab, setActiveTab] = useState('dashboard');
  const [activeSettingsTab, setActiveSettingsTab] = useState('categories');
  /** `true` = settings button grid; `false` = embedded section (categories, test, …) */
  const [settingsShowMenu, setSettingsShowMenu] = useState(true);

  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    totalBookings: 0,
    todayBookings: 0,
    upcomingBookings: 0,
    revenue: 0
  });
  const [pendingBookings, setPendingBookings] = useState([]);
  const [paymentQueues, setPaymentQueues] = useState({
    [PAYMENT_DASHBOARD_BUCKETS.OVERDUE]: [],
    [PAYMENT_DASHBOARD_BUCKETS.PENDING]: [],
    [PAYMENT_DASHBOARD_BUCKETS.BALANCE_AFTER_PARTY]: [],
  });
  const [paymentFollowUpsModalOpen, setPaymentFollowUpsModalOpen] = useState(false);
  const [followUpUpdatingId, setFollowUpUpdatingId] = useState(null);
  const [activityMessages, setActivityMessages] = useState([]);
  const [cancelledBookingsById, setCancelledBookingsById] = useState({});

  // Test tab state
  const [testBookingsList, setTestBookingsList] = useState([]);
  const [testActivities, setTestActivities] = useState([]);
  const [selectedBookingForEmail, setSelectedBookingForEmail] = useState('');
  const [emailSendResult, setEmailSendResult] = useState(null);
  const [emailSending, setEmailSending] = useState(false);
  const [testFormData, setTestFormData] = useState({
    activityId: '',
    bookingDate: new Date().toISOString().split('T')[0],
    bookingTime: '10:00',
    customerEmail: ''
  });
  const [testCreateLoading, setTestCreateLoading] = useState(false);
  const [testCreatedBookingId, setTestCreatedBookingId] = useState(null);
  const businessTimezone = getBusinessTimezone(auth.businessData);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const handleResize = () => {
      setViewportWidth(window.innerWidth);
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const isMobile = viewportWidth <= 768;
  const isNarrow = viewportWidth <= 480;

  // Tab configuration with permission-based filtering
  const tabs = [
    { 
      id: 'dashboard', 
      label: 'Dashboard', 
      icon: <FiLayout />, 
      description: 'Overview and statistics',
      requiredPermissions: ['bookings.view', 'bookings.view_all'],
      requiresElevated: false
    },
    { 
      id: 'schedule', 
      label: 'Schedule', 
      icon: <FiCalendar />, 
      description: 'Bookeo-style schedule view with calendar',
      requiredPermissions: ['bookings.view', 'bookings.calendar.view'],
      requiresElevated: false
    },
    { 
      id: 'list', 
      label: 'All Bookings', 
      icon: <FiList />, 
      description: 'View all bookings',
      requiredPermissions: ['bookings.view', 'bookings.view_all'],
      requiresElevated: false
    },
    { 
      id: 'customers', 
      label: 'Customers', 
      icon: <FiUsers />, 
      description: 'Customers for bookings, waivers, and more',
      requiredPermissions: ['bookings.view', 'bookings.view_all', 'pos.customers.view', 'pos.loyalty.manage'],
      requiresElevated: false
    },
    {
      id: 'registration-forms',
      label: 'Registration Forms',
      icon: <FiEdit3 />,
      description: 'Camper registration forms and submissions',
      requiredPermissions: ['bookings.view', 'bookings.view_all', 'bookings.settings.edit'],
      requiresElevated: false,
    },
    { 
      id: 'settings', 
      label: 'Settings', 
      icon: <FiSettings />, 
      description: 'Booking settings',
      requiredPermissions: ['bookings.settings.edit'],
      requiresElevated: false
    }
  ];

  /** Lower row under Settings — Test is last, manager/owner only */
  const settingsSubTabs = useMemo(() => {
    const base = [
      { id: 'categories', label: 'Booking Categories' },
      { id: 'resources', label: 'Resources' },
      { id: 'pricing', label: 'Pricing & Promotions' },
      { id: 'options', label: 'Options' },
      { id: 'marketing', label: 'Marketing & Comms' },
      { id: 'terms', label: 'Terms & Conditions' },
      { id: 'registration-form', label: 'Registration Form' }
    ];
    if (hasElevatedPrivileges()) {
      base.push({ id: 'test', label: 'Test' });
    }
    return base;
  }, [hasElevatedPrivileges]);

  // Filter tabs based on user permissions (memoized)
  const availableTabs = useMemo(() => {
    return tabs.filter(tab => {
      if (tab.id === 'registration-forms') {
        return canViewRegistrationForms;
      }

      // Check if user has elevated privileges if required
      if (tab.requiresElevated && !hasElevatedPrivileges()) {
        return false;
      }

      if (tab.id === 'settings') {
        return canManageSettings;
      }
      
      // Check if user has any of the required permissions
      if (tab.requiredPermissions && tab.requiredPermissions.length > 0) {
        return hasAnyPermission(tab.requiredPermissions);
      }
      
      return true;
    });
  }, [hasElevatedPrivileges, hasAnyPermission, canManageSettings, canViewRegistrationForms, permissionsLoading]);

  useEffect(() => {
    if (
      activeTab === 'settings' &&
      activeSettingsTab === 'test' &&
      !hasElevatedPrivileges()
    ) {
      setActiveSettingsTab('categories');
      setSettingsShowMenu(true);
    }
  }, [activeTab, activeSettingsTab, hasElevatedPrivileges]);

  useEffect(() => {
    if (auth.selectedBusinessId && !permissionsLoading) {
      if (canViewBookings) {
        bookingService.setBusinessId(auth.selectedBusinessId);
        if (activeTab === 'dashboard') {
          loadDashboardData();
        }
      }
    }
  }, [auth.selectedBusinessId, permissionsLoading, canViewBookings, activeTab]);

  // Set default tab to first available tab based on permissions
  useEffect(() => {
    if (!permissionsLoading && availableTabs.length > 0) {
      const isValidMainTab = availableTabs.some((t) => t.id === activeTab);
      if (!isValidMainTab) {
        setActiveTab(availableTabs[0].id);
      }
    }
  }, [permissionsLoading, availableTabs, activeTab]);

  useEffect(() => {
    if (permissionsLoading) return;

    const tabParam = searchParams.get('tab');
    const stateTab = location.state?.bookingsTab;
    const targetTab = stateTab || tabParam;

    if (targetTab === 'registration-forms' && canViewRegistrationForms) {
      setActiveTab('registration-forms');
      if (tabParam !== 'registration-forms') {
        setSearchParams({ tab: 'registration-forms' }, { replace: true });
      } else if (stateTab) {
        navigate('.', { replace: true, state: {} });
      }
      return;
    }

    const settingsTabParam = searchParams.get('settingsTab');
    const stateSettingsTab = location.state?.bookingsSettingsTab;
    const settingsTab = stateSettingsTab || settingsTabParam;

    // Handle settings before the generic tabParam check so managers/owners always land here.
    if ((targetTab === 'settings' || tabParam === 'settings') && canManageSettings) {
      setActiveTab('settings');
      if (settingsTab) {
        setActiveSettingsTab(settingsTab);
        setSettingsShowMenu(false);
      } else {
        setSettingsShowMenu(true);
      }
      if (tabParam !== 'settings') {
        setSearchParams({ tab: 'settings' }, { replace: true });
      } else if (stateTab || stateSettingsTab) {
        navigate('.', { replace: true, state: {} });
      }
      return;
    }

    if (tabParam && availableTabs.some((tab) => tab.id === tabParam)) {
      setActiveTab(tabParam);
      if (stateTab) {
        navigate('.', { replace: true, state: {} });
      }
      return;
    }
  }, [
    searchParams,
    location.state,
    canViewRegistrationForms,
    canManageSettings,
    permissionsLoading,
    navigate,
    availableTabs,
    setSearchParams,
  ]);

  // Load test tools data only when Test section is open (not on the settings menu grid)
  useEffect(() => {
    if (
      activeTab !== 'settings' ||
      activeSettingsTab !== 'test' ||
      settingsShowMenu ||
      !auth.selectedBusinessId ||
      !canViewBookings ||
      !hasElevatedPrivileges()
    ) {
      return;
    }
    bookingService.setBusinessId(auth.selectedBusinessId);
    bookingActivityService.setBusinessId(auth.selectedBusinessId);
    let cancelled = false;
    (async () => {
      try {
        const [bookingsData, activitiesData] = await Promise.all([
          bookingService.getBookings({}).then(list => list.slice(0, 50)),
          bookingActivityService.getActivities({ activeOnly: false }).then(list => list || [])
        ]);
        if (!cancelled) {
          setTestBookingsList(bookingsData || []);
          setTestActivities(activitiesData || []);
        }
      } catch (e) {
        if (!cancelled) {
          console.error('Error loading test data:', e);
          toast.error('Failed to load test data');
        }
      }
    })();
    return () => { cancelled = true; };
  }, [
    activeTab,
    activeSettingsTab,
    settingsShowMenu,
    auth.selectedBusinessId,
    canViewBookings,
    hasElevatedPrivileges
  ]);

  const loadDashboardData = async () => {
    try {
      setLoading(true);

      // Load stats and bookings (scoped window — dashboard uses a lighter select)
      bookingService.setBusinessId(auth.selectedBusinessId);
      const todayDate = new Date();
      const rangeStart = new Date(todayDate);
      rangeStart.setMonth(rangeStart.getMonth() - 6);
      const rangeEnd = new Date(todayDate);
      rangeEnd.setMonth(rangeEnd.getMonth() + 12);
      const [allBookings, historyRows] = await Promise.all([
        bookingService.getBookings({
          selectMode: 'dashboard',
          startDate: rangeStart.toISOString().split('T')[0],
          endDate: rangeEnd.toISOString().split('T')[0],
        }),
        bookingService.listRecentBusinessHistory({ limit: 120 }),
      ]);
      const today = new Date().toISOString().split('T')[0];
      const todayBookings = allBookings.filter(b => b.booking_date === today);
      const upcoming = await bookingService.getUpcomingBookings(5);

      // Calculate revenue (from paid bookings)
      const revenue = allBookings
        .filter(b => b.payment_status === 'paid')
        .reduce((sum, b) => {
          const paymentTotal = b.booking_payments?.reduce((pSum, p) => pSum + (parseFloat(p.amount_paid) || 0), 0) || 0;
          return sum + paymentTotal;
        }, 0);

      // Pending approval queue: requires staff approval and not yet approved (status alone is not enough).
      const pending = allBookings.filter(
        (b) => b.requires_approval === true && !b.approved_at && b.status !== 'cancelled',
      );
      setPendingBookings(pending);

      setPaymentQueues(buildBookingPaymentDashboardQueues(allBookings, { todayStr: today }));

      // Messages feed: real audit log entries (cancel, options, payments, etc.)
      const bookingById = new Map(allBookings.map((booking) => [booking.id, booking]));
      const actorUserIds = [
        ...new Set(
          (historyRows || [])
            .map((entry) => entry?.changed_by)
            .filter(Boolean),
        ),
      ];
      let historyUserNames = {};
      if (actorUserIds.length > 0) {
        const { data: actorUsers, error: actorUsersError } = await supabase
          .from('users')
          .select('id, first_name, last_name, email')
          .in('id', actorUserIds);
        if (!actorUsersError) {
          historyUserNames = {};
          for (const user of actorUsers || []) {
            const name = [user.first_name, user.last_name].filter(Boolean).join(' ').trim();
            historyUserNames[user.id] = name || user.email || 'Staff';
          }
        }
      }

      const activities = historyRows.map((entry) => {
        const booking = bookingById.get(entry.booking_id);
        const context = booking
          ? buildBookingMessageContext(booking, businessTimezone)
          : {
            bookingRef: '—',
            booker: 'Guest',
            activity: 'Activity',
            visitDate: '—',
            visitTime: '—',
            tickets: '',
            savedInSystem: '—',
            customerId: null,
          };
        return buildDashboardMessageFromHistoryEntry(
          entry,
          context,
          businessTimezone,
          historyUserNames,
        );
      });

      const cancelInFeed = new Set(
        activities
          .filter((row) => row.type === BOOKING_HISTORY_ACTIONS.CANCELLED)
          .map((row) => row.bookingId),
      );
      for (const booking of allBookings) {
        if (booking.status !== 'cancelled' || !booking.cancelled_at) continue;
        if (cancelInFeed.has(booking.id)) continue;
        activities.push(buildSyntheticCancelMessage(booking, businessTimezone, {
          bookerNameForDashboardMessage,
          formatVisitDatePart,
          formatVisitTimePart,
          ticketsLineForDashboardMessage,
          formatDateTimeForBusiness,
        }));
      }

      activities.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      setActivityMessages(activities.slice(0, 100));

      const cancelledMap = {};
      for (const booking of allBookings) {
        if (booking.status === 'cancelled') {
          cancelledMap[booking.id] = booking;
        }
      }
      setCancelledBookingsById(cancelledMap);

      setStats({
        totalBookings: allBookings.length,
        todayBookings: todayBookings.length,
        upcomingBookings: upcoming.length,
        revenue
      });
    } catch (error) {
      console.error('Error loading dashboard data:', error);
      toast.error('Error loading dashboard data');
    } finally {
      setLoading(false);
    }
  };

  const handleApprovalFollowUpChange = async (bookingId, nextStatus, event) => {
    event?.stopPropagation?.();
    if (!auth.selectedBusinessId || followUpUpdatingId === bookingId) return;

    const previous = pendingBookings.find((booking) => booking.id === bookingId);
    const previousStatus = previous?.approval_follow_up_status || 'pending';
    if (previousStatus === nextStatus) return;

    setFollowUpUpdatingId(bookingId);
    setPendingBookings((current) =>
      current.map((booking) =>
        booking.id === bookingId
          ? {
              ...booking,
              approval_follow_up_status: nextStatus,
              approval_contacted_at: nextStatus === 'contacted' ? new Date().toISOString() : null,
            }
          : booking,
      ),
    );

    try {
      bookingService.setBusinessId(auth.selectedBusinessId);
      await bookingService.updateBooking(bookingId, {
        approval_follow_up_status: nextStatus,
        approval_contacted_at: nextStatus === 'contacted' ? new Date().toISOString() : null,
      });
    } catch (error) {
      console.error('Error updating approval follow-up status:', error);
      setPendingBookings((current) =>
        current.map((booking) =>
          booking.id === bookingId
            ? {
                ...booking,
                approval_follow_up_status: previousStatus,
                approval_contacted_at: previous?.approval_contacted_at || null,
              }
            : booking,
        ),
      );
      toast.error('Could not update follow-up status');
    } finally {
      setFollowUpUpdatingId(null);
    }
  };

  const clearMessages = () => {
    setActivityMessages([]);
    toast.success('Messages cleared');
  };

  const handleTabChange = (tabId) => {
    // Check if user has permission to access this tab
    const tab = tabs.find(t => t.id === tabId);
    if (!tab) return;

    // Verify permissions before switching
    if (tab.id === 'settings') {
      if (!canManageSettings) {
        toast.error('You do not have permission to access booking settings');
        return;
      }
    } else if (tab.requiredPermissions && tab.requiredPermissions.length > 0) {
      if (!hasAnyPermission(tab.requiredPermissions)) {
        toast.error('You do not have permission to access this tab');
        return;
      }
    }

    if (tab.requiresElevated && !hasElevatedPrivileges()) {
      toast.error('This feature requires elevated privileges (manager or owner)');
      return;
    }

    // Record action for audit asynchronously
    setTimeout(() => {
      recordAction('bookings_tab_navigation', true).catch(err => 
        console.error('Failed to record tab navigation:', err)
      );
    }, 0);
    
    setActiveTab(tabId);
    if (tabId === 'settings') {
      setSettingsShowMenu(true);
    }
    if (tabId !== 'settings') {
      setActiveSettingsTab('categories');
      setSettingsShowMenu(true);
    }
    if (tabId === 'registration-forms') {
      setSearchParams({ tab: 'registration-forms' });
    } else if (tabId === 'settings') {
      setSearchParams({ tab: 'settings' });
    } else if (tabId !== 'dashboard') {
      setSearchParams({ tab: tabId });
    } else if (searchParams.get('tab')) {
      setSearchParams({});
    }
  };

  const goToSettingsSection = (sectionId) => {
    setActiveTab('settings');
    setActiveSettingsTab(sectionId);
    setSettingsShowMenu(false);
    if (searchParams.get('tab') === 'registration-forms') {
      setSearchParams({});
    }
  };

  const handleSendTestEmail = async () => {
    if (!selectedBookingForEmail || !auth.selectedBusinessId) {
      toast.error('Select a booking first');
      return;
    }
    setEmailSending(true);
    setEmailSendResult(null);
    try {
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-booking-confirmation`;
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({
          businessId: auth.selectedBusinessId,
          bookingId: selectedBookingForEmail,
        }),
      });
      const data = await res.json().catch(() => ({}));
      setEmailSendResult(data);
      if (!res.ok) {
        throw new Error(data?.error || data?.detail || `HTTP ${res.status}`);
      }
      if (data?.sent) toast.success('Confirmation email sent.');
      else if (data?.skipped) toast('Email already sent for this booking (skipped).', { icon: 'ℹ️' });
      else if (data?.error) toast.error(data.error);
    } catch (e) {
      const msg = e?.message || 'Unknown error';
      toast.error('Failed to send email: ' + msg);
      setEmailSendResult({ error: msg });
      if (msg.includes('Failed to fetch') || msg.includes('CORS') || msg.includes('ERR_FAILED')) {
        toast('Deploy the edge function: supabase functions deploy send-booking-confirmation', { duration: 6000 });
      }
    } finally {
      setEmailSending(false);
    }
  };

  const handleCreateTestBooking = async () => {
    const { activityId, bookingDate, bookingTime, customerEmail } = testFormData;
    if (!activityId || !bookingDate || !bookingTime || !customerEmail?.trim()) {
      toast.error('Fill in activity, date, time, and customer email');
      return;
    }
    setTestCreateLoading(true);
    setTestCreatedBookingId(null);
    try {
      bookingService.setBusinessId(auth.selectedBusinessId);
      const booking = await bookingService.createBooking({
        activityId,
        bookingDate,
        bookingTime,
        customerEmail: customerEmail.trim(),
        customerPhone: '',
        status: 'confirmed',
        paymentStatus: 'unpaid',
        source: 'staff',
      });
      setTestCreatedBookingId(booking?.id);
      setTestBookingsList(prev => [booking, ...prev].slice(0, 50));
      toast.success('Test booking created. It will appear on the Schedule tab.');
    } catch (e) {
      toast.error('Failed to create test booking: ' + (e?.message || 'Unknown error'));
    } finally {
      setTestCreateLoading(false);
    }
  };

  const renderTestTab = () => {
    const sectionStyle = {
      backgroundColor: 'white',
      padding: '24px',
      borderRadius: '12px',
      border: '1px solid #e5e7eb',
      marginBottom: '24px',
    };
    const sectionTitle = { fontSize: '18px', fontWeight: '600', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' };
    const labelStyle = { display: 'block', marginBottom: '6px', fontWeight: '600', fontSize: '14px' };
    const inputStyle = { width: '100%', maxWidth: '400px', padding: '10px 12px', border: '1px solid #e5e7eb', borderRadius: '8px', fontSize: '14px' };
    const buttonStyle = {
      padding: '10px 20px',
      borderRadius: '8px',
      fontSize: '14px',
      fontWeight: '600',
      cursor: 'pointer',
      border: 'none',
      display: 'inline-flex',
      alignItems: 'center',
      gap: '8px',
    };

    return (
      <div>
        <p style={{ color: TavariStyles.colors?.gray600 || '#6b7280', marginBottom: '24px' }}>
          Open <strong>Test</strong> from the booking settings tabs, then switch sections using the tab row when you
          are done. You can test confirmation emails, create bookings without payment, and confirm they
          show on the Schedule.
        </p>

        {/* 1. Test email sending */}
        <div style={sectionStyle}>
          <h3 style={sectionTitle}><FiMail /> Test confirmation email</h3>
          <p style={{ marginBottom: '12px', fontSize: '14px', color: TavariStyles.colors?.gray600 }}>
            Send a booking confirmation email for an existing booking (same flow as pay statement emails).
          </p>
          {testBookingsList.length === 0 ? (
            <p style={{ marginBottom: '12px', fontSize: '14px', color: TavariStyles.colors?.gray600 }}>
              No bookings yet. Create a test booking below (or use <strong>New Booking</strong>) first, then you can send a confirmation email for it here.
            </p>
          ) : (
          <div style={{ marginBottom: '12px' }}>
            <label style={labelStyle}>Select booking</label>
            <select
              value={selectedBookingForEmail}
              onChange={(e) => { setSelectedBookingForEmail(e.target.value); setEmailSendResult(null); }}
              style={inputStyle}
            >
              <option value="">— Select a booking —</option>
              {testBookingsList.map(b => (
                <option key={b.id} value={b.id}>
                  {b.booking_number || b.id?.slice(0, 8)} — {b.booking_activities?.activity_name || 'Activity'} — {b.booking_date} {b.booking_time} — {b.customer_email || 'No email'}
                </option>
              ))}
            </select>
          </div>
          )}
          {testBookingsList.length > 0 && (
            <>
              <button
                onClick={handleSendTestEmail}
                disabled={emailSending || !selectedBookingForEmail}
                style={{ ...buttonStyle, backgroundColor: TavariStyles.colors?.primary || '#008080', color: 'white' }}
              >
                {emailSending ? 'Sending…' : 'Send confirmation email'}
              </button>
              {emailSendResult && (
                <pre style={{ marginTop: '12px', padding: '12px', background: '#f3f4f6', borderRadius: '8px', fontSize: '13px', overflow: 'auto' }}>
                  {JSON.stringify(emailSendResult, null, 2)}
                </pre>
              )}
            </>
          )}
        </div>

        {/* 2. Test booking flow (no payment) */}
        <div style={sectionStyle}>
          <h3 style={sectionTitle}><FiEdit3 /> Test booking flow (no payment)</h3>
          <p style={{ marginBottom: '12px', fontSize: '14px', color: TavariStyles.colors?.gray600 }}>
            Create a booking without going through payment. It will appear on the Schedule tab.
          </p>
          {testActivities.length === 0 ? (
            <p style={{ marginBottom: '12px', fontSize: '14px', color: TavariStyles.colors?.gray600 }}>
              No activities yet. Add activities in <strong>Settings → Booking Categories</strong> first, then you can create test bookings here.
            </p>
          ) : null}
          {testActivities.length > 0 ? (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '16px', marginBottom: '16px' }}>
              <div>
                <label style={labelStyle}>Activity *</label>
                <select
                  value={testFormData.activityId}
                  onChange={(e) => setTestFormData({ ...testFormData, activityId: e.target.value })}
                  style={inputStyle}
                >
                  <option value="">— Select —</option>
                  {testActivities.map(a => (
                    <option key={a.id} value={a.id}>{a.activity_name}{a.is_active === false ? ' (inactive)' : ''}</option>
                  ))}
                </select>
              </div>
              <div>
                <label style={labelStyle}>Date *</label>
                <input
                  type="date"
                  value={testFormData.bookingDate}
                  onChange={(e) => setTestFormData({ ...testFormData, bookingDate: e.target.value })}
                  style={inputStyle}
                />
              </div>
              <div>
                <label style={labelStyle}>Time *</label>
                <input
                  type="time"
                  value={testFormData.bookingTime}
                  onChange={(e) => setTestFormData({ ...testFormData, bookingTime: e.target.value })}
                  style={inputStyle}
                />
              </div>
              <div>
                <label style={labelStyle}>Customer email *</label>
                <input
                  type="email"
                  placeholder="test@example.com"
                  value={testFormData.customerEmail}
                  onChange={(e) => setTestFormData({ ...testFormData, customerEmail: e.target.value })}
                  style={inputStyle}
                />
              </div>
            </div>
            <button
              onClick={handleCreateTestBooking}
              disabled={testCreateLoading}
              style={{ ...buttonStyle, backgroundColor: TavariStyles.colors?.primary || '#008080', color: 'white' }}
            >
              {testCreateLoading ? 'Creating…' : 'Create test booking'}
            </button>
            {testCreatedBookingId && (
              <div style={{ marginTop: '12px', display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
                <button
                  onClick={() => { setActiveTab('schedule'); }}
                  style={{ ...buttonStyle, backgroundColor: TavariStyles.colors?.gray200 || '#e5e7eb', color: TavariStyles.colors?.gray800 || '#1f2937' }}
                >
                  <FiCalendar /> View on Schedule
                </button>
                <button
                  onClick={() => openBookingDetail(testCreatedBookingId, { onUpdated: loadDashboardData })}
                  style={{ ...buttonStyle, backgroundColor: TavariStyles.colors?.gray200 || '#e5e7eb', color: TavariStyles.colors?.gray800 || '#1f2937' }}
                >
                  Open booking detail
                </button>
              </div>
            )}
          </>
          ) : (
          <button
            onClick={() => {
              setActiveTab('settings');
              setActiveSettingsTab('categories');
              setSettingsShowMenu(false);
            }}
            style={{ ...buttonStyle, backgroundColor: TavariStyles.colors?.gray200 || '#e5e7eb', color: TavariStyles.colors?.gray800 || '#1f2937' }}
          >
            <FiSettings /> Open Booking Categories (settings)
          </button>
          )}
        </div>

        {/* 3. Calendar note */}
        <div style={sectionStyle}>
          <h3 style={sectionTitle}><FiCalendar /> Adding bookings to the calendar</h3>
          <p style={{ fontSize: '14px', color: TavariStyles.colors?.gray600, margin: 0 }}>
            Bookings you create (here or via New Booking) appear on the <strong>Schedule</strong> tab. Create a test booking above, then switch to the Schedule tab to see it on the calendar.
          </p>
        </div>
      </div>
    );
  };

  const renderSettingsMenuGrid = () => (
    <div>
      <h2
        style={{
          fontSize: 'clamp(20px, 2.5vw, 24px)',
          fontWeight: 600,
          margin: '0 0 8px',
          color: TavariStyles.colors.gray900
        }}
      >
        Booking settings
      </h2>
      <p
        style={{
          fontSize: '14px',
          color: TavariStyles.colors.gray600,
          margin: '0 0 24px',
          maxWidth: '40rem',
          lineHeight: 1.5
        }}
      >
        Pick a section to open. The grid reflows by screen size—add as many items here as you need.
      </p>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 220px), 1fr))',
          gap: '14px',
          width: '100%'
        }}
      >
        {settingsSubTabs.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => goToSettingsSection(item.id)}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-start',
              textAlign: 'left',
              padding: '18px 20px',
              borderRadius: '12px',
              border: '1px solid #e5e7eb',
              backgroundColor: '#fff',
              cursor: 'pointer',
              fontSize: '15px',
              fontWeight: 600,
              color: TavariStyles.colors.gray900,
              boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
              minHeight: '76px',
              lineHeight: 1.35,
              transition: 'border-color 0.15s ease, box-shadow 0.15s ease'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = TavariStyles.colors.primary || '#008080';
              e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.1)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = '#e5e7eb';
              e.currentTarget.style.boxShadow = '0 1px 2px rgba(0,0,0,0.05)';
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
    </div>
  );

  const renderSettingsSubTabRow = () => (
    <TavariTabSystemComponent
      tabs={settingsSubTabs.map((item) => ({
        id: item.id,
        label: item.label,
      }))}
      mode="state"
      activeTab={activeSettingsTab}
      onTabChange={(tabId) => goToSettingsSection(tabId)}
      ariaLabel="Booking settings sections"
      variant="module"
      containerStyle={{ marginBottom: 20 }}
    />
  );

  const renderSettingsEmbeddedChrome = (children) => (
    <div>
      {renderSettingsSubTabRow()}
      {children}
    </div>
  );

  // Render tab content
  const renderTabContent = () => {
    switch (activeTab) {
      case 'dashboard':
        return renderDashboardTab();
      case 'schedule':
        return (
          <Suspense fallback={TAB_LAZY_FALLBACK}>
            <BookingsScheduleView />
          </Suspense>
        );
      case 'list':
        return <BookingListScreen />;
      case 'customers':
        return <POSCustomersScreen embeddedInBookings />;
      case 'registration-forms':
        if (!canViewRegistrationForms) {
          return (
            <div style={{ padding: '40px', textAlign: 'center' }}>
              <h3>Access Denied</h3>
              <p>You do not have permission to view registration forms.</p>
            </div>
          );
        }
        return (
          <CamperRegistrationFormSettings
            businessId={auth.selectedBusinessId}
            initialRegistrationTab="search"
          />
        );
      case 'settings':
        if (settingsShowMenu) {
          return renderSettingsMenuGrid();
        }
        if (activeSettingsTab === 'test') {
          if (!hasElevatedPrivileges()) {
            return renderSettingsEmbeddedChrome(
              <div style={{ padding: '12px', textAlign: 'center', color: TavariStyles.colors.gray600 }}>
                Test tools require manager or owner access.
              </div>
            );
          }
          return renderSettingsEmbeddedChrome(renderTestTab());
        }
        if (activeSettingsTab === 'registration-form') {
          return renderSettingsEmbeddedChrome(
            <CamperRegistrationFormSettings
              businessId={auth.selectedBusinessId}
              initialRegistrationTab="builder"
            />
          );
        }
        return renderSettingsEmbeddedChrome(
          <Suspense fallback={TAB_LAZY_FALLBACK}>
            <BookingSettingsScreen
              activeSubTab={activeSettingsTab}
              onSubTabChange={(id) => {
                setActiveSettingsTab(id);
              }}
            />
          </Suspense>
        );
      default:
        return <div>Tab not found</div>;
    }
  };

  const renderDashboardTab = () => {
    const styles = {
      statsGrid: {
        display: 'grid',
        gridTemplateColumns: isMobile
          ? 'repeat(2, minmax(0, 1fr))'
          : viewportWidth <= 1200
            ? 'repeat(3, minmax(0, 1fr))'
            : 'repeat(5, minmax(0, 1fr))',
        gap: 'clamp(12px, 2vw, 20px)',
        marginBottom: isMobile ? '20px' : '30px',
      },
      statCard: {
        backgroundColor: 'white',
        padding: isMobile ? '14px 16px' : 'clamp(16px, 2.2vw, 22px)',
        borderRadius: '12px',
        border: '1px solid #e5e7eb',
        boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1)',
        minWidth: 0,
      },
      statValue: {
        fontSize: isMobile ? '22px' : 'clamp(24px, 2.8vw, 32px)',
        fontWeight: '600',
        color: TavariStyles.colors.primary,
        wordBreak: 'break-word',
      },
      statLabel: {
        fontSize: isMobile ? '11px' : 'clamp(12px, 1.5vw, 14px)',
        color: TavariStyles.colors.gray600,
        textTransform: 'uppercase',
        letterSpacing: '0.5px',
        lineHeight: 1.3,
        marginBottom: '8px',
      },
      columnsGrid: {
        display: 'grid',
        gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr',
        gap: isMobile ? '16px' : '20px',
        marginBottom: isMobile ? '20px' : '30px',
      },
      paymentStatRow: {
        display: 'flex',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        gap: '8px',
        minWidth: 0,
      },
      paymentStatCount: {
        fontSize: isMobile ? '20px' : 'clamp(22px, 2.4vw, 28px)',
        fontWeight: '700',
        lineHeight: 1,
        flexShrink: 0,
      },
      paymentStatLabel: {
        fontSize: isMobile ? '10px' : '11px',
        color: TavariStyles.colors.gray600,
        textAlign: 'right',
        lineHeight: 1.35,
      },
      upcomingSection: {
        backgroundColor: 'white',
        padding: isMobile ? '16px' : '24px',
        borderRadius: '12px',
        border: '1px solid #e5e7eb',
        boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1)',
        minWidth: 0,
      },
      sectionTitle: {
        fontSize: isMobile ? '18px' : '20px',
        fontWeight: '600',
        color: TavariStyles.colors.gray900,
        marginBottom: isMobile ? '14px' : '20px',
      },
      scrollPanel: {
        maxHeight: isMobile ? 'min(420px, 55vh)' : '600px',
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column',
        gap: isMobile ? '10px' : '12px',
        WebkitOverflowScrolling: 'touch',
      },
      bookingCard: {
        padding: isMobile ? '14px' : '16px',
        border: '1px solid #e5e7eb',
        borderRadius: '8px',
        marginBottom: 0,
        cursor: 'pointer',
        transition: 'all 0.2s',
        minWidth: 0,
      },
      bookingCardRow: {
        display: 'flex',
        flexDirection: isMobile ? 'column' : 'row',
        justifyContent: 'space-between',
        alignItems: isMobile ? 'stretch' : 'center',
        gap: isMobile ? '12px' : 0,
      },
      bookingCardMeta: {
        flex: 1,
        minWidth: 0,
      },
      bookingCardActions: {
        textAlign: isMobile ? 'left' : 'right',
        marginLeft: isMobile ? 0 : '12px',
        flexShrink: 0,
        width: isMobile ? '100%' : 'auto',
      },
      followUpSelect: {
        width: isMobile ? '100%' : 'auto',
        maxWidth: isMobile ? '100%' : '180px',
      },
      messageCardHeader: {
        display: 'flex',
        flexDirection: isMobile ? 'column' : 'row',
        justifyContent: 'space-between',
        alignItems: isMobile ? 'flex-start' : 'start',
        gap: isMobile ? '6px' : 0,
        marginBottom: '4px',
      },
      messageTimestamp: {
        fontSize: '11px',
        color: TavariStyles.colors.gray500,
        whiteSpace: isMobile ? 'normal' : 'nowrap',
        marginLeft: isMobile ? 0 : '12px',
        flexShrink: 0,
      },
      messagesHeader: {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: isMobile ? 'flex-start' : 'center',
        flexWrap: 'wrap',
        gap: '10px',
        marginBottom: isMobile ? '14px' : '20px',
      },
      primaryButton: {
        backgroundColor: TavariStyles.colors.primary,
        color: 'white',
        border: 'none',
        padding: '12px 24px',
        borderRadius: '8px',
        fontSize: '16px',
        fontWeight: '600',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
      },
    };

    return (
      <div>
        {/* Stats Grid */}
        <div style={styles.statsGrid}>
          <div style={styles.statCard}>
            <div style={styles.statLabel}>Total Bookings</div>
            <div style={styles.statValue}>{stats.totalBookings}</div>
          </div>
          <div style={styles.statCard}>
            <div style={styles.statLabel}>Today's Bookings</div>
            <div style={styles.statValue}>{stats.todayBookings}</div>
          </div>
          <div style={styles.statCard}>
            <div style={styles.statLabel}>Upcoming</div>
            <div style={styles.statValue}>{stats.upcomingBookings}</div>
          </div>
          <div style={styles.statCard}>
            <div style={styles.statLabel}>Revenue</div>
            <div style={styles.statValue}>${stats.revenue.toFixed(2)}</div>
          </div>
          <button
            type="button"
            onClick={() => setPaymentFollowUpsModalOpen(true)}
            style={{
              ...styles.statCard,
              cursor: 'pointer',
              textAlign: 'left',
              width: '100%',
              font: 'inherit',
              color: 'inherit',
            }}
            aria-label="Open payment follow-ups"
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = TavariStyles.colors.primary;
              e.currentTarget.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.1)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = '#e5e7eb';
              e.currentTarget.style.boxShadow = '0 1px 3px 0 rgba(0, 0, 0, 0.1)';
            }}
          >
            <div style={styles.statLabel}>Payments</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {[
                {
                  key: PAYMENT_DASHBOARD_BUCKETS.OVERDUE,
                  label: 'Overdue payments',
                  color: '#dc2626',
                },
                {
                  key: PAYMENT_DASHBOARD_BUCKETS.PENDING,
                  label: 'Pending payments',
                  color: '#d97706',
                },
                {
                  key: PAYMENT_DASHBOARD_BUCKETS.BALANCE_AFTER_PARTY,
                  label: 'Balance after party',
                  color: '#7c3aed',
                },
              ].map((section) => (
                <div key={section.key} style={styles.paymentStatRow}>
                  <span style={{ ...styles.paymentStatCount, color: section.color }}>
                    {loading ? '—' : (paymentQueues[section.key]?.length || 0)}
                  </span>
                  <span style={styles.paymentStatLabel}>{section.label}</span>
                </div>
              ))}
            </div>
          </button>
        </div>

        {/* Action cards: Messages and Pending Bookings */}
        <div style={styles.columnsGrid}>
          {/* Messages Column */}
          <div style={styles.upcomingSection}>
            <div style={styles.messagesHeader}>
              <h2 style={{ ...styles.sectionTitle, marginBottom: 0 }}>Messages</h2>
              {activityMessages.length > 0 && (
                <button
                  onClick={clearMessages}
                  style={{
                    padding: '6px 12px',
                    backgroundColor: TavariStyles.colors.gray700,
                    color: 'white',
                    border: 'none',
                    borderRadius: '6px',
                    fontSize: '13px',
                    fontWeight: '600',
                    cursor: 'pointer'
                  }}
                >
                  Clear All
                </button>
              )}
            </div>
            {loading ? (
              <p style={{ color: TavariStyles.colors.gray600 }}>Loading messages...</p>
            ) : activityMessages.length === 0 ? (
              <p style={{ color: TavariStyles.colors.gray600 }}>No messages</p>
            ) : (
              <div style={styles.scrollPanel}>
                {activityMessages.map((message, index) => (
                  <div
                    key={message.id || index}
                    style={{
                      padding: '12px 14px',
                      backgroundColor: '#fff',
                      borderRadius: '8px',
                      border: `1px solid ${message.isCancel ? '#fecaca' : '#e5e7eb'}`,
                      borderLeft: `3px solid ${message.badgeColor || '#9ca3af'}`,
                      cursor: message.bookingId ? 'pointer' : 'default',
                      minWidth: 0,
                    }}
                    onClick={() => {
                      if (!message.bookingId) return;
                      openBookingDetail(message.bookingId, { onUpdated: loadDashboardData });
                    }}
                    onMouseEnter={(e) => {
                      if (message.bookingId) {
                        e.currentTarget.style.backgroundColor = '#f9fafb';
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (message.bookingId) {
                        e.currentTarget.style.backgroundColor = '#fff';
                      }
                    }}
                  >
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '13px', lineHeight: 1.4, color: TavariStyles.colors.gray900 }}>
                      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px 10px' }}>
                        <span style={{ color: TavariStyles.colors.gray500, fontSize: '13px', whiteSpace: 'nowrap' }}>
                          {formatDateTimeForBusiness(message.timestamp, businessTimezone)}
                        </span>
                        {message.badge ? (
                          <span style={{
                            fontSize: '11px',
                            fontWeight: 700,
                            letterSpacing: '0.02em',
                            textTransform: 'uppercase',
                            color: message.badgeColor || TavariStyles.colors.gray600,
                            background: message.badgeBg || '#f3f4f6',
                            borderRadius: '999px',
                            padding: '2px 8px',
                            whiteSpace: 'nowrap',
                          }}>
                            {message.badge}
                          </span>
                        ) : null}
                        <span style={{ fontWeight: 700, minWidth: 0 }}>
                          {message.booker}
                        </span>
                      </div>
                      <div style={{ color: TavariStyles.colors.gray700 }}>
                        {message.visitDate}
                        {message.visitTime && message.visitTime !== '—' ? ` · ${message.visitTime}` : ''}
                      </div>
                      <div style={{ fontWeight: 600 }}>
                        {message.activity}
                      </div>
                      <div style={{ color: TavariStyles.colors.gray600, fontSize: '13px' }}>
                        Booking #{message.bookingRef}
                      </div>
                      <div style={{ color: TavariStyles.colors.gray500, fontSize: '13px' }}>
                        Updated by: {message.updatedBy || 'System'}
                      </div>
                      {message.isCancel && cancelledBookingsById[message.bookingId] ? (
                        <div style={{ marginTop: 6 }} onClick={(e) => e.stopPropagation()}>
                          <BookingRestoreButton
                            booking={cancelledBookingsById[message.bookingId]}
                            businessId={auth.selectedBusinessId}
                            onRestored={loadDashboardData}
                            compact
                          />
                        </div>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Pending Bookings Column */}
          <div style={styles.upcomingSection}>
            <h2 style={styles.sectionTitle}>Pending Bookings</h2>
            {loading ? (
              <p style={{ color: TavariStyles.colors.gray600 }}>Loading...</p>
            ) : pendingBookings.length === 0 ? (
              <p style={{ color: TavariStyles.colors.gray600 }}>No pending bookings requiring approval</p>
            ) : (
              <div style={styles.scrollPanel}>
                {pendingBookings.map(booking => (
                  <div
                    key={booking.id}
                    style={styles.bookingCard}
                    onClick={() => openBookingDetail(booking.id, { onUpdated: loadDashboardData })}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.borderColor = TavariStyles.colors.primary;
                      e.currentTarget.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.1)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.borderColor = '#e5e7eb';
                      e.currentTarget.style.boxShadow = 'none';
                    }}
                  >
                    <div style={styles.bookingCardRow}>
                      <div style={styles.bookingCardMeta}>
                        <div style={{ fontWeight: '600', fontSize: isMobile ? '15px' : '16px', marginBottom: '4px' }}>
                          {getBookingAdultDisplayName(booking)}
                        </div>
                        <div style={{ color: TavariStyles.colors.gray600, fontSize: '14px', marginBottom: '2px' }}>
                          {booking.booking_activities?.activity_name || 'Activity'}
                        </div>
                        <div style={{ color: TavariStyles.colors.gray600, fontSize: '14px', marginBottom: '2px', lineHeight: 1.4 }}>
                          {formatDateShort(booking.booking_date, businessTimezone)} · {formatBookingTimeRangeLabel(booking)}
                        </div>
                        {(booking.customer_email || booking.customer_phone) && (
                          <div style={{
                            color: TavariStyles.colors.gray500,
                            fontSize: '13px',
                            marginBottom: '2px',
                            wordBreak: 'break-word',
                          }}>
                            {[booking.customer_email, booking.customer_phone].filter(Boolean).join(' · ')}
                          </div>
                        )}
                        {booking.booking_number && (
                          <div style={{ color: TavariStyles.colors.gray500, fontSize: '13px' }}>
                            Booking #{booking.booking_number}
                          </div>
                        )}
                        {booking.terms_package_id && booking.terms_status === 'pending' && (
                          <div style={{
                            marginTop: 6,
                            display: 'inline-block',
                            fontSize: 11,
                            fontWeight: 700,
                            color: '#9a3412',
                            backgroundColor: '#ffedd5',
                            border: '1px solid #fed7aa',
                            borderRadius: 999,
                            padding: '2px 8px',
                          }}>
                            T&Cs pending
                          </div>
                        )}
                        {booking.terms_status === 'signed' && !booking.approved_at && (
                          <div style={{
                            marginTop: 6,
                            display: 'inline-block',
                            fontSize: 11,
                            fontWeight: 700,
                            color: '#166534',
                            backgroundColor: '#dcfce7',
                            border: '1px solid #86efac',
                            borderRadius: 999,
                            padding: '2px 8px',
                          }}>
                            T&Cs signed
                          </div>
                        )}
                      </div>
                      <div
                        style={styles.bookingCardActions}
                        onClick={(event) => event.stopPropagation()}
                        onMouseDown={(event) => event.stopPropagation()}
                      >
                        {(() => {
                          const followUpStatus = booking.approval_follow_up_status || 'pending';
                          const followUpStyle = getApprovalFollowUpStyle(followUpStatus);
                          return (
                            <select
                              value={followUpStatus}
                              disabled={followUpUpdatingId === booking.id}
                              onChange={(event) => handleApprovalFollowUpChange(booking.id, event.target.value, event)}
                              aria-label="Approval follow-up status"
                              style={{
                                ...styles.followUpSelect,
                                padding: '6px 28px 6px 12px',
                                borderRadius: '12px',
                                fontSize: '13px',
                                fontWeight: '600',
                                backgroundColor: followUpStyle.bg,
                                color: followUpStyle.color,
                                border: `1px solid ${followUpStyle.border}`,
                                marginBottom: booking.notes ? '8px' : 0,
                                cursor: followUpUpdatingId === booking.id ? 'wait' : 'pointer',
                                appearance: 'none',
                                WebkitAppearance: 'none',
                                MozAppearance: 'none',
                                boxSizing: 'border-box',
                                backgroundImage:
                                  `linear-gradient(45deg, transparent 50%, ${followUpStyle.color} 50%),`
                                  + `linear-gradient(135deg, ${followUpStyle.color} 50%, transparent 50%)`,
                                backgroundPosition: 'calc(100% - 14px) calc(50% - 2px), calc(100% - 9px) calc(50% - 2px)',
                                backgroundSize: '5px 5px, 5px 5px',
                                backgroundRepeat: 'no-repeat',
                              }}
                            >
                              {APPROVAL_FOLLOW_UP_OPTIONS.map((option) => (
                                <option key={option.value} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                          );
                        })()}
                        {booking.notes && (
                          <div style={{
                            fontSize: '11px',
                            color: TavariStyles.colors.gray600,
                            maxWidth: isMobile ? '100%' : '150px',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }} title={booking.notes}>
                            {booking.notes}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  if (permissionsLoading) {
    return (
      <div style={{ padding: '40px', textAlign: 'center' }}>
        <div>Loading...</div>
      </div>
    );
  }

  if (!canViewBookings) {
    return (
      <div style={{ padding: '40px', textAlign: 'center' }}>
        <h3>Access Denied</h3>
        <p>You do not have permission to view bookings.</p>
      </div>
    );
  }

  const styles = {
    container: {
      padding: isMobile ? '12px' : 'clamp(16px, 3vw, 30px)',
      paddingTop: isMobile ? '68px' : '80px',
      maxWidth: '100%',
      width: '100%',
      margin: 0,
      backgroundColor: '#f9fafb',
      minHeight: isMobile ? 'auto' : 'calc(100vh - 100px)',
      boxSizing: 'border-box',
      overflowX: 'hidden',
    },
    header: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: isMobile ? '20px' : '30px',
    },
    title: {
      fontSize: isMobile ? '24px' : '32px',
      fontWeight: '600',
      color: TavariStyles.colors.gray900,
      margin: 0,
    },
    tabContent: {
      backgroundColor: 'white',
      borderRadius: '12px',
      padding: isMobile ? '16px' : 'clamp(20px, 4vw, 30px)',
      border: '1px solid #e5e7eb',
      boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1)',
      minHeight: isMobile ? 'auto' : '500px',
      width: '100%',
      boxSizing: 'border-box',
      overflowX: 'hidden',
    },
  };

  return (
    <SecurityWrapper>
      <POSAuthWrapper
        requiredRoles={['employee', 'manager', 'owner']}
        requireBusiness={true}
        componentName="BookingsDashboard"
      >
        <div style={styles.container}>
          <TavariModuleHeader
            title="Tavari Bookings"
            description={isNarrow ? undefined : 'Manage booking intake, schedules, availability, waivers, and customer appointments.'}
            actionLabel={canCreateBookings ? (isNarrow ? 'New' : 'New Booking') : undefined}
            actionIcon={canCreateBookings ? <FiPlus size={18} /> : null}
            onAction={() => navigate('/dashboard/bookings/create')}
            containerStyle={isMobile ? { gridTemplateColumns: 'minmax(0, 1fr)' } : undefined}
            actionContainerStyle={isMobile ? { minWidth: 0, width: '100%' } : undefined}
            titleStyle={isMobile ? { fontSize: '24px' } : undefined}
          />

          <TavariTabSystemComponent
            tabs={availableTabs.map((tab) => ({
              id: tab.id,
              label: tab.label,
              icon: tab.icon,
            }))}
            mode="state"
            activeTab={activeTab}
            onTabChange={handleTabChange}
            ariaLabel="Bookings module"
            variant="module"
          />

          {/* Tab Content */}
          <div style={styles.tabContent}>
            {renderTabContent()}
          </div>

          <BookingPaymentFollowUpsModal
            open={paymentFollowUpsModalOpen}
            onClose={() => setPaymentFollowUpsModalOpen(false)}
            paymentQueues={paymentQueues}
            businessTimezone={businessTimezone}
            businessId={auth.selectedBusinessId}
            isMobile={isMobile}
            onSelectBooking={(bookingId) => {
              openBookingDetail(bookingId, {
                onUpdated: async () => {
                  await loadDashboardData();
                },
              });
            }}
            onEmailSent={loadDashboardData}
          />
        </div>
      </POSAuthWrapper>
    </SecurityWrapper>
  );
};

export default BookingsDashboard;
