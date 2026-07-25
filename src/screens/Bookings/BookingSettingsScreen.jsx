// src/screens/Bookings/BookingSettingsScreen.jsx
import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePOSAuth } from '../../hooks/usePOSAuth';
import { usePermissions } from '../../hooks/usePermissions';
import { SecurityWrapper, useSecurityContext } from '../../Security';
import POSAuthWrapper from '../../components/Auth/POSAuthWrapper';
import bookingSettingsService from '../../services/Bookings/BookingSettingsService';
import bookingTypeService from '../../services/Bookings/BookingTypeService';
import bookingActivityService from '../../services/Bookings/BookingActivityService';
import seasonalPeriodService from '../../services/Bookings/SeasonalPeriodService';
import { supabase } from '../../supabaseClient';
import { TavariStyles } from '../../utils/TavariStyles';
import { FiArrowLeft, FiSave, FiPlus, FiX, FiTrash2, FiArrowUp, FiArrowDown, FiPower, FiCopy, FiChevronDown, FiEdit, FiLink, FiImage, FiUpload, FiMail, FiMenu } from 'react-icons/fi';
import toast from 'react-hot-toast';
import ModuleDeactivationPanel from '../../components/Modules/ModuleDeactivationPanel';
import BookingPricingPromotionsManager from '../../components/Bookings/BookingPricingPromotionsManager';
import BookingTermsPackagesManager from '../../components/Bookings/BookingTermsPackagesManager';
import BookingActivityAdditionalTabsEditor from '../../components/Bookings/BookingActivityAdditionalTabsEditor';
import BookingActivityOptionsLibraryManager from '../../components/Bookings/BookingActivityOptionsLibraryManager';
import TavariCheckbox from '../../components/UI/TavariCheckbox';
import { formatDateForBusiness, getBusinessTimezone } from '../../utils/businessDateFormat';
import {
  buildDefaultTicketAssignmentRules,
  buildDefaultTicketPricingRules,
  calculateTicketPricing,
  formatAgeRestrictionSummary,
  serializeTicketAssignmentRules,
  serializeTicketPricingRules,
  resolveTicketInventoryItemIds,
} from '../../utils/bookingTicketAssignment';
import {
  defaultOnlinePaymentSettings,
  parseOnlinePaymentSettings,
  serializeOnlinePaymentSettings,
  validateOnlinePaymentSettings,
  ONLINE_PAYMENT_MODES,
  DEPOSIT_TYPES,
} from '../../utils/bookingPaymentSettings';
import {
  calculateExtensionPrice,
  defaultExtensionPricingSettings,
  EXTENSION_PRICING_UNITS,
  formatExtensionPricingUnitLabel,
  parseExtensionPricingSettings,
  serializeExtensionPricingSettings,
  validateExtensionPricingSettings,
} from '../../utils/bookingExtensionPricing';
import {
  BIRTHDAY_PARTY_TYPE_KEY,
  isBirthdayPartyCategory,
  parsePartyCategorySessionRules,
  serializePartyCategorySessionRules,
} from '../../utils/bookingPartySettings';
import {
  CATEGORY_CAPACITY_MODES,
  defaultCategorySharedCapacityRules,
  mergeCategorySessionRulesWithSharedCapacity,
  parseCategorySharedCapacityRules,
} from '../../utils/bookingCategoryCapacity';
import {
  PORTAL_OPTIONS_DISPLAY_MODES,
  defaultPortalOptionGroup,
  defaultPortalOptionItem,
  mergeAddonSettingsWithPortalOptions,
  portalOptionFromInventoryItem,
  parsePortalActivityOptions,
  parseOptionalPrice,
  serializePortalActivityOptions,
  listPortalOptionParentChoices,
  findPortalOptionLabel,
  removePortalOptionFromGroups,
  countPortalOptionDependents,
  groupIsIncludedPackageChoice,
} from '../../utils/bookingActivityOptions';
import { buildPortalOptionGroupsFromPosItem } from '../../utils/portalOptionsFromPosModifiers';
import { getActivityPortalUrl, getCategoryPortalUrl, getCustomerPortalBaseUrl } from '../../utils/bookingPublicLinks';
import BookingTimeSlotSelect from '../../components/Bookings/BookingTimeSlotSelect';
import {
  DEFAULT_OPERATING_HOURS,
  getDayKeyFromDateString,
  getDayKeyFromLabel
} from '../../helpers/Bookings/operatingHoursTimeOptions';
import {
  formatResourcePaddingSummary,
  parsePaddingMinutes,
  resolveResourcePadding,
} from '../../helpers/Bookings/bookingResourcePadding';
import {
  formatResourceQuantitySummary,
  parseResourceQuantity,
} from '../../helpers/Bookings/bookingResourceAvailability';
import {
  FACILITY_LOCK_CATEGORY_ID,
  scheduleHasFacilityLock,
  buildFacilityLockResourceAssignments,
  listCombinationsOfSize,
  normalizeCombinationKey,
  combinationsEqual,
} from '../../helpers/Bookings/bookingScheduleResourceRequirements';
import {
  buildMultiDayScheduleName,
  stripMultiDaySchedulePrefix,
  isMultiDayScheduleName,
  buildMultiDayTicketSettingsFromDates,
  buildMultiDayWeekScheduleName,
  parseMultiDaySeasonLabel,
  splitDateKeysIntoWeekRuns,
  listWeekdayRunFromStart,
  listSelectedDaysInWeekOf,
} from '../../helpers/Bookings/bookingMultiDaySchedule';

const BOOKING_ACTIVITY_IMAGES_BUCKET = 'pos-product-images';
const BOOKING_ACTIVITY_ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const BOOKING_ACTIVITY_MAX_IMAGE_SIZE_BYTES = 2 * 1024 * 1024;

const normalizeScheduleDisplayName = (scheduleName) => {
  const trimmed = String(scheduleName || '').trim();
  return trimmed || 'Unnamed Schedule';
};

/** Delete all schedule rows for an activity that share the same display name (handles null schedule_name). */
const deleteActivitySchedulesByName = async (activityId, scheduleName) => {
  const targetName = normalizeScheduleDisplayName(scheduleName);

  const { data: rows, error: fetchError } = await supabase
    .from('booking_activity_schedules')
    .select('id, schedule_name')
    .eq('activity_id', activityId);

  if (fetchError) throw fetchError;

  const idsToDelete = (rows || [])
    .filter((row) => normalizeScheduleDisplayName(row.schedule_name) === targetName)
    .map((row) => row.id);

  if (idsToDelete.length === 0) {
    return { deletedCount: 0 };
  }

  const { data: deleted, error: deleteError } = await supabase
    .from('booking_activity_schedules')
    .delete()
    .in('id', idsToDelete)
    .select('id');

  if (deleteError) throw deleteError;

  return { deletedCount: (deleted || []).length };
};

/** Delete every multi-day week belonging to a season label (and optional exact names). */
const deleteMultiDaySeasonSchedules = async (activityId, seasonLabel, extraNames = []) => {
  const season = String(seasonLabel || '').trim();
  const exact = new Set(
    [buildMultiDayScheduleName(season), ...extraNames]
      .map((name) => normalizeScheduleDisplayName(name))
      .filter(Boolean),
  );
  const weekPrefix = `${buildMultiDayScheduleName(season)} · `;

  const { data: rows, error: fetchError } = await supabase
    .from('booking_activity_schedules')
    .select('id, schedule_name')
    .eq('activity_id', activityId);
  if (fetchError) throw fetchError;

  const idsToDelete = (rows || [])
    .filter((row) => {
      const name = normalizeScheduleDisplayName(row.schedule_name);
      if (exact.has(name)) return true;
      if (season && name.startsWith(weekPrefix)) return true;
      const parsed = parseMultiDaySeasonLabel(name);
      return season && parsed.seasonLabel === season && isMultiDayScheduleName(name);
    })
    .map((row) => row.id);

  if (!idsToDelete.length) return { deletedCount: 0 };

  const { data: deleted, error: deleteError } = await supabase
    .from('booking_activity_schedules')
    .delete()
    .in('id', idsToDelete)
    .select('id');
  if (deleteError) throw deleteError;
  return { deletedCount: (deleted || []).length };
};

const partyOneAdultPerChildFromMode = (mode) => {
  if (mode === 'enabled') return true;
  if (mode === 'disabled') return false;
  return null;
};

const partyOneAdultPerChildToMode = (value) => {
  if (value === true) return 'enabled';
  if (value === false) return 'disabled';
  return 'inherit';
};

const BookingSettingsScreen = ({ activeSubTab = 'categories', onSubTabChange }) => {
  const navigate = useNavigate();

  const auth = usePOSAuth({
    requiredRoles: ['employee', 'manager', 'owner'],
    requireBusiness: true,
    componentName: 'BookingSettingsScreen'
  });

  const { logSecurityEvent } = useSecurityContext({
    componentName: 'BookingSettingsScreen',
    sensitiveComponent: false,
    enableAuditLogging: true,
    securityLevel: 'low'
  });

  const { hasPermission, hasElevatedPrivileges, isManager } = usePermissions();
  const canManageSettings =
    hasPermission('bookings.settings.edit') ||
    hasElevatedPrivileges() ||
    isManager();

  // Business timezone
  const [businessTimezone, setBusinessTimezone] = useState('America/Toronto');
  const [operatingHours, setOperatingHours] = useState(DEFAULT_OPERATING_HOURS);
  /** Default phone/email from businesses row — category modal contact fields start here but stay editable */
  const [businessContactDefaults, setBusinessContactDefaults] = useState({ phone: '', email: '' });

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [thankYouTestSending, setThankYouTestSending] = useState(false);
  const [thankYouTestEmail, setThankYouTestEmail] = useState('');
  const [marketingTestEmail, setMarketingTestEmail] = useState('');
  /** 'reminder' | 'abandoned' | 'links' | null while idle */
  const [marketingTestSending, setMarketingTestSending] = useState(null);
  /** Sub-tabs within Settings → Marketing & Communications */
  const [marketingSectionTab, setMarketingSectionTab] = useState('reminder');
  const [settings, setSettings] = useState({
    autoSendConfirmation: true,
    reminderHoursBefore: 24,
    thankYouEmailEnabled: true,
    thankYouEmailMessage: '',
    abandonedCartEmailEnabled: false,
    abandonedCartEmailHours: 2,
    abandonedCartMinStage: 'tickets',
    abandonedCartEmailMessage: '',
    cancellationPolicy: '',
    refundPolicy: ''
  });
  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const [showCategoryTypeModal, setShowCategoryTypeModal] = useState(false);
  const [showCategoryFormModal, setShowCategoryFormModal] = useState(false);
  const [showRegularTabbedModal, setShowRegularTabbedModal] = useState(false);
  const [regularModalActiveTab, setRegularModalActiveTab] = useState('name');
  const [selectedCategoryType, setSelectedCategoryType] = useState(null);
  const [categories, setCategories] = useState([]);
  const [activities, setActivities] = useState([]);
  const [categoryName, setCategoryName] = useState('');
  const defaultCategorySelfServiceRules = () => ({
    noticeSplitHours: 48,
    earlyCancelMode: 'refund_money',
    earlyDepositPolicy: 'follow_cancel_mode',
    lateCancelMode: 'cancel_only',
    lateDepositPolicy: 'non_refundable',
    allowReschedule: true,
    minHoursReschedule: 48,
    contactPhone: '',
    contactEmail: '',
  });
  const [categorySelfServiceRules, setCategorySelfServiceRules] = useState(() => defaultCategorySelfServiceRules());
  const [categoryPartySettings, setCategoryPartySettings] = useState({
    requireBirthdayChild: true,
    defaultSpacesPerSlot: 1,
  });
  const [categorySharedCapacity, setCategorySharedCapacity] = useState(() => defaultCategorySharedCapacityRules());
  const [editingCategoryTypeKey, setEditingCategoryTypeKey] = useState(null);
  const [loadingCategories, setLoadingCategories] = useState(false);
  
  // Regular activity form state
  const [activityName, setActivityName] = useState('');
  const [selectedCategoryId, setSelectedCategoryId] = useState('');
  const [activitySections, setActivitySections] = useState([]);
  const [editingCategoryId, setEditingCategoryId] = useState(null);
  const [editingActivityId, setEditingActivityId] = useState(null);
  const [activityImages, setActivityImages] = useState([]);
  const [activityImageUrlInput, setActivityImageUrlInput] = useState('');
  const [activityImageUploading, setActivityImageUploading] = useState(false);
  const [activityImageUploadError, setActivityImageUploadError] = useState(null);
  const activityImageInputRef = useRef(null);
  const scheduleEditorRef = useRef(null);
  
  // Delete confirmation state
  const [deleteConfirm, setDeleteConfirm] = useState({ show: false, type: null, id: null, name: null });
  
  // Drag and drop state for categories / activities
  const [draggedCategoryIndex, setDraggedCategoryIndex] = useState(null);
  const [dragOverCategoryIndex, setDragOverCategoryIndex] = useState(null);
  const [draggedActivityIndex, setDraggedActivityIndex] = useState(null);
  const [dragOverActivityIndex, setDragOverActivityIndex] = useState(null);
  
  // Schedule state
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [selectedDay, setSelectedDay] = useState(null);
  /** When set, schedule modal edits individualDatesSlots for this YYYY-MM-DD date. */
  const [selectedIndividualDate, setSelectedIndividualDate] = useState(null);
  const [editingSlotIndex, setEditingSlotIndex] = useState(null); // Index of slot being edited
  const [scheduleTimeSlots, setScheduleTimeSlots] = useState({}); // { 'Sunday': [...], 'Monday': [...] }
  const [scheduleDateRange, setScheduleDateRange] = useState({ startDate: '', endDate: '' }); // Single date range for entire schedule
  const [scheduleName, setScheduleName] = useState(''); // Name for the current schedule being edited
  const [savedSchedules, setSavedSchedules] = useState([]); // Array of saved named schedules
  const [expandedScheduleId, setExpandedScheduleId] = useState(null); // ID of expanded schedule card
  const [editingScheduleName, setEditingScheduleName] = useState(null); // Name of schedule being edited (null if creating new)
  const [copySourceDay, setCopySourceDay] = useState('');
  const [copyDestinationDay, setCopyDestinationDay] = useState('');
  const [copyToAllDays, setCopyToAllDays] = useState(false);
  const [isIndefiniteSchedule, setIsIndefiniteSchedule] = useState(true); // Checkbox for indefinite schedule (default true)
  const [scheduleMode, setScheduleMode] = useState('regular'); // 'regular' | 'individual' | 'multiDay'
  const [individualDatesSlots, setIndividualDatesSlots] = useState({}); // { 'YYYY-MM-DD': [{ startTime, spaces, resources }], ... }
  const [multiDayRepeatTimes, setMultiDayRepeatTimes] = useState(true); // apply first day's times to all dates
  /** Weekdays to include when adding a multi-day week (0=Sun … 6=Sat). Default Mon–Fri. */
  const [multiDayWeekDays, setMultiDayWeekDays] = useState([1, 2, 3, 4, 5]);
  const [scheduleFormData, setScheduleFormData] = useState({
    startTime: '',
    resources: {}, // { 'resourceCategoryId': ['resourceId1', 'resourceId2', ...] }
    spaces: ''
  });
  const [activityDuration, setActivityDuration] = useState({
    days: 0,
    hours: 0,
    minutes: 30
  });
  const [advancedBookingMinNotice, setAdvancedBookingMinNotice] = useState({ value: 5, unit: 'minutes' });
  const [advancedBookingMaxAdvance, setAdvancedBookingMaxAdvance] = useState({ value: 20, unit: 'days' });
  const [resources, setResources] = useState([]); // Loaded from settings
  const [showResourceCategoryModal, setShowResourceCategoryModal] = useState(false);
  const [editingResourceCategory, setEditingResourceCategory] = useState(null);
  const [resourceCategoryName, setResourceCategoryName] = useState('');
  const [resourceCategoryId, setResourceCategoryId] = useState('');
  const [showResourceModal, setShowResourceModal] = useState(false);
  const [editingResource, setEditingResource] = useState(null);
  const [resourceName, setResourceName] = useState('');
  const [resourceId, setResourceId] = useState('');
  const [categoryPaddingBeforeMinutes, setCategoryPaddingBeforeMinutes] = useState('0');
  const [categoryPaddingAfterMinutes, setCategoryPaddingAfterMinutes] = useState('30');
  const [categoryCumulativePadding, setCategoryCumulativePadding] = useState(false);
  const [resourcePaddingBeforeMinutes, setResourcePaddingBeforeMinutes] = useState('');
  const [resourcePaddingAfterMinutes, setResourcePaddingAfterMinutes] = useState('');
  const [resourceUseCategoryCumulativeDefault, setResourceUseCategoryCumulativeDefault] = useState(true);
  const [resourceCumulativePadding, setResourceCumulativePadding] = useState(false);
  const [resourceQuantity, setResourceQuantity] = useState('');
  const [selectedResourceCategory, setSelectedResourceCategory] = useState(null);
  
  // Pricing modals state
  const [showSeasonalPricingModal, setShowSeasonalPricingModal] = useState(false);
  const [showPromotionsModal, setShowPromotionsModal] = useState(false);
  
  // Free with purchase (in Promotions modal)
  const [showFreeWithPurchaseView, setShowFreeWithPurchaseView] = useState(false);
  const [freeWithPurchasePromotions, setFreeWithPurchasePromotions] = useState([]);
  const [fwpInventory, setFwpInventory] = useState([]);
  const [fwpCategories, setFwpCategories] = useState([]);
  const [fwpForm, setFwpForm] = useState({
    quantity: 1,
    free_item_id: null,
    free_category_filter: '',
    trigger_item_ids: [],
    trigger_category_filter: ''
  });
  const [editingFwpId, setEditingFwpId] = useState(null);
  const [showFwpForm, setShowFwpForm] = useState(false);
  const [loadingFwp, setLoadingFwp] = useState(false);
  
  // Inventory selection state for Pricing tab
  const [showInventorySearchModal, setShowInventorySearchModal] = useState(false);
  const [inventoryItems, setInventoryItems] = useState([]);
  const [inventoryCategories, setInventoryCategories] = useState([]);
  const [selectedInventoryCategory, setSelectedInventoryCategory] = useState('');
  const [inventorySearchTerm, setInventorySearchTerm] = useState('');
  const [selectedInventoryItems, setSelectedInventoryItems] = useState([]); // Array of inventory item IDs
  const [loadingInventory, setLoadingInventory] = useState(false);
  const [inventoryPickerMode, setInventoryPickerMode] = useState('tickets');
  const [optionInventoryPickerGroupIndex, setOptionInventoryPickerGroupIndex] = useState(null);
  const [optionInventoryPickerSelection, setOptionInventoryPickerSelection] = useState([]);
  
  // Booking Settings state (ticket quantity limits + waiver)
  const [minTickets, setMinTickets] = useState(null);
  const [maxTickets, setMaxTickets] = useState(null);
  const [onlinePaymentSettings, setOnlinePaymentSettings] = useState(defaultOnlinePaymentSettings);
  const [extensionPricingSettings, setExtensionPricingSettings] = useState(defaultExtensionPricingSettings);
  const [requiresWaiver, setRequiresWaiver] = useState(false);
  const [portalVisible, setPortalVisible] = useState(true);
  const [requiresCamperRegistration, setRequiresCamperRegistration] = useState(false);
  const [partyIncludedKids, setPartyIncludedKids] = useState(null);
  const [partyIncludedAdults, setPartyIncludedAdults] = useState(null);
  const [partyOneAdultPerChildMode, setPartyOneAdultPerChildMode] = useState('inherit');
  const [ticketAssignmentRules, setTicketAssignmentRules] = useState([]);
  const [ticketPricingRules, setTicketPricingRules] = useState([]);
  const [loadedTicketAssignmentRules, setLoadedTicketAssignmentRules] = useState([]);
  const [loadedTicketPricingRules, setLoadedTicketPricingRules] = useState([]);
  const [ticketRuleTesterQuantities, setTicketRuleTesterQuantities] = useState({});
  const [pricingDraftDirty, setPricingDraftDirty] = useState(false);
  const [portalOptionsDisplayMode, setPortalOptionsDisplayMode] = useState(PORTAL_OPTIONS_DISPLAY_MODES.SINGLE_MODAL);
  const [portalOptionGroups, setPortalOptionGroups] = useState([]);
  const [expandedPortalOptionGroupId, setExpandedPortalOptionGroupId] = useState(null);
  const [draggedPortalOptionGroupIndex, setDraggedPortalOptionGroupIndex] = useState(null);
  const [dragOverPortalOptionGroupIndex, setDragOverPortalOptionGroupIndex] = useState(null);
  const [draggedPortalOption, setDraggedPortalOption] = useState(null);
  const [dragOverPortalOption, setDragOverPortalOption] = useState(null);
  const [loadedAddonSettings, setLoadedAddonSettings] = useState({});
  const [hydratingTicketSettings, setHydratingTicketSettings] = useState(false);
  const [ticketSettingsLoaded, setTicketSettingsLoaded] = useState(false);
  
  // Seasonal periods state
  const [seasonalPeriods, setSeasonalPeriods] = useState([]);
  const [showAddSeasonalPeriod, setShowAddSeasonalPeriod] = useState(false);
  const [newSeasonalPeriodName, setNewSeasonalPeriodName] = useState('');
  const [newSeasonalPeriodStartDate, setNewSeasonalPeriodStartDate] = useState('');
  const [newSeasonalPeriodEndDate, setNewSeasonalPeriodEndDate] = useState('');
  const [newSeasonalPeriodStartTime, setNewSeasonalPeriodStartTime] = useState('');
  const [newSeasonalPeriodEndTime, setNewSeasonalPeriodEndTime] = useState('');
  const [newSeasonalPeriodFullDay, setNewSeasonalPeriodFullDay] = useState(true);
  const [editingSeasonalPeriodId, setEditingSeasonalPeriodId] = useState(null);
  const [editingSeasonalPeriodName, setEditingSeasonalPeriodName] = useState('');
  const [editingSeasonalPeriodStartDate, setEditingSeasonalPeriodStartDate] = useState('');
  const [editingSeasonalPeriodEndDate, setEditingSeasonalPeriodEndDate] = useState('');
  const [editingSeasonalPeriodStartTime, setEditingSeasonalPeriodStartTime] = useState('');
  const [editingSeasonalPeriodEndTime, setEditingSeasonalPeriodEndTime] = useState('');
  const [editingSeasonalPeriodFullDay, setEditingSeasonalPeriodFullDay] = useState(true);

  useEffect(() => {
    if (auth.selectedBusinessId && canManageSettings) {
      bookingSettingsService.setBusinessId(auth.selectedBusinessId);
      bookingTypeService.setBusinessId(auth.selectedBusinessId);
      bookingActivityService.setBusinessId(auth.selectedBusinessId);
      loadSettings();
      loadBusinessTimezone();
    }
  }, [auth.selectedBusinessId, canManageSettings]);

  useEffect(() => {
    if (auth.authUser?.email) {
      setThankYouTestEmail((prev) => (prev ? prev : auth.authUser.email));
      setMarketingTestEmail((prev) => (prev ? prev : auth.authUser.email));
    }
  }, [auth.authUser?.email]);

  useEffect(() => {
    if (activeSubTab !== 'marketing') {
      setMarketingSectionTab('reminder');
    }
  }, [activeSubTab]);

  // Load business timezone + public contact fields for category modal defaults
  const loadBusinessTimezone = async () => {
    if (!auth.selectedBusinessId) return;
    try {
      const { data, error } = await supabase
        .from('businesses')
        .select('timezone, business_phone, business_email, operating_hours')
        .eq('id', auth.selectedBusinessId)
        .single();
      
      if (!error && data?.timezone) {
        setBusinessTimezone(data.timezone);
      } else {
        setBusinessTimezone('America/Toronto'); // Default
      }
      if (!error && data?.operating_hours && typeof data.operating_hours === 'object') {
        setOperatingHours(data.operating_hours);
      } else {
        setOperatingHours(DEFAULT_OPERATING_HOURS);
      }
      setBusinessContactDefaults({
        phone: typeof data?.business_phone === 'string' ? data.business_phone.trim() : '',
        email: typeof data?.business_email === 'string' ? data.business_email.trim() : '',
      });
    } catch (error) {
      console.error('Error loading business timezone:', error);
      setBusinessTimezone('America/Toronto'); // Default
      setOperatingHours(DEFAULT_OPERATING_HOURS);
      setBusinessContactDefaults({ phone: '', email: '' });
    }
  };

  /** When the category modal opens, pre-fill empty contact fields from business profile (editable after). */
  useEffect(() => {
    if (!showCategoryFormModal) return;
    setCategorySelfServiceRules((prev) => {
      const phoneEmpty = !String(prev.contactPhone || '').trim();
      const emailEmpty = !String(prev.contactEmail || '').trim();
      if (!phoneEmpty && !emailEmpty) return prev;
      return {
        ...prev,
        contactPhone: phoneEmpty ? (businessContactDefaults.phone || '') : prev.contactPhone,
        contactEmail: emailEmpty ? (businessContactDefaults.email || '') : prev.contactEmail,
      };
    });
  }, [showCategoryFormModal, businessContactDefaults.phone, businessContactDefaults.email]);

  useEffect(() => {
    if (
      auth.selectedBusinessId &&
      canManageSettings &&
      (activeSubTab === 'categories' || activeSubTab === 'marketing')
    ) {
      bookingTypeService.setBusinessId(auth.selectedBusinessId);
      bookingActivityService.setBusinessId(auth.selectedBusinessId);
      loadCategories();
    }
  }, [auth.selectedBusinessId, canManageSettings, activeSubTab]);

  useEffect(() => {
    if (auth.selectedBusinessId && canManageSettings) {
      loadResources();
      seasonalPeriodService.setBusinessId(auth.selectedBusinessId);
    }
  }, [auth.selectedBusinessId, canManageSettings]);
  
  // Load inventory categories when Pricing tab is active
  useEffect(() => {
    if (auth.selectedBusinessId && (regularModalActiveTab === 'pricing' || regularModalActiveTab === 'options')) {
      loadInventoryCategories();
    }
  }, [auth.selectedBusinessId, regularModalActiveTab]);

  // Load inventory items when search modal opens or filters change
  useEffect(() => {
    if (auth.selectedBusinessId && showInventorySearchModal) {
      console.log('[BookingSettings] Loading inventory items for search modal');
      loadInventoryItems();
    }
  }, [auth.selectedBusinessId, showInventorySearchModal, selectedInventoryCategory, inventorySearchTerm]);

  // Load selected inventory items when editing activity
  useEffect(() => {
    if (editingActivityId) {
      setTicketSettingsLoaded(false);
      loadSelectedInventoryItems(editingActivityId, { force: true });
    }
  }, [editingActivityId]);
  
  // Load seasonal periods when modal opens
  useEffect(() => {
    if (showSeasonalPricingModal && auth.selectedBusinessId && canManageSettings) {
      loadSeasonalPeriods();
    }
  }, [showSeasonalPricingModal, auth.selectedBusinessId, canManageSettings]);

  useEffect(() => {
    if (auth.selectedBusinessId && regularModalActiveTab === 'pricing') {
      loadFreeWithPurchasePromotions();
    }
  }, [auth.selectedBusinessId, regularModalActiveTab]);

  const selectedTicketItems = useMemo(
    () => inventoryItems.filter((item) => selectedInventoryItems.includes(item.id)),
    [inventoryItems, selectedInventoryItems]
  );

  const optionPickerExistingInventoryIds = useMemo(() => {
    if (optionInventoryPickerGroupIndex == null) return new Set();
    return new Set(
      (portalOptionGroups[optionInventoryPickerGroupIndex]?.options || [])
        .map((option) => option.inventory_item_id)
        .filter(Boolean),
    );
  }, [portalOptionGroups, optionInventoryPickerGroupIndex]);

  const optionPickerNewSelectionCount = useMemo(
    () => optionInventoryPickerSelection.filter((id) => !optionPickerExistingInventoryIds.has(id)).length,
    [optionInventoryPickerSelection, optionPickerExistingInventoryIds],
  );

  useEffect(() => {
    setTicketRuleTesterQuantities((prev) => {
      const next = {};
      selectedTicketItems.forEach((item) => {
        next[item.id] = prev[item.id] ?? 0;
      });
      return next;
    });
  }, [selectedTicketItems]);

  const selectedTicketItemIdsSet = useMemo(
    () => new Set(selectedTicketItems.map((item) => item.id)),
    [selectedTicketItems]
  );

  const effectiveTicketAssignmentRules = useMemo(
    () => (pricingDraftDirty ? ticketAssignmentRules : (loadedTicketAssignmentRules.length > 0 ? loadedTicketAssignmentRules : ticketAssignmentRules)),
    [pricingDraftDirty, ticketAssignmentRules, loadedTicketAssignmentRules]
  );

  const effectiveTicketPricingRules = useMemo(
    () => (pricingDraftDirty ? ticketPricingRules : (loadedTicketPricingRules.length > 0 ? loadedTicketPricingRules : ticketPricingRules)),
    [pricingDraftDirty, ticketPricingRules, loadedTicketPricingRules]
  );

  const mergedEffectiveTicketAssignmentRules = useMemo(
    () => buildDefaultTicketAssignmentRules(selectedTicketItems, effectiveTicketAssignmentRules),
    [selectedTicketItems, effectiveTicketAssignmentRules]
  );

  const mergedEffectiveTicketPricingRules = useMemo(
    () => buildDefaultTicketPricingRules(selectedTicketItems, effectiveTicketPricingRules),
    [selectedTicketItems, effectiveTicketPricingRules]
  );

  const relevantFwpPromotions = useMemo(
    () =>
      (freeWithPurchasePromotions || []).filter((promo) =>
        selectedTicketItemIdsSet.has(promo.free_item_id) ||
        (Array.isArray(promo.trigger_item_ids) && promo.trigger_item_ids.some((id) => selectedTicketItemIdsSet.has(id)))
      ),
    [freeWithPurchasePromotions, selectedTicketItemIdsSet]
  );

  const testerPricingPreview = useMemo(() => calculateTicketPricing({
    selectedTickets: ticketRuleTesterQuantities,
    items: selectedTicketItems,
    ticketSettings: {
      pricing_rules: serializeTicketPricingRules(ticketPricingRules, selectedTicketItems),
    },
    legacyPromotions: relevantFwpPromotions,
  }), [ticketRuleTesterQuantities, selectedTicketItems, ticketPricingRules, relevantFwpPromotions]);

  const testerFreeQuantitiesByItem = testerPricingPreview.freeQuantitiesByItem || {};

  const ticketRuleTesterTotal = useMemo(
    () => testerPricingPreview.total,
    [testerPricingPreview]
  );

  const updateTicketAssignmentRule = (inventoryItemId, patch) => {
    setPricingDraftDirty(true);
    setTicketAssignmentRules((prev) =>
      prev.some((rule) => rule.inventory_item_id === inventoryItemId)
        ? prev.map((rule) => (
            rule.inventory_item_id === inventoryItemId
              ? { ...rule, ...patch }
              : rule
          ))
        : [
            ...prev,
            {
              inventory_item_id: inventoryItemId,
              enabled: true,
              priority: 9999,
              use_inventory_age_restriction: true,
              min_value: null,
              min_unit: 'years',
              max_value: null,
              max_unit: 'years',
              ...patch,
            }
          ]
    );
  };

  const updateTicketPricingRule = (inventoryItemId, patch) => {
    setPricingDraftDirty(true);
    setTicketPricingRules((prev) =>
      prev.some((rule) => rule.inventory_item_id === inventoryItemId)
        ? prev.map((rule) => (
            rule.inventory_item_id === inventoryItemId
              ? { ...rule, ...patch }
              : rule
          ))
        : [
            ...prev,
            {
              inventory_item_id: inventoryItemId,
              enabled: false,
              trigger_item_ids: [],
              trigger_quantity: 1,
              discounted_quantity: 1,
              max_discounted_quantity: null,
              count_paid_triggers_only: true,
              allow_additional_paid_tickets: true,
              ...patch,
            }
          ]
    );
  };

  const toggleTicketPricingTrigger = (inventoryItemId, triggerItemId, checked) => {
    setPricingDraftDirty(true);
    setTicketPricingRules((prev) =>
      prev.map((rule) => {
        if (rule.inventory_item_id !== inventoryItemId) return rule;
        const current = Array.isArray(rule.trigger_item_ids) ? rule.trigger_item_ids : [];
        const nextTriggerIds = checked
          ? [...current, triggerItemId].filter((id, index, arr) => arr.indexOf(id) === index)
          : current.filter((id) => id !== triggerItemId);
        return {
          ...rule,
          trigger_item_ids: nextTriggerIds,
          count_paid_triggers_only: nextTriggerIds.includes(inventoryItemId)
            ? true
            : (rule.count_paid_triggers_only !== false),
        };
      })
    );
  };

  const updateTicketRuleTesterQuantity = (inventoryItemId, nextQuantity) => {
    setTicketRuleTesterQuantities((prev) => ({
      ...prev,
      [inventoryItemId]: Math.max(0, nextQuantity)
    }));
  };

  const normalizeActivityImages = (images) => (
    Array.isArray(images)
      ? images
          .map((url) => (typeof url === 'string' ? url.trim() : ''))
          .filter(Boolean)
      : []
  );

  const getStoragePathFromActivityImageUrl = (url) => {
    if (!url || typeof url !== 'string') return null;
    const marker = `/${BOOKING_ACTIVITY_IMAGES_BUCKET}/`;
    const markerIndex = url.indexOf(marker);
    if (markerIndex === -1) return null;
    return url.slice(markerIndex + marker.length);
  };

  const addActivityImageUrl = () => {
    const nextUrl = activityImageUrlInput.trim();
    if (!nextUrl) {
      toast.error('Enter an image URL first');
      return;
    }

    try {
      const parsed = new URL(nextUrl);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        throw new Error('invalid protocol');
      }
    } catch (error) {
      toast.error('Enter a valid image URL');
      return;
    }

    setActivityImages((prev) => (prev.includes(nextUrl) ? prev : [...prev, nextUrl]));
    setActivityImageUrlInput('');
    setActivityImageUploadError(null);
  };

  const handleActivityImageFileSelect = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setActivityImageUploadError(null);

    if (!BOOKING_ACTIVITY_ALLOWED_IMAGE_TYPES.includes(file.type)) {
      setActivityImageUploadError('Please choose a JPEG, PNG, WebP, or GIF image.');
      return;
    }

    if (file.size > BOOKING_ACTIVITY_MAX_IMAGE_SIZE_BYTES) {
      setActivityImageUploadError('Image must be 2 MB or smaller.');
      return;
    }

    if (!auth.selectedBusinessId) {
      setActivityImageUploadError('No business selected.');
      return;
    }

    setActivityImageUploading(true);

    try {
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80) || 'activity-image';
      const path = `${auth.selectedBusinessId}/booking-activities/${crypto.randomUUID()}_${safeName}`;
      const { error: uploadError } = await supabase.storage
        .from(BOOKING_ACTIVITY_IMAGES_BUCKET)
        .upload(path, file, { cacheControl: '3600', upsert: false });

      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage
        .from(BOOKING_ACTIVITY_IMAGES_BUCKET)
        .getPublicUrl(path);

      const publicUrl = urlData?.publicUrl || '';
      if (!publicUrl) {
        throw new Error('Failed to generate image URL');
      }

      setActivityImages((prev) => (prev.includes(publicUrl) ? prev : [...prev, publicUrl]));
    } catch (error) {
      console.error('Error uploading booking activity image:', error);
      setActivityImageUploadError(error?.message || 'Upload failed.');
    } finally {
      setActivityImageUploading(false);
      if (activityImageInputRef.current) {
        activityImageInputRef.current.value = '';
      }
    }
  };

  const removeActivityImage = async (indexToRemove) => {
    const imageUrl = activityImages[indexToRemove];
    const storagePath = getStoragePathFromActivityImageUrl(imageUrl);

    if (storagePath) {
      try {
        await supabase.storage.from(BOOKING_ACTIVITY_IMAGES_BUCKET).remove([storagePath]);
      } catch (error) {
        console.warn('Could not remove activity image from storage:', error);
      }
    }

    setActivityImages((prev) => prev.filter((_, index) => index !== indexToRemove));
    setActivityImageUploadError(null);
  };

  // Helper function to compare time strings (handles "9:00 AM", "10:30 PM", etc.)
  const compareTimeStrings = (timeA, timeB) => {
    const parseTime = (timeStr) => {
      if (!timeStr) return { hours: 0, minutes: 0 };
      const upper = timeStr.toUpperCase().trim();
      const isPM = upper.includes('PM');
      const isAM = upper.includes('AM');
      
      // Extract hours and minutes
      const match = upper.match(/(\d{1,2}):(\d{2})/);
      if (!match) return { hours: 0, minutes: 0 };
      
      let hours = parseInt(match[1], 10);
      const minutes = parseInt(match[2], 10);
      
      // Convert to 24-hour format
      if (isPM && hours !== 12) hours += 12;
      if (isAM && hours === 12) hours = 0;
      
      return { hours, minutes };
    };
    
    const a = parseTime(timeA);
    const b = parseTime(timeB);
    
    if (a.hours !== b.hours) {
      return a.hours - b.hours;
    }
    return a.minutes - b.minutes;
  };

  const loadSettings = async () => {
    try {
      setLoading(true);
      const data = await bookingSettingsService.getAllSettings();
      setSettings({
        autoSendConfirmation: data.autoSendConfirmation !== false,
        reminderHoursBefore: data.reminderHoursBefore || 24,
        thankYouEmailEnabled: data.thankYouEmailEnabled !== false,
        thankYouEmailMessage: typeof data.thankYouEmailMessage === 'string' ? data.thankYouEmailMessage : '',
        abandonedCartEmailEnabled: data.abandonedCartEmailEnabled === true,
        abandonedCartEmailHours: (() => {
          const h = data.abandonedCartEmailHours;
          const n = typeof h === 'number' ? h : parseFloat(h);
          return Number.isFinite(n) && n > 0 ? Math.min(168, Math.max(0.5, n)) : 2;
        })(),
        abandonedCartMinStage: typeof data.abandonedCartMinStage === 'string' && data.abandonedCartMinStage
          ? data.abandonedCartMinStage
          : 'tickets',
        abandonedCartEmailMessage: typeof data.abandonedCartEmailMessage === 'string' ? data.abandonedCartEmailMessage : '',
        cancellationPolicy: data.cancellationPolicy || '',
        refundPolicy: data.refundPolicy || ''
      });
    } catch (error) {
      console.error('Error loading settings:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadCategories = async () => {
    try {
      if (!auth.selectedBusinessId) return;
      setLoadingCategories(true);
      bookingTypeService.setBusinessId(auth.selectedBusinessId);
      bookingActivityService.setBusinessId(auth.selectedBusinessId);
      await bookingTypeService.ensureBirthdayPartyCategory();
      const [categoriesData, activitiesData] = await Promise.all([
        bookingTypeService.getBookingTypes(true), // Include inactive
        bookingActivityService.getActivities({ activeOnly: false }) // Include inactive
      ]);
      setCategories(categoriesData || []);
      setActivities(activitiesData || []);
      // Debug: Log activities to see their structure
      console.log('Loaded activities:', activitiesData);
      console.log('Activities with type_id:', activitiesData?.map(a => ({ id: a.id, name: a.activity_name, type_id: a.type_id })));
    } catch (error) {
      console.error('Error loading categories:', error);
      toast.error('Error loading categories');
    } finally {
      setLoadingCategories(false);
    }
  };

  const loadCategoriesForDropdown = async () => {
    try {
      if (!auth.selectedBusinessId) return;
      bookingTypeService.setBusinessId(auth.selectedBusinessId);
      const data = await bookingTypeService.getBookingTypes(true); // Include inactive
      setCategories(data || []);
    } catch (error) {
      console.error('Error loading categories:', error);
      toast.error('Error loading categories');
    }
  };

  const addActivitySection = () => {
    setActivitySections([
      ...activitySections,
      { id: Date.now(), header: '', details: '' }
    ]);
  };

  const removeActivitySection = (sectionId) => {
    setActivitySections(activitySections.filter(section => section.id !== sectionId));
  };

  const updateActivitySection = (sectionId, field, value) => {
    setActivitySections(activitySections.map(section =>
      section.id === sectionId ? { ...section, [field]: value } : section
    ));
  };

  const handleDeleteClick = (type, id, name, meta = {}) => {
    if (type === 'category' && meta?.typeKey === BIRTHDAY_PARTY_TYPE_KEY) {
      toast.error('The Birthday Party category cannot be deleted.');
      return;
    }
    setDeleteConfirm({ show: true, type, id, name });
  };

  const handleDeleteConfirm = async () => {
    try {
      if (deleteConfirm.type === 'category') {
        await bookingTypeService.deleteBookingType(deleteConfirm.id);
        toast.success('Category deleted successfully');
      } else if (deleteConfirm.type === 'activity') {
        await bookingActivityService.deleteActivity(deleteConfirm.id);
        toast.success('Activity deleted successfully');
      }
      await loadCategories();
      setDeleteConfirm({ show: false, type: null, id: null, name: null });
    } catch (error) {
      console.error('Error deleting:', error);
      toast.error(error.message || 'Error deleting item');
    }
  };

  const handleDeleteCancel = () => {
    setDeleteConfirm({ show: false, type: null, id: null, name: null });
  };

  const handleToggleActive = async (type, id, currentStatus) => {
    try {
      if (type === 'category') {
        await bookingTypeService.toggleBookingTypeStatus(id, !currentStatus);
        toast.success(`Category ${!currentStatus ? 'activated' : 'deactivated'} successfully`);
      } else if (type === 'activity') {
        await bookingActivityService.toggleActivityStatus(id, !currentStatus);
        toast.success(`Activity ${!currentStatus ? 'activated' : 'deactivated'} successfully`);
      }
      await loadCategories();
    } catch (error) {
      console.error('Error toggling status:', error);
      toast.error(error.message || 'Error updating status');
    }
  };

  const loadResources = async () => {
    try {
      const resourcesData = await bookingSettingsService.getBookingResources();
      setResources(resourcesData || []);
    } catch (error) {
      console.error('Error loading resources:', error);
      // If no resources exist yet, set empty array
      setResources([]);
    }
  };

  // Get resources - returns the loaded resources from settings
  const getResources = () => {
    return resources || [];
  };

  const getDefaultScheduleSpaces = () => {
    const selectedCategory = categories.find((c) => c.id === selectedCategoryId);
    if (isBirthdayPartyCategory(selectedCategory)) {
      return String(parsePartyCategorySessionRules(selectedCategory.session_rules).defaultSpacesPerSlot);
    }
    return '';
  };

  const mergePartyActivityTicketSettings = (ticketSettings) => {
    const selectedCategory = categories.find((c) => c.id === selectedCategoryId);
    if (!isBirthdayPartyCategory(selectedCategory)) return ticketSettings;
    const partyRules = parsePartyCategorySessionRules(selectedCategory.session_rules);
    return {
      ...ticketSettings,
      party_booking: true,
      require_birthday_child: partyRules.requireBirthdayChild,
      min_tickets: null,
      max_tickets: null,
    };
  };

  const closeScheduleModal = () => {
    setShowScheduleModal(false);
    setSelectedDay(null);
    setSelectedIndividualDate(null);
    setEditingSlotIndex(null);
    setScheduleFormData({ startTime: '', resources: {}, spaces: '' });
  };

  const scheduleModalDayKey = useMemo(() => {
    if (selectedIndividualDate) return getDayKeyFromDateString(selectedIndividualDate);
    if (selectedDay) return getDayKeyFromLabel(selectedDay);
    return 'monday';
  }, [selectedIndividualDate, selectedDay]);

  const scheduleModalTitleSuffix = useMemo(() => {
    if (selectedIndividualDate) {
      return new Date(`${selectedIndividualDate}T12:00:00`).toLocaleDateString(undefined, {
        weekday: 'short',
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      });
    }
    return selectedDay || '';
  }, [selectedIndividualDate, selectedDay]);

  const handleOpenScheduleModal = (day, slotIndex = null) => {
    setSelectedDay(day);
    setSelectedIndividualDate(null);
    setEditingSlotIndex(slotIndex);

    if (slotIndex !== null) {
      const daySlots = scheduleTimeSlots[day] || [];
      const slot = daySlots[slotIndex];
      setScheduleFormData({
        startTime: slot.startTime || '',
        resources: slot.resources || {},
        spaces: slot.spaces?.toString() || ''
      });
    } else {
      setScheduleFormData({ startTime: '', resources: {}, spaces: getDefaultScheduleSpaces() });
    }

    setShowScheduleModal(true);
  };

  const handleOpenIndividualScheduleModal = (dateStr, slotIndex = null) => {
    setSelectedIndividualDate(dateStr);
    setSelectedDay(null);
    setEditingSlotIndex(slotIndex);

    if (slotIndex !== null) {
      const daySlots = individualDatesSlots[dateStr] || [];
      const slot = daySlots[slotIndex];
      setScheduleFormData({
        startTime: slot.startTime || '',
        resources: slot.resources || {},
        spaces: slot.spaces?.toString() || ''
      });
    } else {
      setScheduleFormData({ startTime: '', resources: {}, spaces: getDefaultScheduleSpaces() });
    }

    setShowScheduleModal(true);
  };

  const handleSaveScheduleTimeSlot = () => {
    if (!scheduleFormData.startTime.trim()) {
      toast.error('Please select a start time');
      return;
    }

    if (!scheduleFormData.spaces || isNaN(parseInt(scheduleFormData.spaces)) || parseInt(scheduleFormData.spaces) <= 0) {
      toast.error('Please enter a valid number of spaces');
      return;
    }

    const updatedSlot = {
      startTime: scheduleFormData.startTime.trim(),
      resources: scheduleFormData.resources,
      spaces: parseInt(scheduleFormData.spaces)
    };

    if (selectedIndividualDate) {
      setIndividualDatesSlots((prev) => {
        const daySlots = [...(prev[selectedIndividualDate] || [])];
        if (editingSlotIndex !== null) {
          daySlots[editingSlotIndex] = updatedSlot;
        } else {
          daySlots.push(updatedSlot);
        }
        daySlots.sort((a, b) => compareTimeStrings(a.startTime, b.startTime));
        let next = { ...prev, [selectedIndividualDate]: daySlots };
        if (scheduleMode === 'multiDay' && multiDayRepeatTimes) {
          const dates = Object.keys(next).sort();
          if (dates[0] === selectedIndividualDate && dates.length > 1) {
            const template = JSON.parse(JSON.stringify(daySlots));
            dates.slice(1).forEach((d) => {
              next[d] = JSON.parse(JSON.stringify(template));
            });
          }
        }
        return next;
      });
    } else {
      setScheduleTimeSlots((prev) => {
        const daySlots = [...(prev[selectedDay] || [])];
        if (editingSlotIndex !== null) {
          daySlots[editingSlotIndex] = updatedSlot;
        } else {
          daySlots.push(updatedSlot);
        }
        daySlots.sort((a, b) => compareTimeStrings(a.startTime, b.startTime));
        return { ...prev, [selectedDay]: daySlots };
      });
    }

    closeScheduleModal();
    toast.success(editingSlotIndex !== null ? 'Time slot updated successfully' : 'Time slot added successfully');
  };

  const handleDeleteScheduleTimeSlot = (day, slotIndex) => {
    if (window.confirm('Are you sure you want to delete this time slot?')) {
      setScheduleTimeSlots(prev => {
        const daySlots = [...(prev[day] || [])];
        daySlots.splice(slotIndex, 1);
        return {
          ...prev,
          [day]: daySlots
        };
      });
      toast.success('Time slot deleted successfully');
    }
  };

  // Copy time slots from one day to another or all days
  const handleCopySchedule = () => {
    if (!copySourceDay) {
      toast.error('Please select a source day to copy from');
      return;
    }

    if (!copyToAllDays && !copyDestinationDay) {
      toast.error('Please select a destination day or choose "All Days"');
      return;
    }

    const sourceSlots = scheduleTimeSlots[copySourceDay] || [];
    if (sourceSlots.length === 0) {
      toast.error(`No time slots found for ${copySourceDay}`);
      return;
    }

    // Deep copy the slots to avoid reference issues
    const slotsToCopy = sourceSlots.map(slot => ({ ...slot }));

    let successMessage = '';
    
    setScheduleTimeSlots(prev => {
      const updated = { ...prev };
      
      if (copyToAllDays) {
        // Copy to all days except the source day
        const allDays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        allDays.forEach(day => {
          if (day !== copySourceDay) {
            // Deep copy each slot to avoid reference issues
            updated[day] = slotsToCopy.map(slot => ({
              ...slot,
              resources: slot.resources ? JSON.parse(JSON.stringify(slot.resources)) : {}
            }));
          }
        });
        successMessage = `Copied ${slotsToCopy.length} time slot(s) from ${copySourceDay} to all other days`;
      } else {
        // Copy to specific destination day
        if (copyDestinationDay === copySourceDay) {
          toast.error('Source and destination days cannot be the same');
          return prev;
        }
        // Deep copy each slot to avoid reference issues
        updated[copyDestinationDay] = slotsToCopy.map(slot => ({
          ...slot,
          resources: slot.resources ? JSON.parse(JSON.stringify(slot.resources)) : {}
        }));
        successMessage = `Copied ${slotsToCopy.length} time slot(s) from ${copySourceDay} to ${copyDestinationDay}`;
      }
      
      return updated;
    });
    
    // Show toast after state update (outside of setState callback)
    if (successMessage) {
      toast.success(successMessage);
    }

    // Reset copy state
    setCopySourceDay('');
    setCopyDestinationDay('');
    setCopyToAllDays(false);
  };

  const handleResourceChange = (categoryId, resourceId) => {
    setScheduleFormData(prev => {
      const current = prev.resources[categoryId];
      const isPool =
        current && typeof current === 'object' && !Array.isArray(current) && current.mode === 'pool';

      if (isPool) {
        const pool = Array.isArray(current.pool) ? [...current.pool] : [];
        const isSelected = pool.includes(resourceId);
        const nextPool = isSelected
          ? pool.filter((id) => id !== resourceId)
          : [...pool, resourceId];
        const count = Math.max(1, Math.min(nextPool.length || 1, Number(current.count) || 1));
        const allowedRaw = current.allowed_combinations || current.allowedCombinations || [];
        const allowed_combinations = Array.isArray(allowedRaw)
          ? allowedRaw
              .map((combo) => (Array.isArray(combo) ? combo.filter((id) => nextPool.includes(id)) : []))
              .filter((combo) => combo.length === count)
          : [];
        return {
          ...prev,
          resources: {
            ...prev.resources,
            [categoryId]: nextPool.length
              ? {
                  mode: 'pool',
                  count,
                  pool: nextPool,
                  ...(allowed_combinations.length ? { allowed_combinations } : {}),
                }
              : [],
          },
        };
      }

      const resourceArray = Array.isArray(current)
        ? current
        : current ? [current] : [];
      const isSelected = resourceArray.includes(resourceId);
      const updatedResources = isSelected
        ? resourceArray.filter(id => id !== resourceId)
        : [...resourceArray, resourceId];

      return {
        ...prev,
        resources: {
          ...prev.resources,
          [categoryId]: updatedResources
        }
      };
    });
  };

  const setResourceAssignmentMode = (categoryId, mode) => {
    setScheduleFormData((prev) => {
      const current = prev.resources[categoryId];
      const existingIds = Array.isArray(current)
        ? current
        : current && typeof current === 'object' && Array.isArray(current.pool)
          ? current.pool
          : current
            ? [current]
            : [];
      if (mode === 'pool') {
        return {
          ...prev,
          resources: {
            ...prev.resources,
            [categoryId]: {
              mode: 'pool',
              count: Math.max(1, Math.min(existingIds.length || 1, Number(current?.count) || 1)),
              pool: existingIds,
            },
          },
        };
      }
      return {
        ...prev,
        resources: {
          ...prev.resources,
          [categoryId]: existingIds,
        },
      };
    });
  };

  const setResourcePoolCount = (categoryId, countValue) => {
    setScheduleFormData((prev) => {
      const current = prev.resources[categoryId];
      if (!current || typeof current !== 'object' || Array.isArray(current) || current.mode !== 'pool') {
        return prev;
      }
      const pool = Array.isArray(current.pool) ? current.pool : [];
      const count = Math.max(1, Math.min(pool.length || 1, Number.parseInt(countValue, 10) || 1));
      const allowedRaw = current.allowed_combinations || current.allowedCombinations || [];
      const allowed_combinations = Array.isArray(allowedRaw)
        ? allowedRaw
            .map((combo) => (Array.isArray(combo) ? combo.filter((id) => pool.includes(id)) : []))
            .filter((combo) => combo.length === count)
        : [];
      return {
        ...prev,
        resources: {
          ...prev.resources,
          [categoryId]: {
            mode: 'pool',
            count,
            pool,
            ...(allowed_combinations.length ? { allowed_combinations } : {}),
          },
        },
      };
    });
  };

  const togglePoolCombination = (categoryId, combo) => {
    setScheduleFormData((prev) => {
      const current = prev.resources[categoryId];
      if (!current || typeof current !== 'object' || Array.isArray(current) || current.mode !== 'pool') {
        return prev;
      }
      const pool = Array.isArray(current.pool) ? current.pool : [];
      const count = Math.max(1, Math.min(pool.length || 1, Number(current.count) || 1));
      const allCombos = listCombinationsOfSize(pool, count);
      const existingRaw = current.allowed_combinations || current.allowedCombinations;
      // Empty = all allowed; treat as fully selected for toggle UX
      let selected = Array.isArray(existingRaw) && existingRaw.length
        ? existingRaw.map((row) => normalizeCombinationKey(row))
        : allCombos.map((row) => normalizeCombinationKey(row));
      const key = normalizeCombinationKey(combo);
      if (selected.includes(key)) {
        selected = selected.filter((row) => row !== key);
      } else {
        selected = [...selected, key];
      }
      // If every possible combo is selected, omit the restriction
      const allKeys = new Set(allCombos.map((row) => normalizeCombinationKey(row)));
      const selectedSet = new Set(selected);
      const isUnrestricted =
        allKeys.size > 0 &&
        allKeys.size === selectedSet.size &&
        [...allKeys].every((k) => selectedSet.has(k));

      const allowed_combinations = isUnrestricted
        ? []
        : selected
            .map((k) => k.split('|').filter(Boolean))
            .filter((row) => row.length === count);

      return {
        ...prev,
        resources: {
          ...prev.resources,
          [categoryId]: {
            mode: 'pool',
            count,
            pool,
            ...(allowed_combinations.length ? { allowed_combinations } : {}),
          },
        },
      };
    });
  };

  const isPoolCombinationSelected = (categoryId, combo) => {
    const current = scheduleFormData.resources?.[categoryId];
    if (!current || typeof current !== 'object' || Array.isArray(current) || current.mode !== 'pool') {
      return false;
    }
    const allowed = current.allowed_combinations || current.allowedCombinations;
    // No restriction = all combinations allowed
    if (!Array.isArray(allowed) || !allowed.length) return true;
    return allowed.some((row) => combinationsEqual(row, combo));
  };

  const isFacilityLockEnabled = () =>
    scheduleHasFacilityLock(scheduleFormData.resources);

  const setFacilityLockEnabled = (enabled) => {
    setScheduleFormData((prev) => {
      if (enabled) {
        return {
          ...prev,
          resources: buildFacilityLockResourceAssignments(getResources()),
        };
      }
      const next = { ...prev.resources };
      delete next[FACILITY_LOCK_CATEGORY_ID];
      return { ...prev, resources: next };
    });
  };
  
  // Helper to check if a resource is selected
  const isResourceSelected = (categoryId, resourceId) => {
    const categoryResources = scheduleFormData.resources[categoryId] || [];
    if (
      categoryResources &&
      typeof categoryResources === 'object' &&
      !Array.isArray(categoryResources) &&
      categoryResources.mode === 'pool'
    ) {
      return Array.isArray(categoryResources.pool) && categoryResources.pool.includes(resourceId);
    }
    const resourceArray = Array.isArray(categoryResources) 
      ? categoryResources 
      : categoryResources ? [categoryResources] : [];
    return resourceArray.includes(resourceId);
  };

  const getResourceAssignmentMode = (categoryId) => {
    const value = scheduleFormData.resources?.[categoryId];
    if (value && typeof value === 'object' && !Array.isArray(value) && value.mode === 'pool') {
      return 'pool';
    }
    return 'fixed';
  };

  // Edit a saved schedule - load it into the form
  const handleEditSchedule = (schedule) => {
    const isMulti = schedule.scheduleType === 'multiDay';
    setScheduleName(
      isMulti
        ? (schedule.seasonLabel || parseMultiDaySeasonLabel(schedule.scheduleName).seasonLabel || stripMultiDaySchedulePrefix(schedule.scheduleName))
        : schedule.scheduleName,
    );
    setEditingScheduleName(schedule.scheduleName);
    if (
      (schedule.scheduleType === 'individual' || schedule.scheduleType === 'multiDay')
      && schedule.individualDatesSlots
    ) {
      setScheduleMode(schedule.scheduleType === 'multiDay' ? 'multiDay' : 'individual');
      setIndividualDatesSlots(schedule.individualDatesSlots);
      setScheduleTimeSlots({});
      setScheduleDateRange({ startDate: '', endDate: '' });
      setIsIndefiniteSchedule(true);
    } else {
      setScheduleMode('regular');
      setIndividualDatesSlots({});
      const isIndefinite = !schedule.startDate && !schedule.endDate;
      setIsIndefiniteSchedule(isIndefinite);
      setScheduleDateRange({
        startDate: schedule.startDate || '',
        endDate: schedule.endDate || ''
      });
      setScheduleTimeSlots(schedule.timeSlots || {});
    }

    // Switch to the Schedule tab so user can see the loaded schedule
    setRegularModalActiveTab('schedule');

    // Scroll the editor into view — Edit lives below the form, so without this
    // staff often miss that the schedule loaded above.
    setTimeout(() => {
      scheduleEditorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      const weekCount = schedule.weekCount || Object.keys(schedule.individualDatesSlots || {}).length;
      toast.success(
        isMulti
          ? `Loaded "${stripMultiDaySchedulePrefix(schedule.scheduleName)}" (${weekCount} week day-set(s)) — add more weeks below, then Update`
          : `Loaded schedule "${schedule.scheduleName}" for editing`,
      );
    }, 50);
  };

  // Load schedules for an activity (used for reloading after save/delete)
  const loadActivitySchedules = async (activityId) => {
    if (!activityId) return;
    
    try {
      // Load all schedules from booking_activity_schedules
      const { data: allSchedules, error: schedulesError } = await supabase
        .from('booking_activity_schedules')
        .select('*')
        .eq('activity_id', activityId)
        .eq('is_active', true)
        .order('schedule_name', { ascending: true })
        .order('day_of_week', { ascending: true })
        .order('start_time', { ascending: true });
      
      if (schedulesError) {
        // Table might not exist yet (42P01) or other error - just log and continue
        if (schedulesError.code === '42P01') {
          console.warn('booking_activity_schedules table does not exist yet. Please run the migration: bookings_create_activity_schedules_table.sql');
        } else {
          console.error('Error loading schedules:', schedulesError);
        }
        // Don't throw - schedules might not exist yet
        setSavedSchedules([]);
        return;
      }
      
      console.log('📊 All schedules from DB:', allSchedules);
      console.log('📊 Total schedules found:', (allSchedules || []).length);
      
      // Group schedules by schedule_name
      const schedulesByName = {};
      (allSchedules || []).forEach(schedule => {
        // Use the actual schedule_name from database, or 'Unnamed Schedule' if null/empty
        const scheduleName = (schedule.schedule_name && schedule.schedule_name.trim()) 
          ? schedule.schedule_name.trim() 
          : 'Unnamed Schedule';
        if (!schedulesByName[scheduleName]) {
          schedulesByName[scheduleName] = {
            id: scheduleName, // Use name as ID for now
            scheduleName: scheduleName, // Store the actual name
            startDate: schedule.start_date || '',
            endDate: schedule.end_date || '',
            timeSlots: {}
          };
        }
      });
      
      // Convert database format to UI format for each schedule group
      const numberToDay = {
        0: 'Sunday',
        1: 'Monday',
        2: 'Tuesday',
        3: 'Wednesday',
        4: 'Thursday',
        5: 'Friday',
        6: 'Saturday'
      };

      Object.keys(schedulesByName).forEach(scheduleName => {
        // Filter schedules that match this name (handle null/empty schedule_name)
        const schedulesForName = (allSchedules || []).filter(s => {
          const sName = (s.schedule_name && s.schedule_name.trim()) 
            ? s.schedule_name.trim() 
            : 'Unnamed Schedule';
          return sName === scheduleName;
        });
        const timeSlotsByDay = {};
        
        // Get date range from first schedule (all schedules with same name share date range)
        const firstSchedule = schedulesForName[0];
        if (firstSchedule) {
          schedulesByName[scheduleName].startDate = firstSchedule.start_date || '';
          schedulesByName[scheduleName].endDate = firstSchedule.end_date || '';
          schedulesByName[scheduleName].isIndefinite = !firstSchedule.start_date && !firstSchedule.end_date;
          // For "most recent" tie-break: max of updated_at or created_at across all rows for this schedule
          const timestamps = schedulesForName.map(s => new Date(s.updated_at || s.created_at || 0).getTime());
          schedulesByName[scheduleName].lastUpdated = timestamps.length ? Math.max(...timestamps) : 0;
        }
        
        schedulesForName.forEach(schedule => {
          const day = numberToDay[schedule.day_of_week];
          if (!timeSlotsByDay[day]) {
            timeSlotsByDay[day] = [];
          }
          // Normalize resources: keep pool objects (incl. combinations), facility lock, coerce legacy singles
          const normalizedResources = {};
          if (schedule.resource_assignments) {
            Object.keys(schedule.resource_assignments).forEach(categoryId => {
              const value = schedule.resource_assignments[categoryId];
              if (value && typeof value === 'object' && !Array.isArray(value) && value.mode === 'facility_lock') {
                normalizedResources[categoryId] = { mode: 'facility_lock' };
              } else if (value && typeof value === 'object' && !Array.isArray(value) && value.mode === 'pool') {
                const pool = Array.isArray(value.pool) ? value.pool.filter(Boolean) : [];
                const count = Math.max(1, Math.min(pool.length || 1, Number.parseInt(value.count, 10) || 1));
                const allowed = Array.isArray(value.allowed_combinations)
                  ? value.allowed_combinations
                  : Array.isArray(value.allowedCombinations)
                    ? value.allowedCombinations
                    : [];
                normalizedResources[categoryId] = {
                  mode: 'pool',
                  count,
                  pool,
                  ...(allowed.length ? { allowed_combinations: allowed } : {}),
                };
              } else {
                normalizedResources[categoryId] = Array.isArray(value)
                  ? value
                  : value ? [value] : [];
              }
            });
          }
          timeSlotsByDay[day].push({
            startTime: schedule.start_time,
            spaces: schedule.spaces,
            resources: normalizedResources
          });
        });

        // Sort slots by time within each day
        Object.keys(timeSlotsByDay).forEach(day => {
          timeSlotsByDay[day].sort((a, b) => {
            return compareTimeStrings(a.startTime, b.startTime);
          });
        });

        schedulesByName[scheduleName].timeSlots = timeSlotsByDay;

        // Detect individual-dates schedule: all rows have start_date === end_date (one date per row)
        const allSameDateRange = schedulesForName.every(s => s.start_date && s.end_date && s.start_date === s.end_date);
        const distinctDates = [...new Set(schedulesForName.map(s => s.start_date).filter(Boolean))];
        if (allSameDateRange && distinctDates.length > 0) {
          schedulesByName[scheduleName].scheduleType = isMultiDayScheduleName(scheduleName)
            ? 'multiDay'
            : 'individual';
          const byDate = {};
          schedulesForName.forEach(s => {
            const dateStr = s.start_date;
            if (!byDate[dateStr]) byDate[dateStr] = [];
            const normalizedResources = {};
            if (s.resource_assignments) {
              Object.keys(s.resource_assignments).forEach(categoryId => {
                const value = s.resource_assignments[categoryId];
                if (value && typeof value === 'object' && !Array.isArray(value) && value.mode === 'facility_lock') {
                  normalizedResources[categoryId] = { mode: 'facility_lock' };
                } else if (value && typeof value === 'object' && !Array.isArray(value) && value.mode === 'pool') {
                  const pool = Array.isArray(value.pool) ? value.pool.filter(Boolean) : [];
                  const count = Math.max(1, Math.min(pool.length || 1, Number.parseInt(value.count, 10) || 1));
                  const allowed = Array.isArray(value.allowed_combinations)
                    ? value.allowed_combinations
                    : Array.isArray(value.allowedCombinations)
                      ? value.allowedCombinations
                      : [];
                  normalizedResources[categoryId] = {
                    mode: 'pool',
                    count,
                    pool,
                    ...(allowed.length ? { allowed_combinations: allowed } : {}),
                  };
                } else {
                  normalizedResources[categoryId] = Array.isArray(value) ? value : value ? [value] : [];
                }
              });
            }
            byDate[dateStr].push({
              startTime: s.start_time,
              spaces: s.spaces,
              resources: normalizedResources
            });
          });
          Object.keys(byDate).forEach(d => {
            byDate[d].sort((a, b) => compareTimeStrings(a.startTime, b.startTime));
          });
          schedulesByName[scheduleName].individualDatesSlots = byDate;
        } else {
          schedulesByName[scheduleName].scheduleType = 'regular';
        }
      });

      // Merge multi-day week schedules that share a season label into one editable card
      const mergedByKey = new Map();
      Object.values(schedulesByName).forEach((entry) => {
        if (entry.scheduleType === 'multiDay') {
          const { seasonLabel } = parseMultiDaySeasonLabel(entry.scheduleName);
          const mergeKey = `multiDay:${seasonLabel || entry.scheduleName}`;
          if (!mergedByKey.has(mergeKey)) {
            mergedByKey.set(mergeKey, {
              ...entry,
              scheduleName: buildMultiDayScheduleName(seasonLabel || stripMultiDaySchedulePrefix(entry.scheduleName)),
              seasonLabel: seasonLabel || stripMultiDaySchedulePrefix(entry.scheduleName),
              individualDatesSlots: { ...(entry.individualDatesSlots || {}) },
              weekCount: 1,
              memberScheduleNames: [entry.scheduleName],
            });
            return;
          }
          const existing = mergedByKey.get(mergeKey);
          Object.entries(entry.individualDatesSlots || {}).forEach(([dateStr, slots]) => {
            if (!existing.individualDatesSlots[dateStr]) {
              existing.individualDatesSlots[dateStr] = slots;
            } else {
              existing.individualDatesSlots[dateStr] = [
                ...existing.individualDatesSlots[dateStr],
                ...slots,
              ];
            }
          });
          existing.weekCount = (existing.weekCount || 1) + 1;
          existing.memberScheduleNames = [...(existing.memberScheduleNames || []), entry.scheduleName];
          existing.lastUpdated = Math.max(existing.lastUpdated || 0, entry.lastUpdated || 0);
          return;
        }
        mergedByKey.set(`other:${entry.scheduleName}`, entry);
      });

      // Recompute weekCount from date runs for accuracy
      mergedByKey.forEach((entry) => {
        if (entry.scheduleType !== 'multiDay') return;
        const dateKeys = Object.keys(entry.individualDatesSlots || {}).sort();
        entry.weekCount = splitDateKeysIntoWeekRuns(dateKeys).length;
      });

      const savedSchedulesList = [...mergedByKey.values()];
      const indefiniteSchedules = savedSchedulesList.filter(s => s.isIndefinite);
      const sortedIndefinite = [...indefiniteSchedules].sort((a, b) => (b.lastUpdated || 0) - (a.lastUpdated || 0));
      sortedIndefinite.forEach((s, index) => {
        s.isActiveIndefiniteSchedule = index === 0;
      });
      console.log('📅 Loaded saved schedules:', savedSchedulesList);
      console.log('📅 Number of schedules:', savedSchedulesList.length);
      setSavedSchedules(savedSchedulesList);
    } catch (error) {
      console.error('Error loading schedules:', error);
      setSavedSchedules([]);
    }
  };

  // Save schedules for the current activity (extracted for reuse)
  const saveCurrentSchedules = async (activityId) => {
    const hasTimeSlots = Object.keys(scheduleTimeSlots).some(day => {
      const slots = scheduleTimeSlots[day];
      return slots && Array.isArray(slots) && slots.length > 0;
    });
    const hasIndividualSlots = Object.keys(individualDatesSlots).some(dateStr => {
      const slots = individualDatesSlots[dateStr];
      return slots && Array.isArray(slots) && slots.length > 0;
    });

    if (scheduleMode === 'individual' || scheduleMode === 'multiDay') {
      if (!hasIndividualSlots) return;
      const dates = Object.keys(individualDatesSlots).filter(d => (individualDatesSlots[d] || []).length > 0).sort();
      const isMultiDay = scheduleMode === 'multiDay';
      if (isMultiDay && !scheduleName.trim()) {
        toast.error('Please enter a season / event name (e.g. Summer Camp 2026)');
        throw new Error('Multi-day name required');
      }
      try {
        let schedulesToInsert = [];
        let toastLabel = '';

        if (isMultiDay) {
          const seasonLabel = scheduleName.trim();
          const weekRuns = splitDateKeysIntoWeekRuns(dates);
          await deleteMultiDaySeasonSchedules(activityId, seasonLabel, [editingScheduleName].filter(Boolean));

          weekRuns.forEach((runDates) => {
            const weekName = buildMultiDayWeekScheduleName(seasonLabel, runDates[0]);
            runDates.forEach((dateStr) => {
              const slots = individualDatesSlots[dateStr] || [];
              if (!slots.length) return;
              const dayOfWeek = new Date(`${dateStr}T12:00:00`).getDay();
              slots.forEach((slot) => {
                const sp = Math.max(0, parseInt(slot.spaces, 10) || 1);
                schedulesToInsert.push({
                  activity_id: activityId,
                  business_id: auth.selectedBusinessId,
                  day_of_week: dayOfWeek,
                  start_time: slot.startTime,
                  spaces: sp,
                  nominal_max_spaces: sp,
                  resource_assignments: slot.resources || {},
                  schedule_name: weekName,
                  start_date: dateStr,
                  end_date: dateStr,
                  is_active: true,
                });
              });
            });
          });
          toastLabel = `${seasonLabel} (${weekRuns.length} week${weekRuns.length === 1 ? '' : 's'})`;
        } else {
          const trimmedName = dates.length > 0 ? `Individual: ${dates.join(', ')}` : '';
          if (!trimmedName) return;
          toastLabel = trimmedName;
          const deleteTargetName = editingScheduleName || trimmedName;
          await deleteActivitySchedulesByName(activityId, deleteTargetName);

          Object.entries(individualDatesSlots).forEach(([dateStr, slots]) => {
            if (!slots || slots.length === 0) return;
            const d = new Date(dateStr + 'T12:00:00');
            const dayOfWeek = d.getDay();
            slots.forEach(slot => {
              const sp = Math.max(0, parseInt(slot.spaces, 10) || 1);
              schedulesToInsert.push({
                activity_id: activityId,
                business_id: auth.selectedBusinessId,
                day_of_week: dayOfWeek,
                start_time: slot.startTime,
                spaces: sp,
                nominal_max_spaces: sp,
                resource_assignments: slot.resources || {},
                schedule_name: trimmedName,
                start_date: dateStr,
                end_date: dateStr,
                is_active: true
              });
            });
          });
        }

        if (schedulesToInsert.length === 0) return;
        const { error: insertError } = await supabase
          .from('booking_activity_schedules')
          .insert(schedulesToInsert);
        if (insertError) {
          if (insertError.code === '42P01') {
            toast.error('Table does not exist. Please run the migration first.');
          } else {
            toast.error(`Error saving schedule: ${insertError.message}`);
          }
          throw insertError;
        }

        if (isMultiDay) {
          const durationMinutes =
            (Number(activityDuration.days) || 0) * 24 * 60 +
            (Number(activityDuration.hours) || 0) * 60 +
            (Number(activityDuration.minutes) || 0) || 480;
          // Prefer the longest week run for dayCount / full-week pricing baseline.
          const weekRuns = splitDateKeysIntoWeekRuns(dates);
          const sampleWeek = weekRuns.reduce(
            (best, run) => ((!best || run.length > best.length) ? run : best),
            null,
          ) || dates;
          const multiDay = buildMultiDayTicketSettingsFromDates(sampleWeek, durationMinutes);
          if (multiDay) {
            const { data: activityRow } = await supabase
              .from('booking_activities')
              .select('ticket_settings')
              .eq('id', activityId)
              .maybeSingle();
            const nextTicketSettings = {
              ...(activityRow?.ticket_settings && typeof activityRow.ticket_settings === 'object'
                ? activityRow.ticket_settings
                : {}),
              multiDay,
            };
            await supabase
              .from('booking_activities')
              .update({ ticket_settings: nextTicketSettings, updated_at: new Date().toISOString() })
              .eq('id', activityId);
          }
        }

        const action = editingScheduleName ? 'updated' : 'saved';
        toast.success(`Schedule "${toastLabel}" ${action}`);
        if (!editingScheduleName) {
          setIndividualDatesSlots({});
          setScheduleName('');
        }
        setEditingScheduleName(null);
        await loadActivitySchedules(activityId);
      } catch (err) {
        console.error('Error saving individual/multi-day schedule:', err);
        throw err;
      }
      return;
    }

    if (!hasTimeSlots) return;

    // Validate schedule name
    const trimmedName = scheduleName.trim();
    if (!trimmedName) {
      toast.error('Please enter a schedule name before saving');
      throw new Error('Schedule name required');
    }

    // Validate schedule date range (only if not indefinite)
    if (!isIndefiniteSchedule) {
      if (scheduleDateRange.startDate && scheduleDateRange.endDate) {
        if (new Date(scheduleDateRange.startDate) > new Date(scheduleDateRange.endDate)) {
          toast.error('End date must be after start date');
          throw new Error('Invalid date range');
        }
      }
      // For date-specific schedules, require both dates
      if (!scheduleDateRange.startDate || !scheduleDateRange.endDate) {
        toast.error('Please provide both start and end dates for date-specific schedules');
        throw new Error('Date range required');
      }
    }

    const deleteTargetName = editingScheduleName || trimmedName;

    // --- Timed schedule overlap check: only one timed schedule per period (per activity) ---
    if (!isIndefiniteSchedule && scheduleDateRange.startDate && scheduleDateRange.endDate) {
      const { data: existingTimed } = await supabase
        .from('booking_activity_schedules')
        .select('schedule_name, start_date, end_date')
        .eq('activity_id', activityId)
        .eq('is_active', true)
        .not('start_date', 'is', null)
        .not('end_date', 'is', null);
      const byName = {};
      (existingTimed || []).forEach(row => {
        const name = (row.schedule_name || '').trim() || 'Unnamed Schedule';
        if (name === deleteTargetName) return;
        if (!byName[name]) byName[name] = { start_date: row.start_date, end_date: row.end_date };
      });
      const newStart = scheduleDateRange.startDate;
      const newEnd = scheduleDateRange.endDate;
      for (const name of Object.keys(byName)) {
        const ex = byName[name];
        if (ex.start_date && ex.end_date && newStart <= ex.end_date && newEnd >= ex.start_date) {
          toast.error(
            `Another date-specific schedule ("${name}") is active for this period. Only one timed schedule can be active at a time. Change this schedule's dates or the existing schedule's dates to remove the overlap.`
          );
          throw new Error('Timed schedule overlap');
        }
      }
    }

    // --- Booking conflict check: new schedule must accommodate existing bookings ---
    const dayToNumber = { Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6 };
    const normalizeTimeForCompare = (t) => {
      if (!t) return '';
      const s = String(t).trim();
      const m = s.match(/^(\d{1,2}):(\d{2})/);
      if (m) return `${m[1].padStart(2, '0')}:${m[2]}`;
      return s.substring(0, 5);
    };
    let bookingStart = null;
    let bookingEnd = null;
    if (isIndefiniteSchedule) {
      bookingStart = new Date().toISOString().split('T')[0];
      bookingEnd = null;
    } else {
      bookingStart = scheduleDateRange.startDate || null;
      bookingEnd = scheduleDateRange.endDate || null;
    }
    if (bookingStart) {
      let query = supabase.from('bookings').select('id, booking_date, booking_time, booking_number').eq('activity_id', activityId).gte('booking_date', bookingStart).neq('status', 'cancelled');
      if (bookingEnd) query = query.lte('booking_date', bookingEnd);
      const { data: existingBookings } = await query;
      const newSlotsByDay = {};
      Object.keys(scheduleTimeSlots).forEach(day => {
        const slots = scheduleTimeSlots[day];
        if (slots && Array.isArray(slots)) newSlotsByDay[dayToNumber[day]] = (slots || []).map(s => normalizeTimeForCompare(s.startTime));
      });
      const conflicting = [];
      (existingBookings || []).forEach(b => {
        const d = new Date(b.booking_date + 'T12:00:00');
        const dayOfWeek = d.getDay();
        const timeNorm = normalizeTimeForCompare(b.booking_time);
        const times = newSlotsByDay[dayOfWeek];
        if (!times || !times.includes(timeNorm)) conflicting.push(b);
      });
      if (conflicting.length > 0) {
        const list = conflicting.slice(0, 5).map(b => `${b.booking_date} ${b.booking_time || ''}`).join(', ');
        toast.error(
          `This schedule would invalidate ${conflicting.length} existing booking(s) (e.g. ${list}). Remove or reschedule those bookings, or change this schedule so it includes those dates/times.`
        );
        throw new Error('Booking conflict');
      }
    }

    try {
      // Delete existing schedule with this name (whether editing or creating)
      console.log('🔄 Deleting existing schedule:', deleteTargetName);
      const { deletedCount } = await deleteActivitySchedulesByName(activityId, deleteTargetName);
      if (deletedCount > 0) {
        console.log(`🔄 Removed ${deletedCount} existing schedule row(s) for "${deleteTargetName}"`);
      }

      // Build schedules to insert
      const dayToNumber = {
        'Sunday': 0,
        'Monday': 1,
        'Tuesday': 2,
        'Wednesday': 3,
        'Thursday': 4,
        'Friday': 5,
        'Saturday': 6
      };

      const schedulesToInsert = [];
      
      // Process all days in order to ensure we capture copied days
      const allDays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      allDays.forEach(day => {
        const slots = scheduleTimeSlots[day];
        if (slots && Array.isArray(slots) && slots.length > 0) {
          slots.forEach(slot => {
            const sp = Math.max(0, parseInt(slot.spaces, 10) || 1);
            schedulesToInsert.push({
              activity_id: activityId,
              business_id: auth.selectedBusinessId,
              day_of_week: dayToNumber[day],
              start_time: slot.startTime,
              spaces: sp,
              nominal_max_spaces: sp,
              resource_assignments: slot.resources || {},
              schedule_name: trimmedName,
              start_date: isIndefiniteSchedule ? null : (scheduleDateRange.startDate || null),
              end_date: isIndefiniteSchedule ? null : (scheduleDateRange.endDate || null),
              is_active: true
            });
          });
        }
      });

      if (schedulesToInsert.length === 0) {
        // This shouldn't happen since we checked hasTimeSlots, but just in case
        return;
      }

      // Insert new schedule
      console.log('💾 Inserting schedule:', trimmedName, 'with', schedulesToInsert.length, 'time slots');
      const { error: insertError } = await supabase
        .from('booking_activity_schedules')
        .insert(schedulesToInsert);

      if (insertError) {
        if (insertError.code === '42P01') {
          toast.error('Table does not exist. Please run the migration first.');
          throw new Error('Table does not exist');
        } else {
          console.error('Error inserting schedule:', insertError);
          toast.error(`Error saving schedule: ${insertError.message}`);
          throw insertError;
        }
      }

      // Success
      const action = editingScheduleName ? 'updated' : 'saved';
      console.log(`✅ Schedule "${trimmedName}" ${action} successfully`);
      
      // Clear form for next schedule (but don't clear if we're still editing)
      if (!editingScheduleName) {
        setScheduleTimeSlots({});
        setScheduleDateRange({ startDate: '', endDate: '' });
        setScheduleName('');
        setIsIndefiniteSchedule(true);
      }
      setEditingScheduleName(null);
    } catch (error) {
      console.error('Error saving schedule:', error);
      throw error; // Re-throw so caller can handle
    }
  };

  // Delete a saved schedule
  const handleDeleteSchedule = async (scheduleName, schedule = null) => {
    const displayLabel = schedule?.seasonLabel
      || (isMultiDayScheduleName(scheduleName) ? parseMultiDaySeasonLabel(scheduleName).seasonLabel : null)
      || scheduleName;
    if (!window.confirm(`Are you sure you want to delete the schedule "${displayLabel}"? This will delete all time slots for this schedule.`)) {
      return;
    }

    if (!editingActivityId) {
      toast.error('No activity selected');
      return;
    }

    try {
      let deletedCount = 0;
      if (schedule?.scheduleType === 'multiDay' || isMultiDayScheduleName(scheduleName)) {
        const seasonLabel = schedule?.seasonLabel || parseMultiDaySeasonLabel(scheduleName).seasonLabel;
        const result = await deleteMultiDaySeasonSchedules(
          editingActivityId,
          seasonLabel,
          [scheduleName, ...(schedule?.memberScheduleNames || [])],
        );
        deletedCount = result.deletedCount;
      } else {
        const result = await deleteActivitySchedulesByName(editingActivityId, scheduleName);
        deletedCount = result.deletedCount;
      }

      if (deletedCount === 0) {
        toast.error('Could not delete schedule. It may already be removed, or you may not have permission.');
        await loadActivitySchedules(editingActivityId);
        return;
      }

      toast.success('Schedule deleted successfully');
      if (editingScheduleName && (
        normalizeScheduleDisplayName(editingScheduleName) === normalizeScheduleDisplayName(scheduleName)
        || (schedule?.seasonLabel && parseMultiDaySeasonLabel(editingScheduleName).seasonLabel === schedule.seasonLabel)
      )) {
        setEditingScheduleName(null);
        setScheduleName('');
        setScheduleTimeSlots({});
        setScheduleDateRange({ startDate: '', endDate: '' });
        setIndividualDatesSlots({});
      }
      await loadActivitySchedules(editingActivityId);
    } catch (error) {
      console.error('Error deleting schedule:', error);
      toast.error(error.message || 'Error deleting schedule');
    }
  };

  // Load inventory items for Pricing tab
  const loadInventoryItems = async () => {
    if (!auth.selectedBusinessId) return;
    setLoadingInventory(true);
    try {
      // Match POS inventory list: only active items (false = deactivated in POS; null = legacy)
      let query = supabase
        .from('pos_inventory')
        .select('*')
        .eq('business_id', auth.selectedBusinessId)
        .or('is_active.eq.true,is_active.is.null')
        .order('name', { ascending: true });

      // Apply category filter
      if (selectedInventoryCategory) {
        query = query.eq('category_id', selectedInventoryCategory);
      }

      // Apply search filter
      if (inventorySearchTerm.trim()) {
        query = query.or(`name.ilike.%${inventorySearchTerm}%,sku.ilike.%${inventorySearchTerm}%,barcode.ilike.%${inventorySearchTerm}%`);
      }

      const { data, error } = await query;
      if (error) throw error;

      let items = data || [];
      
      // Always include selected items, even if they don't match the current filter
      const idsToKeepVisible = [
        ...selectedInventoryItems,
        ...optionInventoryPickerSelection,
      ].filter(Boolean);
      const uniqueKeepIds = [...new Set(idsToKeepVisible)];

      if (uniqueKeepIds.length > 0) {
        const { data: selectedData, error: selectedError } = await supabase
          .from('pos_inventory')
          .select('*')
          .eq('business_id', auth.selectedBusinessId)
          .in('id', uniqueKeepIds);
        
        if (!selectedError && selectedData) {
          // Merge selected items with filtered items, avoiding duplicates
          const existingIds = new Set(items.map(item => item.id));
          const additionalSelected = selectedData.filter(item => !existingIds.has(item.id));
          items = [...items, ...additionalSelected].sort((a, b) => a.name.localeCompare(b.name));
        }
      }

      setInventoryItems(items);
    } catch (error) {
      console.error('Error loading inventory items:', error);
      toast.error('Error loading inventory items');
      setInventoryItems([]);
    } finally {
      setLoadingInventory(false);
    }
  };

  /** Resolve full inventory rows for picker selections (preserves order; fetches IDs not in current search results). */
  const resolvePickerInventoryItems = async (selectedIds = []) => {
    const ids = [...new Set((selectedIds || []).filter(Boolean))];
    if (ids.length === 0 || !auth.selectedBusinessId) return [];

    const cached = inventoryItems.filter((item) => ids.includes(item.id));
    const cachedIdSet = new Set(cached.map((item) => item.id));
    const missingIds = ids.filter((id) => !cachedIdSet.has(id));

    let fetched = [];
    if (missingIds.length > 0) {
      const { data, error } = await supabase
        .from('pos_inventory')
        .select('*')
        .eq('business_id', auth.selectedBusinessId)
        .in('id', missingIds);
      if (!error && data) fetched = data;
    }

    const byId = new Map([...cached, ...fetched].map((item) => [item.id, item]));
    return ids.map((id) => byId.get(id)).filter(Boolean);
  };

  // Load inventory categories
  const loadInventoryCategories = async () => {
    if (!auth.selectedBusinessId) return;
    try {
      const { data, error } = await supabase
        .from('pos_categories')
        .select('id, name')
        .eq('business_id', auth.selectedBusinessId)
        .order('name', { ascending: true });

      if (error) throw error;
      setInventoryCategories(data || []);
    } catch (error) {
      console.error('Error loading inventory categories:', error);
      setInventoryCategories([]);
    }
  };

  /** Re-fetch selected ticket rows from pos_inventory so price/name match the live POS catalog (regular price). */
  const refreshSelectedInventoryFromCatalog = useCallback(async () => {
    if (!auth.selectedBusinessId || selectedInventoryItems.length === 0) return;
    try {
      const { data, error } = await supabase
        .from('pos_inventory')
        .select('*')
        .eq('business_id', auth.selectedBusinessId)
        .in('id', selectedInventoryItems);
      if (error) throw error;
      const freshById = new Map((data || []).map((row) => [row.id, row]));
      setInventoryItems((prev) =>
        prev.map((item) => {
          const fresh = freshById.get(item.id);
          return fresh ? { ...item, ...fresh } : item;
        })
      );
    } catch (e) {
      console.warn('[BookingSettings] refresh inventory from catalog failed', e);
    }
  }, [auth.selectedBusinessId, selectedInventoryItems]);

  useEffect(() => {
    if (regularModalActiveTab !== 'pricing') return;
    if (!editingActivityId || selectedInventoryItems.length === 0) return;
    void refreshSelectedInventoryFromCatalog();
  }, [
    regularModalActiveTab,
    editingActivityId,
    selectedInventoryItems,
    refreshSelectedInventoryFromCatalog
  ]);

  // Load selected inventory items from activity ticket_settings
  const loadSelectedInventoryItems = async (activityIdOverride = editingActivityId, options = {}) => {
    const targetActivityId = activityIdOverride || editingActivityId;
    const forceReload = options.force === true;
    let loadedSuccessfully = false;
    if (!targetActivityId || !auth.selectedBusinessId) {
      setSelectedInventoryItems([]);
      setInventoryItems([]);
      setTicketSettingsLoaded(false);
      return;
    }
    if (pricingDraftDirty && !forceReload) {
      return;
    }
    try {
      setHydratingTicketSettings(true);
      const { data, error } = await supabase
        .from('booking_activities')
        .select('ticket_settings, requires_waiver, requires_camper_registration, party_included_kids, party_included_adults, party_one_adult_per_child')
        .eq('id', targetActivityId)
        .single();

      if (error) throw error;

      // Always set requires_waiver from DB so it persists when re-opening the activity
      const requiresWaiverFromDb = data?.requires_waiver === true;
      console.log('[BookingSettings] loadSelectedInventoryItems: waiver from DB', {
        activityId: targetActivityId,
        rawRequiresWaiver: data?.requires_waiver,
        typeof: typeof data?.requires_waiver,
        settingRequiresWaiver: requiresWaiverFromDb,
      });
      setRequiresWaiver(requiresWaiverFromDb);
      setRequiresCamperRegistration(data?.requires_camper_registration === true);
      setPartyIncludedKids(
        data?.party_included_kids != null ? Number(data.party_included_kids) : null,
      );
      setPartyIncludedAdults(
        data?.party_included_adults != null ? Number(data.party_included_adults) : null,
      );
      setPartyOneAdultPerChildMode(partyOneAdultPerChildToMode(data?.party_one_adult_per_child));

      if (data?.ticket_settings) {
        const settings = typeof data.ticket_settings === 'string' 
          ? JSON.parse(data.ticket_settings) 
          : data.ticket_settings;

        setActivityImages(normalizeActivityImages(settings.activity_images));
        setActivityImageUrlInput('');
        setActivityImageUploadError(null);
        
        // Load ticket quantity limits
        setMinTickets(settings.min_tickets || null);
        setMaxTickets(settings.max_tickets || null);
        setOnlinePaymentSettings(parseOnlinePaymentSettings(settings));
        setExtensionPricingSettings(parseExtensionPricingSettings(settings));
        setPricingDraftDirty(false);
        
        // ticket_settings.inventory_item_ids should be an array of inventory item IDs
        const inventoryItemIds = resolveTicketInventoryItemIds(settings);
        if (inventoryItemIds.length > 0) {
          
          // Load the actual inventory items for display
          const { data: items, error: itemsError } = await supabase
            .from('pos_inventory')
            .select('*')
            .eq('business_id', auth.selectedBusinessId)
            .in('id', inventoryItemIds)
            .order('name', { ascending: true });

          if (itemsError) throw itemsError;
          const resolvedItems = items || [];
          const resolvedAssignmentRules = buildDefaultTicketAssignmentRules(
            resolvedItems.filter((item) => inventoryItemIds.includes(item.id)),
            Array.isArray(settings.assignment_rules) ? settings.assignment_rules : []
          );
          const resolvedPricingRules = buildDefaultTicketPricingRules(
            resolvedItems.filter((item) => inventoryItemIds.includes(item.id)),
            Array.isArray(settings.pricing_rules) ? settings.pricing_rules : []
          );
          setSelectedInventoryItems(inventoryItemIds);
          setInventoryItems(resolvedItems);
          setTicketAssignmentRules(resolvedAssignmentRules);
          setLoadedTicketAssignmentRules(resolvedAssignmentRules);
          setTicketPricingRules(resolvedPricingRules);
          setLoadedTicketPricingRules(resolvedPricingRules);
          loadedSuccessfully = true;
        } else {
          setActivityImages(normalizeActivityImages(settings.activity_images));
          setSelectedInventoryItems([]);
          setInventoryItems([]);
          setTicketAssignmentRules([]);
          setLoadedTicketAssignmentRules([]);
          setTicketPricingRules([]);
          setLoadedTicketPricingRules([]);
          setPricingDraftDirty(false);
          setTicketSettingsLoaded(true);
          loadedSuccessfully = true;
        }
      } else {
        setActivityImages([]);
        setActivityImageUrlInput('');
        setActivityImageUploadError(null);
        setSelectedInventoryItems([]);
        setInventoryItems([]);
        setMinTickets(null);
        setMaxTickets(null);
        setOnlinePaymentSettings(defaultOnlinePaymentSettings());
        setExtensionPricingSettings(defaultExtensionPricingSettings());
        setTicketAssignmentRules([]);
        setLoadedTicketAssignmentRules([]);
        setTicketPricingRules([]);
        setLoadedTicketPricingRules([]);
        setPricingDraftDirty(false);
        setTicketSettingsLoaded(true);
        loadedSuccessfully = true;
        // requires_waiver already set from data above
      }
    } catch (error) {
      console.error('Error loading selected inventory items:', error);
      setActivityImages([]);
      setActivityImageUrlInput('');
      setActivityImageUploadError(null);
      setSelectedInventoryItems([]);
      setInventoryItems([]);
      setTicketAssignmentRules([]);
      setLoadedTicketAssignmentRules([]);
      setTicketPricingRules([]);
      setLoadedTicketPricingRules([]);
      setPricingDraftDirty(false);
      setTicketSettingsLoaded(false);
    } finally {
      setHydratingTicketSettings(false);
      setTicketSettingsLoaded(loadedSuccessfully);
    }
  };

  // Load seasonal periods from database
  const loadSeasonalPeriods = async () => {
    try {
      const data = await seasonalPeriodService.getSeasonalPeriods(true); // Include inactive
      // Map database format to UI format
      setSeasonalPeriods((data || []).map(period => ({
        id: period.id,
        name: period.period_name,
        description: period.description,
        start_date: period.start_date,
        end_date: period.end_date,
        start_time: period.start_time || '',
        end_time: period.end_time || '',
        is_full_day: period.is_full_day !== false,
        is_active: period.is_active
      })));
    } catch (error) {
      console.error('Error loading seasonal periods:', error);
      // If table doesn't exist yet, just set empty array
      if (error.code === '42P01') {
        console.warn('booking_seasonal_periods table does not exist yet. Please run the migration: bookings_create_seasonal_periods_table.sql');
        setSeasonalPeriods([]);
      } else {
        toast.error('Error loading seasonal periods');
        setSeasonalPeriods([]);
      }
    }
  };

  // Seasonal period management functions
  const handleAddSeasonalPeriod = async () => {
    if (!newSeasonalPeriodName.trim()) {
      toast.error('Please enter a period name');
      return;
    }
    if (!newSeasonalPeriodStartDate) {
      toast.error('Please select a start date');
      return;
    }
    if (!newSeasonalPeriodEndDate) {
      toast.error('Please select an end date');
      return;
    }
    if (new Date(newSeasonalPeriodStartDate) > new Date(newSeasonalPeriodEndDate)) {
      toast.error('Start date must be before end date');
      return;
    }
    if (!newSeasonalPeriodFullDay) {
      if (!newSeasonalPeriodStartTime) {
        toast.error('Please select a start time');
        return;
      }
      if (!newSeasonalPeriodEndTime) {
        toast.error('Please select an end time');
        return;
      }
      // Validate time range
      if (newSeasonalPeriodStartDate === newSeasonalPeriodEndDate) {
        if (newSeasonalPeriodStartTime >= newSeasonalPeriodEndTime) {
          toast.error('End time must be after start time for same-day periods');
          return;
        }
      }
    }

    try {
      const newPeriod = await seasonalPeriodService.createSeasonalPeriod({
        period_name: newSeasonalPeriodName.trim(),
        start_date: newSeasonalPeriodStartDate,
        end_date: newSeasonalPeriodEndDate,
        start_time: newSeasonalPeriodFullDay ? null : newSeasonalPeriodStartTime,
        end_time: newSeasonalPeriodFullDay ? null : newSeasonalPeriodEndTime,
        is_full_day: newSeasonalPeriodFullDay
      });
      
      // Map database format to UI format
      setSeasonalPeriods([...seasonalPeriods, {
        id: newPeriod.id,
        name: newPeriod.period_name,
        description: newPeriod.description,
        start_date: newPeriod.start_date,
        end_date: newPeriod.end_date,
        start_time: newPeriod.start_time || '',
        end_time: newPeriod.end_time || '',
        is_full_day: newPeriod.is_full_day !== false,
        is_active: newPeriod.is_active
      }]);
      setNewSeasonalPeriodName('');
      setNewSeasonalPeriodStartDate('');
      setNewSeasonalPeriodEndDate('');
      setNewSeasonalPeriodStartTime('');
      setNewSeasonalPeriodEndTime('');
      setNewSeasonalPeriodFullDay(true);
      setShowAddSeasonalPeriod(false);
      toast.success('Seasonal period added');
    } catch (error) {
      console.error('Error creating seasonal period:', error);
      if (error.code === '42P01') {
        toast.error('Table does not exist. Please run the migration first.');
      } else {
        toast.error('Error creating seasonal period');
      }
    }
  };

  const handleEditSeasonalPeriod = (periodId) => {
    const period = seasonalPeriods.find(p => p.id === periodId);
    if (period) {
      setEditingSeasonalPeriodId(periodId);
      setEditingSeasonalPeriodName(period.name);
      setEditingSeasonalPeriodStartDate(period.start_date);
      setEditingSeasonalPeriodEndDate(period.end_date);
      setEditingSeasonalPeriodStartTime(period.start_time || '');
      setEditingSeasonalPeriodEndTime(period.end_time || '');
      setEditingSeasonalPeriodFullDay(period.is_full_day !== false);
    }
  };

  const handleSaveSeasonalPeriod = async () => {
    if (!editingSeasonalPeriodName.trim()) {
      toast.error('Please enter a period name');
      return;
    }
    if (!editingSeasonalPeriodStartDate) {
      toast.error('Please select a start date');
      return;
    }
    if (!editingSeasonalPeriodEndDate) {
      toast.error('Please select an end date');
      return;
    }
    if (new Date(editingSeasonalPeriodStartDate) > new Date(editingSeasonalPeriodEndDate)) {
      toast.error('Start date must be before end date');
      return;
    }
    if (!editingSeasonalPeriodFullDay) {
      if (!editingSeasonalPeriodStartTime) {
        toast.error('Please select a start time');
        return;
      }
      if (!editingSeasonalPeriodEndTime) {
        toast.error('Please select an end time');
        return;
      }
      // Validate time range
      if (editingSeasonalPeriodStartDate === editingSeasonalPeriodEndDate) {
        if (editingSeasonalPeriodStartTime >= editingSeasonalPeriodEndTime) {
          toast.error('End time must be after start time for same-day periods');
          return;
        }
      }
    }

    try {
      const updatedPeriod = await seasonalPeriodService.updateSeasonalPeriod(
        editingSeasonalPeriodId,
        {
          period_name: editingSeasonalPeriodName.trim(),
          start_date: editingSeasonalPeriodStartDate,
          end_date: editingSeasonalPeriodEndDate,
          start_time: editingSeasonalPeriodFullDay ? null : editingSeasonalPeriodStartTime,
          end_time: editingSeasonalPeriodFullDay ? null : editingSeasonalPeriodEndTime,
          is_full_day: editingSeasonalPeriodFullDay
        }
      );
      
      // Map database format to UI format
      setSeasonalPeriods(seasonalPeriods.map(period =>
        period.id === editingSeasonalPeriodId
          ? {
              id: updatedPeriod.id,
              name: updatedPeriod.period_name,
              description: updatedPeriod.description,
              start_date: updatedPeriod.start_date,
              end_date: updatedPeriod.end_date,
              start_time: updatedPeriod.start_time || '',
              end_time: updatedPeriod.end_time || '',
              is_full_day: updatedPeriod.is_full_day !== false,
              is_active: updatedPeriod.is_active
            }
          : period
      ));
      setEditingSeasonalPeriodId(null);
      setEditingSeasonalPeriodName('');
      setEditingSeasonalPeriodStartDate('');
      setEditingSeasonalPeriodEndDate('');
      setEditingSeasonalPeriodStartTime('');
      setEditingSeasonalPeriodEndTime('');
      setEditingSeasonalPeriodFullDay(true);
      toast.success('Seasonal period updated');
    } catch (error) {
      console.error('Error updating seasonal period:', error);
      if (error.code === '42P01') {
        toast.error('Table does not exist. Please run the migration first.');
      } else {
        toast.error('Error updating seasonal period');
      }
    }
  };

  const handleDeleteSeasonalPeriod = async (periodId) => {
    try {
      await seasonalPeriodService.deleteSeasonalPeriod(periodId);
      setSeasonalPeriods(seasonalPeriods.filter(period => period.id !== periodId));
      toast.success('Seasonal period deleted');
    } catch (error) {
      console.error('Error deleting seasonal period:', error);
      if (error.code === '42P01') {
        toast.error('Table does not exist. Please run the migration first.');
      } else {
        toast.error('Error deleting seasonal period');
      }
    }
  };

  // Free with purchase (Promotions modal)
  const loadFreeWithPurchasePromotions = async () => {
    if (!auth.selectedBusinessId) return;
    setLoadingFwp(true);
    try {
      const { data, error } = await supabase
        .from('pos_free_with_purchase_promotions')
        .select('*')
        .eq('business_id', auth.selectedBusinessId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      setFreeWithPurchasePromotions(data || []);
    } catch (err) {
      if (err.code === '42P01') {
        setFreeWithPurchasePromotions([]);
      } else {
        console.error('Error loading free-with-purchase promotions:', err);
        toast.error('Error loading promotions');
        setFreeWithPurchasePromotions([]);
      }
    } finally {
      setLoadingFwp(false);
    }
  };

  const loadFwpInventoryAndCategories = async () => {
    if (!auth.selectedBusinessId) return;
    try {
      const [invRes, catRes] = await Promise.all([
        supabase
          .from('pos_inventory')
          .select('id, name, category_id')
          .eq('business_id', auth.selectedBusinessId)
          .or('is_active.eq.true,is_active.is.null')
          .order('name', { ascending: true }),
        supabase.from('pos_categories').select('id, name, emoji').eq('business_id', auth.selectedBusinessId).order('name', { ascending: true })
      ]);
      if (invRes.error) throw invRes.error;
      if (catRes.error) throw catRes.error;
      setFwpInventory(invRes.data || []);
      setFwpCategories(catRes.data || []);
    } catch (err) {
      console.error('Error loading inventory for promotions:', err);
      setFwpInventory([]);
      setFwpCategories([]);
    }
  };

  useEffect(() => {
    if (showFreeWithPurchaseView && auth.selectedBusinessId && showPromotionsModal) {
      loadFreeWithPurchasePromotions();
      loadFwpInventoryAndCategories();
    }
  }, [showFreeWithPurchaseView, auth.selectedBusinessId, showPromotionsModal]);

  const openFwpForm = (promo = null) => {
    setShowFwpForm(true);
    if (promo) {
      setEditingFwpId(promo.id);
      setFwpForm({
        quantity: promo.quantity ?? 1,
        free_item_id: promo.free_item_id || null,
        free_category_filter: '',
        trigger_item_ids: Array.isArray(promo.trigger_item_ids) ? promo.trigger_item_ids : [],
        trigger_category_filter: ''
      });
    } else {
      setEditingFwpId(null);
      setFwpForm({
        quantity: 1,
        free_item_id: null,
        free_category_filter: '',
        trigger_item_ids: [],
        trigger_category_filter: ''
      });
    }
  };

  const cancelFwpForm = () => {
    setShowFwpForm(false);
    setEditingFwpId(null);
    setFwpForm({ quantity: 1, free_item_id: null, free_category_filter: '', trigger_item_ids: [], trigger_category_filter: '' });
  };

  const toggleFwpTriggerItem = (itemId) => {
    setFwpForm(prev => ({
      ...prev,
      trigger_item_ids: prev.trigger_item_ids.includes(itemId)
        ? prev.trigger_item_ids.filter(id => id !== itemId)
        : [...prev.trigger_item_ids, itemId]
    }));
  };

  const saveFwpPromotion = async () => {
    if (!fwpForm.free_item_id) {
      toast.error('Please select the free item');
      return;
    }
    if (!auth.selectedBusinessId) return;
    setLoadingFwp(true);
    try {
      const payload = {
        business_id: auth.selectedBusinessId,
        quantity: Math.max(1, parseInt(fwpForm.quantity, 10) || 1),
        free_item_id: fwpForm.free_item_id,
        trigger_item_ids: Array.isArray(fwpForm.trigger_item_ids) ? fwpForm.trigger_item_ids : [],
        updated_at: new Date().toISOString()
      };
      if (editingFwpId) {
        const { error } = await supabase
          .from('pos_free_with_purchase_promotions')
          .update(payload)
          .eq('id', editingFwpId);
        if (error) throw error;
        toast.success('Promotion updated');
      } else {
        const { error } = await supabase
          .from('pos_free_with_purchase_promotions')
          .insert([payload]);
        if (error) throw error;
        toast.success('Promotion added');
      }
      setShowFwpForm(false);
      setEditingFwpId(null);
      setFwpForm({ quantity: 1, free_item_id: null, free_category_filter: '', trigger_item_ids: [], trigger_category_filter: '' });
      loadFreeWithPurchasePromotions();
    } catch (err) {
      console.error('Error saving free-with-purchase promotion:', err);
      toast.error(err.message || 'Error saving promotion');
    } finally {
      setLoadingFwp(false);
    }
  };

  const deleteFwpPromotion = async (id) => {
    try {
      const { error } = await supabase.from('pos_free_with_purchase_promotions').delete().eq('id', id);
      if (error) throw error;
      toast.success('Promotion removed');
      setFreeWithPurchasePromotions(prev => prev.filter(p => p.id !== id));
    } catch (err) {
      console.error('Error deleting promotion:', err);
      toast.error('Error deleting promotion');
    }
  };

  // Resource management functions
  const generateId = (name) => {
    return name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  };

  const handleSaveResourceCategory = async () => {
    if (!resourceCategoryName.trim()) {
      toast.error('Please enter a category name');
      return;
    }

    try {
      const categoryId = editingResourceCategory 
        ? editingResourceCategory.categoryId 
        : generateId(resourceCategoryName);

      const updatedResources = [...resources];
      
      if (editingResourceCategory) {
        // Update existing category
        const index = updatedResources.findIndex(cat => cat.categoryId === editingResourceCategory.categoryId);
        if (index !== -1) {
          updatedResources[index] = {
            ...updatedResources[index],
            categoryName: resourceCategoryName.trim(),
            defaultPaddingBeforeMinutes: parsePaddingMinutes(categoryPaddingBeforeMinutes, 0),
            defaultPaddingAfterMinutes: parsePaddingMinutes(categoryPaddingAfterMinutes, 0),
            cumulativePadding: !!categoryCumulativePadding,
          };
        }
      } else {
        // Add new category
        updatedResources.push({
          categoryId,
          categoryName: resourceCategoryName.trim(),
          defaultPaddingBeforeMinutes: parsePaddingMinutes(categoryPaddingBeforeMinutes, 0),
          defaultPaddingAfterMinutes: parsePaddingMinutes(categoryPaddingAfterMinutes, 0),
          cumulativePadding: !!categoryCumulativePadding,
          resources: []
        });
      }

      await bookingSettingsService.setBookingResources(updatedResources);
      setResources(updatedResources);
      setShowResourceCategoryModal(false);
      setEditingResourceCategory(null);
      setResourceCategoryName('');
      setResourceCategoryId('');
      setCategoryPaddingBeforeMinutes('0');
      setCategoryPaddingAfterMinutes('30');
      setCategoryCumulativePadding(false);
      toast.success(`Category ${editingResourceCategory ? 'updated' : 'added'} successfully`);
    } catch (error) {
      console.error('Error saving resource category:', error);
      toast.error('Error saving category');
    }
  };

  const handleDeleteResourceCategory = async (categoryId) => {
    try {
      const updatedResources = resources.filter(cat => cat.categoryId !== categoryId);
      await bookingSettingsService.setBookingResources(updatedResources);
      setResources(updatedResources);
      toast.success('Category deleted successfully');
    } catch (error) {
      console.error('Error deleting resource category:', error);
      toast.error('Error deleting category');
    }
  };

  const handleOpenResourceCategoryModal = (category = null) => {
    if (category) {
      setEditingResourceCategory(category);
      setResourceCategoryName(category.categoryName);
      setResourceCategoryId(category.categoryId);
      setCategoryPaddingBeforeMinutes(String(parsePaddingMinutes(category.defaultPaddingBeforeMinutes, 0)));
      setCategoryPaddingAfterMinutes(String(parsePaddingMinutes(category.defaultPaddingAfterMinutes, 30)));
      setCategoryCumulativePadding(!!category.cumulativePadding);
    } else {
      setEditingResourceCategory(null);
      setResourceCategoryName('');
      setResourceCategoryId('');
      setCategoryPaddingBeforeMinutes('0');
      setCategoryPaddingAfterMinutes('30');
      setCategoryCumulativePadding(false);
    }
    setShowResourceCategoryModal(true);
  };

  const handleSaveResource = async () => {
    if (!resourceName.trim()) {
      toast.error('Please enter a resource name');
      return;
    }

    if (!selectedResourceCategory) {
      toast.error('Please select a category');
      return;
    }

    try {
      const resourceId = editingResource 
        ? editingResource.id 
        : generateId(resourceName);

      const updatedResources = resources.map(category => {
        if (category.categoryId === selectedResourceCategory.categoryId) {
          const updatedCategoryResources = [...category.resources];
          
          if (editingResource) {
            // Update existing resource
            const index = updatedCategoryResources.findIndex(r => r.id === editingResource.id);
            if (index !== -1) {
              const nextResource = {
                id: resourceId,
                name: resourceName.trim(),
              };
              if (resourcePaddingBeforeMinutes !== '') {
                nextResource.paddingBeforeMinutes = parsePaddingMinutes(resourcePaddingBeforeMinutes, 0);
              }
              if (resourcePaddingAfterMinutes !== '') {
                nextResource.paddingAfterMinutes = parsePaddingMinutes(resourcePaddingAfterMinutes, 0);
              }
              if (!resourceUseCategoryCumulativeDefault) {
                nextResource.cumulativePadding = !!resourceCumulativePadding;
              }
              const qty = parseResourceQuantity(resourceQuantity, 1);
              if (qty > 1) {
                nextResource.quantity = qty;
              }
              updatedCategoryResources[index] = nextResource;
            }
          } else {
            // Add new resource
            const nextResource = {
              id: resourceId,
              name: resourceName.trim(),
            };
            if (resourcePaddingBeforeMinutes !== '') {
              nextResource.paddingBeforeMinutes = parsePaddingMinutes(resourcePaddingBeforeMinutes, 0);
            }
            if (resourcePaddingAfterMinutes !== '') {
              nextResource.paddingAfterMinutes = parsePaddingMinutes(resourcePaddingAfterMinutes, 0);
            }
            if (!resourceUseCategoryCumulativeDefault) {
              nextResource.cumulativePadding = !!resourceCumulativePadding;
            }
            const qty = parseResourceQuantity(resourceQuantity, 1);
            if (qty > 1) {
              nextResource.quantity = qty;
            }
            updatedCategoryResources.push(nextResource);
          }

          return {
            ...category,
            resources: updatedCategoryResources
          };
        }
        return category;
      });

      await bookingSettingsService.setBookingResources(updatedResources);
      setResources(updatedResources);
      setShowResourceModal(false);
      setEditingResource(null);
      setResourceName('');
      setResourceId('');
      setResourcePaddingBeforeMinutes('');
      setResourcePaddingAfterMinutes('');
      setResourceUseCategoryCumulativeDefault(true);
      setResourceCumulativePadding(false);
      setResourceQuantity('');
      setSelectedResourceCategory(null);
      toast.success(`Resource ${editingResource ? 'updated' : 'added'} successfully`);
    } catch (error) {
      console.error('Error saving resource:', error);
      toast.error('Error saving resource');
    }
  };

  const handleDeleteResource = async (categoryId, resourceId) => {
    try {
      const updatedResources = resources.map(category => {
        if (category.categoryId === categoryId) {
          return {
            ...category,
            resources: category.resources.filter(r => r.id !== resourceId)
          };
        }
        return category;
      });
      await bookingSettingsService.setBookingResources(updatedResources);
      setResources(updatedResources);
      toast.success('Resource deleted successfully');
    } catch (error) {
      console.error('Error deleting resource:', error);
      toast.error('Error deleting resource');
    }
  };

  const handleOpenResourceModal = (category, resource = null) => {
    setSelectedResourceCategory(category);
    if (resource) {
      setEditingResource(resource);
      setResourceName(resource.name);
      setResourceId(resource.id);
      setResourcePaddingBeforeMinutes(
        resource.paddingBeforeMinutes != null ? String(resource.paddingBeforeMinutes) : '',
      );
      setResourcePaddingAfterMinutes(
        resource.paddingAfterMinutes != null ? String(resource.paddingAfterMinutes) : '',
      );
      setResourceUseCategoryCumulativeDefault(resource.cumulativePadding == null);
      setResourceCumulativePadding(
        resource.cumulativePadding != null
          ? !!resource.cumulativePadding
          : !!category.cumulativePadding,
      );
      setResourceQuantity(
        resource.quantity != null && parseResourceQuantity(resource.quantity, 1) > 1
          ? String(parseResourceQuantity(resource.quantity, 1))
          : '',
      );
    } else {
      setEditingResource(null);
      setResourceName('');
      setResourceId('');
      setResourcePaddingBeforeMinutes('');
      setResourcePaddingAfterMinutes('');
      setResourceUseCategoryCumulativeDefault(true);
      setResourceCumulativePadding(!!category.cumulativePadding);
      setResourceQuantity('');
    }
    setShowResourceModal(true);
  };

  const sortedCategories = useMemo(
    () => [...categories].sort((a, b) => (a.display_order || 0) - (b.display_order || 0)),
    [categories],
  );

  const applyCategoryOrderLocally = (orderedCategories) => {
    const orderById = new Map(orderedCategories.map((category, index) => [category.id, index]));
    setCategories((prev) =>
      prev.map((category) => (
        orderById.has(category.id)
          ? { ...category, display_order: orderById.get(category.id) }
          : category
      )),
    );
  };

  const applyActivityOrderLocally = (categoryId, orderedCategoryActivities) => {
    const orderById = new Map(orderedCategoryActivities.map((activity, index) => [activity.id, index]));
    setActivities((prev) =>
      prev.map((activity) => {
        if (activity.type_id !== categoryId || !orderById.has(activity.id)) return activity;
        return { ...activity, display_order: orderById.get(activity.id) };
      }),
    );
  };

  const persistCategoryOrder = async (orderedCategories) => {
    applyCategoryOrderLocally(orderedCategories);
    try {
      await Promise.all(
        orderedCategories.map((category, index) =>
          bookingTypeService.updateBookingType(category.id, { display_order: index }),
        ),
      );
      toast.success('Category order updated');
    } catch (error) {
      if (error.code === 'PGRST204' || (error.message && error.message.includes('display_order'))) {
        toast.success('Category order updated (local only - run migration for persistence)');
        return;
      }
      throw error;
    }
  };

  const persistActivityOrder = async (categoryId, orderedCategoryActivities) => {
    applyActivityOrderLocally(categoryId, orderedCategoryActivities);
    try {
      await Promise.all(
        orderedCategoryActivities.map((activity, index) =>
          bookingActivityService.updateActivity(activity.id, { display_order: index }),
        ),
      );
      toast.success('Activity order updated');
    } catch (error) {
      if (error.code === 'PGRST204' || (error.message && error.message.includes('display_order'))) {
        toast.success('Activity order updated (local only - run migration for persistence)');
        return;
      }
      throw error;
    }
  };

  // Drag and drop handlers for categories
  const handleCategoryDragStart = (e, index) => {
    setDraggedCategoryIndex(index);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleCategoryDragOver = (e, index) => {
    e.preventDefault();
    if (draggedActivityIndex) return;
    e.dataTransfer.dropEffect = 'move';
    if (draggedCategoryIndex !== null && draggedCategoryIndex !== index) {
      setDragOverCategoryIndex(index);
    }
  };

  const handleCategoryDragLeave = () => {
    setDragOverCategoryIndex(null);
  };

  const handleCategoryDrop = async (e, dropIndex) => {
    e.preventDefault();
    // Ignore drops that belong to nested activity drag operations.
    if (draggedActivityIndex) {
      setDragOverCategoryIndex(null);
      return;
    }
    if (draggedCategoryIndex === null || draggedCategoryIndex === dropIndex) {
      setDraggedCategoryIndex(null);
      setDragOverCategoryIndex(null);
      return;
    }

    try {
      const updatedCategories = [...sortedCategories];
      const [draggedCategory] = updatedCategories.splice(draggedCategoryIndex, 1);
      updatedCategories.splice(dropIndex, 0, draggedCategory);
      await persistCategoryOrder(updatedCategories);
    } catch (error) {
      console.error('Error reordering categories:', error);
      toast.error('Error reordering categories');
    }

    setDraggedCategoryIndex(null);
    setDragOverCategoryIndex(null);
  };

  const handleCategoryDragEnd = () => {
    setDraggedCategoryIndex(null);
    setDragOverCategoryIndex(null);
  };

  const moveCategory = async (categoryId, direction) => {
    try {
      const currentIndex = sortedCategories.findIndex((category) => category.id === categoryId);
      if (currentIndex === -1) return;

      const newIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
      if (newIndex < 0 || newIndex >= sortedCategories.length) return;

      const updatedCategories = [...sortedCategories];
      [updatedCategories[currentIndex], updatedCategories[newIndex]] =
        [updatedCategories[newIndex], updatedCategories[currentIndex]];

      await persistCategoryOrder(updatedCategories);
    } catch (error) {
      console.error('Error moving category:', error);
      toast.error('Error moving category');
    }
  };

  // Drag and drop handlers for activities
  const handleActivityDragStart = (e, index, categoryId) => {
    e.stopPropagation();
    setDraggedActivityIndex({ index, categoryId });
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleActivityDragOver = (e, index, categoryId) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    if (draggedActivityIndex && draggedActivityIndex.index !== index && draggedActivityIndex.categoryId === categoryId) {
      setDragOverActivityIndex({ index, categoryId });
    }
  };

  const handleActivityDragLeave = () => {
    setDragOverActivityIndex(null);
  };

  const handleActivityDrop = async (e, dropIndex, categoryId) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (!draggedActivityIndex || draggedActivityIndex.index === dropIndex || draggedActivityIndex.categoryId !== categoryId) {
      setDraggedActivityIndex(null);
      setDragOverActivityIndex(null);
      return;
    }

    try {
      const categoryActivities = activities
        .filter(a => a.type_id === categoryId)
        .sort((a, b) => (a.display_order || 0) - (b.display_order || 0));
      
      const updatedActivities = [...categoryActivities];
      const [draggedActivity] = updatedActivities.splice(draggedActivityIndex.index, 1);
      updatedActivities.splice(dropIndex, 0, draggedActivity);

      await persistActivityOrder(categoryId, updatedActivities);
    } catch (error) {
      console.error('Error reordering activities:', error);
      toast.error('Error reordering activities');
    }

    setDraggedActivityIndex(null);
    setDragOverActivityIndex(null);
  };

  const handleActivityDragEnd = () => {
    setDraggedActivityIndex(null);
    setDragOverActivityIndex(null);
  };

  const handlePortalOptionGroupDragStart = (e, groupIndex) => {
    setDraggedPortalOptionGroupIndex(groupIndex);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', `portal-group:${groupIndex}`);
  };

  const handlePortalOptionGroupDragOver = (e, groupIndex) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (draggedPortalOptionGroupIndex !== null && draggedPortalOptionGroupIndex !== groupIndex) {
      setDragOverPortalOptionGroupIndex(groupIndex);
    }
  };

  const handlePortalOptionGroupDragLeave = () => {
    setDragOverPortalOptionGroupIndex(null);
  };

  const handlePortalOptionGroupDrop = (e, dropIndex) => {
    e.preventDefault();
    if (draggedPortalOptionGroupIndex === null || draggedPortalOptionGroupIndex === dropIndex) {
      setDraggedPortalOptionGroupIndex(null);
      setDragOverPortalOptionGroupIndex(null);
      return;
    }

    setPortalOptionGroups((prev) => {
      const next = [...prev];
      const [moved] = next.splice(draggedPortalOptionGroupIndex, 1);
      next.splice(dropIndex, 0, moved);
      return next.map((group, idx) => ({ ...group, sort_order: idx }));
    });
    setDraggedPortalOptionGroupIndex(null);
    setDragOverPortalOptionGroupIndex(null);
  };

  const handlePortalOptionGroupDragEnd = () => {
    setDraggedPortalOptionGroupIndex(null);
    setDragOverPortalOptionGroupIndex(null);
  };

  const handlePortalOptionDragStart = (e, groupIndex, optionIndex) => {
    e.stopPropagation();
    setDraggedPortalOption({ groupIndex, optionIndex });
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', `portal-option:${groupIndex}:${optionIndex}`);
  };

  const handlePortalOptionDragOver = (e, groupIndex, optionIndex) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    if (
      draggedPortalOption
      && draggedPortalOption.groupIndex === groupIndex
      && draggedPortalOption.optionIndex !== optionIndex
    ) {
      setDragOverPortalOption({ groupIndex, optionIndex });
    }
  };

  const handlePortalOptionDragLeave = () => {
    setDragOverPortalOption(null);
  };

  const handlePortalOptionDrop = (e, groupIndex, dropIndex) => {
    e.preventDefault();
    e.stopPropagation();
    if (
      !draggedPortalOption
      || draggedPortalOption.groupIndex !== groupIndex
      || draggedPortalOption.optionIndex === dropIndex
    ) {
      setDraggedPortalOption(null);
      setDragOverPortalOption(null);
      return;
    }

    setPortalOptionGroups((prev) =>
      prev.map((group, gIdx) => {
        if (gIdx !== groupIndex) return group;
        const options = [...(group.options || [])];
        const [moved] = options.splice(draggedPortalOption.optionIndex, 1);
        options.splice(dropIndex, 0, moved);
        return {
          ...group,
          options: options.map((opt, idx) => ({ ...opt, sort_order: idx })),
        };
      }),
    );
    setDraggedPortalOption(null);
    setDragOverPortalOption(null);
  };

  const handlePortalOptionDragEnd = () => {
    setDraggedPortalOption(null);
    setDragOverPortalOption(null);
  };

  const moveActivity = async (activityId, direction, categoryId) => {
    try {
      const categoryActivities = activities
        .filter(a => a.type_id === categoryId)
        .sort((a, b) => (a.display_order || 0) - (b.display_order || 0));
      
      const currentIndex = categoryActivities.findIndex(a => a.id === activityId);
      if (currentIndex === -1) return;

      const newIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
      if (newIndex < 0 || newIndex >= categoryActivities.length) return;

      const updatedActivities = [...categoryActivities];
      [updatedActivities[currentIndex], updatedActivities[newIndex]] = 
        [updatedActivities[newIndex], updatedActivities[currentIndex]];

      await persistActivityOrder(categoryId, updatedActivities);
    } catch (error) {
      console.error('Error moving activity:', error);
      toast.error('Error moving activity');
    }
  };

  const handleEditActivity = async (activityId) => {
    try {
      if (!auth.selectedBusinessId) {
        throw new Error('Business ID is required');
      }

      bookingActivityService.setBusinessId(auth.selectedBusinessId);
      const activity = await bookingActivityService.getActivityById(activityId);
      console.log('[BookingSettings] handleEditActivity: activity from getActivityById', {
        activityId,
        requires_waiver: activity?.requires_waiver,
        typeof: typeof activity?.requires_waiver,
      });
      setActivityName(activity.activity_name);
      setSelectedCategoryId(activity.type_id || '');
      setPortalVisible(activity.portal_visible !== false);
      setEditingActivityId(activityId);
      setActivityImages(normalizeActivityImages(activity.images || activity.ticket_settings?.activity_images));
      setActivityImageUrlInput('');
      setActivityImageUploadError(null);
      
      // Load duration and convert from minutes to days/hours/minutes
      const totalMinutes = activity.duration_minutes || 30;
      const days = Math.floor(totalMinutes / (24 * 60));
      const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
      const minutes = totalMinutes % 60;
      setActivityDuration({ days, hours, minutes });

      // Load advanced booking (min notice, max advance)
      // Use optional chaining and type coercion to safely handle missing columns
      const minVal = parseInt(activity?.min_advance_booking_value, 10) || 0;
      const minUnit = activity?.min_advance_booking_unit && ['minutes', 'hours', 'days', 'months'].includes(activity.min_advance_booking_unit)
        ? activity.min_advance_booking_unit
        : 'minutes';
      setAdvancedBookingMinNotice({ value: Math.min(60, Math.max(0, minVal)), unit: minUnit });
      const maxVal = parseInt(activity?.max_advance_booking_value, 10) || 0;
      const maxUnit = activity?.max_advance_booking_unit && ['minutes', 'hours', 'days', 'months'].includes(activity.max_advance_booking_unit)
        ? activity.max_advance_booking_unit
        : 'days';
      setAdvancedBookingMaxAdvance({ value: Math.min(60, Math.max(0, maxVal)), unit: maxUnit });

      const parsedPortalOptions = parsePortalActivityOptions(activity.addon_settings);
      setLoadedAddonSettings(
        activity.addon_settings && typeof activity.addon_settings === 'object'
          ? activity.addon_settings
          : {}
      );
      setPortalOptionsDisplayMode(parsedPortalOptions.displayMode);
      setPortalOptionGroups(parsedPortalOptions.groups);
      setPartyIncludedKids(
        activity?.party_included_kids != null ? Number(activity.party_included_kids) : null,
      );
      setPartyIncludedAdults(
        activity?.party_included_adults != null ? Number(activity.party_included_adults) : null,
      );
      setPartyOneAdultPerChildMode(partyOneAdultPerChildToMode(activity?.party_one_adult_per_child));
      
      // Load ticket settings (inventory items and quantity limits)
      // This ensures selectedInventoryItems is loaded even if user doesn't visit Pricing tab
      await loadSelectedInventoryItems(activityId, { force: true });
      
      // Load activity sections
      const { data: sections, error: sectionsError } = await supabase
        .from('booking_activity_sections')
        .select('*')
        .eq('activity_id', activityId)
        .order('display_order', { ascending: true });
      
      if (sectionsError) throw sectionsError;
      
      setActivitySections((sections || []).map(section => ({
        id: section.id,
        header: section.section_header,
        details: section.section_details
      })));
      
      // Load schedules using the extracted function
      await loadActivitySchedules(activityId);
      
      // Clear the form for creating a new schedule (don't load any schedule into the form)
      // Only clear if we're not currently editing a schedule
      if (!editingScheduleName) {
        setScheduleTimeSlots({});
        setScheduleDateRange({ startDate: '', endDate: '' });
        setScheduleName('');
        setIsIndefiniteSchedule(true); // Reset to default (indefinite)
      }
      
      setShowRegularTabbedModal(true);
      setRegularModalActiveTab('name');
      await loadCategoriesForDropdown();
    } catch (error) {
      console.error('Error loading activity:', error);
      toast.error('Error loading activity');
    }
  };

  const handleSaveRegularActivity = async () => {
    if (!activityName.trim()) {
      toast.error('Please enter an activity name');
      return;
    }

    if (!selectedCategoryId) {
      toast.error('Please select a category');
      return;
    }

    if (!auth.selectedBusinessId) {
      toast.error('Business ID is required');
      return;
    }

    const paymentSettingsCheck = validateOnlinePaymentSettings(onlinePaymentSettings);
    if (!paymentSettingsCheck.ok) {
      toast.error(paymentSettingsCheck.message);
      setRegularModalActiveTab('pay-deposit');
      return;
    }

    const extensionPricingCheck = validateExtensionPricingSettings(extensionPricingSettings);
    if (!extensionPricingCheck.ok) {
      toast.error(extensionPricingCheck.message);
      setRegularModalActiveTab('pay-deposit');
      return;
    }

    if (editingActivityId && hydratingTicketSettings) {
      toast.error('Please wait for the saved pricing configuration to finish loading');
      return;
    }

    // Note: Schedule validation is done in the "Save Schedule" button handler
    // The main Save button only saves the activity itself

    try {
      setSaving(true);
      bookingActivityService.setBusinessId(auth.selectedBusinessId);

      let activity;
      
      const advancedBookingPayload = {
        min_advance_booking_value: advancedBookingMinNotice.value,
        min_advance_booking_unit: advancedBookingMinNotice.unit,
        max_advance_booking_value: advancedBookingMaxAdvance.value,
        max_advance_booking_unit: advancedBookingMaxAdvance.unit
      };

      const addonSettings = mergeAddonSettingsWithPortalOptions(
        editingActivityId ? loadedAddonSettings : {},
        serializePortalActivityOptions({
          displayMode: portalOptionsDisplayMode,
          groups: portalOptionGroups,
        })
      );

      if (editingActivityId) {
        // Calculate duration in minutes
        const durationMinutes = (activityDuration.days * 24 * 60) + (activityDuration.hours * 60) + activityDuration.minutes;
        
        // Update existing activity
        // Try to update with advanced booking, but fallback if columns don't exist
        const baseUpdate = {
          activity_name: activityName.trim(),
          type_id: selectedCategoryId,
          duration_minutes: durationMinutes || 30
        };
        
        // Load existing ticket_settings to merge with new values (preserve what wasn't changed)
        let existingTicketSettings = {};
        try {
          const { data: existingData } = await supabase
            .from('booking_activities')
            .select('ticket_settings')
            .eq('id', editingActivityId)
            .single();
          
          if (existingData?.ticket_settings) {
            existingTicketSettings = typeof existingData.ticket_settings === 'string' 
              ? JSON.parse(existingData.ticket_settings) 
              : existingData.ticket_settings;
          }
        } catch (error) {
          console.warn('Could not load existing ticket_settings:', error);
        }

        const assignmentRulesForSave = buildDefaultTicketAssignmentRules(
          selectedTicketItems,
          pricingDraftDirty
            ? ticketAssignmentRules
            : (
                loadedTicketAssignmentRules.length > 0
                  ? loadedTicketAssignmentRules
                  : (Array.isArray(existingTicketSettings.assignment_rules) ? existingTicketSettings.assignment_rules : ticketAssignmentRules)
              )
        );
        const pricingRulesForSave = buildDefaultTicketPricingRules(
          selectedTicketItems,
          pricingDraftDirty
            ? ticketPricingRules
            : (
                loadedTicketPricingRules.length > 0
                  ? loadedTicketPricingRules
                  : (Array.isArray(existingTicketSettings.pricing_rules) ? existingTicketSettings.pricing_rules : ticketPricingRules)
              )
        );

        const ruleInventoryIds = assignmentRulesForSave
          .map((rule) => rule?.inventory_item_id)
          .filter(Boolean);
        const inventoryIdsForSave = (() => {
          if (selectedInventoryItems.length > 0) return selectedInventoryItems;
          if (!ticketSettingsLoaded) {
            return existingTicketSettings.inventory_item_ids?.length
              ? existingTicketSettings.inventory_item_ids
              : [...new Set(ruleInventoryIds)];
          }
          if (ruleInventoryIds.length > 0) return [...new Set(ruleInventoryIds)];
          return selectedInventoryItems;
        })();
        
        // Merge existing ticket_settings with current in-memory values so pricing edits persist
        // even if the user saves from a different tab after leaving Pricing.
        const ticketSettings = mergePartyActivityTicketSettings({
          ...existingTicketSettings, // Preserve all existing settings first
          activity_images: normalizeActivityImages(activityImages),
          inventory_item_ids: inventoryIdsForSave,
          min_tickets: minTickets !== null && minTickets !== undefined ? minTickets : (existingTicketSettings.min_tickets ?? null),
          max_tickets: maxTickets !== null && maxTickets !== undefined ? maxTickets : (existingTicketSettings.max_tickets ?? null),
          assignment_rules: serializeTicketAssignmentRules(assignmentRulesForSave, selectedTicketItems),
          pricing_rules: serializeTicketPricingRules(pricingRulesForSave, selectedTicketItems),
          online_payment: serializeOnlinePaymentSettings(onlinePaymentSettings),
          time_extension: serializeExtensionPricingSettings(extensionPricingSettings),
          enforce_online_only: true
        });
        
        console.log('[BookingSettings] Saving ticket_settings:', {
          activeTab: regularModalActiveTab,
          selectedInventoryItems: selectedInventoryItems,
          existingInventoryItemIds: existingTicketSettings.inventory_item_ids,
          finalInventoryItemIds: ticketSettings.inventory_item_ids,
          pricingDraftDirty,
          pricingRulesForSave
        });

        console.log('[BookingSettings] Saving activity (update): requiresWaiver state', {
          editingActivityId,
          requiresWaiver,
          typeof: typeof requiresWaiver,
        });
        try {
          // Try updating with advanced booking fields, ticket_settings, and requires_waiver
          const updatePayload = {
            ...baseUpdate,
            ...advancedBookingPayload,
            ticketSettings: ticketSettings,
            requiresWaiver: requiresWaiver,
            requiresCamperRegistration: requiresCamperRegistration,
            portalVisible,
            partyIncludedKids: partyIncludedKids,
            partyIncludedAdults: partyIncludedAdults,
            partyOneAdultPerChild: partyOneAdultPerChildFromMode(partyOneAdultPerChildMode),
            addonSettings,
          };
          console.log('[BookingSettings] updateActivity payload (waiver)', {
            hasRequiresWaiver: 'requiresWaiver' in updatePayload,
            requiresWaiver: updatePayload.requiresWaiver,
          });
          activity = await bookingActivityService.updateActivity(editingActivityId, updatePayload);
          // Explicitly persist requires_waiver in case it was dropped or overwritten in the combined update
          const { error: waiverUpdateError } = await supabase
            .from('booking_activities')
            .update({
              requires_waiver: !!requiresWaiver,
              requires_camper_registration: !!requiresCamperRegistration,
              portal_visible: portalVisible !== false,
              updated_at: new Date().toISOString(),
            })
            .eq('id', editingActivityId)
            .eq('business_id', auth.selectedBusinessId);
          if (waiverUpdateError) {
            console.warn('[BookingSettings] Explicit requires_waiver update failed', waiverUpdateError);
          } else {
            console.log('[BookingSettings] Explicit requires_waiver update succeeded', { requiresWaiver: !!requiresWaiver });
          }
        } catch (advancedBookingError) {
          // If advanced booking columns don't exist, try without them
          if (advancedBookingError?.code === '42703' || advancedBookingError?.message?.includes('min_advance_booking') || advancedBookingError?.message?.includes('max_advance_booking')) {
            console.warn('Advanced booking columns not found, updating without them:', advancedBookingError);
            console.log('[BookingSettings] updateActivity retry (no advanced booking) with requiresWaiver', requiresWaiver);
            activity = await bookingActivityService.updateActivity(editingActivityId, {
              ...baseUpdate,
              ticketSettings: ticketSettings,
              requiresWaiver: requiresWaiver,
              requiresCamperRegistration: requiresCamperRegistration,
              portalVisible,
              partyIncludedKids: partyIncludedKids,
              partyIncludedAdults: partyIncludedAdults,
              partyOneAdultPerChild: partyOneAdultPerChildFromMode(partyOneAdultPerChildMode),
              addonSettings,
            });
            if (activity) {
              const { error: waiverUpdateError } = await supabase
                .from('booking_activities')
                .update({
                  requires_waiver: !!requiresWaiver,
                  requires_camper_registration: !!requiresCamperRegistration,
                  portal_visible: portalVisible !== false,
                  updated_at: new Date().toISOString(),
                })
                .eq('id', editingActivityId)
                .eq('business_id', auth.selectedBusinessId);
              if (waiverUpdateError) {
                console.warn('[BookingSettings] Explicit requires_waiver update (after retry) failed', waiverUpdateError);
              } else {
                console.log('[BookingSettings] Explicit requires_waiver update (after retry) succeeded', { requiresWaiver: !!requiresWaiver });
              }
            }
          } else {
            throw advancedBookingError;
          }
        }
        
        // Delete existing sections and recreate
        await supabase
          .from('booking_activity_sections')
          .delete()
          .eq('activity_id', editingActivityId);
      } else {
        // Get current activities in this category to determine display_order
        const existingActivities = activities
          .filter(a => a.type_id === selectedCategoryId)
          .sort((a, b) => (a.display_order || 0) - (b.display_order || 0));
        const nextDisplayOrder = existingActivities.length;

        // Calculate duration in minutes
        const durationMinutes = (activityDuration.days * 24 * 60) + (activityDuration.hours * 60) + activityDuration.minutes;

        // Prepare ticket_settings with selected inventory items and quantity limits
        const ticketSettings = mergePartyActivityTicketSettings({
          activity_images: normalizeActivityImages(activityImages),
          inventory_item_ids: selectedInventoryItems || [],
          min_tickets: minTickets || null,
          max_tickets: maxTickets || null,
          assignment_rules: serializeTicketAssignmentRules(buildDefaultTicketAssignmentRules(selectedTicketItems, ticketAssignmentRules), selectedTicketItems),
          pricing_rules: serializeTicketPricingRules(buildDefaultTicketPricingRules(selectedTicketItems, ticketPricingRules), selectedTicketItems),
          online_payment: serializeOnlinePaymentSettings(onlinePaymentSettings),
          time_extension: serializeExtensionPricingSettings(extensionPricingSettings),
          enforce_online_only: true
        });

        console.log('[BookingSettings] Creating activity with requiresWaiver', { requiresWaiver });
        // Create the activity
        activity = await bookingActivityService.createActivity({
          activityName: activityName.trim(),
          typeId: selectedCategoryId,
          displayOrder: nextDisplayOrder,
          isActive: true,
          durationMinutes: durationMinutes || 30,
          ticketSettings: ticketSettings,
          requiresWaiver: requiresWaiver,
          requiresCamperRegistration: requiresCamperRegistration,
          portalVisible,
          partyIncludedKids: partyIncludedKids,
          partyIncludedAdults: partyIncludedAdults,
          partyOneAdultPerChild: partyOneAdultPerChildFromMode(partyOneAdultPerChildMode),
          addonSettings,
        });
        // Persist advanced booking on new activity (wrap in try-catch in case columns don't exist yet)
        try {
          await bookingActivityService.updateActivity(activity.id, {
            ...advancedBookingPayload,
            ticketSettings: ticketSettings
          });
        } catch (advancedBookingError) {
          // If advanced booking columns don't exist yet, log but don't fail the save
          console.warn('Could not save advanced booking settings (columns may not exist yet):', advancedBookingError);
        }
      }

      // Create sections if any exist
      if (activitySections.length > 0) {
        const sectionsToInsert = activitySections
          .filter(section => section.header.trim() || section.details.trim())
          .map((section, index) => ({
            activity_id: activity.id,
            business_id: auth.selectedBusinessId,
            section_header: section.header.trim(),
            section_details: section.details.trim(),
            display_order: index
          }));

        if (sectionsToInsert.length > 0) {
          const { error: sectionsError } = await supabase
            .from('booking_activity_sections')
            .insert(sectionsToInsert);

          if (sectionsError) {
            console.error('Error creating sections:', sectionsError);
            toast.error('Activity saved but failed to save some sections');
            return;
          }
        }
      }

      // Set editingActivityId if this was a new activity
      const finalActivityId = editingActivityId || activity.id;
      if (!editingActivityId) {
        setEditingActivityId(finalActivityId);
      }

      // Save any schedules that have been created
      try {
        await saveCurrentSchedules(finalActivityId);
      } catch (error) {
        // If schedule save fails, still show activity saved but warn about schedule
        console.error('Activity saved but schedule save failed:', error);
        toast.error('Activity saved, but schedule could not be saved. Please try saving the schedule again.');
      }

      // Reload schedules and the saved ticket settings so the UI reflects what actually persisted.
      await loadActivitySchedules(finalActivityId);
      await loadSelectedInventoryItems(finalActivityId, { force: true });
      setPricingDraftDirty(false);

      toast.success(editingActivityId ? 'Activity and schedules saved successfully' : 'Activity and schedules created successfully');
      
      // DO NOT reset form - keep activity data so user can continue editing
      // Only reload categories to refresh the list
      await loadCategories();
    } catch (error) {
      console.error('Error saving activity:', error);
      toast.error(error.message || 'Error saving activity');
    } finally {
      setSaving(false);
    }
  };

  const handleEditCategory = async (categoryId) => {
    try {
      const category = await bookingTypeService.getBookingTypeById(categoryId);
      setCategoryName(category.display_name || category.type_name);
      setEditingCategoryTypeKey(category.type_key || null);
      const partyRules = parsePartyCategorySessionRules(category.session_rules);
      setCategoryPartySettings({
        requireBirthdayChild: partyRules.requireBirthdayChild,
        defaultSpacesPerSlot: partyRules.defaultSpacesPerSlot,
      });
      setCategorySharedCapacity(parseCategorySharedCapacityRules(category.session_rules));
      const cr =
        category.cancellation_rules && typeof category.cancellation_rules === 'object'
          ? category.cancellation_rules
          : {};
      const hasNewShape = cr.early_cancel_mode != null || cr.late_cancel_mode != null || cr.notice_split_hours != null;
      if (hasNewShape) {
        setCategorySelfServiceRules({
          noticeSplitHours: cr.notice_split_hours ?? 48,
          earlyCancelMode: (() => {
            const v = String(cr.early_cancel_mode || 'refund_money').toLowerCase();
            if (v === 'refund_credit' || v === 'store_credit') return 'refund_credit';
            if (v === 'contact_business' || v === 'contact_only') return 'contact_business';
            if (v === 'cancel_only' || v === 'forfeit' || v === 'no_refund' || v === 'booking_only') return 'cancel_only';
            return 'refund_money';
          })(),
          earlyDepositPolicy: ['credit_only', 'non_refundable'].includes(
            String(cr.early_deposit_cancel_policy || '').toLowerCase()
          )
            ? cr.early_deposit_cancel_policy
            : 'follow_cancel_mode',
          lateCancelMode: (() => {
            const v = String(cr.late_cancel_mode || 'contact_business').toLowerCase();
            if (v === 'refund_money') return 'refund_money';
            if (v === 'refund_credit' || v === 'store_credit') return 'refund_credit';
            if (v === 'cancel_only' || v === 'forfeit' || v === 'no_refund' || v === 'booking_only') return 'cancel_only';
            if (v === 'contact_business' || v === 'contact_only') return 'contact_business';
            return 'contact_business';
          })(),
          lateDepositPolicy: ['credit_only', 'follow_cancel_mode', 'non_refundable'].includes(
            String(cr.late_deposit_cancel_policy || '').toLowerCase()
          )
            ? cr.late_deposit_cancel_policy
            : 'non_refundable',
          allowReschedule:
            cr.allow_self_service_reschedule !== false && cr.self_service_reschedule_enabled !== false,
          minHoursReschedule:
            cr.min_hours_before_reschedule ?? cr.self_service_reschedule_hours ?? 48,
          contactPhone: cr.cancel_contact_phone || '',
          contactEmail: cr.cancel_contact_email || '',
        });
      } else {
        const cm = String(cr.self_service_cancel_mode || '').toLowerCase();
        const dp = String(cr.deposit_cancel_policy || 'follow_cancel_mode').toLowerCase();
        setCategorySelfServiceRules({
          noticeSplitHours:
            cr.notice_split_hours ??
            cr.min_hours_before_cancel ??
            cr.self_service_cancel_hours ??
            48,
          earlyCancelMode:
            cm === 'refund_credit' || cm === 'store_credit'
              ? 'refund_credit'
              : cm === 'contact_business' || cm === 'contact_only'
                ? 'contact_business'
                : 'refund_money',
          earlyDepositPolicy: ['credit_only', 'non_refundable'].includes(dp) ? cr.deposit_cancel_policy : 'follow_cancel_mode',
          lateCancelMode: 'contact_business',
          lateDepositPolicy: 'non_refundable',
          allowReschedule:
            cr.allow_self_service_reschedule !== false && cr.self_service_reschedule_enabled !== false,
          minHoursReschedule:
            cr.min_hours_before_reschedule ?? cr.self_service_reschedule_hours ?? 48,
          contactPhone: cr.cancel_contact_phone || '',
          contactEmail: cr.cancel_contact_email || '',
        });
      }
      setEditingCategoryId(categoryId);
      setShowCategoryFormModal(true);
    } catch (error) {
      console.error('Error loading category:', error);
      toast.error('Error loading category');
    }
  };

  const handleSaveCategory = async () => {
    if (!categoryName.trim()) {
      toast.error('Please enter a category name');
      return;
    }

    if (!auth.selectedBusinessId) {
      toast.error('Business ID is required');
      return;
    }

    try {
      setSaving(true);
      bookingTypeService.setBusinessId(auth.selectedBusinessId);

      const cancellation_rules = {
        notice_split_hours: Number(categorySelfServiceRules.noticeSplitHours) || 48,
        early_cancel_mode: categorySelfServiceRules.earlyCancelMode,
        early_deposit_cancel_policy: categorySelfServiceRules.earlyDepositPolicy,
        late_cancel_mode: categorySelfServiceRules.lateCancelMode,
        late_deposit_cancel_policy: categorySelfServiceRules.lateDepositPolicy,
        allow_self_service_reschedule: categorySelfServiceRules.allowReschedule,
        min_hours_before_reschedule: Number(categorySelfServiceRules.minHoursReschedule) || 0,
        cancel_contact_phone: categorySelfServiceRules.contactPhone.trim() || null,
        cancel_contact_email: categorySelfServiceRules.contactEmail.trim() || null,
      };
      
      const isBirthdayParty = editingCategoryTypeKey === BIRTHDAY_PARTY_TYPE_KEY;
      const typeKey = isBirthdayParty
        ? BIRTHDAY_PARTY_TYPE_KEY
        : categoryName.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');

      let baseSessionRules = {};
      if (isBirthdayParty) {
        baseSessionRules = serializePartyCategorySessionRules(categoryPartySettings);
      } else if (editingCategoryId) {
        const existingCategory = await bookingTypeService.getBookingTypeById(editingCategoryId);
        baseSessionRules = existingCategory?.session_rules && typeof existingCategory.session_rules === 'object'
          ? existingCategory.session_rules
          : {};
      }
      const sessionRules = mergeCategorySessionRulesWithSharedCapacity(
        baseSessionRules,
        categorySharedCapacity,
      );

      if (editingCategoryId) {
        // Update existing category
        await bookingTypeService.updateBookingType(editingCategoryId, {
          typeName: isBirthdayParty ? 'Birthday Party' : categoryName.trim(),
          typeKey,
          displayName: categoryName.trim(),
          cancellationRules: cancellation_rules,
          sessionRules,
        });
        toast.success('Category updated successfully');
      } else {
        // Create new category
        const nextDisplayOrder = sortedCategories.reduce(
          (max, category) => Math.max(max, Number(category.display_order) || 0),
          -1,
        ) + 1;
        await bookingTypeService.createBookingType({
          typeName: categoryName.trim(),
          typeKey: typeKey,
          displayName: categoryName.trim(),
          isActive: true,
          cancellationRules: cancellation_rules,
          sessionRules,
          displayOrder: nextDisplayOrder,
        });
        toast.success('Category created successfully');
      }
      
      setCategoryName('');
      setCategorySelfServiceRules(defaultCategorySelfServiceRules());
      setCategoryPartySettings({ requireBirthdayChild: true, defaultSpacesPerSlot: 1 });
      setCategorySharedCapacity(defaultCategorySharedCapacityRules());
      setEditingCategoryTypeKey(null);
      setEditingCategoryId(null);
      setShowCategoryFormModal(false);
      setShowCategoryTypeModal(false);
      setSelectedCategoryType(null);
      await loadCategories(); // Refresh the list
    } catch (error) {
      console.error('Error saving category:', error);
      toast.error(error.message || 'Error saving category');
    } finally {
      setSaving(false);
    }
  };

  const handleSendThankYouTestEmail = async () => {
    const to = thankYouTestEmail?.trim();
    if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      toast.error('Enter a valid email address for the test');
      return;
    }
    if (!auth.selectedBusinessId) {
      toast.error('No business selected');
      return;
    }
    setThankYouTestSending(true);
    try {
      const { data, error } = await supabase.functions.invoke('test-booking-thank-you-email', {
        body: { businessId: auth.selectedBusinessId, to },
      });
      if (error) {
        throw new Error(error.message || 'Request failed');
      }
      if (data?.error) {
        throw new Error(typeof data.error === 'string' ? data.error : 'Server error');
      }
      toast.success('Test email sent. Check the inbox (and spam) for the thank-you preview.');
    } catch (e) {
      console.error('Thank-you test email failed:', e);
      toast.error(e?.message || 'Failed to send test email');
    } finally {
      setThankYouTestSending(false);
    }
  };

  const handleSendMarketingTestEmail = async (kind) => {
    const to = marketingTestEmail?.trim();
    if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      toast.error('Enter a valid email address for the test');
      return;
    }
    if (!auth.selectedBusinessId) {
      toast.error('No business selected');
      return;
    }
    setMarketingTestSending(kind);
    try {
      const { data, error } = await supabase.functions.invoke('test-booking-marketing-email', {
        body: {
          businessId: auth.selectedBusinessId,
          to,
          kind,
          publicOrigin: typeof window !== 'undefined' ? window.location.origin : undefined,
        },
      });
      if (error) {
        throw new Error(error.message || 'Request failed');
      }
      if (data?.error) {
        throw new Error(typeof data.error === 'string' ? data.error : 'Server error');
      }
      const label =
        kind === 'reminder' ? 'reminder' : kind === 'abandoned' ? 'abandoned cart' : 'marketing links';
      toast.success(`Test email sent. Check the inbox (and spam) for the ${label} preview.`);
    } catch (e) {
      console.error('Marketing test email failed:', e);
      toast.error(e?.message || 'Failed to send test email');
    } finally {
      setMarketingTestSending(null);
    }
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      await bookingSettingsService.setSetting('autoSendConfirmation', settings.autoSendConfirmation);
      await bookingSettingsService.setSetting('reminderHoursBefore', settings.reminderHoursBefore);
      await bookingSettingsService.setSetting('thankYouEmailEnabled', settings.thankYouEmailEnabled);
      await bookingSettingsService.setSetting('thankYouEmailMessage', settings.thankYouEmailMessage || '');
      await bookingSettingsService.setSetting('abandonedCartEmailEnabled', settings.abandonedCartEmailEnabled);
      await bookingSettingsService.setSetting('abandonedCartEmailHours', settings.abandonedCartEmailHours);
      await bookingSettingsService.setSetting('abandonedCartMinStage', settings.abandonedCartMinStage);
      await bookingSettingsService.setSetting('abandonedCartEmailMessage', settings.abandonedCartEmailMessage || '');
      await bookingSettingsService.setSetting('cancellationPolicy', settings.cancellationPolicy);
      await bookingSettingsService.setSetting('refundPolicy', settings.refundPolicy);
      toast.success('Settings saved successfully');
    } catch (error) {
      console.error('Error saving settings:', error);
      toast.error('Error saving settings');
    } finally {
      setSaving(false);
    }
  };

  const renderSubTabContent = () => {
    switch (activeSubTab) {
      case 'categories':
        return (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
              <h2 style={{ fontSize: '24px', fontWeight: '600', margin: 0 }}>
                Booking Categories
              </h2>
              <button
                onClick={() => setShowCategoryModal(true)}
                style={{
                  padding: '10px 20px',
                  backgroundColor: TavariStyles.colors.primary,
                  color: 'white',
                  border: 'none',
                  borderRadius: '8px',
                  fontSize: '14px',
                  fontWeight: '600',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px'
                }}
              >
                <FiPlus size={16} />
                New
              </button>
            </div>
            {loadingCategories ? (
              <div style={{ padding: '40px', textAlign: 'center', color: TavariStyles.colors.gray600 }}>
                Loading categories...
              </div>
            ) : categories.length === 0 ? (
              <div style={{
                padding: '60px 40px',
                textAlign: 'center',
                color: TavariStyles.colors.gray600
              }}>
                <div style={{ fontSize: '18px', fontWeight: '600', marginBottom: '8px' }}>
                  No categories yet
                </div>
                <div style={{ fontSize: '14px' }}>
                  Click "New" to create your first booking category
                </div>
              </div>
            ) : (
              <div style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '12px'
              }}>
                {sortedCategories.map((category, categoryIndex) => {
                  const categoryActivities = activities
                    .filter(activity => activity.type_id === category.id)
                    .sort((a, b) => (a.display_order || 0) - (b.display_order || 0));
                  
                  return (
                    <div
                      key={category.id}
                      style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}
                      onDragOver={(e) => handleCategoryDragOver(e, categoryIndex)}
                      onDragLeave={handleCategoryDragLeave}
                      onDrop={(e) => handleCategoryDrop(e, categoryIndex)}
                    >
                      {/* Category Card - Teal with white text */}
                      <div
                        draggable
                        onDragStart={(e) => handleCategoryDragStart(e, categoryIndex)}
                        onDragEnd={handleCategoryDragEnd}
                        onClick={(e) => {
                          if (e.target.tagName !== 'BUTTON' && !e.target.closest('button')) {
                            handleEditCategory(category.id);
                          }
                        }}
                        style={{
                          padding: '20px',
                          border: dragOverCategoryIndex === categoryIndex ? '2px solid #0f766e' : '1px solid #14b8a6',
                          borderRadius: '12px',
                          backgroundColor: category.is_active ? '#14b8a6' : '#5eead4',
                          opacity: draggedCategoryIndex === categoryIndex ? 0.55 : (category.is_active ? 1 : 0.7),
                          position: 'relative',
                          cursor: 'pointer',
                          transform: dragOverCategoryIndex === categoryIndex ? 'scale(1.01)' : 'scale(1)',
                          transition: 'all 0.2s',
                        }}
                      >
                        <div style={{ position: 'absolute', top: '12px', right: '12px', display: 'flex', gap: '8px', alignItems: 'center' }}>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleToggleActive('category', category.id, category.is_active);
                            }}
                            style={{
                              padding: '6px',
                              border: 'none',
                              background: 'rgba(255, 255, 255, 0.2)',
                              borderRadius: '6px',
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              color: 'white'
                            }}
                            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.3)'; }}
                            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.2)'; }}
                            title={category.is_active ? 'Deactivate' : 'Activate'}
                          >
                            <FiPower size={18} />
                          </button>
                          {category.type_key !== BIRTHDAY_PARTY_TYPE_KEY && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteClick('category', category.id, category.display_name || category.type_name, {
                                typeKey: category.type_key,
                              });
                            }}
                            style={{
                              padding: '6px',
                              border: 'none',
                              background: 'rgba(255, 255, 255, 0.2)',
                              borderRadius: '6px',
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              color: 'white'
                            }}
                            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'rgba(239, 68, 68, 0.3)'; }}
                            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.2)'; }}
                            title="Delete"
                          >
                            <FiX size={18} />
                          </button>
                          )}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', paddingRight: '80px' }}>
                          <div
                            style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '2px' }}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                moveCategory(category.id, 'up');
                              }}
                              disabled={categoryIndex === 0}
                              style={{
                                padding: '4px',
                                border: 'none',
                                background: categoryIndex === 0 ? 'rgba(255, 255, 255, 0.12)' : 'rgba(255, 255, 255, 0.2)',
                                borderRadius: '4px',
                                cursor: categoryIndex === 0 ? 'not-allowed' : 'pointer',
                                color: 'white',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                opacity: categoryIndex === 0 ? 0.45 : 1,
                              }}
                              title="Move category up"
                            >
                              <FiArrowUp size={16} />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                moveCategory(category.id, 'down');
                              }}
                              disabled={categoryIndex === sortedCategories.length - 1}
                              style={{
                                padding: '4px',
                                border: 'none',
                                background: categoryIndex === sortedCategories.length - 1 ? 'rgba(255, 255, 255, 0.12)' : 'rgba(255, 255, 255, 0.2)',
                                borderRadius: '4px',
                                cursor: categoryIndex === sortedCategories.length - 1 ? 'not-allowed' : 'pointer',
                                color: 'white',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                opacity: categoryIndex === sortedCategories.length - 1 ? 0.45 : 1,
                              }}
                              title="Move category down"
                            >
                              <FiArrowDown size={16} />
                            </button>
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: '18px', fontWeight: '600', marginBottom: '8px', color: 'white' }}>
                              {category.display_name || category.type_name}
                            </div>
                            {category.description && (
                              <div style={{ fontSize: '14px', color: 'rgba(255, 255, 255, 0.9)', marginBottom: '8px' }}>
                                {category.description}
                              </div>
                            )}
                            <div style={{
                              display: 'inline-block',
                              padding: '4px 12px',
                              borderRadius: '12px',
                              fontSize: '13px',
                              fontWeight: '600',
                              backgroundColor: category.is_active ? 'rgba(255, 255, 255, 0.2)' : 'rgba(255, 255, 255, 0.15)',
                              color: 'white'
                            }}>
                              {category.is_active ? 'Active' : 'Inactive'}
                            </div>
                          </div>
                        </div>
                      </div>
                      
                      {/* Activities indented under category */}
                      {categoryActivities.length > 0 && (
                        <div style={{ marginLeft: '24px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                          {categoryActivities.map((activity, index) => (
                            <div
                              key={activity.id}
                              draggable
                              onDragStart={(e) => handleActivityDragStart(e, index, category.id)}
                              onDragOver={(e) => handleActivityDragOver(e, index, category.id)}
                              onDragLeave={handleActivityDragLeave}
                              onDrop={(e) => handleActivityDrop(e, index, category.id)}
                              onDragEnd={handleActivityDragEnd}
                              onClick={(e) => {
                                // Only trigger edit if clicking on the main content area, not buttons
                                if (e.target.tagName !== 'BUTTON' && !e.target.closest('button')) {
                                  handleEditActivity(activity.id);
                                }
                              }}
                              style={{
                                padding: '20px',
                                border: (dragOverActivityIndex?.index === index && dragOverActivityIndex?.categoryId === category.id) ? '2px solid #14b8a6' : '1px solid #e5e7eb',
                                borderRadius: '12px',
                                backgroundColor: activity.is_active ? 'white' : '#f9fafb',
                                opacity: (draggedActivityIndex?.index === index && draggedActivityIndex?.categoryId === category.id) ? 0.5 : (activity.is_active ? 1 : 0.7),
                                cursor: 'pointer',
                                position: 'relative',
                                transition: 'all 0.2s',
                                transform: (dragOverActivityIndex?.index === index && dragOverActivityIndex?.categoryId === category.id) ? 'scale(1.02)' : 'scale(1)'
                              }}
                            >
                              <div style={{ position: 'absolute', top: '12px', right: '12px', display: 'flex', gap: '8px', alignItems: 'center', zIndex: 10 }}>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleToggleActive('activity', activity.id, activity.is_active);
                                  }}
                                  style={{
                                    padding: '6px',
                                    border: 'none',
                                    background: 'transparent',
                                    borderRadius: '6px',
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    color: activity.is_active ? '#10b981' : '#6b7280'
                                  }}
                                  onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = activity.is_active ? '#d1fae5' : '#f3f4f6'; }}
                                  onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                                  title={activity.is_active ? 'Deactivate' : 'Activate'}
                                >
                                  <FiPower size={18} />
                                </button>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleDeleteClick('activity', activity.id, activity.activity_name);
                                  }}
                                  style={{
                                    padding: '6px',
                                    border: 'none',
                                    background: 'transparent',
                                    borderRadius: '6px',
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    color: '#ef4444'
                                  }}
                                  onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#fee2e2'; }}
                                  onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                                  title="Delete"
                                >
                                  <FiX size={18} />
                                </button>
                              </div>
                              
                              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
                                <div 
                                  style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      moveActivity(activity.id, 'up', category.id);
                                    }}
                                    disabled={index === 0}
                                    style={{
                                      padding: '4px',
                                      border: 'none',
                                      background: index === 0 ? '#f3f4f6' : 'transparent',
                                      borderRadius: '4px',
                                      cursor: index === 0 ? 'not-allowed' : 'pointer',
                                      color: index === 0 ? '#9ca3af' : TavariStyles.colors.gray700,
                                      display: 'flex',
                                      alignItems: 'center',
                                      justifyContent: 'center'
                                    }}
                                    onMouseEnter={(e) => { if (index !== 0) e.currentTarget.style.backgroundColor = '#f3f4f6'; }}
                                    onMouseLeave={(e) => { if (index !== 0) e.currentTarget.style.backgroundColor = 'transparent'; }}
                                  >
                                    <FiArrowUp size={16} />
                                  </button>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      moveActivity(activity.id, 'down', category.id);
                                    }}
                                    disabled={index === categoryActivities.length - 1}
                                    style={{
                                      padding: '4px',
                                      border: 'none',
                                      background: index === categoryActivities.length - 1 ? '#f3f4f6' : 'transparent',
                                      borderRadius: '4px',
                                      cursor: index === categoryActivities.length - 1 ? 'not-allowed' : 'pointer',
                                      color: index === categoryActivities.length - 1 ? '#9ca3af' : TavariStyles.colors.gray700,
                                      display: 'flex',
                                      alignItems: 'center',
                                      justifyContent: 'center'
                                    }}
                                    onMouseEnter={(e) => { if (index !== categoryActivities.length - 1) e.currentTarget.style.backgroundColor = '#f3f4f6'; }}
                                    onMouseLeave={(e) => { if (index !== categoryActivities.length - 1) e.currentTarget.style.backgroundColor = 'transparent'; }}
                                  >
                                    <FiArrowDown size={16} />
                                  </button>
                                </div>
                                <div style={{ flex: 1, paddingRight: '32px' }}>
                                  <div style={{ fontSize: '16px', fontWeight: '600', marginBottom: '8px', color: TavariStyles.colors.gray900 }}>
                                    {activity.activity_name}
                                  </div>
                                  {activity.description && (
                                    <div style={{ fontSize: '14px', color: TavariStyles.colors.gray600, marginBottom: '8px' }}>
                                      {activity.description}
                                    </div>
                                  )}
                                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
                                    <div style={{
                                      display: 'inline-block',
                                      padding: '4px 12px',
                                      borderRadius: '12px',
                                      fontSize: '13px',
                                      fontWeight: '600',
                                      backgroundColor: activity.is_active ? '#d1fae5' : '#fee2e2',
                                      color: activity.is_active ? '#065f46' : '#991b1b'
                                    }}>
                                      {activity.is_active ? 'Active' : 'Inactive'}
                                    </div>
                                    {activity.is_active && activity.portal_visible === false && (
                                      <div style={{
                                        display: 'inline-block',
                                        padding: '4px 12px',
                                        borderRadius: '12px',
                                        fontSize: '13px',
                                        fontWeight: '600',
                                        backgroundColor: '#fef3c7',
                                        color: '#92400e',
                                      }}>
                                        Staff only — hidden from booking site
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Delete Confirmation Modal */}
            {deleteConfirm.show && (
              <div
                style={{
                  position: 'fixed',
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  backgroundColor: 'rgba(0, 0, 0, 0.5)',
                  zIndex: 200,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '20px'
                }}
                onClick={handleDeleteCancel}
              >
                <div
                  style={{
                    backgroundColor: 'white',
                    borderRadius: '12px',
                    maxWidth: '500px',
                    width: '100%',
                    boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)'
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <div style={{
                    padding: '24px',
                    borderBottom: '1px solid #e5e7eb'
                  }}>
                    <h3 style={{ fontSize: '20px', fontWeight: '600', margin: '0 0 8px 0', color: TavariStyles.colors.gray900 }}>
                      Confirm Permanent Delete
                    </h3>
                    <p style={{ fontSize: '14px', color: TavariStyles.colors.gray600, margin: '0 0 12px 0' }}>
                      Are you sure you want to permanently delete "{deleteConfirm.name}"? This action cannot be undone and will remove all associated data.
                    </p>
                    <p style={{ fontSize: '13px', color: TavariStyles.colors.gray500, margin: 0, fontStyle: 'italic' }}>
                      Note: To temporarily hide this item, use the power button to deactivate it instead.
                    </p>
                  </div>
                  <div style={{
                    padding: '24px',
                    display: 'flex',
                    justifyContent: 'flex-end',
                    gap: '12px'
                  }}>
                    <button
                      onClick={handleDeleteCancel}
                      style={{
                        padding: '10px 20px',
                        backgroundColor: TavariStyles.colors.gray700,
                        color: 'white',
                        border: 'none',
                        borderRadius: '8px',
                        fontSize: '14px',
                        fontWeight: '600',
                        cursor: 'pointer'
                      }}
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleDeleteConfirm}
                      style={{
                        padding: '10px 20px',
                        backgroundColor: '#ef4444',
                        color: 'white',
                        border: 'none',
                        borderRadius: '8px',
                        fontSize: '14px',
                        fontWeight: '600',
                        cursor: 'pointer'
                      }}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Category Type Selection Modal */}
            {showCategoryModal && (
              <div
                style={{
                  position: 'fixed',
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  backgroundColor: 'rgba(0, 0, 0, 0.5)',
                  zIndex: 100,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '20px'
                }}
                onClick={() => setShowCategoryModal(false)}
              >
                <div
                  style={{
                    backgroundColor: 'white',
                    borderRadius: '12px',
                    maxWidth: '500px',
                    width: '100%',
                    maxHeight: '90vh',
                    overflow: 'auto',
                    boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)'
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <div style={{
                    padding: '20px 24px',
                    borderBottom: '1px solid #e5e7eb',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center'
                  }}>
                    <h3 style={{ fontSize: '20px', fontWeight: '600', margin: 0 }}>
                      Select Category Type
                    </h3>
                    <button
                      onClick={() => setShowCategoryModal(false)}
                      style={{
                        border: 'none',
                        background: 'transparent',
                        cursor: 'pointer',
                        padding: '8px',
                        borderRadius: '4px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center'
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#f3f4f6'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                    >
                      <FiX size={24} />
                    </button>
                  </div>
                  <div style={{ padding: '24px' }}>
                    {[
                      { id: 'category', label: 'Category', description: 'Create a new booking category' },
                      { id: 'regular', label: 'Regular', description: 'Set up a regular booking type' },
                      { id: 'special', label: 'Special Event', description: 'Configure special event bookings' }
                    ].map((type) => (
                      <div
                        key={type.id}
                        onClick={async () => {
                          if (type.id === 'category') {
                            // Open form modal for Category
                            setShowCategoryModal(false);
                            setEditingCategoryId(null);
                            setCategoryName('');
                            setCategorySelfServiceRules(defaultCategorySelfServiceRules());
                            setShowCategoryFormModal(true);
                          } else if (type.id === 'regular') {
                            // Open tabbed modal for Regular
                            setShowCategoryModal(false);
                            setShowRegularTabbedModal(true);
                            setRegularModalActiveTab('name');
                            // Reset form and load categories
                            setActivityName('');
                            setSelectedCategoryId('');
                            setActivitySections([]);
                            setActivityDuration({ days: 0, hours: 0, minutes: 30 });
                            setAdvancedBookingMinNotice({ value: 5, unit: 'minutes' });
                            setAdvancedBookingMaxAdvance({ value: 20, unit: 'days' });
                            setEditingActivityId(null);
                            setMinTickets(null);
                            setMaxTickets(null);
                            setOnlinePaymentSettings(defaultOnlinePaymentSettings());
                            setExtensionPricingSettings(defaultExtensionPricingSettings());
        setExtensionPricingSettings(defaultExtensionPricingSettings());
                            setRequiresWaiver(false);
                            setPortalVisible(true);
                            setRequiresCamperRegistration(false);
                            setPartyIncludedKids(null);
                            setPartyIncludedAdults(null);
                            setPartyOneAdultPerChildMode('inherit');
                            setActivityImages([]);
                            setActivityImageUrlInput('');
                            setActivityImageUploadError(null);
                            setSelectedInventoryItems([]);
                            setInventoryItems([]);
                            setTicketAssignmentRules([]);
                            setTicketPricingRules([]);
                            await loadCategoriesForDropdown();
                          } else {
                            // Show "Coming Soon" for Special Event
                            setSelectedCategoryType(type.label);
                            setShowCategoryModal(false);
                            setShowCategoryTypeModal(true);
                          }
                        }}
                        style={{
                          padding: '20px',
                          border: '1px solid #e5e7eb',
                          borderRadius: '12px',
                          marginBottom: '12px',
                          cursor: 'pointer',
                          transition: 'all 0.2s',
                          backgroundColor: 'white'
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.borderColor = TavariStyles.colors.primary;
                          e.currentTarget.style.backgroundColor = '#f0fdf4';
                          e.currentTarget.style.transform = 'translateY(-2px)';
                          e.currentTarget.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.1)';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.borderColor = '#e5e7eb';
                          e.currentTarget.style.backgroundColor = 'white';
                          e.currentTarget.style.transform = 'translateY(0)';
                          e.currentTarget.style.boxShadow = 'none';
                        }}
                      >
                        <div style={{ fontSize: '18px', fontWeight: '600', marginBottom: '4px', color: TavariStyles.colors.gray900 }}>
                          {type.label}
                        </div>
                        <div style={{ fontSize: '14px', color: TavariStyles.colors.gray600 }}>
                          {type.description}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Category Form Modal */}
            {showCategoryFormModal && (
              <div
                style={{
                  position: 'fixed',
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  backgroundColor: 'rgba(0, 0, 0, 0.5)',
                  zIndex: 100,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '20px'
                }}
                onClick={() => {
                  setShowCategoryFormModal(false);
                  setCategoryName('');
                  setCategorySelfServiceRules(defaultCategorySelfServiceRules());
                  setCategoryPartySettings({ requireBirthdayChild: true, defaultSpacesPerSlot: 1 });
                  setEditingCategoryTypeKey(null);
                  setEditingCategoryId(null);
                }}
              >
                <div
                  style={{
                    backgroundColor: 'white',
                    borderRadius: '12px',
                    maxWidth: '560px',
                    width: '100%',
                    maxHeight: '90vh',
                    overflow: 'auto',
                    boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)'
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <div style={{
                    padding: '20px 24px',
                    borderBottom: '1px solid #e5e7eb',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center'
                  }}>
                    <h3 style={{ fontSize: '20px', fontWeight: '600', margin: 0 }}>
                      {editingCategoryId ? 'Edit Category' : 'Create Category'}
                    </h3>
                    <button
                      onClick={() => {
                        setShowCategoryFormModal(false);
                        setCategoryName('');
                        setCategorySelfServiceRules(defaultCategorySelfServiceRules());
                        setCategoryPartySettings({ requireBirthdayChild: true, defaultSpacesPerSlot: 1 });
                        setEditingCategoryTypeKey(null);
                        setEditingCategoryId(null);
                      }}
                      style={{
                        border: 'none',
                        background: 'transparent',
                        cursor: 'pointer',
                        padding: '8px',
                        borderRadius: '4px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center'
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#f3f4f6'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                    >
                      <FiX size={24} />
                    </button>
                  </div>
                  <div style={{ padding: '24px' }}>
                    <div style={{ marginBottom: '20px' }}>
                      <label style={{ display: 'block', marginBottom: '8px', fontWeight: '600', fontSize: '14px' }}>
                        Category Name
                      </label>
                      <input
                        type="text"
                        value={categoryName}
                        onChange={(e) => setCategoryName(e.target.value)}
                        placeholder="Enter category name..."
                        style={{
                          width: '100%',
                          padding: '12px',
                          border: '1px solid #e5e7eb',
                          borderRadius: '8px',
                          fontSize: '16px',
                          boxSizing: 'border-box'
                        }}
                        onKeyPress={(e) => {
                          if (e.key === 'Enter' && categoryName.trim()) {
                            handleSaveCategory();
                          }
                        }}
                        autoFocus
                      />
                    </div>
                    {editingCategoryTypeKey === BIRTHDAY_PARTY_TYPE_KEY && (
                      <div
                        style={{
                          marginBottom: 20,
                          padding: 16,
                          borderRadius: 8,
                          backgroundColor: '#eff6ff',
                          border: '1px solid #bfdbfe',
                        }}
                      >
                        <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 8, color: '#1e40af' }}>
                          Birthday party booking
                        </div>
                        <p style={{ margin: '0 0 14px', fontSize: 13, color: '#1e3a8a', lineHeight: 1.5 }}>
                          One time slot = one party space. Customers choose a host adult and birthday child — not every waiver guest.
                        </p>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, cursor: 'pointer' }}>
                          <TavariCheckbox
                            checked={categoryPartySettings.requireBirthdayChild}
                            onChange={(checked) =>
                              setCategoryPartySettings((prev) => ({ ...prev, requireBirthdayChild: checked }))
                            }
                            size="md"
                          />
                          <span style={{ fontSize: 14, fontWeight: 500 }}>Require birthday child selection</span>
                        </label>
                        <p style={{ margin: '0 0 8px', fontSize: 13, color: TavariStyles.colors.gray600 }}>
                          Turn off for adult-only parties (host only).
                        </p>
                        <label style={{ display: 'block', marginBottom: 8, fontWeight: 600, fontSize: 13 }}>
                          Default spaces per time slot
                        </label>
                        <input
                          type="number"
                          min={1}
                          value={categoryPartySettings.defaultSpacesPerSlot}
                          onChange={(e) =>
                            setCategoryPartySettings((prev) => ({
                              ...prev,
                              defaultSpacesPerSlot: Math.max(1, Number.parseInt(e.target.value, 10) || 1),
                            }))
                          }
                          style={{
                            width: 120,
                            padding: '10px 12px',
                            border: '1px solid #e5e7eb',
                            borderRadius: 8,
                            fontSize: 14,
                          }}
                        />
                      </div>
                    )}
                    <div
                      style={{
                        marginBottom: 20,
                        padding: 16,
                        borderRadius: 8,
                        backgroundColor: '#f0fdf4',
                        border: '1px solid #bbf7d0',
                      }}
                    >
                      <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 8, color: '#166534' }}>
                        Shared capacity (all activities in this category)
                      </div>
                      <p style={{ margin: '0 0 14px', fontSize: 13, color: '#15803d', lineHeight: 1.5 }}>
                        Optional pool shared across every activity in this category. Individual activity schedules can still set their own spaces — bookings are limited by whichever is tighter.
                      </p>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, cursor: 'pointer' }}>
                        <TavariCheckbox
                          checked={categorySharedCapacity.enabled}
                          onChange={(checked) =>
                            setCategorySharedCapacity((prev) => ({ ...prev, enabled: checked }))
                          }
                          size="md"
                        />
                        <span style={{ fontSize: 14, fontWeight: 500 }}>Enable shared capacity limit</span>
                      </label>
                      {categorySharedCapacity.enabled && (
                        <>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 14 }}>
                            <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
                              <input
                                type="radio"
                                name="categoryCapacityMode"
                                checked={categorySharedCapacity.mode === CATEGORY_CAPACITY_MODES.DAILY}
                                onChange={() =>
                                  setCategorySharedCapacity((prev) => ({
                                    ...prev,
                                    mode: CATEGORY_CAPACITY_MODES.DAILY,
                                  }))
                                }
                              />
                              <span style={{ fontSize: 14 }}>Daily cap (one pool per calendar day)</span>
                            </label>
                            <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
                              <input
                                type="radio"
                                name="categoryCapacityMode"
                                checked={categorySharedCapacity.mode === CATEGORY_CAPACITY_MODES.TIME_SLOT}
                                onChange={() =>
                                  setCategorySharedCapacity((prev) => ({
                                    ...prev,
                                    mode: CATEGORY_CAPACITY_MODES.TIME_SLOT,
                                  }))
                                }
                              />
                              <span style={{ fontSize: 14 }}>Time slot cap (pool per date + start time)</span>
                            </label>
                          </div>
                          <label style={{ display: 'block', marginBottom: 8, fontWeight: 600, fontSize: 13 }}>
                            Maximum units in pool
                          </label>
                          <input
                            type="number"
                            min={1}
                            value={categorySharedCapacity.max ?? ''}
                            onChange={(e) =>
                              setCategorySharedCapacity((prev) => ({
                                ...prev,
                                max: Math.max(1, Number.parseInt(e.target.value, 10) || 1),
                              }))
                            }
                            style={{
                              width: 120,
                              padding: '10px 12px',
                              border: '1px solid #e5e7eb',
                              borderRadius: 8,
                              fontSize: 14,
                            }}
                          />
                          <p style={{ margin: '8px 0 0', fontSize: 13, color: TavariStyles.colors.gray600 }}>
                            For day camp, units = campers (adults do not count). For parties, units = bookings.
                          </p>
                        </>
                      )}
                    </div>
                    <div
                      style={{
                        marginTop: 20,
                        paddingTop: 20,
                        borderTop: '1px solid #e5e7eb',
                      }}
                    >
                      <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 12 }}>Customer self-service (manage booking)</div>
                      <p style={{ margin: '0 0 16px', fontSize: 13, color: TavariStyles.colors.gray600 }}>
                        Applies to every activity in this category. Two rule sets apply: when the customer cancels with plenty of notice vs close to the start time.
                      </p>
                      <label style={{ display: 'block', marginBottom: 8, fontWeight: 600, fontSize: 13 }}>
                        Notice split (hours before start)
                      </label>
                      <input
                        type="number"
                        min={1}
                        value={categorySelfServiceRules.noticeSplitHours}
                        onChange={(e) =>
                          setCategorySelfServiceRules((s) => ({
                            ...s,
                            noticeSplitHours: e.target.value === '' ? '' : Number(e.target.value),
                          }))
                        }
                        style={{
                          width: '100%',
                          padding: 10,
                          borderRadius: 8,
                          border: '1px solid #e5e7eb',
                          marginBottom: 8,
                          fontSize: 14,
                          boxSizing: 'border-box',
                        }}
                      />
                      <p style={{ margin: '0 0 16px', fontSize: 13, color: TavariStyles.colors.gray600 }}>
                        At or above this many hours before the event → <strong>early</strong> rules. Below this → <strong>late</strong> rules.
                      </p>
                      <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8 }}>Early cancellation (≥ split hours before start)</div>
                      <label style={{ display: 'block', marginBottom: 8, fontWeight: 600, fontSize: 13 }}>Refund / credit</label>
                      <select
                        value={categorySelfServiceRules.earlyCancelMode}
                        onChange={(e) =>
                          setCategorySelfServiceRules((s) => ({ ...s, earlyCancelMode: e.target.value }))
                        }
                        style={{
                          width: '100%',
                          padding: 10,
                          borderRadius: 8,
                          border: '1px solid #e5e7eb',
                          marginBottom: 12,
                          fontSize: 14,
                          boxSizing: 'border-box',
                        }}
                      >
                        <option value="refund_money">Refund to original card (Helcim)</option>
                        <option value="refund_credit">Refund as store credit</option>
                        <option value="cancel_only">Cancel booking only (no refund, no store credit)</option>
                        <option value="contact_business">Contact business only (no online cancel)</option>
                      </select>
                      <label style={{ display: 'block', marginBottom: 8, fontWeight: 600, fontSize: 13 }}>Deposit bookings</label>
                      <select
                        value={categorySelfServiceRules.earlyDepositPolicy}
                        onChange={(e) =>
                          setCategorySelfServiceRules((s) => ({ ...s, earlyDepositPolicy: e.target.value }))
                        }
                        style={{
                          width: '100%',
                          padding: 10,
                          borderRadius: 8,
                          border: '1px solid #e5e7eb',
                          marginBottom: 16,
                          fontSize: 14,
                          boxSizing: 'border-box',
                        }}
                      >
                        <option value="follow_cancel_mode">Same as refund/credit above</option>
                        <option value="credit_only">Always store credit (never card refund)</option>
                        <option value="non_refundable">Non-refundable (cancel only)</option>
                      </select>
                      <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8 }}>Late cancellation (&lt; split hours before start)</div>
                      <label style={{ display: 'block', marginBottom: 8, fontWeight: 600, fontSize: 13 }}>Refund / credit</label>
                      <select
                        value={categorySelfServiceRules.lateCancelMode}
                        onChange={(e) =>
                          setCategorySelfServiceRules((s) => ({ ...s, lateCancelMode: e.target.value }))
                        }
                        style={{
                          width: '100%',
                          padding: 10,
                          borderRadius: 8,
                          border: '1px solid #e5e7eb',
                          marginBottom: 8,
                          fontSize: 14,
                          boxSizing: 'border-box',
                        }}
                      >
                        <option value="refund_money">Refund to original card (Helcim)</option>
                        <option value="refund_credit">Refund as store credit</option>
                        <option value="cancel_only">Cancel booking only (no refund, no store credit)</option>
                        <option value="contact_business">Contact business only (no online cancel)</option>
                      </select>
                      {categorySelfServiceRules.lateCancelMode === 'cancel_only' && (
                        <p style={{ margin: '0 0 12px', fontSize: 13, color: TavariStyles.colors.gray600 }}>
                          Deposit rules below do not apply when this option is selected — no payouts of any kind.
                        </p>
                      )}
                      <label style={{ display: 'block', marginBottom: 8, fontWeight: 600, fontSize: 13 }}>Deposit bookings</label>
                      <select
                        value={categorySelfServiceRules.lateDepositPolicy}
                        onChange={(e) =>
                          setCategorySelfServiceRules((s) => ({ ...s, lateDepositPolicy: e.target.value }))
                        }
                        style={{
                          width: '100%',
                          padding: 10,
                          borderRadius: 8,
                          border: '1px solid #e5e7eb',
                          marginBottom: 16,
                          fontSize: 14,
                          boxSizing: 'border-box',
                        }}
                      >
                        <option value="follow_cancel_mode">Same as refund/credit above</option>
                        <option value="credit_only">Always store credit (never card refund)</option>
                        <option value="non_refundable">Non-refundable (cancel only)</option>
                      </select>
                      <div style={{ marginBottom: 12 }}>
                        <TavariCheckbox
                          id="booking-category-allow-reschedule"
                          appearance="native"
                          checked={!!categorySelfServiceRules.allowReschedule}
                          onChange={(checked) =>
                            setCategorySelfServiceRules((s) => ({ ...s, allowReschedule: !!checked }))
                          }
                          label="Allow customers to reschedule online"
                          size="md"
                          labelStyle={{ fontWeight: 600 }}
                        />
                      </div>
                      <label style={{ display: 'block', marginBottom: 8, fontWeight: 600, fontSize: 13 }}>
                        Minimum notice to reschedule (hours before start)
                      </label>
                      <input
                        type="number"
                        min={0}
                        value={categorySelfServiceRules.minHoursReschedule}
                        onChange={(e) =>
                          setCategorySelfServiceRules((s) => ({
                            ...s,
                            minHoursReschedule: e.target.value === '' ? '' : Number(e.target.value),
                          }))
                        }
                        style={{
                          width: '100%',
                          padding: 10,
                          borderRadius: 8,
                          border: '1px solid #e5e7eb',
                          marginBottom: 16,
                          fontSize: 14,
                          boxSizing: 'border-box',
                        }}
                      />
                      <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>Contact info (when "contact business" is selected)</div>
                      <p style={{ margin: '0 0 10px', fontSize: 13, color: TavariStyles.colors.gray600 }}>
                        {businessContactDefaults.phone || businessContactDefaults.email ? (
                          <>
                            Pre-filled from your business profile (
                            {[businessContactDefaults.phone, businessContactDefaults.email].filter(Boolean).join(' · ')}
                            ). Edit if customers should use different contact details.
                          </>
                        ) : (
                          <>
                            Add your business phone and email under Settings if you want them suggested here. Fields stay editable.
                          </>
                        )}
                      </p>
                      <input
                        type="tel"
                        placeholder={businessContactDefaults.phone || 'Phone'}
                        value={categorySelfServiceRules.contactPhone}
                        onChange={(e) =>
                          setCategorySelfServiceRules((s) => ({ ...s, contactPhone: e.target.value }))
                        }
                        style={{
                          width: '100%',
                          padding: 10,
                          borderRadius: 8,
                          border: '1px solid #e5e7eb',
                          marginBottom: 8,
                          fontSize: 14,
                          boxSizing: 'border-box',
                        }}
                      />
                      <input
                        type="email"
                        placeholder={businessContactDefaults.email || 'Email'}
                        value={categorySelfServiceRules.contactEmail}
                        onChange={(e) =>
                          setCategorySelfServiceRules((s) => ({ ...s, contactEmail: e.target.value }))
                        }
                        style={{
                          width: '100%',
                          padding: 10,
                          borderRadius: 8,
                          border: '1px solid #e5e7eb',
                          marginBottom: 0,
                          fontSize: 14,
                          boxSizing: 'border-box',
                        }}
                      />
                    </div>
                    <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
                      <button
                      onClick={() => {
                        setShowCategoryFormModal(false);
                        setCategoryName('');
                        setCategorySelfServiceRules(defaultCategorySelfServiceRules());
                        setCategoryPartySettings({ requireBirthdayChild: true, defaultSpacesPerSlot: 1 });
                        setEditingCategoryTypeKey(null);
                        setEditingCategoryId(null);
                        setShowCategoryModal(true);
                      }}
                        style={{
                          padding: '10px 20px',
                          backgroundColor: TavariStyles.colors.gray700,
                          color: 'white',
                          border: 'none',
                          borderRadius: '8px',
                          fontSize: '14px',
                          fontWeight: '600',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px'
                        }}
                      >
                        <FiArrowLeft size={16} />
                        Back
                      </button>
                      <button
                        onClick={handleSaveCategory}
                        disabled={saving || !categoryName.trim()}
                        style={{
                          padding: '10px 20px',
                          backgroundColor: saving || !categoryName.trim() ? '#ccc' : TavariStyles.colors.primary,
                          color: 'white',
                          border: 'none',
                          borderRadius: '8px',
                          fontSize: '14px',
                          fontWeight: '600',
                          cursor: saving || !categoryName.trim() ? 'not-allowed' : 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px'
                        }}
                      >
                        <FiSave size={16} />
                        {saving ? 'Saving...' : 'Save'}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Coming Soon Modal */}
            {showCategoryTypeModal && (
              <div
                style={{
                  position: 'fixed',
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  backgroundColor: 'rgba(0, 0, 0, 0.5)',
                  zIndex: 100,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '20px'
                }}
                onClick={() => {
                  setShowCategoryTypeModal(false);
                  setSelectedCategoryType(null);
                }}
              >
                <div
                  style={{
                    backgroundColor: 'white',
                    borderRadius: '12px',
                    maxWidth: '500px',
                    width: '100%',
                    maxHeight: '90vh',
                    overflow: 'auto',
                    boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)'
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <div style={{
                    padding: '20px 24px',
                    borderBottom: '1px solid #e5e7eb',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center'
                  }}>
                    <h3 style={{ fontSize: '20px', fontWeight: '600', margin: 0 }}>
                      {selectedCategoryType}
                    </h3>
                    <button
                      onClick={() => {
                        setShowCategoryTypeModal(false);
                        setSelectedCategoryType(null);
                      }}
                      style={{
                        border: 'none',
                        background: 'transparent',
                        cursor: 'pointer',
                        padding: '8px',
                        borderRadius: '4px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center'
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#f3f4f6'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                    >
                      <FiX size={24} />
                    </button>
                  </div>
                  <div style={{ padding: '60px 40px', textAlign: 'center' }}>
                    <div style={{ fontSize: '18px', fontWeight: '600', marginBottom: '8px', color: TavariStyles.colors.gray900 }}>
                      Coming Soon
                    </div>
                    <div style={{ fontSize: '14px', color: TavariStyles.colors.gray600, marginBottom: '24px' }}>
                      This feature is under development
                    </div>
                    <button
                      onClick={() => {
                        setShowCategoryTypeModal(false);
                        setSelectedCategoryType(null);
                        setShowCategoryModal(true);
                      }}
                      style={{
                        padding: '10px 20px',
                        backgroundColor: TavariStyles.colors.gray700,
                        color: 'white',
                        border: 'none',
                        borderRadius: '8px',
                        fontSize: '14px',
                        fontWeight: '600',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        margin: '0 auto'
                      }}
                    >
                      <FiArrowLeft size={16} />
                      Back
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Regular Tabbed Modal */}
            {showRegularTabbedModal && (
              <div
                style={{
                  position: 'fixed',
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  backgroundColor: 'rgba(0, 0, 0, 0.5)',
                  zIndex: 100,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '20px'
                }}
              >
                <div
                  style={{
                    backgroundColor: 'white',
                    borderRadius: '12px',
                    maxWidth: '1200px',
                    width: '100%',
                    maxHeight: '90vh',
                    boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)',
                    display: 'flex',
                    flexDirection: 'column',
                    overflow: 'hidden'
                  }}
                >
                  {/* Header */}
                  <div style={{
                    padding: '20px 24px',
                    borderBottom: '1px solid #e5e7eb',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center'
                  }}>
                    <h3 style={{ fontSize: '20px', fontWeight: '600', margin: 0 }}>
                      {editingActivityId ? 'Edit Activity' : 'Regular'}
                    </h3>
                    <button
                      onClick={() => {
                        setShowRegularTabbedModal(false);
                        setRegularModalActiveTab('name');
                        setEditingActivityId(null);
                        setActivityName('');
                        setSelectedCategoryId('');
                        setActivitySections([]);
      setActivityDuration({ days: 0, hours: 0, minutes: 30 });
      setAdvancedBookingMinNotice({ value: 5, unit: 'minutes' });
      setAdvancedBookingMaxAdvance({ value: 20, unit: 'days' });
      setMinTickets(null);
      setMaxTickets(null);
      setOnlinePaymentSettings(defaultOnlinePaymentSettings());
      setExtensionPricingSettings(defaultExtensionPricingSettings());
      setRequiresWaiver(false);
      setPortalVisible(true);
      setRequiresCamperRegistration(false);
                        setActivityImages([]);
                        setActivityImageUrlInput('');
                        setActivityImageUploadError(null);
                        setSelectedInventoryItems([]);
                        setInventoryItems([]);
                        setTicketAssignmentRules([]);
                        setTicketPricingRules([]);
      setScheduleTimeSlots({});
      setScheduleDateRange({ startDate: '', endDate: '' });
      setScheduleName('');
      setSavedSchedules([]);
      setExpandedScheduleId(null);
      setIsIndefiniteSchedule(true); // Reset to default (indefinite)
      setScheduleMode('regular');
      setIndividualDatesSlots({});
                      }}
                      style={{
                        border: 'none',
                        background: 'transparent',
                        cursor: 'pointer',
                        padding: '8px',
                        borderRadius: '4px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center'
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#f3f4f6'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                    >
                      <FiX size={24} />
                    </button>
                  </div>

                  {/* Tabs */}
                  <div style={{
                    display: 'flex',
                    borderBottom: '1px solid #e5e7eb',
                    padding: '0 24px',
                    gap: '8px'
                  }}>
                    {[
                      { id: 'name', label: 'Name / Definition' },
                      { id: 'schedule', label: 'Schedule' },
                      { id: 'pricing', label: 'Pricing' },
                      { id: 'options', label: 'Options' },
                      { id: 'pay-deposit', label: 'Pay & Deposit' },
                      { id: 'booking-settings', label: 'Booking Settings' },
                      { id: 'guest-limits', label: 'Guest List' },
                      { id: 'additional-tabs', label: 'Additional Tabs' },
                      { id: 'images', label: 'Images' }
                    ].map((tab) => (
                      <button
                        key={tab.id}
                        onClick={() => setRegularModalActiveTab(tab.id)}
                        style={{
                          padding: '12px 16px',
                          border: 'none',
                          background: 'transparent',
                          cursor: 'pointer',
                          fontSize: '14px',
                          fontWeight: regularModalActiveTab === tab.id ? '600' : '400',
                          color: regularModalActiveTab === tab.id ? TavariStyles.colors.primary : TavariStyles.colors.gray600,
                          borderBottom: regularModalActiveTab === tab.id ? `2px solid ${TavariStyles.colors.primary}` : '2px solid transparent',
                          marginBottom: '-1px',
                          transition: 'all 0.2s'
                        }}
                        onMouseEnter={(e) => {
                          if (regularModalActiveTab !== tab.id) {
                            e.currentTarget.style.color = TavariStyles.colors.gray900;
                          }
                        }}
                        onMouseLeave={(e) => {
                          if (regularModalActiveTab !== tab.id) {
                            e.currentTarget.style.color = TavariStyles.colors.gray600;
                          }
                        }}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>

                  {/* Tab Content */}
                  <div style={{ padding: '40px 24px', flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
                    {regularModalActiveTab === 'name' && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                        {/* Activity Name */}
                        <div>
                          <label style={{ display: 'block', marginBottom: '8px', fontWeight: '600', fontSize: '14px', color: TavariStyles.colors.gray900 }}>
                            Name
                          </label>
                          <input
                            type="text"
                            value={activityName}
                            onChange={(e) => setActivityName(e.target.value)}
                            placeholder="Enter activity name..."
                            style={{
                              width: '100%',
                              padding: '12px',
                              border: '1px solid #e5e7eb',
                              borderRadius: '8px',
                              fontSize: '16px',
                              boxSizing: 'border-box'
                            }}
                          />
                        </div>

                        {/* Category Dropdown */}
                        <div>
                          <label style={{ display: 'block', marginBottom: '8px', fontWeight: '600', fontSize: '14px', color: TavariStyles.colors.gray900 }}>
                            Category
                          </label>
                          <select
                            value={selectedCategoryId}
                            onChange={(e) => setSelectedCategoryId(e.target.value)}
                            style={{
                              width: '100%',
                              padding: '12px',
                              border: '1px solid #e5e7eb',
                              borderRadius: '8px',
                              fontSize: '16px',
                              backgroundColor: 'white',
                              boxSizing: 'border-box',
                              cursor: 'pointer'
                            }}
                          >
                            <option value="">Select a category...</option>
                            {categories.filter(cat => cat.is_active).map((category) => (
                              <option key={category.id} value={category.id}>
                                {category.display_name || category.type_name}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div
                          style={{
                            padding: '16px',
                            borderRadius: '8px',
                            border: '1px solid #e5e7eb',
                            backgroundColor: portalVisible ? '#f0fdf4' : '#fffbeb',
                          }}
                        >
                          <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer' }}>
                            <TavariCheckbox
                              checked={portalVisible}
                              onChange={(checked) => setPortalVisible(checked)}
                              size="md"
                            />
                            <span>
                              <span style={{ display: 'block', fontWeight: 600, fontSize: '14px', color: TavariStyles.colors.gray900 }}>
                                Show on customer booking site
                              </span>
                              <span style={{ display: 'block', fontSize: '13px', color: TavariStyles.colors.gray600, marginTop: 4, lineHeight: 1.45 }}>
                                When off, staff can still book this activity (imports, phone bookings). Customers will not see it on the online portal or be able to start a new booking from a direct link.
                              </span>
                            </span>
                          </label>
                        </div>

                        {/* Sections */}
                        <div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                            <label style={{ fontWeight: '600', fontSize: '14px', color: TavariStyles.colors.gray900 }}>
                              Additional Information Sections
                            </label>
                            <button
                              onClick={addActivitySection}
                              style={{
                                padding: '8px 16px',
                                backgroundColor: TavariStyles.colors.primary,
                                color: 'white',
                                border: 'none',
                                borderRadius: '8px',
                                fontSize: '14px',
                                fontWeight: '600',
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '8px'
                              }}
                            >
                              <FiPlus size={16} />
                              Add Section
                            </button>
                          </div>
                          <p style={{ fontSize: '13px', color: TavariStyles.colors.gray600, margin: '0 0 16px', lineHeight: 1.5 }}>
                            This is the customer-facing copy on the online booking portal (activity cards and detail pages). Edit here anytime — nothing is hard-coded.
                          </p>

                          {activitySections.length === 0 ? (
                            <div style={{
                              padding: '40px',
                              textAlign: 'center',
                              border: '2px dashed #e5e7eb',
                              borderRadius: '8px',
                              color: TavariStyles.colors.gray600
                            }}>
                              <div style={{ fontSize: '14px' }}>
                                No sections added yet. Click "Add Section" to add information sections.
                              </div>
                            </div>
                          ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                              {activitySections.map((section) => (
                                <div
                                  key={section.id}
                                  style={{
                                    padding: '20px',
                                    border: '1px solid #e5e7eb',
                                    borderRadius: '8px',
                                    backgroundColor: '#f9fafb'
                                  }}
                                >
                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                                    <div style={{ flex: 1, marginRight: '12px' }}>
                                      <label style={{ display: 'block', marginBottom: '8px', fontWeight: '600', fontSize: '14px', color: TavariStyles.colors.gray900 }}>
                                        Section Header
                                      </label>
                                      <input
                                        type="text"
                                        value={section.header}
                                        onChange={(e) => updateActivitySection(section.id, 'header', e.target.value)}
                                        placeholder="e.g., What to Bring, Itinerary, Additional Details..."
                                        style={{
                                          width: '100%',
                                          padding: '10px',
                                          border: '1px solid #e5e7eb',
                                          borderRadius: '6px',
                                          fontSize: '14px',
                                          boxSizing: 'border-box'
                                        }}
                                      />
                                    </div>
                                    <button
                                      onClick={() => removeActivitySection(section.id)}
                                      style={{
                                        padding: '10px',
                                        border: 'none',
                                        background: 'transparent',
                                        cursor: 'pointer',
                                        borderRadius: '6px',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        color: '#ef4444',
                                        marginTop: '24px'
                                      }}
                                      onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#fee2e2'; }}
                                      onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                                    >
                                      <FiTrash2 size={18} />
                                    </button>
                                  </div>
                                  <div>
                                    <label style={{ display: 'block', marginBottom: '8px', fontWeight: '600', fontSize: '14px', color: TavariStyles.colors.gray900 }}>
                                      Details
                                    </label>
                                    <textarea
                                      value={section.details}
                                      onChange={(e) => updateActivitySection(section.id, 'details', e.target.value)}
                                      placeholder="Enter section details..."
                                      rows={4}
                                      style={{
                                        width: '100%',
                                        padding: '10px',
                                        border: '1px solid #e5e7eb',
                                        borderRadius: '6px',
                                        fontSize: '14px',
                                        boxSizing: 'border-box',
                                        fontFamily: 'inherit',
                                        resize: 'vertical'
                                      }}
                                    />
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                    {regularModalActiveTab === 'schedule' && (
                      <div ref={scheduleEditorRef} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                        {editingScheduleName && (
                          <div style={{
                            padding: '12px 16px',
                            backgroundColor: `${TavariStyles.colors.primary}15`,
                            border: `1px solid ${TavariStyles.colors.primary}`,
                            borderRadius: '8px',
                          }}>
                            <div style={{ fontSize: '14px', fontWeight: '600', color: TavariStyles.colors.primary }}>
                              Editing schedule: {editingScheduleName}
                            </div>
                            <div style={{ fontSize: '13px', color: TavariStyles.colors.gray700, marginTop: 4 }}>
                              Make your changes below, then click Update Schedule.
                            </div>
                          </div>
                        )}
                        {!editingActivityId && (
                          <div style={{
                            padding: '20px',
                            backgroundColor: '#fef3c7',
                            border: '1px solid #fbbf24',
                            borderRadius: '8px',
                            marginBottom: '16px'
                          }}>
                            <div style={{ fontSize: '14px', fontWeight: '600', color: '#92400e', marginBottom: '8px' }}>
                              ⚠️ Activity Not Saved
                            </div>
                            <div style={{ fontSize: '13px', color: '#78350f' }}>
                              Please go to the "Name / Definition" tab and click "Save" to save the activity before creating schedules.
                            </div>
                          </div>
                        )}
                        {/* Toggle: Regular schedule vs Individual dates */}
                        <div style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '12px',
                          marginBottom: '16px',
                          padding: '12px 16px',
                          backgroundColor: '#f9fafb',
                          border: '1px solid #e5e7eb',
                          borderRadius: '8px',
                          flexWrap: 'wrap',
                        }}>
                          <span style={{ fontSize: '14px', fontWeight: '600', color: TavariStyles.colors.gray900 }}>
                            Schedule type:
                          </span>
                          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                            <input
                              type="radio"
                              name="scheduleMode"
                              checked={scheduleMode === 'regular'}
                              onChange={() => setScheduleMode('regular')}
                            />
                            <span style={{ fontSize: '14px' }}>Regular schedule (weekly)</span>
                          </label>
                          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                            <input
                              type="radio"
                              name="scheduleMode"
                              checked={scheduleMode === 'individual'}
                              onChange={() => setScheduleMode('individual')}
                            />
                            <span style={{ fontSize: '14px' }}>Individual dates</span>
                          </label>
                          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                            <input
                              type="radio"
                              name="scheduleMode"
                              checked={scheduleMode === 'multiDay'}
                              onChange={() => setScheduleMode('multiDay')}
                            />
                            <span style={{ fontSize: '14px' }}>Multi-day event</span>
                          </label>
                        </div>

                        {scheduleMode === 'regular' && (
                        <>
                        <div style={{ fontSize: '16px', fontWeight: '600', marginBottom: '8px', color: TavariStyles.colors.gray900 }}>
                          Weekly Schedule
                        </div>
                        
                        {/* Schedule Name and Date Range */}
                        <div style={{
                          padding: '16px',
                          border: '1px solid #e5e7eb',
                          borderRadius: '8px',
                          backgroundColor: '#f9fafb',
                          marginBottom: '16px'
                        }}>
                          <div style={{ 
                            fontSize: '14px', 
                            fontWeight: '600', 
                            marginBottom: '12px', 
                            color: TavariStyles.colors.gray900
                          }}>
                            Schedule Name & Validity Period
                          </div>
                          <div style={{ marginBottom: '16px' }}>
                            <label style={{ 
                              display: 'block', 
                              fontSize: '13px', 
                              fontWeight: '500', 
                              marginBottom: '4px',
                              color: TavariStyles.colors.gray700
                            }}>
                              Schedule Name *
                            </label>
                            <input
                              type="text"
                              value={scheduleName}
                              onChange={(e) => setScheduleName(e.target.value)}
                              placeholder="e.g., Regular Schedule, Christmas Week, Summer Season"
                              style={{
                                width: '100%',
                                padding: '10px',
                                border: '1px solid #e5e7eb',
                                borderRadius: '6px',
                                fontSize: '14px',
                                boxSizing: 'border-box'
                              }}
                            />
                            <div style={{ fontSize: '11px', color: TavariStyles.colors.gray500, marginTop: '4px' }}>
                              Give this schedule a name for easy tracking (e.g., "Christmas Week 2026", "Summer Schedule")
                            </div>
                          </div>
                          <div style={{ 
                            fontSize: '13px', 
                            fontWeight: '500', 
                            marginBottom: '8px', 
                            color: TavariStyles.colors.gray700
                          }}>
                            Validity Period
                          </div>
                          <div style={{ marginBottom: '12px' }}>
                            <TavariCheckbox
                              checked={isIndefiniteSchedule}
                              onChange={(checked) => {
                                setIsIndefiniteSchedule(checked);
                                if (checked) {
                                  // Clear date range when making indefinite
                                  setScheduleDateRange({ startDate: '', endDate: '' });
                                }
                              }}
                              label="Run indefinitely (default schedule)"
                              size="sm"
                            />
                            <div style={{ fontSize: '11px', color: TavariStyles.colors.gray500, marginTop: '4px', marginLeft: '24px' }}>
                              Indefinite schedules are the default. Date-specific schedules override the default for their period.
                            </div>
                          </div>
                          {!isIndefiniteSchedule && (
                            <>
                              <div style={{ fontSize: '13px', color: TavariStyles.colors.gray600, marginBottom: '12px' }}>
                                Set when this entire weekly schedule is active. Perfect for planning schedules months in advance (e.g., Christmas week, summer season).
                              </div>
                              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                            <div>
                              <label style={{ 
                                display: 'block', 
                                fontSize: '13px', 
                                fontWeight: '500', 
                                marginBottom: '4px',
                                color: TavariStyles.colors.gray700
                              }}>
                                Start Date
                              </label>
                              <input
                                type="date"
                                value={scheduleDateRange.startDate || ''}
                                onChange={(e) => setScheduleDateRange(prev => ({ ...prev, startDate: e.target.value }))}
                                style={{
                                  width: '100%',
                                  padding: '10px',
                                  border: '1px solid #e5e7eb',
                                  borderRadius: '6px',
                                  fontSize: '14px',
                                  boxSizing: 'border-box'
                                }}
                              />
                            </div>
                            <div>
                              <label style={{ 
                                display: 'block', 
                                fontSize: '13px', 
                                fontWeight: '500', 
                                marginBottom: '4px',
                                color: TavariStyles.colors.gray700
                              }}>
                                End Date
                              </label>
                              <input
                                type="date"
                                value={scheduleDateRange.endDate || ''}
                                onChange={(e) => setScheduleDateRange(prev => ({ ...prev, endDate: e.target.value }))}
                                min={scheduleDateRange.startDate || undefined}
                                style={{
                                  width: '100%',
                                  padding: '10px',
                                  border: '1px solid #e5e7eb',
                                  borderRadius: '6px',
                                  fontSize: '14px',
                                  boxSizing: 'border-box'
                                }}
                              />
                            </div>
                              </div>
                              {scheduleDateRange.startDate && scheduleDateRange.endDate && 
                               new Date(scheduleDateRange.startDate) > new Date(scheduleDateRange.endDate) && (
                                <div style={{ fontSize: '13px', color: '#ef4444', marginTop: '8px' }}>
                                  End date must be after start date
                                </div>
                              )}
                              {(scheduleDateRange.startDate || scheduleDateRange.endDate) && 
                               (!scheduleDateRange.startDate || !scheduleDateRange.endDate || 
                                new Date(scheduleDateRange.startDate) <= new Date(scheduleDateRange.endDate)) && (
                                <div style={{ fontSize: '13px', color: TavariStyles.colors.gray600, marginTop: '8px' }}>
                                  {scheduleDateRange.startDate && scheduleDateRange.endDate 
                                    ? `This schedule will be active from ${scheduleDateRange.startDate} to ${scheduleDateRange.endDate}`
                                    : scheduleDateRange.startDate 
                                      ? `This schedule will be active from ${scheduleDateRange.startDate} onwards`
                                      : `This schedule will be active until ${scheduleDateRange.endDate}`
                                  }
                                </div>
                              )}
                            </>
                          )}
                        </div>
                        
                        <div style={{
                          display: 'grid',
                          gridTemplateColumns: 'repeat(7, 1fr)',
                          gap: '12px',
                          width: '100%'
                        }}>
                          {['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map((day) => {
                            const daySlots = scheduleTimeSlots[day] || [];
                            return (
                              <div
                                key={day}
                                style={{
                                  border: '1px solid #e5e7eb',
                                  borderRadius: '8px',
                                  padding: '12px',
                                  backgroundColor: '#f9fafb',
                                  minHeight: '200px',
                                  display: 'flex',
                                  flexDirection: 'column'
                                }}
                              >
                                <div style={{
                                  fontSize: '14px',
                                  fontWeight: '600',
                                  marginBottom: '12px',
                                  color: TavariStyles.colors.gray900,
                                  textAlign: 'center',
                                  paddingBottom: '8px',
                                  borderBottom: '1px solid #e5e7eb'
                                }}>
                                  {day}
                                </div>

                                {/* Time Slots List */}
                                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '12px' }}>
                                  {daySlots.length === 0 ? (
                                    <div style={{
                                      fontSize: '13px',
                                      color: TavariStyles.colors.gray500,
                                      textAlign: 'center',
                                      padding: '20px 0'
                                    }}>
                                      No schedule set
                                    </div>
                                  ) : (
                                    daySlots.map((slot, index) => (
                                      <div
                                        key={index}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleOpenScheduleModal(day, index);
                                        }}
                                        style={{
                                          padding: '8px',
                                          backgroundColor: 'white',
                                          border: '1px solid #e5e7eb',
                                          borderRadius: '6px',
                                          fontSize: '13px',
                                          cursor: 'pointer',
                                          position: 'relative',
                                          transition: 'all 0.2s'
                                        }}
                                        onMouseEnter={(e) => {
                                          e.currentTarget.style.borderColor = TavariStyles.colors.primary;
                                          e.currentTarget.style.backgroundColor = '#f0fdf4';
                                        }}
                                        onMouseLeave={(e) => {
                                          e.currentTarget.style.borderColor = '#e5e7eb';
                                          e.currentTarget.style.backgroundColor = 'white';
                                        }}
                                      >
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                          <div style={{ flex: 1 }}>
                                            <div style={{ fontWeight: '600', marginBottom: '4px' }}>
                                              {slot.startTime}
                                            </div>
                                            {slot.spaces && (
                                              <div style={{ color: TavariStyles.colors.gray600, fontSize: '11px' }}>
                                                {slot.spaces} spaces
                                              </div>
                                            )}
                                          </div>
                                          <button
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              handleDeleteScheduleTimeSlot(day, index);
                                            }}
                                            style={{
                                              padding: '4px',
                                              border: 'none',
                                              background: 'transparent',
                                              cursor: 'pointer',
                                              color: '#ef4444',
                                              display: 'flex',
                                              alignItems: 'center',
                                              justifyContent: 'center',
                                              borderRadius: '4px'
                                            }}
                                            onMouseEnter={(e) => {
                                              e.currentTarget.style.backgroundColor = '#fee2e2';
                                            }}
                                            onMouseLeave={(e) => {
                                              e.currentTarget.style.backgroundColor = 'transparent';
                                            }}
                                            title="Delete time slot"
                                          >
                                            <FiTrash2 size={14} />
                                          </button>
                                        </div>
                                      </div>
                                    ))
                                  )}
                                </div>
                                
                                {/* Plus Button */}
                                <button
                                  onClick={() => handleOpenScheduleModal(day, null)}
                                  style={{
                                    width: '100%',
                                    padding: '8px',
                                    border: '1px dashed #d1d5db',
                                    borderRadius: '6px',
                                    backgroundColor: 'transparent',
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    gap: '6px',
                                    color: TavariStyles.colors.gray600,
                                    fontSize: '13px',
                                    fontWeight: '500'
                                  }}
                                  onMouseEnter={(e) => {
                                    e.currentTarget.style.borderColor = TavariStyles.colors.primary;
                                    e.currentTarget.style.color = TavariStyles.colors.primary;
                                    e.currentTarget.style.backgroundColor = '#f0fdf4';
                                  }}
                                  onMouseLeave={(e) => {
                                    e.currentTarget.style.borderColor = '#d1d5db';
                                    e.currentTarget.style.color = TavariStyles.colors.gray600;
                                    e.currentTarget.style.backgroundColor = 'transparent';
                                  }}
                                >
                                  <FiPlus size={14} />
                                  Add Time Slot
                                </button>
                              </div>
                            );
                          })}
                        </div>

                        {/* Copy Schedule Section */}
                        <div style={{
                          marginTop: '24px',
                          padding: '16px',
                          border: '1px solid #e5e7eb',
                          borderRadius: '8px',
                          backgroundColor: '#f9fafb',
                          marginBottom: '16px'
                        }}>
                          <div style={{ 
                            fontSize: '14px', 
                            fontWeight: '600', 
                            marginBottom: '12px', 
                            color: TavariStyles.colors.gray900,
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px'
                          }}>
                            <FiCopy size={16} />
                            Copy Schedule
                          </div>
                          <div style={{ 
                            display: 'flex', 
                            gap: '12px', 
                            alignItems: 'flex-end',
                            flexWrap: 'wrap'
                          }}>
                            {/* Source Day */}
                            <div style={{ flex: 1, minWidth: '120px' }}>
                              <label style={{ 
                                display: 'block', 
                                fontSize: '13px', 
                                fontWeight: '500', 
                                marginBottom: '4px',
                                color: TavariStyles.colors.gray700
                              }}>
                                Copy From
                              </label>
                              <select
                                value={copySourceDay}
                                onChange={(e) => setCopySourceDay(e.target.value)}
                                style={{
                                  width: '100%',
                                  padding: '8px',
                                  border: '1px solid #e5e7eb',
                                  borderRadius: '6px',
                                  fontSize: '14px',
                                  backgroundColor: 'white',
                                  cursor: 'pointer'
                                }}
                              >
                                <option value="">Select day...</option>
                                {['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map(day => (
                                  <option key={day} value={day}>{day}</option>
                                ))}
                              </select>
                            </div>

                            {/* Copy To All Days Checkbox */}
                            <div style={{ display: 'flex', alignItems: 'center', marginBottom: '4px' }}>
                              <TavariCheckbox
                                checked={copyToAllDays}
                                onChange={(checked) => {
                                  setCopyToAllDays(checked);
                                  if (checked) {
                                    setCopyDestinationDay('');
                                  }
                                }}
                                label="Copy to all days"
                                size="sm"
                              />
                            </div>

                            {/* Destination Day (only if not copying to all) */}
                            {!copyToAllDays && (
                              <div style={{ flex: 1, minWidth: '120px' }}>
                                <label style={{ 
                                  display: 'block', 
                                  fontSize: '13px', 
                                  fontWeight: '500', 
                                  marginBottom: '4px',
                                  color: TavariStyles.colors.gray700
                                }}>
                                  Copy To
                                </label>
                                <select
                                  value={copyDestinationDay}
                                  onChange={(e) => setCopyDestinationDay(e.target.value)}
                                  style={{
                                    width: '100%',
                                    padding: '8px',
                                    border: '1px solid #e5e7eb',
                                    borderRadius: '6px',
                                    fontSize: '14px',
                                    backgroundColor: 'white',
                                    cursor: 'pointer'
                                  }}
                                >
                                  <option value="">Select day...</option>
                                  {['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
                                    .filter(day => day !== copySourceDay)
                                    .map(day => (
                                      <option key={day} value={day}>{day}</option>
                                    ))}
                                </select>
                              </div>
                            )}

                            {/* Copy Button */}
                            <button
                              onClick={handleCopySchedule}
                              disabled={!copySourceDay || (!copyToAllDays && !copyDestinationDay)}
                              style={{
                                padding: '8px 16px',
                                backgroundColor: copySourceDay && (copyToAllDays || copyDestinationDay) 
                                  ? TavariStyles.colors.primary 
                                  : TavariStyles.colors.gray300,
                                color: copySourceDay && (copyToAllDays || copyDestinationDay) 
                                  ? 'white' 
                                  : TavariStyles.colors.gray500,
                                border: 'none',
                                borderRadius: '6px',
                                fontSize: '14px',
                                fontWeight: '600',
                                cursor: copySourceDay && (copyToAllDays || copyDestinationDay) 
                                  ? 'pointer' 
                                  : 'not-allowed',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '6px',
                                transition: 'all 0.2s'
                              }}
                              onMouseEnter={(e) => {
                                if (copySourceDay && (copyToAllDays || copyDestinationDay)) {
                                  e.currentTarget.style.opacity = '0.9';
                                }
                              }}
                              onMouseLeave={(e) => {
                                if (copySourceDay && (copyToAllDays || copyDestinationDay)) {
                                  e.currentTarget.style.opacity = '1';
                                }
                              }}
                            >
                              <FiCopy size={14} />
                              Copy
                            </button>
                          </div>
                        </div>

                        </> )}

                        {(scheduleMode === 'individual' || scheduleMode === 'multiDay') && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginBottom: '16px' }}>
                          <div style={{ fontSize: '16px', fontWeight: '600', marginBottom: '8px', color: TavariStyles.colors.gray900 }}>
                            {scheduleMode === 'multiDay' ? 'Multi-day Event' : 'Individual Dates'}
                          </div>
                          <p style={{ fontSize: '14px', color: TavariStyles.colors.gray600, marginBottom: '16px' }}>
                            {scheduleMode === 'multiDay'
                              ? 'Name the season once (e.g. Summer Camp 2026). Add week 1, then change the date and add week 2, week 3… Keep going for the whole summer, set times, then Save once. Customers only see each week’s start date. Ticket inventory price is the full-week rate; shorter holiday weeks are charged proportionally (e.g. 4/5).'
                              : 'Add specific dates and time slots (e.g. one-off events). Each date can have its own times.'}
                          </p>
                          {scheduleMode === 'multiDay' && (
                            <div style={{ marginBottom: 16 }}>
                              <label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 4, color: TavariStyles.colors.gray700 }}>
                                Season / event name *
                              </label>
                              <input
                                type="text"
                                value={scheduleName}
                                onChange={(e) => setScheduleName(e.target.value)}
                                placeholder="e.g., Summer Camp 2026"
                                style={{ width: '100%', padding: '10px', border: '1px solid #e5e7eb', borderRadius: 6, fontSize: 14, boxSizing: 'border-box' }}
                              />
                              {Object.keys(individualDatesSlots).length > 0 && (
                                <div style={{ marginTop: 8, fontSize: 13, fontWeight: 600, color: TavariStyles.colors.primary }}>
                                  {splitDateKeysIntoWeekRuns(Object.keys(individualDatesSlots).sort()).length} week(s) · {Object.keys(individualDatesSlots).length} day(s) added — pick the next Monday and add another week
                                </div>
                              )}
                            </div>
                          )}
                          <div style={{ marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                            <input
                              type="date"
                              id="individual-date-picker"
                              style={{
                                padding: '10px',
                                border: '1px solid #e5e7eb',
                                borderRadius: '6px',
                                fontSize: '14px'
                              }}
                            />
                            <button
                              type="button"
                              onClick={() => {
                                const input = document.getElementById('individual-date-picker');
                                const dateStr = input?.value;
                                if (!dateStr) {
                                  toast.error('Please select a date');
                                  return;
                                }
                                if (individualDatesSlots[dateStr]) {
                                  toast('This date already has slots. Add times below or edit the date card.');
                                  return;
                                }
                                setIndividualDatesSlots(prev => ({ ...prev, [dateStr]: [] }));
                                if (input) input.value = '';
                              }}
                              style={{
                                padding: '10px 16px',
                                backgroundColor: TavariStyles.colors.primary,
                                color: 'white',
                                border: 'none',
                                borderRadius: '6px',
                                fontSize: '14px',
                                fontWeight: '600',
                                cursor: 'pointer'
                              }}
                            >
                              Add Date
                            </button>
                            {scheduleMode === 'multiDay' && (
                              <>
                                <div style={{
                                  width: '100%',
                                  padding: '12px',
                                  border: '1px solid #e5e7eb',
                                  borderRadius: 8,
                                  backgroundColor: '#f9fafb',
                                  marginBottom: 4,
                                }}
                                >
                                  <div style={{ fontSize: 13, fontWeight: 600, color: TavariStyles.colors.gray700, marginBottom: 8 }}>
                                    Days to include in this week (uncheck holidays)
                                  </div>
                                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                                    {[
                                      { dow: 1, label: 'Mon' },
                                      { dow: 2, label: 'Tue' },
                                      { dow: 3, label: 'Wed' },
                                      { dow: 4, label: 'Thu' },
                                      { dow: 5, label: 'Fri' },
                                    ].map(({ dow, label }) => (
                                      <TavariCheckbox
                                        key={dow}
                                        id={`multi-day-week-dow-${dow}`}
                                        checked={multiDayWeekDays.includes(dow)}
                                        onChange={(next) => {
                                          setMultiDayWeekDays((prev) => {
                                            if (next) {
                                              return [...new Set([...prev, dow])].sort();
                                            }
                                            const filtered = prev.filter((d) => d !== dow);
                                            return filtered.length ? filtered : prev;
                                          });
                                        }}
                                        label={label}
                                        size="md"
                                      />
                                    ))}
                                  </div>
                                  <div style={{ fontSize: 13, color: TavariStyles.colors.gray600, marginTop: 8 }}>
                                    Pick any date in the week below, then add the selected days. Or use Add Date for one-offs.
                                  </div>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => {
                                    const input = document.getElementById('individual-date-picker');
                                    const dateStr = input?.value;
                                    if (!dateStr) {
                                      toast.error('Select any date in that week first');
                                      return;
                                    }
                                    if (!multiDayWeekDays.length) {
                                      toast.error('Select at least one weekday');
                                      return;
                                    }
                                    const week = listSelectedDaysInWeekOf(dateStr, multiDayWeekDays);
                                    if (!week.length) {
                                      toast.error('No matching days in that week');
                                      return;
                                    }
                                    setIndividualDatesSlots((prev) => {
                                      const next = { ...prev };
                                      week.forEach((d) => {
                                        if (!next[d]) next[d] = [];
                                      });
                                      return next;
                                    });
                                    const labels = week.map((d) =>
                                      new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }),
                                    );
                                    toast.success(
                                      `Week added (${week.length} day(s): ${labels.join(', ')}). Change the date to the next week and click again — then Save when all weeks are listed.`,
                                    );
                                  }}
                                  style={{
                                    padding: '10px 16px',
                                    backgroundColor: 'white',
                                    color: TavariStyles.colors.primary,
                                    border: `1px solid ${TavariStyles.colors.primary}`,
                                    borderRadius: '6px',
                                    fontSize: '14px',
                                    fontWeight: '600',
                                    cursor: 'pointer'
                                  }}
                                >
                                  Add another week
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    const dates = Object.keys(individualDatesSlots).sort();
                                    if (dates.length < 2) {
                                      toast.error('Add at least two dates first');
                                      return;
                                    }
                                    const template = individualDatesSlots[dates[0]] || [];
                                    if (!template.length) {
                                      toast.error('Add time slots on the first date, then apply');
                                      return;
                                    }
                                    const cloned = JSON.parse(JSON.stringify(template));
                                    setIndividualDatesSlots((prev) => {
                                      const next = { ...prev };
                                      dates.slice(1).forEach((d) => {
                                        next[d] = JSON.parse(JSON.stringify(cloned));
                                      });
                                      return next;
                                    });
                                    toast.success('Applied first day’s times to all dates');
                                  }}
                                  style={{
                                    padding: '10px 16px',
                                    backgroundColor: '#f3f4f6',
                                    border: '1px solid #e5e7eb',
                                    borderRadius: '6px',
                                    fontSize: '14px',
                                    fontWeight: '600',
                                    cursor: 'pointer'
                                  }}
                                >
                                  Repeat times on all days
                                </button>
                              </>
                            )}
                          </div>
                          {Object.entries(individualDatesSlots).sort(([a], [b]) => a.localeCompare(b)).map(([dateStr, slots]) => (
                            <div
                              key={dateStr}
                              style={{
                                border: '1px solid #e5e7eb',
                                borderRadius: '8px',
                                padding: '16px',
                                backgroundColor: 'white',
                                marginBottom: '12px'
                              }}
                            >
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap', gap: '8px' }}>
                                <span style={{ fontWeight: '600', fontSize: '14px', color: TavariStyles.colors.gray900 }}>
                                  {new Date(dateStr + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' })}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => setIndividualDatesSlots(prev => {
                                    const next = { ...prev };
                                    delete next[dateStr];
                                    return next;
                                  })}
                                  style={{
                                    padding: '6px 12px',
                                    backgroundColor: '#fee2e2',
                                    color: '#b91c1c',
                                    border: 'none',
                                    borderRadius: '6px',
                                    fontSize: '13px',
                                    cursor: 'pointer'
                                  }}
                                >
                                  Remove date
                                </button>
                              </div>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                {slots.length === 0 ? (
                                  <div style={{ fontSize: '13px', color: TavariStyles.colors.gray500 }}>No time slots. Add one below.</div>
                                ) : (
                                  slots.map((slot, idx) => (
                                    <div
                                      key={idx}
                                      role="button"
                                      tabIndex={0}
                                      onClick={() => handleOpenIndividualScheduleModal(dateStr, idx)}
                                      onKeyDown={(e) => {
                                        if (e.key === 'Enter' || e.key === ' ') {
                                          e.preventDefault();
                                          handleOpenIndividualScheduleModal(dateStr, idx);
                                        }
                                      }}
                                      style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '8px',
                                        padding: '8px',
                                        backgroundColor: '#f9fafb',
                                        borderRadius: '6px',
                                        cursor: 'pointer'
                                      }}
                                    >
                                      <span style={{ fontWeight: '500' }}>{slot.startTime}</span>
                                      <span style={{ fontSize: '13px', color: TavariStyles.colors.gray600 }}>{slot.spaces || 1} spaces</span>
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setIndividualDatesSlots((prev) => ({
                                            ...prev,
                                            [dateStr]: (prev[dateStr] || []).filter((_, i) => i !== idx)
                                          }));
                                        }}
                                        style={{ marginLeft: 'auto', padding: '4px 8px', fontSize: '13px', color: '#b91c1c', background: 'transparent', border: 'none', cursor: 'pointer' }}
                                      >
                                        Remove
                                      </button>
                                    </div>
                                  ))
                                )}
                                <button
                                  type="button"
                                  onClick={() => handleOpenIndividualScheduleModal(dateStr, null)}
                                  style={{
                                    padding: '8px 12px',
                                    border: '1px dashed #d1d5db',
                                    borderRadius: '6px',
                                    backgroundColor: 'transparent',
                                    fontSize: '13px',
                                    color: TavariStyles.colors.gray600,
                                    cursor: 'pointer',
                                    alignSelf: 'flex-start'
                                  }}
                                >
                                  + Add time slot
                                </button>
                              </div>
                            </div>
                          ))}
                          {Object.keys(individualDatesSlots).length === 0 && (
                            <div style={{ fontSize: '13px', color: TavariStyles.colors.gray500, fontStyle: 'italic' }}>
                              Select a date above and click &quot;Add Date&quot; to add dates, then add time slots per date.
                            </div>
                          )}
                        </div>
                        )}

                        {/* Duration Configuration */}
                        <div style={{
                          marginTop: '24px',
                          padding: '20px',
                          border: '1px solid #e5e7eb',
                          borderRadius: '12px',
                          backgroundColor: 'white'
                        }}>
                          <label style={{ 
                            display: 'block', 
                            marginBottom: '16px', 
                            fontWeight: '600', 
                            fontSize: '16px', 
                            color: TavariStyles.colors.gray900 
                          }}>
                            Default Duration
                          </label>
                          <div style={{ 
                            display: 'flex', 
                            gap: '16px', 
                            alignItems: 'flex-end' 
                          }}>
                            {/* Days */}
                            <div style={{ flex: 1 }}>
                              <label style={{ 
                                display: 'block', 
                                marginBottom: '8px', 
                                fontWeight: '500', 
                                fontSize: '14px', 
                                color: TavariStyles.colors.gray700 
                              }}>
                                Days
                              </label>
                              <select
                                value={activityDuration.days}
                                onChange={(e) => setActivityDuration(prev => ({ ...prev, days: parseInt(e.target.value) || 0 }))}
                                style={{
                                  width: '100%',
                                  padding: '10px',
                                  border: '1px solid #e5e7eb',
                                  borderRadius: '8px',
                                  fontSize: '14px',
                                  backgroundColor: 'white',
                                  boxSizing: 'border-box',
                                  cursor: 'pointer'
                                }}
                              >
                                {Array.from({ length: 8 }, (_, i) => i).map(num => (
                                  <option key={num} value={num}>{num}</option>
                                ))}
                              </select>
                            </div>
                            
                            {/* Hours */}
                            <div style={{ flex: 1 }}>
                              <label style={{ 
                                display: 'block', 
                                marginBottom: '8px', 
                                fontWeight: '500', 
                                fontSize: '14px', 
                                color: TavariStyles.colors.gray700 
                              }}>
                                Hours
                              </label>
                              <select
                                value={activityDuration.hours}
                                onChange={(e) => setActivityDuration(prev => ({ ...prev, hours: parseInt(e.target.value) || 0 }))}
                                style={{
                                  width: '100%',
                                  padding: '10px',
                                  border: '1px solid #e5e7eb',
                                  borderRadius: '8px',
                                  fontSize: '14px',
                                  backgroundColor: 'white',
                                  boxSizing: 'border-box',
                                  cursor: 'pointer'
                                }}
                              >
                                {Array.from({ length: 24 }, (_, i) => i).map(num => (
                                  <option key={num} value={num}>{num}</option>
                                ))}
                              </select>
                            </div>
                            
                            {/* Minutes */}
                            <div style={{ flex: 1 }}>
                              <label style={{ 
                                display: 'block', 
                                marginBottom: '8px', 
                                fontWeight: '500', 
                                fontSize: '14px', 
                                color: TavariStyles.colors.gray700 
                              }}>
                                Minutes
                              </label>
                              <select
                                value={activityDuration.minutes}
                                onChange={(e) => setActivityDuration(prev => ({ ...prev, minutes: parseInt(e.target.value) || 0 }))}
                                style={{
                                  width: '100%',
                                  padding: '10px',
                                  border: '1px solid #e5e7eb',
                                  borderRadius: '8px',
                                  fontSize: '14px',
                                  backgroundColor: 'white',
                                  boxSizing: 'border-box',
                                  cursor: 'pointer'
                                }}
                              >
                                {Array.from({ length: 60 }, (_, i) => i).map(num => (
                                  <option key={num} value={num}>{num}</option>
                                ))}
                              </select>
                            </div>
                          </div>
                          <div style={{ 
                            fontSize: '13px', 
                            color: TavariStyles.colors.gray500, 
                            marginTop: '8px' 
                          }}>
                            Total duration: {activityDuration.days > 0 ? `${activityDuration.days} day${activityDuration.days !== 1 ? 's' : ''}, ` : ''}{activityDuration.hours > 0 ? `${activityDuration.hours} hour${activityDuration.hours !== 1 ? 's' : ''}, ` : ''}{activityDuration.minutes} minute{activityDuration.minutes !== 1 ? 's' : ''} ({(activityDuration.days * 24 * 60) + (activityDuration.hours * 60) + activityDuration.minutes} minutes total)
                          </div>
                        </div>

                        {/* Advanced Booking */}
                        <div style={{
                          marginTop: '24px',
                          padding: '20px',
                          border: '1px solid #e5e7eb',
                          borderRadius: '12px',
                          backgroundColor: 'white'
                        }}>
                          <label style={{
                            display: 'block',
                            marginBottom: '16px',
                            fontWeight: '600',
                            fontSize: '16px',
                            color: TavariStyles.colors.gray900
                          }}>
                            Advanced Booking
                          </label>

                          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                            {/* Min notice */}
                            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: '12px' }}>
                              <span style={{ flex: '1 1 100%', fontSize: '14px', color: TavariStyles.colors.gray700, marginBottom: '4px' }}>
                                Customers must book at least
                              </span>
                              <select
                                value={advancedBookingMinNotice.value}
                                onChange={(e) => setAdvancedBookingMinNotice(prev => ({ ...prev, value: parseInt(e.target.value) || 0 }))}
                                style={{
                                  width: '80px',
                                  padding: '10px',
                                  border: '1px solid #e5e7eb',
                                  borderRadius: '8px',
                                  fontSize: '14px',
                                  backgroundColor: 'white',
                                  boxSizing: 'border-box',
                                  cursor: 'pointer'
                                }}
                              >
                                {Array.from({ length: 61 }, (_, i) => i).map(n => (
                                  <option key={n} value={n}>{n === 0 ? 'Off' : n}</option>
                                ))}
                              </select>
                              <select
                                value={advancedBookingMinNotice.unit}
                                onChange={(e) => setAdvancedBookingMinNotice(prev => ({ ...prev, unit: e.target.value }))}
                                disabled={advancedBookingMinNotice.value === 0}
                                style={{
                                  width: '120px',
                                  padding: '10px',
                                  border: '1px solid #e5e7eb',
                                  borderRadius: '8px',
                                  fontSize: '14px',
                                  backgroundColor: advancedBookingMinNotice.value === 0 ? '#f3f4f6' : 'white',
                                  boxSizing: 'border-box',
                                  cursor: advancedBookingMinNotice.value === 0 ? 'not-allowed' : 'pointer'
                                }}
                              >
                                <option value="minutes">minutes</option>
                                <option value="hours">hours</option>
                                <option value="days">days</option>
                                <option value="months">months</option>
                              </select>
                              <span style={{ fontSize: '14px', color: TavariStyles.colors.gray600 }}>in advance</span>
                            </div>

                            {/* Max advance */}
                            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: '12px' }}>
                              <span style={{ flex: '1 1 100%', fontSize: '14px', color: TavariStyles.colors.gray700, marginBottom: '4px' }}>
                                Customers cannot book more than
                              </span>
                              <select
                                value={advancedBookingMaxAdvance.value}
                                onChange={(e) => setAdvancedBookingMaxAdvance(prev => ({ ...prev, value: parseInt(e.target.value) || 0 }))}
                                style={{
                                  width: '80px',
                                  padding: '10px',
                                  border: '1px solid #e5e7eb',
                                  borderRadius: '8px',
                                  fontSize: '14px',
                                  backgroundColor: 'white',
                                  boxSizing: 'border-box',
                                  cursor: 'pointer'
                                }}
                              >
                                {Array.from({ length: 61 }, (_, i) => i).map(n => (
                                  <option key={n} value={n}>{n === 0 ? 'Off' : n}</option>
                                ))}
                              </select>
                              <select
                                value={advancedBookingMaxAdvance.unit}
                                onChange={(e) => setAdvancedBookingMaxAdvance(prev => ({ ...prev, unit: e.target.value }))}
                                disabled={advancedBookingMaxAdvance.value === 0}
                                style={{
                                  width: '120px',
                                  padding: '10px',
                                  border: '1px solid #e5e7eb',
                                  borderRadius: '8px',
                                  fontSize: '14px',
                                  backgroundColor: advancedBookingMaxAdvance.value === 0 ? '#f3f4f6' : 'white',
                                  boxSizing: 'border-box',
                                  cursor: advancedBookingMaxAdvance.value === 0 ? 'not-allowed' : 'pointer'
                                }}
                              >
                                <option value="minutes">minutes</option>
                                <option value="hours">hours</option>
                                <option value="days">days</option>
                                <option value="months">months</option>
                              </select>
                              <span style={{ fontSize: '14px', color: TavariStyles.colors.gray600 }}>in advance</span>
                            </div>
                          </div>
                        </div>

                        {/* Saved Schedules List */}
                        {savedSchedules.length > 0 && (
                          <div style={{
                            marginTop: '24px',
                            padding: '20px',
                            border: '1px solid #e5e7eb',
                            borderRadius: '12px',
                            backgroundColor: 'white'
                          }}>
                            <label style={{ 
                              display: 'block', 
                              marginBottom: '16px', 
                              fontWeight: '600', 
                              fontSize: '16px', 
                              color: TavariStyles.colors.gray900 
                            }}>
                              Saved Schedules
                            </label>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                              {savedSchedules.map((schedule) => (
                                <div
                                  key={schedule.scheduleName}
                                  style={{
                                    border: '1px solid #e5e7eb',
                                    borderRadius: '8px',
                                    backgroundColor: '#f9fafb',
                                    overflow: 'hidden',
                                    transition: 'all 0.2s'
                                  }}
                                >
                                  {/* Schedule Header (Always Visible) */}
                                  <div
                                    onClick={() => {
                                      setExpandedScheduleId(expandedScheduleId === schedule.scheduleName ? null : schedule.scheduleName);
                                    }}
                                    style={{
                                      padding: '16px',
                                      display: 'flex',
                                      justifyContent: 'space-between',
                                      alignItems: 'center',
                                      cursor: 'pointer',
                                      backgroundColor: expandedScheduleId === schedule.scheduleName ? '#f0f9ff' : '#f9fafb',
                                      borderBottom: expandedScheduleId === schedule.scheduleName ? '1px solid #e5e7eb' : 'none'
                                    }}
                                    onMouseEnter={(e) => {
                                      if (expandedScheduleId !== schedule.scheduleName) {
                                        e.currentTarget.style.backgroundColor = '#f3f4f6';
                                      }
                                    }}
                                    onMouseLeave={(e) => {
                                      if (expandedScheduleId !== schedule.scheduleName) {
                                        e.currentTarget.style.backgroundColor = '#f9fafb';
                                      }
                                    }}
                                  >
                                    <div style={{ flex: 1 }}>
                                      <div style={{ 
                                        fontSize: '15px', 
                                        fontWeight: '600', 
                                        color: TavariStyles.colors.gray900,
                                        marginBottom: '4px'
                                      }}>
                                        {schedule.scheduleType === 'multiDay'
                                          ? (schedule.seasonLabel || stripMultiDaySchedulePrefix(schedule.scheduleName))
                                          : (schedule.scheduleName || 'Unnamed Schedule')}
                                      </div>
                                      <div style={{ 
                                        fontSize: '13px', 
                                        color: TavariStyles.colors.gray600,
                                        display: 'flex',
                                        gap: '16px'
                                      }}>
                                        {schedule.scheduleType === 'multiDay' ? (
                                          <span>📅 Multi-day · {schedule.weekCount || splitDateKeysIntoWeekRuns(Object.keys(schedule.individualDatesSlots || {})).length} week(s) · {Object.keys(schedule.individualDatesSlots || {}).length} day(s)</span>
                                        ) : schedule.scheduleType === 'individual' ? (
                                          <span>📅 Individual dates ({Object.keys(schedule.individualDatesSlots || {}).length} date(s))</span>
                                        ) : schedule.startDate && schedule.endDate ? (
                                          <>
                                            <span>📅 {formatDateForBusiness(schedule.startDate, businessTimezone)} - {formatDateForBusiness(schedule.endDate, businessTimezone)}</span>
                                          </>
                                        ) : schedule.startDate ? (
                                          <span>📅 From {formatDateForBusiness(schedule.startDate, businessTimezone)}</span>
                                        ) : schedule.endDate ? (
                                          <span>📅 Until {formatDateForBusiness(schedule.endDate, businessTimezone)}</span>
                                        ) : schedule.isActiveIndefiniteSchedule === false ? (
                                          <span>📅 Archived (was indefinite)</span>
                                        ) : (
                                          <span>📅 Indefinite (Default Schedule)</span>
                                        )}
                                      </div>
                                    </div>
                                    <div style={{ 
                                      display: 'flex', 
                                      alignItems: 'center', 
                                      gap: '12px'
                                    }}>
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleEditSchedule(schedule);
                                        }}
                                        style={{
                                          padding: '6px',
                                          border: 'none',
                                          background: 'transparent',
                                          cursor: 'pointer',
                                          color: TavariStyles.colors.primary,
                                          borderRadius: '4px',
                                          display: 'flex',
                                          alignItems: 'center',
                                          justifyContent: 'center'
                                        }}
                                        onMouseEnter={(e) => {
                                          e.currentTarget.style.backgroundColor = '#e0f2fe';
                                        }}
                                        onMouseLeave={(e) => {
                                          e.currentTarget.style.backgroundColor = 'transparent';
                                        }}
                                        title="Edit schedule"
                                      >
                                        <FiEdit size={16} />
                                      </button>
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleDeleteSchedule(schedule.scheduleName, schedule);
                                        }}
                                        style={{
                                          padding: '6px',
                                          border: 'none',
                                          background: 'transparent',
                                          cursor: 'pointer',
                                          color: '#ef4444',
                                          borderRadius: '4px',
                                          display: 'flex',
                                          alignItems: 'center',
                                          justifyContent: 'center'
                                        }}
                                        onMouseEnter={(e) => {
                                          e.currentTarget.style.backgroundColor = '#fee2e2';
                                        }}
                                        onMouseLeave={(e) => {
                                          e.currentTarget.style.backgroundColor = 'transparent';
                                        }}
                                        title="Delete schedule"
                                      >
                                        <FiTrash2 size={16} />
                                      </button>
                                      <div style={{ 
                                        color: TavariStyles.colors.gray400,
                                        transition: 'transform 0.2s',
                                        transform: expandedScheduleId === schedule.scheduleName ? 'rotate(180deg)' : 'rotate(0deg)'
                                      }}>
                                        <FiChevronDown size={20} />
                                      </div>
                                    </div>
                                  </div>

                                  {/* Expanded Schedule Details */}
                                  {expandedScheduleId === schedule.scheduleName && (
                                    <div style={{
                                      padding: '16px',
                                      backgroundColor: 'white',
                                      borderTop: '1px solid #e5e7eb'
                                    }}>
                                      <div style={{
                                        display: 'grid',
                                        gridTemplateColumns: 'repeat(7, 1fr)',
                                        gap: '12px',
                                        marginTop: '12px'
                                      }}>
                                        {['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map((day) => {
                                          const daySlots = schedule.timeSlots[day] || [];
                                          return (
                                            <div
                                              key={day}
                                              style={{
                                                border: '1px solid #e5e7eb',
                                                borderRadius: '6px',
                                                padding: '8px',
                                                backgroundColor: '#f9fafb',
                                                minHeight: '120px'
                                              }}
                                            >
                                              <div style={{
                                                fontSize: '11px',
                                                fontWeight: '600',
                                                marginBottom: '8px',
                                                color: TavariStyles.colors.gray700,
                                                textAlign: 'center',
                                                paddingBottom: '4px',
                                                borderBottom: '1px solid #e5e7eb'
                                              }}>
                                                {day.substring(0, 3)}
                                              </div>
                                              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                                {daySlots.length === 0 ? (
                                                  <div style={{
                                                    fontSize: '10px',
                                                    color: TavariStyles.colors.gray400,
                                                    textAlign: 'center',
                                                    padding: '8px 0'
                                                  }}>
                                                    No slots
                                                  </div>
                                                ) : (
                                                  daySlots.map((slot, index) => (
                                                    <div
                                                      key={index}
                                                      style={{
                                                        fontSize: '10px',
                                                        padding: '4px',
                                                        backgroundColor: 'white',
                                                        border: '1px solid #e5e7eb',
                                                        borderRadius: '4px',
                                                        textAlign: 'center'
                                                      }}
                                                    >
                                                      {slot.startTime}
                                                    </div>
                                                  ))
                                                )}
                                              </div>
                                            </div>
                                          );
                                        })}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        
                        {/* Save Schedule Button (only on Schedule tab) */}
                        {(Object.keys(scheduleTimeSlots).length > 0 || Object.keys(individualDatesSlots).some(d => (individualDatesSlots[d] || []).length > 0)) && (
                          <div style={{ marginTop: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                            {!editingActivityId && (
                              <div style={{
                                padding: '12px 16px',
                                backgroundColor: '#fee2e2',
                                border: '1px solid #ef4444',
                                borderRadius: '8px',
                                color: '#991b1b',
                                fontSize: '14px'
                              }}>
                                ⚠️ Please save the activity first using the "Save" button in the footer before saving schedules.
                              </div>
                            )}
                            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                              <button
                              onClick={async () => {
                                if (!editingActivityId) {
                                  toast.error('Please save the activity first using the "Save" button in the footer before saving schedules.');
                                  setRegularModalActiveTab('name');
                                  return;
                                }
                                try {
                                  await saveCurrentSchedules(editingActivityId);
                                  await loadActivitySchedules(editingActivityId);
                                } catch (err) {
                                  console.error('Error saving schedule:', err);
                                }
                              }}
                              disabled={!editingActivityId}
                              style={{
                                padding: '10px 20px',
                                backgroundColor: !editingActivityId ? '#ccc' : TavariStyles.colors.primary,
                                color: 'white',
                                border: 'none',
                                borderRadius: '8px',
                                fontSize: '14px',
                                fontWeight: '600',
                                cursor: !editingActivityId ? 'not-allowed' : 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '8px',
                                opacity: !editingActivityId ? 0.6 : 1
                              }}
                              onMouseEnter={(e) => {
                                if (editingActivityId) {
                                  e.currentTarget.style.opacity = '0.9';
                                }
                              }}
                              onMouseLeave={(e) => {
                                if (editingActivityId) {
                                  e.currentTarget.style.opacity = '1';
                                }
                              }}
                            >
                              <FiSave size={16} />
                              {editingScheduleName ? 'Update Schedule' : 'Save Schedule'}
                            </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                    {regularModalActiveTab === 'pricing' && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                        {editingActivityId && (!ticketSettingsLoaded || hydratingTicketSettings) ? (
                          <div style={{
                            padding: '24px',
                            borderRadius: '10px',
                            backgroundColor: TavariStyles.colors.gray50,
                            border: `1px solid ${TavariStyles.colors.gray200}`,
                            color: TavariStyles.colors.gray700,
                            fontSize: '14px'
                          }}>
                            Loading saved pricing configuration...
                          </div>
                        ) : (
                          <>
                        <div>
                          <label style={{ display: 'block', marginBottom: '8px', fontWeight: '600', fontSize: '14px', color: TavariStyles.colors.gray900 }}>
                            Available Tickets (Inventory Items)
                          </label>
                          <p style={{ fontSize: '14px', color: TavariStyles.colors.gray600, marginBottom: '16px' }}>
                            Select inventory items that will be available as tickets for this activity. Customers will be able to purchase these items when booking.
                            Amounts shown below use each item&apos;s current POS inventory price (refreshed when you open this tab).
                          </p>
                          
                          <button
                            type="button"
                            onClick={async () => {
                              console.log('[BookingSettings] Opening inventory search modal');
                              setInventoryPickerMode('tickets');
                              setOptionInventoryPickerGroupIndex(null);
                              setOptionInventoryPickerSelection([]);
                              setShowInventorySearchModal(true);
                              // Reset filters
                              setInventorySearchTerm('');
                              setSelectedInventoryCategory('');
                              // Load will be triggered by useEffect, but also call directly to ensure it happens
                              if (auth.selectedBusinessId) {
                                await loadInventoryCategories();
                                await loadInventoryItems();
                              }
                            }}
                            style={{
                              padding: '10px 20px',
                              backgroundColor: TavariStyles.colors.primary,
                              color: 'white',
                              border: 'none',
                              borderRadius: '8px',
                              fontSize: '14px',
                              fontWeight: '600',
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '8px'
                            }}
                          >
                            <FiPlus size={18} />
                            Search Inventory
                          </button>
                        </div>

                        {/* Selected Inventory Items */}
                        {selectedInventoryItems.length > 0 && inventoryItems.length > 0 && (
                          <div>
                            <label style={{ display: 'block', marginBottom: '12px', fontWeight: '600', fontSize: '14px', color: TavariStyles.colors.gray900 }}>
                              Selected Items ({selectedInventoryItems.length})
                            </label>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                              {inventoryItems
                                .filter(item => selectedInventoryItems.includes(item.id))
                                .map(item => (
                                  <div
                                    key={item.id}
                                    style={{
                                      padding: '12px 16px',
                                      border: `1px solid ${TavariStyles.colors.gray200}`,
                                      borderRadius: '8px',
                                      backgroundColor: 'white',
                                      display: 'flex',
                                      justifyContent: 'space-between',
                                      alignItems: 'center'
                                    }}
                                  >
                                    <div>
                                      <div style={{ fontWeight: '600', fontSize: '14px', color: TavariStyles.colors.gray900 }}>
                                        {item.name}
                                      </div>
                                      <div style={{ fontSize: '13px', color: TavariStyles.colors.gray600, marginTop: '4px' }}>
                                        ${parseFloat(item.price || 0).toFixed(2)}
                                        {item.sku && ` • SKU: ${item.sku}`}
                                      </div>
                                    </div>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setSelectedInventoryItems(prev => prev.filter(id => id !== item.id));
                                        // Also remove from inventoryItems display
                                        setInventoryItems(prev => prev.filter(i => i.id !== item.id));
                                      }}
                                      style={{
                                        padding: '6px',
                                        border: 'none',
                                        background: 'transparent',
                                        cursor: 'pointer',
                                        color: '#ef4444',
                                        borderRadius: '4px',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center'
                                      }}
                                      onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#fee2e2'; }}
                                      onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                                      title="Remove item"
                                    >
                                      <FiX size={18} />
                                    </button>
                                  </div>
                                ))}
                            </div>
                          </div>
                        )}

                        {selectedInventoryItems.length === 0 && (
                          <div style={{ 
                            padding: '24px', 
                            textAlign: 'center', 
                            color: TavariStyles.colors.gray500,
                            border: `1px dashed ${TavariStyles.colors.gray300}`,
                            borderRadius: '8px',
                            backgroundColor: TavariStyles.colors.gray50
                          }}>
                            No inventory items selected. Click "Search Inventory" to add items.
                          </div>
                        )}

                        {selectedTicketItems.length > 0 && (
                          <div style={{ marginTop: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                            <div>
                              <label style={{ display: 'block', marginBottom: '8px', fontWeight: '600', fontSize: '14px', color: TavariStyles.colors.gray900 }}>
                                Auto-assignment rules
                              </label>
                              <p style={{ fontSize: '14px', color: TavariStyles.colors.gray600, margin: 0 }}>
                                Use this section to decide which ticket should be auto-selected for each age group in the customer booking flow. Free or paired pricing is handled by Promotions, not by the priority number here.
                              </p>
                            </div>

                            <div style={{
                              padding: '14px 16px',
                              borderRadius: '10px',
                              backgroundColor: TavariStyles.colors.gray50,
                              border: `1px solid ${TavariStyles.colors.gray200}`,
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              gap: '16px',
                              flexWrap: 'wrap'
                            }}>
                              <div style={{ fontSize: '13px', color: TavariStyles.colors.gray700 }}>
                                Configure free, paired, or ratio pricing in <strong>Promotions</strong>. These auto-assignment rules only decide which ticket gets picked before pricing rules are applied.
                              </div>
                              <button
                                type="button"
                                onClick={() => {
                                  setShowPromotionsModal(true);
                                  setShowFreeWithPurchaseView(true);
                                }}
                                style={{
                                  padding: '10px 14px',
                                  borderRadius: '8px',
                                  border: `1px solid ${TavariStyles.colors.primary}`,
                                  backgroundColor: 'white',
                                  color: TavariStyles.colors.primary,
                                  fontSize: '13px',
                                  fontWeight: '600',
                                  cursor: 'pointer',
                                  whiteSpace: 'nowrap'
                                }}
                              >
                                Open Promotions
                              </button>
                            </div>

                            {[...selectedTicketItems]
                              .sort((a, b) => {
                                const ruleA = mergedEffectiveTicketAssignmentRules.find((rule) => rule.inventory_item_id === a.id);
                                const ruleB = mergedEffectiveTicketAssignmentRules.find((rule) => rule.inventory_item_id === b.id);
                                return (Number(ruleA?.priority) || 9999) - (Number(ruleB?.priority) || 9999);
                              })
                              .map((item) => {
                                const rule = mergedEffectiveTicketAssignmentRules.find((entry) => entry.inventory_item_id === item.id) || {
                                  inventory_item_id: item.id,
                                  enabled: true,
                                  priority: 9999,
                                  use_inventory_age_restriction: true,
                                  min_value: null,
                                  min_unit: 'years',
                                  max_value: null,
                                  max_unit: 'years'
                                };
                                const pricingRule = mergedEffectiveTicketPricingRules.find((entry) => entry.inventory_item_id === item.id) || {
                                  inventory_item_id: item.id,
                                  enabled: false,
                                  trigger_item_ids: [],
                                  trigger_quantity: 1,
                                  discounted_quantity: 1,
                                  max_discounted_quantity: null,
                                  count_paid_triggers_only: true,
                                  allow_additional_paid_tickets: true,
                                };
                                const pricingRuleHasSelfTrigger = (pricingRule.trigger_item_ids || []).includes(item.id);
                                return (
                                  <div
                                    key={`ticket-rule-${item.id}`}
                                    style={{
                                      padding: '16px',
                                      border: `1px solid ${TavariStyles.colors.gray200}`,
                                      borderRadius: '10px',
                                      backgroundColor: 'white',
                                      display: 'flex',
                                      flexDirection: 'column',
                                      gap: '12px'
                                    }}
                                  >
                                    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 96px', alignItems: 'start', gap: '12px' }}>
                                      <div style={{ minWidth: 0 }}>
                                        <div style={{ fontWeight: '600', fontSize: '14px', color: TavariStyles.colors.gray900 }}>
                                          {item.name}
                                        </div>
                                        <div style={{ fontSize: '13px', color: TavariStyles.colors.gray600, marginTop: '2px' }}>
                                          Inventory age rule: {formatAgeRestrictionSummary(item.age_restriction)}
                                        </div>
                                      </div>
                                      <div style={{ justifySelf: 'end', width: '96px' }}>
                                        <div style={{ fontSize: '14px', fontWeight: '600', color: TavariStyles.colors.primary, textAlign: 'right', marginBottom: '6px' }}>
                                          ${parseFloat(item.price || 0).toFixed(2)}
                                        </div>
                                        <label style={{ display: 'block', marginBottom: '6px', fontWeight: '600', fontSize: '13px', color: TavariStyles.colors.gray800, textAlign: 'right' }}>
                                          Priority
                                        </label>
                                        <input
                                          type="number"
                                          min="1"
                                          value={rule.priority ?? ''}
                                          onChange={(e) => updateTicketAssignmentRule(item.id, { priority: e.target.value === '' ? '' : (parseInt(e.target.value, 10) || 1) })}
                                          style={{ width: '100%', padding: '8px 10px', border: `1px solid ${TavariStyles.colors.gray300}`, borderRadius: '8px', fontSize: '14px', boxSizing: 'border-box' }}
                                        />
                                      </div>
                                    </div>

                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                      <TavariCheckbox
                                        checked={rule.enabled !== false}
                                        onChange={(checked) => updateTicketAssignmentRule(item.id, { enabled: !!checked })}
                                        label="Use this ticket for auto-assignment"
                                        id={`ticket-rule-enabled-${item.id}`}
                                      />
                                    </div>

                                    <TavariCheckbox
                                      checked={rule.use_inventory_age_restriction !== false}
                                      onChange={(checked) => updateTicketAssignmentRule(item.id, { use_inventory_age_restriction: !!checked })}
                                      label="Use the inventory item age rule"
                                      id={`ticket-rule-age-source-${item.id}`}
                                    />

                                    {rule.use_inventory_age_restriction === false && (
                                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                                        <div>
                                          <label style={{ display: 'block', marginBottom: '6px', fontWeight: '600', fontSize: '13px', color: TavariStyles.colors.gray800 }}>
                                            Starting age
                                          </label>
                                          <div style={{ display: 'flex', gap: '8px' }}>
                                            <input
                                              type="number"
                                              min="0"
                                              value={rule.min_value ?? ''}
                                              onChange={(e) => updateTicketAssignmentRule(item.id, { min_value: e.target.value === '' ? null : (parseInt(e.target.value, 10) || 0) })}
                                              style={{ width: '100%', padding: '10px 12px', border: `1px solid ${TavariStyles.colors.gray300}`, borderRadius: '8px', fontSize: '14px' }}
                                              placeholder="0"
                                            />
                                            <select
                                              value={rule.min_unit || 'years'}
                                              onChange={(e) => updateTicketAssignmentRule(item.id, { min_unit: e.target.value })}
                                              style={{ padding: '10px 12px', border: `1px solid ${TavariStyles.colors.gray300}`, borderRadius: '8px', fontSize: '14px' }}
                                            >
                                              <option value="months">Months</option>
                                              <option value="years">Years</option>
                                            </select>
                                          </div>
                                        </div>
                                        <div>
                                          <label style={{ display: 'block', marginBottom: '6px', fontWeight: '600', fontSize: '13px', color: TavariStyles.colors.gray800 }}>
                                            Ending age
                                          </label>
                                          <div style={{ display: 'flex', gap: '8px' }}>
                                            <input
                                              type="number"
                                              min="0"
                                              value={rule.max_value ?? ''}
                                              onChange={(e) => updateTicketAssignmentRule(item.id, { max_value: e.target.value === '' ? null : (parseInt(e.target.value, 10) || 0) })}
                                              style={{ width: '100%', padding: '10px 12px', border: `1px solid ${TavariStyles.colors.gray300}`, borderRadius: '8px', fontSize: '14px' }}
                                              placeholder="17"
                                            />
                                            <select
                                              value={rule.max_unit || 'years'}
                                              onChange={(e) => updateTicketAssignmentRule(item.id, { max_unit: e.target.value })}
                                              style={{ padding: '10px 12px', border: `1px solid ${TavariStyles.colors.gray300}`, borderRadius: '8px', fontSize: '14px' }}
                                            >
                                              <option value="months">Months</option>
                                              <option value="years">Years</option>
                                            </select>
                                          </div>
                                        </div>
                                      </div>
                                    )}

                                    <div style={{
                                      padding: '14px',
                                      borderRadius: '10px',
                                      border: `1px solid ${TavariStyles.colors.gray200}`,
                                      backgroundColor: TavariStyles.colors.gray50,
                                      display: 'flex',
                                      flexDirection: 'column',
                                      gap: '12px',
                                    }}>
                                      <div>
                                        <div style={{ fontSize: '14px', fontWeight: '600', color: TavariStyles.colors.gray900 }}>
                                          Conditional pricing rule
                                        </div>
                                        <div style={{ fontSize: '13px', color: TavariStyles.colors.gray600, marginTop: '4px' }}>
                                          Example: make this adult ticket free when one or more child tickets are selected.
                                        </div>
                                      </div>

                                      <TavariCheckbox
                                        checked={pricingRule.enabled === true}
                                        onChange={(checked) => updateTicketPricingRule(item.id, { enabled: !!checked })}
                                        label="This ticket can become free based on other tickets"
                                        id={`ticket-pricing-enabled-${item.id}`}
                                      />

                                      {pricingRule.enabled === true && (
                                        <>
                                          <div>
                                            <label style={{ display: 'block', marginBottom: '8px', fontWeight: '600', fontSize: '13px', color: TavariStyles.colors.gray800 }}>
                                              Make this ticket free when these tickets are selected
                                            </label>
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                              {selectedTicketItems
                                                .map((candidate) => (
                                                  <TavariCheckbox
                                                    key={`ticket-trigger-${item.id}-${candidate.id}`}
                                                    checked={(pricingRule.trigger_item_ids || []).includes(candidate.id)}
                                                    onChange={(checked) => toggleTicketPricingTrigger(item.id, candidate.id, checked)}
                                                    label={`${candidate.name}${candidate.id === item.id ? ' (same ticket)' : ''} (${formatAgeRestrictionSummary(candidate.age_restriction)})`}
                                                    id={`ticket-trigger-${item.id}-${candidate.id}`}
                                                  />
                                                ))}
                                            </div>
                                            {pricingRuleHasSelfTrigger && (
                                              <div style={{ fontSize: '13px', color: TavariStyles.colors.gray600, marginTop: '8px' }}>
                                                Same-ticket rule active. Example: if this is set to 1 required and 1 free, then every 2 selected tickets makes 1 of this same ticket free.
                                              </div>
                                            )}
                                          </div>

                                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '12px' }}>
                                            <div>
                                              <label style={{ display: 'block', marginBottom: '6px', fontWeight: '600', fontSize: '13px', color: TavariStyles.colors.gray800 }}>
                                                Required trigger tickets
                                              </label>
                                              <input
                                                type="number"
                                                min="1"
                                                value={pricingRule.trigger_quantity ?? 1}
                                                onChange={(e) => updateTicketPricingRule(item.id, { trigger_quantity: e.target.value === '' ? 1 : (parseInt(e.target.value, 10) || 1) })}
                                                style={{ width: '100%', padding: '10px 12px', border: `1px solid ${TavariStyles.colors.gray300}`, borderRadius: '8px', fontSize: '14px' }}
                                              />
                                            </div>
                                            <div>
                                              <label style={{ display: 'block', marginBottom: '6px', fontWeight: '600', fontSize: '13px', color: TavariStyles.colors.gray800 }}>
                                                Free tickets granted
                                              </label>
                                              <input
                                                type="number"
                                                min="1"
                                                value={pricingRule.discounted_quantity ?? 1}
                                                onChange={(e) => updateTicketPricingRule(item.id, { discounted_quantity: e.target.value === '' ? 1 : (parseInt(e.target.value, 10) || 1) })}
                                                style={{ width: '100%', padding: '10px 12px', border: `1px solid ${TavariStyles.colors.gray300}`, borderRadius: '8px', fontSize: '14px' }}
                                              />
                                            </div>
                                            <div>
                                              <label style={{ display: 'block', marginBottom: '6px', fontWeight: '600', fontSize: '13px', color: TavariStyles.colors.gray800 }}>
                                                Max free tickets
                                              </label>
                                              <input
                                                type="number"
                                                min="1"
                                                value={pricingRule.max_discounted_quantity ?? ''}
                                                onChange={(e) => updateTicketPricingRule(item.id, { max_discounted_quantity: e.target.value === '' ? null : (parseInt(e.target.value, 10) || 1) })}
                                                placeholder="No cap"
                                                style={{ width: '100%', padding: '10px 12px', border: `1px solid ${TavariStyles.colors.gray300}`, borderRadius: '8px', fontSize: '14px' }}
                                              />
                                            </div>
                                          </div>

                                          <TavariCheckbox
                                            checked={pricingRule.count_paid_triggers_only !== false}
                                            onChange={(checked) => updateTicketPricingRule(item.id, { count_paid_triggers_only: !!checked })}
                                            label="Only trigger tickets that are still paid can unlock this rule"
                                            id={`ticket-paid-trigger-only-${item.id}`}
                                            disabled={pricingRuleHasSelfTrigger}
                                          />
                                          {pricingRuleHasSelfTrigger && (
                                            <div style={{ fontSize: '13px', color: TavariStyles.colors.gray600 }}>
                                              This stays on for same-ticket rules so free tickets do not recursively unlock more free tickets.
                                            </div>
                                          )}

                                          <div style={{ fontSize: '13px', color: TavariStyles.colors.gray700 }}>
                                            Rule preview: {pricingRuleHasSelfTrigger
                                              ? `for every ${(pricingRule.trigger_quantity || 1) + (pricingRule.discounted_quantity || 1)} selected ${item.name} ticket(s), make ${pricingRule.discounted_quantity || 1} free.`
                                              : `for every ${pricingRule.trigger_quantity || 1} selected trigger ticket(s), make ${pricingRule.discounted_quantity || 1} ${item.name} ticket(s) free.`}
                                          </div>
                                        </>
                                      )}
                                    </div>
                                  </div>
                                );
                              })}

                            <div style={{ padding: '16px', borderRadius: '10px', backgroundColor: TavariStyles.colors.gray50, border: `1px solid ${TavariStyles.colors.gray200}` }}>
                              <div style={{ fontWeight: '600', fontSize: '14px', color: TavariStyles.colors.gray900, marginBottom: '12px' }}>
                                Pricing logic tester
                              </div>
                              <p style={{ fontSize: '13px', color: TavariStyles.colors.gray600, margin: '0 0 12px 0' }}>
                                Choose ticket quantities exactly how you want to test them. This lets staff verify the same conditional pricing behavior customers will see.
                              </p>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '12px' }}>
                                {selectedTicketItems.map((item) => (
                                  <div
                                    key={`tester-${item.id}`}
                                    style={{
                                      display: 'flex',
                                      justifyContent: 'space-between',
                                      alignItems: 'center',
                                      padding: '10px 12px',
                                      backgroundColor: 'white',
                                      borderRadius: '8px',
                                      border: `1px solid ${TavariStyles.colors.gray200}`
                                    }}
                                  >
                                    <div>
                                      <div style={{ fontSize: '13px', color: TavariStyles.colors.gray800, fontWeight: '600' }}>{item.name}</div>
                                      <div style={{ fontSize: '13px', color: TavariStyles.colors.gray600 }}>
                                        ${parseFloat(item.price || 0).toFixed(2)}
                                        {(testerFreeQuantitiesByItem[item.id] || 0) > 0 && (
                                          <span style={{ color: TavariStyles.colors.primary, marginLeft: '8px' }}>
                                            {testerFreeQuantitiesByItem[item.id]} free
                                          </span>
                                        )}
                                      </div>
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                      <button
                                        type="button"
                                        onClick={() => updateTicketRuleTesterQuantity(item.id, (ticketRuleTesterQuantities[item.id] || 0) - 1)}
                                        style={{ width: '32px', height: '32px', borderRadius: '8px', border: `1px solid ${TavariStyles.colors.gray300}`, backgroundColor: 'white', cursor: 'pointer', fontWeight: '700' }}
                                      >
                                        -
                                      </button>
                                      <input
                                        type="number"
                                        min="0"
                                        value={ticketRuleTesterQuantities[item.id] || 0}
                                        onChange={(e) => updateTicketRuleTesterQuantity(item.id, parseInt(e.target.value || '0', 10) || 0)}
                                        style={{ width: '72px', padding: '8px 10px', border: `1px solid ${TavariStyles.colors.gray300}`, borderRadius: '8px', fontSize: '14px', textAlign: 'center' }}
                                      />
                                      <button
                                        type="button"
                                        onClick={() => updateTicketRuleTesterQuantity(item.id, (ticketRuleTesterQuantities[item.id] || 0) + 1)}
                                        style={{ width: '32px', height: '32px', borderRadius: '8px', border: `1px solid ${TavariStyles.colors.gray300}`, backgroundColor: 'white', cursor: 'pointer', fontWeight: '700' }}
                                      >
                                        +
                                      </button>
                                    </div>
                                  </div>
                                ))}
                              </div>

                              {testerPricingPreview.appliedPricingRules?.length > 0 && (
                                <div style={{ marginBottom: '12px', padding: '12px', borderRadius: '8px', backgroundColor: 'white', border: `1px solid ${TavariStyles.colors.gray200}` }}>
                                  <div style={{ fontSize: '13px', fontWeight: '600', color: TavariStyles.colors.gray900, marginBottom: '8px' }}>
                                    Active conditional pricing rules
                                  </div>
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                    {testerPricingPreview.appliedPricingRules.map((rule) => {
                                      const freeItem = selectedTicketItems.find((entry) => entry.id === rule.inventory_item_id);
                                      const triggerNames = (rule.trigger_item_ids || [])
                                        .map((id) => selectedTicketItems.find((item) => item.id === id)?.name)
                                        .filter(Boolean);
                                      return (
                                        <div key={`pricing-summary-${rule.inventory_item_id}`} style={{ fontSize: '13px', color: TavariStyles.colors.gray700 }}>
                                          {rule.free_quantity} free {freeItem?.name || 'ticket'} from {triggerNames.join(', ') || 'selected trigger ticket'}{rule.count_paid_triggers_only !== false ? ' (paid triggers only)' : ''}
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              )}

                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px', borderRadius: '8px', backgroundColor: 'white', border: `1px solid ${TavariStyles.colors.primary}` }}>
                                <div style={{ fontSize: '14px', fontWeight: '600', color: TavariStyles.colors.gray900 }}>
                                  Tester total
                                </div>
                                <div style={{ fontSize: '16px', fontWeight: '700', color: TavariStyles.colors.primary }}>
                                  ${ticketRuleTesterTotal.toFixed(2)}
                                </div>
                              </div>
                            </div>
                          </div>
                        )}
                          </>
                        )}
                      </div>
                    )}
                    {regularModalActiveTab === 'options' && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 24, width: '100%', boxSizing: 'border-box' }}>
                        <div>
                          <h3 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8, color: TavariStyles.colors.gray900 }}>
                            Customer options (before payment)
                          </h3>
                          <p style={{ fontSize: 14, color: TavariStyles.colors.gray600, margin: 0, lineHeight: 1.5 }}>
                            Add food, mascots, decorations, and other extras customers choose online before paying their deposit.
                            Great for birthday parties and special events.
                          </p>
                        </div>
                        <div>
                          <label style={{ display: 'block', marginBottom: 8, fontWeight: 600, fontSize: 14 }}>
                            How options appear online
                          </label>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                            <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
                              <input
                                type="radio"
                                name="portalOptionsDisplayMode"
                                checked={portalOptionsDisplayMode === PORTAL_OPTIONS_DISPLAY_MODES.SINGLE_MODAL}
                                onChange={() => setPortalOptionsDisplayMode(PORTAL_OPTIONS_DISPLAY_MODES.SINGLE_MODAL)}
                              />
                              <span>One scrollable modal (all groups together)</span>
                            </label>
                            <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
                              <input
                                type="radio"
                                name="portalOptionsDisplayMode"
                                checked={portalOptionsDisplayMode === PORTAL_OPTIONS_DISPLAY_MODES.STEP_MODALS}
                                onChange={() => setPortalOptionsDisplayMode(PORTAL_OPTIONS_DISPLAY_MODES.STEP_MODALS)}
                              />
                              <span>Step-by-step modals (one group per step)</span>
                            </label>
                          </div>
                        </div>
                        <div style={{ padding: '12px 14px', borderRadius: 8, backgroundColor: '#f0f9ff', border: '1px solid #bae6fd', fontSize: 13, color: '#0c4a6e', lineHeight: 1.5 }}>
                          Link inventory items or <strong>bundles</strong> (created under POS → Inventory → Bundles) as customer choices.
                          Bundles combine multiple items into one simple option with auto-calculated pricing.
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
                          <div style={{ fontWeight: 600, fontSize: 15 }}>Option groups</div>
                          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                          <button
                            type="button"
                            onClick={async () => {
                              if (!auth.selectedBusinessId) return;
                              setLoadingInventory(true);
                              try {
                                const { data, error } = await supabase
                                  .from('pos_inventory')
                                  .select('*')
                                  .eq('business_id', auth.selectedBusinessId)
                                  .or('is_active.eq.true,is_active.is.null')
                                  .order('name', { ascending: true });
                                if (error) throw error;
                                setInventoryItems(data || []);
                                setInventoryPickerMode('posImport');
                                setOptionInventoryPickerSelection([]);
                                setShowInventorySearchModal(true);
                              } catch (err) {
                                toast.error(err?.message || 'Could not load inventory');
                              } finally {
                                setLoadingInventory(false);
                              }
                            }}
                            style={{
                              padding: '8px 14px',
                              border: `1px solid ${TavariStyles.colors.primary}`,
                              borderRadius: 8,
                              background: 'white',
                              color: TavariStyles.colors.primary,
                              fontWeight: 600,
                              cursor: 'pointer',
                            }}
                          >
                            Import from POS item
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              const newGroup = defaultPortalOptionGroup({
                                name: 'New group',
                                sort_order: portalOptionGroups.length,
                              });
                              setPortalOptionGroups((prev) => [...prev, newGroup]);
                              setExpandedPortalOptionGroupId(newGroup.id);
                            }}
                            style={{
                              padding: '8px 14px',
                              border: 'none',
                              borderRadius: 8,
                              background: TavariStyles.colors.primary,
                              color: 'white',
                              fontWeight: 600,
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              gap: 6,
                            }}
                          >
                            <FiPlus size={16} /> Add group
                          </button>
                          </div>
                        </div>
                        <p style={{ fontSize: 13, color: TavariStyles.colors.gray600, margin: 0 }}>
                          Each group is one step for customers (Food, Decorations, etc.). Use <strong>Add from inventory</strong> to link items or bundles.
                          Drag the handle icon to reorder groups and options.
                        </p>
                        {portalOptionGroups.length === 0 ? (
                          <div style={{ padding: 24, textAlign: 'center', color: TavariStyles.colors.gray600, border: '1px dashed #e5e7eb', borderRadius: 8 }}>
                            No option groups yet. Add a group such as Food, Decorations, or Entertainment.
                          </div>
                        ) : (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                          {portalOptionGroups.map((group, groupIndex) => {
                            const isExpanded = expandedPortalOptionGroupId === group.id;
                            const optionCount = (group.options || []).length;
                            const isGroupDragging = draggedPortalOptionGroupIndex === groupIndex;
                            const isGroupDragOver = dragOverPortalOptionGroupIndex === groupIndex;
                            return (
                            <div
                              key={group.id}
                              onDragOver={(e) => handlePortalOptionGroupDragOver(e, groupIndex)}
                              onDrop={(e) => handlePortalOptionGroupDrop(e, groupIndex)}
                              onDragLeave={handlePortalOptionGroupDragLeave}
                              style={{
                                border: isGroupDragOver
                                  ? `2px solid ${TavariStyles.colors.primary}`
                                  : '1px solid #e5e7eb',
                                borderRadius: 12,
                                backgroundColor: '#fafafa',
                                overflow: 'hidden',
                                opacity: isGroupDragging ? 0.55 : 1,
                                transform: isGroupDragOver ? 'scale(1.01)' : 'scale(1)',
                                transition: 'transform 0.15s ease, opacity 0.15s ease, border-color 0.15s ease',
                              }}
                            >
                              <div
                                role="button"
                                tabIndex={0}
                                onClick={() =>
                                  setExpandedPortalOptionGroupId(isExpanded ? null : group.id)
                                }
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault();
                                    setExpandedPortalOptionGroupId(isExpanded ? null : group.id);
                                  }
                                }}
                                style={{
                                  padding: '14px 16px',
                                  display: 'flex',
                                  justifyContent: 'space-between',
                                  alignItems: 'center',
                                  gap: 12,
                                  cursor: 'pointer',
                                  backgroundColor: isExpanded ? '#f0f9ff' : '#fafafa',
                                  borderBottom: isExpanded ? '1px solid #e5e7eb' : 'none',
                                }}
                              >
                                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
                                  <div
                                    draggable
                                    onDragStart={(e) => handlePortalOptionGroupDragStart(e, groupIndex)}
                                    onDragEnd={handlePortalOptionGroupDragEnd}
                                    onClick={(e) => e.stopPropagation()}
                                    onMouseDown={(e) => e.stopPropagation()}
                                    title="Drag to reorder group"
                                    style={{
                                      color: TavariStyles.colors.gray400,
                                      flexShrink: 0,
                                      cursor: 'grab',
                                      display: 'flex',
                                      alignItems: 'center',
                                      padding: '2px 0',
                                    }}
                                  >
                                    <FiMenu size={18} />
                                  </div>
                                  <div
                                    style={{
                                      color: TavariStyles.colors.gray400,
                                      transition: 'transform 0.2s',
                                      transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                                      flexShrink: 0,
                                    }}
                                  >
                                    <FiChevronDown size={20} />
                                  </div>
                                  <div style={{ minWidth: 0 }}>
                                    <div
                                      style={{
                                        fontWeight: 600,
                                        fontSize: 15,
                                        color: TavariStyles.colors.gray900,
                                        overflow: 'hidden',
                                        textOverflow: 'ellipsis',
                                        whiteSpace: 'nowrap',
                                      }}
                                    >
                                      {group.name?.trim() || 'Unnamed group'}
                                    </div>
                                    <div
                                      style={{
                                        fontSize: 13,
                                        color: TavariStyles.colors.gray600,
                                        marginTop: 2,
                                        display: 'flex',
                                        flexWrap: 'wrap',
                                        gap: '8px 16px',
                                      }}
                                    >
                                      <span>
                                        {optionCount} option{optionCount === 1 ? '' : 's'}
                                      </span>
                                      {group.price != null && (
                                        <span>${Number(group.price).toFixed(2)} default</span>
                                      )}
                                      {group.show_when_option_id && (
                                        <span>
                                          Shows when: {findPortalOptionLabel(portalOptionGroups, group.show_when_option_id) || 'option selected'}
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                </div>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setPortalOptionGroups((prev) => prev.filter((_, idx) => idx !== groupIndex));
                                    if (expandedPortalOptionGroupId === group.id) {
                                      setExpandedPortalOptionGroupId(null);
                                    }
                                  }}
                                  style={{
                                    border: 'none',
                                    background: 'transparent',
                                    color: '#dc2626',
                                    cursor: 'pointer',
                                    padding: 6,
                                    borderRadius: 4,
                                    flexShrink: 0,
                                  }}
                                  title="Remove group"
                                >
                                  <FiTrash2 size={18} />
                                </button>
                              </div>
                              {isExpanded && (
                              <div style={{ padding: 16 }}>
                              <div style={{ display: 'grid', gridTemplateColumns: '1fr 120px 120px', gap: 8, alignItems: 'center', marginBottom: 12 }}>
                                <div>
                                  <div style={{ fontSize: 11, fontWeight: 600, color: TavariStyles.colors.gray500, marginBottom: 4 }}>
                                    Group name
                                  </div>
                                  <input
                                    type="text"
                                    value={group.name}
                                    onChange={(e) =>
                                      setPortalOptionGroups((prev) =>
                                        prev.map((g, idx) =>
                                          idx === groupIndex ? { ...g, name: e.target.value } : g
                                        )
                                      )
                                    }
                                    placeholder="e.g. Food, Mascots"
                                    style={{ width: '100%', padding: '10px 12px', border: '1px solid #e5e7eb', borderRadius: 8, boxSizing: 'border-box' }}
                                  />
                                </div>
                                <div>
                                  <div style={{ fontSize: 11, fontWeight: 600, color: TavariStyles.colors.gray500, marginBottom: 4 }}>
                                    Default price
                                  </div>
                                  <input
                                    type="number"
                                    min={0}
                                    step="0.01"
                                    value={group.price ?? ''}
                                    onChange={(e) =>
                                      setPortalOptionGroups((prev) =>
                                        prev.map((g, idx) =>
                                          idx === groupIndex
                                            ? { ...g, price: parseOptionalPrice(e.target.value) }
                                            : g
                                        )
                                      )
                                    }
                                    placeholder="Optional"
                                    style={{ width: '100%', padding: '10px 12px', border: '1px solid #e5e7eb', borderRadius: 8, boxSizing: 'border-box' }}
                                  />
                                </div>
                                <div>
                                  <div style={{ fontSize: 11, fontWeight: 600, color: TavariStyles.colors.gray500, marginBottom: 4 }}>
                                    Max picks
                                  </div>
                                  <input
                                    type="number"
                                    min={1}
                                    value={group.max_selections ?? ''}
                                    onChange={(e) =>
                                      setPortalOptionGroups((prev) =>
                                        prev.map((g, idx) =>
                                          idx === groupIndex
                                            ? {
                                                ...g,
                                                max_selections: e.target.value === ''
                                                  ? null
                                                  : Math.max(1, Number.parseInt(e.target.value, 10) || 1),
                                              }
                                            : g
                                        )
                                      )
                                    }
                                    placeholder="Any"
                                    title="Set to 1 for pick-one groups (included package choice or pizza size)"
                                    style={{ width: '100%', padding: '10px 12px', border: '1px solid #e5e7eb', borderRadius: 8, boxSizing: 'border-box' }}
                                  />
                                </div>
                              </div>
                              {groupIsIncludedPackageChoice(group) ? (
                                <p style={{ fontSize: 13, color: TavariStyles.colors.gray600, margin: '0 0 12px', lineHeight: 1.5 }}>
                                  <strong>Included package group:</strong> mark every option as <strong>Incl.</strong> and set{' '}
                                  <strong>Max picks</strong> to how many free units the party includes (e.g. 1 for Classic, 2 for Super, 3 for Ultimate).
                                  Quantity counts — two of the same option uses two free units. Anything beyond that is charged at list price.
                                </p>
                              ) : Number.parseInt(group.max_selections, 10) === 1 ? (
                                <p style={{ fontSize: 13, color: TavariStyles.colors.gray600, margin: '0 0 12px', lineHeight: 1.5 }}>
                                  <strong>Pick-one group:</strong> only one option can be selected in this group (e.g. pizza size upgrades).
                                </p>
                              ) : null}
                              <textarea
                                value={group.description || ''}
                                onChange={(e) =>
                                  setPortalOptionGroups((prev) =>
                                    prev.map((g, idx) =>
                                      idx === groupIndex ? { ...g, description: e.target.value } : g
                                    )
                                  )
                                }
                                placeholder="Optional description for customers (not shown on printed booking sheet)"
                                rows={2}
                                style={{ width: '100%', padding: '10px 12px', border: '1px solid #e5e7eb', borderRadius: 8, marginBottom: 12, boxSizing: 'border-box' }}
                              />
                              <div style={{ marginBottom: 12 }}>
                                <div style={{ fontSize: 11, fontWeight: 600, color: TavariStyles.colors.gray500, marginBottom: 4 }}>
                                  Show when selected
                                </div>
                                <select
                                  value={group.show_when_option_id || ''}
                                  onChange={(e) =>
                                    setPortalOptionGroups((prev) =>
                                      prev.map((g, idx) =>
                                        idx === groupIndex
                                          ? {
                                              ...g,
                                              show_when_option_id: e.target.value || null,
                                            }
                                          : g
                                      )
                                    )
                                  }
                                  style={{
                                    width: '100%',
                                    maxWidth: 480,
                                    padding: '10px 12px',
                                    border: '1px solid #e5e7eb',
                                    borderRadius: 8,
                                    fontSize: 14,
                                    backgroundColor: 'white',
                                  }}
                                >
                                  <option value="">Always show this group</option>
                                  {listPortalOptionParentChoices(portalOptionGroups, group.id).map((choice) => (
                                    <option key={choice.optionId} value={choice.optionId}>
                                      {choice.label}
                                    </option>
                                  ))}
                                </select>
                                <p style={{ fontSize: 13, color: TavariStyles.colors.gray600, margin: '6px 0 0' }}>
                                  Use for size-specific modifiers. Example: show &quot;12&quot; toppings&quot; only when the customer picks the 12&quot; pizza.
                                </p>
                              </div>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                                <div
                                  style={{
                                    display: 'grid',
                                    gridTemplateColumns: '28px 1fr 100px 80px auto auto 36px',
                                    gap: 8,
                                    padding: '0 10px',
                                    fontSize: 11,
                                    fontWeight: 600,
                                    color: TavariStyles.colors.gray500,
                                  }}
                                >
                                  <span aria-hidden="true" />
                                  <span>Option name</span>
                                  <span>Price</span>
                                  <span>Max qty</span>
                                  <span>Req.</span>
                                  <span>Incl.</span>
                                  <span aria-hidden="true" />
                                </div>
                                {(group.options || []).map((option, optionIndex) => {
                                  const linkedInv = option.inventory_item_id
                                    ? inventoryItems.find((item) => item.id === option.inventory_item_id)
                                    : null;
                                  const isOptionDragging =
                                    draggedPortalOption?.groupIndex === groupIndex
                                    && draggedPortalOption?.optionIndex === optionIndex;
                                  const isOptionDragOver =
                                    dragOverPortalOption?.groupIndex === groupIndex
                                    && dragOverPortalOption?.optionIndex === optionIndex;
                                  return (
                                  <div
                                    key={option.id}
                                    style={{
                                      padding: 10,
                                      backgroundColor: 'white',
                                      borderRadius: 8,
                                      border: isOptionDragOver
                                        ? `2px solid ${TavariStyles.colors.primary}`
                                        : '1px solid #e5e7eb',
                                      opacity: isOptionDragging ? 0.55 : 1,
                                      transition: 'opacity 0.15s ease, border-color 0.15s ease',
                                    }}
                                  >
                                  <div
                                    onDragOver={(e) => handlePortalOptionDragOver(e, groupIndex, optionIndex)}
                                    onDrop={(e) => handlePortalOptionDrop(e, groupIndex, optionIndex)}
                                    onDragLeave={handlePortalOptionDragLeave}
                                    style={{
                                      display: 'grid',
                                      gridTemplateColumns: '28px 1fr 100px 80px auto auto 36px',
                                      gap: 8,
                                      alignItems: 'center',
                                    }}
                                  >
                                    <div
                                      draggable
                                      onDragStart={(e) => handlePortalOptionDragStart(e, groupIndex, optionIndex)}
                                      onDragEnd={handlePortalOptionDragEnd}
                                      title="Drag to reorder option"
                                      style={{
                                        color: TavariStyles.colors.gray400,
                                        cursor: 'grab',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                      }}
                                    >
                                      <FiMenu size={16} />
                                    </div>
                                    <div>
                                      <input
                                        type="text"
                                        value={option.name}
                                        onChange={(e) =>
                                          setPortalOptionGroups((prev) =>
                                            prev.map((g, gIdx) =>
                                              gIdx === groupIndex
                                                ? {
                                                    ...g,
                                                    options: g.options.map((o, oIdx) =>
                                                      oIdx === optionIndex ? { ...o, name: e.target.value } : o
                                                    ),
                                                  }
                                                : g
                                            )
                                          )
                                        }
                                        placeholder={option.inventory_item_id ? 'Uses inventory name online' : 'Option name'}
                                        style={{ padding: '8px 10px', border: '1px solid #e5e7eb', borderRadius: 6, width: '100%', boxSizing: 'border-box' }}
                                      />
                                      {linkedInv?.is_bundle && (
                                        <div style={{ fontSize: 10, color: '#0369a1', marginTop: 4, fontWeight: 600 }}>
                                          Inventory bundle
                                        </div>
                                      )}
                                      {option.inventory_item_id && !linkedInv?.is_bundle && (
                                        <div style={{ fontSize: 10, color: TavariStyles.colors.primary, marginTop: 4, fontWeight: 600 }}>
                                          Inventory item
                                        </div>
                                      )}
                                    </div>
                                    <input
                                      type="number"
                                      min={0}
                                      step="0.01"
                                      value={option.price ?? ''}
                                      onChange={(e) =>
                                        setPortalOptionGroups((prev) =>
                                          prev.map((g, gIdx) =>
                                            gIdx === groupIndex
                                              ? {
                                                  ...g,
                                                  options: g.options.map((o, oIdx) =>
                                                    oIdx === optionIndex
                                                      ? { ...o, price: parseOptionalPrice(e.target.value) }
                                                      : o
                                                  ),
                                                }
                                              : g
                                          )
                                        )
                                      }
                                      placeholder={
                                        linkedInv
                                          ? `Uses $${Number(linkedInv.price || 0).toFixed(2)}`
                                          : group.price != null
                                            ? `Default $${Number(group.price).toFixed(2)}`
                                            : 'Price'
                                      }
                                      style={{ padding: '8px 10px', border: '1px solid #e5e7eb', borderRadius: 6 }}
                                    />
                                    <input
                                      type="number"
                                      min={1}
                                      max={100}
                                      value={option.max_quantity}
                                      onChange={(e) =>
                                        setPortalOptionGroups((prev) =>
                                          prev.map((g, gIdx) =>
                                            gIdx === groupIndex
                                              ? {
                                                  ...g,
                                                  options: g.options.map((o, oIdx) =>
                                                    oIdx === optionIndex
                                                      ? {
                                                        ...o,
                                                        max_quantity: Math.min(
                                                          100,
                                                          Math.max(1, Number.parseInt(e.target.value, 10) || 100),
                                                        ),
                                                      }
                                                      : o
                                                  ),
                                                }
                                              : g
                                          )
                                        )
                                      }
                                      style={{ padding: '8px 10px', border: '1px solid #e5e7eb', borderRadius: 6 }}
                                    />
                                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                                      <TavariCheckbox
                                        checked={!!option.required}
                                        onChange={(checked) =>
                                          setPortalOptionGroups((prev) =>
                                            prev.map((g, gIdx) =>
                                              gIdx === groupIndex
                                                ? {
                                                    ...g,
                                                    options: g.options.map((o, oIdx) =>
                                                      oIdx === optionIndex ? { ...o, required: checked } : o
                                                    ),
                                                  }
                                                : g
                                            )
                                          )
                                        }
                                        size="sm"
                                      />
                                      Req.
                                    </label>
                                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                                      <TavariCheckbox
                                        checked={!!option.included}
                                        onChange={(checked) =>
                                          setPortalOptionGroups((prev) =>
                                            prev.map((g, gIdx) =>
                                              gIdx === groupIndex
                                                ? {
                                                    ...g,
                                                    options: g.options.map((o, oIdx) => {
                                                      if (oIdx === optionIndex) {
                                                        return { ...o, included: checked };
                                                      }
                                                      const pickOneGroup =
                                                        Number.parseInt(g.max_selections, 10) === 1;
                                                      if (checked && !pickOneGroup) {
                                                        return { ...o, included: false };
                                                      }
                                                      return o;
                                                    }),
                                                  }
                                                : g
                                            )
                                          )
                                        }
                                        size="sm"
                                      />
                                      Incl.
                                    </label>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        const optionLabel =
                                          option.name?.trim()
                                          || linkedInv?.name
                                          || 'this option';
                                        const dependents = countPortalOptionDependents(
                                          portalOptionGroups,
                                          option.id,
                                        );
                                        let message = `Remove "${optionLabel}" from this group?`;
                                        if (dependents > 0) {
                                          message += ` ${dependents} other option${dependents === 1 ? '' : 's'} or group${dependents === 1 ? '' : 's'} show when this is selected — those conditions will be cleared.`;
                                        }
                                        if (!window.confirm(message)) return;
                                        setPortalOptionGroups((prev) =>
                                          removePortalOptionFromGroups(prev, groupIndex, optionIndex),
                                        );
                                      }}
                                      style={{
                                        border: 'none',
                                        background: 'transparent',
                                        color: '#dc2626',
                                        cursor: 'pointer',
                                        padding: 4,
                                        borderRadius: 4,
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                      }}
                                      title="Remove option"
                                      aria-label={`Remove ${option.name || 'option'}`}
                                    >
                                      <FiTrash2 size={16} />
                                    </button>
                                  </div>
                                  <textarea
                                    value={option.description || ''}
                                    onChange={(e) =>
                                      setPortalOptionGroups((prev) =>
                                        prev.map((g, gIdx) =>
                                          gIdx === groupIndex
                                            ? {
                                                ...g,
                                                options: g.options.map((o, oIdx) =>
                                                  oIdx === optionIndex ? { ...o, description: e.target.value } : o
                                                ),
                                              }
                                            : g
                                        )
                                      )
                                    }
                                    placeholder="Optional option description for customers (not shown on printed booking sheet)"
                                    rows={2}
                                    style={{
                                      width: '100%',
                                      marginTop: 8,
                                      padding: '8px 10px',
                                      border: '1px solid #e5e7eb',
                                      borderRadius: 6,
                                      boxSizing: 'border-box',
                                      fontSize: 13,
                                    }}
                                  />
                                  </div>
                                  );
                                })}
                              </div>
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 10 }}>
                              <button
                                type="button"
                                onClick={() =>
                                  setPortalOptionGroups((prev) =>
                                    prev.map((g, idx) =>
                                      idx === groupIndex
                                        ? {
                                            ...g,
                                            options: [...(g.options || []), defaultPortalOptionItem()],
                                          }
                                        : g
                                    )
                                  )
                                }
                                style={{
                                  padding: '8px 12px',
                                  border: `1px solid ${TavariStyles.colors.gray300}`,
                                  borderRadius: 8,
                                  background: 'white',
                                  cursor: 'pointer',
                                  fontSize: 13,
                                  fontWeight: 600,
                                }}
                              >
                                + Add option
                              </button>
                              <button
                                type="button"
                                onClick={async () => {
                                  setInventoryPickerMode('options');
                                  setOptionInventoryPickerGroupIndex(groupIndex);
                                  const alreadyAddedIds = (portalOptionGroups[groupIndex]?.options || [])
                                    .map((option) => option.inventory_item_id)
                                    .filter(Boolean);
                                  setOptionInventoryPickerSelection(alreadyAddedIds);
                                  setInventorySearchTerm('');
                                  setSelectedInventoryCategory('');
                                  setShowInventorySearchModal(true);
                                  if (auth.selectedBusinessId) {
                                    await loadInventoryCategories();
                                    await loadInventoryItems();
                                  }
                                }}
                                style={{
                                  padding: '8px 12px',
                                  border: `1px solid ${TavariStyles.colors.primary}`,
                                  borderRadius: 8,
                                  background: `${TavariStyles.colors.primary}10`,
                                  color: TavariStyles.colors.primary,
                                  cursor: 'pointer',
                                  fontSize: 13,
                                  fontWeight: 600,
                                }}
                              >
                                + Add from inventory
                              </button>
                              <button
                                type="button"
                                onClick={() => navigate('/dashboard/pos/bundles?create=1')}
                                style={{
                                  padding: '8px 12px',
                                  border: `1px solid ${TavariStyles.colors.gray300}`,
                                  borderRadius: 8,
                                  background: 'white',
                                  color: TavariStyles.colors.gray900,
                                  cursor: 'pointer',
                                  fontSize: 13,
                                  fontWeight: 600,
                                }}
                              >
                                Create Bundle
                              </button>
                              </div>
                              </div>
                              )}
                            </div>
                            );
                          })}
                          </div>
                        )}
                      </div>
                    )}
                    {regularModalActiveTab === 'pay-deposit' && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '28px', width: '100%' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '24px', width: '100%' }}>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                            <div>
                              <label style={{ display: 'block', marginBottom: '8px', fontWeight: '600', fontSize: '14px', color: TavariStyles.colors.gray900 }}>
                                Online payment
                              </label>
                              <p style={{ fontSize: '14px', color: TavariStyles.colors.gray600, marginBottom: '12px' }}>
                                Controls what customers pay when booking this activity online.
                              </p>
                              <select
                                value={onlinePaymentSettings.mode}
                                onChange={(e) => {
                                  const mode = e.target.value;
                                  setOnlinePaymentSettings((prev) => ({
                                    ...prev,
                                    mode,
                                  }));
                                }}
                                style={{
                                  width: '100%',
                                  padding: '10px 14px',
                                  border: `1px solid ${TavariStyles.colors.gray300}`,
                                  borderRadius: '8px',
                                  fontSize: '14px',
                                  backgroundColor: 'white',
                                }}
                              >
                                <option value={ONLINE_PAYMENT_MODES.REQUIRE_FULL}>Require online payment</option>
                                <option value={ONLINE_PAYMENT_MODES.REQUIRE_DEPOSIT}>Require payment of deposit</option>
                              </select>
                            </div>

                            {onlinePaymentSettings.mode === ONLINE_PAYMENT_MODES.REQUIRE_DEPOSIT && (
                              <div
                                style={{
                                  padding: '16px',
                                  borderRadius: '8px',
                                  border: `1px solid ${TavariStyles.colors.gray200}`,
                                  backgroundColor: TavariStyles.colors.gray50,
                                  display: 'flex',
                                  flexDirection: 'column',
                                  gap: '16px',
                                }}
                              >
                                <div style={{ fontSize: '14px', fontWeight: '600', color: TavariStyles.colors.gray900 }}>
                                  Deposit amount
                                </div>
                                <p style={{ fontSize: '13px', color: TavariStyles.colors.gray600, margin: 0 }}>
                                  Choose one option. The remaining balance is due at check-in.
                                </p>

                                <label
                                  style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '12px',
                                    cursor: 'pointer',
                                    fontSize: '14px',
                                    color: TavariStyles.colors.gray900,
                                  }}
                                >
                                  <input
                                    type="radio"
                                    name="depositType"
                                    checked={onlinePaymentSettings.depositType === DEPOSIT_TYPES.FIXED}
                                    onChange={() => setOnlinePaymentSettings((prev) => ({
                                      ...prev,
                                      depositType: DEPOSIT_TYPES.FIXED,
                                    }))}
                                  />
                                  <span style={{ minWidth: '140px' }}>Fixed amount (total)</span>
                                  <input
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    disabled={onlinePaymentSettings.depositType !== DEPOSIT_TYPES.FIXED}
                                    value={onlinePaymentSettings.depositFixedAmount}
                                    onChange={(e) => setOnlinePaymentSettings((prev) => ({
                                      ...prev,
                                      depositType: DEPOSIT_TYPES.FIXED,
                                      depositFixedAmount: e.target.value,
                                    }))}
                                    placeholder="0.00"
                                    style={{
                                      width: '120px',
                                      padding: '8px 10px',
                                      border: `1px solid ${TavariStyles.colors.gray300}`,
                                      borderRadius: '8px',
                                      fontSize: '14px',
                                      backgroundColor: onlinePaymentSettings.depositType === DEPOSIT_TYPES.FIXED ? 'white' : TavariStyles.colors.gray100,
                                    }}
                                  />
                                </label>

                                <label
                                  style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '12px',
                                    cursor: 'pointer',
                                    fontSize: '14px',
                                    color: TavariStyles.colors.gray900,
                                  }}
                                >
                                  <input
                                    type="radio"
                                    name="depositType"
                                    checked={onlinePaymentSettings.depositType === DEPOSIT_TYPES.PERCENTAGE}
                                    onChange={() => setOnlinePaymentSettings((prev) => ({
                                      ...prev,
                                      depositType: DEPOSIT_TYPES.PERCENTAGE,
                                    }))}
                                  />
                                  <span style={{ minWidth: '140px' }}>Percentage</span>
                                  <input
                                    type="number"
                                    min="1"
                                    max="100"
                                    step="1"
                                    disabled={onlinePaymentSettings.depositType !== DEPOSIT_TYPES.PERCENTAGE}
                                    value={onlinePaymentSettings.depositPercentage}
                                    onChange={(e) => setOnlinePaymentSettings((prev) => ({
                                      ...prev,
                                      depositType: DEPOSIT_TYPES.PERCENTAGE,
                                      depositPercentage: e.target.value,
                                    }))}
                                    placeholder="25"
                                    style={{
                                      width: '120px',
                                      padding: '8px 10px',
                                      border: `1px solid ${TavariStyles.colors.gray300}`,
                                      borderRadius: '8px',
                                      fontSize: '14px',
                                      backgroundColor: onlinePaymentSettings.depositType === DEPOSIT_TYPES.PERCENTAGE ? 'white' : TavariStyles.colors.gray100,
                                    }}
                                  />
                                  <span style={{ fontSize: '13px', color: TavariStyles.colors.gray600 }}>% of total</span>
                                </label>
                              </div>
                            )}
                          </div>

                          <div
                            style={{
                              padding: '20px',
                              borderRadius: '8px',
                              border: `1px solid ${TavariStyles.colors.gray200}`,
                              backgroundColor: 'white',
                              display: 'flex',
                              flexDirection: 'column',
                              gap: '16px',
                            }}
                          >
                            <div>
                              <div style={{ fontWeight: '600', fontSize: '14px', color: TavariStyles.colors.gray900, marginBottom: '8px' }}>
                                Booking approval
                              </div>
                              <p style={{ fontSize: '13px', color: TavariStyles.colors.gray600, margin: '0 0 12px' }}>
                                Choose whether online bookings are confirmed immediately with payment, or held for staff review first.
                              </p>
                            </div>

                            <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer' }}>
                              <TavariCheckbox
                                checked={onlinePaymentSettings.autoApprove !== false}
                                onChange={(checked) => setOnlinePaymentSettings((prev) => ({
                                  ...prev,
                                  autoApprove: checked,
                                }))}
                                size="sm"
                              />
                              <span style={{ fontSize: '14px', color: TavariStyles.colors.gray900, lineHeight: 1.5 }}>
                                Automatically approve bookings — customer pays online at checkout (deposit or full payment).
                              </span>
                            </label>

                            <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer' }}>
                              <TavariCheckbox
                                checked={onlinePaymentSettings.autoApprove === false}
                                onChange={(checked) => setOnlinePaymentSettings((prev) => ({
                                  ...prev,
                                  autoApprove: !checked,
                                }))}
                                size="sm"
                              />
                              <span style={{ fontSize: '14px', color: TavariStyles.colors.gray900, lineHeight: 1.5 }}>
                                Require staff approval — customer submits a request, the spot is held, and deposit payment is requested after you approve.
                              </span>
                            </label>

                            {onlinePaymentSettings.autoApprove === false && (
                              <div style={{ marginTop: 4, paddingTop: 16, borderTop: `1px solid ${TavariStyles.colors.gray200}` }}>
                                <label style={{ display: 'block', marginBottom: '8px', fontWeight: '600', fontSize: '14px', color: TavariStyles.colors.gray900 }}>
                                  Days to pay deposit after approval
                                </label>
                                <p style={{ fontSize: '13px', color: TavariStyles.colors.gray600, marginBottom: '12px' }}>
                                  After you approve a request, the system automatically emails the customer a payment link. They have this many days to pay their deposit.
                                </p>
                                <input
                                  type="number"
                                  min="1"
                                  max="365"
                                  value={onlinePaymentSettings.depositDueDaysAfterApproval ?? 7}
                                  onChange={(e) => setOnlinePaymentSettings((prev) => ({
                                    ...prev,
                                    depositDueDaysAfterApproval: e.target.value,
                                  }))}
                                  style={{
                                    width: '120px',
                                    padding: '10px 14px',
                                    border: `1px solid ${TavariStyles.colors.gray300}`,
                                    borderRadius: '8px',
                                    fontSize: '14px',
                                  }}
                                />
                              </div>
                            )}
                          </div>
                        </div>

                        <div
                          style={{
                            padding: '20px',
                            borderRadius: '8px',
                            border: `1px solid ${TavariStyles.colors.gray200}`,
                            backgroundColor: 'white',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '20px',
                            width: '100%',
                          }}
                        >
                          <div>
                            <label style={{ display: 'block', marginBottom: '8px', fontWeight: '600', fontSize: '14px', color: TavariStyles.colors.gray900 }}>
                              Extended time pricing
                            </label>
                            <p style={{ fontSize: '14px', color: TavariStyles.colors.gray600, marginBottom: '12px' }}>
                              Default rate staff see when extending a party on this activity. They can override the final charge at extension time.
                            </p>
                            <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer' }}>
                              <TavariCheckbox
                                checked={extensionPricingSettings.enabled !== false}
                                onChange={(checked) => setExtensionPricingSettings((prev) => ({
                                  ...prev,
                                  enabled: checked,
                                }))}
                                size="sm"
                              />
                              <span style={{ fontSize: '14px', color: TavariStyles.colors.gray900, lineHeight: 1.5 }}>
                                Enable extended time pricing for this activity
                              </span>
                            </label>
                          </div>

                          {extensionPricingSettings.enabled !== false ? (
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px' }}>
                              <div>
                                <label style={{ display: 'block', marginBottom: '8px', fontWeight: '600', fontSize: '14px', color: TavariStyles.colors.gray900 }}>
                                  Pricing unit
                                </label>
                                <select
                                  value={extensionPricingSettings.unit}
                                  onChange={(e) => setExtensionPricingSettings((prev) => ({
                                    ...prev,
                                    unit: e.target.value,
                                  }))}
                                  style={{
                                    width: '100%',
                                    padding: '10px 14px',
                                    border: `1px solid ${TavariStyles.colors.gray300}`,
                                    borderRadius: '8px',
                                    fontSize: '14px',
                                    backgroundColor: 'white',
                                  }}
                                >
                                  {Object.values(EXTENSION_PRICING_UNITS).map((unit) => (
                                    <option key={unit} value={unit}>
                                      {formatExtensionPricingUnitLabel(unit)}
                                    </option>
                                  ))}
                                </select>
                              </div>

                              <div>
                                <label style={{ display: 'block', marginBottom: '8px', fontWeight: '600', fontSize: '14px', color: TavariStyles.colors.gray900 }}>
                                  {extensionPricingSettings.unit === EXTENSION_PRICING_UNITS.FLAT ? 'Flat extension price' : 'Price'}
                                </label>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                  <span style={{ fontSize: '14px', color: TavariStyles.colors.gray600 }}>$</span>
                                  <input
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    value={extensionPricingSettings.price}
                                    onChange={(e) => setExtensionPricingSettings((prev) => ({
                                      ...prev,
                                      price: e.target.value,
                                    }))}
                                    placeholder="0.00"
                                    style={{
                                      width: '100%',
                                      padding: '10px 14px',
                                      border: `1px solid ${TavariStyles.colors.gray300}`,
                                      borderRadius: '8px',
                                      fontSize: '14px',
                                    }}
                                  />
                                </div>
                              </div>
                            </div>
                          ) : null}

                          {extensionPricingSettings.enabled !== false
                            && extensionPricingSettings.unit !== EXTENSION_PRICING_UNITS.FLAT ? (
                              <label style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
                                <TavariCheckbox
                                  checked={extensionPricingSettings.roundUpToUnit !== false}
                                  onChange={(checked) => setExtensionPricingSettings((prev) => ({
                                    ...prev,
                                    roundUpToUnit: checked,
                                  }))}
                                  size="sm"
                                />
                                <span style={{ fontSize: '14px', color: TavariStyles.colors.gray900, lineHeight: 1.5 }}>
                                  Round up to full pricing units (e.g. 31 minutes billed as 2 × 30-minute blocks).
                                </span>
                              </label>
                            ) : null}

                          {extensionPricingSettings.enabled !== false ? (
                            <div style={{
                              padding: '12px 14px',
                              borderRadius: '8px',
                              backgroundColor: TavariStyles.colors.gray50,
                              border: `1px solid ${TavariStyles.colors.gray200}`,
                              fontSize: '13px',
                              color: TavariStyles.colors.gray700,
                              lineHeight: 1.5,
                            }}
                            >
                              <strong>Example:</strong>{' '}
                              {extensionPricingSettings.unit === EXTENSION_PRICING_UNITS.FLAT
                                ? `$${(Number(extensionPricingSettings.price) || 0).toFixed(2)} per extension`
                                : `30 minutes = $${calculateExtensionPrice(30, extensionPricingSettings).toFixed(2)} · 45 minutes = $${calculateExtensionPrice(45, extensionPricingSettings).toFixed(2)}`}
                            </div>
                          ) : null}
                        </div>

                        <div style={{
                          padding: '16px',
                          backgroundColor: TavariStyles.colors.gray50,
                          borderRadius: '8px',
                          border: `1px solid ${TavariStyles.colors.gray200}`,
                          width: '100%',
                        }}>
                          <div style={{ fontSize: '14px', color: TavariStyles.colors.gray700 }}>
                            <strong>Note:</strong> These rules apply to online customer portal checkout. Staff can still record full, partial, or unpaid bookings at the desk.
                          </div>
                        </div>
                      </div>
                    )}

                    {regularModalActiveTab === 'booking-settings' && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                        <div>
                          <label style={{ display: 'block', marginBottom: '8px', fontWeight: '600', fontSize: '14px', color: TavariStyles.colors.gray900 }}>
                            Minimum Number of Tickets
                          </label>
                          <p style={{ fontSize: '14px', color: TavariStyles.colors.gray600, marginBottom: '12px' }}>
                            Set the minimum number of tickets required per booking. Applies to customer portal and staff bookings (managers can override on staff bookings).
                          </p>
                          <input
                            type="number"
                            min="1"
                            value={minTickets || ''}
                            onChange={(e) => {
                              const value = e.target.value === '' ? null : parseInt(e.target.value, 10);
                              setMinTickets(value);
                            }}
                            placeholder="No minimum"
                            style={{
                              width: '100%',
                              maxWidth: '300px',
                              padding: '10px 14px',
                              border: `1px solid ${TavariStyles.colors.gray300}`,
                              borderRadius: '8px',
                              fontSize: '14px'
                            }}
                          />
                        </div>

                        <div>
                          <label style={{ display: 'block', marginBottom: '8px', fontWeight: '600', fontSize: '14px', color: TavariStyles.colors.gray900 }}>
                            Maximum Number of Tickets
                          </label>
                          <p style={{ fontSize: '14px', color: TavariStyles.colors.gray600, marginBottom: '12px' }}>
                            Set the maximum number of tickets allowed per booking. Applies to customer portal and staff bookings (managers can override on staff bookings).
                          </p>
                          <input
                            type="number"
                            min="1"
                            value={maxTickets || ''}
                            onChange={(e) => {
                              const value = e.target.value === '' ? null : parseInt(e.target.value, 10);
                              setMaxTickets(value);
                            }}
                            placeholder="No maximum"
                            style={{
                              width: '100%',
                              maxWidth: '300px',
                              padding: '10px 14px',
                              border: `1px solid ${TavariStyles.colors.gray300}`,
                              borderRadius: '8px',
                              fontSize: '14px'
                            }}
                          />
                        </div>

                        <div>
                          <label style={{ display: 'block', marginBottom: '8px', fontWeight: '600', fontSize: '14px', color: TavariStyles.colors.gray900 }}>
                            Waiver required
                          </label>
                          <p style={{ fontSize: '14px', color: TavariStyles.colors.gray600, marginBottom: '12px' }}>
                            If enabled, customers must complete a waiver for participants before completing this booking.
                          </p>
                          <TavariCheckbox
                            checked={!!requiresWaiver}
                            onChange={(checked) => {
                              console.log('[BookingSettings] Waiver required checkbox changed', { checked, nextValue: !!checked });
                              setRequiresWaiver(!!checked);
                            }}
                            size="md"
                          />
                        </div>

                        <div>
                          <label style={{ display: 'block', marginBottom: '8px', fontWeight: '600', fontSize: '14px', color: TavariStyles.colors.gray900 }}>
                            Camper registration required
                          </label>
                          <p style={{ fontSize: '14px', color: TavariStyles.colors.gray600, marginBottom: '12px' }}>
                            If enabled, each minor camper needs a current annual registration and medical form before check-in. Parents and adult chaperones are not asked to complete this form. Payment can still be completed without it.
                          </p>
                          <TavariCheckbox
                            checked={!!requiresCamperRegistration}
                            onChange={(checked) => setRequiresCamperRegistration(!!checked)}
                            size="md"
                          />
                        </div>

                        <div style={{
                          padding: '16px',
                          backgroundColor: TavariStyles.colors.gray50,
                          borderRadius: '8px',
                          border: `1px solid ${TavariStyles.colors.gray200}`
                        }}>
                          <div style={{ fontSize: '14px', color: TavariStyles.colors.gray700 }}>
                            <strong>Note:</strong> These ticket quantity limits are enforced for online bookings only. In-person bookings at the point of sale are not affected by these restrictions.
                          </div>
                        </div>
                      </div>
                    )}

                    {regularModalActiveTab === 'guest-limits' && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                        <div>
                          <label style={{ display: 'block', marginBottom: '8px', fontWeight: '600', fontSize: '14px', color: TavariStyles.colors.gray900 }}>
                            Included children
                          </label>
                          <p style={{ fontSize: '14px', color: TavariStyles.colors.gray600, marginBottom: '12px' }}>
                            Optional. How many children are included in this party package. Leave blank to use your business default guest list settings.
                          </p>
                          <input
                            type="number"
                            min="0"
                            value={partyIncludedKids ?? ''}
                            onChange={(e) => {
                              const value = e.target.value === '' ? null : parseInt(e.target.value, 10);
                              setPartyIncludedKids(Number.isFinite(value) ? value : null);
                            }}
                            placeholder="Use business default"
                            style={{
                              width: '100%',
                              maxWidth: '300px',
                              padding: '10px 14px',
                              border: `1px solid ${TavariStyles.colors.gray300}`,
                              borderRadius: '8px',
                              fontSize: '14px',
                            }}
                          />
                        </div>

                        <div>
                          <label style={{ display: 'block', marginBottom: '8px', fontWeight: '600', fontSize: '14px', color: TavariStyles.colors.gray900 }}>
                            Included adults
                          </label>
                          <p style={{ fontSize: '14px', color: TavariStyles.colors.gray600, marginBottom: '12px' }}>
                            Optional. How many adults are included in this party package. Leave blank to use your business default guest list settings.
                          </p>
                          <input
                            type="number"
                            min="0"
                            value={partyIncludedAdults ?? ''}
                            onChange={(e) => {
                              const value = e.target.value === '' ? null : parseInt(e.target.value, 10);
                              setPartyIncludedAdults(Number.isFinite(value) ? value : null);
                            }}
                            placeholder="Use business default"
                            style={{
                              width: '100%',
                              maxWidth: '300px',
                              padding: '10px 14px',
                              border: `1px solid ${TavariStyles.colors.gray300}`,
                              borderRadius: '8px',
                              fontSize: '14px',
                            }}
                          />
                        </div>

                        <div>
                          <label style={{ display: 'block', marginBottom: '8px', fontWeight: '600', fontSize: '14px', color: TavariStyles.colors.gray900 }}>
                            1 free adult per child
                          </label>
                          <p style={{ fontSize: '14px', color: TavariStyles.colors.gray600, marginBottom: '12px' }}>
                            When enabled, each child on the guest list includes one free adult. Included adults are the higher of the included adults above or the number of children on the list.
                          </p>
                          <select
                            value={partyOneAdultPerChildMode}
                            onChange={(e) => setPartyOneAdultPerChildMode(e.target.value)}
                            style={{
                              width: '100%',
                              maxWidth: '360px',
                              padding: '10px 14px',
                              border: `1px solid ${TavariStyles.colors.gray300}`,
                              borderRadius: '8px',
                              fontSize: '14px',
                              background: '#fff',
                            }}
                          >
                            <option value="inherit">Use business default</option>
                            <option value="enabled">Enabled for this booking type</option>
                            <option value="disabled">Disabled for this booking type</option>
                          </select>
                        </div>

                        <div style={{
                          padding: '16px',
                          backgroundColor: TavariStyles.colors.gray50,
                          borderRadius: '8px',
                          border: `1px solid ${TavariStyles.colors.gray200}`,
                        }}>
                          <div style={{ fontSize: '14px', color: TavariStyles.colors.gray700 }}>
                            <strong>Note:</strong> Parents can still add guests above these limits. When they do, the guest list shows a warning that they are above the included amount for their booking.
                          </div>
                        </div>
                      </div>
                    )}

                    {regularModalActiveTab === 'additional-tabs' && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                        {editingActivityId ? (
                          <BookingActivityAdditionalTabsEditor
                            businessId={auth.selectedBusinessId}
                            activityId={editingActivityId}
                          />
                        ) : (
                          <div style={{
                            padding: '16px',
                            borderRadius: '8px',
                            border: `1px solid ${TavariStyles.colors.gray200}`,
                            backgroundColor: TavariStyles.colors.gray50,
                            color: TavariStyles.colors.gray700,
                            fontSize: '14px',
                          }}>
                            Save this booking type first, then open Additional Tabs to configure custom booking detail tabs
                            (for example cake receipts on parties only).
                          </div>
                        )}
                      </div>
                    )}

                    {regularModalActiveTab === 'images' && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                        <div>
                          <label style={{ display: 'block', marginBottom: '8px', fontWeight: '600', fontSize: '14px', color: TavariStyles.colors.gray900 }}>
                            Activity images
                          </label>
                          <p style={{ fontSize: '14px', color: TavariStyles.colors.gray600, marginBottom: '16px' }}>
                            Upload booking activity images or paste external image URLs. These images are shown on the customer booking page.
                          </p>
                        </div>

                        <div style={{
                          padding: '16px',
                          borderRadius: '10px',
                          border: `1px solid ${TavariStyles.colors.gray200}`,
                          backgroundColor: TavariStyles.colors.gray50,
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '12px'
                        }}>
                          <input
                            ref={activityImageInputRef}
                            type="file"
                            accept="image/jpeg,image/png,image/webp,image/gif"
                            onChange={handleActivityImageFileSelect}
                            disabled={activityImageUploading}
                            style={{ display: 'none' }}
                          />
                          <button
                            type="button"
                            onClick={() => activityImageInputRef.current?.click()}
                            disabled={activityImageUploading}
                            style={{
                              padding: '12px 16px',
                              borderRadius: '8px',
                              border: `1px solid ${TavariStyles.colors.primary}`,
                              backgroundColor: 'white',
                              color: TavariStyles.colors.primary,
                              fontSize: '14px',
                              fontWeight: '600',
                              cursor: activityImageUploading ? 'not-allowed' : 'pointer',
                              opacity: activityImageUploading ? 0.7 : 1,
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '8px',
                              alignSelf: 'flex-start'
                            }}
                          >
                            <FiUpload size={16} />
                            {activityImageUploading ? 'Uploading image...' : 'Upload image'}
                          </button>

                          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                            <input
                              type="url"
                              value={activityImageUrlInput}
                              onChange={(e) => setActivityImageUrlInput(e.target.value)}
                              placeholder="https://example.com/your-image.jpg"
                              style={{
                                flex: '1 1 360px',
                                padding: '10px 12px',
                                border: `1px solid ${TavariStyles.colors.gray300}`,
                                borderRadius: '8px',
                                fontSize: '14px'
                              }}
                            />
                            <button
                              type="button"
                              onClick={addActivityImageUrl}
                              style={{
                                padding: '10px 16px',
                                borderRadius: '8px',
                                border: 'none',
                                backgroundColor: TavariStyles.colors.primary,
                                color: 'white',
                                fontSize: '14px',
                                fontWeight: '600',
                                cursor: 'pointer',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '8px'
                              }}
                            >
                              <FiLink size={16} />
                              Add URL
                            </button>
                          </div>

                          {activityImageUploadError && (
                            <div style={{
                              padding: '12px 14px',
                              borderRadius: '8px',
                              backgroundColor: '#fef2f2',
                              border: '1px solid #fecaca',
                              color: '#b91c1c',
                              fontSize: '13px'
                            }}>
                              {activityImageUploadError}
                            </div>
                          )}
                        </div>

                        {activityImages.length === 0 ? (
                          <div style={{
                            padding: '32px',
                            textAlign: 'center',
                            borderRadius: '10px',
                            border: `1px dashed ${TavariStyles.colors.gray300}`,
                            backgroundColor: TavariStyles.colors.gray50,
                            color: TavariStyles.colors.gray600
                          }}>
                            <FiImage size={28} style={{ marginBottom: '10px' }} />
                            <div style={{ fontSize: '14px' }}>
                              No activity images added yet.
                            </div>
                          </div>
                        ) : (
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '16px' }}>
                            {activityImages.map((imageUrl, index) => (
                              <div
                                key={`${imageUrl}-${index}`}
                                style={{
                                  border: `1px solid ${TavariStyles.colors.gray200}`,
                                  borderRadius: '10px',
                                  overflow: 'hidden',
                                  backgroundColor: 'white'
                                }}
                              >
                                <div style={{ aspectRatio: '4 / 3', backgroundColor: TavariStyles.colors.gray100 }}>
                                  <img
                                    src={imageUrl}
                                    alt={`Activity image ${index + 1}`}
                                    style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                                  />
                                </div>
                                <div style={{ padding: '12px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                  <div style={{ fontSize: '13px', color: TavariStyles.colors.gray600, wordBreak: 'break-all' }}>
                                    {imageUrl}
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => removeActivityImage(index)}
                                    style={{
                                      padding: '8px 10px',
                                      borderRadius: '8px',
                                      border: 'none',
                                      backgroundColor: '#fee2e2',
                                      color: '#b91c1c',
                                      fontSize: '13px',
                                      fontWeight: '600',
                                      cursor: 'pointer',
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      justifyContent: 'center',
                                      gap: '8px'
                                    }}
                                  >
                                    <FiTrash2 size={14} />
                                    Remove image
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Footer with Back and Save Buttons */}
                  <div style={{
                    padding: '20px 24px',
                    borderTop: '1px solid #e5e7eb',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center'
                  }}>
                    <button
                      onClick={() => {
                        setShowRegularTabbedModal(false);
                        setRegularModalActiveTab('name');
                        setEditingActivityId(null);
                        setActivityName('');
                        setSelectedCategoryId('');
                        setActivitySections([]);
                        setActivityDuration({ days: 0, hours: 0, minutes: 30 });
                        setAdvancedBookingMinNotice({ value: 5, unit: 'minutes' });
                        setAdvancedBookingMaxAdvance({ value: 20, unit: 'days' });
                        setMinTickets(null);
                        setMaxTickets(null);
                        setOnlinePaymentSettings(defaultOnlinePaymentSettings());
        setExtensionPricingSettings(defaultExtensionPricingSettings());
                        setRequiresWaiver(false);
                        setRequiresCamperRegistration(false);
                        setActivityImages([]);
                        setActivityImageUrlInput('');
                        setActivityImageUploadError(null);
                        setSelectedInventoryItems([]);
                        setInventoryItems([]);
                        setTicketAssignmentRules([]);
                        setTicketPricingRules([]);
                        setShowCategoryModal(true);
                      }}
                      style={{
                        padding: '10px 20px',
                        backgroundColor: TavariStyles.colors.gray700,
                        color: 'white',
                        border: 'none',
                        borderRadius: '8px',
                        fontSize: '14px',
                        fontWeight: '600',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px'
                      }}
                    >
                      <FiArrowLeft size={16} />
                      Back
                    </button>
                    <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                      {/* Show schedule info if on schedule tab and has schedules */}
                      {regularModalActiveTab === 'schedule' && 
                       Object.keys(scheduleTimeSlots).some(day => {
                         const slots = scheduleTimeSlots[day];
                         return slots && Array.isArray(slots) && slots.length > 0;
                       }) && 
                       scheduleName.trim() && (
                        <div style={{
                          fontSize: '13px',
                          color: TavariStyles.colors.gray600,
                          fontStyle: 'italic'
                        }}>
                          Will save schedule: "{scheduleName.trim()}"
                        </div>
                      )}
                      <button
                        onClick={handleSaveRegularActivity}
                        disabled={saving}
                        style={{
                          padding: '10px 20px',
                          backgroundColor: saving ? '#ccc' : TavariStyles.colors.primary,
                          color: 'white',
                          border: 'none',
                          borderRadius: '8px',
                          fontSize: '14px',
                          fontWeight: '600',
                          cursor: saving ? 'not-allowed' : 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                          opacity: saving ? 0.6 : 1
                        }}
                      >
                        <FiSave size={16} />
                        {saving ? 'Saving...' : 'Save'}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Schedule Time Slot Modal */}
            {showScheduleModal && (
              <div
                style={{
                  position: 'fixed',
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  backgroundColor: 'rgba(0, 0, 0, 0.5)',
                  zIndex: 200,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '20px'
                }}
                onClick={closeScheduleModal}
              >
                <div
                  style={{
                    backgroundColor: 'white',
                    borderRadius: '12px',
                    maxWidth: '800px',
                    width: '100%',
                    maxHeight: '90vh',
                    overflow: 'auto',
                    boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)'
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <div style={{
                    padding: '20px 24px',
                    borderBottom: '1px solid #e5e7eb',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center'
                  }}>
                    <h3 style={{ fontSize: '20px', fontWeight: '600', margin: 0 }}>
                      {editingSlotIndex !== null ? 'Edit' : 'Add'} Time Slot - {scheduleModalTitleSuffix}
                    </h3>
                    <button
                      onClick={closeScheduleModal}
                      style={{
                        border: 'none',
                        background: 'transparent',
                        cursor: 'pointer',
                        padding: '8px',
                        borderRadius: '4px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center'
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#f3f4f6'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                    >
                      <FiX size={24} />
                    </button>
                  </div>

                  <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '24px' }}>
                    {/* Start Time */}
                    <div>
                      <label style={{ display: 'block', marginBottom: '8px', fontWeight: '600', fontSize: '14px', color: TavariStyles.colors.gray900 }}>
                        Start Time
                      </label>
                      <BookingTimeSlotSelect
                        value={scheduleFormData.startTime}
                        onChange={(startTime) => setScheduleFormData((prev) => ({ ...prev, startTime }))}
                        operatingHours={operatingHours}
                        dayKey={scheduleModalDayKey}
                        format="display"
                        placeholder="Select start time…"
                        style={{
                          width: '100%',
                          padding: '12px',
                          border: '1px solid #e5e7eb',
                          borderRadius: '8px',
                          fontSize: '16px',
                          boxSizing: 'border-box'
                        }}
                      />
                      <div style={{ fontSize: '13px', color: TavariStyles.colors.gray500, marginTop: '4px' }}>
                        Times every 15 minutes, from 3 hours before open until 3 hours after close (Settings → Operating Hours).
                      </div>
                    </div>

                    {/* Resources */}
                    <div>
                      <label style={{ display: 'block', marginBottom: '8px', fontWeight: '600', fontSize: '14px', color: TavariStyles.colors.gray900 }}>
                        Resources
                      </label>
                      <div style={{ marginBottom: 16 }}>
                        <TavariCheckbox
                          id="schedule-facility-lock"
                          checked={isFacilityLockEnabled()}
                          onChange={(next) => setFacilityLockEnabled(!!next)}
                          label="Lock entire facility (blocks all resources for overlapping times — e.g. Private Facility)"
                          size="md"
                        />
                        {isFacilityLockEnabled() && (
                          <div style={{ marginTop: 6, fontSize: 13, color: TavariStyles.colors.gray600 }}>
                            Every resource in every category is claimed when this slot is booked (parties, drop-in play, etc.).
                          </div>
                        )}
                      </div>
                      {getResources().map((category) => {
                        const assignmentMode = getResourceAssignmentMode(category.categoryId);
                        const poolValue = scheduleFormData.resources?.[category.categoryId];
                        const poolCount =
                          assignmentMode === 'pool' && poolValue && typeof poolValue === 'object'
                            ? Number(poolValue.count) || 1
                            : 1;
                        const poolIds =
                          assignmentMode === 'pool' && poolValue && typeof poolValue === 'object' && Array.isArray(poolValue.pool)
                            ? poolValue.pool
                            : [];
                        const possibleCombos =
                          assignmentMode === 'pool' && poolCount > 1 && poolIds.length >= poolCount
                            ? listCombinationsOfSize(poolIds, poolCount)
                            : [];
                        const resourceNameById = Object.fromEntries(
                          (category.resources || []).map((resource) => [resource.id, resource.name]),
                        );
                        return (
                        <div key={category.categoryId} style={{ marginBottom: '20px', opacity: isFacilityLockEnabled() ? 0.65 : 1 }}>
                          <div style={{ fontSize: '13px', fontWeight: '600', marginBottom: '8px', color: TavariStyles.colors.gray700 }}>
                            {category.categoryName}
                          </div>
                          <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
                            <button
                              type="button"
                              disabled={isFacilityLockEnabled()}
                              onClick={() => setResourceAssignmentMode(category.categoryId, 'fixed')}
                              style={{
                                padding: '6px 10px',
                                borderRadius: 6,
                                border: `1px solid ${assignmentMode === 'fixed' ? TavariStyles.colors.primary : '#d1d5db'}`,
                                background: assignmentMode === 'fixed' ? `${TavariStyles.colors.primary}15` : '#fff',
                                fontWeight: 600,
                                fontSize: 13,
                                cursor: isFacilityLockEnabled() ? 'not-allowed' : 'pointer',
                              }}
                            >
                              Specific rooms (all required)
                            </button>
                            <button
                              type="button"
                              disabled={isFacilityLockEnabled()}
                              onClick={() => setResourceAssignmentMode(category.categoryId, 'pool')}
                              style={{
                                padding: '6px 10px',
                                borderRadius: 6,
                                border: `1px solid ${assignmentMode === 'pool' ? TavariStyles.colors.primary : '#d1d5db'}`,
                                background: assignmentMode === 'pool' ? `${TavariStyles.colors.primary}15` : '#fff',
                                fontWeight: 600,
                                fontSize: 13,
                                cursor: isFacilityLockEnabled() ? 'not-allowed' : 'pointer',
                              }}
                            >
                              Auto-assign from pool
                            </button>
                          </div>
                          {assignmentMode === 'pool' && (
                            <div style={{ marginBottom: 10, fontSize: 13, color: TavariStyles.colors.gray600 }}>
                              Require{' '}
                              <input
                                type="number"
                                min={1}
                                max={Math.max(1, category.resources?.length || 1)}
                                value={poolCount}
                                disabled={isFacilityLockEnabled()}
                                onChange={(e) => setResourcePoolCount(category.categoryId, e.target.value)}
                                style={{ width: 56, padding: '4px 6px', margin: '0 4px', borderRadius: 4, border: '1px solid #d1d5db' }}
                              />
                              of the selected rooms. System auto-picks a free allowed combination.
                            </div>
                          )}
                          <div style={{
                            border: '1px solid #e5e7eb',
                            borderRadius: '6px',
                            padding: '12px',
                            backgroundColor: '#f9fafb'
                          }}>
                            {category.resources && category.resources.length > 0 ? (
                              category.resources.map((resource) => (
                                <div
                                  key={resource.id}
                                  style={{
                                    marginBottom: '8px',
                                    padding: '6px',
                                    borderRadius: '4px',
                                    transition: 'background-color 0.2s'
                                  }}
                                  onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#f3f4f6'}
                                  onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                                >
                                  <TavariCheckbox
                                    checked={isResourceSelected(category.categoryId, resource.id)}
                                    onChange={() => {
                                      if (isFacilityLockEnabled()) return;
                                      handleResourceChange(category.categoryId, resource.id);
                                    }}
                                    label={resource.name}
                                    size="md"
                                  />
                                </div>
                              ))
                            ) : (
                              <div style={{ fontSize: '13px', color: TavariStyles.colors.gray500, fontStyle: 'italic' }}>
                                No resources in this category
                              </div>
                            )}
                          </div>
                          {possibleCombos.length > 0 && !isFacilityLockEnabled() && (
                            <div style={{ marginTop: 12 }}>
                              <div style={{ fontSize: 13, fontWeight: 600, color: TavariStyles.colors.gray700, marginBottom: 6 }}>
                                Allowed combinations
                              </div>
                              <div style={{ fontSize: 13, color: TavariStyles.colors.gray600, marginBottom: 8 }}>
                                Uncheck pairs that cannot run together (e.g. rooms that are not adjacent). Leave all checked to allow any combination of {poolCount}.
                              </div>
                              <div style={{
                                border: '1px solid #e5e7eb',
                                borderRadius: 6,
                                padding: 12,
                                backgroundColor: '#fff',
                              }}
                              >
                                {possibleCombos.map((combo) => {
                                  const label = combo
                                    .map((id) => resourceNameById[id] || id)
                                    .join(' + ');
                                  return (
                                    <div key={normalizeCombinationKey(combo)} style={{ marginBottom: 8 }}>
                                      <TavariCheckbox
                                        checked={isPoolCombinationSelected(category.categoryId, combo)}
                                        onChange={() => togglePoolCombination(category.categoryId, combo)}
                                        label={label}
                                        size="md"
                                      />
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                        </div>
                        );
                      })}
                      {getResources().length === 0 && (
                        <div style={{
                          padding: '20px',
                          border: '1px dashed #e5e7eb',
                          borderRadius: '8px',
                          textAlign: 'center',
                          color: TavariStyles.colors.gray500,
                          fontSize: '14px'
                        }}>
                          No resources available. Add resources in the Resources tab.
                        </div>
                      )}
                    </div>

                    {/* Spaces */}
                    <div>
                      <label style={{ display: 'block', marginBottom: '8px', fontWeight: '600', fontSize: '14px', color: TavariStyles.colors.gray900 }}>
                        Spaces
                      </label>
                      <input
                        type="number"
                        value={scheduleFormData.spaces}
                        onChange={(e) => {
                          const value = e.target.value;
                          if (value === '' || /^\d+$/.test(value)) {
                            setScheduleFormData(prev => ({ ...prev, spaces: value }));
                          }
                        }}
                        placeholder="e.g., 10"
                        min="1"
                        style={{
                          width: '100%',
                          padding: '12px',
                          border: '1px solid #e5e7eb',
                          borderRadius: '8px',
                          fontSize: '16px',
                          boxSizing: 'border-box'
                        }}
                      />
                      <div style={{ fontSize: '13px', color: TavariStyles.colors.gray500, marginTop: '4px' }}>
                        Number of bookings that can be created at the same time
                      </div>
                    </div>

                  </div>

                  <div style={{
                    padding: '20px 24px',
                    borderTop: '1px solid #e5e7eb',
                    display: 'flex',
                    justifyContent: 'flex-end',
                    gap: '12px'
                  }}>
                    <button
                      onClick={closeScheduleModal}
                      style={{
                        padding: '10px 20px',
                        backgroundColor: TavariStyles.colors.gray700,
                        color: 'white',
                        border: 'none',
                        borderRadius: '8px',
                        fontSize: '14px',
                        fontWeight: '600',
                        cursor: 'pointer'
                      }}
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleSaveScheduleTimeSlot}
                      disabled={!scheduleFormData.startTime.trim() || !scheduleFormData.spaces}
                      style={{
                        padding: '10px 20px',
                        backgroundColor: !scheduleFormData.startTime.trim() || !scheduleFormData.spaces ? '#ccc' : TavariStyles.colors.primary,
                        color: 'white',
                        border: 'none',
                        borderRadius: '8px',
                        fontSize: '14px',
                        fontWeight: '600',
                        cursor: !scheduleFormData.startTime.trim() || !scheduleFormData.spaces ? 'not-allowed' : 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px'
                      }}
                    >
                      <FiSave size={16} />
                      {editingSlotIndex !== null ? 'Save Changes' : 'Add Time Slot'}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        );

      case 'resources':
        return (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
              <h2 style={{ fontSize: '24px', fontWeight: '600', margin: 0 }}>
                Resources
              </h2>
              <button
                onClick={() => handleOpenResourceCategoryModal()}
                style={{
                  padding: '10px 20px',
                  backgroundColor: TavariStyles.colors.primary,
                  color: 'white',
                  border: 'none',
                  borderRadius: '8px',
                  fontSize: '14px',
                  fontWeight: '600',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px'
                }}
              >
                <FiPlus size={16} />
                Add Category
              </button>
            </div>

            <p style={{ fontSize: '14px', color: TavariStyles.colors.gray600, margin: '0 0 20px', lineHeight: 1.6, maxWidth: '760px' }}>
              Configure rooms and equipment used by bookings. Set turnover padding on each category (or per resource) so cleanup/setup time is blocked between parties.
            </p>

            {resources.length === 0 ? (
              <div style={{
                padding: '60px 40px',
                textAlign: 'center',
                color: TavariStyles.colors.gray600,
                border: '1px dashed #e5e7eb',
                borderRadius: '12px'
              }}>
                <div style={{ fontSize: '18px', fontWeight: '600', marginBottom: '8px' }}>
                  No Resource Categories
                </div>
                <div style={{ fontSize: '14px', marginBottom: '20px' }}>
                  Create resource categories (e.g., Party Rooms, Equipment) and add resources to each category.
                </div>
                <button
                  onClick={() => handleOpenResourceCategoryModal()}
                  style={{
                    padding: '10px 20px',
                    backgroundColor: TavariStyles.colors.primary,
                    color: 'white',
                    border: 'none',
                    borderRadius: '8px',
                    fontSize: '14px',
                    fontWeight: '600',
                    cursor: 'pointer'
                  }}
                >
                  Add Your First Category
                </button>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                {resources.map((category) => (
                  <div
                    key={category.categoryId}
                    style={{
                      border: '1px solid #e5e7eb',
                      borderRadius: '12px',
                      padding: '20px',
                      backgroundColor: 'white'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                      <div>
                        <h3 style={{ fontSize: '18px', fontWeight: '600', margin: 0 }}>
                          {category.categoryName}
                        </h3>
                        <div style={{ fontSize: '13px', color: TavariStyles.colors.gray600, marginTop: '4px' }}>
                          Category default: {formatResourcePaddingSummary({
                            beforeMinutes: parsePaddingMinutes(category.defaultPaddingBeforeMinutes, 0),
                            afterMinutes: parsePaddingMinutes(category.defaultPaddingAfterMinutes, 30),
                            cumulativePadding: !!category.cumulativePadding,
                          }, { compact: true })}
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button
                          onClick={() => handleOpenResourceModal(category)}
                          style={{
                            padding: '6px 12px',
                            backgroundColor: TavariStyles.colors.primary,
                            color: 'white',
                            border: 'none',
                            borderRadius: '6px',
                            fontSize: '13px',
                            fontWeight: '600',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px'
                          }}
                        >
                          <FiPlus size={14} />
                          Add Resource
                        </button>
                        <button
                          onClick={() => handleOpenResourceCategoryModal(category)}
                          style={{
                            padding: '6px 12px',
                            backgroundColor: TavariStyles.colors.gray200,
                            color: TavariStyles.colors.gray900,
                            border: 'none',
                            borderRadius: '6px',
                            fontSize: '13px',
                            fontWeight: '600',
                            cursor: 'pointer'
                          }}
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => {
                            if (window.confirm(`Delete category "${category.categoryName}" and all its resources?`)) {
                              handleDeleteResourceCategory(category.categoryId);
                            }
                          }}
                          style={{
                            padding: '6px 12px',
                            backgroundColor: '#fee2e2',
                            color: '#dc2626',
                            border: 'none',
                            borderRadius: '6px',
                            fontSize: '13px',
                            fontWeight: '600',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px'
                          }}
                        >
                          <FiTrash2 size={14} />
                          Delete
                        </button>
                      </div>
                    </div>

                    {category.resources.length === 0 ? (
                      <div style={{
                        padding: '20px',
                        textAlign: 'center',
                        color: TavariStyles.colors.gray500,
                        fontSize: '14px',
                        border: '1px dashed #e5e7eb',
                        borderRadius: '8px'
                      }}>
                        No resources in this category. Click "Add Resource" to add one.
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {category.resources.map((resource) => (
                          <div
                            key={resource.id}
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              padding: '12px',
                              backgroundColor: TavariStyles.colors.gray50,
                              borderRadius: '8px',
                              border: '1px solid #e5e7eb'
                            }}
                          >
                            <div>
                              <span style={{ fontSize: '14px', fontWeight: '500', display: 'block' }}>
                                {resource.name}
                              </span>
                              <span style={{ fontSize: '13px', color: TavariStyles.colors.gray600 }}>
                                {formatResourceQuantitySummary(resource.quantity)}
                                {' · '}
                                {formatResourcePaddingSummary(resolveResourcePadding(resource, category), { compact: true })}
                              </span>
                            </div>
                            <div style={{ display: 'flex', gap: '8px' }}>
                              <button
                                onClick={() => handleOpenResourceModal(category, resource)}
                                style={{
                                  padding: '4px 8px',
                                  backgroundColor: 'white',
                                  color: TavariStyles.colors.gray800,
                                  border: '1px solid #e5e7eb',
                                  borderRadius: '6px',
                                  fontSize: '13px',
                                  cursor: 'pointer',
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '4px'
                                }}
                              >
                                <FiEdit size={12} />
                                Edit
                              </button>
                            <button
                              onClick={() => {
                                if (window.confirm(`Delete resource "${resource.name}"?`)) {
                                  handleDeleteResource(category.categoryId, resource.id);
                                }
                              }}
                              style={{
                                padding: '4px 8px',
                                backgroundColor: 'transparent',
                                color: '#dc2626',
                                border: '1px solid #fee2e2',
                                borderRadius: '6px',
                                fontSize: '13px',
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '4px'
                              }}
                            >
                              <FiTrash2 size={12} />
                              Delete
                            </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Resource Category Modal */}
            {showResourceCategoryModal && (
              <div
                style={{
                  position: 'fixed',
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  backgroundColor: 'rgba(0, 0, 0, 0.5)',
                  zIndex: 200,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '20px'
                }}
                onClick={() => {
                  setShowResourceCategoryModal(false);
                  setEditingResourceCategory(null);
                  setResourceCategoryName('');
                  setResourceCategoryId('');
                }}
              >
                <div
                  style={{
                    backgroundColor: 'white',
                    borderRadius: '12px',
                    maxWidth: '500px',
                    width: '100%',
                    boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)'
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <div style={{
                    padding: '20px 24px',
                    borderBottom: '1px solid #e5e7eb',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center'
                  }}>
                    <h3 style={{ fontSize: '20px', fontWeight: '600', margin: 0 }}>
                      {editingResourceCategory ? 'Edit Category' : 'Add Category'}
                    </h3>
                    <button
                      onClick={() => {
                        setShowResourceCategoryModal(false);
                        setEditingResourceCategory(null);
                        setResourceCategoryName('');
                        setResourceCategoryId('');
                      }}
                      style={{
                        border: 'none',
                        background: 'transparent',
                        cursor: 'pointer',
                        padding: '8px',
                        borderRadius: '4px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center'
                      }}
                    >
                      <FiX size={24} />
                    </button>
                  </div>

                  <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
                    <div>
                      <label style={{ display: 'block', marginBottom: '8px', fontWeight: '600', fontSize: '14px', color: TavariStyles.colors.gray900 }}>
                        Category Name
                      </label>
                      <input
                        type="text"
                        value={resourceCategoryName}
                        onChange={(e) => setResourceCategoryName(e.target.value)}
                        placeholder="e.g., Party Rooms, Equipment"
                        style={{
                          width: '100%',
                          padding: '12px',
                          border: '1px solid #e5e7eb',
                          borderRadius: '8px',
                          fontSize: '16px',
                          boxSizing: 'border-box'
                        }}
                      />
                    </div>

                    <div
                      style={{
                        padding: '16px',
                        borderRadius: '8px',
                        border: '1px solid #e5e7eb',
                        backgroundColor: TavariStyles.colors.gray50,
                      }}
                    >
                      <div style={{ fontSize: '14px', fontWeight: '600', color: TavariStyles.colors.gray900, marginBottom: '8px' }}>
                        Turnover padding (category default)
                      </div>
                      <p style={{ fontSize: '13px', color: TavariStyles.colors.gray600, margin: '0 0 12px', lineHeight: 1.5 }}>
                        Extra time blocked before and after each booking on resources in this category (for setup and cleanup).
                      </p>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                        <div>
                          <label style={{ display: 'block', marginBottom: '6px', fontWeight: '600', fontSize: '13px', color: TavariStyles.colors.gray800 }}>
                            Setup before (minutes)
                          </label>
                          <input
                            type="number"
                            min="0"
                            step="5"
                            value={categoryPaddingBeforeMinutes}
                            onChange={(e) => setCategoryPaddingBeforeMinutes(e.target.value)}
                            style={{
                              width: '100%',
                              padding: '10px 12px',
                              border: '1px solid #e5e7eb',
                              borderRadius: '8px',
                              fontSize: '14px',
                              boxSizing: 'border-box',
                            }}
                          />
                        </div>
                        <div>
                          <label style={{ display: 'block', marginBottom: '6px', fontWeight: '600', fontSize: '13px', color: TavariStyles.colors.gray800 }}>
                            Cleanup after (minutes)
                          </label>
                          <input
                            type="number"
                            min="0"
                            step="5"
                            value={categoryPaddingAfterMinutes}
                            onChange={(e) => setCategoryPaddingAfterMinutes(e.target.value)}
                            style={{
                              width: '100%',
                              padding: '10px 12px',
                              border: '1px solid #e5e7eb',
                              borderRadius: '8px',
                              fontSize: '14px',
                              boxSizing: 'border-box',
                            }}
                          />
                        </div>
                      </div>
                      <div style={{ marginTop: '14px' }}>
                        <TavariCheckbox
                          checked={categoryCumulativePadding}
                          onChange={(checked) => setCategoryCumulativePadding(!!checked)}
                          label="Cumulative turnover between bookings"
                          size="sm"
                        />
                        <p style={{ fontSize: '13px', color: TavariStyles.colors.gray600, margin: '8px 0 0 28px', lineHeight: 1.5 }}>
                          Checked: setup + cleanup are added between back-to-back parties (15 + 30 = 45 min).
                          Unchecked: only the longer value applies between parties (max 30 min). Setup before the first party and cleanup after the last still apply.
                        </p>
                      </div>
                    </div>
                  </div>

                  <div style={{
                    padding: '20px 24px',
                    borderTop: '1px solid #e5e7eb',
                    display: 'flex',
                    justifyContent: 'flex-end',
                    gap: '12px'
                  }}>
                    <button
                      onClick={() => {
                        setShowResourceCategoryModal(false);
                        setEditingResourceCategory(null);
                        setResourceCategoryName('');
                        setResourceCategoryId('');
                      }}
                      style={{
                        padding: '10px 20px',
                        backgroundColor: TavariStyles.colors.gray200,
                        color: TavariStyles.colors.gray900,
                        border: 'none',
                        borderRadius: '8px',
                        fontSize: '14px',
                        fontWeight: '600',
                        cursor: 'pointer'
                      }}
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleSaveResourceCategory}
                      disabled={!resourceCategoryName.trim() || saving}
                      style={{
                        padding: '10px 20px',
                        backgroundColor: TavariStyles.colors.primary,
                        color: 'white',
                        border: 'none',
                        borderRadius: '8px',
                        fontSize: '14px',
                        fontWeight: '600',
                        cursor: !resourceCategoryName.trim() || saving ? 'not-allowed' : 'pointer',
                        opacity: !resourceCategoryName.trim() || saving ? 0.6 : 1,
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px'
                      }}
                    >
                      <FiSave size={16} />
                      {saving ? 'Saving...' : 'Save'}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Resource Modal */}
            {showResourceModal && selectedResourceCategory && (
              <div
                style={{
                  position: 'fixed',
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  backgroundColor: 'rgba(0, 0, 0, 0.5)',
                  zIndex: 200,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '20px'
                }}
                onClick={() => {
                  setShowResourceModal(false);
                  setEditingResource(null);
                  setResourceName('');
                  setResourceId('');
                  setResourceQuantity('');
                  setSelectedResourceCategory(null);
                }}
              >
                <div
                  style={{
                    backgroundColor: 'white',
                    borderRadius: '12px',
                    maxWidth: '500px',
                    width: '100%',
                    boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)'
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <div style={{
                    padding: '20px 24px',
                    borderBottom: '1px solid #e5e7eb',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center'
                  }}>
                    <h3 style={{ fontSize: '20px', fontWeight: '600', margin: 0 }}>
                      {editingResource ? 'Edit Resource' : 'Add Resource'} - {selectedResourceCategory.categoryName}
                    </h3>
                    <button
                      onClick={() => {
                        setShowResourceModal(false);
                        setEditingResource(null);
                        setResourceName('');
                        setResourceId('');
                        setSelectedResourceCategory(null);
                      }}
                      style={{
                        border: 'none',
                        background: 'transparent',
                        cursor: 'pointer',
                        padding: '8px',
                        borderRadius: '4px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center'
                      }}
                    >
                      <FiX size={24} />
                    </button>
                  </div>

                  <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
                    <div>
                      <label style={{ display: 'block', marginBottom: '8px', fontWeight: '600', fontSize: '14px', color: TavariStyles.colors.gray900 }}>
                        Resource Name
                      </label>
                      <input
                        type="text"
                        value={resourceName}
                        onChange={(e) => setResourceName(e.target.value)}
                        placeholder="e.g., Red Room, Projector A"
                        style={{
                          width: '100%',
                          padding: '12px',
                          border: '1px solid #e5e7eb',
                          borderRadius: '8px',
                          fontSize: '16px',
                          boxSizing: 'border-box'
                        }}
                      />
                    </div>

                    <div>
                      <label style={{ display: 'block', marginBottom: '8px', fontWeight: '600', fontSize: '14px', color: TavariStyles.colors.gray900 }}>
                        Concurrent capacity
                      </label>
                      <input
                        type="number"
                        min="1"
                        step="1"
                        value={resourceQuantity}
                        onChange={(e) => setResourceQuantity(e.target.value)}
                        placeholder="1 (exclusive — one booking at a time)"
                        style={{
                          width: '100%',
                          padding: '12px',
                          border: '1px solid #e5e7eb',
                          borderRadius: '8px',
                          fontSize: '16px',
                          boxSizing: 'border-box',
                        }}
                      />
                      <p style={{ fontSize: '13px', color: TavariStyles.colors.gray600, margin: '8px 0 0', lineHeight: 1.5 }}>
                        Leave blank for exclusive use (e.g. a party room). Set to 2 or more only if this resource can host multiple bookings at the same time.
                      </p>
                    </div>

                    <div
                      style={{
                        padding: '16px',
                        borderRadius: '8px',
                        border: '1px solid #e5e7eb',
                        backgroundColor: TavariStyles.colors.gray50,
                      }}
                    >
                      <div style={{ fontSize: '14px', fontWeight: '600', color: TavariStyles.colors.gray900, marginBottom: '8px' }}>
                        Turnover padding
                      </div>
                      <p style={{ fontSize: '13px', color: TavariStyles.colors.gray600, margin: '0 0 12px', lineHeight: 1.5 }}>
                        Leave blank to use the category default (
                        {formatResourcePaddingSummary({
                          beforeMinutes: parsePaddingMinutes(selectedResourceCategory?.defaultPaddingBeforeMinutes, 0),
                          afterMinutes: parsePaddingMinutes(selectedResourceCategory?.defaultPaddingAfterMinutes, 30),
                        }, { compact: true })}
                        ).
                      </p>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                        <div>
                          <label style={{ display: 'block', marginBottom: '6px', fontWeight: '600', fontSize: '13px', color: TavariStyles.colors.gray800 }}>
                            Setup before (minutes)
                          </label>
                          <input
                            type="number"
                            min="0"
                            step="5"
                            value={resourcePaddingBeforeMinutes}
                            onChange={(e) => setResourcePaddingBeforeMinutes(e.target.value)}
                            placeholder={`Default: ${parsePaddingMinutes(selectedResourceCategory?.defaultPaddingBeforeMinutes, 0)}`}
                            style={{
                              width: '100%',
                              padding: '10px 12px',
                              border: '1px solid #e5e7eb',
                              borderRadius: '8px',
                              fontSize: '14px',
                              boxSizing: 'border-box',
                            }}
                          />
                        </div>
                        <div>
                          <label style={{ display: 'block', marginBottom: '6px', fontWeight: '600', fontSize: '13px', color: TavariStyles.colors.gray800 }}>
                            Cleanup after (minutes)
                          </label>
                          <input
                            type="number"
                            min="0"
                            step="5"
                            value={resourcePaddingAfterMinutes}
                            onChange={(e) => setResourcePaddingAfterMinutes(e.target.value)}
                            placeholder={`Default: ${parsePaddingMinutes(selectedResourceCategory?.defaultPaddingAfterMinutes, 30)}`}
                            style={{
                              width: '100%',
                              padding: '10px 12px',
                              border: '1px solid #e5e7eb',
                              borderRadius: '8px',
                              fontSize: '14px',
                              boxSizing: 'border-box',
                            }}
                          />
                        </div>
                      </div>
                      <div style={{ marginTop: '14px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                        <TavariCheckbox
                          checked={resourceUseCategoryCumulativeDefault}
                          onChange={(checked) => setResourceUseCategoryCumulativeDefault(!!checked)}
                          label="Use category cumulative setting"
                          size="sm"
                        />
                        {!resourceUseCategoryCumulativeDefault ? (
                          <div style={{ marginLeft: '28px' }}>
                            <TavariCheckbox
                              checked={resourceCumulativePadding}
                              onChange={(checked) => setResourceCumulativePadding(!!checked)}
                              label="Cumulative turnover between bookings"
                              size="sm"
                            />
                          </div>
                        ) : (
                          <p style={{ fontSize: '13px', color: TavariStyles.colors.gray600, margin: '0 0 0 28px', lineHeight: 1.5 }}>
                            Currently: {selectedResourceCategory?.cumulativePadding
                              ? 'setup + cleanup between parties (cumulative)'
                              : 'only the longer of setup or cleanup between parties (max gap)'}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>

                  <div style={{
                    padding: '20px 24px',
                    borderTop: '1px solid #e5e7eb',
                    display: 'flex',
                    justifyContent: 'flex-end',
                    gap: '12px'
                  }}>
                    <button
                      onClick={() => {
                        setShowResourceModal(false);
                        setEditingResource(null);
                        setResourceName('');
                        setResourceId('');
                        setResourcePaddingBeforeMinutes('');
                        setResourcePaddingAfterMinutes('');
                        setResourceUseCategoryCumulativeDefault(true);
                        setResourceCumulativePadding(false);
                        setSelectedResourceCategory(null);
                      }}
                      style={{
                        padding: '10px 20px',
                        backgroundColor: TavariStyles.colors.gray200,
                        color: TavariStyles.colors.gray900,
                        border: 'none',
                        borderRadius: '8px',
                        fontSize: '14px',
                        fontWeight: '600',
                        cursor: 'pointer'
                      }}
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleSaveResource}
                      disabled={!resourceName.trim() || !selectedResourceCategory || saving}
                      style={{
                        padding: '10px 20px',
                        backgroundColor: TavariStyles.colors.primary,
                        color: 'white',
                        border: 'none',
                        borderRadius: '8px',
                        fontSize: '14px',
                        fontWeight: '600',
                        cursor: !resourceName.trim() || !selectedResourceCategory || saving ? 'not-allowed' : 'pointer',
                        opacity: !resourceName.trim() || !selectedResourceCategory || saving ? 0.6 : 1,
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px'
                      }}
                    >
                      <FiSave size={16} />
                      {saving ? 'Saving...' : 'Save'}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        );

      case 'pricing':
        return (
          <div>
            <h2 style={{ fontSize: '24px', fontWeight: '600', marginBottom: '24px' }}>
              Pricing & Promotions
            </h2>
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '16px',
              marginTop: '24px'
            }}>
              {/* Seasonal Pricing Card */}
              <div
                onClick={() => setShowSeasonalPricingModal(true)}
                style={{
                  backgroundColor: 'white',
                  border: `1px solid ${TavariStyles.colors.gray200}`,
                  borderRadius: '12px',
                  padding: '24px',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                  boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.15)';
                  e.currentTarget.style.transform = 'translateY(-2px)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.boxShadow = '0 1px 3px rgba(0, 0, 0, 0.1)';
                  e.currentTarget.style.transform = 'translateY(0)';
                }}
              >
                <div style={{
                  fontSize: '20px',
                  fontWeight: '600',
                  color: TavariStyles.colors.gray900,
                  marginBottom: '12px'
                }}>
                  Seasonal Pricing
                </div>
                <div style={{
                  fontSize: '14px',
                  color: TavariStyles.colors.gray600,
                  lineHeight: '1.5'
                }}>
                  Set up different pricing based on seasons, holidays, or date ranges
                </div>
              </div>

              {/* Promotions Card */}
              <div
                onClick={() => setShowPromotionsModal(true)}
                style={{
                  backgroundColor: 'white',
                  border: `1px solid ${TavariStyles.colors.gray200}`,
                  borderRadius: '12px',
                  padding: '24px',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                  boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.15)';
                  e.currentTarget.style.transform = 'translateY(-2px)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.boxShadow = '0 1px 3px rgba(0, 0, 0, 0.1)';
                  e.currentTarget.style.transform = 'translateY(0)';
                }}
              >
                <div style={{
                  fontSize: '20px',
                  fontWeight: '600',
                  color: TavariStyles.colors.gray900,
                  marginBottom: '12px'
                }}>
                  Promotions
                </div>
                <div style={{
                  fontSize: '14px',
                  color: TavariStyles.colors.gray600,
                  lineHeight: '1.5'
                }}>
                  Create and manage time-based pricing, promo codes, and special offers
                </div>
              </div>
            </div>

            {/* Seasonal Pricing Modal */}
            {showSeasonalPricingModal && (
              <div
                style={{
                  position: 'fixed',
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  backgroundColor: 'rgba(0, 0, 0, 0.5)',
                  zIndex: 100,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '20px'
                }}
                onClick={() => setShowSeasonalPricingModal(false)}
              >
                <div
                  style={{
                    backgroundColor: 'white',
                    borderRadius: '12px',
                    maxWidth: '500px',
                    width: '100%',
                    maxHeight: '90vh',
                    overflow: 'auto',
                    boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)'
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <div style={{
                    padding: '20px 24px',
                    borderBottom: '1px solid #e5e7eb',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center'
                  }}>
                    <h3 style={{ fontSize: '20px', fontWeight: '600', margin: 0 }}>
                      Seasonal Pricing
                    </h3>
                    <button
                      onClick={() => setShowSeasonalPricingModal(false)}
                      style={{
                        border: 'none',
                        background: 'transparent',
                        cursor: 'pointer',
                        padding: '8px',
                        borderRadius: '4px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center'
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#f3f4f6'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                    >
                      <FiX size={24} />
                    </button>
                  </div>
                  <div style={{ padding: '24px' }}>
                    {/* Add Period Button */}
                    <button
                      onClick={() => {
                        setShowAddSeasonalPeriod(true);
                        setNewSeasonalPeriodName('');
                        setNewSeasonalPeriodStartDate('');
                        setNewSeasonalPeriodEndDate('');
                        setNewSeasonalPeriodStartTime('');
                        setNewSeasonalPeriodEndTime('');
                        setNewSeasonalPeriodFullDay(true);
                      }}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        padding: '10px 16px',
                        backgroundColor: TavariStyles.colors.primary,
                        color: 'white',
                        border: 'none',
                        borderRadius: '8px',
                        fontSize: '14px',
                        fontWeight: '600',
                        cursor: 'pointer',
                        marginBottom: '20px',
                        width: '100%',
                        justifyContent: 'center'
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.9'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.opacity = '1'; }}
                    >
                      <FiPlus size={18} />
                      Add Seasonal Period
                    </button>

                    {/* Add Period Form */}
                    {showAddSeasonalPeriod && (
                      <div style={{
                        marginBottom: '20px',
                        padding: '16px',
                        backgroundColor: '#f9fafb',
                        borderRadius: '8px',
                        border: `1px solid ${TavariStyles.colors.gray200}`
                      }}>
                        <input
                          type="text"
                          value={newSeasonalPeriodName}
                          onChange={(e) => setNewSeasonalPeriodName(e.target.value)}
                          placeholder="Enter period name (e.g., Summer, Holiday Season)"
                          style={{
                            width: '100%',
                            padding: '10px 12px',
                            border: `1px solid ${TavariStyles.colors.gray300}`,
                            borderRadius: '6px',
                            fontSize: '14px',
                            marginBottom: '12px',
                            boxSizing: 'border-box'
                          }}
                          autoFocus
                        />
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
                          <div>
                            <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', color: TavariStyles.colors.gray700, marginBottom: '4px' }}>
                              Start Date
                            </label>
                            <input
                              type="date"
                              value={newSeasonalPeriodStartDate}
                              onChange={(e) => setNewSeasonalPeriodStartDate(e.target.value)}
                              style={{
                                width: '100%',
                                padding: '10px 12px',
                                border: `1px solid ${TavariStyles.colors.gray300}`,
                                borderRadius: '6px',
                                fontSize: '14px',
                                boxSizing: 'border-box'
                              }}
                            />
                          </div>
                          <div>
                            <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', color: TavariStyles.colors.gray700, marginBottom: '4px' }}>
                              End Date
                            </label>
                            <input
                              type="date"
                              value={newSeasonalPeriodEndDate}
                              onChange={(e) => setNewSeasonalPeriodEndDate(e.target.value)}
                              style={{
                                width: '100%',
                                padding: '10px 12px',
                                border: `1px solid ${TavariStyles.colors.gray300}`,
                                borderRadius: '6px',
                                fontSize: '14px',
                                boxSizing: 'border-box'
                              }}
                            />
                          </div>
                        </div>
                        <div style={{ marginBottom: '12px' }}>
                          <TavariCheckbox
                            checked={newSeasonalPeriodFullDay}
                            onChange={(checked) => {
                              setNewSeasonalPeriodFullDay(checked);
                              if (checked) {
                                setNewSeasonalPeriodStartTime('');
                                setNewSeasonalPeriodEndTime('');
                              }
                            }}
                            label="Full Day (all day period)"
                            size="md"
                          />
                        </div>
                        {!newSeasonalPeriodFullDay && (
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
                            <div>
                              <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', color: TavariStyles.colors.gray700, marginBottom: '4px' }}>
                                Start Time
                              </label>
                              <input
                                type="time"
                                value={newSeasonalPeriodStartTime}
                                onChange={(e) => setNewSeasonalPeriodStartTime(e.target.value)}
                                style={{
                                  width: '100%',
                                  padding: '10px 12px',
                                  border: `1px solid ${TavariStyles.colors.gray300}`,
                                  borderRadius: '6px',
                                  fontSize: '14px',
                                  boxSizing: 'border-box'
                                }}
                              />
                            </div>
                            <div>
                              <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', color: TavariStyles.colors.gray700, marginBottom: '4px' }}>
                                End Time
                              </label>
                              <input
                                type="time"
                                value={newSeasonalPeriodEndTime}
                                onChange={(e) => setNewSeasonalPeriodEndTime(e.target.value)}
                                style={{
                                  width: '100%',
                                  padding: '10px 12px',
                                  border: `1px solid ${TavariStyles.colors.gray300}`,
                                  borderRadius: '6px',
                                  fontSize: '14px',
                                  boxSizing: 'border-box'
                                }}
                              />
                            </div>
                          </div>
                        )}
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <button
                            onClick={handleAddSeasonalPeriod}
                            style={{
                              padding: '8px 16px',
                              backgroundColor: TavariStyles.colors.primary,
                              color: 'white',
                              border: 'none',
                              borderRadius: '6px',
                              fontSize: '14px',
                              fontWeight: '600',
                              cursor: 'pointer',
                              flex: 1
                            }}
                          >
                            Save
                          </button>
                          <button
                            onClick={() => {
                              setShowAddSeasonalPeriod(false);
                              setNewSeasonalPeriodName('');
                              setNewSeasonalPeriodStartDate('');
                              setNewSeasonalPeriodEndDate('');
                              setNewSeasonalPeriodStartTime('');
                              setNewSeasonalPeriodEndTime('');
                              setNewSeasonalPeriodFullDay(true);
                            }}
                            style={{
                              padding: '8px 16px',
                              backgroundColor: TavariStyles.colors.gray200,
                              color: TavariStyles.colors.gray700,
                              border: 'none',
                              borderRadius: '6px',
                              fontSize: '14px',
                              fontWeight: '600',
                              cursor: 'pointer',
                              flex: 1
                            }}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Seasonal Periods List */}
                    {seasonalPeriods.length > 0 ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                        {seasonalPeriods.map((period) => (
                          <div
                            key={period.id}
                            onClick={() => {
                              if (editingSeasonalPeriodId !== period.id) {
                                handleEditSeasonalPeriod(period.id);
                              }
                            }}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              padding: '16px',
                              backgroundColor: editingSeasonalPeriodId === period.id ? '#f0f9ff' : 'white',
                              border: `1px solid ${editingSeasonalPeriodId === period.id ? TavariStyles.colors.primary : TavariStyles.colors.gray200}`,
                              borderRadius: '8px',
                              cursor: editingSeasonalPeriodId === period.id ? 'default' : 'pointer',
                              transition: 'all 0.2s'
                            }}
                            onMouseEnter={(e) => {
                              if (editingSeasonalPeriodId !== period.id) {
                                e.currentTarget.style.borderColor = TavariStyles.colors.primary;
                                e.currentTarget.style.backgroundColor = '#f9fafb';
                              }
                            }}
                            onMouseLeave={(e) => {
                              if (editingSeasonalPeriodId !== period.id) {
                                e.currentTarget.style.borderColor = TavariStyles.colors.gray200;
                                e.currentTarget.style.backgroundColor = 'white';
                              }
                            }}
                          >
                            {editingSeasonalPeriodId === period.id ? (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', flex: 1 }}>
                                <input
                                  type="text"
                                  value={editingSeasonalPeriodName}
                                  onChange={(e) => setEditingSeasonalPeriodName(e.target.value)}
                                  style={{
                                    width: '100%',
                                    padding: '8px 12px',
                                    border: `1px solid ${TavariStyles.colors.gray300}`,
                                    borderRadius: '6px',
                                    fontSize: '14px',
                                    boxSizing: 'border-box'
                                  }}
                                  autoFocus
                                  onClick={(e) => e.stopPropagation()}
                                />
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                                  <div>
                                    <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', color: TavariStyles.colors.gray700, marginBottom: '4px' }}>
                                      Start Date
                                    </label>
                                    <input
                                      type="date"
                                      value={editingSeasonalPeriodStartDate}
                                      onChange={(e) => setEditingSeasonalPeriodStartDate(e.target.value)}
                                      style={{
                                        width: '100%',
                                        padding: '8px 12px',
                                        border: `1px solid ${TavariStyles.colors.gray300}`,
                                        borderRadius: '6px',
                                        fontSize: '14px',
                                        boxSizing: 'border-box'
                                      }}
                                      onClick={(e) => e.stopPropagation()}
                                    />
                                  </div>
                                  <div>
                                    <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', color: TavariStyles.colors.gray700, marginBottom: '4px' }}>
                                      End Date
                                    </label>
                                    <input
                                      type="date"
                                      value={editingSeasonalPeriodEndDate}
                                      onChange={(e) => setEditingSeasonalPeriodEndDate(e.target.value)}
                                      style={{
                                        width: '100%',
                                        padding: '8px 12px',
                                        border: `1px solid ${TavariStyles.colors.gray300}`,
                                        borderRadius: '6px',
                                        fontSize: '14px',
                                        boxSizing: 'border-box'
                                      }}
                                      onClick={(e) => e.stopPropagation()}
                                    />
                                  </div>
                                </div>
                                <div>
                                  <TavariCheckbox
                                    checked={editingSeasonalPeriodFullDay}
                                    onChange={(checked) => {
                                      setEditingSeasonalPeriodFullDay(checked);
                                      if (checked) {
                                        setEditingSeasonalPeriodStartTime('');
                                        setEditingSeasonalPeriodEndTime('');
                                      }
                                    }}
                                    label="Full Day (all day period)"
                                    size="md"
                                  />
                                </div>
                                {!editingSeasonalPeriodFullDay && (
                                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                                    <div>
                                      <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', color: TavariStyles.colors.gray700, marginBottom: '4px' }}>
                                        Start Time
                                      </label>
                                      <input
                                        type="time"
                                        value={editingSeasonalPeriodStartTime}
                                        onChange={(e) => setEditingSeasonalPeriodStartTime(e.target.value)}
                                        style={{
                                          width: '100%',
                                          padding: '8px 12px',
                                          border: `1px solid ${TavariStyles.colors.gray300}`,
                                          borderRadius: '6px',
                                          fontSize: '14px',
                                          boxSizing: 'border-box'
                                        }}
                                        onClick={(e) => e.stopPropagation()}
                                      />
                                    </div>
                                    <div>
                                      <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', color: TavariStyles.colors.gray700, marginBottom: '4px' }}>
                                        End Time
                                      </label>
                                      <input
                                        type="time"
                                        value={editingSeasonalPeriodEndTime}
                                        onChange={(e) => setEditingSeasonalPeriodEndTime(e.target.value)}
                                        style={{
                                          width: '100%',
                                          padding: '8px 12px',
                                          border: `1px solid ${TavariStyles.colors.gray300}`,
                                          borderRadius: '6px',
                                          fontSize: '14px',
                                          boxSizing: 'border-box'
                                        }}
                                        onClick={(e) => e.stopPropagation()}
                                      />
                                    </div>
                                  </div>
                                )}
                                <div style={{ display: 'flex', gap: '8px' }}>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleSaveSeasonalPeriod();
                                    }}
                                    style={{
                                      padding: '8px 16px',
                                      backgroundColor: TavariStyles.colors.primary,
                                      color: 'white',
                                      border: 'none',
                                      borderRadius: '6px',
                                      fontSize: '14px',
                                      fontWeight: '600',
                                      cursor: 'pointer',
                                      flex: 1
                                    }}
                                  >
                                    Save
                                  </button>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setEditingSeasonalPeriodId(null);
                                      setEditingSeasonalPeriodName('');
                                      setEditingSeasonalPeriodStartDate('');
                                      setEditingSeasonalPeriodEndDate('');
                                      setEditingSeasonalPeriodStartTime('');
                                      setEditingSeasonalPeriodEndTime('');
                                      setEditingSeasonalPeriodFullDay(true);
                                    }}
                                    style={{
                                      padding: '8px 16px',
                                      backgroundColor: TavariStyles.colors.gray200,
                                      color: TavariStyles.colors.gray700,
                                      border: 'none',
                                      borderRadius: '6px',
                                      fontSize: '14px',
                                      fontWeight: '600',
                                      cursor: 'pointer',
                                      flex: 1
                                    }}
                                  >
                                    Cancel
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <>
                                <div style={{ flex: 1 }}>
                                  <div style={{
                                    fontSize: '16px',
                                    fontWeight: '500',
                                    color: TavariStyles.colors.gray900,
                                    marginBottom: '4px'
                                  }}>
                                    {period.name}
                                  </div>
                                  <div style={{
                                    fontSize: '13px',
                                    color: TavariStyles.colors.gray600
                                  }}>
                                    {formatDateForBusiness(period.start_date, businessTimezone)} - {formatDateForBusiness(period.end_date, businessTimezone)}
                                    {!period.is_full_day && period.start_time && period.end_time && (
                                      <span style={{ marginLeft: '8px' }}>
                                        ({period.start_time} - {period.end_time})
                                      </span>
                                    )}
                                    {period.is_full_day && (
                                      <span style={{ marginLeft: '8px', fontStyle: 'italic' }}>
                                        (Full Day)
                                      </span>
                                    )}
                                  </div>
                                </div>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (window.confirm(`Are you sure you want to delete "${period.name}"?`)) {
                                      handleDeleteSeasonalPeriod(period.id);
                                    }
                                  }}
                                  style={{
                                    padding: '8px',
                                    backgroundColor: 'transparent',
                                    border: 'none',
                                    color: TavariStyles.colors.red || '#dc2626',
                                    cursor: 'pointer',
                                    borderRadius: '4px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center'
                                  }}
                                  onMouseEnter={(e) => {
                                    e.currentTarget.style.backgroundColor = '#fee2e2';
                                  }}
                                  onMouseLeave={(e) => {
                                    e.currentTarget.style.backgroundColor = 'transparent';
                                  }}
                                >
                                  <FiTrash2 size={18} />
                                </button>
                              </>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div style={{
                        padding: '40px 20px',
                        textAlign: 'center',
                        color: TavariStyles.colors.gray500,
                        fontSize: '14px'
                      }}>
                        No seasonal periods yet. Click "Add Seasonal Period" to create one.
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Promotions Modal */}
            {showPromotionsModal && (
              <div
                style={{
                  position: 'fixed',
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  backgroundColor: 'rgba(0, 0, 0, 0.5)',
                  zIndex: 100,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '20px'
                }}
                onClick={() => {
                  setShowPromotionsModal(false);
                  setShowFreeWithPurchaseView(false);
                  setShowFwpForm(false);
                  cancelFwpForm();
                }}
              >
                <div
                  style={{
                    backgroundColor: 'white',
                    borderRadius: '12px',
                    maxWidth: showFreeWithPurchaseView ? '560px' : '920px',
                    width: '100%',
                    maxHeight: '90vh',
                    overflow: 'auto',
                    boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)'
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <div style={{
                    padding: '20px 24px',
                    borderBottom: '1px solid #e5e7eb',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center'
                  }}>
                    {showFreeWithPurchaseView ? (
                      <>
                        <button
                          onClick={() => {
                            if (showFwpForm) {
                              cancelFwpForm();
                            } else {
                              setShowFreeWithPurchaseView(false);
                            }
                          }}
                          style={{
                            border: 'none',
                            background: 'transparent',
                            cursor: 'pointer',
                            padding: '4px 8px',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px',
                            fontSize: '14px',
                            color: TavariStyles.colors.gray600
                          }}
                          onMouseEnter={(e) => { e.currentTarget.style.color = TavariStyles.colors.gray900; }}
                          onMouseLeave={(e) => { e.currentTarget.style.color = TavariStyles.colors.gray600; }}
                        >
                          <FiArrowLeft size={18} /> Back
                        </button>
                        <h3 style={{ fontSize: '20px', fontWeight: '600', margin: 0 }}>
                          {showFwpForm ? (editingFwpId ? 'Edit' : 'Add') + ' Free with purchase' : 'Free with purchase'}
                        </h3>
                        <button
                          onClick={() => {
                            setShowPromotionsModal(false);
                            setShowFreeWithPurchaseView(false);
                            setShowFwpForm(false);
                            cancelFwpForm();
                          }}
                          style={{
                            border: 'none',
                            background: 'transparent',
                            cursor: 'pointer',
                            padding: '8px',
                            borderRadius: '4px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center'
                          }}
                          onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#f3f4f6'; }}
                          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                        >
                          <FiX size={24} />
                        </button>
                      </>
                    ) : (
                      <>
                        <h3 style={{ fontSize: '20px', fontWeight: '600', margin: 0 }}>Promotions</h3>
                        <button
                          onClick={() => {
                            setShowPromotionsModal(false);
                            setShowFreeWithPurchaseView(false);
                            cancelFwpForm();
                          }}
                          style={{
                            border: 'none',
                            background: 'transparent',
                            cursor: 'pointer',
                            padding: '8px',
                            borderRadius: '4px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center'
                          }}
                          onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#f3f4f6'; }}
                          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                        >
                          <FiX size={24} />
                        </button>
                      </>
                    )}
                  </div>
                  {!showFreeWithPurchaseView ? (
                    <div style={{ padding: '24px' }}>
                      <BookingPricingPromotionsManager
                        businessId={auth.selectedBusinessId}
                        onOpenFreeWithPurchase={() => setShowFreeWithPurchaseView(true)}
                      />
                    </div>
                  ) : showFwpForm ? (
                    <div style={{ padding: '24px' }}>
                      <div style={{ marginBottom: TavariStyles.spacing.lg }}>
                        <label style={{ display: 'block', marginBottom: '6px', fontWeight: '600', fontSize: '14px' }}>Quantity free (per qualifying purchase)</label>
                        <input
                          type="number"
                          min={1}
                          value={fwpForm.quantity === '' ? '' : fwpForm.quantity}
                          onChange={(e) => setFwpForm(prev => ({ ...prev, quantity: e.target.value === '' ? '' : (parseInt(e.target.value, 10) || 1) }))}
                          style={{ width: '80px', padding: '8px 12px', border: `1px solid ${TavariStyles.colors.gray200}`, borderRadius: '8px', fontSize: '14px' }}
                          placeholder="1"
                        />
                      </div>
                      <div style={{ marginBottom: TavariStyles.spacing.lg }}>
                        <label style={{ display: 'block', marginBottom: '6px', fontWeight: '600', fontSize: '14px' }}>Free item (given free) — select one</label>
                        <div style={{ marginBottom: '8px' }}>
                          <select
                            value={fwpForm.free_category_filter}
                            onChange={(e) => setFwpForm(prev => ({ ...prev, free_category_filter: e.target.value }))}
                            style={{ minWidth: '140px', padding: '8px 12px', border: `1px solid ${TavariStyles.colors.gray200}`, borderRadius: '8px', fontSize: '14px' }}
                          >
                            <option value="">All categories</option>
                            {fwpCategories.map(cat => (
                              <option key={cat.id} value={cat.id}>{cat.emoji || ''} {cat.name}</option>
                            ))}
                          </select>
                        </div>
                        <div style={{ maxHeight: '180px', overflowY: 'auto', border: `1px solid ${TavariStyles.colors.gray200}`, borderRadius: '8px', padding: '8px' }}>
                          {fwpInventory
                            .filter(it => !fwpForm.free_category_filter || it.category_id === fwpForm.free_category_filter)
                            .map(it => {
                              const cat = fwpCategories.find(c => c.id === it.category_id);
                              return (
                                <TavariCheckbox
                                  key={it.id}
                                  checked={fwpForm.free_item_id === it.id}
                                  onChange={() => setFwpForm(prev => ({ ...prev, free_item_id: prev.free_item_id === it.id ? null : it.id }))}
                                  label={cat ? `${cat.emoji || ''} ${it.name}` : it.name}
                                  id={`fwp-free-${it.id}`}
                                />
                              );
                            })}
                          {fwpInventory.filter(it => !fwpForm.free_category_filter || it.category_id === fwpForm.free_category_filter).length === 0 && (
                            <span style={{ fontSize: '13px', color: TavariStyles.colors.gray500, fontStyle: 'italic' }}>No items match. Change category or add inventory.</span>
                          )}
                        </div>
                      </div>
                      <div style={{ marginBottom: TavariStyles.spacing.lg }}>
                        <label style={{ display: 'block', marginBottom: '6px', fontWeight: '600', fontSize: '14px' }}>With purchase of (select all that qualify)</label>
                        <div style={{ marginBottom: '8px' }}>
                          <select
                            value={fwpForm.trigger_category_filter}
                            onChange={(e) => setFwpForm(prev => ({ ...prev, trigger_category_filter: e.target.value }))}
                            style={{ minWidth: '140px', padding: '8px 12px', border: `1px solid ${TavariStyles.colors.gray200}`, borderRadius: '8px', fontSize: '14px' }}
                          >
                            <option value="">All categories</option>
                            {fwpCategories.map(cat => (
                              <option key={cat.id} value={cat.id}>{cat.emoji || ''} {cat.name}</option>
                            ))}
                          </select>
                        </div>
                        <div style={{ maxHeight: '180px', overflowY: 'auto', border: `1px solid ${TavariStyles.colors.gray200}`, borderRadius: '8px', padding: '8px' }}>
                          {fwpInventory
                            .filter(it => !fwpForm.trigger_category_filter || it.category_id === fwpForm.trigger_category_filter)
                            .map(it => {
                              const cat = fwpCategories.find(c => c.id === it.category_id);
                              return (
                                <TavariCheckbox
                                  key={it.id}
                                  checked={(fwpForm.trigger_item_ids || []).includes(it.id)}
                                  onChange={() => toggleFwpTriggerItem(it.id)}
                                  label={cat ? `${cat.emoji || ''} ${it.name}` : it.name}
                                  id={`fwp-trigger-${it.id}`}
                                />
                              );
                            })}
                          {fwpInventory.filter(it => !fwpForm.trigger_category_filter || it.category_id === fwpForm.trigger_category_filter).length === 0 && (
                            <span style={{ fontSize: '13px', color: TavariStyles.colors.gray500, fontStyle: 'italic' }}>No items match. Change category or add inventory.</span>
                          )}
                        </div>
                      </div>
                      <p style={{ fontSize: '13px', color: TavariStyles.colors.gray600, marginBottom: '16px' }}>
                        Example: 1 adult ticket free per child ticket — set quantity 1, select Adult ticket as free item, and check Child ticket under &quot;With purchase of&quot;.
                      </p>
                      <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
                        <button
                          onClick={cancelFwpForm}
                          style={{
                            padding: '10px 20px',
                            border: `1px solid ${TavariStyles.colors.gray300}`,
                            borderRadius: '8px',
                            background: 'white',
                            cursor: 'pointer',
                            fontSize: '14px',
                            fontWeight: '500'
                          }}
                        >
                          Cancel
                        </button>
                        <button
                          onClick={saveFwpPromotion}
                          disabled={loadingFwp}
                          style={{
                            padding: '10px 20px',
                            border: 'none',
                            borderRadius: '8px',
                            background: TavariStyles.colors.primary,
                            color: 'white',
                            cursor: loadingFwp ? 'not-allowed' : 'pointer',
                            fontSize: '14px',
                            fontWeight: '600'
                          }}
                        >
                          {loadingFwp ? 'Saving...' : (editingFwpId ? 'Update' : 'Add')}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div style={{ padding: '24px' }}>
                      <button
                        onClick={() => openFwpForm(null)}
                        style={{
                          width: '100%',
                          padding: '12px 16px',
                          border: `1px dashed ${TavariStyles.colors.gray300}`,
                          borderRadius: '8px',
                          background: 'transparent',
                          color: TavariStyles.colors.gray600,
                          fontSize: '14px',
                          fontWeight: '500',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px'
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.borderColor = TavariStyles.colors.primary; e.currentTarget.style.color = TavariStyles.colors.primary; }}
                        onMouseLeave={(e) => { e.currentTarget.style.borderColor = TavariStyles.colors.gray300; e.currentTarget.style.color = TavariStyles.colors.gray600; }}
                      >
                        <FiPlus size={18} /> Add Free with purchase
                      </button>
                      {loadingFwp ? (
                        <div style={{ padding: '24px', textAlign: 'center', color: TavariStyles.colors.gray500 }}>Loading...</div>
                      ) : freeWithPurchasePromotions.length === 0 ? (
                        <div style={{ padding: '24px', textAlign: 'center', color: TavariStyles.colors.gray500, fontSize: '14px' }}>
                          No free-with-purchase promotions yet. Click &quot;Add Free with purchase&quot; to create one.
                        </div>
                      ) : (
                        <div style={{ marginTop: '16px' }}>
                          {freeWithPurchasePromotions.map(promo => {
                            const freeItem = fwpInventory.find(i => i.id === promo.free_item_id);
                            const triggerCount = Array.isArray(promo.trigger_item_ids) ? promo.trigger_item_ids.length : 0;
                            return (
                              <div
                                key={promo.id}
                                style={{
                                  padding: '12px 16px',
                                  border: `1px solid ${TavariStyles.colors.gray200}`,
                                  borderRadius: '8px',
                                  marginBottom: '8px',
                                  display: 'flex',
                                  justifyContent: 'space-between',
                                  alignItems: 'center'
                                }}
                              >
                                <div style={{ fontSize: '14px' }}>
                                  <strong>{promo.quantity}</strong> × {freeItem ? freeItem.name : 'Unknown item'} free per purchase of {triggerCount} trigger item{triggerCount !== 1 ? 's' : ''}
                                </div>
                                <div style={{ display: 'flex', gap: '8px' }}>
                                  <button
                                    onClick={() => openFwpForm(promo)}
                                    style={{ padding: '6px 10px', border: 'none', borderRadius: '6px', background: TavariStyles.colors.gray100, cursor: 'pointer', fontSize: '13px' }}
                                  >
                                    Edit
                                  </button>
                                  <button
                                    onClick={() => { if (window.confirm('Remove this promotion?')) deleteFwpPromotion(promo.id); }}
                                    style={{ padding: '6px 10px', border: 'none', borderRadius: '6px', background: '#fee2e2', color: '#b91c1c', cursor: 'pointer', fontSize: '13px' }}
                                  >
                                    Delete
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        );

      case 'options':
        return (
          <div>
            <h2 style={{ fontSize: '24px', fontWeight: '600', marginBottom: '8px' }}>
              Options
            </h2>
            <div style={{
              marginTop: 16,
              padding: 20,
              border: `1px solid ${TavariStyles.colors.gray200}`,
              borderRadius: 12,
              backgroundColor: '#fff',
            }}>
              <BookingActivityOptionsLibraryManager businessId={auth.selectedBusinessId} />
            </div>
          </div>
        );

      case 'marketing':
        return (
          <div>
            <h2 style={{ fontSize: '24px', fontWeight: '600', marginBottom: '16px' }}>
              Marketing & Communications
            </h2>

            <div
              role="tablist"
              aria-label="Marketing page sections"
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: '8px',
                marginBottom: '24px',
                paddingBottom: '4px',
                borderBottom: `1px solid ${TavariStyles.colors.gray200}`,
              }}
            >
              {[
                { id: 'reminder', label: 'Reminder email' },
                { id: 'abandoned', label: 'Abandoned cart email' },
                { id: 'thankYou', label: 'Thank you email' },
                { id: 'links', label: 'Marketing links' },
              ].map((tab) => {
                const active = marketingSectionTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    id={`marketing-tab-${tab.id}`}
                    aria-selected={active}
                    onClick={() => setMarketingSectionTab(tab.id)}
                    style={{
                      padding: '10px 16px',
                      borderRadius: '8px',
                      border: `1px solid ${active ? TavariStyles.colors.primary : TavariStyles.colors.gray200}`,
                      backgroundColor: active ? 'rgba(0, 128, 128, 0.08)' : '#fff',
                      color: active ? TavariStyles.colors.primary : TavariStyles.colors.gray700,
                      fontWeight: active ? '600' : '500',
                      fontSize: '14px',
                      cursor: 'pointer',
                    }}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>

            {marketingSectionTab === 'reminder' && (
              <div>
                <div style={{ marginBottom: '24px' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '12px', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={settings.autoSendConfirmation}
                      onChange={(e) => setSettings({ ...settings, autoSendConfirmation: e.target.checked })}
                      style={{ width: '20px', height: '20px' }}
                    />
                    <span style={{ fontSize: '16px', fontWeight: '500' }}>
                      Automatically send confirmation emails when bookings are created
                    </span>
                  </label>
                </div>

                <div style={{ marginBottom: '8px' }}>
                  <label style={{ display: 'block', marginBottom: '8px', fontWeight: '600' }}>
                    Send Reminder (Hours Before Booking)
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="168"
                    value={settings.reminderHoursBefore}
                    onChange={(e) => setSettings({ ...settings, reminderHoursBefore: parseInt(e.target.value) || 24 })}
                    style={{
                      width: '200px',
                      padding: '10px',
                      border: '1px solid #e5e7eb',
                      borderRadius: '8px',
                      fontSize: '16px'
                    }}
                  />
                  <div style={{ fontSize: '14px', color: TavariStyles.colors.gray600, marginTop: '4px' }}>
                    Send reminder email this many hours before the booking time
                  </div>
                </div>

                <div style={{ marginTop: '20px', paddingTop: '16px', borderTop: `1px solid ${TavariStyles.colors.gray200}` }}>
                  <label style={{ display: 'block', marginBottom: '8px', fontWeight: '600' }}>Send test email to</label>
                  <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '12px' }}>
                    <input
                      type="email"
                      value={marketingTestEmail}
                      onChange={(e) => setMarketingTestEmail(e.target.value)}
                      placeholder="you@example.com"
                      autoComplete="email"
                      style={{
                        flex: '1',
                        minWidth: '220px',
                        padding: '10px 12px',
                        border: `1px solid ${TavariStyles.colors.gray200}`,
                        borderRadius: '8px',
                        fontSize: '15px',
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => handleSendMarketingTestEmail('reminder')}
                      disabled={!!marketingTestSending || !auth.selectedBusinessId}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '8px',
                        padding: '10px 18px',
                        border: 'none',
                        borderRadius: '8px',
                        fontSize: '14px',
                        fontWeight: '600',
                        backgroundColor: marketingTestSending || !auth.selectedBusinessId ? TavariStyles.colors.gray300 : TavariStyles.colors.primary,
                        color: 'white',
                        cursor: marketingTestSending || !auth.selectedBusinessId ? 'not-allowed' : 'pointer',
                      }}
                    >
                      <FiMail size={16} />
                      {marketingTestSending === 'reminder' ? 'Sending…' : 'Send test reminder email'}
                    </button>
                  </div>
                  <p style={{ fontSize: '13px', color: TavariStyles.colors.gray600, margin: '10px 0 0' }}>
                    Sends a sample reminder using saved hours-before and confirmation settings (click Save Settings first to test
                    unsaved changes).
                  </p>
                </div>
              </div>
            )}

            {marketingSectionTab === 'abandoned' && (
              <div style={{ maxWidth: '720px' }}>
                <p style={{ fontSize: '14px', color: TavariStyles.colors.gray600, lineHeight: 1.6, margin: '0 0 20px' }}>
                  Customers who sign in on the booking portal are tracked through each step. If they stop before paying, Tavari can
                  send a nudge email with a link back to this activity. A separate job runs about every 15 minutes (after the delay
                  you set below) for businesses with this turned on. Set{' '}
                  <code style={{ fontSize: '13px' }}>BOOKING_PUBLIC_APP_URL</code> on the server so links match your live app domain.
                </p>

                <label style={{ display: 'flex', alignItems: 'center', gap: '12px', cursor: 'pointer', marginBottom: '20px' }}>
                  <input
                    type="checkbox"
                    checked={settings.abandonedCartEmailEnabled}
                    onChange={(e) => setSettings({ ...settings, abandonedCartEmailEnabled: e.target.checked })}
                    style={{ width: '20px', height: '20px' }}
                  />
                  <span style={{ fontSize: '16px', fontWeight: '500' }}>Send abandoned booking emails</span>
                </label>

                <div style={{ marginBottom: '20px' }}>
                  <label style={{ display: 'block', marginBottom: '8px', fontWeight: '600' }}>Minimum idle time before sending (hours)</label>
                  <input
                    type="number"
                    min="0.5"
                    max="168"
                    step="0.5"
                    value={settings.abandonedCartEmailHours}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        abandonedCartEmailHours: Math.min(168, Math.max(0.5, parseFloat(e.target.value) || 2)),
                      })
                    }
                    style={{
                      width: '120px',
                      padding: '10px',
                      border: '1px solid #e5e7eb',
                      borderRadius: '8px',
                      fontSize: '16px',
                    }}
                  />
                  <div style={{ fontSize: '14px', color: TavariStyles.colors.gray600, marginTop: '4px' }}>
                    After this many hours with no activity, an email may be sent (if the customer reached the minimum step).
                  </div>
                </div>

                <div style={{ marginBottom: '20px' }}>
                  <label style={{ display: 'block', marginBottom: '8px', fontWeight: '600' }}>Minimum funnel step (pre-payment nudges)</label>
                  <select
                    value={settings.abandonedCartMinStage}
                    onChange={(e) => setSettings({ ...settings, abandonedCartMinStage: e.target.value })}
                    style={{
                      maxWidth: '400px',
                      width: '100%',
                      padding: '10px 12px',
                      border: `1px solid ${TavariStyles.colors.gray200}`,
                      borderRadius: '8px',
                      fontSize: '15px',
                    }}
                  >
                    <option value="activity_view">Viewed activity</option>
                    <option value="date_time">Chose date or time</option>
                    <option value="participants">Selected participants</option>
                    <option value="tickets">Ticket selection</option>
                    <option value="payment">Payment step</option>
                    <option value="payment_started">Opened checkout (Helcim)</option>
                  </select>
                  <div style={{ fontSize: '14px', color: TavariStyles.colors.gray600, marginTop: '4px' }}>
                    Only sessions that reached at least this step (and have an email on file) are eligible. Customers who opened
                    Helcim Pay are also handled using the checkout record and their saved email.
                  </div>
                </div>

                <label style={{ display: 'block', marginBottom: '8px', fontWeight: '600' }}>Extra message (optional)</label>
                <textarea
                  value={settings.abandonedCartEmailMessage}
                  onChange={(e) => setSettings({ ...settings, abandonedCartEmailMessage: e.target.value })}
                  placeholder="Short paragraph shown in the email in addition to the continue link."
                  rows={4}
                  style={{
                    width: '100%',
                    maxWidth: '640px',
                    padding: '12px',
                    border: `1px solid ${TavariStyles.colors.gray200}`,
                    borderRadius: '8px',
                    fontSize: '15px',
                    lineHeight: 1.5,
                    resize: 'vertical',
                    boxSizing: 'border-box',
                  }}
                />

                <div style={{ marginTop: '20px', paddingTop: '16px', borderTop: `1px solid ${TavariStyles.colors.gray200}` }}>
                  <label style={{ display: 'block', marginBottom: '8px', fontWeight: '600' }}>Send test email to</label>
                  <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '12px' }}>
                    <input
                      type="email"
                      value={marketingTestEmail}
                      onChange={(e) => setMarketingTestEmail(e.target.value)}
                      placeholder="you@example.com"
                      autoComplete="email"
                      style={{
                        flex: '1',
                        minWidth: '220px',
                        padding: '10px 12px',
                        border: `1px solid ${TavariStyles.colors.gray200}`,
                        borderRadius: '8px',
                        fontSize: '15px',
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => handleSendMarketingTestEmail('abandoned')}
                      disabled={!!marketingTestSending || !auth.selectedBusinessId}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '8px',
                        padding: '10px 18px',
                        border: 'none',
                        borderRadius: '8px',
                        fontSize: '14px',
                        fontWeight: '600',
                        backgroundColor: marketingTestSending || !auth.selectedBusinessId ? TavariStyles.colors.gray300 : TavariStyles.colors.primary,
                        color: 'white',
                        cursor: marketingTestSending || !auth.selectedBusinessId ? 'not-allowed' : 'pointer',
                      }}
                    >
                      <FiMail size={16} />
                      {marketingTestSending === 'abandoned' ? 'Sending…' : 'Send test abandoned-cart email'}
                    </button>
                  </div>
                  <p style={{ fontSize: '13px', color: TavariStyles.colors.gray600, margin: '10px 0 0' }}>
                    Uses the same layout as production nudges with your saved text and rules (click Save Settings first to test
                    unsaved changes). Links use the first active activity, or a placeholder if none exist.
                  </p>
                </div>
              </div>
            )}

            {marketingSectionTab === 'thankYou' && (
            <div
              style={{
                marginBottom: '24px',
                padding: '20px 24px',
                border: `1px solid ${TavariStyles.colors.gray200}`,
                borderRadius: '12px',
                backgroundColor: '#fff',
              }}
            >
              <h3 style={{ fontSize: '18px', fontWeight: '600', margin: '0 0 8px', color: TavariStyles.colors.gray900 }}>
                Thank-you message (confirmation email)
              </h3>
              <p style={{ fontSize: '13px', color: TavariStyles.colors.gray600, margin: '0 0 16px' }}>
                The booking confirmation email is sent after a customer completes a booking. Use the options below to add a closing
                thank-you at the end of that same email — not a separate message.
              </p>
              <label style={{ display: 'flex', alignItems: 'center', gap: '12px', cursor: 'pointer', marginBottom: '16px' }}>
                <input
                  type="checkbox"
                  checked={settings.thankYouEmailEnabled}
                  onChange={(e) => setSettings({ ...settings, thankYouEmailEnabled: e.target.checked })}
                  style={{ width: '20px', height: '20px' }}
                />
                <span style={{ fontSize: '16px', fontWeight: '500' }}>Include a thank-you in the confirmation email</span>
              </label>
              <label style={{ display: 'block', marginBottom: '8px', fontWeight: '600' }}>Custom thank-you text (optional)</label>
              <textarea
                value={settings.thankYouEmailMessage}
                onChange={(e) => setSettings({ ...settings, thankYouEmailMessage: e.target.value })}
                disabled={!settings.thankYouEmailEnabled}
                placeholder="Leave blank to use a short default thank-you from Tavari."
                rows={4}
                style={{
                  width: '100%',
                  maxWidth: '640px',
                  padding: '12px',
                  border: `1px solid ${TavariStyles.colors.gray200}`,
                  borderRadius: '8px',
                  fontSize: '15px',
                  lineHeight: 1.5,
                  resize: 'vertical',
                  boxSizing: 'border-box',
                  opacity: settings.thankYouEmailEnabled ? 1 : 0.55,
                }}
              />
              <div style={{ fontSize: '14px', color: TavariStyles.colors.gray600, marginTop: '8px' }}>
                Plain text only (no HTML). Line breaks are preserved.
              </div>

              <div style={{ marginTop: '20px', paddingTop: '16px', borderTop: `1px solid ${TavariStyles.colors.gray200}` }}>
                <label style={{ display: 'block', marginBottom: '8px', fontWeight: '600' }}>Send test email to</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '12px' }}>
                  <input
                    type="email"
                    value={thankYouTestEmail}
                    onChange={(e) => setThankYouTestEmail(e.target.value)}
                    placeholder="you@example.com"
                    autoComplete="email"
                    style={{
                      flex: '1',
                      minWidth: '220px',
                      padding: '10px 12px',
                      border: `1px solid ${TavariStyles.colors.gray200}`,
                      borderRadius: '8px',
                      fontSize: '15px',
                    }}
                  />
                  <button
                    type="button"
                    onClick={handleSendThankYouTestEmail}
                    disabled={thankYouTestSending || !auth.selectedBusinessId}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '8px',
                      padding: '10px 18px',
                      border: 'none',
                      borderRadius: '8px',
                      fontSize: '14px',
                      fontWeight: '600',
                      backgroundColor: thankYouTestSending || !auth.selectedBusinessId ? TavariStyles.colors.gray300 : TavariStyles.colors.primary,
                      color: 'white',
                      cursor: thankYouTestSending || !auth.selectedBusinessId ? 'not-allowed' : 'pointer',
                    }}
                  >
                    <FiMail size={16} />
                    {thankYouTestSending ? 'Sending…' : 'Send test thank-you email'}
                  </button>
                </div>
                <p style={{ fontSize: '13px', color: TavariStyles.colors.gray600, margin: '10px 0 0' }}>
                  Sends a sample using your current text and on/off setting (unsaved edits are not included — click Save Settings
                  first to test changes).
                </p>
              </div>
            </div>
            )}

            {marketingSectionTab === 'links' && (
            <div
              style={{
                marginBottom: '24px',
                padding: '20px 24px',
                border: `1px solid ${TavariStyles.colors.gray200}`,
                borderRadius: '12px',
                backgroundColor: '#fff',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
                <FiLink size={20} color={TavariStyles.colors.primary} />
                <h3 style={{ fontSize: '18px', fontWeight: '600', margin: 0, color: TavariStyles.colors.gray900 }}>
                  Marketing links
                </h3>
              </div>
              <div style={{ marginBottom: '16px' }}>
                <div style={{ fontSize: '14px', fontWeight: '600', marginBottom: '6px', color: TavariStyles.colors.gray800 }}>
                  Customer portal
                </div>
                <div style={{ fontSize: '13px', color: TavariStyles.colors.gray600, marginBottom: '10px' }}>
                  Share this link so customers can browse activities and book. No login required.
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                  <input
                    type="text"
                    readOnly
                    value={auth.selectedBusinessId ? getCustomerPortalBaseUrl(window.location.origin, auth.selectedBusinessId) : '—'}
                    style={{
                      flex: '1',
                      minWidth: '240px',
                      padding: '10px 12px',
                      border: `1px solid ${TavariStyles.colors.gray200}`,
                      borderRadius: '8px',
                      fontSize: '14px',
                      backgroundColor: TavariStyles.colors.gray50,
                      color: TavariStyles.colors.gray800,
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (!auth.selectedBusinessId) return;
                      const url = getCustomerPortalBaseUrl(window.location.origin, auth.selectedBusinessId);
                      navigator.clipboard.writeText(url).then(() => toast.success('Link copied to clipboard')).catch(() => toast.error('Could not copy'));
                    }}
                    disabled={!auth.selectedBusinessId}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      padding: '10px 16px',
                      border: 'none',
                      borderRadius: '8px',
                      fontSize: '14px',
                      fontWeight: '600',
                      backgroundColor: TavariStyles.colors.primary,
                      color: 'white',
                      cursor: auth.selectedBusinessId ? 'pointer' : 'not-allowed',
                    }}
                  >
                    <FiCopy size={16} />
                    Copy
                  </button>
                </div>
              </div>

              <div style={{ marginBottom: '20px', paddingTop: '16px', borderTop: `1px solid ${TavariStyles.colors.gray200}` }}>
                <label style={{ display: 'block', marginBottom: '8px', fontWeight: '600' }}>Send test email to</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '12px' }}>
                  <input
                    type="email"
                    value={marketingTestEmail}
                    onChange={(e) => setMarketingTestEmail(e.target.value)}
                    placeholder="you@example.com"
                    autoComplete="email"
                    style={{
                      flex: '1',
                      minWidth: '220px',
                      padding: '10px 12px',
                      border: `1px solid ${TavariStyles.colors.gray200}`,
                      borderRadius: '8px',
                      fontSize: '15px',
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => handleSendMarketingTestEmail('links')}
                    disabled={!!marketingTestSending || !auth.selectedBusinessId}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '8px',
                      padding: '10px 18px',
                      border: 'none',
                      borderRadius: '8px',
                      fontSize: '14px',
                      fontWeight: '600',
                      backgroundColor: marketingTestSending || !auth.selectedBusinessId ? TavariStyles.colors.gray300 : TavariStyles.colors.primary,
                      color: 'white',
                      cursor: marketingTestSending || !auth.selectedBusinessId ? 'not-allowed' : 'pointer',
                    }}
                  >
                    <FiMail size={16} />
                    {marketingTestSending === 'links' ? 'Sending…' : 'Send test links email'}
                  </button>
                </div>
                <p style={{ fontSize: '13px', color: TavariStyles.colors.gray600, margin: '10px 0 0' }}>
                  Emails example portal, category, and activity URLs (uses this browser’s origin; production may use
                  <code style={{ fontSize: '13px' }}> BOOKING_PUBLIC_APP_URL</code> on the server).
                </p>
              </div>

              <p style={{ fontSize: '13px', color: TavariStyles.colors.gray600, margin: '0 0 20px' }}>
                Links for each category and each activity are generated from your Bookings setup — when you add a new booking category
                (sidebar group) or a new bookable activity, a matching public link appears here. No extra setup is required.
              </p>

              {loadingCategories ? (
                <div style={{ fontSize: '14px', color: TavariStyles.colors.gray500, padding: '8px 0' }}>Loading public links…</div>
              ) : (
                <>
                  <div style={{ marginBottom: '24px' }}>
                    <div style={{ fontSize: '14px', fontWeight: '600', marginBottom: '6px', color: TavariStyles.colors.gray800 }}>
                      Booking category links
                    </div>
                    <div style={{ fontSize: '13px', color: TavariStyles.colors.gray600, marginBottom: '12px' }}>
                      Use these in email or social posts to send people to the portal with the matching category pre-selected. Only
                      <strong> active </strong>categories are listed.
                    </div>
                    {categories.filter((c) => c.is_active).length === 0 ? (
                      <div style={{ fontSize: '14px', color: TavariStyles.colors.gray500 }}>No active booking categories yet. Add them under Booking categories.</div>
                    ) : (
                      <div
                        style={{
                          display: 'grid',
                          gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 300px), 1fr))',
                          gap: '12px',
                        }}
                      >
                        {categories
                          .filter((c) => c.is_active)
                          .map((c) => {
                            const label = c.display_name || c.type_name || 'Category';
                            const url = auth.selectedBusinessId
                              ? getCategoryPortalUrl(window.location.origin, auth.selectedBusinessId, c.id)
                              : '';
                            return (
                              <div
                                key={c.id}
                                style={{
                                  border: `1px solid ${TavariStyles.colors.gray200}`,
                                  borderRadius: '8px',
                                  padding: '12px',
                                  backgroundColor: TavariStyles.colors.gray50,
                                }}
                              >
                                <div style={{ fontSize: '13px', fontWeight: '600', color: TavariStyles.colors.gray900, marginBottom: '8px' }}>{label}</div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                                  <input
                                    type="text"
                                    readOnly
                                    value={url}
                                    style={{
                                      flex: '1',
                                      minWidth: '160px',
                                      padding: '8px 10px',
                                      border: `1px solid ${TavariStyles.colors.gray200}`,
                                      borderRadius: '6px',
                                      fontSize: '13px',
                                      backgroundColor: '#fff',
                                    }}
                                  />
                                  <button
                                    type="button"
                                    onClick={() => {
                                      if (!url) return;
                                      navigator.clipboard
                                        .writeText(url)
                                        .then(() => toast.success('Link copied'))
                                        .catch(() => toast.error('Could not copy'));
                                    }}
                                    disabled={!url}
                                    style={{
                                      display: 'flex',
                                      alignItems: 'center',
                                      gap: '6px',
                                      padding: '8px 12px',
                                      border: 'none',
                                      borderRadius: '6px',
                                      fontSize: '13px',
                                      fontWeight: '600',
                                      backgroundColor: TavariStyles.colors.primary,
                                      color: 'white',
                                      cursor: url ? 'pointer' : 'not-allowed',
                                    }}
                                    aria-label={`Copy category link for ${label}`}
                                  >
                                    <FiCopy size={14} />
                                    Copy
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                      </div>
                    )}
                  </div>

                  <div>
                    <div style={{ fontSize: '14px', fontWeight: '600', marginBottom: '6px', color: TavariStyles.colors.gray800 }}>
                      Bookable activity links
                    </div>
                    <div style={{ fontSize: '13px', color: TavariStyles.colors.gray600, marginBottom: '12px' }}>
                      Each link opens the booking flow for that activity (date, time, participants, payment, etc.). Only
                      <strong> active </strong>activities are listed.
                    </div>
                    {activities.filter((a) => a.is_active).length === 0 ? (
                      <div style={{ fontSize: '14px', color: TavariStyles.colors.gray500 }}>No active activities yet. Add them under Booking categories.</div>
                    ) : (
                      <div
                        style={{
                          display: 'grid',
                          gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 300px), 1fr))',
                          gap: '12px',
                        }}
                      >
                        {activities
                          .filter((a) => a.is_active)
                          .map((a) => {
                            const typeRow = categories.find((t) => t.id === a.type_id);
                            const catLabel = typeRow ? (typeRow.display_name || typeRow.type_name) : '—';
                            const url = auth.selectedBusinessId
                              ? getActivityPortalUrl(window.location.origin, auth.selectedBusinessId, a.id)
                              : '';
                            return (
                              <div
                                key={a.id}
                                style={{
                                  border: `1px solid ${TavariStyles.colors.gray200}`,
                                  borderRadius: '8px',
                                  padding: '12px',
                                  backgroundColor: TavariStyles.colors.gray50,
                                }}
                              >
                                <div style={{ fontSize: '13px', color: TavariStyles.colors.gray500, marginBottom: '2px' }}>{catLabel}</div>
                                <div style={{ fontSize: '13px', fontWeight: '600', color: TavariStyles.colors.gray900, marginBottom: '8px' }}>{a.activity_name}</div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                                  <input
                                    type="text"
                                    readOnly
                                    value={url}
                                    style={{
                                      flex: '1',
                                      minWidth: '160px',
                                      padding: '8px 10px',
                                      border: `1px solid ${TavariStyles.colors.gray200}`,
                                      borderRadius: '6px',
                                      fontSize: '13px',
                                      backgroundColor: '#fff',
                                    }}
                                  />
                                  <button
                                    type="button"
                                    onClick={() => {
                                      if (!url) return;
                                      navigator.clipboard
                                        .writeText(url)
                                        .then(() => toast.success('Link copied'))
                                        .catch(() => toast.error('Could not copy'));
                                    }}
                                    disabled={!url}
                                    style={{
                                      display: 'flex',
                                      alignItems: 'center',
                                      gap: '6px',
                                      padding: '8px 12px',
                                      border: 'none',
                                      borderRadius: '6px',
                                      fontSize: '13px',
                                      fontWeight: '600',
                                      backgroundColor: TavariStyles.colors.primary,
                                      color: 'white',
                                      cursor: url ? 'pointer' : 'not-allowed',
                                    }}
                                    aria-label={`Copy book link for ${a.activity_name}`}
                                  >
                                    <FiCopy size={14} />
                                    Copy
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
            )}

            <button
              onClick={handleSave}
              disabled={saving}
              style={{
                padding: '12px 24px',
                backgroundColor: saving ? '#ccc' : TavariStyles.colors.primary,
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                fontSize: '16px',
                fontWeight: '600',
                cursor: saving ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                marginTop: '20px'
              }}
            >
              <FiSave /> {saving ? 'Saving...' : 'Save Settings'}
            </button>
          </div>
        );

      case 'terms':
        return (
          <div>
            <h2 style={{ fontSize: '24px', fontWeight: '600', marginBottom: '24px' }}>
              Terms & Conditions
            </h2>

            <div style={{
              marginBottom: 28,
              padding: 20,
              border: `1px solid ${TavariStyles.colors.gray200}`,
              borderRadius: 12,
              backgroundColor: '#fff',
            }}>
              <BookingTermsPackagesManager businessId={auth.selectedBusinessId} />
            </div>

            <h3 style={{ fontSize: '18px', fontWeight: '600', marginBottom: '16px' }}>
              Cancellation & refund policies
            </h3>

            <div style={{ marginBottom: '24px' }}>
              <label style={{ display: 'block', marginBottom: '8px', fontWeight: '600' }}>
                Cancellation Policy
              </label>
              <textarea
                value={settings.cancellationPolicy}
                onChange={(e) => setSettings({ ...settings, cancellationPolicy: e.target.value })}
                rows={6}
                style={{
                  width: '100%',
                  padding: '12px',
                  border: '1px solid #e5e7eb',
                  borderRadius: '8px',
                  fontSize: '16px',
                  fontFamily: 'inherit'
                }}
                placeholder="Enter cancellation policy details..."
              />
            </div>

            <div style={{ marginBottom: '24px' }}>
              <label style={{ display: 'block', marginBottom: '8px', fontWeight: '600' }}>
                Refund Policy
              </label>
              <textarea
                value={settings.refundPolicy}
                onChange={(e) => setSettings({ ...settings, refundPolicy: e.target.value })}
                rows={6}
                style={{
                  width: '100%',
                  padding: '12px',
                  border: '1px solid #e5e7eb',
                  borderRadius: '8px',
                  fontSize: '16px',
                  fontFamily: 'inherit'
                }}
                placeholder="Enter refund policy details..."
              />
            </div>

            <button
              onClick={handleSave}
              disabled={saving}
              style={{
                padding: '12px 24px',
                backgroundColor: saving ? '#ccc' : TavariStyles.colors.primary,
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                fontSize: '16px',
                fontWeight: '600',
                cursor: saving ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                marginTop: '20px'
              }}
            >
              <FiSave /> {saving ? 'Saving...' : 'Save Settings'}
            </button>
          </div>
        );

      default:
        return (
          <div style={{
            padding: '60px 40px',
            textAlign: 'center',
            color: TavariStyles.colors.gray600
          }}>
            <div style={{ fontSize: '18px', fontWeight: '600', marginBottom: '8px' }}>
              Coming Soon
            </div>
          </div>
        );
    }
  };

  if (!canManageSettings) {
    return (
      <div style={{ padding: '40px', textAlign: 'center' }}>
        <h3>Access Denied</h3>
        <p>You do not have permission to manage booking settings.</p>
      </div>
    );
  }

  return (
    <SecurityWrapper>
      <POSAuthWrapper
        requiredRoles={['manager', 'owner']}
        requireBusiness={true}
        componentName="BookingSettingsScreen"
      >
        <div
          style={{
            padding: 'clamp(16px, 3vw, 30px)',
            maxWidth: activeSubTab === 'marketing' ? 'none' : '1400px',
            width: '100%',
            margin: activeSubTab === 'marketing' ? 0 : '0 auto',
            boxSizing: 'border-box',
          }}
        >
          {loading ? (
            <div style={{ padding: '40px', textAlign: 'center' }}>Loading settings...</div>
          ) : (
            <div style={{
              backgroundColor: 'white',
              padding: 'clamp(20px, 4vw, 30px)',
              borderRadius: '12px',
              border: '1px solid #e5e7eb',
              boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1)',
              width: '100%',
              boxSizing: 'border-box'
            }}>
              {renderSubTabContent()}
            </div>
          )}

          {/* Inventory Search Modal - Must be at root level to render from any tab */}
          {showInventorySearchModal && (
            <div
              style={{
                position: 'fixed',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                backgroundColor: 'rgba(0, 0, 0, 0.5)',
                zIndex: 300,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '20px'
              }}
            >
              <div
                style={{
                  backgroundColor: 'white',
                  borderRadius: '12px',
                  maxWidth: '800px',
                  width: '100%',
                  maxHeight: '90vh',
                  overflow: 'hidden',
                  display: 'flex',
                  flexDirection: 'column',
                  boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)'
                }}
                onClick={(e) => e.stopPropagation()}
              >
                <div style={{
                  padding: '20px 24px',
                  borderBottom: '1px solid #e5e7eb',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center'
                }}>
                  <h3 style={{ fontSize: '20px', fontWeight: '600', margin: 0 }}>
                    {inventoryPickerMode === 'options'
                      ? 'Add from inventory'
                      : inventoryPickerMode === 'posImport'
                        ? 'Import POS modifiers'
                        : 'Search Inventory'}
                  </h3>
                  <button
                    onClick={() => {
                      setShowInventorySearchModal(false);
                      setInventorySearchTerm('');
                      setSelectedInventoryCategory('');
                      setOptionInventoryPickerSelection([]);
                      setOptionInventoryPickerGroupIndex(null);
                      setInventoryPickerMode('tickets');
                    }}
                    style={{
                      border: 'none',
                      background: 'transparent',
                      cursor: 'pointer',
                      padding: '8px',
                      borderRadius: '4px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#f3f4f6'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                  >
                    <FiX size={24} />
                  </button>
                </div>

                <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  {/* Search and Category Filter */}
                  <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                    <input
                      type="text"
                      placeholder="Search by name, SKU, or barcode..."
                      value={inventorySearchTerm}
                      onChange={(e) => {
                        setInventorySearchTerm(e.target.value);
                      }}
                      style={{
                        flex: 1,
                        minWidth: '200px',
                        padding: '10px 14px',
                        border: '1px solid #e5e7eb',
                        borderRadius: '8px',
                        fontSize: '14px'
                      }}
                    />
                    <select
                      value={selectedInventoryCategory}
                      onChange={(e) => {
                        setSelectedInventoryCategory(e.target.value);
                      }}
                      style={{
                        padding: '10px 14px',
                        border: '1px solid #e5e7eb',
                        borderRadius: '8px',
                        fontSize: '14px',
                        backgroundColor: 'white',
                        cursor: 'pointer',
                        minWidth: '180px'
                      }}
                    >
                      <option value="">All Categories</option>
                      {inventoryCategories.map(cat => (
                        <option key={cat.id} value={cat.id}>{cat.name}</option>
                      ))}
                    </select>
                  </div>

                  {inventoryPickerMode === 'options' && optionInventoryPickerSelection.length > 0 && (
                    <div
                      style={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: 8,
                        padding: '10px 12px',
                        backgroundColor: '#f0f9ff',
                        borderRadius: 8,
                        border: '1px solid #bae6fd',
                      }}
                    >
                      <span style={{ fontSize: 13, fontWeight: 600, color: '#0369a1', width: '100%' }}>
                        Selected ({optionInventoryPickerSelection.length})
                      </span>
                      {optionInventoryPickerSelection.map((id) => {
                        const item = inventoryItems.find((row) => row.id === id);
                        const alreadyAdded = optionPickerExistingInventoryIds.has(id);
                        return (
                          <span
                            key={id}
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 6,
                              padding: '4px 10px',
                              borderRadius: 999,
                              backgroundColor: alreadyAdded ? '#f3f4f6' : 'white',
                              border: `1px solid ${alreadyAdded ? '#d1d5db' : '#7dd3fc'}`,
                              fontSize: 13,
                              color: TavariStyles.colors.gray900,
                            }}
                          >
                            {item?.name || 'Loading…'}
                            {alreadyAdded ? (
                              <span style={{ fontSize: 11, color: TavariStyles.colors.gray500 }}>(added)</span>
                            ) : (
                            <button
                              type="button"
                              onClick={() =>
                                setOptionInventoryPickerSelection((prev) =>
                                  prev.filter((rowId) => rowId !== id)
                                )
                              }
                              style={{
                                border: 'none',
                                background: 'transparent',
                                cursor: 'pointer',
                                color: '#64748b',
                                fontSize: 16,
                                lineHeight: 1,
                                padding: 0,
                              }}
                              aria-label="Remove"
                            >
                              ×
                            </button>
                            )}
                          </span>
                        );
                      })}
                    </div>
                  )}

                  {/* Inventory Items List */}
                  <div style={{
                    maxHeight: '400px',
                    overflowY: 'auto',
                    border: '1px solid #e5e7eb',
                    borderRadius: '8px',
                    padding: '8px'
                  }}>
                    {loadingInventory ? (
                      <div style={{ padding: '40px', textAlign: 'center', color: TavariStyles.colors.gray600 }}>
                        Loading inventory...
                      </div>
                    ) : inventoryItems.length === 0 ? (
                      <div style={{ padding: '40px', textAlign: 'center', color: TavariStyles.colors.gray600 }}>
                        {inventorySearchTerm || selectedInventoryCategory 
                          ? 'No items found matching your search.' 
                          : 'No inventory items available.'}
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {inventoryPickerMode === 'options' && (
                          <p style={{ margin: '0 0 4px', fontSize: 13, color: TavariStyles.colors.gray600 }}>
                            Select inventory items or bundles. Each selection becomes one customer option.
                          </p>
                        )}
                        {inventoryPickerMode === 'posImport' && (
                          <p style={{ margin: '0 0 4px', fontSize: 13, color: TavariStyles.colors.gray600 }}>
                            Pick the parent POS item (e.g. Cheese Pizza). Its modifier groups become portal option groups with size-based toppings.
                          </p>
                        )}
                        {inventoryItems
                          .filter((item) => {
                            if (inventoryPickerMode !== 'posImport') return true;
                            const ids = Array.isArray(item.modifier_group_ids)
                              ? item.modifier_group_ids
                              : item.modifier_group_ids
                                ? Object.values(item.modifier_group_ids)
                                : [];
                            return ids.length > 0;
                          })
                          .map(item => {
                          const alreadyInOptionGroup =
                            inventoryPickerMode === 'options' && optionPickerExistingInventoryIds.has(item.id);
                          const isSelected = inventoryPickerMode === 'options' || inventoryPickerMode === 'posImport'
                            ? optionInventoryPickerSelection.includes(item.id)
                            : selectedInventoryItems.includes(item.id);

                          if (inventoryPickerMode === 'options' || inventoryPickerMode === 'posImport') {
                            return (
                              <div
                                key={item.id}
                                role="button"
                                tabIndex={alreadyInOptionGroup ? -1 : 0}
                                onClick={() => {
                                  if (alreadyInOptionGroup) return;
                                  if (inventoryPickerMode === 'posImport') {
                                    setOptionInventoryPickerSelection([item.id]);
                                    return;
                                  }
                                  setOptionInventoryPickerSelection((prev) =>
                                    prev.includes(item.id)
                                      ? prev.filter((id) => id !== item.id)
                                      : [...prev, item.id]
                                  );
                                }}
                                onKeyDown={(e) => {
                                  if (alreadyInOptionGroup) return;
                                  if (e.key !== 'Enter' && e.key !== ' ') return;
                                  e.preventDefault();
                                  if (inventoryPickerMode === 'posImport') {
                                    setOptionInventoryPickerSelection([item.id]);
                                  }
                                }}
                                style={{
                                  display: 'flex',
                                  alignItems: 'flex-start',
                                  gap: 12,
                                  padding: '12px 16px',
                                  border: `1px solid ${isSelected ? TavariStyles.colors.primary : '#e5e7eb'}`,
                                  borderRadius: '8px',
                                  backgroundColor: isSelected ? `${TavariStyles.colors.primary}15` : 'white',
                                  cursor: alreadyInOptionGroup ? 'default' : 'pointer',
                                  opacity: alreadyInOptionGroup ? 0.85 : 1,
                                  transition: 'all 0.2s',
                                }}
                              >
                                <div onClick={(e) => e.stopPropagation()}>
                                  <TavariCheckbox
                                    checked={isSelected}
                                    disabled={alreadyInOptionGroup}
                                    onChange={(checked) => {
                                      if (alreadyInOptionGroup) return;
                                      if (inventoryPickerMode === 'posImport') {
                                        setOptionInventoryPickerSelection(checked ? [item.id] : []);
                                        return;
                                      }
                                      setOptionInventoryPickerSelection((prev) =>
                                        checked
                                          ? prev.includes(item.id)
                                            ? prev
                                            : [...prev, item.id]
                                          : prev.filter((id) => id !== item.id)
                                      );
                                    }}
                                    size="md"
                                  />
                                </div>
                                <div style={{ flex: 1, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, minWidth: 0 }}>
                                  <div style={{ minWidth: 0 }}>
                                    <div style={{ fontWeight: '600', fontSize: '14px', color: TavariStyles.colors.gray900 }}>
                                      {item.name}
                                      {item.is_bundle && (
                                        <span style={{ marginLeft: 8, fontSize: 11, color: '#0369a1', fontWeight: 700 }}>Bundle</span>
                                      )}
                                      {alreadyInOptionGroup && (
                                        <span style={{ marginLeft: 8, fontSize: 11, color: TavariStyles.colors.gray600, fontWeight: 600 }}>
                                          Already added
                                        </span>
                                      )}
                                    </div>
                                    {item.sku && (
                                      <div style={{ fontSize: '13px', color: TavariStyles.colors.gray600, marginTop: '4px' }}>
                                        SKU: {item.sku}
                                      </div>
                                    )}
                                  </div>
                                  <div style={{ fontSize: '16px', fontWeight: '600', color: TavariStyles.colors.primary, flexShrink: 0 }}>
                                    ${parseFloat(item.price || 0).toFixed(2)}
                                  </div>
                                </div>
                              </div>
                            );
                          }

                          return (
                            <div
                              key={item.id}
                              onClick={() => {
                                if (isSelected) {
                                  setSelectedInventoryItems(prev => prev.filter(id => id !== item.id));
                                } else {
                                  setSelectedInventoryItems(prev => [...prev, item.id]);
                                  setInventoryItems(prev => {
                                    if (prev.find(i => i.id === item.id)) return prev;
                                    return [...prev, item].sort((a, b) => a.name.localeCompare(b.name));
                                  });
                                }
                              }}
                              style={{
                                padding: '12px 16px',
                                border: `1px solid ${isSelected ? TavariStyles.colors.primary : '#e5e7eb'}`,
                                borderRadius: '8px',
                                backgroundColor: isSelected ? `${TavariStyles.colors.primary}15` : 'white',
                                cursor: 'pointer',
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                transition: 'all 0.2s'
                              }}
                              onMouseEnter={(e) => {
                                if (!isSelected) {
                                  e.currentTarget.style.borderColor = TavariStyles.colors.primary;
                                  e.currentTarget.style.backgroundColor = '#f0f9ff';
                                }
                              }}
                              onMouseLeave={(e) => {
                                if (!isSelected) {
                                  e.currentTarget.style.borderColor = '#e5e7eb';
                                  e.currentTarget.style.backgroundColor = 'white';
                                }
                              }}
                            >
                              <div style={{ flex: 1 }}>
                                <div style={{ fontWeight: '600', fontSize: '14px', color: TavariStyles.colors.gray900 }}>
                                  {item.name}
                                </div>
                                {item.sku && (
                                  <div style={{ fontSize: '13px', color: TavariStyles.colors.gray600, marginTop: '4px' }}>
                                    SKU: {item.sku}
                                  </div>
                                )}
                              </div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                                <div style={{ fontSize: '16px', fontWeight: '600', color: TavariStyles.colors.primary }}>
                                  ${parseFloat(item.price || 0).toFixed(2)}
                                </div>
                                {isSelected && (
                                  <div style={{
                                    width: '24px',
                                    height: '24px',
                                    borderRadius: '50%',
                                    backgroundColor: TavariStyles.colors.primary,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    color: 'white',
                                    fontSize: '14px',
                                    fontWeight: '600'
                                  }}>
                                    ✓
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>

                <div style={{
                  padding: '16px 24px',
                  borderTop: '1px solid #e5e7eb',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: '12px'
                }}>
                  {inventoryPickerMode === 'options' && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 13, color: TavariStyles.colors.gray600 }}>
                        {optionPickerNewSelectionCount > 0
                          ? `${optionPickerNewSelectionCount} new selected`
                          : optionPickerExistingInventoryIds.size > 0
                            ? `${optionPickerExistingInventoryIds.size} already in this group`
                            : `${optionInventoryPickerSelection.length} selected`}
                      </span>
                      <button
                        type="button"
                        onClick={() => navigate('/dashboard/pos/bundles?create=1')}
                        style={{
                          padding: '8px 12px',
                          border: `1px solid ${TavariStyles.colors.gray300}`,
                          borderRadius: 8,
                          background: 'white',
                          color: TavariStyles.colors.gray900,
                          fontSize: 13,
                          fontWeight: 600,
                          cursor: 'pointer',
                        }}
                      >
                        Create Bundle
                      </button>
                    </div>
                  )}
                  {inventoryPickerMode === 'posImport' && (
                    <span style={{ fontSize: 13, color: TavariStyles.colors.gray600 }}>
                      {optionInventoryPickerSelection.length === 1 ? '1 item selected' : 'Select a POS item with modifiers'}
                    </span>
                  )}
                  <button
                    onClick={async () => {
                      if (inventoryPickerMode === 'posImport') {
                        const itemId = optionInventoryPickerSelection[0];
                        if (!itemId || !auth.selectedBusinessId) {
                          toast.error('Select a POS item with modifier groups');
                          return;
                        }
                        try {
                          setLoadingInventory(true);
                          const { sourceItemName, groups } = await buildPortalOptionGroupsFromPosItem(
                            supabase,
                            auth.selectedBusinessId,
                            itemId
                          );
                          setPortalOptionGroups((prev) => {
                            const withoutPizza = prev.filter(
                              (g) => !String(g.id || '').startsWith('grp_pizza_')
                                && !/pizza size|toppings/i.test(String(g.name || ''))
                            );
                            return [...withoutPizza, ...groups];
                          });
                          setPortalOptionsDisplayMode(PORTAL_OPTIONS_DISPLAY_MODES.STEP_MODALS);
                          toast.success(`Imported modifiers from ${sourceItemName}`);
                          setShowInventorySearchModal(false);
                          setInventorySearchTerm('');
                          setSelectedInventoryCategory('');
                          setOptionInventoryPickerSelection([]);
                          setInventoryPickerMode('tickets');
                        } catch (err) {
                          toast.error(err?.message || 'Import failed');
                        } finally {
                          setLoadingInventory(false);
                        }
                        return;
                      }
                      if (inventoryPickerMode === 'options' && optionInventoryPickerGroupIndex != null) {
                        const itemsToAdd = await resolvePickerInventoryItems(optionInventoryPickerSelection);
                        if (itemsToAdd.length > 0) {
                          setPortalOptionGroups((prev) =>
                            prev.map((g, idx) => {
                              if (idx !== optionInventoryPickerGroupIndex) return g;
                              const existingInvIds = new Set(
                                (g.options || []).map((o) => o.inventory_item_id).filter(Boolean)
                              );
                              const newOptions = itemsToAdd
                                .filter((item) => !existingInvIds.has(item.id))
                                .map((item) => portalOptionFromInventoryItem(item));
                              return {
                                ...g,
                                options: [...(g.options || []), ...newOptions],
                              };
                            })
                          );
                        }
                        setShowInventorySearchModal(false);
                        setInventorySearchTerm('');
                        setSelectedInventoryCategory('');
                        setOptionInventoryPickerSelection([]);
                        setOptionInventoryPickerGroupIndex(null);
                        setOptionInventoryPickerOptionIndex(null);
                        setInventoryPickerMode('tickets');
                        return;
                      }

                      setShowInventorySearchModal(false);
                      setInventorySearchTerm('');
                      setSelectedInventoryCategory('');
                      setOptionInventoryPickerSelection([]);
                      setOptionInventoryPickerGroupIndex(null);
                      setInventoryPickerMode('tickets');
                      if (selectedInventoryItems.length > 0 && auth.selectedBusinessId) {
                        const { data, error } = await supabase
                          .from('pos_inventory')
                          .select('*')
                          .eq('business_id', auth.selectedBusinessId)
                          .in('id', selectedInventoryItems)
                          .order('name', { ascending: true });

                        if (!error && data) {
                          setInventoryItems(data);
                        }
                      } else {
                        setInventoryItems([]);
                      }
                    }}
                    style={{
                      padding: '10px 20px',
                      backgroundColor: TavariStyles.colors.gray200,
                      color: TavariStyles.colors.gray900,
                      border: 'none',
                      borderRadius: '8px',
                      fontSize: '14px',
                      fontWeight: '600',
                      cursor: 'pointer',
                      marginLeft: inventoryPickerMode === 'options' || inventoryPickerMode === 'posImport' ? 'auto' : undefined,
                    }}
                  >
                    {inventoryPickerMode === 'options'
                      ? 'Add selected'
                      : inventoryPickerMode === 'posImport'
                        ? 'Import modifiers'
                        : 'Done'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        <ModuleDeactivationPanel moduleKey="bookings" />
      </POSAuthWrapper>
    </SecurityWrapper>
  );
};

export default BookingSettingsScreen;












