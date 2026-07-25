// screens/POS/POSCustomersScreen.jsx - With Permissions and Clean Logging
import React, { useState, useEffect, useLayoutEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import POSAuthWrapper from '../../components/Auth/POSAuthWrapper';
import TavariCheckbox from '../../components/UI/TavariCheckbox';
import { TavariStyles } from '../../utils/TavariStyles';
import { useTaxCalculations } from '../../hooks/useTaxCalculations';
import { usePOSAuth } from '../../hooks/usePOSAuth';
import { supabase } from '../../supabaseClient';
import { X, Plus, Minus, Lock, AlertCircle } from 'lucide-react';
import { mapLegacyWaiverRow } from '../../services/Waivers/legacyWaiverMapper';
import {
  getAccountCardStyleSurface,
  mergeCustomerTableRowStyle,
  ACCOUNT_CARD_STYLE_OPTIONS
} from '../../helpers/posLoyaltyAccountStyle';
import {
  applyStoreCreditLine,
  fetchStoreCreditHistory,
  STORE_CREDIT_CATEGORIES,
  TX_STORE_CREDIT,
  TX_STORE_CREDIT_REV
} from '../../services/POS/StoreCreditService';
import {
  dollarsToLoyaltyPoints,
  getSpendableDollarsInDollarsMode,
  isPointsLoyaltyMode
} from '../../utils/posLoyaltyMoney';

// Permission system integration
import { usePermissions } from '../../hooks/usePermissions';
import PermissionGate from '../../components/Auth/PermissionGate';
import TavariModuleHeader from '../../components/UI/TavariModuleHeader';
import toast from 'react-hot-toast';
import CustomerModuleBookingsTabPanel from '../../components/Bookings/CustomerModuleBookingsTabPanel';
import bookingService from '../../services/Bookings/BookingService';
import camperRegistrationService from '../../services/Bookings/CamperRegistrationService';
import { useModuleEnabled } from '../../hooks/useModuleEnabled';

const EXPIRING_SOON_DAYS = 30;
const DISPLAY_FALLBACK_EXPIRY_DAYS = 365;

function parsePositiveExpiryDays(raw) {
  if (raw == null || raw === '') return null;
  const n = typeof raw === 'number' ? raw : parseInt(String(raw).trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** PostgREST `ilike` — escape %, _, \ for user search text */
function escapeIlikePattern(needle) {
  if (needle == null) return '';
  return String(needle)
    .replace(/\\/g, '\\\\')
    .replace(/[%_]/g, (ch) => `\\${ch}`);
}

const CUSTOMERS_LIST_PAGE_SIZE = 100;
const CUSTOMERS_LIST_SELECT =
  'id, business_id, customer_name, customer_email, customer_phone, balance, points, store_credit, gift_card_credit, created_at, notes, account_card_style, restrict_check_in, updated_at';
const LOYALTY_HISTORY_MAX = 500;
const SEARCH_DEBOUNCE_MS = 300;

const PROFILE_TABS = [
  { id: 'info', label: 'Info' },
  { id: 'bookings', label: 'Bookings' },
  { id: 'loyalty', label: 'Loyalty' },
  { id: 'marketing', label: 'Marketing' },
  { id: 'waivers', label: 'Waivers' },
  { id: 'notes', label: 'Notes' },
  { id: 'credits', label: 'Credits' },
  { id: 'giftcards', label: 'Gift Cards' }
];

function getParticipantPersonKey(participant) {
  if (!participant) return '';
  const type = String(participant.participant_type || '').trim().toLowerCase();
  const first = String(participant.first_name || '').trim().toLowerCase();
  const last = String(participant.last_name || '').trim().toLowerCase();
  const dob = String(participant.date_of_birth || '').trim();
  if (!type && !first && !last && !dob) return String(participant.id || '');
  return `${type}:${first}:${last}:${dob}`;
}

const POSCustomersScreen = ({
  embeddedProfile = false,
  /** When true (e.g. Bookings module tab), hide TavariModuleHeader and POS top offset — parent supplies chrome */
  embeddedInBookings = false,
  initialCustomerId = '',
  initialCustomerSearch = '',
  initialTab = 'info',
  /** When set (e.g. Bookings dashboard message), Bookings tab focuses this module booking */
  initialBookingId = '',
  onEmbeddedClose
} = {}) => {
  const [customers, setCustomers] = useState([]);
  const listQueryRef = useRef(0);
  const [error, setError] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [searchDebounced, setSearchDebounced] = useState('');
  const [listPage, setListPage] = useState(0);
  const [listTotalCount, setListTotalCount] = useState(0);
  const [listLoading, setListLoading] = useState(true);
  const [dashboardStats, setDashboardStats] = useState({
    accountCount: 0,
    sumBalance: 0,
    sumStoreCredit: 0,
    totalPointsStat: 0
  });
  const [topLoyaltyByBalance, setTopLoyaltyByBalance] = useState([]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  /** 'info' | 'bookings' | 'loyalty' | 'notes' | 'credits' | 'giftcards' */
  const [customerProfileTab, setCustomerProfileTab] = useState('info');
  const [showCustomerProfileModal, setShowCustomerProfileModal] = useState(false);
  const [customerTransactions, setCustomerTransactions] = useState([]);
  const [customerMarketing, setCustomerMarketing] = useState(null);
  const [customerMarketingLoading, setCustomerMarketingLoading] = useState(false);
  const [customerWaivers, setCustomerWaivers] = useState([]);
  const [customerWaiversLoading, setCustomerWaiversLoading] = useState(false);
  const [defaultWaiverExpiryDays, setDefaultWaiverExpiryDays] = useState(null);
  const [sortBy, setSortBy] = useState('created_at');
  const [sortOrder, setSortOrder] = useState('desc');
  
  // Loyalty transaction history (shown inside customer profile modal — Loyalty tab only)
  const [loyaltyTransactions, setLoyaltyTransactions] = useState([]);
  const [loyaltyHistoryLoading, setLoyaltyHistoryLoading] = useState(false);
  const [loyaltySettings, setLoyaltySettings] = useState(null);
  
  // Manual points adjustment states
  const [showAddPoints, setShowAddPoints] = useState(false);
  const [showRemovePoints, setShowRemovePoints] = useState(false);
  const [adjustmentAmount, setAdjustmentAmount] = useState('');
  const [adjustmentReason, setAdjustmentReason] = useState('');
  const [managerPin, setManagerPin] = useState('');
  const [adjustmentLoading, setAdjustmentLoading] = useState(false);
  const [adjustmentError, setAdjustmentError] = useState(null);
  const [showTopLoyaltyBalanceModal, setShowTopLoyaltyBalanceModal] = useState(false);

  const selectedCustomerRef = useRef(null);
  useEffect(() => {
    selectedCustomerRef.current = selectedCustomer;
  });

  useEffect(() => {
    const t = setTimeout(() => setSearchDebounced(searchTerm.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [searchTerm]);

  useLayoutEffect(() => {
    setListPage(0);
  }, [searchDebounced, sortBy, sortOrder]);

  // Form state
  const [formData, setFormData] = useState({
    customer_name: '',
    customer_email: '',
    customer_phone: '',
    balance: 0,
    points: 0,
    notes: '',
    account_card_style: 'default',
    restrict_check_in: false
  });

  const [profileNotesState, setProfileNotesState] = useState({
    notes: '',
    account_card_style: 'default',
    restrict_check_in: false
  });
  const [participantNotesRows, setParticipantNotesRows] = useState([]);
  const [participantNotesLoading, setParticipantNotesLoading] = useState(false);
  const [notesTabSaving, setNotesTabSaving] = useState(false);

  const [storeCreditHistory, setStoreCreditHistory] = useState([]);
  const [storeCreditLoading, setStoreCreditLoading] = useState(false);
  const [creditAmount, setCreditAmount] = useState('');
  const [creditCategory, setCreditCategory] = useState('deposit');
  const [creditNote, setCreditNote] = useState('');
  const [creditPin, setCreditPin] = useState('');
  const [creditIsReversal, setCreditIsReversal] = useState(false);
  const [creditSubmitting, setCreditSubmitting] = useState(false);
  const [creditError, setCreditError] = useState(null);
  const [sendingRegistrationEmailTo, setSendingRegistrationEmailTo] = useState(null);

  const auth = usePOSAuth({
    requireBusiness: true,
    componentName: 'POSCustomersScreen'
  });

  // Permission system integration
  const { 
    hasPermission, 
    hasAnyPermission,
    isOwner, 
    isManager,
    hasElevatedPrivileges,
    loading: permissionsLoading 
  } = usePermissions();

  // Permission checks
  const canViewCustomers = hasAnyPermission(['pos.customers.view', 'pos.loyalty.manage']) || hasElevatedPrivileges();
  const canManageCustomers = hasPermission('pos.customers.manage') || hasElevatedPrivileges();
  const canViewLoyalty = hasPermission('pos.loyalty.use') || hasElevatedPrivileges();
  const canManageLoyalty = hasPermission('pos.loyalty.manage') || hasElevatedPrivileges();
  const canAdjustPoints = hasPermission('pos.loyalty.adjust') || isOwner();
  const canDeleteCustomers = hasPermission('pos.customers.manage') || isOwner();
  const canSendRegistrationLink =
    hasAnyPermission(['bookings.settings.edit', 'bookings.view', 'bookings.view_all']) ||
    hasElevatedPrivileges();
  const { isEnabled: bookingsModuleEnabled } = useModuleEnabled('bookings');
  const showRegistrationActions = bookingsModuleEnabled && canSendRegistrationLink;

  const { formatTaxAmount } = useTaxCalculations(auth.selectedBusinessId);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const handledProfileLinkRef = useRef('');

  // Check permissions on mount
  useEffect(() => {
    if (!permissionsLoading && !canViewCustomers) {
      toast.error('You do not have permission to view customers');
    }
  }, [permissionsLoading, canViewCustomers]);

  // Load loyalty settings
  useEffect(() => {
    const loadLoyaltySettings = async () => {
      if (!auth.selectedBusinessId) return;

      try {
        const { data: settings, error } = await supabase
          .from('pos_loyalty_settings')
          .select('*')
          .eq('business_id', auth.selectedBusinessId)
          .single();

        if (error && error.code !== 'PGRST116') {
          return;
        }

        if (settings) {
          setLoyaltySettings(settings);
        }
      } catch (err) {
        // Silent fail
      }
    };

    if (auth.selectedBusinessId) {
      loadLoyaltySettings();
    }
  }, [auth.selectedBusinessId]);

  useEffect(() => {
    const loadDefaultWaiverExpiry = async () => {
      if (!auth.selectedBusinessId) {
        setDefaultWaiverExpiryDays(null);
        return;
      }

      try {
        const { data } = await supabase
          .from('waiver_settings')
          .select('setting_value')
          .eq('business_id', auth.selectedBusinessId)
          .eq('setting_key', 'default_expiry_days')
          .eq('is_global', true)
          .maybeSingle();
        setDefaultWaiverExpiryDays(parsePositiveExpiryDays(data?.setting_value));
      } catch {
        setDefaultWaiverExpiryDays(null);
      }
    };

    loadDefaultWaiverExpiry();
  }, [auth.selectedBusinessId]);

  const loadDashboardStats = useCallback(async () => {
    if (!auth.selectedBusinessId || !canViewCustomers) return;
    const bid = auth.selectedBusinessId;
    const rate = Number(loyaltySettings?.redemption_rate) || 10000;

    try {
      const [aggResult, topResult] = await Promise.all([
        supabase.rpc('pos_loyalty_accounts_dashboard_aggregates', {
          p_business_id: bid,
          p_include_balance_in_points: false,
          p_redemption_rate: rate
        }),
        supabase
          .from('pos_loyalty_accounts')
          .select(CUSTOMERS_LIST_SELECT)
          .eq('business_id', bid)
          .order('store_credit', { ascending: false })
          .limit(10)
      ]);

      if (aggResult.error) {
        console.warn('[POSCustomersScreen] dashboard aggregates RPC', aggResult.error);
        const { count } = await supabase
          .from('pos_loyalty_accounts')
          .select('id', { count: 'exact', head: true })
          .eq('business_id', bid);
        setDashboardStats((prev) => ({
          accountCount: count ?? 0,
          sumBalance: prev.sumBalance,
          sumStoreCredit: prev.sumStoreCredit,
          totalPointsStat: prev.totalPointsStat
        }));
      } else {
        const agg = aggResult.data;
        if (agg && typeof agg === 'object') {
          const totalPts =
            loyaltySettings?.loyalty_mode === 'points' || !loyaltySettings
              ? Number(agg.sum_display_points) || 0
              : Number(agg.sum_raw_points) || 0;
          setDashboardStats({
            accountCount: Number(agg.account_count) || 0,
            sumBalance: Number(agg.sum_balance) || 0,
            sumStoreCredit: Number(agg.sum_store_credit) || 0,
            totalPointsStat: totalPts
          });
        }
      }

      if (!topResult.error && topResult.data) {
        setTopLoyaltyByBalance(topResult.data);
      }
    } catch (e) {
      console.warn('[POSCustomersScreen] loadDashboardStats', e);
    }
  }, [auth.selectedBusinessId, canViewCustomers, loyaltySettings]);

  const loadCustomerList = useCallback(async () => {
    if (!auth.selectedBusinessId || !canViewCustomers) return;
    const bid = auth.selectedBusinessId;
    const req = ++listQueryRef.current;
    setListLoading(true);
    try {
      const search = searchDebounced;
      const from = listPage * CUSTOMERS_LIST_PAGE_SIZE;
      const to = from + CUSTOMERS_LIST_PAGE_SIZE - 1;
      let q = supabase
        .from('pos_loyalty_accounts')
        .select(CUSTOMERS_LIST_SELECT, { count: 'exact' })
        .eq('business_id', bid);
      if (search) {
        const pat = escapeIlikePattern(search);
        q = q.or(
          `customer_name.ilike.%${pat}%,customer_email.ilike.%${pat}%,customer_phone.ilike.%${pat}%`
        );
      }
      q = q.order(sortBy, { ascending: sortOrder === 'asc' }).range(from, to);
      const { data, count, error: fetchError } = await q;
      if (req !== listQueryRef.current) return;
      if (fetchError) throw fetchError;
      const rows = data || [];
      setCustomers(rows);
      setListTotalCount(typeof count === 'number' ? count : rows.length);
      setSelectedCustomer((prev) => {
        if (!prev?.id) return prev;
        const next = rows.find((r) => r.id === prev.id);
        return next ? { ...prev, ...next } : prev;
      });
    } catch (err) {
      if (req === listQueryRef.current) {
        setError('Failed to load customers: ' + err.message);
        toast.error('Failed to load customers');
      }
    } finally {
      if (req === listQueryRef.current) setListLoading(false);
    }
  }, [auth.selectedBusinessId, canViewCustomers, listPage, searchDebounced, sortBy, sortOrder]);

  const refreshListAndStats = useCallback(async () => {
    await Promise.all([loadCustomerList(), loadDashboardStats()]);
  }, [loadCustomerList, loadDashboardStats]);

  // Load customer POS sales transactions
  const loadCustomerTransactions = useCallback(async (customerId) => {
    if (!customerId || !canViewCustomers) return;
    
    try {
      const { data, error: fetchError } = await supabase
        .from('pos_sales')
        .select(`
          id,
          sale_number,
          total,
          created_at,
          payment_status,
          user_id,
          users!pos_sales_user_id_fkey(name)
        `)
        .eq('loyalty_customer_id', customerId)
        .order('created_at', { ascending: false })
        .limit(50);

      if (fetchError) throw fetchError;
      setCustomerTransactions(data || []);
    } catch (err) {
      toast.error('Failed to load customer transactions');
    }
  }, [canViewCustomers]);

  // Load customer loyalty transaction history
  const loadLoyaltyHistory = useCallback(async (customer) => {
    if (!customer || !auth.selectedBusinessId || !canViewLoyalty) {
      if (!canViewLoyalty) {
        toast.error('You do not have permission to view loyalty history');
      }
      return;
    }
    
    setLoyaltyHistoryLoading(true);

    try {
      const { data, error } = await supabase
        .from('pos_loyalty_transactions')
        .select('*')
        .eq('loyalty_account_id', customer.id)
        .eq('business_id', auth.selectedBusinessId)
        .order('created_at', { ascending: false })
        .limit(LOYALTY_HISTORY_MAX);

      if (error) {
        setLoyaltyTransactions([]);
        toast.error('Failed to load loyalty history');
      } else {
        // Credits tab / store-credit ledger lines are separate — do not mix into loyalty history
        const rows = (data || []).filter(
          (t) =>
            t.transaction_type !== TX_STORE_CREDIT &&
            t.transaction_type !== TX_STORE_CREDIT_REV
        );
        setLoyaltyTransactions(rows);
      }

    } catch (err) {
      setLoyaltyTransactions([]);
      toast.error('Failed to load loyalty history');
    } finally {
      setLoyaltyHistoryLoading(false);
    }
  }, [auth.selectedBusinessId, canViewLoyalty]);

  const loadStoreCreditHistoryForCustomer = useCallback(
    async (customerId) => {
      if (!customerId || !auth.selectedBusinessId) return;
      setStoreCreditLoading(true);
      try {
        const rows = await fetchStoreCreditHistory(customerId, auth.selectedBusinessId);
        setStoreCreditHistory(rows);
      } catch {
        setStoreCreditHistory([]);
      } finally {
        setStoreCreditLoading(false);
      }
    },
    [auth.selectedBusinessId]
  );

  const normalizePhoneDigits = (value) => String(value || '').replace(/\D/g, '');

  const formatMarketingDate = (value) => {
    if (!value) return '—';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
  };

  const buildEmptyMarketingProfile = (message = null) => ({
    contact: null,
    email: {
      authorized: false,
      grantedAt: null,
      revokedAt: null,
      note: message || 'No email marketing contact found for this customer.'
    },
    sms: {
      authorized: false,
      grantedAt: null,
      revokedAt: null,
      note: 'No SMS marketing authorization record found.'
    },
    received: [],
    upcoming: [],
    automations: []
  });

  const firstSuccessful = async (queries) => {
    for (const queryFactory of queries) {
      try {
        const result = await queryFactory();
        if (!result?.error) return result;
      } catch {
        // Try the next compatible query shape.
      }
    }
    return { data: [], error: null };
  };

  const loadCustomerMarketing = useCallback(async (customer) => {
    if (!customer || !auth.selectedBusinessId || !canViewCustomers) return;

    setCustomerMarketingLoading(true);
    try {
      const email = String(customer.customer_email || '').trim().toLowerCase();
      const phoneDigits = normalizePhoneDigits(customer.customer_phone);

      if (!email && !phoneDigits) {
        setCustomerMarketing(buildEmptyMarketingProfile('Customer has no email or phone to match marketing records.'));
        return;
      }

      let contact = null;
      if (email) {
        const { data } = await supabase
          .from('mail_contacts')
          .select('*')
          .eq('business_id', auth.selectedBusinessId)
          .ilike('email', email)
          .order('updated_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        contact = data || null;
      }

      if (!contact && phoneDigits) {
        const { data } = await supabase
          .from('mail_contacts')
          .select('*')
          .eq('business_id', auth.selectedBusinessId)
          .ilike('phone', `%${phoneDigits.slice(-7)}%`)
          .order('updated_at', { ascending: false })
          .limit(10);
        contact = (data || []).find((row) => normalizePhoneDigits(row.phone) === phoneDigits) || null;
      }

      if (!contact) {
        setCustomerMarketing(buildEmptyMarketingProfile());
        return;
      }

      const consentQuery = supabase
        .from('mail_consent_log')
        .select('id, action, consent_source, consent_method, consent_text, timestamp, created_at, additional_data')
        .eq('business_id', auth.selectedBusinessId)
        .order('timestamp', { ascending: false })
        .limit(50);

      const consentResult = contact.id
        ? await consentQuery.eq('contact_id', contact.id)
        : email
          ? await consentQuery.ilike('email_address', email)
          : { data: [], error: null };

      const consentLogs = consentResult.error ? [] : consentResult.data || [];
      const latestSubscribed = consentLogs.find((row) => String(row.action || '').toLowerCase() === 'subscribed');
      const latestUnsubscribed = consentLogs.find((row) => String(row.action || '').toLowerCase() === 'unsubscribed');

      const sendsResult = contact.id
        ? await supabase
          .from('mail_campaign_sends')
          .select(`
            id,
            status,
            email_address,
            sent_at,
            delivered_at,
            opened_at,
            clicked_at,
            created_at,
            error_message,
            campaign:mail_campaigns(id, name, subject_line)
          `)
          .eq('contact_id', contact.id)
          .order('created_at', { ascending: false })
          .limit(25)
        : { data: [], error: null };

      const queueResult = contact.id
        ? await firstSuccessful([
          () => supabase
            .from('mail_sending_queue')
            .select(`
              id,
              status,
              scheduled_for,
              created_at,
              email_address,
              campaign:mail_campaigns(id, name, subject_line),
              automation:mail_automations(id, name, automation_type)
            `)
            .eq('contact_id', contact.id)
            .in('status', ['queued', 'processing', 'retrying'])
            .order('scheduled_for', { ascending: true })
            .limit(25),
          () => supabase
            .from('mail_sending_queue')
            .select('id, status, scheduled_for, created_at, email_address, campaign_id, automation_id')
            .eq('contact_id', contact.id)
            .in('status', ['queued', 'processing', 'retrying'])
            .order('scheduled_for', { ascending: true })
            .limit(25)
        ])
        : { data: [], error: null };

      const automationRunsResult = contact.id
        ? await firstSuccessful([
          () => supabase
            .from('mail_automation_runs')
            .select(`
              id,
              automation_type,
              trigger_date,
              event_date,
              status,
              queued_at,
              sent_at,
              automation:mail_automations(id, name)
            `)
            .eq('contact_id', contact.id)
            .in('status', ['queued', 'retrying'])
            .order('trigger_date', { ascending: true })
            .limit(25),
          () => supabase
            .from('mail_automation_runs')
            .select('id, automation_type, trigger_date, event_date, status, queued_at, sent_at, automation_id')
            .eq('contact_id', contact.id)
            .in('status', ['queued', 'retrying'])
            .order('trigger_date', { ascending: true })
            .limit(25)
        ])
        : { data: [], error: null };

      const automationsResult = contact.subscribed
        ? await supabase
          .from('mail_automations')
          .select('id, name, automation_type, trigger_timing, days_offset, status, is_enabled')
          .eq('business_id', auth.selectedBusinessId)
          .eq('is_enabled', true)
          .eq('status', 'active')
          .order('automation_type', { ascending: true })
          .limit(25)
        : { data: [], error: null };

      setCustomerMarketing({
        contact,
        email: {
          authorized: contact.subscribed === true,
          grantedAt: latestSubscribed?.timestamp || latestSubscribed?.created_at || contact.consent_timestamp || null,
          revokedAt: latestUnsubscribed?.timestamp || latestUnsubscribed?.created_at || contact.unsubscribed_at || null,
          note: contact.consent_method
            ? `${contact.consent_method}${contact.consent_source ? ` via ${contact.consent_source}` : ''}`
            : 'No consent method recorded.'
        },
        sms: {
          authorized: false,
          grantedAt: null,
          revokedAt: null,
          note: 'No SMS marketing authorization record found.'
        },
        received: sendsResult.error ? [] : sendsResult.data || [],
        upcoming: [
          ...((queueResult.data || []).map((item) => ({ ...item, source: 'queue' }))),
          ...((automationRunsResult.data || []).map((item) => ({ ...item, source: 'automation_run' })))
        ],
        automations: automationsResult.error ? [] : automationsResult.data || []
      });
    } catch (error) {
      console.error('[POSCustomersScreen] Failed to load marketing profile:', error);
      setCustomerMarketing(buildEmptyMarketingProfile('Unable to load marketing details right now.'));
    } finally {
      setCustomerMarketingLoading(false);
    }
  }, [auth.selectedBusinessId, canViewCustomers]);

  const mergeById = (rows = [], keyPrefix = '') => {
    const map = new Map();
    rows.forEach((row) => {
      const key = row?.id ? `${keyPrefix}${row.id}` : null;
      if (key && !map.has(key)) {
        map.set(key, row);
      }
    });
    return Array.from(map.values());
  };

  const formatWaiverSource = (waiver) => {
    if (waiver?._dataSource !== 'legacy') return 'Modern Tavari';
    const source = String(waiver.source_system || '').toLowerCase();
    if (source === 'smartwaiver') return 'Smartwaiver legacy';
    if (source === 'wallkids') return 'Off The Wall legacy';
    return `${waiver.source_system || 'Legacy'} legacy`;
  };

  const formatParticipantType = (type) => {
    const normalized = String(type || '').replace(/_/g, ' ');
    if (!normalized) return 'Participant';
    return normalized.charAt(0).toUpperCase() + normalized.slice(1);
  };

  const loadCustomerWaivers = useCallback(async (customer) => {
    if (!customer || !auth.selectedBusinessId || !canViewCustomers) return;

    setCustomerWaiversLoading(true);
    try {
      const email = String(customer.customer_email || '').trim().toLowerCase();
      const phoneDigits = normalizePhoneDigits(customer.customer_phone);
      const modernRows = [];
      const legacyRows = [];

      const modernSelect = `
        *,
        waiver_templates:template_id (
          id,
          template_name,
          waiver_title,
          template_key,
          version,
          expiry_days
        ),
        waiver_participants (
          id,
          waiver_id,
          business_id,
          customer_id,
          participant_type,
          first_name,
          last_name,
          date_of_birth,
          email,
          phone_number,
          is_account_owner,
          notes,
          account_card_style,
          restrict_check_in
        )
      `;

      const addModern = async (query) => {
        const { data, error } = await query;
        if (!error && data) modernRows.push(...data);
      };

      if (customer.id) {
        await addModern(
          supabase
            .from('waiver_signatures')
            .select(modernSelect)
            .eq('business_id', auth.selectedBusinessId)
            .eq('customer_id', customer.id)
            .order('signed_at', { ascending: false })
            .limit(50)
        );
      }

      if (email) {
        await addModern(
          supabase
            .from('waiver_signatures')
            .select(modernSelect)
            .eq('business_id', auth.selectedBusinessId)
            .ilike('email', email)
            .order('signed_at', { ascending: false })
            .limit(50)
        );
      }

      if (phoneDigits) {
        await addModern(
          supabase
            .from('waiver_signatures')
            .select(modernSelect)
            .eq('business_id', auth.selectedBusinessId)
            .ilike('phone_number', `%${phoneDigits.slice(-7)}%`)
            .order('signed_at', { ascending: false })
            .limit(50)
        );
      }

      if (email || phoneDigits) {
        let participantQuery = supabase
          .from('waiver_participants')
          .select('waiver_id, email, phone_number')
          .not('waiver_id', 'is', null)
          .limit(100);
        if (email && phoneDigits) {
          participantQuery = participantQuery.or(`email.ilike.${email},phone_number.ilike.%${phoneDigits.slice(-7)}%`);
        } else if (email) {
          participantQuery = participantQuery.ilike('email', email);
        } else {
          participantQuery = participantQuery.ilike('phone_number', `%${phoneDigits.slice(-7)}%`);
        }
        const { data: participantMatches } = await participantQuery;
        const matchedWaiverIds = [
          ...new Set(
            (participantMatches || [])
              .filter((row) => {
                const emailMatches = email && String(row.email || '').toLowerCase() === email;
                const phoneMatches = phoneDigits && normalizePhoneDigits(row.phone_number) === phoneDigits;
                return emailMatches || phoneMatches;
              })
              .map((row) => row.waiver_id)
              .filter(Boolean)
          )
        ];
        if (matchedWaiverIds.length > 0) {
          const { data } = await supabase
            .from('waiver_signatures')
            .select(modernSelect)
            .eq('business_id', auth.selectedBusinessId)
            .in('id', matchedWaiverIds.slice(0, 100));
          if (data) modernRows.push(...data);
        }
      }

      const { data: templateRows } = await supabase
        .from('legacy_waiver_templates')
        .select('id, legacy_template_id, title, waiver_content')
        .eq('business_id', auth.selectedBusinessId);
      const templateMap = new Map((templateRows || []).map((template) => [Number(template.legacy_template_id), template]));

      const addLegacy = async (query) => {
        const { data, error } = await query;
        if (!error && data) legacyRows.push(...data);
      };

      if (customer.id) {
        await addLegacy(
          supabase
            .from('legacy_waivers')
            .select('*')
            .eq('business_id', auth.selectedBusinessId)
            .eq('customer_id', customer.id)
            .is('deleted_at', null)
            .order('signed_at', { ascending: false })
            .limit(50)
        );
      }

      if (email) {
        await addLegacy(
          supabase
            .from('legacy_waivers')
            .select('*')
            .eq('business_id', auth.selectedBusinessId)
            .ilike('email', email)
            .is('deleted_at', null)
            .order('signed_at', { ascending: false })
            .limit(50)
        );
      }

      if (phoneDigits) {
        await addLegacy(
          supabase
            .from('legacy_waivers')
            .select('*')
            .eq('business_id', auth.selectedBusinessId)
            .ilike('phone', `%${phoneDigits.slice(-7)}%`)
            .is('deleted_at', null)
            .order('signed_at', { ascending: false })
            .limit(50)
        );
      }

      const mappedLegacy = mergeById(legacyRows, 'legacy:')
        .map((row) => mapLegacyWaiverRow(row, templateMap.get(Number(row.legacy_waiver_template_id))))
        .filter(Boolean);
      const mappedModern = mergeById(modernRows, 'modern:').map((row) => ({
        ...row,
        _dataSource: 'modern'
      }));

      const combined = [...mappedModern, ...mappedLegacy].sort((a, b) => {
        const ta = a.signed_at ? new Date(a.signed_at).getTime() : 0;
        const tb = b.signed_at ? new Date(b.signed_at).getTime() : 0;
        return tb - ta;
      });

      setCustomerWaivers(combined);
    } catch (error) {
      console.error('[POSCustomersScreen] Failed to load customer waivers:', error);
      setCustomerWaivers([]);
    } finally {
      setCustomerWaiversLoading(false);
    }
  }, [auth.selectedBusinessId, canViewCustomers]);

  // Handle manual points adjustment
  const handlePointsAdjustment = async (isAddition) => {
    // Permission check
    if (!canAdjustPoints) {
      toast.error('You do not have permission to adjust loyalty points');
      return;
    }

    if (!selectedCustomer || !adjustmentAmount || !adjustmentReason.trim() || !managerPin) {
      setAdjustmentError('Please fill in all fields');
      return;
    }

    const points = parseInt(adjustmentAmount);
    if (isNaN(points) || points <= 0) {
      setAdjustmentError('Please enter a valid positive number');
      return;
    }

    setAdjustmentLoading(true);
    setAdjustmentError(null);

    try {
      // Validate manager PIN
      const pinValid = await auth.validateManagerPin(managerPin);
      if (!pinValid) {
        setAdjustmentError('Invalid manager PIN');
        setAdjustmentLoading(false);
        return;
      }

      const currentBalance = selectedCustomer.balance || 0;
      const currentStore = Number(selectedCustomer.store_credit) || 0;
      const currentPoints = Math.max(0, Math.round(Number(selectedCustomer.points) || 0));
      const rate = Number(loyaltySettings?.redemption_rate) || 10000;

      let newBalance;
      let newPoints = currentPoints;
      let transactionType;
      let transactionPoints;
      let transactionAmount;

      if (loyaltySettings?.loyalty_mode === 'points') {
        newPoints = isAddition ? currentPoints + points : Math.max(0, currentPoints - points);
        newBalance = currentBalance;
        const dollarValue = (Math.abs(newPoints - currentPoints) * 10) / rate;
        transactionType = 'adjust';
        transactionPoints = isAddition ? points : -points;
        transactionAmount = isAddition ? dollarValue : -dollarValue;
      } else {
        newBalance = isAddition ? currentBalance + points : Math.max(0, currentBalance - points);
        newPoints = currentPoints;
        transactionType = isAddition ? 'manual_add' : 'manual_subtract';
        transactionPoints = null;
        transactionAmount = isAddition ? points : -points;
      }

      const { error: updateError } = await supabase
        .from('pos_loyalty_accounts')
        .update({
          balance: newBalance,
          points: newPoints,
          last_activity: new Date().toISOString()
        })
        .eq('id', selectedCustomer.id);

      if (updateError) throw updateError;

      const { error: logError } = await supabase
        .from('pos_loyalty_transactions')
        .insert(
          loyaltySettings?.loyalty_mode === 'points'
            ? {
                business_id: auth.selectedBusinessId,
                loyalty_account_id: selectedCustomer.id,
                transaction_type: transactionType,
                amount: transactionAmount,
                points: transactionPoints,
                balance_before: currentStore,
                balance_after: currentStore,
                points_before: currentPoints,
                points_after: newPoints,
                description: `Manual ${isAddition ? 'addition' : 'subtraction'}: ${adjustmentReason}`,
                processed_by: auth.authUser.id,
                processed_at: new Date().toISOString()
              }
            : {
                business_id: auth.selectedBusinessId,
                loyalty_account_id: selectedCustomer.id,
                transaction_type: transactionType,
                amount: transactionAmount,
                points: transactionPoints,
                balance_before: currentBalance,
                balance_after: newBalance,
                points_before: 0,
                points_after: 0,
                description: `Manual ${isAddition ? 'addition' : 'subtraction'}: ${adjustmentReason}`,
                processed_by: auth.authUser.id,
                processed_at: new Date().toISOString()
              }
        );

      if (logError) throw logError;

      setSelectedCustomer({
        ...selectedCustomer,
        balance: newBalance,
        points: newPoints,
        store_credit: currentStore
      });
      
      await refreshListAndStats();
      await loadLoyaltyHistory({ ...selectedCustomer, balance: newBalance, points: newPoints });

      // Reset form
      setAdjustmentAmount('');
      setAdjustmentReason('');
      setManagerPin('');
      setShowAddPoints(false);
      setShowRemovePoints(false);

      toast.success(`Successfully ${isAddition ? 'added' : 'removed'} ${points} ${loyaltySettings?.loyalty_mode === 'points' ? 'points' : 'dollars'}`);

    } catch (err) {
      setAdjustmentError('Failed to adjust points: ' + err.message);
      toast.error('Failed to adjust points');
    } finally {
      setAdjustmentLoading(false);
    }
  };

  // Reset adjustment form when closing
  const resetAdjustmentForm = () => {
    setAdjustmentAmount('');
    setAdjustmentReason('');
    setManagerPin('');
    setAdjustmentError(null);
    setShowAddPoints(false);
    setShowRemovePoints(false);
  };

  // Handle add points button click
  const handleAddPointsClick = () => {
    if (!canAdjustPoints) {
      toast.error('You do not have permission to adjust loyalty points');
      return;
    }

    setShowAddPoints(!showAddPoints);
    setShowRemovePoints(false);
    if (!showAddPoints) {
      setAdjustmentAmount('');
      setAdjustmentReason('');
      setManagerPin('');
      setAdjustmentError(null);
    }
  };

  // Handle remove points button click
  const handleRemovePointsClick = () => {
    if (!canAdjustPoints) {
      toast.error('You do not have permission to adjust loyalty points');
      return;
    }

    setShowRemovePoints(!showRemovePoints);
    setShowAddPoints(false);
    if (!showRemovePoints) {
      setAdjustmentAmount('');
      setAdjustmentReason('');
      setManagerPin('');
      setAdjustmentError(null);
    }
  };

  useEffect(() => {
    if (!auth.selectedBusinessId || permissionsLoading) return;
    if (!canViewCustomers) return;
    void loadCustomerList();
  }, [auth.selectedBusinessId, permissionsLoading, canViewCustomers, loadCustomerList]);

  useEffect(() => {
    if (!auth.selectedBusinessId || !canViewCustomers || permissionsLoading) return;
    void loadDashboardStats();
  }, [auth.selectedBusinessId, canViewCustomers, permissionsLoading, loadDashboardStats]);

  // Handle form submission
  const handleSubmit = async (e) => {
    e.preventDefault();
    
    // Permission check
    if (!canManageCustomers) {
      toast.error('You do not have permission to manage customers');
      return;
    }

    if (!auth.selectedBusinessId) return;

    try {
      const customerData = {
        customer_name: formData.customer_name,
        customer_email: formData.customer_email || null,
        customer_phone: formData.customer_phone || null,
        balance: Number(formData.balance) || 0,
        points: Number(formData.points) || 0,
        business_id: auth.selectedBusinessId,
        notes: formData.notes && String(formData.notes).trim() ? String(formData.notes).trim() : null,
        account_card_style: formData.account_card_style || 'default',
        restrict_check_in: !!formData.restrict_check_in
      };

      let result;
      if (selectedCustomer) {
        // Update existing customer
        result = await supabase
          .from('pos_loyalty_accounts')
          .update(customerData)
          .eq('id', selectedCustomer.id)
          .eq('business_id', auth.selectedBusinessId);
      } else {
        // Create new customer
        result = await supabase
          .from('pos_loyalty_accounts')
          .insert([customerData]);
      }

      if (result.error) throw result.error;

      toast.success(`Customer ${selectedCustomer ? 'updated' : 'created'} successfully`);
      await refreshListAndStats();
      handleCloseModal();
    } catch (err) {
      setError('Failed to save customer: ' + err.message);
      toast.error('Failed to save customer');
    }
  };

  // Handle delete customer
  const handleDeleteCustomer = async (customerId) => {
    // Permission check
    if (!canDeleteCustomers) {
      toast.error('You do not have permission to delete customers');
      return;
    }

    if (!window.confirm('Are you sure you want to delete this customer? This action cannot be undone.')) {
      return;
    }

    try {
      const { error: deleteError } = await supabase
        .from('pos_loyalty_accounts')
        .delete()
        .eq('id', customerId)
        .eq('business_id', auth.selectedBusinessId);

      if (deleteError) throw deleteError;

      setShowCustomerProfileModal(false);
      setSelectedCustomer(null);
      toast.success('Customer deleted successfully');
      await refreshListAndStats();
    } catch (err) {
      setError('Failed to delete customer: ' + err.message);
      toast.error('Failed to delete customer');
    }
  };

  // Handle modal open/close
  const handleCreateCustomer = () => {
    if (!canManageCustomers) {
      toast.error('You do not have permission to create customers');
      return;
    }

    setFormData({
      customer_name: '',
      customer_email: '',
      customer_phone: '',
      balance: 0,
      points: 0,
      notes: '',
      account_card_style: 'default',
      restrict_check_in: false
    });
    setSelectedCustomer(null);
    setShowCreateModal(true);
  };

  const handleEditCustomer = (customer) => {
    if (!canManageCustomers) {
      toast.error('You do not have permission to edit customers');
      return;
    }

    setShowCustomerProfileModal(false);

    setFormData({
      customer_name: customer.customer_name || '',
      customer_email: customer.customer_email || '',
      customer_phone: customer.customer_phone || '',
      balance: customer.balance || 0,
      points: customer.points || 0,
      notes: customer.notes || '',
      account_card_style: customer.account_card_style || 'default',
      restrict_check_in: !!customer.restrict_check_in
    });
    setSelectedCustomer(customer);
    setShowEditModal(true);
  };

  const handleSendRegistrationLink = async (customer, event) => {
    event?.stopPropagation?.();
    event?.preventDefault?.();

    if (!showRegistrationActions) {
      toast.error('You do not have permission to send registration links');
      return;
    }

    const recipientEmail = String(customer?.customer_email || '').trim();
    if (!recipientEmail) {
      toast.error('This customer has no email on file');
      return;
    }

    if (!auth.selectedBusinessId) return;

    setSendingRegistrationEmailTo(customer.id);
    try {
      camperRegistrationService.setBusinessId(auth.selectedBusinessId);
      await camperRegistrationService.sendPortalLinkEmail({
        recipientEmail,
        recipientName: customer.customer_name || null,
      });
      toast.success(`Registration link sent to ${recipientEmail}`);
    } catch (err) {
      console.error('Failed to send registration link:', err);
      toast.error(err.message || 'Could not send registration link');
    } finally {
      setSendingRegistrationEmailTo(null);
    }
  };

  const handleCloseModal = () => {
    setShowCreateModal(false);
    setShowEditModal(false);
    setSelectedCustomer(null);
    setError(null);
  };

  const openCustomerProfileModal = (customer, initialTab = 'info') => {
    setSelectedCustomer(customer);
    setCustomerProfileTab(initialTab);
    setCustomerMarketing(null);
    setCustomerWaivers([]);
    setShowCustomerProfileModal(true);
    if (customer?.id && auth.selectedBusinessId) {
      void supabase
        .from('pos_loyalty_accounts')
        .select('*')
        .eq('id', customer.id)
        .eq('business_id', auth.selectedBusinessId)
        .single()
        .then(({ data, error }) => {
          if (!error && data) setSelectedCustomer(data);
        });
    }
  };

  useEffect(() => {
    if (!auth.selectedBusinessId || !canViewCustomers) return;
    const customerId = initialCustomerId || searchParams.get('customerId');
    const customerSearch = initialCustomerSearch || searchParams.get('customerSearch');
    const requestedTab = initialTab || searchParams.get('tab') || 'info';
    const resolvedInitialTab = PROFILE_TABS.some((tab) => tab.id === requestedTab) ? requestedTab : 'info';
    const key = `${embeddedProfile ? 'embedded' : 'route'}:${auth.selectedBusinessId}:${customerId || ''}:${customerSearch || ''}:${resolvedInitialTab}:${initialBookingId || ''}`;
    if (handledProfileLinkRef.current === key) return;
    handledProfileLinkRef.current = key;

    if (customerSearch) {
      setSearchTerm(customerSearch);
      setSearchDebounced(customerSearch);
      setListPage(0);
    }

    let cancelled = false;
    (async () => {
      try {
        let resolvedCustomerId = customerId;
        if (!resolvedCustomerId && initialBookingId) {
          bookingService.setBusinessId(auth.selectedBusinessId);
          const b = await bookingService.getBookingById(initialBookingId);
          if (cancelled) return;
          resolvedCustomerId = b?.customer_id || null;
          if (!resolvedCustomerId) {
            toast.error('This booking is not linked to a customer account.');
            return;
          }
        }
        if (!resolvedCustomerId) return;

        const { data, error } = await supabase
          .from('pos_loyalty_accounts')
          .select('*')
          .eq('id', resolvedCustomerId)
          .eq('business_id', auth.selectedBusinessId)
          .maybeSingle();
        if (cancelled) return;
        if (error) throw error;
        if (data) {
          openCustomerProfileModal(data, resolvedInitialTab);
        } else {
          toast.error(
            initialBookingId ? 'Customer profile was not found' : 'Customer profile was not found for this waiver'
          );
        }
      } catch (err) {
        if (!cancelled) {
          console.error('POSCustomersScreen: open customer profile link', err);
          toast.error(err?.message || 'Failed to open customer profile');
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    auth.selectedBusinessId,
    canViewCustomers,
    searchParams,
    embeddedProfile,
    initialCustomerId,
    initialCustomerSearch,
    initialTab,
    initialBookingId
  ]);

  const closeCustomerProfileModal = () => {
    setShowCustomerProfileModal(false);
    setCustomerMarketing(null);
    setCustomerWaivers([]);
    setLoyaltyTransactions([]);
    resetAdjustmentForm();
    if (embeddedProfile && typeof onEmbeddedClose === 'function') {
      onEmbeddedClose();
    }
  };

  useEffect(() => {
    if (!showCustomerProfileModal || !selectedCustomer || customerProfileTab !== 'notes') return;
    setProfileNotesState({
      notes: selectedCustomer.notes || '',
      account_card_style: selectedCustomer.account_card_style || 'default',
      restrict_check_in: !!selectedCustomer.restrict_check_in
    });
  }, [
    showCustomerProfileModal,
    customerProfileTab,
    selectedCustomer?.id,
    selectedCustomer?.notes,
    selectedCustomer?.account_card_style,
    selectedCustomer?.restrict_check_in
  ]);

  const loadParticipantNotesRows = useCallback(async () => {
    if (!auth.selectedBusinessId || !selectedCustomer?.id) {
      setParticipantNotesRows([]);
      return;
    }

    setParticipantNotesLoading(true);
    try {
      const email = String(selectedCustomer.customer_email || '').trim().toLowerCase();
      const phoneDigits = normalizePhoneDigits(selectedCustomer.customer_phone);
      const participantSelect =
        'id, waiver_id, business_id, customer_id, participant_type, first_name, last_name, date_of_birth, email, phone_number, is_account_owner, is_active, notes, account_card_style, restrict_check_in, updated_at, created_at';
      const rows = [];

      const addParticipants = (data = []) => {
        data.forEach((row) => {
          if (row?.is_active === false) return;
          rows.push(row);
        });
      };

      // Household only: people linked to this loyalty account — do NOT pull every
      // co-signer from every historical waiver that used this phone/email (that
      // inflated one customer to 100+ unrelated participants).
      const directResult = await supabase
        .from('waiver_participants')
        .select(participantSelect)
        .eq('business_id', auth.selectedBusinessId)
        .eq('customer_id', selectedCustomer.id)
        .order('is_account_owner', { ascending: false })
        .order('created_at', { ascending: true });
      if (directResult.error) throw directResult.error;
      addParticipants(directResult.data || []);

      const { data: bookingPeople, error: bookingPeopleError } = await supabase
        .from('booking_customer_participants')
        .select(
          'id, business_id, customer_id, first_name, last_name, date_of_birth, email, phone_number, is_account_owner, is_active, notes, created_at, updated_at'
        )
        .eq('business_id', auth.selectedBusinessId)
        .eq('customer_id', selectedCustomer.id)
        .order('is_account_owner', { ascending: false })
        .order('created_at', { ascending: true });
      if (bookingPeopleError) throw bookingPeopleError;
      addParticipants(
        (bookingPeople || []).map((row) => ({
          ...row,
          participant_type: row.is_account_owner ? 'primary' : 'additional_adult',
          waiver_id: null,
          account_card_style: null,
          restrict_check_in: false,
        }))
      );

      // Also include participants who themselves use this account's email/phone
      // (exact match), without importing unrelated people from the same waiver.
      if (email || phoneDigits) {
        let contactQuery = supabase
          .from('waiver_participants')
          .select(participantSelect)
          .eq('business_id', auth.selectedBusinessId)
          .limit(100);
        if (email && phoneDigits) {
          contactQuery = contactQuery.or(
            `email.ilike.${email},phone_number.ilike.%${phoneDigits.slice(-10)}%`
          );
        } else if (email) {
          contactQuery = contactQuery.ilike('email', email);
        } else {
          contactQuery = contactQuery.ilike('phone_number', `%${phoneDigits.slice(-10)}%`);
        }
        const { data: contactMatches, error: contactError } = await contactQuery;
        if (contactError) throw contactError;
        addParticipants(
          (contactMatches || []).filter((row) => {
            const emailMatches = email && String(row.email || '').toLowerCase() === email;
            const rowPhone = normalizePhoneDigits(row.phone_number);
            const phoneMatches =
              phoneDigits &&
              rowPhone &&
              (rowPhone === phoneDigits || rowPhone.slice(-10) === phoneDigits.slice(-10));
            return emailMatches || phoneMatches;
          })
        );
      }

      setParticipantNotesRows(mergeById(rows));
    } catch (err) {
      console.error('POSCustomersScreen: load participant notes', err);
      setParticipantNotesRows([]);
      toast.error(err?.message || 'Failed to load participant notes');
    } finally {
      setParticipantNotesLoading(false);
    }
  }, [
    auth.selectedBusinessId,
    selectedCustomer?.id,
    selectedCustomer?.customer_email,
    selectedCustomer?.customer_phone
  ]);

  useEffect(() => {
    if (!showCustomerProfileModal || !selectedCustomer?.id || customerProfileTab !== 'notes') return;
    loadParticipantNotesRows();
  }, [showCustomerProfileModal, selectedCustomer?.id, customerProfileTab, loadParticipantNotesRows]);

  const updateParticipantNotesRow = (participantId, updates) => {
    setParticipantNotesRows((prev) =>
      prev.map((row) => (row.id === participantId ? { ...row, ...updates } : row))
    );
  };

  const updateParticipantNotesGroup = (personKey, updates) => {
    setParticipantNotesRows((prev) =>
      prev.map((row) => (getParticipantPersonKey(row) === personKey ? { ...row, ...updates } : row))
    );
  };

  const saveProfileNotesAndStyle = useCallback(async () => {
    if (!canManageCustomers) {
      toast.error('You do not have permission to update this account');
      return;
    }
    if (!auth.selectedBusinessId || !selectedCustomer?.id) return;
    setNotesTabSaving(true);
    try {
      const payload = {
        notes: profileNotesState.notes && String(profileNotesState.notes).trim()
          ? String(profileNotesState.notes).trim()
          : null,
        account_card_style: profileNotesState.account_card_style || 'default',
        restrict_check_in: !!profileNotesState.restrict_check_in
      };
      const { error } = await supabase
        .from('pos_loyalty_accounts')
        .update(payload)
        .eq('id', selectedCustomer.id)
        .eq('business_id', auth.selectedBusinessId);
      if (error) throw error;

      if (participantNotesRows.length > 0) {
        for (const participant of participantNotesRows) {
          const participantPayload = {
            notes: participant.notes && String(participant.notes).trim()
              ? String(participant.notes).trim()
              : null,
            account_card_style: participant.account_card_style || 'default',
            restrict_check_in: !!participant.restrict_check_in
          };
          const { error: participantError } = await supabase
            .from('waiver_participants')
            .update(participantPayload)
            .eq('id', participant.id)
            .eq('business_id', auth.selectedBusinessId);
          if (participantError) throw participantError;
        }
      }

      setSelectedCustomer((prev) => (prev ? { ...prev, ...payload } : prev));
      setCustomers((prev) =>
        prev.map((row) => (row.id === selectedCustomer.id ? { ...row, ...payload } : row))
      );
      await loadParticipantNotesRows();
      toast.success('Account saved');
    } catch (err) {
      console.error('POSCustomersScreen: save profile notes', err);
      toast.error(err?.message || 'Failed to save');
    } finally {
      setNotesTabSaving(false);
    }
  }, [
    canManageCustomers,
    auth.selectedBusinessId,
    selectedCustomer?.id,
    profileNotesState,
    participantNotesRows,
    loadParticipantNotesRows
  ]);

  const handleStoreCreditSubmit = useCallback(async () => {
    if (!canManageCustomers) {
      toast.error('You do not have permission to change store credit');
      return;
    }
    if (!auth.selectedBusinessId || !selectedCustomer?.id) return;
    setCreditError(null);
    if (!String(creditPin).trim()) {
      setCreditError('Enter your PIN to confirm');
      return;
    }
    const ok = await auth.validateManagerPin(creditPin);
    if (!ok) {
      setCreditError('Invalid PIN');
      return;
    }
    const amt = parseFloat(String(creditAmount).replace(/,/g, ''));
    if (!Number.isFinite(amt) || amt <= 0) {
      setCreditError('Enter a valid dollar amount');
      return;
    }
    const wasReversal = creditIsReversal;
    setCreditSubmitting(true);
    try {
      const { newStoreCredit } = await applyStoreCreditLine({
        businessId: auth.selectedBusinessId,
        accountId: selectedCustomer.id,
        amountDollars: amt,
        category: creditCategory,
        note: creditNote,
        isReversal: wasReversal,
        processedByUserId: auth.authUser?.id ?? null
      });
      setSelectedCustomer((prev) =>
        prev ? { ...prev, store_credit: newStoreCredit } : null
      );
      setCustomers((prev) =>
        prev.map((row) =>
          row.id === selectedCustomer.id ? { ...row, store_credit: newStoreCredit } : row
        )
      );
      setCreditAmount('');
      setCreditNote('');
      setCreditPin('');
      setCreditIsReversal(false);
      await refreshListAndStats();
      await loadStoreCreditHistoryForCustomer(selectedCustomer.id);
      toast.success(wasReversal ? 'Store credit removed from account' : 'Store credit added to account');
    } catch (err) {
      const msg = err?.message || 'Failed to update store credit';
      setCreditError(msg);
      toast.error(msg);
    } finally {
      setCreditSubmitting(false);
    }
  }, [
    canManageCustomers,
    auth.selectedBusinessId,
    auth.authUser?.id,
    auth.validateManagerPin,
    selectedCustomer,
    creditAmount,
    creditCategory,
    creditNote,
    creditPin,
    creditIsReversal,
    refreshListAndStats,
    loadStoreCreditHistoryForCustomer
  ]);

  // Load POS sales when Bookings tab is active in profile modal (not module bookings view)
  useEffect(() => {
    if (embeddedInBookings) {
      return;
    }
    if (
      !showCustomerProfileModal ||
      customerProfileTab !== 'bookings' ||
      !selectedCustomer?.id ||
      !canViewCustomers
    ) {
      return;
    }
    loadCustomerTransactions(selectedCustomer.id);
  }, [
    embeddedInBookings,
    showCustomerProfileModal,
    customerProfileTab,
    selectedCustomer?.id,
    canViewCustomers,
    loadCustomerTransactions
  ]);

  // Load loyalty transactions when Loyalty tab is active in profile modal
  useEffect(() => {
    if (
      !showCustomerProfileModal ||
      customerProfileTab !== 'loyalty' ||
      !selectedCustomer?.id ||
      !canViewLoyalty
    ) {
      return;
    }
    loadLoyaltyHistory(selectedCustomer);
  }, [
    showCustomerProfileModal,
    customerProfileTab,
    selectedCustomer?.id,
    canViewLoyalty,
    loadLoyaltyHistory
  ]);

  // Load marketing status when Marketing tab is active in profile modal
  useEffect(() => {
    if (
      !showCustomerProfileModal ||
      customerProfileTab !== 'marketing' ||
      !selectedCustomer?.id ||
      !canViewCustomers
    ) {
      return;
    }
    const c = selectedCustomerRef.current;
    if (c?.id) loadCustomerMarketing(c);
  }, [showCustomerProfileModal, customerProfileTab, selectedCustomer?.id, canViewCustomers, loadCustomerMarketing]);

  // Load waivers when Waivers tab is active in profile modal
  useEffect(() => {
    if (
      !showCustomerProfileModal ||
      customerProfileTab !== 'waivers' ||
      !selectedCustomer?.id ||
      !canViewCustomers
    ) {
      return;
    }
    const c = selectedCustomerRef.current;
    if (c?.id) loadCustomerWaivers(c);
  }, [showCustomerProfileModal, customerProfileTab, selectedCustomer?.id, canViewCustomers, loadCustomerWaivers]);

  useEffect(() => {
    if (
      !showCustomerProfileModal ||
      customerProfileTab !== 'credits' ||
      !selectedCustomer?.id ||
      !canViewCustomers
    ) {
      return;
    }
    void loadStoreCreditHistoryForCustomer(selectedCustomer.id);
  }, [
    showCustomerProfileModal,
    customerProfileTab,
    selectedCustomer?.id,
    canViewCustomers,
    loadStoreCreditHistoryForCustomer
  ]);

  const getLoyaltyPointsInPointsMode = (customer) => {
    if (!customer) return 0;
    const raw = customer.points;
    if (raw != null && raw !== '' && !Number.isNaN(Number(raw))) {
      return Math.max(0, Math.round(Number(raw)));
    }
    return 0;
  };

  // Loyalty / pool display — not store credit (use `store_credit` column elsewhere).
  const getBalanceDisplay = (customer) => {
    if (!customer) return '—';

    if (isPointsLoyaltyMode(loyaltySettings)) {
      const n = getLoyaltyPointsInPointsMode(customer);
      return n > 0 ? `${n.toLocaleString()} pts` : '0 pts';
    }

    const use = getSpendableDollarsInDollarsMode({
      store_credit: Number(customer.store_credit) || 0,
      balance: Number(customer.balance) || 0
    });
    const pts = Number(customer.points) || 0;
    if (pts > 0) {
      return `$${use.toFixed(2)} pool · ${pts.toLocaleString()} pts`;
    }
    return `$${use.toFixed(2)} pool`;
  };

  // Helper function to format transaction type for display
  const formatTransactionType = (type) => {
    const typeMap = {
      earn: 'Earned',
      redeem: 'Redeemed',
      manual_add: 'Manual Add',
      manual_subtract: 'Manual Subtract',
      initial_balance: 'Initial Setup',
      adjustment: 'Adjustment',
      store_credit: 'Store credit',
      store_credit_reversal: 'Store credit removed',
      adjust: 'Adjustment'
    };
    return typeMap[type] || (type ? type.charAt(0).toUpperCase() + type.slice(1) : '');
  };

  // Helper function to get transaction amount display
  const getTransactionAmountDisplay = (transaction) => {
    let isEarn = ['earn', 'manual_add', 'initial_balance', 'store_credit'].includes(
      transaction.transaction_type
    );
    let isRedeem = ['redeem', 'manual_subtract', 'store_credit_reversal'].includes(
      transaction.transaction_type
    );
    if (transaction.transaction_type === 'adjust') {
      const pt = Number(transaction.points) || 0;
      isEarn = pt > 0;
      isRedeem = pt < 0;
    }
    
    if (loyaltySettings?.loyalty_mode === 'points' && transaction.points !== null) {
      const points = Math.abs(transaction.points || 0);
      return `${isEarn ? '+' : isRedeem ? '-' : ''}${points.toLocaleString()} pts`;
    } else {
      const amount = Math.abs(transaction.amount || 0);
      return `${isEarn ? '+' : isRedeem ? '-' : ''}$${amount.toFixed(2)}`;
    }
  };

  // Create styles using TavariStyles (memoized: large object was recreated every render and tanked performance)
  const styles = useMemo(() => ({
    container: {
      ...TavariStyles.layout.container,
      ...(embeddedInBookings
        ? {
            padding: 0,
            paddingTop: 0,
            maxWidth: '100%',
            width: '100%',
            boxSizing: 'border-box'
          }
        : {
            padding: TavariStyles.spacing.xl,
            paddingTop: '80px'
          })
    },

    embeddedBookingsToolbar: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      flexWrap: 'wrap',
      gap: TavariStyles.spacing.md,
      marginBottom: TavariStyles.spacing.lg
    },
    embeddedBookingsHeading: {
      minWidth: 0,
      flex: '1 1 200px'
    },
    embeddedBookingsTitle: {
      margin: 0,
      fontSize: TavariStyles.typography.fontSize['2xl'],
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      color: TavariStyles.colors.gray900
    },
    embeddedBookingsSubtitle: {
      margin: `${TavariStyles.spacing.xs} 0 0`,
      fontSize: TavariStyles.typography.fontSize.sm,
      color: TavariStyles.colors.gray600,
      maxWidth: '36rem',
      lineHeight: TavariStyles.typography.lineHeight.normal
    },
    embeddedBookingsActions: {
      display: 'flex',
      alignItems: 'center',
      gap: TavariStyles.spacing.sm,
      flexShrink: 0
    },

    header: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: TavariStyles.spacing.xl,
      paddingBottom: TavariStyles.spacing.lg,
      borderBottom: `2px solid ${TavariStyles.colors.primary}`
    },
    
    title: {
      fontSize: TavariStyles.typography.fontSize['3xl'],
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.gray800,
      margin: 0
    },

    readOnlyBadge: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: TavariStyles.spacing.sm,
      padding: `${TavariStyles.spacing.sm} ${TavariStyles.spacing.md}`,
      backgroundColor: TavariStyles.colors.warningBg,
      border: `2px solid ${TavariStyles.colors.warning}`,
      borderRadius: TavariStyles.borderRadius.md,
      color: TavariStyles.colors.warningText,
      fontSize: TavariStyles.typography.fontSize.sm,
      fontWeight: TavariStyles.typography.fontWeight.medium,
      marginBottom: TavariStyles.spacing.md
    },

    accessDenied: {
      ...TavariStyles.layout.card,
      padding: TavariStyles.spacing['4xl'],
      textAlign: 'center',
      marginTop: TavariStyles.spacing['4xl']
    },

    accessDeniedIcon: {
      color: TavariStyles.colors.danger,
      marginBottom: TavariStyles.spacing.lg
    },

    accessDeniedTitle: {
      fontSize: TavariStyles.typography.fontSize['2xl'],
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.gray800,
      marginBottom: TavariStyles.spacing.md
    },

    accessDeniedText: {
      fontSize: TavariStyles.typography.fontSize.md,
      color: TavariStyles.colors.gray600,
      marginBottom: TavariStyles.spacing.xl
    },
    
    searchSection: {
      display: 'flex',
      gap: TavariStyles.spacing.lg,
      marginBottom: TavariStyles.spacing.xl,
      alignItems: 'center'
    },
    
    searchInput: {
      ...TavariStyles.components.form.input,
      flex: '1 1 0',
      minWidth: 0,
      width: '100%',
      maxWidth: 'none'
    },
    
    sortSelect: {
      ...TavariStyles.components.form.select,
      width: '132px',
      minWidth: '132px',
      maxWidth: '132px',
      flex: '0 0 132px'
    },
    
    createButton: {
      ...TavariStyles.components.button.base,
      ...TavariStyles.components.button.variants.primary,
      ...TavariStyles.components.button.sizes.lg
    },

    disabledButton: {
      ...TavariStyles.components.button.base,
      ...TavariStyles.components.button.sizes.lg,
      backgroundColor: TavariStyles.colors.gray300,
      color: TavariStyles.colors.gray600,
      cursor: 'not-allowed',
      opacity: 0.6
    },
    
    tableContainer: {
      ...TavariStyles.components.table.container
    },
    
    table: {
      ...TavariStyles.components.table.table
    },
    
    headerRow: {
      ...TavariStyles.components.table.headerRow
    },
    
    th: {
      ...TavariStyles.components.table.th
    },
    
    row: {
      ...TavariStyles.components.table.row
    },
    
    td: {
      ...TavariStyles.components.table.td
    },
    
    actionButton: {
      ...TavariStyles.components.button.base,
      ...TavariStyles.components.button.sizes.sm,
      marginRight: TavariStyles.spacing.xs
    },
    
    editButton: {
      ...TavariStyles.components.button.variants.secondary
    },
    
    deleteButton: {
      ...TavariStyles.components.button.variants.danger
    },
    
    viewButton: {
      backgroundColor: TavariStyles.colors.info,
      color: TavariStyles.colors.white
    },
    
    loyaltyButton: {
      ...TavariStyles.components.button.base,
      backgroundColor: TavariStyles.colors.success,
      color: TavariStyles.colors.white,
      padding: `${TavariStyles.spacing.sm} ${TavariStyles.spacing.md}`,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      minWidth: '80px',
      height: '50px',
      fontSize: TavariStyles.typography.fontSize.xs,
      lineHeight: '1.2',
      border: `2px solid ${TavariStyles.colors.success}`,
      borderRadius: TavariStyles.borderRadius.md
    },
    
    loyaltyButtonBalance: {
      fontSize: TavariStyles.typography.fontSize.sm,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      marginBottom: '2px'
    },
    
    loyaltyButtonSubtext: {
      fontSize: '10px',
      opacity: 0.9,
      fontWeight: TavariStyles.typography.fontWeight.normal
    },
    
    modal: {
      ...TavariStyles.components.modal.overlay
    },
    
    modalContent: {
      ...TavariStyles.components.modal.content,
      maxWidth: '600px'
    },
    
    modalHeader: {
      ...TavariStyles.components.modal.header
    },
    
    modalBody: {
      ...TavariStyles.components.modal.body
    },
    
    modalFooter: {
      ...TavariStyles.components.modal.footer
    },
    
    loyaltyModal: {
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0,0,0,0.5)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 99999
    },
    
    loyaltyModalContent: {
      backgroundColor: TavariStyles.colors.white,
      borderRadius: TavariStyles.borderRadius.lg,
      maxWidth: '700px',
      width: '90%',
      maxHeight: '80vh',
      display: 'flex',
      flexDirection: 'column',
      boxShadow: TavariStyles.shadows.xl
    },
    
    loyaltyModalHeader: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: TavariStyles.spacing.lg,
      borderBottom: `1px solid ${TavariStyles.colors.gray200}`,
      backgroundColor: TavariStyles.colors.primary,
      color: TavariStyles.colors.white,
      borderTopLeftRadius: TavariStyles.borderRadius.lg,
      borderTopRightRadius: TavariStyles.borderRadius.lg
    },
    
    loyaltyModalTitle: {
      fontSize: TavariStyles.typography.fontSize.xl,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      margin: 0
    },
    
    loyaltyModalBody: {
      flex: 1,
      padding: TavariStyles.spacing.lg,
      overflowY: 'auto'
    },
    
    adjustmentButtonRow: {
      display: 'flex',
      gap: TavariStyles.spacing.sm,
      marginBottom: TavariStyles.spacing.lg,
      justifyContent: 'center'
    },
    
    addPointsButton: {
      ...TavariStyles.components.button.base,
      ...TavariStyles.components.button.variants.primary,
      display: 'flex',
      alignItems: 'center',
      gap: TavariStyles.spacing.xs,
      flex: 1,
      cursor: 'pointer'
    },
    
    removePointsButton: {
      ...TavariStyles.components.button.base,
      ...TavariStyles.components.button.variants.danger,
      display: 'flex',
      alignItems: 'center',
      gap: TavariStyles.spacing.xs,
      flex: 1,
      cursor: 'pointer'
    },
    
    adjustmentSection: {
      marginBottom: TavariStyles.spacing.lg,
      padding: TavariStyles.spacing.lg,
      backgroundColor: TavariStyles.colors.gray50,
      borderRadius: TavariStyles.borderRadius.md,
      border: `1px solid ${TavariStyles.colors.gray200}`,
      transition: 'all 0.3s ease',
      maxHeight: showAddPoints || showRemovePoints ? '400px' : '0px',
      overflow: 'hidden',
      opacity: showAddPoints || showRemovePoints ? 1 : 0
    },
    
    adjustmentTitle: {
      fontSize: TavariStyles.typography.fontSize.lg,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.gray800,
      marginBottom: TavariStyles.spacing.md
    },
    
    adjustmentForm: {
      display: 'flex',
      flexDirection: 'column',
      gap: TavariStyles.spacing.md
    },
    
    adjustmentFormGroup: {
      display: 'flex',
      flexDirection: 'column'
    },
    
    adjustmentLabel: {
      ...TavariStyles.components.form.label,
      marginBottom: TavariStyles.spacing.xs
    },
    
    adjustmentInput: {
      ...TavariStyles.components.form.input
    },
    
    adjustmentActions: {
      display: 'flex',
      gap: TavariStyles.spacing.sm,
      justifyContent: 'flex-end',
      marginTop: TavariStyles.spacing.md
    },
    
    adjustmentSubmit: {
      ...TavariStyles.components.button.base,
      ...TavariStyles.components.button.variants.primary
    },
    
    adjustmentCancel: {
      ...TavariStyles.components.button.base,
      ...TavariStyles.components.button.variants.secondary
    },
    
    adjustmentError: {
      ...TavariStyles.components.banner.base,
      ...TavariStyles.components.banner.variants.error,
      marginBottom: TavariStyles.spacing.md
    },
    
    customerSummary: {
      marginBottom: TavariStyles.spacing.lg,
      padding: TavariStyles.spacing.md,
      backgroundColor: TavariStyles.colors.successBg,
      borderRadius: TavariStyles.borderRadius.sm,
      border: `1px solid ${TavariStyles.colors.success}30`
    },
    
    customerSummaryName: {
      fontSize: TavariStyles.typography.fontSize.lg,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.gray800,
      marginBottom: TavariStyles.spacing.xs
    },
    
    customerSummaryBalance: {
      fontSize: TavariStyles.typography.fontSize.sm,
      color: TavariStyles.colors.success,
      fontWeight: TavariStyles.typography.fontWeight.semibold
    },
    
    transactionsList: {
      display: 'flex',
      flexDirection: 'column',
      gap: TavariStyles.spacing.sm
    },
    
    transactionItem: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: TavariStyles.spacing.md,
      backgroundColor: TavariStyles.colors.gray50,
      borderRadius: TavariStyles.borderRadius.sm,
      border: `1px solid ${TavariStyles.colors.gray200}`
    },
    
    transactionLeft: {
      flex: 1
    },
    
    transactionType: {
      fontSize: TavariStyles.typography.fontSize.sm,
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      color: TavariStyles.colors.gray800,
      marginBottom: TavariStyles.spacing.xs
    },
    
    transactionDate: {
      fontSize: TavariStyles.typography.fontSize.xs,
      color: TavariStyles.colors.gray500
    },
    
    transactionDescription: {
      fontSize: TavariStyles.typography.fontSize.xs,
      color: TavariStyles.colors.gray600,
      marginTop: '2px',
      fontStyle: 'italic'
    },
    
    transactionAmount: {
      fontSize: TavariStyles.typography.fontSize.sm,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      textAlign: 'right'
    },
    
    earnedAmount: {
      color: TavariStyles.colors.success
    },
    
    redeemedAmount: {
      color: TavariStyles.colors.danger
    },
    
    adjustmentAmount: {
      color: TavariStyles.colors.warning
    },
    
    loadingMessage: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: TavariStyles.spacing.xl,
      color: TavariStyles.colors.gray500,
      fontSize: TavariStyles.typography.fontSize.sm
    },
    
    emptyMessage: {
      textAlign: 'center',
      color: TavariStyles.colors.gray500,
      padding: TavariStyles.spacing.xl,
      fontSize: TavariStyles.typography.fontSize.sm
    },
    
    closeButton: {
      background: 'transparent',
      border: 'none',
      fontSize: '24px',
      cursor: 'pointer',
      color: TavariStyles.colors.white,
      padding: TavariStyles.spacing.xs,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: TavariStyles.borderRadius.sm
    },
    
    form: {
      display: 'flex',
      flexDirection: 'column',
      gap: TavariStyles.spacing.lg
    },
    
    formGroup: {
      display: 'flex',
      flexDirection: 'column'
    },
    
    label: {
      ...TavariStyles.components.form.label
    },
    
    input: {
      ...TavariStyles.components.form.input
    },
    
    errorBanner: {
      ...TavariStyles.components.banner.base,
      ...TavariStyles.components.banner.variants.error
    },
    
    emptyState: {
      textAlign: 'center',
      padding: TavariStyles.spacing['6xl'],
      color: TavariStyles.colors.gray500
    },
    
    loadingState: {
      ...TavariStyles.components.loading.container
    },
    
    statsCard: {
      ...TavariStyles.layout.card,
      padding: TavariStyles.spacing.lg,
      textAlign: 'center',
      marginBottom: TavariStyles.spacing.lg
    },
    
    statValue: {
      fontSize: TavariStyles.typography.fontSize['2xl'],
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.primary
    },
    
    statLabel: {
      fontSize: TavariStyles.typography.fontSize.sm,
      color: TavariStyles.colors.gray600
    },

    topLoyaltyBalanceStatButton: {
      ...TavariStyles.layout.card,
      padding: TavariStyles.spacing.lg,
      textAlign: 'center',
      marginBottom: TavariStyles.spacing.lg,
      cursor: 'pointer',
      width: '100%',
      border: 'none',
      font: 'inherit',
      color: 'inherit',
      boxSizing: 'border-box',
      transition: 'box-shadow 0.15s ease, transform 0.12s ease'
    },

    topLoyaltyModalContent: {
      ...TavariStyles.components.modal.content,
      maxWidth: '560px',
      width: '92vw',
      maxHeight: '85vh',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden'
    },

    topLoyaltyModalBody: {
      ...TavariStyles.components.modal.body,
      overflowY: 'auto',
      flex: 1
    },

    customerRowClickable: {
      ...TavariStyles.components.table.row,
      cursor: 'pointer',
      transition: 'background-color 0.15s ease'
    },

    profileModalContent: {
      ...TavariStyles.components.modal.content,
      maxWidth: '720px',
      width: '92vw',
      height: '80vh',
      maxHeight: '80vh',
      minHeight: '620px',
      display: 'flex',
      flexDirection: 'column',
      padding: 0,
      overflow: 'hidden'
    },

    profileTabBar: {
      display: 'flex',
      flexWrap: 'nowrap',
      gap: '2px',
      borderBottom: `1px solid ${TavariStyles.colors.gray200}`,
      padding: `0 ${TavariStyles.spacing.md}`,
      backgroundColor: TavariStyles.colors.gray50,
      overflowX: 'auto'
    },

    profileTab: {
      padding: `${TavariStyles.spacing.sm} ${TavariStyles.spacing.md}`,
      background: 'none',
      border: 'none',
      borderBottom: '2px solid transparent',
      marginBottom: '-1px',
      cursor: 'pointer',
      color: TavariStyles.colors.gray600,
      fontSize: TavariStyles.typography.fontSize.sm,
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      whiteSpace: 'nowrap',
      maxWidth: '100%'
    },

    profileTabActive: {
      color: TavariStyles.colors.primary,
      borderBottomColor: TavariStyles.colors.primary
    },

    profileTabBody: {
      flex: 1,
      overflowY: 'auto',
      padding: TavariStyles.spacing.lg
    },

    comingSoonBox: {
      textAlign: 'center',
      color: TavariStyles.colors.gray500,
      padding: TavariStyles.spacing['2xl'],
      fontSize: TavariStyles.typography.fontSize.md
    },

    infoField: {
      marginBottom: TavariStyles.spacing.md,
      fontSize: TavariStyles.typography.fontSize.sm,
      color: TavariStyles.colors.gray800
    },

    infoLabel: {
      fontSize: TavariStyles.typography.fontSize.xs,
      color: TavariStyles.colors.gray500,
      textTransform: 'uppercase',
      letterSpacing: '0.04em',
      marginBottom: '4px',
      fontWeight: TavariStyles.typography.fontWeight.semibold
    },

    marketingSectionTitle: {
      margin: `${TavariStyles.spacing.lg} 0 ${TavariStyles.spacing.sm}`,
      fontSize: TavariStyles.typography.fontSize.md,
      color: TavariStyles.colors.gray900
    },

    marketingAuthGrid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
      gap: TavariStyles.spacing.md
    },

    marketingAuthCard: {
      border: `1px solid ${TavariStyles.colors.gray200}`,
      borderRadius: TavariStyles.borderRadius.lg,
      padding: TavariStyles.spacing.md,
      backgroundColor: TavariStyles.colors.white
    },

    marketingAuthHeader: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: TavariStyles.spacing.sm,
      marginBottom: TavariStyles.spacing.md
    },

    marketingAuthLabel: {
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      color: TavariStyles.colors.gray900
    },

    marketingStatusPill: {
      borderRadius: TavariStyles.borderRadius.full,
      padding: '3px 10px',
      fontSize: TavariStyles.typography.fontSize.xs,
      fontWeight: TavariStyles.typography.fontWeight.bold
    },

    marketingStatusYes: {
      backgroundColor: '#dcfce7',
      color: '#166534'
    },

    marketingStatusNo: {
      backgroundColor: '#fee2e2',
      color: '#991b1b'
    },

    marketingMetaGrid: {
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: TavariStyles.spacing.sm,
      fontSize: TavariStyles.typography.fontSize.sm,
      color: TavariStyles.colors.gray800
    },

    marketingNote: {
      marginTop: TavariStyles.spacing.sm,
      fontSize: TavariStyles.typography.fontSize.xs,
      color: TavariStyles.colors.gray600
    },

    waiverProfileCard: {
      border: `1px solid ${TavariStyles.colors.gray200}`,
      borderRadius: TavariStyles.borderRadius.lg,
      padding: TavariStyles.spacing.md,
      backgroundColor: TavariStyles.colors.white
    },

    waiverProfileHeader: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      gap: TavariStyles.spacing.md,
      marginBottom: TavariStyles.spacing.md
    },

    waiverHeaderActions: {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'flex-end',
      gap: TavariStyles.spacing.xs
    },

    waiverSourcePill: {
      borderRadius: TavariStyles.borderRadius.full,
      padding: '4px 10px',
      backgroundColor: TavariStyles.colors.gray100,
      color: TavariStyles.colors.gray700,
      fontSize: TavariStyles.typography.fontSize.xs,
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      whiteSpace: 'nowrap'
    },

    viewWaiverButton: {
      border: 'none',
      borderRadius: TavariStyles.borderRadius.md,
      backgroundColor: TavariStyles.colors.primary,
      color: TavariStyles.colors.white,
      padding: '6px 10px',
      fontSize: TavariStyles.typography.fontSize.xs,
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      cursor: 'pointer',
      whiteSpace: 'nowrap'
    },

    waiverMetaGrid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
      gap: TavariStyles.spacing.sm,
      padding: TavariStyles.spacing.sm,
      backgroundColor: TavariStyles.colors.gray50,
      borderRadius: TavariStyles.borderRadius.md,
      marginBottom: TavariStyles.spacing.md,
      fontSize: TavariStyles.typography.fontSize.sm
    },

    waiverParticipantsTitle: {
      fontSize: TavariStyles.typography.fontSize.sm,
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      color: TavariStyles.colors.gray900,
      marginBottom: TavariStyles.spacing.sm
    },

    waiverParticipantList: {
      display: 'flex',
      flexDirection: 'column',
      gap: TavariStyles.spacing.xs
    },

    waiverParticipantRow: {
      display: 'flex',
      justifyContent: 'space-between',
      gap: TavariStyles.spacing.md,
      padding: TavariStyles.spacing.sm,
      border: `1px solid ${TavariStyles.colors.gray100}`,
      borderRadius: TavariStyles.borderRadius.md,
      fontSize: TavariStyles.typography.fontSize.sm
    },

    waiverParticipantName: {
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      color: TavariStyles.colors.gray900
    },

    waiverParticipantContact: {
      color: TavariStyles.colors.gray600,
      textAlign: 'right',
      wordBreak: 'break-word'
    }
  }), [showAddPoints, showRemovePoints, embeddedInBookings]);

  const openLoyaltyFromProfile = () => {
    if (!selectedCustomer) return;
    if (!canViewLoyalty) {
      toast.error('You do not have permission to view loyalty history');
      return;
    }
    setCustomerProfileTab('loyalty');
  };

  const renderMarketingAuthorizationCard = (label, authorization) => (
    <div style={styles.marketingAuthCard}>
      <div style={styles.marketingAuthHeader}>
        <div style={styles.marketingAuthLabel}>{label}</div>
        <span
          style={{
            ...styles.marketingStatusPill,
            ...(authorization?.authorized ? styles.marketingStatusYes : styles.marketingStatusNo)
          }}
        >
          {authorization?.authorized ? 'Yes' : 'No'}
        </span>
      </div>
      <div style={styles.marketingMetaGrid}>
        <div>
          <div style={styles.infoLabel}>Granted</div>
          <div>{formatMarketingDate(authorization?.grantedAt)}</div>
        </div>
        <div>
          <div style={styles.infoLabel}>Revoked</div>
          <div>{formatMarketingDate(authorization?.revokedAt)}</div>
        </div>
      </div>
      {authorization?.note ? (
        <div style={styles.marketingNote}>{authorization.note}</div>
      ) : null}
    </div>
  );

  const getCampaignLabel = (item) => (
    item?.campaign?.name ||
    item?.campaign?.subject_line ||
    item?.mail_campaigns?.name ||
    item?.campaign_id ||
    'Marketing message'
  );

  const getAutomationLabel = (item) => (
    item?.automation?.name ||
    item?.automation?.automation_type ||
    item?.automation_type ||
    item?.automation_id ||
    'Automation'
  );

  const getWaiverTemplateLabel = (waiver) => {
    const template = waiver?.waiver_templates;
    return (
      template?.waiver_title ||
      template?.template_name ||
      template?.template_key ||
      (waiver?._dataSource === 'legacy' ? 'Legacy waiver' : 'Waiver')
    );
  };

  const getWaiverVersionLabel = (waiver) => {
    const template = waiver?.waiver_templates;
    if (waiver?._dataSource === 'legacy') {
      return waiver.legacy_row_id
        ? `Legacy row ${waiver.legacy_row_id}`
        : waiver.external_document_id
          ? `Document ${waiver.external_document_id}`
          : 'Legacy version';
    }
    return template?.version != null ? `Version ${template.version}` : 'Version not recorded';
  };

  const getEffectiveWaiverExpiryDate = (waiver) => {
    if (waiver?.expires_at) {
      const expiryDate = new Date(waiver.expires_at);
      if (!Number.isNaN(expiryDate.getTime())) return expiryDate;
    }

    if (!waiver?.signed_at) return null;
    const signedDate = new Date(waiver.signed_at);
    if (Number.isNaN(signedDate.getTime())) return null;

    const expiryDays =
      parsePositiveExpiryDays(defaultWaiverExpiryDays) ||
      parsePositiveExpiryDays(waiver?.waiver_templates?.expiry_days) ||
      DISPLAY_FALLBACK_EXPIRY_DAYS;

    return new Date(signedDate.getTime() + expiryDays * 24 * 60 * 60 * 1000);
  };

  const getCustomerWaiverStatus = (waiver) => {
    if (waiver?.is_valid === false) return 'Invalid';
    const expiryDate = getEffectiveWaiverExpiryDate(waiver);
    if (!expiryDate) return 'Valid';
    const now = new Date();
    if (expiryDate <= now) return 'Expired';
    const soon = new Date(now.getTime() + EXPIRING_SOON_DAYS * 24 * 60 * 60 * 1000);
    if (expiryDate <= soon) return 'Expiring soon';
    return 'Valid';
  };

  const getCustomerWaiverExpiryLabel = (waiver) => {
    const expiryDate = getEffectiveWaiverExpiryDate(waiver);
    return expiryDate ? formatMarketingDate(expiryDate) : 'No expiry rule found';
  };

  const viewCustomerWaiver = (waiver) => {
    if (!waiver?.id) return;
    setShowCustomerProfileModal(false);
    navigate(`/dashboard/waivers/${encodeURIComponent(waiver.id)}`);
  };

  const getWaiverParticipants = (waiver) => {
    const signer = {
      id: `${waiver.id}-signer`,
      participant_type: 'primary signer',
      first_name: waiver.first_name,
      last_name: waiver.last_name,
      date_of_birth: waiver.date_of_birth,
      email: waiver.email,
      phone_number: waiver.phone_number
    };
    const participantRows = Array.isArray(waiver.waiver_participants) ? waiver.waiver_participants : [];
    const signerName = `${signer.first_name || ''} ${signer.last_name || ''}`.trim().toLowerCase();
    const rows = participantRows.filter((participant) => {
      const name = `${participant.first_name || ''} ${participant.last_name || ''}`.trim().toLowerCase();
      return name !== signerName || participant.participant_type !== 'primary';
    });
    return [signer, ...rows];
  };

  const renderCustomerProfileTabPanel = () => {
    if (!selectedCustomer) return null;
    const c = selectedCustomer;

    if (customerProfileTab === 'info') {
      return (
        <div>
          <div
            style={{
              ...getAccountCardStyleSurface(c.account_card_style),
              padding: TavariStyles.spacing.md,
              borderRadius: TavariStyles.borderRadius.md,
              marginBottom: TavariStyles.spacing.lg
            }}
          >
            <h3 style={{ margin: 0, fontSize: TavariStyles.typography.fontSize.xl, color: TavariStyles.colors.gray900 }}>
              {c.customer_name}
            </h3>
            {c.restrict_check_in ? (
              <div
                style={{
                  marginTop: TavariStyles.spacing.xs,
                  fontSize: TavariStyles.typography.fontSize.xs,
                  color: '#b91c1c',
                  fontWeight: TavariStyles.typography.fontWeight.semibold
                }}
              >
                Waiver check-in is blocked for this account
              </div>
            ) : null}
          </div>
          <div style={styles.infoField}>
            <div style={styles.infoLabel}>Email</div>
            <div>{c.customer_email || '—'}</div>
          </div>
          <div style={styles.infoField}>
            <div style={styles.infoLabel}>Phone</div>
            <div>{c.customer_phone || '—'}</div>
          </div>
          <div style={styles.infoField}>
            <div style={styles.infoLabel}>Store credit (account $)</div>
            <div>${formatTaxAmount(Number(c.store_credit) || 0)}</div>
          </div>
          <div style={styles.infoField}>
            <div style={styles.infoLabel}>
              {isPointsLoyaltyMode(loyaltySettings) ? 'Loyalty points' : 'Loyalty / pool'}
            </div>
            <div>{canViewLoyalty ? getBalanceDisplay(c) : '—'}</div>
          </div>
          {c.notes ? (
            <div style={styles.infoField}>
              <div style={styles.infoLabel}>Notes</div>
              <div style={{ whiteSpace: 'pre-wrap' }}>{c.notes}</div>
            </div>
          ) : null}
          <div style={styles.infoField}>
            <div style={styles.infoLabel}>Customer since</div>
            <div>{c.created_at ? new Date(c.created_at).toLocaleString() : '—'}</div>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: TavariStyles.spacing.sm, marginTop: TavariStyles.spacing.lg, paddingTop: TavariStyles.spacing.lg, borderTop: `1px solid ${TavariStyles.colors.gray200}` }}>
            {canViewLoyalty && (
              <button type="button" style={{ ...styles.actionButton, ...styles.viewButton }} onClick={openLoyaltyFromProfile}>
                Loyalty history
              </button>
            )}
            <PermissionGate
              permission="pos.customers.manage"
              fallback={null}
            >
              <button type="button" style={{ ...styles.actionButton, ...styles.editButton }} onClick={() => handleEditCustomer(c)}>
                Edit
              </button>
            </PermissionGate>
            <PermissionGate requireOwner fallback={null}>
              <button type="button" style={{ ...styles.actionButton, ...styles.deleteButton }} onClick={() => handleDeleteCustomer(c.id)}>
                Delete
              </button>
            </PermissionGate>
          </div>
        </div>
      );
    }

    if (customerProfileTab === 'bookings') {
      if (embeddedInBookings) {
        return (
          <CustomerModuleBookingsTabPanel
            customerId={selectedCustomer?.id}
            focusBookingId={initialBookingId || undefined}
            businessId={auth.selectedBusinessId}
          />
        );
      }
      if (customerTransactions.length === 0) {
        return <div style={styles.emptyState}>No point-of-sale purchases found for this customer yet.</div>;
      }
      return (
        <div style={styles.tableContainer}>
          <p style={{ fontSize: TavariStyles.typography.fontSize.sm, color: TavariStyles.colors.gray600, marginTop: 0, marginBottom: TavariStyles.spacing.md }}>
            Store purchases (POS) linked to this customer.
          </p>
          <table style={styles.table}>
            <thead>
              <tr style={styles.headerRow}>
                <th style={styles.th}>Sale #</th>
                <th style={styles.th}>Date</th>
                <th style={styles.th}>Total</th>
                <th style={styles.th}>Status</th>
                <th style={styles.th}>Cashier</th>
              </tr>
            </thead>
            <tbody>
              {customerTransactions.map((transaction, rowIdx) => (
                <tr key={`customer-transaction-${transaction.id || 'transaction'}-${rowIdx}`} style={styles.row}>
                  <td style={styles.td}>{transaction.sale_number}</td>
                  <td style={styles.td}>{new Date(transaction.created_at).toLocaleString()}</td>
                  <td style={styles.td}>${formatTaxAmount(transaction.total)}</td>
                  <td style={styles.td}>{transaction.payment_status}</td>
                  <td style={styles.td}>{transaction.users?.name || 'Unknown'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }

    if (customerProfileTab === 'loyalty') {
      if (!canViewLoyalty) {
        return <div style={styles.emptyState}>You do not have permission to view loyalty history.</div>;
      }

      return (
        <div>
          <div
            style={{
              ...styles.customerSummary,
              ...getAccountCardStyleSurface(c.account_card_style)
            }}
          >
            <div style={styles.customerSummaryName}>{c.customer_name}</div>
            <div style={styles.customerSummaryBalance}>
              Current Balance: {getBalanceDisplay(c)}
            </div>
            {c.customer_email && (
              <div style={styles.transactionDescription}>{c.customer_email}</div>
            )}
            {c.customer_phone && (
              <div style={styles.transactionDescription}>{c.customer_phone}</div>
            )}
            {c.restrict_check_in ? (
              <div
                style={{
                  marginTop: TavariStyles.spacing.xs,
                  fontSize: TavariStyles.typography.fontSize.xs,
                  color: '#b91c1c',
                  fontWeight: TavariStyles.typography.fontWeight.semibold
                }}
              >
                Waiver check-in blocked
              </div>
            ) : null}
          </div>

          <PermissionGate
            requireOwner
            fallback={
              <div style={styles.readOnlyBadge}>
                <AlertCircle size={16} />
                <span>Only owners can adjust loyalty points</span>
              </div>
            }
          >
            <div style={styles.adjustmentButtonRow}>
              <button
                style={styles.addPointsButton}
                onClick={handleAddPointsClick}
              >
                <Plus size={16} />
                Add {loyaltySettings?.loyalty_mode === 'points' ? 'Points' : 'Credit'}
              </button>
              <button
                style={styles.removePointsButton}
                onClick={handleRemovePointsClick}
              >
                <Minus size={16} />
                Remove {loyaltySettings?.loyalty_mode === 'points' ? 'Points' : 'Credit'}
              </button>
            </div>
          </PermissionGate>

          {showAddPoints && (
            <div style={styles.adjustmentSection}>
              <h4 style={styles.adjustmentTitle}>
                Add {loyaltySettings?.loyalty_mode === 'points' ? 'Points' : 'Credit'}
              </h4>
              {adjustmentError && <div style={styles.adjustmentError}>{adjustmentError}</div>}
              <div style={styles.adjustmentForm}>
                <div style={styles.adjustmentFormGroup}>
                  <label style={styles.adjustmentLabel}>
                    Amount ({loyaltySettings?.loyalty_mode === 'points' ? 'Points' : 'Dollars'}):
                  </label>
                  <input
                    type="number"
                    value={adjustmentAmount}
                    onChange={(e) => setAdjustmentAmount(e.target.value)}
                    placeholder={loyaltySettings?.loyalty_mode === 'points' ? 'Enter points' : 'Enter dollar amount'}
                    style={styles.adjustmentInput}
                    min="1"
                  />
                </div>
                <div style={styles.adjustmentFormGroup}>
                  <label style={styles.adjustmentLabel}>Reason:</label>
                  <input
                    type="text"
                    value={adjustmentReason}
                    onChange={(e) => setAdjustmentReason(e.target.value)}
                    placeholder="Enter reason for addition"
                    style={styles.adjustmentInput}
                  />
                </div>
                <div style={styles.adjustmentFormGroup}>
                  <label style={styles.adjustmentLabel}>Manager PIN:</label>
                  <input
                    type="password"
                    value={managerPin}
                    onChange={(e) => setManagerPin(e.target.value)}
                    placeholder="Enter manager PIN"
                    style={styles.adjustmentInput}
                  />
                </div>
                <div style={styles.adjustmentActions}>
                  <button style={styles.adjustmentCancel} onClick={resetAdjustmentForm}>Cancel</button>
                  <button
                    style={styles.adjustmentSubmit}
                    onClick={() => handlePointsAdjustment(true)}
                    disabled={adjustmentLoading || !adjustmentAmount || !adjustmentReason.trim() || !managerPin}
                  >
                    {adjustmentLoading ? 'Processing...' : 'Add Points'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {showRemovePoints && (
            <div style={styles.adjustmentSection}>
              <h4 style={styles.adjustmentTitle}>
                Remove {loyaltySettings?.loyalty_mode === 'points' ? 'Points' : 'Credit'}
              </h4>
              {adjustmentError && <div style={styles.adjustmentError}>{adjustmentError}</div>}
              <div style={styles.adjustmentForm}>
                <div style={styles.adjustmentFormGroup}>
                  <label style={styles.adjustmentLabel}>
                    Amount ({loyaltySettings?.loyalty_mode === 'points' ? 'Points' : 'Dollars'}):
                  </label>
                  <input
                    type="number"
                    value={adjustmentAmount}
                    onChange={(e) => setAdjustmentAmount(e.target.value)}
                    placeholder={loyaltySettings?.loyalty_mode === 'points' ? 'Enter points' : 'Enter dollar amount'}
                    style={styles.adjustmentInput}
                    min="1"
                  />
                </div>
                <div style={styles.adjustmentFormGroup}>
                  <label style={styles.adjustmentLabel}>Reason:</label>
                  <input
                    type="text"
                    value={adjustmentReason}
                    onChange={(e) => setAdjustmentReason(e.target.value)}
                    placeholder="Enter reason for deduction"
                    style={styles.adjustmentInput}
                  />
                </div>
                <div style={styles.adjustmentFormGroup}>
                  <label style={styles.adjustmentLabel}>Manager PIN:</label>
                  <input
                    type="password"
                    value={managerPin}
                    onChange={(e) => setManagerPin(e.target.value)}
                    placeholder="Enter manager PIN"
                    style={styles.adjustmentInput}
                  />
                </div>
                <div style={styles.adjustmentActions}>
                  <button style={styles.adjustmentCancel} onClick={resetAdjustmentForm}>Cancel</button>
                  <button
                    style={{ ...styles.adjustmentSubmit, backgroundColor: TavariStyles.colors.danger }}
                    onClick={() => handlePointsAdjustment(false)}
                    disabled={adjustmentLoading || !adjustmentAmount || !adjustmentReason.trim() || !managerPin}
                  >
                    {adjustmentLoading ? 'Processing...' : 'Remove Points'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {loyaltyHistoryLoading ? (
            <div style={styles.loadingMessage}>Loading loyalty history...</div>
          ) : loyaltyTransactions.length === 0 ? (
            <div style={styles.emptyMessage}>No loyalty transactions found for this customer.</div>
          ) : (
            <div style={styles.transactionsList}>
              {loyaltyTransactions.map((transaction, index) => {
                let isEarn = ['earn', 'manual_add', 'initial_balance'].includes(
                  transaction.transaction_type
                );
                let isRedeem = ['redeem', 'manual_subtract'].includes(transaction.transaction_type);
                if (transaction.transaction_type === 'adjust') {
                  const pt = Number(transaction.points) || 0;
                  isEarn = pt > 0;
                  isRedeem = pt < 0;
                }

                let amountStyle = styles.adjustmentAmount;
                if (isEarn) amountStyle = styles.earnedAmount;
                if (isRedeem) amountStyle = styles.redeemedAmount;

                return (
                  <div key={index} style={styles.transactionItem}>
                    <div style={styles.transactionLeft}>
                      <div style={styles.transactionType}>
                        {formatTransactionType(transaction.transaction_type)}
                      </div>
                      <div style={styles.transactionDate}>
                        {new Date(transaction.created_at).toLocaleDateString()} at {new Date(transaction.created_at).toLocaleTimeString()}
                      </div>
                      {transaction.description && (
                        <div style={styles.transactionDescription}>{transaction.description}</div>
                      )}
                    </div>
                    <div style={{ ...styles.transactionAmount, ...amountStyle }}>
                      {getTransactionAmountDisplay(transaction)}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      );
    }

    if (customerProfileTab === 'marketing') {
      if (customerMarketingLoading) {
        return <div style={styles.loadingMessage}>Loading marketing details...</div>;
      }

      const marketing = customerMarketing || buildEmptyMarketingProfile();

      return (
        <div>
          <div
            style={{
              ...styles.customerSummary,
              ...getAccountCardStyleSurface(c.account_card_style)
            }}
          >
            <div style={styles.customerSummaryName}>{c.customer_name}</div>
            <div style={styles.transactionDescription}>
              {[c.customer_email, c.customer_phone].filter(Boolean).join(' - ') || 'No contact info'}
            </div>
            {c.restrict_check_in ? (
              <div
                style={{
                  marginTop: TavariStyles.spacing.xs,
                  fontSize: TavariStyles.typography.fontSize.xs,
                  color: '#b91c1c',
                  fontWeight: TavariStyles.typography.fontWeight.semibold
                }}
              >
                Waiver check-in blocked
              </div>
            ) : null}
          </div>

          <h4 style={styles.marketingSectionTitle}>Marketing Authorization</h4>
          <div style={styles.marketingAuthGrid}>
            {renderMarketingAuthorizationCard('Email Marketing', marketing.email)}
            {renderMarketingAuthorizationCard('SMS Marketing', marketing.sms)}
          </div>

          <h4 style={styles.marketingSectionTitle}>Marketing Received</h4>
          {marketing.received.length === 0 ? (
            <div style={styles.emptyMessage}>No marketing send history found for this customer.</div>
          ) : (
            <div style={styles.transactionsList}>
              {marketing.received.map((item, index) => (
                <div key={`received-${item.id || index}-${index}`} style={styles.transactionItem}>
                  <div style={styles.transactionLeft}>
                    <div style={styles.transactionType}>{getCampaignLabel(item)}</div>
                    <div style={styles.transactionDate}>
                      {formatMarketingDate(item.sent_at || item.created_at)}
                    </div>
                    <div style={styles.transactionDescription}>
                      Status: {item.status || 'unknown'}
                      {item.opened_at ? ` - Opened ${formatMarketingDate(item.opened_at)}` : ''}
                      {item.clicked_at ? ` - Clicked ${formatMarketingDate(item.clicked_at)}` : ''}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          <h4 style={styles.marketingSectionTitle}>Upcoming Marketing</h4>
          {marketing.upcoming.length === 0 ? (
            <div style={styles.emptyMessage}>No queued or scheduled marketing found for this customer.</div>
          ) : (
            <div style={styles.transactionsList}>
              {marketing.upcoming.map((item) => (
                <div key={`${item.source}-${item.id}`} style={styles.transactionItem}>
                  <div style={styles.transactionLeft}>
                    <div style={styles.transactionType}>
                      {item.source === 'automation_run' ? getAutomationLabel(item) : getCampaignLabel(item)}
                    </div>
                    <div style={styles.transactionDate}>
                      {formatMarketingDate(item.scheduled_for || item.trigger_date || item.queued_at || item.created_at)}
                    </div>
                    <div style={styles.transactionDescription}>
                      Status: {item.status || 'queued'}
                      {item.automation_type ? ` - ${item.automation_type}` : ''}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          <h4 style={styles.marketingSectionTitle}>Enabled Automations</h4>
          {marketing.automations.length === 0 ? (
            <div style={styles.emptyMessage}>
              No enabled email automations currently match this subscribed contact.
            </div>
          ) : (
            <div style={styles.transactionsList}>
              {marketing.automations.map((automation, index) => (
                <div key={`automation-${automation.id || index}-${index}`} style={styles.transactionItem}>
                  <div style={styles.transactionLeft}>
                    <div style={styles.transactionType}>{automation.name || 'Automation'}</div>
                    <div style={styles.transactionDescription}>
                      {automation.automation_type || 'custom'} - {automation.trigger_timing || 'scheduled'} - {Number(automation.days_offset) || 0} day offset
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      );
    }

    if (customerProfileTab === 'waivers') {
      if (customerWaiversLoading) {
        return <div style={styles.loadingMessage}>Loading waivers...</div>;
      }

      if (customerWaivers.length === 0) {
        return <div style={styles.emptyMessage}>No waivers found for this customer account, email, or phone.</div>;
      }

      return (
        <div>
          <div
            style={{
              ...styles.customerSummary,
              ...getAccountCardStyleSurface(c.account_card_style)
            }}
          >
            <div style={styles.customerSummaryName}>{c.customer_name}</div>
            <div style={styles.transactionDescription}>
              {[c.customer_email, c.customer_phone].filter(Boolean).join(' - ') || 'No contact info'}
            </div>
            {c.restrict_check_in ? (
              <div
                style={{
                  marginTop: TavariStyles.spacing.xs,
                  fontSize: TavariStyles.typography.fontSize.xs,
                  color: '#b91c1c',
                  fontWeight: TavariStyles.typography.fontWeight.semibold
                }}
              >
                Waiver check-in blocked
              </div>
            ) : null}
          </div>

          <div style={styles.transactionsList}>
            {customerWaivers.map((waiver, waiverIndex) => {
              const participants = getWaiverParticipants(waiver);
              const waiverKey = `${waiver._dataSource || 'waiver'}-${waiver.id || waiverIndex}-${waiverIndex}`;
              return (
                <div key={waiverKey} style={styles.waiverProfileCard}>
                  <div style={styles.waiverProfileHeader}>
                    <div>
                      <div style={styles.transactionType}>{getWaiverTemplateLabel(waiver)}</div>
                      <div style={styles.transactionDate}>
                        Signed {formatMarketingDate(waiver.signed_at)}
                      </div>
                    </div>
                    <div style={styles.waiverHeaderActions}>
                      <span style={styles.waiverSourcePill}>{formatWaiverSource(waiver)}</span>
                      <button
                        type="button"
                        style={styles.viewWaiverButton}
                        onClick={() => viewCustomerWaiver(waiver)}
                      >
                        View waiver
                      </button>
                    </div>
                  </div>

                  <div style={styles.waiverMetaGrid}>
                    <div>
                      <div style={styles.infoLabel}>Version / Document</div>
                      <div>{getWaiverVersionLabel(waiver)}</div>
                    </div>
                    <div>
                      <div style={styles.infoLabel}>Status</div>
                      <div>{getCustomerWaiverStatus(waiver)}</div>
                    </div>
                    <div>
                      <div style={styles.infoLabel}>Expires</div>
                      <div>{getCustomerWaiverExpiryLabel(waiver)}</div>
                    </div>
                    <div>
                      <div style={styles.infoLabel}>PDF</div>
                      <div>
                        {waiver.signed_pdf_storage_path || waiver.imported_pdf_storage_path
                          ? 'Available'
                          : 'Not attached'}
                      </div>
                    </div>
                  </div>

                  <div style={styles.waiverParticipantsTitle}>Participants on this waiver</div>
                  <div style={styles.waiverParticipantList}>
                    {participants.map((participant, index) => {
                      const isCountOnly = participant._legacyCountOnly;
                      const name = isCountOnly
                        ? `${participant._legacyMinorCount || 0} minor(s), names not in legacy export`
                        : `${participant.first_name || ''} ${participant.last_name || ''}`.trim() || 'Unnamed participant';
                      return (
                        <div
                          key={`${waiverKey}-participant-${participant.id || index}-${index}`}
                          style={styles.waiverParticipantRow}
                        >
                          <div>
                            <div style={styles.waiverParticipantName}>{name}</div>
                            <div style={styles.transactionDescription}>
                              {formatParticipantType(participant.participant_type)}
                              {participant.date_of_birth ? ` - DOB ${participant.date_of_birth}` : ''}
                            </div>
                          </div>
                          <div style={styles.waiverParticipantContact}>
                            {[participant.email, participant.phone_number].filter(Boolean).join(' - ') || '—'}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      );
    }

    if (customerProfileTab === 'notes') {
      const participantNoteGroups = Array.from(
        participantNotesRows
          .reduce((map, participant) => {
            const key = getParticipantPersonKey(participant);
            if (!map.has(key)) map.set(key, { ...participant, personKey: key, rowCount: 0 });
            const existing = map.get(key);
            existing.rowCount += 1;
            if (participant.restrict_check_in) existing.restrict_check_in = true;
            if (participant.notes && !existing.notes) existing.notes = participant.notes;
            if (participant.account_card_style === 'banned' || existing.account_card_style === 'default') {
              existing.account_card_style = participant.account_card_style || 'default';
            }
            return map;
          }, new Map())
          .values()
      );
      const onStyleChange = (e) => {
        const v = e.target.value;
        setProfileNotesState((s) => ({
          ...s,
          account_card_style: v,
          restrict_check_in: v === 'banned' ? true : s.restrict_check_in
        }));
      };
      const onBlockChange = (checked) => {
        setProfileNotesState((s) => ({
          ...s,
          restrict_check_in: checked,
          account_card_style: !checked && s.account_card_style === 'banned' ? 'danger' : s.account_card_style
        }));
      };
      return (
        <div>
          <p style={{ marginTop: 0, fontSize: TavariStyles.typography.fontSize.sm, color: TavariStyles.colors.gray600 }}>
            Account notes apply to the family account. Use <strong>Individual participant restrictions</strong> below
            when only one child, spouse, or adult should be blocked from check-in.
          </p>
          <div style={styles.formGroup}>
            <label style={styles.infoLabel}>Notes</label>
            <textarea
              value={profileNotesState.notes}
              onChange={(e) => setProfileNotesState((s) => ({ ...s, notes: e.target.value }))}
              disabled={!canManageCustomers}
              rows={5}
              style={{
                ...styles.input,
                width: '100%',
                minHeight: '100px',
                resize: 'vertical',
                fontFamily: 'inherit'
              }}
            />
          </div>
          <div style={styles.formGroup}>
            <label style={styles.infoLabel}>Name card style</label>
            <select
              value={profileNotesState.account_card_style}
              onChange={onStyleChange}
              disabled={!canManageCustomers}
              style={styles.input}
            >
              {ACCOUNT_CARD_STYLE_OPTIONS.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: TavariStyles.spacing.md,
              marginBottom: TavariStyles.spacing.lg
            }}
          >
            <TavariCheckbox
              checked={!!profileNotesState.restrict_check_in}
              onChange={onBlockChange}
              disabled={!canManageCustomers}
              label="Block waiver check-in for the entire account"
            />
          </div>
          <div
            style={{
              ...getAccountCardStyleSurface(profileNotesState.account_card_style),
              padding: TavariStyles.spacing.md,
              borderRadius: TavariStyles.borderRadius.md,
              marginBottom: TavariStyles.spacing.lg
            }}
          >
            <div style={styles.customerSummaryName}>Preview: {c.customer_name || 'Customer'}</div>
            <div style={styles.transactionDescription}>
              {[c.customer_email, c.customer_phone].filter(Boolean).join(' — ') || 'Contact'}
            </div>
          </div>
          <div style={styles.formGroup}>
            <h4 style={{ margin: `0 0 ${TavariStyles.spacing.sm}`, color: TavariStyles.colors.gray900 }}>
              Individual participant restrictions
            </h4>
            <p style={{ marginTop: 0, fontSize: TavariStyles.typography.fontSize.sm, color: TavariStyles.colors.gray600 }}>
              Block only the person who should not be checked in. Other people on the same family account can still check in.
            </p>
            {participantNotesLoading ? (
              <div style={styles.emptyMessage}>Loading participants...</div>
            ) : participantNoteGroups.length === 0 ? (
              <div style={styles.emptyMessage}>
                No linked waiver participants found yet. Once this customer has signed a Tavari waiver, participants will appear here.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: TavariStyles.spacing.md }}>
                {participantNoteGroups.map((participant) => {
                  const participantName =
                    [participant.first_name, participant.last_name].filter(Boolean).join(' ') ||
                    'Unnamed participant';
                  return (
                    <div
                      key={participant.personKey || participant.id}
                      style={{
                        ...getAccountCardStyleSurface(participant.account_card_style),
                        padding: TavariStyles.spacing.md,
                        borderRadius: TavariStyles.borderRadius.md
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: TavariStyles.spacing.md, marginBottom: TavariStyles.spacing.sm }}>
                        <div>
                          <div style={styles.customerSummaryName}>{participantName}</div>
                          <div style={styles.transactionDescription}>
                            {participant.participant_type || 'participant'}
                            {participant.date_of_birth ? ` - DOB ${participant.date_of_birth}` : ''}
                            {participant.rowCount > 1 ? ` - ${participant.rowCount} waiver records` : ''}
                          </div>
                        </div>
                        <TavariCheckbox
                          checked={!!participant.restrict_check_in}
                          onChange={(checked) =>
                            updateParticipantNotesGroup(participant.personKey, {
                              restrict_check_in: checked,
                              account_card_style:
                                checked && participant.account_card_style === 'default'
                                  ? 'banned'
                                  : !checked && participant.account_card_style === 'banned'
                                    ? 'danger'
                                    : participant.account_card_style
                            })
                          }
                          disabled={!canManageCustomers}
                          label="Block this person"
                        />
                      </div>
                      <div style={styles.row}>
                        <label style={styles.lbl}>
                          Participant style
                          <select
                            value={participant.account_card_style || 'default'}
                            onChange={(e) =>
                              updateParticipantNotesGroup(participant.personKey, {
                                account_card_style: e.target.value,
                                restrict_check_in:
                                  e.target.value === 'banned' ? true : participant.restrict_check_in
                              })
                            }
                            disabled={!canManageCustomers}
                            style={styles.input}
                          >
                            {ACCOUNT_CARD_STYLE_OPTIONS.map((opt) => (
                              <option key={opt.id} value={opt.id}>
                                {opt.label}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                      <label style={styles.infoLabel}>Participant notes / block reason</label>
                      <textarea
                        value={participant.notes || ''}
                        onChange={(e) => updateParticipantNotesGroup(participant.personKey, { notes: e.target.value })}
                        disabled={!canManageCustomers}
                        rows={3}
                        style={{
                          ...styles.input,
                          width: '100%',
                          minHeight: '80px',
                          resize: 'vertical',
                          fontFamily: 'inherit'
                        }}
                        placeholder={`Notes for ${participantName}`}
                      />
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          {canManageCustomers ? (
            <div style={{ display: 'flex', gap: TavariStyles.spacing.sm }}>
              <button
                type="button"
                style={styles.createButton}
                onClick={saveProfileNotesAndStyle}
                disabled={notesTabSaving}
              >
                {notesTabSaving ? 'Saving...' : 'Save'}
              </button>
            </div>
          ) : (
            <p style={{ fontSize: TavariStyles.typography.fontSize.sm, color: TavariStyles.colors.gray500, margin: 0 }}>
              You do not have permission to edit this account. Ask an admin to grant POS customer management.
            </p>
          )}
        </div>
      );
    }

    if (customerProfileTab === 'credits') {
      return (
        <div>
          <p
            style={{
              marginTop: 0,
              fontSize: TavariStyles.typography.fontSize.sm,
              color: TavariStyles.colors.gray600
            }}
          >
            <strong>Store credit</strong> is account money (dollars) — it is{' '}
            <strong>not</strong> loyalty points and <strong>does not</strong> change the points balance.
            Add or remove credit for prepayments, disputes, refunds to account, goodwill, etc. At checkout,
            store credit can be spent like cash alongside any loyalty redemption, but the two are tracked
            separately. History for these entries is below; loyalty program activity stays on the{' '}
            <strong>Loyalty</strong> tab.
          </p>
          <div
            style={{
              ...getAccountCardStyleSurface('info'),
              padding: TavariStyles.spacing.md,
              borderRadius: TavariStyles.borderRadius.md,
              marginBottom: TavariStyles.spacing.lg
            }}
          >
            <div style={styles.infoLabel}>Current store credit</div>
            <div
              style={{
                fontSize: TavariStyles.typography.fontSize.xl,
                fontWeight: TavariStyles.typography.fontWeight.bold,
                color: TavariStyles.colors.gray900
              }}
            >
              ${formatTaxAmount(Number(c.store_credit) || 0)}
            </div>
          </div>

          {canManageCustomers ? (
            <div
              style={{
                marginBottom: TavariStyles.spacing.lg,
                padding: TavariStyles.spacing.md,
                border: `1px solid ${TavariStyles.colors.gray200}`,
                borderRadius: TavariStyles.borderRadius.md
              }}
            >
              <div style={styles.formGroup}>
                <TavariCheckbox
                  checked={creditIsReversal}
                  onChange={(checked) => setCreditIsReversal(!!checked)}
                  label="Remove credit from account (e.g. correction, chargeback)"
                />
              </div>
              <div style={styles.formGroup}>
                <label style={styles.label}>Amount (CAD) *</label>
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={creditAmount}
                  onChange={(e) => setCreditAmount(e.target.value)}
                  style={styles.input}
                  disabled={creditSubmitting}
                />
              </div>
              <div style={styles.formGroup}>
                <label style={styles.label}>Reason *</label>
                <select
                  value={creditCategory}
                  onChange={(e) => setCreditCategory(e.target.value)}
                  style={styles.input}
                  disabled={creditSubmitting}
                >
                  {STORE_CREDIT_CATEGORIES.map((opt) => (
                    <option key={opt.id} value={opt.id}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
              <div style={styles.formGroup}>
                <label style={styles.label}>Details (optional)</label>
                <input
                  type="text"
                  value={creditNote}
                  onChange={(e) => setCreditNote(e.target.value)}
                  style={styles.input}
                  placeholder="e.g. booking #, ticket ID"
                  disabled={creditSubmitting}
                />
              </div>
              <div style={styles.formGroup}>
                <label style={styles.label}>Your PIN *</label>
                <input
                  type="password"
                  value={creditPin}
                  onChange={(e) => setCreditPin(e.target.value)}
                  style={styles.input}
                  autoComplete="off"
                  disabled={creditSubmitting}
                />
              </div>
              {creditError ? <div style={styles.adjustmentError}>{creditError}</div> : null}
              <button
                type="button"
                style={styles.createButton}
                onClick={handleStoreCreditSubmit}
                disabled={creditSubmitting}
              >
                {creditSubmitting
                  ? 'Saving…'
                  : creditIsReversal
                    ? 'Remove from credit'
                    : 'Add to credit'}
              </button>
            </div>
          ) : (
            <p style={{ fontSize: TavariStyles.typography.fontSize.sm, color: TavariStyles.colors.gray500 }}>
              You do not have permission to change store credit.
            </p>
          )}

          <h4
            style={{
              margin: `${TavariStyles.spacing.md} 0 ${TavariStyles.spacing.sm}`,
              fontSize: TavariStyles.typography.fontSize.md,
              color: TavariStyles.colors.gray900
            }}
          >
            Credit history
          </h4>
          {storeCreditLoading ? (
            <div style={styles.loadingMessage}>Loading…</div>
          ) : storeCreditHistory.length === 0 ? (
            <div style={styles.emptyMessage}>
              No classified store-credit entries yet. Deposits and other credits you add will appear here.
            </div>
          ) : (
            <div style={styles.transactionsList}>
              {storeCreditHistory.map((row) => {
                const isAdd = row.transaction_type === 'store_credit';
                const amount = Math.abs(Number(row.amount) || 0);
                return (
                  <div
                    key={row.id || `sc-${row.created_at}`}
                    style={styles.transactionItem}
                  >
                    <div style={styles.transactionLeft}>
                      <div style={styles.transactionType}>
                        {isAdd ? 'Store credit' : 'Removal'}{' '}
                        {row.store_credit_category
                          ? `· ${row.store_credit_category.replace(/_/g, ' ')}`
                          : ''}
                      </div>
                      <div style={styles.transactionDate}>
                        {row.created_at
                          ? `${new Date(row.created_at).toLocaleDateString()} ${new Date(row.created_at).toLocaleTimeString()}`
                          : '—'}
                      </div>
                      {row.description ? (
                        <div style={styles.transactionDescription}>{row.description}</div>
                      ) : null}
                    </div>
                    <div
                      style={{
                        ...styles.transactionAmount,
                        color: isAdd ? TavariStyles.colors.success : TavariStyles.colors.danger
                      }}
                    >
                      {isAdd ? '+' : '−'}
                      {`$${amount.toFixed(2)}`}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      );
    }

    if (customerProfileTab === 'giftcards') {
      const credit = Number(selectedCustomer.gift_card_credit) || 0;
      return (
        <div>
          <div style={{ marginBottom: 16, padding: 12, background: '#ecfdf5', borderRadius: 8, border: '1px solid #a7f3d0' }}>
            <div style={{ fontSize: 24, color: '#065f46', fontWeight: 600 }}>Gift card credit on account</div>
            <div style={{ fontSize: 24, fontWeight: 700, color: '#064e3b' }}>${credit.toFixed(2)}</div>
            <div style={{ fontSize: 10, color: '#047857', marginTop: 4 }}>
              Separate from store credit. Applied automatically when attached after first redeem.
            </div>
          </div>
          <p style={{ color: '#6b7280', fontSize: 11 }}>
            Look up issued cards in the Gift Cards module. Purchaser-owned cards for this customer appear there by email/name search.
          </p>
          <button
            type="button"
            onClick={() => window.location.assign('/dashboard/gift-cards/cards')}
            style={{
              marginTop: 8,
              background: '#0f766e',
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              padding: '10px 14px',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Open Gift Cards
          </button>
        </div>
      );
    }

    return null;
  };

  const renderCustomerProfileModal = () => {
    if (!showCustomerProfileModal || !selectedCustomer) return null;

    return (
      <div
        style={styles.modal}
        role="presentation"
      >
        <div
          style={styles.profileModalContent}
          onClick={(e) => e.stopPropagation()}
        >
          <div style={{ ...styles.modalHeader, flexShrink: 0 }}>
            <h3 style={{ margin: 0, fontSize: TavariStyles.typography.fontSize.lg }}>Customer</h3>
            <button
              type="button"
              onClick={closeCustomerProfileModal}
              style={{ background: 'none', border: 'none', fontSize: '19px', cursor: 'pointer', lineHeight: 1, color: TavariStyles.colors.gray600 }}
              aria-label="Close"
            >
              ×
            </button>
          </div>
          <div style={styles.profileTabBar}>
            {PROFILE_TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                style={{
                  ...styles.profileTab,
                  ...(customerProfileTab === tab.id ? styles.profileTabActive : {})
                }}
                onClick={() => setCustomerProfileTab(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <div style={styles.profileTabBody}>{renderCustomerProfileTabPanel()}</div>
        </div>
      </div>
    );
  };

  if (embeddedProfile) {
    return (
      <POSAuthWrapper
        requireBusiness={true}
        componentName="POSCustomersScreen"
      >
        {renderCustomerProfileModal() || (
          <div style={styles.modal} role="presentation" onClick={onEmbeddedClose}>
            <div style={styles.profileModalContent} onClick={(e) => e.stopPropagation()}>
              <div style={styles.loadingState}>
                {permissionsLoading ? 'Loading permissions...' : 'Loading customer profile...'}
              </div>
            </div>
          </div>
        )}
      </POSAuthWrapper>
    );
  }

  // Show loading while permissions are being checked
  if (permissionsLoading || (listLoading && !customers.length)) {
    return (
      <POSAuthWrapper 
        requireBusiness={true}
        componentName="POSCustomersScreen"
      >
        <div style={styles.container}>
          <div style={styles.loadingState}>
            {permissionsLoading ? 'Loading permissions...' : 'Loading customers...'}
          </div>
        </div>
      </POSAuthWrapper>
    );
  }

  // Show access denied if no permission
  if (!canViewCustomers) {
    return (
      <POSAuthWrapper 
        requireBusiness={true}
        componentName="POSCustomersScreen"
      >
        <div style={styles.container}>
          <div style={styles.accessDenied}>
            <Lock size={64} style={styles.accessDeniedIcon} />
            <h2 style={styles.accessDeniedTitle}>Access Denied</h2>
            <p style={styles.accessDeniedText}>
              You do not have permission to view customers.
            </p>
            <p style={styles.accessDeniedText}>
              Contact your administrator to request access.
            </p>
          </div>
        </div>
      </POSAuthWrapper>
    );
  }

  return (
    <POSAuthWrapper 
      requireBusiness={true}
      componentName="POSCustomersScreen"
    >
      <div style={styles.container}>
        {embeddedInBookings ? (
          <div style={styles.embeddedBookingsToolbar}>
            <div style={styles.embeddedBookingsHeading}>
              <h2 style={styles.embeddedBookingsTitle}>Customers</h2>
              <p style={styles.embeddedBookingsSubtitle}>
                Search and manage profiles, loyalty, waivers, and related bookings.
              </p>
            </div>
            <div style={styles.embeddedBookingsActions}>
              <button
                type="button"
                style={canManageCustomers ? styles.createButton : styles.disabledButton}
                onClick={handleCreateCustomer}
                disabled={!canManageCustomers}
              >
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                  {canManageCustomers ? <Plus size={18} /> : <Lock size={18} />}
                  {canManageCustomers ? 'Add customer' : 'Add customer (locked)'}
                </span>
              </button>
            </div>
          </div>
        ) : (
          <TavariModuleHeader
            title="Customers"
            description="Manage customer profiles, loyalty balances, transaction history, and account activity."
            actionLabel={canManageCustomers ? 'Add New Customer' : 'Add Customer (Locked)'}
            actionIcon={canManageCustomers ? <Plus size={18} /> : <Lock size={18} />}
            actionDisabled={!canManageCustomers}
            onAction={handleCreateCustomer}
          />
        )}

        {!canManageCustomers && (
          <div style={styles.readOnlyBadge}>
            <AlertCircle size={16} />
            <span>View-Only Mode - Contact admin to create or edit customers</span>
          </div>
        )}

        {error && <div style={styles.errorBanner}>{error}</div>}

        {showTopLoyaltyBalanceModal && (
          <div
            style={styles.modal}
            onClick={() => setShowTopLoyaltyBalanceModal(false)}
            role="presentation"
          >
            <div style={styles.topLoyaltyModalContent} onClick={(e) => e.stopPropagation()}>
              <div style={styles.modalHeader}>
                <h3 style={{ margin: 0, fontSize: TavariStyles.typography.fontSize.lg }}>
                  Top 10 — store credit ($)
                </h3>
                <button
                  type="button"
                  onClick={() => setShowTopLoyaltyBalanceModal(false)}
                  style={{ background: 'none', border: 'none', fontSize: '19px', cursor: 'pointer', lineHeight: 1, color: TavariStyles.colors.gray600 }}
                  aria-label="Close"
                >
                  ×
                </button>
              </div>
              <div style={styles.topLoyaltyModalBody}>
                {topLoyaltyByBalance.length === 0 ? (
                  <p style={{ margin: 0, color: TavariStyles.colors.gray500, textAlign: 'center' }}>
                    No store credit balances yet.
                  </p>
                ) : (
                  <table style={styles.table}>
                    <thead>
                      <tr style={styles.headerRow}>
                        <th style={styles.th}>#</th>
                        <th style={styles.th}>Customer</th>
                        <th style={styles.th}>Store credit ($)</th>
                        <th style={styles.th}>Contact</th>
                      </tr>
                    </thead>
                    <tbody>
                      {topLoyaltyByBalance.map((c, rowIdx) => (
                        <tr
                          key={`top-loyalty-${c.id || 'customer'}-${rowIdx}`}
                          style={mergeCustomerTableRowStyle(c.account_card_style, styles.customerRowClickable)}
                          onClick={() => {
                            setShowTopLoyaltyBalanceModal(false);
                            openCustomerProfileModal(c);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              setShowTopLoyaltyBalanceModal(false);
                              openCustomerProfileModal(c);
                            }
                          }}
                          tabIndex={0}
                          title="Open customer"
                        >
                          <td style={styles.td}>{rowIdx + 1}</td>
                          <td style={styles.td}>
                            <strong>{c.customer_name || '—'}</strong>
                          </td>
                          <td style={styles.td}>${formatTaxAmount(Number(c.store_credit) || 0)}</td>
                          <td style={styles.td}>
                            <div>
                              {c.customer_email && <div>{c.customer_email}</div>}
                              {c.customer_phone && <div>{c.customer_phone}</div>}
                              {!c.customer_email && !c.customer_phone && '—'}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                <p style={{ margin: `${TavariStyles.spacing.md} 0 0`, fontSize: TavariStyles.typography.fontSize.xs, color: TavariStyles.colors.gray500 }}>
                  Ranked by account balance (store credit in dollars). Tap a row to open the customer profile.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Customer Stats */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: TavariStyles.spacing.lg, marginBottom: TavariStyles.spacing.xl }}>
          <div style={styles.statsCard}>
            <div style={styles.statValue}>
              {dashboardStats.accountCount.toLocaleString()}
            </div>
            <div style={styles.statLabel}>Total Customers</div>
          </div>
          <button
            type="button"
            style={styles.topLoyaltyBalanceStatButton}
            onClick={() => setShowTopLoyaltyBalanceModal(true)}
            title="View the top 10 customers by account balance (dollars)"
            aria-label="View top 10 customers by loyalty account balance in dollars"
          >
            <div style={styles.statValue}>
              ${formatTaxAmount(dashboardStats.sumStoreCredit)}
            </div>
            <div style={styles.statLabel}>Total store credit</div>
          </button>
          <div style={styles.statsCard}>
            <div style={styles.statValue}>
              {Math.round(dashboardStats.totalPointsStat).toLocaleString()}{' '}
              pts
            </div>
            <div style={styles.statLabel}>Total Points</div>
          </div>
        </div>

        {/* Search and Sort */}
        <div style={styles.searchSection}>
          <input
            type="text"
            placeholder="Search customers by name, email, or phone..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={styles.searchInput}
          />
          
          <select
            value={`${sortBy}-${sortOrder}`}
            onChange={(e) => {
              const [field, order] = e.target.value.split('-');
              setSortBy(field);
              setSortOrder(order);
            }}
            style={styles.sortSelect}
          >
            <option value="created_at-desc">Newest First</option>
            <option value="created_at-asc">Oldest First</option>
            <option value="customer_name-asc">Name A-Z</option>
            <option value="customer_name-desc">Name Z-A</option>
            <option value="balance-desc">Highest Balance</option>
            <option value="points-desc">Most Points</option>
          </select>
        </div>

        {/* Customer Table */}
        {!listLoading && customers.length === 0 ? (
          <div style={styles.emptyState}>
            {searchDebounced
              ? 'No customers found matching your search.'
              : 'No customers yet. Create your first customer to get started.'}
          </div>
        ) : (
          <div style={styles.tableContainer}>
            {listLoading && customers.length > 0 ? (
              <p
                style={{
                  margin: `0 0 ${TavariStyles.spacing.sm}`,
                  fontSize: TavariStyles.typography.fontSize.sm,
                  color: TavariStyles.colors.gray500
                }}
              >
                Updating list…
              </p>
            ) : null}
            <table style={styles.table}>
              <thead>
                <tr style={styles.headerRow}>
                  <th style={styles.th}>Name</th>
                  <th style={styles.th}>Contact</th>
                  <th style={styles.th}>
                    {isPointsLoyaltyMode(loyaltySettings) ? 'Store credit' : 'Store + pool ($)'}
                  </th>
                  <th style={styles.th}>
                    {isPointsLoyaltyMode(loyaltySettings) ? 'Loyalty points' : 'Loyalty'}
                  </th>
                  <th style={styles.th}>Created</th>
                  {showRegistrationActions ? <th style={styles.th}>Actions</th> : null}
                </tr>
              </thead>
              <tbody>
                {customers.map((customer, rowIdx) => (
                  <tr
                    key={`customer-row-${customer.id || 'customer'}-${rowIdx}`}
                    style={mergeCustomerTableRowStyle(customer.account_card_style, styles.customerRowClickable)}
                    onClick={() => openCustomerProfileModal(customer)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        openCustomerProfileModal(customer);
                      }
                    }}
                    tabIndex={0}
                    title="Open customer"
                  >
                    <td style={styles.td}>
                      <strong>{customer.customer_name}</strong>
                      {customer.restrict_check_in ? (
                        <div
                          style={{
                            fontSize: TavariStyles.typography.fontSize.xs,
                            color: '#b91c1c',
                            fontWeight: TavariStyles.typography.fontWeight.semibold,
                            marginTop: '2px'
                          }}
                        >
                          Check-in blocked
                        </div>
                      ) : null}
                    </td>
                    <td style={styles.td}>
                      <div>
                        {customer.customer_email && <div>{customer.customer_email}</div>}
                        {customer.customer_phone && <div>{customer.customer_phone}</div>}
                      </div>
                    </td>
                    <td style={styles.td}>
                      {isPointsLoyaltyMode(loyaltySettings)
                        ? `$${formatTaxAmount(Number(customer.store_credit) || 0)}`
                        : `$${formatTaxAmount(
                            getSpendableDollarsInDollarsMode({
                              store_credit: Number(customer.store_credit) || 0,
                              balance: Number(customer.balance) || 0
                            })
                          )}`}
                    </td>
                    <td style={styles.td}>
                      {canViewLoyalty ? getBalanceDisplay(customer) : '—'}
                    </td>
                    <td style={styles.td}>
                      {new Date(customer.created_at).toLocaleDateString()}
                    </td>
                    {showRegistrationActions ? (
                      <td style={styles.td} onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          style={{
                            ...styles.actionButton,
                            ...styles.viewButton,
                            opacity: !customer.customer_email || sendingRegistrationEmailTo === customer.id ? 0.6 : 1,
                            cursor:
                              !customer.customer_email || sendingRegistrationEmailTo === customer.id
                                ? 'not-allowed'
                                : 'pointer',
                          }}
                          disabled={!customer.customer_email || sendingRegistrationEmailTo === customer.id}
                          title={
                            customer.customer_email
                              ? `Email registration link to ${customer.customer_email}`
                              : 'No email on file'
                          }
                          onClick={(e) => handleSendRegistrationLink(customer, e)}
                        >
                          {sendingRegistrationEmailTo === customer.id ? 'Sending…' : 'Send form link'}
                        </button>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
            {listTotalCount > CUSTOMERS_LIST_PAGE_SIZE || listPage > 0 ? (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: TavariStyles.spacing.md,
                  marginTop: TavariStyles.spacing.md,
                  flexWrap: 'wrap'
                }}
              >
                <button
                  type="button"
                  disabled={listPage <= 0 || listLoading}
                  onClick={() => setListPage((p) => Math.max(0, p - 1))}
                  style={{
                    ...styles.actionButton,
                    ...styles.viewButton,
                    opacity: listPage <= 0 || listLoading ? 0.5 : 1,
                    cursor: listPage <= 0 || listLoading ? 'not-allowed' : 'pointer'
                  }}
                >
                  Previous
                </button>
                <span
                  style={{
                    fontSize: TavariStyles.typography.fontSize.sm,
                    color: TavariStyles.colors.gray600
                  }}
                >
                  Page {listPage + 1} of{' '}
                  {Math.max(1, Math.ceil((listTotalCount || 0) / CUSTOMERS_LIST_PAGE_SIZE) || 1)} ·{' '}
                  {listTotalCount === 1
                    ? '1 customer'
                    : `${Number(listTotalCount || 0).toLocaleString()} customers`}
                </span>
                <button
                  type="button"
                  disabled={
                    listLoading || (listPage + 1) * CUSTOMERS_LIST_PAGE_SIZE >= (listTotalCount || 0)
                  }
                  onClick={() => setListPage((p) => p + 1)}
                  style={{
                    ...styles.actionButton,
                    ...styles.viewButton,
                    opacity:
                      listLoading || (listPage + 1) * CUSTOMERS_LIST_PAGE_SIZE >= (listTotalCount || 0)
                        ? 0.5
                        : 1,
                    cursor:
                      listLoading || (listPage + 1) * CUSTOMERS_LIST_PAGE_SIZE >= (listTotalCount || 0)
                        ? 'not-allowed'
                        : 'pointer'
                  }}
                >
                  Next
                </button>
              </div>
            ) : null}
          </div>
        )}

        {renderCustomerProfileModal()}

        {/* Create/Edit Customer Modal */}
        {(showCreateModal || showEditModal) && (
          <div style={styles.modal}>
            <div style={styles.modalContent}>
              <div style={styles.modalHeader}>
                <h3>{selectedCustomer ? 'Edit Customer' : 'Create New Customer'}</h3>
                <button onClick={handleCloseModal} style={{ background: 'none', border: 'none', fontSize: '19px', cursor: 'pointer' }}>×</button>
              </div>
              
              <div style={styles.modalBody}>
                <form onSubmit={handleSubmit} style={styles.form}>
                  <div style={styles.formGroup}>
                    <label style={styles.label}>Customer Name *</label>
                    <input
                      type="text"
                      value={formData.customer_name}
                      onChange={(e) => setFormData({ ...formData, customer_name: e.target.value })}
                      style={styles.input}
                      required
                    />
                  </div>
                  
                  <div style={styles.formGroup}>
                    <label style={styles.label}>Email</label>
                    <input
                      type="email"
                      value={formData.customer_email}
                      onChange={(e) => setFormData({ ...formData, customer_email: e.target.value })}
                      style={styles.input}
                    />
                  </div>
                  
                  <div style={styles.formGroup}>
                    <label style={styles.label}>Phone</label>
                    <input
                      type="tel"
                      value={formData.customer_phone}
                      onChange={(e) => setFormData({ ...formData, customer_phone: e.target.value })}
                      style={styles.input}
                    />
                  </div>
                  
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: TavariStyles.spacing.lg }}>
                    <div style={styles.formGroup}>
                      <label style={styles.label}>Balance ($)</label>
                      <input
                        type="number"
                        step="0.01"
                        value={formData.balance}
                        onChange={(e) => setFormData({ ...formData, balance: e.target.value })}
                        style={styles.input}
                      />
                    </div>
                    
                    <div style={styles.formGroup}>
                      <label style={styles.label}>Points</label>
                      <input
                        type="number"
                        value={formData.points}
                        onChange={(e) => setFormData({ ...formData, points: e.target.value })}
                        style={styles.input}
                      />
                    </div>
                  </div>
                  
                  <div style={styles.formGroup}>
                    <label style={styles.label}>Notes</label>
                    <textarea
                      value={formData.notes}
                      onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                      style={{ ...styles.input, minHeight: '80px', resize: 'vertical' }}
                      rows={3}
                    />
                  </div>
                  <div style={styles.formGroup}>
                    <label style={styles.label}>Name card style</label>
                    <select
                      value={formData.account_card_style}
                      onChange={(e) => {
                        const v = e.target.value;
                        setFormData((fd) => ({
                          ...fd,
                          account_card_style: v,
                          restrict_check_in: v === 'banned' ? true : fd.restrict_check_in
                        }));
                      }}
                      style={styles.input}
                    >
                      {ACCOUNT_CARD_STYLE_OPTIONS.map((opt) => (
                        <option key={opt.id} value={opt.id}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div style={{ marginBottom: TavariStyles.spacing.md }}>
                    <TavariCheckbox
                      checked={!!formData.restrict_check_in}
                      onChange={(checked) => {
                        setFormData((fd) => ({
                          ...fd,
                          restrict_check_in: checked,
                          account_card_style:
                            !checked && fd.account_card_style === 'banned' ? 'danger' : fd.account_card_style
                        }));
                      }}
                      label="Block waiver check-in (linked waivers only)"
                    />
                  </div>
                </form>
              </div>
              
              <div style={styles.modalFooter}>
                <button onClick={handleCloseModal} style={{ ...styles.actionButton, ...styles.editButton }}>
                  Cancel
                </button>
                <button onClick={handleSubmit} style={styles.createButton}>
                  {selectedCustomer ? 'Update Customer' : 'Create Customer'}
                </button>
              </div>
            </div>
          </div>
        )}

      </div>
    </POSAuthWrapper>
  );
};

export default POSCustomersScreen;