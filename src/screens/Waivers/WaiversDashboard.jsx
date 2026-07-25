// EmployeeWaiversDashboard.jsx
// Main dashboard for waivers module - Restructured to match HR Dashboard layout
// Layout: Buttons row → Action cards → Search/filters → Recent waivers
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { FiSearch, FiAlertCircle, FiCheckCircle, FiFilter, FiRefreshCw, FiX, FiShoppingCart } from 'react-icons/fi';
import { TavariStyles } from '../../utils/TavariStyles';
import POSAuthWrapper from '../../components/Auth/POSAuthWrapper';
import { SecurityWrapper } from '../../Security';
import { usePOSAuth } from '../../hooks/usePOSAuth';
import { useSecurityContext } from '../../Security/useSecurityContext';
import { usePermissions } from '../../hooks/usePermissions';
import { useWaiversShellStyle } from '../../contexts/WaiversShellContext';
import { useWaivers } from '../../hooks/useWaivers';
import WaiverAnalyticsService from '../../services/Waivers/WaiverAnalyticsService';
import {
  fetchTodayWaiverAndBookingCheckIns,
  recordWaiverParticipantCheckIn,
  deleteTodayWaiverCheckInForParticipant,
  resolveTodayCheckInRecord
} from '../../services/Waivers/WaiverCheckInService';
import bookingService from '../../services/Bookings/BookingService';
import WaiverSettingsService from '../../services/Waivers/WaiverSettingsService';
import toast from 'react-hot-toast';
import { calculateAgeFromIsoDateOfBirth } from '../../utils/waiverDateOfBirth';
import { supabase } from '../../supabaseClient';
import {
  isWaiverAdditionalAdultParticipant,
  isWaiverMinorParticipant
} from '../../utils/waiverParticipantClassification';
import TavariCheckbox from '../../components/UI/TavariCheckbox';
import WaiverDataDiagnostics from '../../components/Waivers/WaiverDataDiagnostics';
import { normalizeDashboardWaiverId } from '../../constants/legacyWaiver';
import {
  buildPosCartLinesFromAssignments,
  loadAdmissionInventoryForPos,
  loadFreeWithPurchasePromotions,
  loadLoyaltyAccountForPos,
  resolveLoyaltyCandidatesForPosParty,
  resolveLoyaltyCustomerFromSelectedPeople,
  resolvePosPersonFromWaiverCheckbox,
} from '../../helpers/Waivers/waiverToPosCart';

const EXPIRING_SOON_DAYS = 30;
const DISPLAY_FALLBACK_EXPIRY_DAYS = 365;
const WAIVER_NOTE_ALERT_STYLE = 'info';
/** Overview list: last N by signing or check-in; staff use search for older waivers. */
const WAIVER_OVERVIEW_DISPLAY_CAP = 50;
/** Wait for typing pause before server search (avoids freeze on each keystroke). */
const SEARCH_DEBOUNCE_MS = 600;
/** Who name search applies to — phone/email always search everyone. */
const SEARCH_PERSON_SCOPE = {
  ALL: 'all',
  ADULTS: 'adults',
  MINORS: 'minors'
};

/** Stable key for POS multi-waiver selection (separate from today's check-in). */
const makePosSelectKey = (waiverId, waiverParticipantId, subjectType) => {
  const pid =
    waiverParticipantId != null && String(waiverParticipantId).trim() !== ''
      ? String(waiverParticipantId)
      : 'primary';
  return `${waiverId}|${subjectType || 'unknown'}|${pid}`;
};

/** Phone/email (and digit-only ID lookups) ignore adults/minors scope — same as today. */
function isContactInfoSearch(rawSearch) {
  const q = String(rawSearch || '').trim();
  if (!q) return false;
  if (q.includes('@')) return true;
  const digits = q.replace(/\D/g, '');
  if (digits.length >= 3) {
    const compact = q.replace(/[\s\-().+]/g, '');
    if (/^\d+$/.test(compact)) return true;
  }
  return false;
}

function isLegacyMinorPlaceholderParticipant(p) {
  return Boolean(p?._legacyCountOnly || p?._legacyPlaceholder);
}

function parsePositiveExpiryDays(raw) {
  if (raw == null || raw === '') return null;
  const n = typeof raw === 'number' ? raw : parseInt(String(raw).trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Age from DOB — calendar date only; never UTC-parse YYYY-MM-DD. */
function calculateAgeFromDob(dateOfBirth) {
  if (dateOfBirth == null || dateOfBirth === '') return null;
  if (dateOfBirth instanceof Date) {
    if (Number.isNaN(dateOfBirth.getTime())) return null;
    const today = new Date();
    let age = today.getFullYear() - dateOfBirth.getFullYear();
    const monthDiff = today.getMonth() - dateOfBirth.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dateOfBirth.getDate())) age -= 1;
    return age;
  }
  if (typeof dateOfBirth === 'string') {
    const fromIso = calculateAgeFromIsoDateOfBirth(dateOfBirth);
    if (fromIso !== null) return fromIso;
    const d = new Date(dateOfBirth);
    if (Number.isNaN(d.getTime())) return null;
    const today = new Date();
    let age = today.getFullYear() - d.getFullYear();
    const monthDiff = today.getMonth() - d.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < d.getDate())) age -= 1;
    return age;
  }
  return null;
}

/** Minors on the same waiver (not the guardian row). Matches customer existing-waiver view + DOB fallback for legacy rows. */
function getMinorParticipants(waiver) {
  const parts = waiver?.waiver_participants;
  if (!Array.isArray(parts)) return [];
  const threshold =
    waiver?.waiver_templates?.minor_age_threshold ??
    waiver?.minor_age_threshold ??
    18;
  return parts.filter((p) => isWaiverMinorParticipant(p, threshold));
}

/**
 * Wallkids `waivers` / `legacy_waivers` often have only `num_minors` — not each child's name/DOB in DB
 * (verified: e.g. `info` = "info", `notes` = {"accepted":"yes"}). Show one line, not phony "Minor 1/2/3" names.
 */
function formatDashboardMinorNameAndAge(m) {
  if (m?._legacyCountOnly && typeof m._legacyMinorCount === 'number') {
    const n = m._legacyMinorCount;
    return {
      displayName: `${n} minor${n === 1 ? '' : 's'} — names/DOB not in legacy file`,
      ageText: 'not in export',
      checkInLabel: `Legacy: ${n} minor${n === 1 ? '' : 's'}`
    };
  }
  const age = calculateAgeFromDob(m.date_of_birth);
  const name = [m.first_name, m.last_name].filter(Boolean).join(' ') || '—';
  const ageText = age !== null && age >= 0 ? `${age} yrs` : 'Age —';
  const checkInLabel = [m.first_name, m.last_name].filter(Boolean).join(' ') || 'Minor';
  return { displayName: name, ageText, checkInLabel };
}

function formatDashboardAdultNameAndAge(person, fallbackName = 'Adult') {
  const name =
    [person?.first_name, person?.last_name].filter(Boolean).join(' ') ||
    fallbackName ||
    'Adult';
  const age = calculateAgeFromDob(person?.date_of_birth);
  const ageText = age !== null && age >= 0 ? `${age} yrs` : 'Age —';
  return { displayName: name, ageText };
}

/** Primary participant row when stored in waiver_participants (optional). */
function getPrimaryParticipant(waiver) {
  const parts = waiver?.waiver_participants;
  if (!Array.isArray(parts)) return null;
  return parts.find((p) => String(p.participant_type || '').toLowerCase() === 'primary') || null;
}

function primarySignerDisplayName(waiver) {
  return [waiver?.first_name, waiver?.last_name].filter(Boolean).join(' ') || 'Primary signer';
}

/** Additional adults on the waiver (each gets its own dashboard row for check-in). */
function getAdditionalAdultParticipants(waiver) {
  const parts = waiver?.waiver_participants;
  if (!Array.isArray(parts)) return [];
  return parts.filter((p) => isWaiverAdditionalAdultParticipant(p));
}

/** One row per primary signer + one row per additional adult (same waiver id, own card). */
function buildWaiverDashboardRows(waivers) {
  const rows = [];
  for (const waiver of waivers) {
    if (!waiver?.id) continue;
    rows.push({ rowKey: `${waiver.id}-primary`, kind: 'primary', waiver });
    getAdditionalAdultParticipants(waiver).forEach((p, aaIdx) => {
      rows.push({
        rowKey: `${waiver.id}-aa-${p.id != null ? p.id : `idx${aaIdx}`}`,
        kind: 'additional_adult',
        waiver,
        participant: p
      });
    });
  }
  return rows;
}

function getEffectiveWaiverExpiryDate(waiver, defaultExpiryDays) {
  if (waiver?.expires_at) {
    const expiryDate = new Date(waiver.expires_at);
    if (!Number.isNaN(expiryDate.getTime())) return expiryDate;
  }

  if (!waiver?.signed_at) return null;

  const signedDate = new Date(waiver.signed_at);
  if (Number.isNaN(signedDate.getTime())) return null;

  const fromSettings = parsePositiveExpiryDays(defaultExpiryDays);
  const fromTemplate = parsePositiveExpiryDays(waiver?.waiver_templates?.expiry_days);
  // Always use a last-resort so expiring / expired are correct before global settings load (avoids
  // everything looking “valid” and hiding “expiring” until useEffect finishes).
  const expiryDays =
    fromSettings || fromTemplate || DISPLAY_FALLBACK_EXPIRY_DAYS;

  if (!expiryDays) return null;

  return new Date(signedDate.getTime() + expiryDays * 24 * 60 * 60 * 1000);
}

function getWaiverExpiryState(waiver, defaultExpiryDays) {
  // DB may leave is_valid null; only treat explicit false as invalid.
  if (waiver && waiver.is_valid === false) return 'expired';

  const expiryDate = getEffectiveWaiverExpiryDate(waiver, defaultExpiryDays);
  if (!expiryDate) return 'valid';

  const now = new Date();
  if (expiryDate <= now) return 'expired';

  const warningThreshold = new Date(
    now.getTime() + EXPIRING_SOON_DAYS * 24 * 60 * 60 * 1000
  );
  if (expiryDate <= warningThreshold) return 'expiring';

  return 'valid';
}

/** Signing / import time (modern + legacy): prefer `signed_at`, else row `created_at`). */
function waiverSignedTimestampMs(waiver) {
  if (waiver?.signed_at) {
    const t = new Date(waiver.signed_at).getTime();
    if (!Number.isNaN(t)) return t;
  }
  if (waiver?.created_at) {
    const t = new Date(waiver.created_at).getTime();
    if (!Number.isNaN(t)) return t;
  }
  return 0;
}

/** Latest `checked_in_at` for this waiver from `waiver_participant_check_ins` (+ booking merge in map loader). */
function waiverLastCheckInTimestampMs(waiver, lastCheckInAtByWaiverId) {
  if (!waiver?.id || !lastCheckInAtByWaiverId) return 0;
  const ck = lastCheckInAtByWaiverId.get(normalizeDashboardWaiverId(waiver.id));
  if (!ck) return 0;
  const t = new Date(ck).getTime();
  return Number.isNaN(t) ? 0 : t;
}

/** Overview default sort: newest of (signed time, last check-in) — same rule for modern and legacy. */
function getWaiverOverviewStaffRelevanceMs(waiver, lastCheckInAtByWaiverId) {
  const serviceActivity = waiver?.overview_activity_at
    ? new Date(waiver.overview_activity_at).getTime()
    : 0;
  return Math.max(
    Number.isNaN(serviceActivity) ? 0 : serviceActivity,
    waiverSignedTimestampMs(waiver),
    waiverLastCheckInTimestampMs(waiver, lastCheckInAtByWaiverId)
  );
}

/** Tie-break / search ordering: primary adult first name (participant row when present). */
function primaryFirstNameSortKey(waiver) {
  const p = getPrimaryParticipant(waiver);
  const fn =
    p?.first_name != null && String(p.first_name).trim() !== ''
      ? String(p.first_name).trim()
      : String(waiver?.first_name || '').trim();
  return fn.toLowerCase();
}

function primaryLastNameSortKey(waiver) {
  const p = getPrimaryParticipant(waiver);
  const ln =
    p?.last_name != null && String(p.last_name).trim() !== ''
      ? String(p.last_name).trim()
      : String(waiver?.last_name || '').trim();
  return ln.toLowerCase();
}

function comparePrimaryNameAsc(a, b) {
  const fa = primaryFirstNameSortKey(a);
  const fb = primaryFirstNameSortKey(b);
  if (fa !== fb) return fa.localeCompare(fb);
  return primaryLastNameSortKey(a).localeCompare(primaryLastNameSortKey(b));
}

const WaiversDashboard = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const showWaiverDebug = searchParams.get('debugWaivers') === '1';

  // Tavari standardized authentication
  const auth = usePOSAuth({
    requiredRoles: ['employee', 'manager', 'owner'],
    requireBusiness: true,
    componentName: 'WaiversDashboard'
  });

  // Permission system integration
  const { 
    hasPermission, 
    hasElevatedPrivileges,
    loading: permissionsLoading 
  } = usePermissions();

  const pageRootStyle = useWaiversShellStyle(styles.pageRoot);

  // Security context
  useSecurityContext({
    enableRateLimiting: true,
    enableDeviceTracking: true,
    enableInputValidation: true,
    enableAuditLogging: true,
    componentName: 'WaiversDashboard',
    sensitiveComponent: true
  });

  // Search and filter state (declared before debounced server search — `searchTerm` is used there)
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [dateFilter, setDateFilter] = useState('all');
  const [includeArchived, setIncludeArchived] = useState(false);
  const [searchPersonScope, setSearchPersonScope] = useState(SEARCH_PERSON_SCOPE.ALL);

  // Server search runs only after typing pauses (debounce) — not on every keystroke.
  const [serverSearch, setServerSearch] = useState('');
  const searchTrim = (searchTerm || '').trim();
  const searchPending = Boolean(searchTrim) && searchTrim !== serverSearch;

  useEffect(() => {
    if (!searchTrim) {
      setIncludeArchived(false);
    }
  }, [searchTrim]);

  useEffect(() => {
    if (!searchTrim) {
      setServerSearch('');
      return undefined;
    }
    const t = setTimeout(() => {
      setServerSearch(searchTrim);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [searchTrim]);

  const waiverListFilters = useMemo(() => {
    const base = includeArchived ? { includeArchived: true } : {};
    if (serverSearch) return { ...base, search: serverSearch };
    return base;
  }, [serverSearch, includeArchived]);

  const {
    waivers,
    loading: waiversLoading,
    refreshing: waiversRefreshing,
    error: waiversLoadError,
    refresh: refreshWaivers
  } = useWaivers(waiverListFilters, { businessId: auth.selectedBusinessId });

  const [stats, setStats] = useState({
    total: 0,
    archivedTotal: 0,
    allRecordsTotal: 0,
    valid: 0,
    expired: 0,
    expiringSoon: 0
  });
  const [stationDisplayNamesByTemplateId, setStationDisplayNamesByTemplateId] = useState({});
  const [defaultExpiryDays, setDefaultExpiryDays] = useState(null);
  const [lastCheckInAtByWaiverId, setLastCheckInAtByWaiverId] = useState(() => new Map());

  const handleOverviewWaiverListRefresh = useCallback(() => {
    void Promise.resolve(refreshWaivers()).catch(() => {});
  }, [refreshWaivers]);

  useEffect(() => {
    const m = new Map();
    const ts = (iso) => (iso ? new Date(iso).getTime() : 0);
    for (const w of waivers || []) {
      const id = normalizeDashboardWaiverId(w.id);
      const at = w.last_check_in_at;
      if (!id || !at) continue;
      const prev = m.get(id);
      if (!prev || ts(at) > ts(prev)) m.set(id, at);
    }
    setLastCheckInAtByWaiverId(m);
  }, [waivers]);

  // Load analytics
  useEffect(() => {
    if (auth.selectedBusinessId) {
      WaiverAnalyticsService.setBusinessId(auth.selectedBusinessId);
      loadStats();
    }
  }, [auth.selectedBusinessId]);

  useEffect(() => {
    let cancelled = false;

    const loadWaiverDisplayNames = async () => {
      if (!auth.selectedBusinessId) {
        setStationDisplayNamesByTemplateId({});
        setDefaultExpiryDays(null);
        return;
      }

      try {
        WaiverSettingsService.setBusinessId(auth.selectedBusinessId);
        const settings = await WaiverSettingsService.getGlobalSettings();
        if (cancelled) return;

        const configuredTemplates = Array.isArray(settings?.waiver_station_templates)
          ? settings.waiver_station_templates
          : [];

        const nextMap = configuredTemplates.reduce((acc, item) => {
          const templateId = String(item?.templateId || '').trim();
          const displayName = String(item?.displayName || '').trim();
          if (templateId && displayName) {
            acc[templateId] = displayName;
          }
          return acc;
        }, {});

        setStationDisplayNamesByTemplateId(nextMap);
        setDefaultExpiryDays(parsePositiveExpiryDays(settings?.default_expiry_days));
      } catch (error) {
        console.error('WaiversDashboard: Error loading waiver display names:', error);
        if (!cancelled) {
          setStationDisplayNamesByTemplateId({});
          setDefaultExpiryDays(null);
        }
      }
    };

    loadWaiverDisplayNames();

    return () => {
      cancelled = true;
    };
  }, [auth.selectedBusinessId]);

  const loadStats = async () => {
    if (!auth.selectedBusinessId) {
      console.warn('WaiversDashboard: Cannot load stats - no business ID');
      return;
    }

    try {
      const expiryStats = await WaiverAnalyticsService.getExpiryStats();
      if (expiryStats && typeof expiryStats === 'object') {
        setStats({
          total: expiryStats.total || 0,
          archivedTotal: expiryStats.archivedTotal || 0,
          allRecordsTotal: expiryStats.allRecordsTotal || expiryStats.total || 0,
          valid: expiryStats.valid || 0,
          expired: expiryStats.expired || 0,
          expiringSoon: expiryStats.expiringSoon || 0
        });
      }
    } catch (error) {
      console.error('WaiversDashboard: Error loading stats:', error);
      setStats({
        total: 0,
        archivedTotal: 0,
        allRecordsTotal: 0,
        valid: 0,
        expired: 0,
        expiringSoon: 0
      });
    }
  };

  // Permission checks
  const canViewWaivers = hasPermission('waivers.view') || hasElevatedPrivileges();
  // Filter and sort waivers
  const filteredAndSortedWaivers = useMemo(() => {
    if (searchPending) return [];
    if (!waivers || waivers.length === 0) return [];

    const fieldLo = (v) => (v == null || v === '' ? '' : String(v).toLowerCase());
    const serverBackedSearch = Boolean((serverSearch || '').trim());
    const qTrim = serverBackedSearch ? (serverSearch || '').trim() : '';
    const lastFirstSearch = (() => {
      const parts = qTrim.toLowerCase().split(/\s+/).filter(Boolean);
      if (parts.length !== 2) return null;
      const [lastName, firstInitial] = parts;
      if (!lastName || !/^[a-z]$/.test(firstInitial || '')) return null;
      return { lastName, firstInitial };
    })();
    const nameMatchesSearch = (firstName, lastName, q) => {
      const fn = fieldLo(firstName);
      const ln = fieldLo(lastName);
      return (
        fn.includes(q) ||
        ln.includes(q) ||
        `${fn} ${ln}`.trim().includes(q) ||
        `${ln} ${fn}`.trim().includes(q) ||
        (lastFirstSearch && ln.includes(lastFirstSearch.lastName) && fn.startsWith(lastFirstSearch.firstInitial))
      );
    };

    const filtered = waivers.filter((waiver) => {
      if (!waiver || !waiver.id) return false;

      const q = qTrim.toLowerCase();
      const qDigits = q.replace(/\D/g, '');
      const contactInfoSearch = Boolean(q && isContactInfoSearch(qTrim));

      const wFn = fieldLo(waiver.first_name);
      const wLn = fieldLo(waiver.last_name);
      const wEm = fieldLo(waiver.email);
      const wPh = fieldLo(waiver.phone_number);
      const wExternalDoc = fieldLo(waiver.external_document_id);
      const wPhDigits = String(waiver.phone_number || '').replace(/\D/g, '');
      const primaryPhoneDigitMatch = qDigits.length >= 3 && wPhDigits.includes(qDigits);
      const legIdStr =
        waiver.legacy_row_id != null && waiver.legacy_row_id !== '' ? String(waiver.legacy_row_id) : '';
      const legIdDigitMatch = qDigits.length >= 2 && legIdStr.replace(/\D/g, '').includes(qDigits);

      const primaryNameMatch =
        Boolean(q) && (nameMatchesSearch(wFn, wLn, q) || wExternalDoc.includes(q));

      const minorMatch =
        Boolean(q) &&
        getMinorParticipants(waiver).some((p) => {
          if (isLegacyMinorPlaceholderParticipant(p)) return false;
          const fn = fieldLo(p?.first_name);
          const ln = fieldLo(p?.last_name);
          const mPh = String(p?.phone_number || '').replace(/\D/g, '');
          return (
            nameMatchesSearch(fn, ln, q) ||
            (qDigits.length >= 3 && mPh.includes(qDigits))
          );
        });

      const additionalAdultMatch =
        Boolean(q) &&
        getAdditionalAdultParticipants(waiver).some((p) => {
          const fn = fieldLo(p?.first_name);
          const ln = fieldLo(p?.last_name);
          const ph = String(p.phone_number || '').replace(/\D/g, '');
          return (
            nameMatchesSearch(fn, ln, q) ||
            (p?.email && fieldLo(p.email).includes(q)) ||
            (qDigits.length >= 3 && ph.includes(qDigits))
          );
        });

      const contactMatch =
        Boolean(q) &&
        (wEm.includes(q) || wPh.includes(q) || primaryPhoneDigitMatch || legIdDigitMatch);

      const anyParticipantOrSignerNameMatch =
        primaryNameMatch || minorMatch || additionalAdultMatch;
      const anyMatch = anyParticipantOrSignerNameMatch || contactMatch || wExternalDoc.includes(q);

      let matchesSearch = !q;
      if (q) {
        if (contactInfoSearch) {
          matchesSearch = anyMatch;
        } else if (searchPersonScope === SEARCH_PERSON_SCOPE.ALL && serverBackedSearch) {
          // Preserve existing server-trust behavior when scope is Everyone.
          matchesSearch = true;
        } else if (searchPersonScope === SEARCH_PERSON_SCOPE.ALL) {
          matchesSearch = anyMatch;
        } else if (searchPersonScope === SEARCH_PERSON_SCOPE.ADULTS) {
          matchesSearch = primaryNameMatch || additionalAdultMatch;
        } else if (searchPersonScope === SEARCH_PERSON_SCOPE.MINORS) {
          matchesSearch = minorMatch;
        } else {
          matchesSearch = anyMatch;
        }
      }

      const skipLocalStatusDateFilters =
        serverBackedSearch && includeArchived && waiver.archived_at;

      // Status filter (skip for archived rows when include-archived search — they are often "expired")
      const expiryState = getWaiverExpiryState(waiver, defaultExpiryDays);
      const matchesStatus =
        skipLocalStatusDateFilters ||
        statusFilter === 'all' ||
        (statusFilter === 'valid' && expiryState === 'valid') ||
        (statusFilter === 'expired' && expiryState === 'expired') ||
        (statusFilter === 'expiring' && expiryState === 'expiring');

      // Date filter follows the same "overview activity" timestamp as sorting:
      // latest of signed date/time and checked-in date/time.
      let matchesDate = skipLocalStatusDateFilters || dateFilter === 'all';
      const activityMs = getWaiverOverviewStaffRelevanceMs(waiver, lastCheckInAtByWaiverId);
      if (!skipLocalStatusDateFilters && dateFilter === 'today' && activityMs > 0) {
        const signedDate = new Date(activityMs);
        const today = new Date();
        matchesDate = signedDate.toDateString() === today.toDateString();
      } else if (!skipLocalStatusDateFilters && dateFilter === 'week' && activityMs > 0) {
        const signedDate = new Date(activityMs);
        const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        matchesDate = signedDate >= weekAgo;
      } else if (dateFilter === 'month' && activityMs > 0) {
        const signedDate = new Date(activityMs);
        const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        matchesDate = signedDate >= monthAgo;
      } else if (dateFilter !== 'all' && activityMs <= 0) {
        matchesDate = true;
      }

      return matchesSearch && matchesStatus && matchesDate;
    });

    return filtered.sort((a, b) => {
      const relA = getWaiverOverviewStaffRelevanceMs(a, lastCheckInAtByWaiverId);
      const relB = getWaiverOverviewStaffRelevanceMs(b, lastCheckInAtByWaiverId);
      if (relA !== relB) return relB - relA;
      return comparePrimaryNameAsc(a, b);
    });
  }, [waivers, serverSearch, searchPending, includeArchived, statusFilter, dateFilter, defaultExpiryDays, lastCheckInAtByWaiverId, searchPersonScope]);

  const hasActiveSearch = Boolean((serverSearch || '').trim());
  const waiverListDisplayCap = WAIVER_OVERVIEW_DISPLAY_CAP;

  const displayedWaiverIds = useMemo(() => {
    if (!filteredAndSortedWaivers?.length) return [];
    return [
      ...new Set(filteredAndSortedWaivers.slice(0, waiverListDisplayCap).map((w) => w.id))
    ];
  }, [filteredAndSortedWaivers, waiverListDisplayCap]);

  const [checkInsToday, setCheckInsToday] = useState(() => new Map());
  const [checkInSubmittingKey, setCheckInSubmittingKey] = useState(null);
  const [customerRestrictionsByWaiverId, setCustomerRestrictionsByWaiverId] = useState(() => new Map());
  const [blockedCheckInModal, setBlockedCheckInModal] = useState(null);
  /** First POS tap arms selection; checkboxes then store people here; second POS tap sends to cart. */
  const [posSelectMode, setPosSelectMode] = useState(false);
  const [posSelectedPeopleByKey, setPosSelectedPeopleByKey] = useState(() => new Map());
  const [posSending, setPosSending] = useState(false);
  /** First tap expands signed/expiry under the name; second tap opens waiver detail. */
  const [expandedWaiverRowKey, setExpandedWaiverRowKey] = useState(null);

  const displayedWaivers = useMemo(
    () => filteredAndSortedWaivers.slice(0, waiverListDisplayCap),
    [filteredAndSortedWaivers, waiverListDisplayCap]
  );

  const normalizePhoneDigits = (value) => String(value || '').replace(/\D/g, '');

  const isCheckInRestrictionActive = (restriction) =>
    restriction?.restrict_check_in === true || restriction?.account_card_style === 'banned';

  const isWaiverNoteAlertActive = (record) =>
    record?.account_card_style === WAIVER_NOTE_ALERT_STYLE && Boolean(String(record?.notes || '').trim());

  const isNoticeBlocked = (notice) =>
    Boolean(notice) &&
    (notice.isBlocked === true ||
      (notice.isBlocked !== false && isCheckInRestrictionActive(notice)));

  const participantNoticeFromRow = (participant, fallbackName) => {
    if (!isCheckInRestrictionActive(participant) && !isWaiverNoteAlertActive(participant)) return null;
    const isBlocked = isCheckInRestrictionActive(participant);
    return {
      ...participant,
      isBlocked,
      isAlertOnly: !isBlocked,
      customer_name:
        [participant?.first_name, participant?.last_name].filter(Boolean).join(' ') ||
        fallbackName ||
        'This participant',
      customer_email: participant?.email || '',
      customer_phone: participant?.phone_number || '',
      notes:
        participant?.notes ||
        (isBlocked
          ? 'This participant is marked as blocked for waiver check-in.'
          : 'This participant has an account note.')
    };
  };

  const getCustomerRestrictionForWaiver = useCallback(
    (waiver) => customerRestrictionsByWaiverId.get(waiver?.id) || null,
    [customerRestrictionsByWaiverId]
  );

  const getCheckInRestrictionForSubject = useCallback(
    (waiver, waiverParticipantId, fallbackName) => {
      const participantRows = Array.isArray(waiver?.waiver_participants)
        ? waiver.waiver_participants
        : [];
      if (waiverParticipantId) {
        const participant = participantRows.find((p) => String(p.id) === String(waiverParticipantId));
        return (
          participantNoticeFromRow(participant, fallbackName) ||
          getCustomerRestrictionForWaiver(waiver)
        );
      }

      const primaryParticipant = getPrimaryParticipant(waiver);
      return (
        participantNoticeFromRow(primaryParticipant, fallbackName) ||
        getCustomerRestrictionForWaiver(waiver)
      );
    },
    [getCustomerRestrictionForWaiver]
  );

  const showBlockedCheckInModal = useCallback((restriction, displayName) => {
    setBlockedCheckInModal({
      customerName: restriction?.customer_name || displayName || 'This person',
      reason:
        restriction?.notes ||
        'This person is marked as blocked for waiver check-in.',
      customerEmail: restriction?.customer_email || '',
      customerPhone: restriction?.customer_phone || ''
    });
  }, []);

  const loadCheckIns = useCallback(
    async (extraWaiverIds = []) => {
      const bid = auth.selectedBusinessId;
      const extra = (extraWaiverIds || [])
        .map((id) => normalizeDashboardWaiverId(id))
        .filter(Boolean);
      const merged = [...new Set([...(displayedWaiverIds || []), ...extra])];
      if (!bid || merged.length === 0) {
        setCheckInsToday(new Map());
        return;
      }
      try {
        const m = await fetchTodayWaiverAndBookingCheckIns(bid, merged);
        setCheckInsToday(m);
      } catch (err) {
        console.error('WaiversDashboard: check-ins load failed', err);
      }
    },
    [auth.selectedBusinessId, displayedWaiverIds]
  );

  useEffect(() => {
    loadCheckIns();
  }, [loadCheckIns]);

  useEffect(() => {
    let cancelled = false;

    const loadCustomerRestrictions = async () => {
      const bid = auth.selectedBusinessId;
      if (!bid || displayedWaivers.length === 0) {
        setCustomerRestrictionsByWaiverId(new Map());
        return;
      }

      const customerIds = [
        ...new Set(displayedWaivers.map((w) => w.customer_id).filter(Boolean))
      ];
      const emails = [
        ...new Set(
          displayedWaivers
            .map((w) => String(w.email || '').trim().toLowerCase())
            .filter(Boolean)
        )
      ];
      const phoneSuffixes = [
        ...new Set(
          displayedWaivers
            .map((w) => normalizePhoneDigits(w.phone_number).slice(-7))
            .filter((digits) => digits.length >= 7)
        )
      ];

      try {
        const queries = [];
        const selectCols = 'id, customer_name, customer_email, customer_phone, notes, account_card_style, restrict_check_in';

        if (customerIds.length > 0) {
          queries.push(
            supabase
              .from('pos_loyalty_accounts')
              .select(selectCols)
              .eq('business_id', bid)
              .in('id', customerIds)
          );
        }

        if (emails.length > 0) {
          queries.push(
            supabase
              .from('pos_loyalty_accounts')
              .select(selectCols)
              .eq('business_id', bid)
              .in('customer_email', emails)
          );
        }

        if (phoneSuffixes.length > 0) {
          queries.push(
            supabase
              .from('pos_loyalty_accounts')
              .select(selectCols)
              .eq('business_id', bid)
              .or(phoneSuffixes.slice(0, 25).map((digits) => `customer_phone.ilike.%${digits}%`).join(','))
              .limit(200)
          );
        }

        if (queries.length === 0) {
          if (!cancelled) setCustomerRestrictionsByWaiverId(new Map());
          return;
        }

        const results = await Promise.all(queries);
        const customers = results.flatMap((result) => (result.error ? [] : result.data || []));
        const byId = new Map();
        const byEmail = new Map();
        const byPhone = new Map();

        customers.forEach((customer) => {
          if (!customer) return;
          if (customer.id) byId.set(customer.id, customer);
          const email = String(customer.customer_email || '').trim().toLowerCase();
          if (email) byEmail.set(email, customer);
          const phone = normalizePhoneDigits(customer.customer_phone);
          if (phone) byPhone.set(phone, customer);
        });

        const next = new Map();
        displayedWaivers.forEach((waiver) => {
          const waiverPhone = normalizePhoneDigits(waiver.phone_number);
          const customer =
            (waiver.customer_id && byId.get(waiver.customer_id)) ||
            byEmail.get(String(waiver.email || '').trim().toLowerCase()) ||
            byPhone.get(waiverPhone) ||
            customers.find((candidate) => {
              const candidatePhone = normalizePhoneDigits(candidate?.customer_phone);
              return (
                waiverPhone &&
                candidatePhone &&
                waiverPhone.slice(-7) === candidatePhone.slice(-7)
              );
            });

          if (customer) {
            const isBlocked =
              customer.restrict_check_in === true || customer.account_card_style === 'banned';
            const isAlertOnly = !isBlocked && isWaiverNoteAlertActive(customer);
            if (isBlocked || isAlertOnly) {
              next.set(waiver.id, {
                ...customer,
                isBlocked,
                isAlertOnly
              });
            }
          }
        });

        if (!cancelled) setCustomerRestrictionsByWaiverId(next);
      } catch (err) {
        console.error('WaiversDashboard: customer restrictions load failed', err);
        if (!cancelled) setCustomerRestrictionsByWaiverId(new Map());
      }
    };

    loadCustomerRestrictions();
    return () => {
      cancelled = true;
    };
  }, [auth.selectedBusinessId, displayedWaivers]);

  const handleCheckInToggle = useCallback(
    async (waiverId, { waiverParticipantId, subjectType, displayName }, next) => {
      const bid = auth.selectedBusinessId;
      if (!bid) {
        toast.error('No business selected');
        return;
      }
      const waiver = (waivers || []).find(
        (w) => normalizeDashboardWaiverId(w.id) === normalizeDashboardWaiverId(waiverId)
      );
      if (next && waiver) {
        const restriction = getCheckInRestrictionForSubject(waiver, waiverParticipantId, displayName);
        if (isNoticeBlocked(restriction)) {
          showBlockedCheckInModal(restriction, displayName);
          return;
        }
      }
      if (next && waiver) {
        const expiryState = getWaiverExpiryState(waiver, defaultExpiryDays);
        if (expiryState === 'expired') {
          toast.error('This waiver has expired. Check-in is not allowed.');
          return;
        }
      }
      const { rec, mapKeysToInvalidate } = resolveTodayCheckInRecord(
        checkInsToday,
        waiverId,
        waiverParticipantId,
        subjectType
      );
      const sk = `${waiverId}:${waiverParticipantId || 'primary'}`;
      setCheckInSubmittingKey(sk);
      try {
        if (next) {
          if (!rec) {
            const checkInResult = await recordWaiverParticipantCheckIn({
              businessId: bid,
              waiverId,
              waiverParticipantId,
              subjectType,
              displayName
            });
            const checkedAt = checkInResult?.checked_in_at;
            if (checkedAt) {
              const wid = normalizeDashboardWaiverId(waiverId);
              setLastCheckInAtByWaiverId((prev) => {
                const nextMap = new Map(prev);
                const prevAt = nextMap.get(wid);
                const tsIso = (iso) => (iso ? new Date(iso).getTime() : 0);
                if (!prevAt || tsIso(checkedAt) >= tsIso(prevAt)) {
                  nextMap.set(wid, checkedAt);
                }
                return nextMap;
              });
            }
            toast.success('Checked in');
            const hint = checkInResult?.reviewEmailHint;
            if (hint?.text) {
              if (hint.level === 'error') {
                toast.error(hint.text, { duration: 9000 });
              } else {
                toast(hint.text, { duration: 9000 });
              }
            }
          }
        } else {
          // Clear: today's waiver check-in row(s) and any booking-module participant check-ins for this person.
          await deleteTodayWaiverCheckInForParticipant(
            bid,
            waiverId,
            waiverParticipantId,
            subjectType
          );
          bookingService.setBusinessId(bid);
          for (const c of rec?.bookingClears || []) {
            if (c?.participantId && c?.bookingId) {
              await bookingService.clearParticipantCheckIn(c.participantId, c.bookingId, bid);
            }
          }
          setCheckInsToday((prev) => {
            const m = new Map(prev);
            for (const k of mapKeysToInvalidate) {
              m.delete(k);
            }
            return m;
          });
          if (rec) {
            toast.success('Check-in cleared');
          }
        }
        await loadCheckIns([waiverId]);
        await refreshWaivers();
      } catch (err) {
        console.error('WaiversDashboard: check-in toggle failed', err);
        toast.error(err?.message || 'Update failed');
      } finally {
        setCheckInSubmittingKey(null);
      }
    },
    [
      auth.selectedBusinessId,
      checkInsToday,
      loadCheckIns,
      refreshWaivers,
      waivers,
      defaultExpiryDays,
      getCheckInRestrictionForSubject,
      showBlockedCheckInModal
    ]
  );

  const togglePosPersonSelection = useCallback(
    (waiver, waiverParticipantId, subjectType, next) => {
      if (!waiver?.id) return;
      const key = makePosSelectKey(waiver.id, waiverParticipantId, subjectType);
      setPosSelectedPeopleByKey((prev) => {
        const nextMap = new Map(prev);
        if (!next) {
          nextMap.delete(key);
          return nextMap;
        }
        const person = resolvePosPersonFromWaiverCheckbox(
          waiver,
          waiverParticipantId,
          subjectType,
        );
        if (!person) return nextMap;
        nextMap.set(key, person);
        return nextMap;
      });
    },
    [],
  );

  const handlePosToolbarClick = useCallback(async () => {
    if (posSending) return;

    if (!posSelectMode) {
      setPosSelectMode(true);
      setPosSelectedPeopleByKey(new Map());
      return;
    }

    if (posSelectedPeopleByKey.size === 0) {
      setPosSelectMode(false);
      setPosSelectedPeopleByKey(new Map());
      return;
    }

    const bid = auth.selectedBusinessId;
    if (!bid) {
      toast.error('No business selected.');
      return;
    }

    setPosSending(true);
    try {
      const selectedPeople = [...posSelectedPeopleByKey.values()];

      if (selectedPeople.length === 0) {
        toast.error('Could not resolve the selected people on these waivers.');
        return;
      }

      const promotions = await loadFreeWithPurchasePromotions(bid);
      const inventoryItems = await loadAdmissionInventoryForPos(bid, promotions);
      const preview = buildPosCartLinesFromAssignments({
        people: selectedPeople,
        inventoryItems,
        promotions,
      });

      if (!preview.ok) {
        toast.error(preview.message || 'Could not build POS cart');
        return;
      }

      const focusWaiver =
        (displayedWaivers || []).find((w) => w.id === selectedPeople[0]?.waiver_id) || null;
      const resolvedCustomer = resolveLoyaltyCustomerFromSelectedPeople(
        selectedPeople,
        focusWaiver,
      );
      const selectedWaiverIds = new Set(
        selectedPeople.map((p) => p.waiver_id).filter(Boolean),
      );
      const partyWaivers = (displayedWaivers || []).filter((w) =>
        selectedWaiverIds.has(w.id),
      );
      const loyaltyCandidates = await resolveLoyaltyCandidatesForPosParty({
        selectedPeople,
        waivers: partyWaivers,
        businessId: bid,
      });
      let customer = resolvedCustomer;
      if (resolvedCustomer?.id) {
        const full = await loadLoyaltyAccountForPos(bid, resolvedCustomer.id);
        if (full) customer = full;
      } else if (loyaltyCandidates.length > 0) {
        customer = loyaltyCandidates[0];
      }

      setPosSelectMode(false);
      setPosSelectedPeopleByKey(new Map());
      navigate('/dashboard/pos/register', {
        state: {
          resumeCart: {
            items: preview.cartItems,
            customer,
            loyaltyCandidates,
            silent: true,
          },
        },
      });
    } catch (error) {
      console.error('[WaiversDashboard] send to POS failed:', error);
      toast.error(error?.message || 'Could not send to POS');
    } finally {
      setPosSending(false);
    }
  }, [
    posSending,
    posSelectMode,
    posSelectedPeopleByKey,
    auth.selectedBusinessId,
    displayedWaivers,
    navigate,
  ]);

  if (auth.authLoading || permissionsLoading) {
    return (
      <POSAuthWrapper componentName="WaiversDashboard">
        <div style={TavariStyles.loadingContainer}>
          <p>Loading...</p>
        </div>
      </POSAuthWrapper>
    );
  }

  if (!canViewWaivers) {
    return (
      <POSAuthWrapper componentName="WaiversDashboard">
        <div style={TavariStyles.errorContainer}>
          <FiAlertCircle size={48} style={{ color: TavariStyles.colors.error, marginBottom: TavariStyles.spacing.md }} />
          <h2>Access Denied</h2>
          <p>You do not have permission to view waivers.</p>
        </div>
      </POSAuthWrapper>
    );
  }

  const handleNavigation = (path) => {
    try {
      navigate(path);
    } catch (error) {
      console.error('WaiversDashboard: Navigation error:', error);
      toast.error('Navigation failed. Please try again.');
    }
  };

  const handleWaiverRowCardClick = (rowKey, waiverId) => {
    if (expandedWaiverRowKey === rowKey) {
      setExpandedWaiverRowKey(null);
      handleNavigation(`/dashboard/waivers/${waiverId}`);
    } else {
      setExpandedWaiverRowKey(rowKey);
    }
  };

  const formatWaiverDate = (date) =>
    date.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });

  const getWaiverExpiryDisplay = (waiver) => {
    const effectiveExpiryDate = getEffectiveWaiverExpiryDate(waiver, defaultExpiryDays);

    if (!effectiveExpiryDate) {
      return {
        primary: 'No expiry date',
        secondary: 'No expiry rule found'
      };
    }

    const daysUntilExpiry = Math.ceil((effectiveExpiryDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    if (daysUntilExpiry <= 0) {
      return {
        primary: formatWaiverDate(effectiveExpiryDate),
        secondary: 'Expired'
      };
    }

    if (daysUntilExpiry <= EXPIRING_SOON_DAYS) {
      return {
        primary: formatWaiverDate(effectiveExpiryDate),
        secondary: `${daysUntilExpiry} day${daysUntilExpiry === 1 ? '' : 's'} left`
      };
    }

    return {
      primary: formatWaiverDate(effectiveExpiryDate),
      secondary: 'Active'
    };
  };

  const renderWaiverSignedExpanded = (waiver) => (
    <div style={styles.waiverCardDates}>
      <p style={styles.waiverCardSignedLine}>
        {waiver.signed_at
          ? `Signed ${formatWaiverDate(new Date(waiver.signed_at))}`
          : 'Not signed'}
      </p>
      <p style={styles.waiverCardTapHint}>Tap again to open full waiver</p>
    </div>
  );

  const formatCheckInTime = (iso) =>
    new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

  const renderWaiverNoticeBadge = (notice) => {
    if (!notice) return null;
    const blocked = isNoticeBlocked(notice);
    return (
      <div style={blocked ? styles.waiverBlockedBadge : styles.waiverNoteAlertBadge}>
        {blocked ? 'Check-in blocked' : 'Alert'}: {notice.notes || (blocked ? 'This person is blocked' : 'See account note')}
      </div>
    );
  };

  const getWaiverDisplayName = (waiver) => {
    const template = waiver?.waiver_templates;
    const configuredDisplayName = template?.id
      ? stationDisplayNamesByTemplateId[String(template.id)]
      : '';

    const base =
      configuredDisplayName ||
      template?.waiver_title ||
      template?.template_name ||
      'Waiver';
    if (waiver?._dataSource === 'legacy') {
      return `${base} (legacy import)`;
    }
    return base;
  };

  /** Same TavariCheckbox as other modules (custom box + ✓). In POS mode: selects for cart only. */
  const renderCheckCell = (
    waiver,
    waiverParticipantId,
    subjectType,
    displayName,
    ariaLabel,
    expiryState,
    _checkInBlockedLegacy,
    customerRestriction = null
  ) => {
    const waiverId = waiver?.id;
    const { rec } = resolveTodayCheckInRecord(checkInsToday, waiverId, waiverParticipantId, subjectType);
    const sk = `${waiverId}:${waiverParticipantId || 'primary'}`;
    const busy = checkInSubmittingKey === sk;
    const id = `waiver-checkin-${waiverId}-${waiverParticipantId || 'primary'}-${subjectType}`;
    const checkInNotAllowed = expiryState === 'expired';
    const checkInBlockedByNote = isNoticeBlocked(customerRestriction);
    const posKey = makePosSelectKey(waiverId, waiverParticipantId, subjectType);
    const posSelected = posSelectedPeopleByKey.has(posKey);

    if (posSelectMode) {
      const posTitle = checkInNotAllowed
        ? 'This waiver has expired. Tickets cannot be sent to POS.'
        : checkInBlockedByNote
          ? 'Customer is blocked. Click for details.'
          : posSelected
            ? 'Selected for POS — click to remove'
            : 'Click to add to POS cart';
      return (
        <div
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
          style={{
            ...styles.inlineCheckWrap,
            ...(posSelected ? styles.posSelectCheckWrap : {}),
          }}
          title={posTitle}
          role={checkInBlockedByNote ? 'button' : undefined}
          tabIndex={checkInBlockedByNote ? 0 : undefined}
          onClickCapture={
            checkInBlockedByNote
              ? (e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  showBlockedCheckInModal(customerRestriction, displayName);
                }
              : undefined
          }
          onKeyDownCapture={
            checkInBlockedByNote
              ? (e) => {
                  if (e.key !== 'Enter' && e.key !== ' ') return;
                  e.preventDefault();
                  e.stopPropagation();
                  showBlockedCheckInModal(customerRestriction, displayName);
                }
              : undefined
          }
        >
          <TavariCheckbox
            id={`pos-${id}`}
            name={`pos-${id}`}
            size="md"
            label=""
            aria-label={
              checkInNotAllowed
                ? 'POS selection not allowed — waiver expired'
                : checkInBlockedByNote
                  ? 'POS selection blocked for banned customer'
                  : `Select ${displayName} for POS`
            }
            checked={posSelected}
            disabled={checkInNotAllowed || checkInBlockedByNote || posSending}
            onChange={(next) =>
              togglePosPersonSelection(waiver, waiverParticipantId, subjectType, next)
            }
          />
        </div>
      );
    }

    const title = busy
      ? 'Saving…'
      : rec
        ? `Checked in today at ${formatCheckInTime(rec.checked_in_at)} — click to clear`
        : checkInBlockedByNote
          ? 'Customer is blocked from waiver check-in. Click for details.'
          : checkInNotAllowed
            ? 'This waiver has expired. Check-in is not allowed.'
            : 'Not checked in today';
    return (
      <div
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        style={styles.inlineCheckWrap}
        title={title}
        role={checkInBlockedByNote && !rec ? 'button' : undefined}
        tabIndex={checkInBlockedByNote && !rec ? 0 : undefined}
        onClickCapture={
          checkInBlockedByNote && !rec
            ? (e) => {
                e.preventDefault();
                e.stopPropagation();
                showBlockedCheckInModal(customerRestriction, displayName);
              }
            : undefined
        }
        onKeyDownCapture={
          checkInBlockedByNote && !rec
            ? (e) => {
                if (e.key !== 'Enter' && e.key !== ' ') return;
                e.preventDefault();
                e.stopPropagation();
                showBlockedCheckInModal(customerRestriction, displayName);
              }
            : undefined
        }
      >
        <TavariCheckbox
          id={id}
          name={id}
          size="md"
          label=""
          aria-label={
            checkInNotAllowed && !rec
              ? 'Check-in not allowed — waiver expired'
              : checkInBlockedByNote
                ? 'Check-in blocked for banned customer'
                : ariaLabel
          }
          checked={!!rec}
          disabled={busy || (checkInNotAllowed && !rec)}
          onChange={(next) =>
            handleCheckInToggle(waiverId, { waiverParticipantId, subjectType, displayName }, next)
          }
        />
      </div>
    );
  };

  return (
    <POSAuthWrapper componentName="WaiversDashboard">
      <SecurityWrapper componentName="WaiversDashboard" sensitiveComponent={true}>
        <div style={pageRootStyle}>
          {showWaiverDebug && (
            <WaiverDataDiagnostics
              businessId={auth.selectedBusinessId}
              hookCount={waivers.length}
              filteredCount={filteredAndSortedWaivers.length}
              loadError={waiversLoadError}
            />
          )}
          {/* Search and Filters Row */}
          <div style={styles.controls}>
            <div style={styles.searchSection}>
              <div style={styles.searchGroup}>
                <FiSearch size={20} style={styles.searchIcon} />
                <input
                  type="text"
                  placeholder="Search by name, email, or phone (searches after you pause typing)..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  style={{
                    ...styles.searchInput,
                    ...(searchTrim
                      ? {
                          padding: `${TavariStyles.spacing.md || '12px'} 44px ${TavariStyles.spacing.md || '12px'} 40px`
                        }
                      : {})
                  }}
                />
                {searchTrim ? (
                  <button
                    type="button"
                    aria-label="Clear search"
                    onClick={() => setSearchTerm('')}
                    style={styles.searchClearButton}
                  >
                    <FiX size={18} />
                  </button>
                ) : null}
              </div>

              <div style={styles.filterGroup}>
                <select
                  value={searchPersonScope}
                  onChange={(e) => setSearchPersonScope(e.target.value)}
                  style={styles.filterSelect}
                  aria-label="Search names on"
                  title="Phone and email always search everyone"
                >
                  <option value={SEARCH_PERSON_SCOPE.ALL}>Everyone</option>
                  <option value={SEARCH_PERSON_SCOPE.ADULTS}>Adults only</option>
                  <option value={SEARCH_PERSON_SCOPE.MINORS}>Minors only</option>
                </select>
              </div>

              <div style={styles.filterGroup}>
                <FiFilter size={20} style={styles.filterIcon} />
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  style={styles.filterSelect}
                >
                  <option value="all">All Status</option>
                  <option value="valid">Valid</option>
                  <option value="expired">Expired</option>
                  <option value="expiring">Expiring Soon</option>
                </select>
              </div>

              <div style={styles.filterGroup}>
                <select
                  value={dateFilter}
                  onChange={(e) => setDateFilter(e.target.value)}
                  style={styles.filterSelect}
                >
                  <option value="all">All Dates</option>
                  <option value="today">Today</option>
                  <option value="week">This Week</option>
                  <option value="month">This Month</option>
                </select>
              </div>
            </div>
            <div style={styles.includeArchivedRow}>
              <TavariCheckbox
                id="waiver-dashboard-include-archived"
                appearance="native"
                checked={includeArchived}
                disabled={!searchTrim}
                label="Include archived waivers in search (2+ years old — legacy & Tavari)"
                onChange={(checked) => {
                  if (searchTrim) setIncludeArchived(!!checked);
                }}
              />
              {!searchTrim ? (
                <span style={styles.includeArchivedHint}>Type in the search box above, then enable this.</span>
              ) : null}
            </div>
          </div>

          {/* Action Cards (Stats) */}
          <div style={styles.statsGrid}>
            <div style={styles.statCard}>
              <h3 style={styles.statTitle}>
                {includeArchived && hasActiveSearch ? 'All waivers (incl. archived)' : 'Active waivers'}
              </h3>
              <p style={{ ...styles.statValue, color: TavariStyles.colors.primary }}>
                {includeArchived && hasActiveSearch
                  ? stats.allRecordsTotal || 0
                  : stats.total || 0}
              </p>
              {!includeArchived && (stats.archivedTotal || 0) > 0 ? (
                <p style={{ margin: '6px 0 0', fontSize: TavariStyles.typography.fontSize.xs, color: TavariStyles.colors.gray500 }}>
                  + {stats.archivedTotal.toLocaleString()} archived (2+ years) — search with checkbox to find them
                </p>
              ) : null}
            </div>
            <div style={styles.statCard}>
              <h3 style={styles.statTitle}>Valid</h3>
              <p style={{ ...styles.statValue, color: TavariStyles.colors.success }}>
                {stats.valid || 0}
              </p>
            </div>
            <div style={styles.statCard}>
              <h3 style={styles.statTitle}>Expiring Soon</h3>
              <p style={{ ...styles.statValue, color: TavariStyles.colors.warning }}>
                {stats.expiringSoon || 0}
              </p>
            </div>
            <div style={styles.statCard}>
              <h3 style={styles.statTitle}>Expired</h3>
              <p style={{ ...styles.statValue, color: TavariStyles.colors.error }}>
                {stats.expired || 0}
              </p>
            </div>
            <button
              type="button"
              onClick={handlePosToolbarClick}
              disabled={posSending}
              style={{
                ...styles.overviewRefreshBtn,
                ...styles.statsRefreshButton,
                ...(posSelectMode ? styles.posModeActiveBtn : styles.partyToPosBtn),
                opacity: posSending ? 0.75 : 1,
                cursor: posSending ? 'wait' : 'pointer',
              }}
              title={
                posSelectMode
                  ? posSelectedPeopleByKey.size > 0
                    ? `Send ${posSelectedPeopleByKey.size} selected to POS cart`
                    : 'No one selected — tap to cancel POS mode'
                  : 'Tap to start selecting people for POS, then tap again to send'
              }
              aria-pressed={posSelectMode}
            >
              <FiShoppingCart size={17} aria-hidden />
              {posSending
                ? 'Sending…'
                : posSelectMode
                  ? posSelectedPeopleByKey.size > 0
                    ? `POS (${posSelectedPeopleByKey.size})`
                    : 'POS · Cancel'
                  : 'POS'}
            </button>
            <button
              type="button"
              onClick={handleOverviewWaiverListRefresh}
              disabled={waiversRefreshing || posSending}
              style={{
                ...styles.overviewRefreshBtn,
                ...styles.statsRefreshButton,
                opacity: waiversRefreshing ? 0.75 : 1,
                cursor: waiversRefreshing ? 'wait' : 'pointer'
              }}
              aria-busy={waiversRefreshing}
            >
              <FiRefreshCw size={17} aria-hidden />
              {waiversRefreshing ? 'Refreshing...' : 'Refresh list'}
            </button>
          </div>

          {posSelectMode ? (
            <div style={styles.posModeBanner} role="status">
              POS mode: check everyone coming in (any waiver), then tap <strong>POS</strong> again to
              send tickets. Tap POS with none selected to cancel.
            </div>
          ) : null}


          {/* Waivers: default sort = max(signed_at|created_at, last check-in) */}
          <div style={styles.recentSection}>
            {hasActiveSearch ? (
              <p style={styles.sectionHint}>
                <>
                  {filteredAndSortedWaivers.length} match{filteredAndSortedWaivers.length === 1 ? '' : 'es'}
                  {filteredAndSortedWaivers.length > waiverListDisplayCap
                    ? ` (showing first ${waiverListDisplayCap})`
                    : ''}
                  {searchPersonScope === SEARCH_PERSON_SCOPE.ADULTS
                    ? ' — adults only (signers & additional adults).'
                    : searchPersonScope === SEARCH_PERSON_SCOPE.MINORS
                      ? ' — minors only.'
                      : '.'}{' '}
                  Phone and email ignore the adults/minors filter. Search runs in the database. Uncheck “Include archived” for recent waivers only; check it to
                  find Smartwaiver imports and Tavari waivers archived after 2+ years. Use digits for phone.
                  {includeArchived
                    ? ' Archived waivers are included — try status “Expired” if matches look sparse.'
                    : ' Archived waivers (about 27k+ old imports) are hidden unless you check Include archived.'}
                </>
              </p>
            ) : null}
            {waiversLoadError ? (
              <p
                style={{
                  ...styles.emptyState,
                  color: TavariStyles.colors.error,
                  background: TavariStyles.colors.errorBg || '#fee2e2',
                  padding: '0.75rem 1rem',
                  borderRadius: 8
                }}
              >
                <strong>Could not load waivers.</strong> {waiversLoadError} — check the browser console (F12). Confirm
                RLS allows <code>waiver_signatures</code> and <code>legacy_waivers</code> for this business.
              </p>
            ) : null}
            {searchPending || waiversLoading ? (
              <div style={styles.loadingState}>
                <p>{searchPending ? 'Searching…' : 'Loading waivers...'}</p>
              </div>
            ) : !filteredAndSortedWaivers || filteredAndSortedWaivers.length === 0 ? (
              <div style={styles.emptyState}>
                <p style={styles.emptyStateTitle}>
                  {hasActiveSearch || statusFilter !== 'all' || dateFilter !== 'all'
                    ? 'No waivers match your search or filters'
                    : 'No signed waivers yet'}
                </p>
                <p style={styles.emptyStateHint}>
                  {hasActiveSearch || statusFilter !== 'all' || dateFilter !== 'all'
                    ? 'Try a different name, email, or phone number, or adjust your status and date filters.'
                    : includeArchived
                      ? 'When customers complete a waiver at your kiosk or signing link, they will appear here. You can also upload scanned paper waivers from the Upload tab.'
                      : 'When customers complete a waiver at your kiosk or signing link, they will appear here. If you imported older waivers, check Include archived above.'}
                </p>
              </div>
            ) : (
              <div style={styles.waiverList}>
                <div style={styles.waiverListHeader}>
                  <span style={styles.waiverListHeaderCheck}>
                    <span style={styles.waiverListHeaderCheckLine}>Check</span>
                    <span style={styles.waiverListHeaderCheckLine}>in</span>
                  </span>
                  <span>Signer</span>
                  <span style={styles.waiverListHeaderCheck}>
                    <span style={styles.waiverListHeaderCheckLine}>Check</span>
                    <span style={styles.waiverListHeaderCheckLine}>in</span>
                  </span>
                  <span>Minors</span>
                  <span style={styles.waiverListHeaderExpiry}>Expiry</span>
                  <span style={styles.waiverListHeaderValidity}>Validity</span>
                </div>
                {buildWaiverDashboardRows(filteredAndSortedWaivers.slice(0, waiverListDisplayCap)).map(
                  (row) => {
                  const waiver = row.waiver;
                  const minors = getMinorParticipants(waiver);

                  const rowSpan = Math.max(minors.length, 1);
                  const expiryState = getWaiverExpiryState(waiver, defaultExpiryDays);
                  const expiryDisplay = getWaiverExpiryDisplay(waiver);
                  const minorNotices = minors
                    .map((m) =>
                      getCheckInRestrictionForSubject(
                        waiver,
                        m.id,
                        formatDashboardMinorNameAndAge(m).checkInLabel
                      )
                    )
                    .filter(Boolean);
                  const blockedMinorCount = minorNotices.filter(isNoticeBlocked).length;
                  const alertMinorCount = minorNotices.filter((notice) => !isNoticeBlocked(notice)).length;
                  const rowPrimaryNotice = row.kind === 'primary'
                    ? getCheckInRestrictionForSubject(waiver, null, primarySignerDisplayName(waiver))
                    : getCheckInRestrictionForSubject(waiver, row.participant?.id, 'Adult');
                  const rowSubjectBlockedCount = isNoticeBlocked(rowPrimaryNotice) ? 1 : 0;
                  const rowSubjectAlertCount = rowPrimaryNotice && !isNoticeBlocked(rowPrimaryNotice) ? 1 : 0;
                  const rowBlockedCount = blockedMinorCount + rowSubjectBlockedCount;
                  const rowAlertCount = alertMinorCount + rowSubjectAlertCount;
                  const statusIcon = rowBlockedCount > 0 ? (
                    <FiAlertCircle size={24} style={{ color: TavariStyles.colors.error }} />
                  ) : rowAlertCount > 0 ? (
                    <FiAlertCircle size={24} style={{ color: '#0f766e' }} />
                  ) : expiryState === 'expired' ? (
                    <FiAlertCircle size={24} style={{ color: TavariStyles.colors.error }} />
                  ) : expiryState === 'expiring' ? (
                    <FiAlertCircle size={24} style={{ color: TavariStyles.colors.warning }} />
                  ) : (
                    <FiCheckCircle size={24} style={{ color: TavariStyles.colors.success }} />
                  );

                  if (row.kind === 'primary') {
                    const primaryPart = getPrimaryParticipant(waiver);
                    const primaryPid = primaryPart?.id ?? null;
                    const primaryName = primarySignerDisplayName(waiver);
                    const primaryDisplay = formatDashboardAdultNameAndAge(
                      primaryPart || waiver,
                      primaryName
                    );
                    const primaryRestriction = getCheckInRestrictionForSubject(waiver, primaryPid, primaryName);
                    const rowExpanded = expandedWaiverRowKey === row.rowKey;
                    return (
                      <div
                        key={row.rowKey}
                        style={{
                          ...styles.waiverCard,
                          ...(rowExpanded ? styles.waiverCardExpanded : {}),
                          ...(expiryState === 'expiring' ? styles.waiverCardExpiring : {}),
                          ...(expiryState === 'expired' ? styles.waiverCardExpired : {}),
                          ...(rowAlertCount > 0 ? styles.waiverCardNoteAlert : {}),
                          ...(rowBlockedCount > 0 ? styles.waiverCardBlocked : {})
                        }}
                        title={rowExpanded ? 'Tap again to open full waiver' : 'Tap to show signed date'}
                        onClick={() => handleWaiverRowCardClick(row.rowKey, waiver.id)}
                      >
                        <div style={styles.waiverCardGrid6}>
                          <div
                            style={{
                              ...styles.waiverCheckColSpan,
                              gridColumn: 1,
                              gridRow: `1 / span ${rowSpan}`
                            }}
                          >
                            {renderCheckCell(
                              waiver,
                              primaryPid,
                              'primary_signer',
                              primaryName,
                              `Check in primary signer ${primaryName}`,
                              expiryState,
                              waiver._dataSource === 'legacy',
                              primaryRestriction
                            )}
                          </div>
                          <div
                            style={{
                              ...styles.waiverSignerCol,
                              gridColumn: 2,
                              gridRow: `1 / span ${rowSpan}`
                            }}
                          >
                            <p style={styles.waiverRowKind}>Primary signer</p>
                            <h4 style={styles.waiverName}>
                              <span style={styles.minorNameWithAge}>
                                <span style={styles.minorNameText}>{primaryDisplay.displayName}</span>
                                <span style={styles.minorAgeText}>{primaryDisplay.ageText}</span>
                              </span>
                            </h4>
                            {rowExpanded ? renderWaiverSignedExpanded(waiver) : null}
                            {renderWaiverNoticeBadge(primaryRestriction)}
                          </div>
                          {minors.length === 0 ? (
                            <>
                              <div style={{ gridColumn: 3, gridRow: 1, ...styles.waiverCheckCol }} />
                              <div style={{ gridColumn: 4, gridRow: 1, ...styles.waiverMinorGridCell }}>
                                <span style={styles.waiverMinorsEmpty}>—</span>
                              </div>
                            </>
                          ) : (
                            minors.map((m, idx) => {
                              const { displayName, ageText, checkInLabel } = formatDashboardMinorNameAndAge(m);
                              const minorRestriction = getCheckInRestrictionForSubject(waiver, m.id, checkInLabel);
                              return (
                                <React.Fragment key={m.id != null ? String(m.id) : `minor-${idx}`}>
                                  <div
                                    style={{
                                      gridColumn: 3,
                                      gridRow: idx + 1,
                                      ...styles.waiverCheckCol
                                    }}
                                  >
                                    {renderCheckCell(
                                      waiver,
                                      m.id,
                                      'minor',
                                      checkInLabel,
                                      `Check in minor ${checkInLabel}`,
                                      expiryState,
                                      waiver._dataSource === 'legacy',
                                      minorRestriction
                                    )}
                                  </div>
                                  <div
                                    style={{
                                      gridColumn: 4,
                                      gridRow: idx + 1,
                                      ...styles.waiverMinorGridCell
                                    }}
                                  >
                                    <div style={styles.minorRow}>
                                      <span style={styles.minorNameWithAge}>
                                        <span style={styles.minorNameText}>{displayName}</span>
                                        <span style={styles.minorAgeText}>{ageText}</span>
                                      </span>
                                    </div>
                                    {renderWaiverNoticeBadge(minorRestriction)}
                                  </div>
                                </React.Fragment>
                              );
                            })
                          )}
                          <div
                            style={{
                              gridColumn: 5,
                              gridRow: `1 / span ${rowSpan}`,
                              ...styles.waiverExpiryGrid
                            }}
                          >
                            <span style={styles.waiverExpiryDate}>{expiryDisplay.primary}</span>
                            <span
                              style={{
                                ...styles.waiverExpiryMeta,
                                ...(expiryState === 'expired'
                                  ? styles.waiverExpiryMetaExpired
                                  : expiryState === 'expiring'
                                    ? styles.waiverExpiryMetaExpiring
                                    : {})
                              }}
                            >
                              {expiryDisplay.secondary}
                            </span>
                          </div>
                          <div
                            style={{
                              gridColumn: 6,
                              gridRow: `1 / span ${rowSpan}`,
                              ...styles.waiverStatusGrid
                            }}
                          >
                            <span style={styles.waiverDisplayNameInline}>
                              {getWaiverDisplayName(waiver)}
                            </span>
                            {statusIcon}
                          </div>
                        </div>
                      </div>
                    );
                  }

                  const p = row.participant;
                  const primaryName =
                    [waiver.first_name, waiver.last_name].filter(Boolean).join(' ') || '—';
                  const adultName =
                    [p.first_name, p.last_name].filter(Boolean).join(' ') || 'Adult';
                  const adultDisplay = formatDashboardAdultNameAndAge(p, adultName);
                  const adultRestriction = getCheckInRestrictionForSubject(waiver, p.id, adultName);
                  const rowExpandedAa = expandedWaiverRowKey === row.rowKey;
                  return (
                    <div
                      key={row.rowKey}
                      style={{
                        ...styles.waiverCardAdditionalAdult,
                        ...(rowExpandedAa ? styles.waiverCardExpanded : {}),
                        ...(expiryState === 'expiring'
                          ? styles.waiverCardAdditionalAdultExpiring
                          : {}),
                        ...(expiryState === 'expired'
                          ? styles.waiverCardAdditionalAdultExpired
                          : {}),
                        ...(rowAlertCount > 0 ? styles.waiverCardNoteAlert : {}),
                        ...(rowBlockedCount > 0 ? styles.waiverCardBlocked : {})
                      }}
                      title={
                        rowExpandedAa ? 'Tap again to open full waiver' : 'Tap to show signed date'
                      }
                      onClick={() => handleWaiverRowCardClick(row.rowKey, waiver.id)}
                    >
                      <div style={styles.waiverCardGrid6}>
                        <div
                          style={{
                            ...styles.waiverCheckColSpan,
                            gridColumn: 1,
                            gridRow: `1 / span ${rowSpan}`
                          }}
                        >
                          {renderCheckCell(
                            waiver,
                            p.id,
                            'additional_adult',
                            adultName,
                            `Check in additional adult ${adultName}`,
                            expiryState,
                            waiver._dataSource === 'legacy',
                            adultRestriction
                          )}
                        </div>
                        <div
                          style={{
                            ...styles.waiverSignerCol,
                            gridColumn: 2,
                            gridRow: `1 / span ${rowSpan}`
                          }}
                        >
                          <p style={styles.waiverRowKind}>Additional adult</p>
                          <h4 style={styles.waiverName}>
                            <span style={styles.minorNameWithAge}>
                              <span style={styles.minorNameText}>{adultDisplay.displayName}</span>
                              <span style={styles.minorAgeText}>{adultDisplay.ageText}</span>
                            </span>
                          </h4>
                          {rowExpandedAa ? renderWaiverSignedExpanded(waiver) : null}
                          {renderWaiverNoticeBadge(adultRestriction)}
                          <p style={styles.waiverPrimaryRef}>Same waiver as {primaryName}</p>
                        </div>
                        {minors.length === 0 ? (
                          <>
                            <div style={{ gridColumn: 3, gridRow: 1, ...styles.waiverCheckCol }} />
                            <div style={{ gridColumn: 4, gridRow: 1, ...styles.waiverMinorGridCell }}>
                              <span style={styles.waiverMinorsEmpty}>—</span>
                            </div>
                          </>
                        ) : (
                          minors.map((m, idx) => {
                            const { displayName, ageText, checkInLabel } = formatDashboardMinorNameAndAge(m);
                            const minorRestriction = getCheckInRestrictionForSubject(waiver, m.id, checkInLabel);
                            return (
                              <React.Fragment key={m.id != null ? String(m.id) : `minor-aa-${idx}`}>
                                <div
                                  style={{
                                    gridColumn: 3,
                                    gridRow: idx + 1,
                                    ...styles.waiverCheckCol
                                  }}
                                >
                                  {renderCheckCell(
                                    waiver,
                                    m.id,
                                    'minor',
                                    checkInLabel,
                                    `Check in minor ${checkInLabel}`,
                                    expiryState,
                                    waiver._dataSource === 'legacy',
                                    minorRestriction
                                  )}
                                </div>
                                <div
                                  style={{
                                    gridColumn: 4,
                                    gridRow: idx + 1,
                                    ...styles.waiverMinorGridCell
                                  }}
                                >
                                  {idx === 0 && (
                                    <span style={styles.waiverMinorsContext}>Same waiver</span>
                                  )}
                                  <div style={styles.minorRow}>
                                    <span style={styles.minorNameWithAge}>
                                      <span style={styles.minorNameText}>{displayName}</span>
                                      <span style={styles.minorAgeText}>{ageText}</span>
                                    </span>
                                  </div>
                                  {renderWaiverNoticeBadge(minorRestriction)}
                                </div>
                              </React.Fragment>
                            );
                          })
                        )}
                        <div
                          style={{
                            gridColumn: 5,
                            gridRow: `1 / span ${rowSpan}`,
                            ...styles.waiverExpiryGrid
                          }}
                        >
                          <span style={styles.waiverExpiryDate}>{expiryDisplay.primary}</span>
                          <span
                            style={{
                              ...styles.waiverExpiryMeta,
                              ...(expiryState === 'expired'
                                ? styles.waiverExpiryMetaExpired
                                : expiryState === 'expiring'
                                  ? styles.waiverExpiryMetaExpiring
                                  : {})
                            }}
                          >
                            {expiryDisplay.secondary}
                          </span>
                        </div>
                        <div
                          style={{
                            gridColumn: 6,
                            gridRow: `1 / span ${rowSpan}`,
                            ...styles.waiverStatusGrid
                          }}
                        >
                          <span style={styles.waiverDisplayNameInline}>
                            {getWaiverDisplayName(waiver)}
                          </span>
                          {statusIcon}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          {blockedCheckInModal ? (
            <div style={styles.modalOverlay} onClick={() => setBlockedCheckInModal(null)}>
              <div
                style={styles.blockedModal}
                role="dialog"
                aria-modal="true"
                aria-labelledby="blocked-check-in-title"
                onClick={(e) => e.stopPropagation()}
              >
                <div style={styles.blockedModalIcon}>
                  <FiAlertCircle size={28} />
                </div>
                <h3 id="blocked-check-in-title" style={styles.blockedModalTitle}>
                  Waiver check-in blocked
                </h3>
                <p style={styles.blockedModalCustomer}>
                  {blockedCheckInModal.customerName}
                </p>
                <div style={styles.blockedModalReason}>
                  {blockedCheckInModal.reason}
                </div>
                {[blockedCheckInModal.customerEmail, blockedCheckInModal.customerPhone].filter(Boolean).length > 0 ? (
                  <p style={styles.blockedModalContact}>
                    {[blockedCheckInModal.customerEmail, blockedCheckInModal.customerPhone].filter(Boolean).join(' - ')}
                  </p>
                ) : null}
                <button
                  type="button"
                  style={styles.blockedModalButton}
                  onClick={() => setBlockedCheckInModal(null)}
                >
                  I understand
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </SecurityWrapper>
    </POSAuthWrapper>
  );
};

const styles = {
  pageRoot: {
    width: '100%'
  },
  header: {
    marginBottom: '20px',
    textAlign: 'center'
  },
  mainTitle: {
    fontSize: TavariStyles.typography.fontSize['2xl'],
    fontWeight: TavariStyles.typography.fontWeight.bold,
    color: TavariStyles.colors.text || '#111827',
    margin: 0,
    marginBottom: '8px'
  },
  subtitle: {
    fontSize: TavariStyles.typography.fontSize.base,
    color: TavariStyles.colors.gray600,
    margin: 0
  },
  statsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
    gap: TavariStyles.spacing.lg || '16px',
    marginBottom: TavariStyles.spacing.xl || '24px'
  },
  statCard: {
    backgroundColor: TavariStyles.colors.white,
    padding: TavariStyles.spacing.xl || '24px',
    borderRadius: TavariStyles.borderRadius?.md || '8px',
    textAlign: 'center',
    border: `1px solid ${TavariStyles.colors.gray200}`,
    boxShadow: TavariStyles.shadows?.sm || '0 1px 3px rgba(0,0,0,0.1)'
  },
  waiverCardExpanded: {
    borderColor: TavariStyles.colors.primary || '#008080',
    backgroundColor: TavariStyles.colors.gray50 || '#f9fafb',
    boxShadow: '0 0 0 1px rgba(0, 128, 128, 0.15)'
  },
  waiverCardExpiring: {
    borderColor: TavariStyles.colors.warning,
    backgroundColor: TavariStyles.colors.warningBg || '#fef3c7',
    boxShadow: '0 0 0 1px rgba(245, 158, 11, 0.18)'
  },
  waiverCardExpired: {
    borderColor: TavariStyles.colors.errorText || TavariStyles.colors.danger || '#dc2626',
    backgroundColor: TavariStyles.colors.errorBg || '#fee2e2',
    boxShadow: '0 0 0 1px rgba(220, 38, 38, 0.18)'
  },
  waiverCardBlocked: {
    borderColor: TavariStyles.colors.errorText || TavariStyles.colors.danger || '#dc2626',
    backgroundColor: TavariStyles.colors.errorBg || '#fee2e2',
    boxShadow: '0 0 0 2px rgba(220, 38, 38, 0.22)'
  },
  waiverCardNoteAlert: {
    borderColor: '#0f766e',
    backgroundColor: '#ccfbf1',
    boxShadow: '0 0 0 2px rgba(15, 118, 110, 0.22)'
  },
  waiverCardAdditionalAdultExpiring: {
    borderColor: TavariStyles.colors.warning,
    borderLeft: `4px solid ${TavariStyles.colors.warning}`,
    backgroundColor: TavariStyles.colors.warningBg || '#fef3c7',
    boxShadow: '0 0 0 1px rgba(245, 158, 11, 0.18)'
  },
  waiverCardAdditionalAdultExpired: {
    borderColor: TavariStyles.colors.errorText || TavariStyles.colors.danger || '#dc2626',
    borderLeft: `4px solid ${TavariStyles.colors.errorText || TavariStyles.colors.danger || '#dc2626'}`,
    backgroundColor: TavariStyles.colors.errorBg || '#fee2e2',
    boxShadow: '0 0 0 1px rgba(220, 38, 38, 0.18)'
  },
  waiverCardDates: {
    marginTop: '10px',
    paddingTop: '8px',
    borderTop: `1px solid ${TavariStyles.colors.gray200}`
  },
  waiverCardSignedLine: {
    margin: 0,
    fontSize: TavariStyles.typography.fontSize.sm,
    color: TavariStyles.colors.gray800 || '#1f2937',
    fontWeight: TavariStyles.typography.fontWeight.medium || 500
  },
  waiverCardExpiresLine: {
    margin: 0,
    marginTop: '6px',
    fontSize: TavariStyles.typography.fontSize.sm,
    color: TavariStyles.colors.gray600 || '#4b5563'
  },
  waiverCardTapHint: {
    margin: 0,
    marginTop: '10px',
    fontSize: TavariStyles.typography.fontSize.xs,
    color: TavariStyles.colors.gray500 || '#6b7280',
    fontStyle: 'italic'
  },
  waiverBlockedBadge: {
    display: 'inline-block',
    marginTop: '8px',
    padding: '4px 8px',
    borderRadius: TavariStyles.borderRadius?.sm || '6px',
    backgroundColor: '#991b1b',
    color: TavariStyles.colors.white || '#ffffff',
    fontSize: TavariStyles.typography.fontSize.xs,
    fontWeight: TavariStyles.typography.fontWeight.semibold || 600,
    lineHeight: 1.3,
    whiteSpace: 'normal'
  },
  waiverNoteAlertBadge: {
    display: 'inline-block',
    marginTop: '8px',
    padding: '4px 8px',
    borderRadius: TavariStyles.borderRadius?.sm || '6px',
    backgroundColor: '#0f766e',
    color: TavariStyles.colors.white || '#ffffff',
    fontSize: TavariStyles.typography.fontSize.xs,
    fontWeight: TavariStyles.typography.fontWeight.semibold || 600,
    lineHeight: 1.3,
    whiteSpace: 'normal'
  },
  statTitle: {
    fontSize: TavariStyles.typography.fontSize.sm,
    fontWeight: TavariStyles.typography.fontWeight.medium,
    color: TavariStyles.colors.gray600,
    margin: 0,
    marginBottom: '8px'
  },
  statValue: {
    fontSize: TavariStyles.typography.fontSize['2xl'],
    fontWeight: TavariStyles.typography.fontWeight.bold,
    margin: 0
  },
  controls: {
    width: '100%',
    marginBottom: TavariStyles.spacing.xl || '24px'
  },
  searchSection: {
    display: 'flex',
    gap: TavariStyles.spacing.lg || '16px',
    width: '100%',
    flexWrap: 'wrap'
  },
  searchGroup: {
    position: 'relative',
    flex: '1 1 300px',
    minWidth: '250px'
  },
  searchIcon: {
    position: 'absolute',
    left: TavariStyles.spacing.md || '12px',
    top: '50%',
    transform: 'translateY(-50%)',
    color: TavariStyles.colors.gray500,
    zIndex: 1
  },
  searchInput: {
    width: '100%',
    padding: `${TavariStyles.spacing.md || '12px'} ${TavariStyles.spacing.md || '12px'} ${TavariStyles.spacing.md || '12px'} 40px`,
    border: `2px solid ${TavariStyles.colors.primary || '#008080'}`,
    borderRadius: TavariStyles.borderRadius?.md || '8px',
    fontSize: TavariStyles.typography.fontSize.base || '16px',
    fontFamily: 'inherit',
    outline: 'none'
  },
  searchClearButton: {
    position: 'absolute',
    right: TavariStyles.spacing.sm || '8px',
    top: '50%',
    transform: 'translateY(-50%)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '32px',
    height: '32px',
    padding: 0,
    border: 'none',
    borderRadius: TavariStyles.borderRadius?.sm || '6px',
    background: 'transparent',
    color: TavariStyles.colors.gray600 || '#4b5563',
    cursor: 'pointer',
    zIndex: 2
  },
  filterGroup: {
    position: 'relative',
    flex: '0 1 180px',
    minWidth: '160px'
  },
  filterIcon: {
    position: 'absolute',
    left: TavariStyles.spacing.md || '12px',
    top: '50%',
    transform: 'translateY(-50%)',
    color: TavariStyles.colors.gray500,
    zIndex: 1
  },
  filterSelect: {
    width: '100%',
    padding: `${TavariStyles.spacing.md || '12px'} ${TavariStyles.spacing.md || '12px'} ${TavariStyles.spacing.md || '12px'} 40px`,
    border: `2px solid ${TavariStyles.colors.primary || '#008080'}`,
    borderRadius: TavariStyles.borderRadius?.md || '8px',
    fontSize: TavariStyles.typography.fontSize.base || '16px',
    backgroundColor: 'white',
    fontFamily: 'inherit',
    cursor: 'pointer',
    outline: 'none'
  },
  recentSection: {
    backgroundColor: TavariStyles.colors.white,
    padding: TavariStyles.spacing.xl || '24px',
    borderRadius: TavariStyles.borderRadius?.md || '8px',
    boxShadow: TavariStyles.shadows?.sm || '0 1px 3px rgba(0,0,0,0.1)'
  },
  overviewRefreshBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '8px',
    flexShrink: 0,
    padding: '8px 14px',
    borderRadius: TavariStyles.borderRadius?.md || '8px',
    border: `2px solid ${TavariStyles.colors.primary || '#008080'}`,
    backgroundColor: TavariStyles.colors.white,
    color: TavariStyles.colors.primary || '#008080',
    fontSize: TavariStyles.typography.fontSize.sm || '14px',
    fontWeight: TavariStyles.typography.fontWeight.semibold || 600,
    fontFamily: 'inherit',
    lineHeight: 1.2
  },
  statsRefreshButton: {
    minHeight: '100%',
    justifyContent: 'center',
    backgroundColor: TavariStyles.colors.white,
    boxShadow: TavariStyles.shadows?.sm || '0 1px 3px rgba(0,0,0,0.1)'
  },
  sectionTitle: {
    fontSize: TavariStyles.typography.fontSize.xl,
    fontWeight: TavariStyles.typography.fontWeight.bold,
    color: TavariStyles.colors.text || '#111827',
    margin: 0,
    marginBottom: TavariStyles.spacing.xs || '8px'
  },
  sectionHint: {
    margin: 0,
    marginBottom: TavariStyles.spacing.lg || '16px',
    fontSize: TavariStyles.typography.fontSize.sm,
    color: TavariStyles.colors.gray600 || '#4b5563',
    lineHeight: 1.45
  },
  includeArchivedRow: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: '10px 16px',
    width: '100%',
    marginTop: TavariStyles.spacing.sm || '8px',
    padding: '10px 12px',
    borderRadius: TavariStyles.borderRadius?.md || '8px',
    border: `1px solid ${TavariStyles.colors.gray300 || '#d1d5db'}`,
    backgroundColor: TavariStyles.colors.gray50 || '#f9fafb'
  },
  includeArchivedHint: {
    fontSize: TavariStyles.typography.fontSize.sm,
    color: TavariStyles.colors.gray600 || '#4b5563'
  },
  waiverList: {
    display: 'flex',
    flexDirection: 'column',
    gap: TavariStyles.spacing.sm || '8px'
  },
  /** Must match waiverCardGrid6: check | signer | check | minors | expiry | validity */
  waiverListHeader: {
    display: 'grid',
    gridTemplateColumns: '40px minmax(0, 1.05fr) 40px minmax(0, 0.9fr) minmax(150px, 0.7fr) minmax(0, 180px)',
    columnGap: '12px',
    rowGap: '4px',
    alignItems: 'center',
    padding: '8px 12px 4px',
    fontSize: '14px',
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
    color: TavariStyles.colors.gray500 || '#6b7280'
  },
  waiverListHeaderCheck: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    textAlign: 'center',
    fontSize: '11px',
    fontWeight: 600,
    lineHeight: 1.1
  },
  waiverListHeaderCheckLine: {
    display: 'block',
    textTransform: 'uppercase',
    letterSpacing: '0.04em'
  },
  waiverListHeaderValidity: {
    textAlign: 'left',
    fontSize: '13px',
    fontWeight: 600
  },
  waiverListHeaderExpiry: {
    textAlign: 'left',
    fontSize: '13px',
    fontWeight: 600
  },
  waiverCard: {
    padding: TavariStyles.spacing.md || '12px',
    border: `1px solid ${TavariStyles.colors.gray300}`,
    borderRadius: TavariStyles.borderRadius?.sm || '6px',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    backgroundColor: TavariStyles.colors.white
  },
  /** Check-in | signer | check-in | minors | expiry | validity */
  waiverCardGrid6: {
    display: 'grid',
    gridTemplateColumns: '40px minmax(0, 1.05fr) 40px minmax(0, 0.9fr) minmax(150px, 0.7fr) minmax(0, 180px)',
    columnGap: '12px',
    rowGap: '6px',
    alignItems: 'center',
    width: '100%',
    boxSizing: 'border-box'
  },
  waiverCheckCol: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 0
  },
  waiverCheckColSpan: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 0,
    minHeight: '100%'
  },
  waiverMinorGridCell: {
    minWidth: 0,
    justifySelf: 'stretch',
    alignSelf: 'center'
  },
  waiverStatusGrid: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '10px',
    paddingTop: '2px',
    minWidth: 0,
    flexWrap: 'wrap',
  },
  partyToPosBtn: {
    border: `1px solid ${TavariStyles.colors.primary || '#008080'}`,
    background: TavariStyles.colors.primary || '#008080',
    color: '#fff',
  },
  posModeActiveBtn: {
    border: `2px solid ${TavariStyles.colors.warning || '#d97706'}`,
    background: TavariStyles.colors.warning || '#d97706',
    color: '#fff',
  },
  posModeBanner: {
    marginTop: TavariStyles.spacing.md || '12px',
    marginBottom: TavariStyles.spacing.sm || '8px',
    padding: '10px 14px',
    borderRadius: TavariStyles.borderRadius?.md || '8px',
    border: `1px solid ${TavariStyles.colors.warning || '#d97706'}`,
    background: '#fffbeb',
    color: TavariStyles.colors.gray800 || '#1f2937',
    fontSize: TavariStyles.typography.fontSize.sm || '14px',
    lineHeight: 1.45,
  },
  posSelectCheckWrap: {
    outline: `2px solid ${TavariStyles.colors.primary || '#008080'}`,
    outlineOffset: 2,
    borderRadius: 6,
  },
  waiverDisplayNameInline: {
    minWidth: 0,
    flex: 1,
    fontSize: TavariStyles.typography.fontSize.sm,
    color: TavariStyles.colors.text || '#111827',
    fontWeight: 500,
    lineHeight: 1.35,
    textAlign: 'left',
    wordBreak: 'break-word'
  },
  waiverExpiryGrid: {
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    gap: '4px',
    minWidth: 0
  },
  waiverExpiryDate: {
    fontSize: TavariStyles.typography.fontSize.sm,
    fontWeight: TavariStyles.typography.fontWeight.semibold || 600,
    color: TavariStyles.colors.text || '#111827',
    lineHeight: 1.35,
    wordBreak: 'break-word'
  },
  waiverExpiryMeta: {
    fontSize: TavariStyles.typography.fontSize.xs,
    color: TavariStyles.colors.gray600 || '#4b5563',
    lineHeight: 1.35
  },
  waiverExpiryMetaExpiring: {
    color: TavariStyles.colors.warningText || TavariStyles.colors.warning
  },
  waiverExpiryMetaExpired: {
    color: TavariStyles.colors.errorText || TavariStyles.colors.error
  },
  inlineCheckWrap: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    minHeight: '28px'
  },
  /** Same grid as primary row; left accent so staff can scan additional adults quickly. */
  waiverCardAdditionalAdult: {
    padding: TavariStyles.spacing.md || '12px',
    border: `1px solid ${TavariStyles.colors.gray300}`,
    borderLeft: `4px solid ${TavariStyles.colors.primary || '#008080'}`,
    borderRadius: TavariStyles.borderRadius?.sm || '6px',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    backgroundColor: TavariStyles.colors.white
  },
  waiverRowKind: {
    margin: 0,
    marginBottom: '4px',
    fontSize: '14px',
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
    color: TavariStyles.colors.gray500 || '#6b7280'
  },
  waiverPrimaryRef: {
    margin: 0,
    marginTop: '6px',
    fontSize: TavariStyles.typography.fontSize.xs,
    color: TavariStyles.colors.gray600,
    lineHeight: 1.35
  },
  waiverMinorsContext: {
    display: 'block',
    fontSize: '13px',
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.03em',
    color: TavariStyles.colors.gray500 || '#6b7280',
    marginBottom: '6px'
  },
  waiverSignerCol: {
    minWidth: 0
  },
  waiverMinorsEmpty: {
    fontSize: TavariStyles.typography.fontSize.sm,
    color: TavariStyles.colors.gray400 || '#9ca3af'
  },
  minorRow: {
    width: '100%',
    fontSize: TavariStyles.typography.fontSize.sm,
    color: TavariStyles.colors.text || '#111827'
  },
  /** Name and age on one line; age never shrinks away (grid column used to squeeze flex siblings). */
  minorNameWithAge: {
    display: 'inline-flex',
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'baseline',
    gap: '10px',
    rowGap: '4px',
    maxWidth: '100%'
  },
  minorNameText: {
    fontWeight: TavariStyles.typography.fontWeight.semibold || 600,
    minWidth: 0
  },
  minorAgeText: {
    flexShrink: 0,
    color: TavariStyles.colors.gray700 || '#374151',
    fontWeight: TavariStyles.typography.fontWeight.medium || 500,
    fontVariantNumeric: 'tabular-nums',
    whiteSpace: 'nowrap'
  },
  waiverInfo: {
    flex: 1
  },
  waiverName: {
    fontSize: TavariStyles.typography.fontSize.base,
    fontWeight: TavariStyles.typography.fontWeight.bold,
    color: TavariStyles.colors.text || '#111827',
    margin: 0,
    marginBottom: '4px'
  },
  emptyState: {
    textAlign: 'center',
    color: TavariStyles.colors.gray600,
    padding: TavariStyles.spacing.xl || '24px',
    fontSize: TavariStyles.typography.fontSize.base,
    margin: 0
  },
  emptyStateTitle: {
    margin: 0,
    marginBottom: TavariStyles.spacing.sm || '8px',
    fontSize: TavariStyles.typography.fontSize.lg || '18px',
    fontWeight: TavariStyles.typography.fontWeight.semibold || 600,
    color: TavariStyles.colors.text || '#374151'
  },
  emptyStateHint: {
    margin: 0,
    maxWidth: '520px',
    marginLeft: 'auto',
    marginRight: 'auto',
    lineHeight: 1.5,
    color: TavariStyles.colors.gray600
  },
  loadingState: {
    textAlign: 'center',
    padding: TavariStyles.spacing.xl || '24px',
    color: TavariStyles.colors.gray600
  },
  modalOverlay: {
    position: 'fixed',
    inset: 0,
    zIndex: 10000,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: TavariStyles.spacing.lg || '16px',
    backgroundColor: 'rgba(17, 24, 39, 0.58)'
  },
  blockedModal: {
    width: '100%',
    maxWidth: '520px',
    backgroundColor: TavariStyles.colors.white || '#ffffff',
    borderRadius: TavariStyles.borderRadius?.lg || '12px',
    boxShadow: TavariStyles.shadows?.xl || '0 20px 45px rgba(0,0,0,0.25)',
    padding: TavariStyles.spacing.xl || '24px',
    textAlign: 'center',
    border: `2px solid ${TavariStyles.colors.errorText || TavariStyles.colors.error || '#dc2626'}`
  },
  blockedModalIcon: {
    width: '56px',
    height: '56px',
    borderRadius: '999px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: TavariStyles.spacing.md || '12px',
    backgroundColor: TavariStyles.colors.errorBg || '#fee2e2',
    color: TavariStyles.colors.errorText || TavariStyles.colors.error || '#dc2626'
  },
  blockedModalTitle: {
    margin: 0,
    marginBottom: TavariStyles.spacing.xs || '8px',
    color: TavariStyles.colors.errorText || TavariStyles.colors.error || '#dc2626',
    fontSize: TavariStyles.typography.fontSize.xl,
    fontWeight: TavariStyles.typography.fontWeight.bold
  },
  blockedModalCustomer: {
    margin: 0,
    marginBottom: TavariStyles.spacing.md || '12px',
    color: TavariStyles.colors.text || '#111827',
    fontSize: TavariStyles.typography.fontSize.base,
    fontWeight: TavariStyles.typography.fontWeight.semibold || 600
  },
  blockedModalReason: {
    marginBottom: TavariStyles.spacing.md || '12px',
    padding: TavariStyles.spacing.md || '12px',
    borderRadius: TavariStyles.borderRadius?.md || '8px',
    backgroundColor: TavariStyles.colors.gray50 || '#f9fafb',
    color: TavariStyles.colors.gray800 || '#1f2937',
    fontSize: TavariStyles.typography.fontSize.sm,
    lineHeight: 1.5,
    textAlign: 'left',
    whiteSpace: 'pre-wrap'
  },
  blockedModalContact: {
    margin: 0,
    marginBottom: TavariStyles.spacing.lg || '16px',
    color: TavariStyles.colors.gray600 || '#4b5563',
    fontSize: TavariStyles.typography.fontSize.sm
  },
  blockedModalButton: {
    width: '100%',
    padding: `${TavariStyles.spacing.md || '12px'} ${TavariStyles.spacing.lg || '16px'}`,
    border: 'none',
    borderRadius: TavariStyles.borderRadius?.md || '8px',
    backgroundColor: TavariStyles.colors.errorText || TavariStyles.colors.error || '#dc2626',
    color: TavariStyles.colors.white || '#ffffff',
    fontSize: TavariStyles.typography.fontSize.base,
    fontWeight: TavariStyles.typography.fontWeight.semibold || 600,
    cursor: 'pointer'
  }
};

export default WaiversDashboard;
