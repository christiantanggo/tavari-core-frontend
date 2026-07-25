// src/screens/Bookings/CustomerPortalActivityPage.jsx
// Activity detail page: business header + activity info, sections, Select Date, images.
// Route: /customer-portal/:businessId/portal/:activitySlug  (activitySlug = activity id)

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useParams, useLocation, useNavigate, Link } from 'react-router-dom';
import { supabase } from '../../supabaseClient';
import { TavariStyles } from '../../utils/TavariStyles';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import { FiChevronLeft, FiChevronRight, FiMinus, FiPlus, FiX } from 'react-icons/fi';
import toast from 'react-hot-toast';
import TavariCheckbox from '../../components/UI/TavariCheckbox';
import BirthdateCalendarPicker from '../../components/UI/BirthdateCalendarPicker';
import waiverOTPService from '../../services/Waivers/WaiverOTPService';
import bookingLoyaltyIntegration from '../../services/Bookings/BookingLoyaltyIntegration';
import bookingWaiverIntegration from '../../services/Bookings/BookingWaiverIntegration';
import camperRegistrationService from '../../services/Bookings/CamperRegistrationService';
import BookingTermsCheckoutModal from '../../components/Bookings/BookingTermsCheckoutModal';
import { useTaxCalculations } from '../../hooks/useTaxCalculations';
import TaxBreakdown from '../../components/POS/POSPaymentScreenComponents/TaxBreakdown';
import {
  clearCustomerPortalSession,
  loadCustomerPortalSession,
  saveCustomerPortalSession,
} from '../../utils/customerPortalSession';
import { buildBookingConfirmedPath, ensureBookingManageToken } from '../../helpers/Bookings/ensureBookingManageToken';
import { isWaiverExpired } from '../../utils/waiverUtils';
import {
  fetchTavariApiBookingCatalog,
  fetchTavariApiWebsiteGallery,
} from '../../services/TavariApis/tavariApisCatalog';
import {
  mergePortalActivityWithCatalog,
  resolveActivityImageUrls,
} from '../../utils/bookingPortalActivityDisplay';
import { enforceSinglePortalAccountOwner } from '../../helpers/Bookings/portalAccountOwner';
import {
  assignTicketsToParticipantsStrict,
  applyFreeWithPurchaseTicketAssignments,
  calculateTicketPricing,
  parseAgeRestriction,
  participantMatchesAgeRestriction as matchesAgeRule,
  ticketCountsFromAssignments,
  clampParticipantIdsToTicketLimits,
  resolveTicketInventoryItemIds,
  collectRelatedFwpFreeItemIds,
  collectPaidAdultFallbackItemIds,
  getOnlineTicketLimits,
  validateParticipantCountAgainstTicketLimits,
  summarizeParticipantTicketIssues,
  formatParticipantTicketIssueMessage,
  parseActivityTicketSettings,
  applyOnlineChannelPrices,
  resolveInventoryTicketPrice,
} from '../../utils/bookingTicketAssignment';
import {
  buildEffectiveTicketPriceOverrides,
  resolveApplicableBookingPromotion,
} from '../../utils/bookingPricingPromotions';
import {
  parseOnlinePaymentSettings,
  calculateOnlineCheckoutAmounts,
  activityRequiresStaffApproval,
} from '../../utils/bookingPaymentSettings';
import { getBookingFunnelSessionKey, recordBookingFunnelActivity } from '../../services/Bookings/BookingFunnelService';
import { getFunctionsInvokeErrorMessage } from '../../helpers/functionsInvokeError';
import { appendHelcimPayIframeCompat } from '../../helpers/helcimPayIframe';
import PartyBookingRoleSelector from '../../components/Bookings/PartyBookingRoleSelector';
import PortalActivityOptionsModal from '../../components/Bookings/PortalActivityOptionsModal';
import PortalOrderReviewList from '../../components/Bookings/PortalOrderReviewList';
import BookingSlotHoldBanner from '../../components/Bookings/BookingSlotHoldBanner';
import SpecialHoursReminderModal from '../../components/Bookings/SpecialHoursReminderModal';
import PortalCustomerErrorModal from '../../components/Bookings/PortalCustomerErrorModal';
import { useBookingSlotHold } from '../../hooks/useBookingSlotHold';
import {
  acquireBookingSlotHold,
  clearSlotHoldToken,
  fetchDayResourceOccupancy,
  fetchPortalSlotOccupancy,
  getOrCreateSlotHoldToken,
  getPortalSlotCapacity,
  getPortalSlotSpacesLeft,
  PORTAL_SLOT_OCCUPANCY_POLL_MS,
  releaseBookingSlotHold,
  resolvePortalSlotOccupancyCount,
} from '../../helpers/Bookings/bookingSlotHold';
import { areRequiredResourcesAvailableForSlot } from '../../helpers/Bookings/bookingResourceAvailability';
import { listScheduleResourceRequirements } from '../../helpers/Bookings/bookingScheduleResourceRequirements';
import {
  effectiveSpacesLeftFromCapacityContext,
  fetchEffectiveSlotCapacity,
} from '../../helpers/Bookings/bookingCategoryCapacity';
import { getSpecialHoursForDate, isBusinessClosedOnDate, getClosedHolidayMessage } from '../../utils/businessSpecialHours';
import {
  isDateClosedForBookings,
} from '../../helpers/Bookings/businessHoursValidation';
import {
  activityHasPortalOptions,
  buildDefaultPortalOptionSelections,
  buildPortalOptionCheckoutRowsFromConfig,
  calculatePortalOptionsSubtotalFromConfig,
  collectPortalOptionInventoryItemIds,
  enrichPortalOptionsConfig,
  filterVisiblePortalOptionGroups,
  findPortalOptionGroupForOption,
  findPortalOptionsStepIndexForGroup,
  listSelectedPortalOptionsForDisplayFromConfig,
  removePortalOrderSelection,
} from '../../utils/bookingActivityOptions';
import { fetchBundleDataForInventoryIds } from '../../utils/posInventoryBundles';
import {
  assignPartyPackageTicket,
  buildPartyParticipantRowsForCheckout,
  parsePartyActivitySettings,
  partitionRosterForParty,
  resolvePartySelectedParticipantIds,
  validatePartyRoleSelection,
  isRosterMinor,
} from '../../utils/bookingPartySettings';
import {
  dedupeSchedulesByStartTime,
  formatBookingScheduleTimeDisplay,
  isIndividualDatesSchedule,
  listIndividualScheduleDateKeys,
  listMultiDaySeriesPortalEntries,
  listMultiDayAnchorPortalEntriesFromConfig,
  shouldUseMultiDayPortalListing,
  normalizeBookingScheduleTime,
  pickSchedulesForActivityOnDate,
} from '../../helpers/Bookings/bookingActivityScheduleHelpers';
import { parseMultiDaySettings } from '../../helpers/Bookings/bookingMultiDay';

dayjs.extend(utc);
dayjs.extend(timezone);

const HELCIM_PAY_SCRIPT_URL = 'https://secure.helcim.app/helcim-pay/services/start.js';

function bookingPortalParticipantsStorageKey(businessId, activitySlug) {
  return `booking-portal-${businessId}-${activitySlug}-participants`;
}

function readSavedParticipantSelection(businessId, activitySlug) {
  try {
    const raw = sessionStorage.getItem(bookingPortalParticipantsStorageKey(businessId, activitySlug));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id) => typeof id === 'string' && id) : [];
  } catch {
    return [];
  }
}

function writeSavedParticipantSelection(businessId, activitySlug, participantIds) {
  try {
    sessionStorage.setItem(
      bookingPortalParticipantsStorageKey(businessId, activitySlug),
      JSON.stringify(Array.isArray(participantIds) ? participantIds : [])
    );
  } catch (_) {}
}

function bookingPortalContextStorageKey(businessId, activitySlug) {
  return `booking-portal-${businessId}-${activitySlug}`;
}

function readSavedBookingPortalContext(businessId, activitySlug) {
  try {
    const raw = sessionStorage.getItem(bookingPortalContextStorageKey(businessId, activitySlug));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function writeSavedBookingPortalContext(businessId, activitySlug, context) {
  try {
    sessionStorage.setItem(
      bookingPortalContextStorageKey(businessId, activitySlug),
      JSON.stringify(context || {})
    );
  } catch (_) {}
}

function buildBookingPortalContextSnapshot({
  selectedDate,
  selectedTimeSlot,
  customerAccount,
  isPartyBooking,
  partyHostParticipantId,
  partyBirthdayChildParticipantId,
  selectedParticipantIds,
  customerParticipants,
}) {
  const selectedIds = Array.isArray(selectedParticipantIds) ? selectedParticipantIds : [];
  const selectedIdentities = selectedIds.map((id) => {
    const p = (customerParticipants || []).find((row) => row.id === id);
    if (!p) return { id };
    return {
      id,
      first_name: p.first_name || '',
      last_name: p.last_name || '',
      date_of_birth: p.date_of_birth != null ? String(p.date_of_birth).split('T')[0] : '',
    };
  });
  return {
    date: selectedDate?.toISOString?.(),
    timeSlot: selectedTimeSlot,
    customerId: customerAccount?.id || null,
    isPartyBooking: !!isPartyBooking,
    partyHostParticipantId: partyHostParticipantId || null,
    partyBirthdayChildParticipantId: partyBirthdayChildParticipantId || null,
    selectedParticipantIds: selectedIds,
    selectedParticipantIdentities: selectedIdentities,
  };
}

function remapSavedParticipantSelection(savedSelection, savedIdentities, participants) {
  const list = Array.isArray(participants) ? participants : [];
  const byId = new Map(list.map((p) => [p.id, p]));
  const remapped = [];

  (Array.isArray(savedSelection) ? savedSelection : []).forEach((id) => {
    if (byId.has(id) && !remapped.includes(id)) remapped.push(id);
  });

  (Array.isArray(savedIdentities) ? savedIdentities : []).forEach((identity) => {
    if (identity?.id && byId.has(identity.id) && !remapped.includes(identity.id)) {
      remapped.push(identity.id);
      return;
    }
    const first = String(identity?.first_name || '').trim().toLowerCase();
    const last = String(identity?.last_name || '').trim().toLowerCase();
    const dob = identity?.date_of_birth != null ? String(identity.date_of_birth).split('T')[0] : '';
    const match = list.find((p) => {
      const pFirst = String(p.first_name || '').trim().toLowerCase();
      const pLast = String(p.last_name || '').trim().toLowerCase();
      const pDob = p.date_of_birth != null ? String(p.date_of_birth).split('T')[0] : '';
      return pFirst === first && pLast === last && pDob === dob;
    });
    if (match?.id && !remapped.includes(match.id)) remapped.push(match.id);
  });

  return remapped;
}

function resolvePartyBookingFromContext(activity, bookingType, savedContext) {
  if (parsePartyActivitySettings(activity?.ticket_settings, bookingType).isPartyBooking) {
    return true;
  }
  return savedContext?.isPartyBooking === true;
}

function resolvePortalSelectedParticipants(customerParticipants, selectedParticipantIds, customerAccount) {
  const selectedIdsSet = new Set(Array.isArray(selectedParticipantIds) ? selectedParticipantIds : []);
  const byId = (customerParticipants || []).filter((p) => selectedIdsSet.has(p.id));

  const owner =
    (customerParticipants || []).find((p) => p.is_account_owner) ||
    (customerParticipants || []).find((p) => String(p.participant_type || '').toLowerCase() === 'primary');

  const ownerSelected =
    owner &&
    (selectedIdsSet.has(owner.id) ||
      (customerAccount?.id && selectedIdsSet.has(customerAccount.id)));

  if (ownerSelected && owner && !byId.some((p) => p.id === owner.id)) {
    byId.push(owner);
  }

  if (
    customerAccount?.id &&
    selectedIdsSet.has(customerAccount.id) &&
    owner &&
    !byId.some((p) => p.id === owner.id)
  ) {
    byId.push(owner);
  }

  if (
    customerAccount?.id &&
    selectedIdsSet.has(customerAccount.id) &&
    !owner &&
    !byId.some((p) => p.id === customerAccount.id)
  ) {
    const nameParts = String(customerAccount.customer_name || '').trim().split(/\s+/);
    byId.push({
      id: customerAccount.id,
      first_name: nameParts[0] || '',
      last_name: nameParts.slice(1).join(' ') || '',
      date_of_birth: customerAccount.date_of_birth ?? null,
      email: customerAccount.customer_email || customerAccount.email || null,
      phone_number: customerAccount.customer_phone || customerAccount.phone || null,
      participant_type: 'primary',
      is_account_owner: true,
      is_active: true,
    });
  }

  const byIdentity = new Map();
  byId.forEach((p) => {
    const first = (p.first_name || '').trim().toLowerCase();
    const last = (p.last_name || '').trim().toLowerCase();
    const dob = p.date_of_birth != null ? String(p.date_of_birth).split('T')[0] : '';
    const key = `${first}|${last}`;
    const existing = byIdentity.get(key);
    const enriched = {
      ...p,
      date_of_birth:
        p.date_of_birth ||
        (p.is_account_owner ? customerAccount?.date_of_birth : null) ||
        null,
    };
    if (!existing || (enriched.date_of_birth && !existing.date_of_birth) || (enriched.waiver_id && !existing.waiver_id)) {
      byIdentity.set(key, enriched);
    }
  });

  return [...byIdentity.values()];
}

function mergeParticipantSelectionAfterLoad(participantsWithStatus, prevIds = [], savedIds = []) {
  const valid = new Set((participantsWithStatus || []).map((p) => p.id));
  const merged = new Set();
  [...savedIds, ...(Array.isArray(prevIds) ? prevIds : [])].forEach((id) => {
    if (valid.has(id)) merged.add(id);
  });
  (participantsWithStatus || []).forEach((p) => {
    const type = String(p.participant_type || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '_');
    if (
      (type === 'additional_adult' || type === 'additionaladult') &&
      p.waiver_status === 'valid'
    ) {
      merged.add(p.id);
    }
  });
  if (merged.size > 0) return [...merged];
  const primary =
    participantsWithStatus.find((p) => p.is_account_owner) || participantsWithStatus[0];
  return primary?.id ? [primary.id] : [];
}

// Normalize time for Postgres TIME column: "10:00 AM" -> "10:00:00"
function timeToPostgres(timeStr) {
  if (!timeStr || typeof timeStr !== 'string') return timeStr;
  const trimmed = String(timeStr).trim();
  if (/^\d{1,2}:\d{2}:\d{2}$/.test(trimmed)) return trimmed;
  const match = trimmed.match(/^(\d{1,2}):(\d{2})\s*(AM|PM|am|pm)?$/i);
  if (match) {
    let h = parseInt(match[1], 10);
    const m = match[2];
    if (match[3] && /^PM$/i.test(match[3]) && h < 12) h += 12;
    if (match[3] && /^AM$/i.test(match[3]) && h === 12) h = 0;
    return `${String(h).padStart(2, '0')}:${m}:00`;
  }
  if (/^\d{1,2}:\d{2}$/.test(trimmed)) return `${trimmed}:00`;
  return trimmed;
}

function PortalPromoCodeSection({
  resolvedPricingPromotion,
  promoCodeInput,
  setPromoCodeInput,
  onApplyPromoCode,
  onClearPromoCode,
  appliedPromoCode,
}) {
  // A typed code counts as "code-driven" when it actually resolved a promotion whose code matches.
  const appliedCode = String(appliedPromoCode || '').trim();
  const promotionCode = String(resolvedPricingPromotion?.promo_code || '').trim();
  const codeMatchedPromotion = Boolean(
    appliedCode && resolvedPricingPromotion && (
      !promotionCode || promotionCode.toLowerCase() === appliedCode.toLowerCase()
    ),
  );
  const codeRejected = Boolean(appliedCode && !resolvedPricingPromotion);
  // Auto-applied promotion (no code typed) still gets a friendly banner.
  const showAutoPromotion = Boolean(resolvedPricingPromotion && !appliedCode);

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: TavariStyles.colors.gray800, marginBottom: 8 }}>
        Promo code
      </div>

      {showAutoPromotion && (
        <div
          style={{
            marginBottom: 8,
            padding: '12px 14px',
            borderRadius: 8,
            backgroundColor: '#ecfdf5',
            border: '1px solid #a7f3d0',
            color: '#065f46',
            fontSize: 13,
            lineHeight: 1.5,
          }}
        >
          <strong>{resolvedPricingPromotion.name}</strong>
          <div style={{ marginTop: 4 }}>
            {resolvedPricingPromotion.description || 'Special pricing applied to your booking.'}
          </div>
        </div>
      )}

      {codeMatchedPromotion ? (
        <div
          style={{
            padding: '12px 14px',
            borderRadius: 8,
            backgroundColor: '#ecfdf5',
            border: '1px solid #a7f3d0',
            color: '#065f46',
            fontSize: 13,
            lineHeight: 1.5,
            display: 'flex',
            justifyContent: 'space-between',
            gap: 12,
            alignItems: 'flex-start',
          }}
        >
          <div>
            <strong>{appliedCode}</strong>
            <div style={{ marginTop: 4 }}>
              {resolvedPricingPromotion?.name
                ? `${resolvedPricingPromotion.name} applied`
                : 'Promo code applied'}
              {resolvedPricingPromotion?.description ? ` · ${resolvedPricingPromotion.description}` : ''}
            </div>
          </div>
          <button
            type="button"
            onClick={onClearPromoCode}
            style={{
              border: 'none',
              background: 'transparent',
              color: '#047857',
              fontWeight: 600,
              cursor: 'pointer',
              padding: 0,
              whiteSpace: 'nowrap',
            }}
          >
            Remove
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            value={promoCodeInput}
            onChange={(e) => setPromoCodeInput(e.target.value)}
            placeholder="Promo or coupon code"
            autoComplete="off"
            style={{
              flex: 1,
              border: `1px solid ${TavariStyles.colors.gray200}`,
              borderRadius: 8,
              padding: '10px 12px',
              fontSize: 14,
            }}
          />
          <button
            type="button"
            onClick={onApplyPromoCode}
            disabled={!String(promoCodeInput || '').trim()}
            style={{
              border: 'none',
              borderRadius: 8,
              padding: '10px 14px',
              backgroundColor: TavariStyles.colors.primary,
              color: '#fff',
              fontWeight: 600,
              cursor: 'pointer',
              opacity: !String(promoCodeInput || '').trim() ? 0.7 : 1,
            }}
          >
            Apply
          </button>
        </div>
      )}

      {codeRejected ? (
        <div style={{ marginTop: 8, fontSize: 13, color: '#b91c1c' }}>
          That promo code isn’t valid for this booking.
        </div>
      ) : null}
    </div>
  );
}

function PortalGiftCardSection({
  giftCardCodeInput,
  setGiftCardCodeInput,
  appliedGiftCard,
  giftCardError,
  giftCardLoading,
  onApplyGiftCard,
  onClearGiftCard,
}) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: TavariStyles.colors.gray800, marginBottom: 8 }}>
        Gift card
      </div>
      {appliedGiftCard ? (
        <div
          style={{
            padding: '12px 14px',
            borderRadius: 8,
            backgroundColor: '#ecfdf5',
            border: '1px solid #a7f3d0',
            color: '#065f46',
            fontSize: 13,
            lineHeight: 1.5,
            display: 'flex',
            justifyContent: 'space-between',
            gap: 12,
            alignItems: 'flex-start',
          }}
        >
          <div>
            <strong>{appliedGiftCard.code}</strong>
            <div style={{ marginTop: 4 }}>
              Applying ${Number(appliedGiftCard.appliedAmount || 0).toFixed(2)}
              {Number(appliedGiftCard.remainingDue || 0) > 0.009
                ? ` · $${Number(appliedGiftCard.remainingDue).toFixed(2)} still due by card`
                : ' · covers amount due now'}
            </div>
          </div>
          <button
            type="button"
            onClick={onClearGiftCard}
            style={{
              border: 'none',
              background: 'transparent',
              color: '#047857',
              fontWeight: 600,
              cursor: 'pointer',
              padding: 0,
              whiteSpace: 'nowrap',
            }}
          >
            Remove
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            value={giftCardCodeInput}
            onChange={(e) => setGiftCardCodeInput(e.target.value)}
            placeholder="Gift card code"
            autoComplete="off"
            style={{
              flex: 1,
              border: `1px solid ${TavariStyles.colors.gray200}`,
              borderRadius: 8,
              padding: '10px 12px',
              fontSize: 14,
            }}
          />
          <button
            type="button"
            onClick={onApplyGiftCard}
            disabled={giftCardLoading || !String(giftCardCodeInput || '').trim()}
            style={{
              border: 'none',
              borderRadius: 8,
              padding: '10px 14px',
              backgroundColor: TavariStyles.colors.primary,
              color: '#fff',
              fontWeight: 600,
              cursor: giftCardLoading ? 'wait' : 'pointer',
              opacity: giftCardLoading || !String(giftCardCodeInput || '').trim() ? 0.7 : 1,
            }}
          >
            {giftCardLoading ? 'Checking…' : 'Apply'}
          </button>
        </div>
      )}
      {giftCardError ? (
        <div style={{ marginTop: 8, fontSize: 13, color: '#b91c1c' }}>{giftCardError}</div>
      ) : null}
    </div>
  );
}

const CustomerPortalActivityPage = () => {
  const { businessId, activitySlug } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [business, setBusiness] = useState(null);
  const [logoUrl, setLogoUrl] = useState(null);
  const [activity, setActivity] = useState(null);
  const [bookingType, setBookingType] = useState(null);
  const [sections, setSections] = useState([]);
  const [images, setImages] = useState([]);
  const [isMobile, setIsMobile] = useState(() => (
    typeof window !== 'undefined' ? window.innerWidth < 640 : false
  ));
  const [schedules, setSchedules] = useState([]);
  const [businessTimezone, setBusinessTimezone] = useState('America/Toronto');
  const [showSelectDateModal, setShowSelectDateModal] = useState(false);
  const [showTimeSlotsModal, setShowTimeSlotsModal] = useState(false);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [showParticipantModal, setShowParticipantModal] = useState(false);
  const [partyHostParticipantId, setPartyHostParticipantId] = useState(null);
  const [partyBirthdayChildParticipantId, setPartyBirthdayChildParticipantId] = useState(null);
  const [showPortalOptionsModal, setShowPortalOptionsModal] = useState(false);
  const [portalOptionsStepIndex, setPortalOptionsStepIndex] = useState(0);
  const [portalOptionSelections, setPortalOptionSelections] = useState({});
  const [portalBundleCustomizations, setPortalBundleCustomizations] = useState({});
  const [portalOptionInventoryItems, setPortalOptionInventoryItems] = useState([]);
  const [portalOptionBundleContext, setPortalOptionBundleContext] = useState({});
  const [showWaiverStepModal, setShowWaiverStepModal] = useState(false);
  const [showCamperRegistrationStepModal, setShowCamperRegistrationStepModal] = useState(false);
  const [showTermsCheckoutModal, setShowTermsCheckoutModal] = useState(false);
  const [termsAcknowledgment, setTermsAcknowledgment] = useState(null);
  const [showParticipantConfirmationModal, setShowParticipantConfirmationModal] = useState(false);
  const [showTicketSelectionModal, setShowTicketSelectionModal] = useState(false);
  const [showPaymentStep, setShowPaymentStep] = useState(false); // Payment Method step before confirm
  const [defaultWaiverTemplateKey, setDefaultWaiverTemplateKey] = useState(null);
  const [waiverTemplateLoadDone, setWaiverTemplateLoadDone] = useState(false); // true once we've attempted to load template (so we don't show Loading forever)
  const [calendarViewDate, setCalendarViewDate] = useState(() => new Date());
  const [selectedDate, setSelectedDate] = useState(null);
  const [selectedTimeSlot, setSelectedTimeSlot] = useState(null);
  /** When true, auto-advance past the time-slot modal after occupancy loads (individual-date BOOK). */
  const pendingIndividualBookAdvanceRef = useRef(false);
  const [slotHoldActive, setSlotHoldActive] = useState(false);
  const [slotHoldAcquiring, setSlotHoldAcquiring] = useState(false);
  const [slotBookedCounts, setSlotBookedCounts] = useState({});
  const [slotEffectiveRemaining, setSlotEffectiveRemaining] = useState({}); // { slotKey: number } for "spaces left" in time modal
  const [slotOccupancyLoading, setSlotOccupancyLoading] = useState(false);
  const [slotOccupancyReady, setSlotOccupancyReady] = useState(false);
  const [inventoryItems, setInventoryItems] = useState([]); // Inventory items available as tickets
  const [ticketsLoading, setTicketsLoading] = useState(false);
  const [selectedTickets, setSelectedTickets] = useState({}); // { inventoryItemId: quantity }
  const [selectedParticipantTicketAssignments, setSelectedParticipantTicketAssignments] = useState({});
  const [fwpPromotions, setFwpPromotions] = useState([]); // Free-with-purchase promotions for this business
  const fwpPromotionsRef = useRef([]);
  const [bookingPricingPromotions, setBookingPricingPromotions] = useState([]);
  const [promoCodeInput, setPromoCodeInput] = useState('');
  const [appliedPromoCode, setAppliedPromoCode] = useState('');
  const [giftCardCodeInput, setGiftCardCodeInput] = useState('');
  const [appliedGiftCard, setAppliedGiftCard] = useState(null);
  const [giftCardError, setGiftCardError] = useState(null);
  const [giftCardLoading, setGiftCardLoading] = useState(false);
  
  // Login/Account state
  const [phoneNumber, setPhoneNumber] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [otpVerified, setOtpVerified] = useState(false);
  const [customerAccount, setCustomerAccount] = useState(null);
  const [loadingOTP, setLoadingOTP] = useState(false);
  
  // Account creation state (if customer doesn't exist)
  const [showAccountCreation, setShowAccountCreation] = useState(false);
  const [accountForm, setAccountForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    city: ''
  });
  
  // Participants state
  const [customerParticipants, setCustomerParticipants] = useState([]); // All participants for this customer
  const [selectedParticipantIds, setSelectedParticipantIds] = useState([]); // IDs of participants coming to this booking
  const [newParticipant, setNewParticipant] = useState({
    firstName: '',
    lastName: '',
    birthdate: { year: '', month: '', day: '' }
  });
  const [showAddParticipant, setShowAddParticipant] = useState(false);
  const addParticipantFormRef = useRef(null);
  const editParticipantFormRef = useRef(null);
  const [addingPartyBirthdayChild, setAddingPartyBirthdayChild] = useState(false);
  const [editingParticipant1, setEditingParticipant1] = useState(false);
  const [editP1Form, setEditP1Form] = useState({
    firstName: '',
    lastName: '',
    birthdate: { year: '', month: '', day: '' }
  });
  const [editingParticipantId, setEditingParticipantId] = useState(null);
  const [editParticipantForm, setEditParticipantForm] = useState({
    firstName: '',
    lastName: '',
    birthdate: { year: '', month: '', day: '' }
  });

  // HelcimPay.js in-app payment (no redirect)
  const [helcimPayLoading, setHelcimPayLoading] = useState(false);
  const [submitRequestLoading, setSubmitRequestLoading] = useState(false);
  const helcimPayRef = useRef({ checkoutToken: null, pending: null });
  const helcimRealtimeChannelRef = useRef(null);
  const helcimPollingIntervalRef = useRef(null);
  const paymentFinalizedRef = useRef(false);
  const specialHoursAcknowledgedDateRef = useRef(null);
  const specialHoursProceedRef = useRef(null);
  /** Prevents concurrent waiverDone/regDone handlers from racing (clears context mid-flight → skips registration). */
  const portalComplianceReturnHandledRef = useRef({ waiverDone: false, regDone: false });
  /** Lets openPostComplianceStep continue a party booking after waive/skip without reopening the host modal (loop). */
  const proceedToOptionsOrCheckoutRef = useRef(null);

  const [showSpecialHoursReminderModal, setShowSpecialHoursReminderModal] = useState(false);
  const [specialHoursReminderEntry, setSpecialHoursReminderEntry] = useState(null);
  const [customerError, setCustomerError] = useState(null);

  const showCustomerError = useCallback((message, title = 'Something went wrong') => {
    const text =
      typeof message === 'string'
        ? message
        : message?.message || 'We could not complete that step.';
    setCustomerError({
      message: String(text || 'We could not complete that step.'),
      title: typeof title === 'string' && title.trim() ? title : 'Something went wrong',
    });
  }, []);

  const portalUrl = `/customer-portal/${businessId}/portal`;

  const fetchPortalCustomerByPhone = useCallback(async (normalizedPhone) => {
    const { data, error } = await supabase.rpc('bookings_get_portal_customer_by_phone', {
      p_business_id: businessId,
      p_phone_number: normalizedPhone,
    });

    if (error) throw error;

    if (Array.isArray(data)) return data[0] || null;
    return data || null;
  }, [businessId]);

  const fetchPortalCustomerAccount = useCallback(async (customerId) => {
    const { data, error } = await supabase.rpc('bookings_get_portal_customer_account', {
      p_customer_id: customerId,
      p_business_id: businessId,
    });

    if (error) throw error;

    if (Array.isArray(data)) return data[0] || null;
    return data || null;
  }, [businessId]);

  const normalizeDateOnlyString = useCallback((value) => {
    if (!value) return '';
    return String(value).split('T')[0];
  }, []);

  const getParticipantDisplayName = useCallback((participant) => {
    const firstName = String(participant?.first_name || '').trim();
    const lastName = String(participant?.last_name || '').trim();
    return `${firstName} ${lastName}`.trim() || 'Participant';
  }, []);

  const getParticipantWaiverStatus = useCallback((participant) => {
    if (!participant?.waiver_id) return 'missing';
    if (participant?.waiver_is_valid === false) return 'expired';
    if (participant?.waiver_expires_at && isWaiverExpired(participant.waiver_expires_at)) return 'expired';
    if (participant?.waiver_status === 'expired') return 'expired';
    return 'valid';
  }, []);

  const requiresCamperRegistration = useMemo(
    () => camperRegistrationService.activityRequiresRegistration(activity),
    [activity]
  );

  // Auto-select account owner once for general activities. Day camp: never force the adult owner
  // onto the booking — their age won't match camper tickets and blocks checkout.
  const didAutoSelectOwnerRef = useRef(false);
  useEffect(() => {
    if (!otpVerified || !customerAccount?.id) return;
    if (requiresCamperRegistration) {
      didAutoSelectOwnerRef.current = true;
      const ownerParticipant = customerParticipants.find((p) => p.is_account_owner);
      const ownerId = ownerParticipant?.id || customerAccount.id;
      if (ownerId) {
        setSelectedParticipantIds((prev) => (prev.includes(ownerId) ? prev.filter((id) => id !== ownerId) : prev));
      }
      return;
    }
    if (didAutoSelectOwnerRef.current) return;
    const ownerParticipant = customerParticipants.find((p) => p.is_account_owner);
    const ownerId = ownerParticipant?.id || customerAccount.id;
    if (ownerId) {
      setSelectedParticipantIds((prev) => (prev.includes(ownerId) ? prev : [...prev, ownerId]));
      didAutoSelectOwnerRef.current = true;
    }
  }, [otpVerified, customerAccount?.id, customerParticipants, requiresCamperRegistration]);

  useEffect(() => {
    if (!showAddParticipant) return;
    const el = addParticipantFormRef.current;
    if (!el) return;
    // Keep the new form in view — previously it rendered below the participant list.
    requestAnimationFrame(() => {
      el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  }, [showAddParticipant]);

  useEffect(() => {
    if (!editingParticipantId) return;
    const el = editParticipantFormRef.current;
    if (!el) return;
    requestAnimationFrame(() => {
      el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  }, [editingParticipantId]);

  const parsedTicketSettings = useMemo(
    () => parseActivityTicketSettings(activity?.ticket_settings),
    [activity?.ticket_settings]
  );

  const requiresTermsAcknowledgment = useMemo(
    // Auto-approve activities (day camp): acknowledge in checkout.
    // Staff-approval activities (parties): keep post-request Terms email flow.
    () => Boolean(activity?.terms_package_id) && !activityRequiresStaffApproval(parsedTicketSettings),
    [activity?.terms_package_id, parsedTicketSettings]
  );

  const partySettings = useMemo(
    () => parsePartyActivitySettings(activity?.ticket_settings, bookingType),
    [activity?.ticket_settings, bookingType]
  );

  const isPartyBooking = partySettings.isPartyBooking;

  const portalOptionsConfig = useMemo(
    () => enrichPortalOptionsConfig(
      activity?.addon_settings,
      portalOptionInventoryItems,
      portalOptionBundleContext
    ),
    [activity?.addon_settings, portalOptionInventoryItems, portalOptionBundleContext]
  );

  const slotHoldToken = useMemo(() => {
    if (!businessId || !activity?.id) return null;
    return getOrCreateSlotHoldToken(businessId, activity.id);
  }, [businessId, activity?.id]);

  const resetAfterSlotHoldExpired = useCallback((reason) => {
    setSlotHoldActive(false);
    setSelectedTimeSlot(null);
    setShowParticipantModal(false);
    setShowParticipantConfirmationModal(false);
    setShowPortalOptionsModal(false);
    setShowTicketSelectionModal(false);
    setShowPaymentStep(false);
    setShowTimeSlotsModal(true);
    if (reason === 'idle') {
      showCustomerError('Your reservation was released after 2 minutes of inactivity. Please choose a time again.');
    } else {
      showCustomerError('Your 10-minute reservation expired. Please choose a time again.');
    }
  }, []);

  const releaseActiveSlotHold = useCallback(async () => {
    setSlotHoldActive(false);
    if (slotHoldToken) {
      try {
        await releaseBookingSlotHold(slotHoldToken);
      } catch {
        /* best effort */
      }
    }
  }, [slotHoldToken]);

  const { secondsRemaining: slotHoldSecondsRemaining, idleSecondsLeft: slotHoldIdleSecondsLeft } =
    useBookingSlotHold({
      holdToken: slotHoldToken,
      active: slotHoldActive,
      onExpired: resetAfterSlotHoldExpired,
    });

  const completeSlotHoldAfterBooking = useCallback(() => {
    setSlotHoldActive(false);
    if (businessId && activity?.id) {
      clearSlotHoldToken(businessId, activity.id);
    }
    if (slotHoldToken) {
      releaseBookingSlotHold(slotHoldToken).catch(() => {});
    }
  }, [businessId, activity?.id, slotHoldToken]);

  const hasPortalOptions = useMemo(
    () => activityHasPortalOptions(activity?.addon_settings),
    [activity?.addon_settings]
  );

  const selectedPortalOptionsDisplay = useMemo(
    () => listSelectedPortalOptionsForDisplayFromConfig(
      portalOptionsConfig,
      portalOptionSelections,
      portalOptionInventoryItems,
      portalOptionBundleContext,
      portalBundleCustomizations,
      { addonSettingsRaw: activity?.addon_settings }
    ),
    [portalOptionsConfig, portalOptionSelections, portalOptionInventoryItems, portalOptionBundleContext, portalBundleCustomizations, activity?.addon_settings]
  );

  const handleOrderReviewRemove = useCallback(
    (optionId) => {
      setPortalOptionSelections((prev) =>
        removePortalOrderSelection(
          activity?.addon_settings,
          portalOptionsConfig,
          prev,
          optionId
        )
      );
      setPortalBundleCustomizations((prev) => {
        if (!prev?.[optionId]) return prev;
        const next = { ...prev };
        delete next[optionId];
        return next;
      });
    },
    [activity?.addon_settings, portalOptionsConfig]
  );

  const handleOrderReviewEdit = useCallback(
    (_groupId, optionId) => {
      const group =
        findPortalOptionGroupForOption(portalOptionsConfig?.groups || [], optionId) ||
        portalOptionsConfig?.groups?.find((g) => g.id === _groupId);
      const groupId = group?.id || _groupId;
      const stepIndex = findPortalOptionsStepIndexForGroup(
        portalOptionsConfig,
        portalOptionSelections,
        groupId
      );
      setPortalOptionsStepIndex(stepIndex);
      setShowPortalOptionsModal(true);
    },
    [portalOptionsConfig, portalOptionSelections]
  );

  const portalOptionsSubtotal = useMemo(
    () => calculatePortalOptionsSubtotalFromConfig(
      portalOptionsConfig,
      portalOptionSelections
    ),
    [portalOptionsConfig, portalOptionSelections]
  );

  const partyCheckoutReady = useMemo(() => {
    if (!isPartyBooking) return false;
    const ticketCounts = ticketCountsFromAssignments(selectedParticipantTicketAssignments);
    const totalTickets = Object.values(ticketCounts).reduce((sum, qty) => sum + (qty || 0), 0);
    const partyPackageAssignment = partyHostParticipantId
      ? selectedParticipantTicketAssignments[partyHostParticipantId]
      : null;
    const hasPackage =
      !!partyPackageAssignment?.inventory_item_id ||
      (inventoryItems.length > 0 && totalTickets >= 1);
    return (
      !!partyHostParticipantId &&
      (!partySettings.requireBirthdayChild || !!partyBirthdayChildParticipantId) &&
      totalTickets >= 1 &&
      hasPackage
    );
  }, [
    isPartyBooking,
    partyHostParticipantId,
    partyBirthdayChildParticipantId,
    partySettings.requireBirthdayChild,
    selectedParticipantTicketAssignments,
    inventoryItems.length,
  ]);

  const onlinePaymentSettings = useMemo(
    () => parseOnlinePaymentSettings(parsedTicketSettings),
    [parsedTicketSettings]
  );

  const requiresStaffApproval = useMemo(
    () => activityRequiresStaffApproval(parsedTicketSettings),
    [parsedTicketSettings]
  );

  const getParticipantCamperRegistrationStatus = useCallback(
    (participant) => camperRegistrationService.getParticipantStatus(
      participant,
      requiresCamperRegistration,
      selectedDate,
    ),
    [requiresCamperRegistration, selectedDate]
  );

  const participantNeedsCamperRegistration = useCallback(
    (participant) => {
      if (!camperRegistrationService.participantRequiresCamperRegistration(participant, requiresCamperRegistration)) {
        return false;
      }
      const status = camperRegistrationService.getParticipantStatus(
        participant,
        requiresCamperRegistration,
        selectedDate,
      );
      return status === 'missing' || status === 'expired';
    },
    [requiresCamperRegistration, selectedDate]
  );

  const enrichParticipantsWithWaiverStatus = useCallback(async (participants = []) => {
    const list = Array.isArray(participants) ? participants : [];
    const waiverIds = Array.from(
      new Set(
        list
          .map((participant) =>
            typeof participant?.waiver_id === 'string' && participant.waiver_id.trim()
              ? participant.waiver_id.trim()
              : null
          )
          .filter(Boolean)
      )
    );

    if (waiverIds.length === 0) {
      return list.map((participant) => ({
        ...participant,
        waiver_is_valid: null,
        waiver_expires_at: null,
        waiver_status: 'missing'
      }));
    }

    const { data: waiverRows, error: waiverRowsError } = await supabase.rpc('bookings_get_portal_waiver_statuses', {
      p_business_id: businessId,
      p_waiver_ids: waiverIds,
    });

    if (waiverRowsError) {
      console.warn('[CustomerPortal] Failed to load waiver validity for participants:', waiverRowsError);
      return list.map((participant) => ({
        ...participant,
        waiver_status: participant?.waiver_status || (participant?.waiver_id ? 'missing' : 'missing')
      }));
    }

    const waiverById = new Map((waiverRows || []).map((waiver) => [waiver.id, waiver]));

    return list.map((participant) => {
      const waiverId =
        typeof participant?.waiver_id === 'string' && participant.waiver_id.trim()
          ? participant.waiver_id.trim()
          : null;
      const waiver = waiverId ? waiverById.get(waiverId) : null;
      const waiverStatus =
        !waiverId
          ? 'missing'
          : !waiver
            ? 'missing'
            : waiver.is_valid === false || (waiver.expires_at && isWaiverExpired(waiver.expires_at))
              ? 'expired'
              : 'valid';

      return {
        ...participant,
        waiver_is_valid: waiver?.is_valid ?? null,
        waiver_expires_at: waiver?.expires_at ?? null,
        waiver_status: waiverStatus
      };
    });
  }, [businessId]);

  const enrichParticipantsWithComplianceStatus = useCallback(
    async (participants = [], customerId = customerAccount?.id) => {
      const withWaiver = await enrichParticipantsWithWaiverStatus(participants);
      camperRegistrationService.setBusinessId(businessId);
      const registrations =
        requiresCamperRegistration && customerId
          ? await camperRegistrationService.getCustomerRegistrations(customerId)
          : [];
      return camperRegistrationService.enrichParticipants(
        withWaiver,
        registrations,
        requiresCamperRegistration,
        selectedDate,
      );
    },
    [businessId, customerAccount?.id, enrichParticipantsWithWaiverStatus, requiresCamperRegistration, selectedDate]
  );

  const selectedParticipantsNeedingWaiver = useMemo(
    () =>
      customerParticipants.filter(
        (participant) =>
          selectedParticipantIds.includes(participant.id) && getParticipantWaiverStatus(participant) !== 'valid'
      ),
    [customerParticipants, selectedParticipantIds, getParticipantWaiverStatus]
  );

  const selectedParticipantsNeedingCamperRegistration = useMemo(
    () =>
      customerParticipants.filter(
        (participant) =>
          selectedParticipantIds.includes(participant.id) && participantNeedsCamperRegistration(participant)
      ),
    [customerParticipants, selectedParticipantIds, participantNeedsCamperRegistration]
  );

  const openPostComplianceStep = useCallback(
    (
      participants = customerParticipants,
      selectedIds = selectedParticipantIds,
      { skipWaiverCheck = false, savedContext = null, termsAckOverride = null } = {}
    ) => {
      const partyBooking = resolvePartyBookingFromContext(activity, bookingType, savedContext);
      let effectiveIds = Array.isArray(selectedIds) ? selectedIds : [];
      if (savedContext?.selectedParticipantIdentities?.length) {
        effectiveIds = remapSavedParticipantSelection(
          effectiveIds,
          savedContext.selectedParticipantIdentities,
          participants
        );
      }
      let selected = resolvePortalSelectedParticipants(participants, effectiveIds, customerAccount);
      // If ID-based selection is empty after waiver/roster reload, recover from saved identities.
      if (
        (!selected || selected.length === 0) &&
        Array.isArray(savedContext?.selectedParticipantIdentities) &&
        savedContext.selectedParticipantIdentities.length > 0
      ) {
        const recoveredIds = remapSavedParticipantSelection(
          [],
          savedContext.selectedParticipantIdentities,
          participants
        );
        if (recoveredIds.length) {
          effectiveIds = recoveredIds;
          selected = resolvePortalSelectedParticipants(participants, recoveredIds, customerAccount);
          setSelectedParticipantIds(recoveredIds);
        }
      }
      const needsWaiver =
        !skipWaiverCheck &&
        selected.some((participant) => getParticipantWaiverStatus(participant) !== 'valid');
      if (needsWaiver) {
        setShowCamperRegistrationStepModal(false);
        setShowTermsCheckoutModal(false);
        setShowParticipantConfirmationModal(false);
        setShowParticipantModal(false);
        setShowWaiverStepModal(true);
        return;
      }
      const needsRegistration = selected.some((participant) => participantNeedsCamperRegistration(participant));
      if (needsRegistration) {
        setShowWaiverStepModal(false);
        setShowTermsCheckoutModal(false);
        setShowParticipantConfirmationModal(false);
        setShowParticipantModal(false);
        setShowCamperRegistrationStepModal(true);
        return;
      }
      // Day camp safety net: roster reload can drop/remap selection IDs after waiver.
      // Prefer identity-matched campers; if any still need registration, open that step.
      if (requiresCamperRegistration && Array.isArray(savedContext?.selectedParticipantIdentities)) {
        const identityIds = remapSavedParticipantSelection(
          [],
          savedContext.selectedParticipantIdentities,
          participants
        );
        const identitySelected = resolvePortalSelectedParticipants(participants, identityIds, customerAccount);
        if (identitySelected.some((participant) => participantNeedsCamperRegistration(participant))) {
          if (identityIds.length) setSelectedParticipantIds(identityIds);
          setShowWaiverStepModal(false);
          setShowTermsCheckoutModal(false);
          setShowParticipantConfirmationModal(false);
          setShowParticipantModal(false);
          setShowCamperRegistrationStepModal(true);
          return;
        }
        // Identity remap failed but we still know which campers were selected — do not skip to T&Cs.
        if (
          (!selected || selected.length === 0) &&
          savedContext.selectedParticipantIdentities.length > 0
        ) {
          setShowWaiverStepModal(false);
          setShowTermsCheckoutModal(false);
          setShowParticipantConfirmationModal(false);
          setShowCamperRegistrationStepModal(false);
          setShowParticipantModal(true);
          return;
        }
      }
      const effectiveTermsAck = termsAckOverride || termsAcknowledgment;
      const needsTerms = requiresTermsAcknowledgment && !effectiveTermsAck;
      if (needsTerms) {
        setShowWaiverStepModal(false);
        setShowCamperRegistrationStepModal(false);
        setShowParticipantConfirmationModal(false);
        setShowParticipantModal(false);
        setShowTermsCheckoutModal(true);
        return;
      }
      setShowWaiverStepModal(false);
      setShowCamperRegistrationStepModal(false);
      setShowTermsCheckoutModal(false);
      if (partyBooking) {
        // Party host/birthday were already chosen before the waiver step. Reopening the
        // participant modal after Skip sends Next → waiver → Skip in a loop.
        setShowParticipantConfirmationModal(false);
        setShowParticipantModal(false);
        void proceedToOptionsOrCheckoutRef.current?.();
      } else {
        setShowParticipantModal(false);
        setShowParticipantConfirmationModal(true);
      }
    },
    [
      activity,
      bookingType,
      customerAccount,
      customerParticipants,
      getParticipantWaiverStatus,
      participantNeedsCamperRegistration,
      requiresTermsAcknowledgment,
      requiresCamperRegistration,
      selectedParticipantIds,
      termsAcknowledgment,
    ]
  );

  const persistBookingPortalContext = useCallback(() => {
    writeSavedBookingPortalContext(
      businessId,
      activitySlug,
      buildBookingPortalContextSnapshot({
        selectedDate,
        selectedTimeSlot,
        customerAccount,
        isPartyBooking,
        partyHostParticipantId,
        partyBirthdayChildParticipantId,
        selectedParticipantIds,
        customerParticipants,
      })
    );
    writeSavedParticipantSelection(businessId, activitySlug, selectedParticipantIds);
  }, [
    businessId,
    activitySlug,
    selectedDate,
    selectedTimeSlot,
    customerAccount,
    isPartyBooking,
    partyHostParticipantId,
    partyBirthdayChildParticipantId,
    selectedParticipantIds,
    customerParticipants,
  ]);

  const reportBookingFunnel = useCallback(
    (stage, pendingHelcimId = null) => {
      if (!businessId || !activity?.id) return;
      const sessionKey = getBookingFunnelSessionKey(businessId, activity.id);
      if (!sessionKey) return;
      const em = (customerAccount?.customer_email || customerAccount?.email || '').trim() || null;
      recordBookingFunnelActivity({
        businessId,
        activityId: activity.id,
        sessionKey,
        stage,
        customerId: customerAccount?.id || undefined,
        customerEmail: em || undefined,
        pendingHelcimId: pendingHelcimId || undefined,
      });
    },
    [businessId, activity?.id, customerAccount]
  );

  useEffect(() => {
    if (activity?.id && businessId) {
      reportBookingFunnel('activity_view');
    }
  }, [activity?.id, businessId, reportBookingFunnel]);

  useEffect(() => {
    if (selectedDate) reportBookingFunnel('date_time');
  }, [selectedDate, reportBookingFunnel]);

  useEffect(() => {
    if (selectedTimeSlot) reportBookingFunnel('date_time');
  }, [selectedTimeSlot, reportBookingFunnel]);

  useEffect(() => {
    if (showParticipantModal) reportBookingFunnel('participants');
  }, [showParticipantModal, reportBookingFunnel]);

  useEffect(() => {
    if (!showParticipantModal || !customerAccount?.id || !businessId) return;
    loadCustomerAccount(customerAccount.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- loadCustomerAccount is not memoized; refresh when modal opens
  }, [showParticipantModal, customerAccount?.id, businessId]);

  useEffect(() => {
    if (showTicketSelectionModal) reportBookingFunnel('tickets');
  }, [showTicketSelectionModal, reportBookingFunnel]);

  useEffect(() => {
    if (showPaymentStep) reportBookingFunnel('payment');
  }, [showPaymentStep, reportBookingFunnel]);

  useEffect(() => {
    if (!businessId || !activitySlug) return;
    loadData();
  }, [businessId, activitySlug]);

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 640);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Load default waiver template when waiver step opens; persist date/time for return from waiver
  useEffect(() => {
    if (!showWaiverStepModal || !businessId) return;
    setWaiverTemplateLoadDone(false);
    if (!defaultWaiverTemplateKey) {
      (async () => {
        try {
          const { data, error } = await supabase.from('waiver_templates').select('template_key').eq('business_id', businessId).eq('is_active', true).order('version', { ascending: false }).limit(1).maybeSingle();
          if (error) console.warn('[CustomerPortal] Waiver template load failed:', error);
          if (data?.template_key) setDefaultWaiverTemplateKey(data.template_key);
        } finally {
          setWaiverTemplateLoadDone(true);
        }
      })();
    } else {
      setWaiverTemplateLoadDone(true);
    }
    try {
      persistBookingPortalContext();
    } catch (_) {}
  }, [showWaiverStepModal, businessId, activitySlug, defaultWaiverTemplateKey, persistBookingPortalContext]);

  // Navigate to booking waiver flow with state (no token) – same DB as waiver module
  const handleCompleteWaiversClick = useCallback(() => {
    if (!customerAccount?.id || !businessId) return;
    persistBookingPortalContext();
    const returnUrl = window.location.origin + location.pathname + (location.search ? location.search + '&' : '?') + 'waiverDone=1';
    const pathname = defaultWaiverTemplateKey
      ? `/waiver-from-booking/${businessId}/${defaultWaiverTemplateKey}`
      : `/waiver-from-booking/${businessId}`;
    const search = `?${new URLSearchParams({ returnUrl }).toString()}`;
    const state = { customerAccount, customerParticipants, returnUrl };
    console.log('[CustomerPortal] Navigating to booking waiver flow with state', {
      pathname: pathname + search,
      customerAccountKeys: customerAccount ? Object.keys(customerAccount) : [],
      customerAccountId: customerAccount?.id,
      customerAccountPhone: customerAccount?.phone ?? customerAccount?.customer_phone,
      customerAccountEmail: customerAccount?.email ?? customerAccount?.customer_email,
      customerAccountName: customerAccount?.customer_name,
      customerParticipantsCount: (customerParticipants || []).length,
      firstParticipant: (customerParticipants || [])[0] ? { keys: Object.keys((customerParticipants || [])[0]), first_name: (customerParticipants || [])[0].first_name, last_name: (customerParticipants || [])[0].last_name, email: (customerParticipants || [])[0].email, phone_number: (customerParticipants || [])[0].phone_number } : null
    });
    navigate(pathname + search, {
      state,
      replace: false
    });
  }, [customerAccount, businessId, defaultWaiverTemplateKey, customerParticipants, location.pathname, location.search, navigate, persistBookingPortalContext]);

  const handleOpenCamperRegistration = useCallback(
    (participant) => {
      if (!customerAccount?.id || !businessId || !participant?.id) return;
      if (!camperRegistrationService.participantRequiresCamperRegistration(participant, requiresCamperRegistration)) {
        return;
      }
      writeSavedParticipantSelection(businessId, activitySlug, selectedParticipantIds);
      const returnUrl =
        window.location.origin +
        location.pathname +
        (location.search ? `${location.search}&` : '?') +
        'regDone=1';
      persistBookingPortalContext();
      const params = new URLSearchParams({ returnUrl });
      if (selectedDate) params.set('campDate', String(selectedDate).slice(0, 10));
      navigate(
        `/customer-portal/${businessId}/camper-registration/${encodeURIComponent(participant.id)}?${params.toString()}`,
        {
          state: { participant, customerAccount, returnUrl, campDate: selectedDate },
        }
      );
    },
    [
      businessId,
      activitySlug,
      customerAccount,
      location.pathname,
      location.search,
      navigate,
      selectedDate,
      selectedParticipantIds,
      selectedTimeSlot,
      requiresCamperRegistration,
      persistBookingPortalContext,
    ]
  );

  // Persist booking context while camper registration step is open
  useEffect(() => {
    if (!showCamperRegistrationStepModal || !businessId) return;
    try {
      persistBookingPortalContext();
    } catch (_) {}
  }, [showCamperRegistrationStepModal, businessId, persistBookingPortalContext]);

  // Load inventory items when ticket selection modal opens
  useEffect(() => {
    if (showTicketSelectionModal && businessId && activity) {
      loadInventoryItemsForTickets();
    }
  }, [showTicketSelectionModal, businessId, activity]);

  // HelcimPay.js: listen for payment result (SUCCESS/ABORTED/HIDE) and create booking on SUCCESS
  const helcimPayMessageHandlerRef = useRef(null);

  useEffect(() => {
    const handler = (event) => {
      const ref = helcimPayRef.current;
      if (!ref.checkoutToken) return;
      const key = `helcim-pay-js-${ref.checkoutToken}`;
      if (event.data?.eventName !== key) return;

      if (event.data.eventStatus === 'SUCCESS') {
        console.log('[CustomerPortal] HelcimPay SUCCESS received', { hasPending: !!ref.pending });
      }

      const removeIframeElement = () => {
        const frame = document.getElementById('helcimPayIframe');
        if (frame?.parentNode) frame.remove();
      };

      const removeIframe = () => {
        removeIframeElement();
        if (helcimPayMessageHandlerRef.current) {
          window.removeEventListener('message', helcimPayMessageHandlerRef.current);
        }
        helcimPayRef.current = { checkoutToken: null, pending: null };
        if (helcimRealtimeChannelRef.current) {
          supabase.removeChannel(helcimRealtimeChannelRef.current);
          helcimRealtimeChannelRef.current = null;
        }
        if (helcimPollingIntervalRef.current) {
          clearInterval(helcimPollingIntervalRef.current);
          helcimPollingIntervalRef.current = null;
        }
        setHelcimPayLoading(false);
      };

      const finalizeCompletedBooking = async (bookingId, manageToken = null) => {
        if (paymentFinalizedRef.current) return;
        paymentFinalizedRef.current = true;
        completeSlotHoldAfterBooking();
        const pending = helcimPayRef.current.pending;
        if (helcimRealtimeChannelRef.current) {
          supabase.removeChannel(helcimRealtimeChannelRef.current);
          helcimRealtimeChannelRef.current = null;
        }
        if (helcimPayMessageHandlerRef.current) {
          window.removeEventListener('message', helcimPayMessageHandlerRef.current);
        }
        if (helcimPollingIntervalRef.current) {
          clearInterval(helcimPollingIntervalRef.current);
          helcimPollingIntervalRef.current = null;
        }
        helcimPayRef.current = { checkoutToken: null, pending: null };
        setHelcimPayLoading(false);
        setShowTicketSelectionModal(false);
        setShowPaymentStep(false);
        if (pending?.customerAccountId && pending?.subtotal && bookingId) {
          bookingLoyaltyIntegration.setBusinessId(pending.businessId);
          await bookingLoyaltyIntegration.awardPointsForBooking(bookingId, pending.customerAccountId, pending.subtotal);
        }
        if (pending?.businessId && bookingId) {
          try {
            const token = await ensureBookingManageToken(pending.businessId, bookingId, manageToken);
            navigate(buildBookingConfirmedPath(pending.businessId, bookingId, token));
          } catch (tokenErr) {
            console.error('Confirmation token error:', tokenErr);
            showCustomerError(tokenErr?.message || 'Could not open confirmation page');
          }
        }
      };

      const startPollingForCompletion = (checkoutToken) => {
        if (!checkoutToken || helcimPollingIntervalRef.current) return;
        let attempts = 0;
        const maxAttempts = 40;
        helcimPollingIntervalRef.current = setInterval(async () => {
          attempts += 1;
          if (attempts > maxAttempts) {
            if (helcimPollingIntervalRef.current) clearInterval(helcimPollingIntervalRef.current);
            helcimPollingIntervalRef.current = null;
            return;
          }
          try {
            const { data, error } = await supabase.functions.invoke('helcim-pay-status', {
              body: { checkoutToken },
            });
            if (error) return;
            if (data?.status === 'completed' && data?.bookingId) {
              await finalizeCompletedBooking(data.bookingId, data.manageToken || null);
            }
          } catch (_) {}
        }, 3000);
      };

      if (event.data.eventStatus === 'SUCCESS') {
        if (paymentFinalizedRef.current) {
          removeIframe();
          return;
        }
        const msg = event.data.eventMessage;
        let customerCodeFromHelcim = null;
        try {
          const parsed = typeof msg === 'string' ? JSON.parse(msg) : msg;
          const data = parsed?.data ?? parsed;
          customerCodeFromHelcim = data?.customerCode ?? data?.customer_code ?? null;
        } catch (_) {}
        if (!ref.pending) {
          removeIframe();
          showCustomerError('Session expired. Please try again.');
          return;
        }
        (async () => {
          try {
            if (ref.checkoutToken && customerCodeFromHelcim) {
              await supabase.functions.invoke('save-helcim-customer-code', {
                body: { checkoutToken: ref.checkoutToken, customerCode: customerCodeFromHelcim },
              });
              setCustomerAccount((prev) => {
                if (!prev?.id) return prev;
                const next = { ...prev, helcim_customer_code: customerCodeFromHelcim };
                const bid = ref.pending?.businessId;
                if (bid) saveCustomerPortalSession(bid, next);
                return next;
              });
            }
            removeIframeElement();
            setHelcimPayLoading(false);

            const { data: finData, error: finError } = await supabase.functions.invoke('helcim-pay-finalize', {
              body: { checkoutToken: ref.checkoutToken, eventMessage: msg },
            });
            if (!finError && finData?.bookingId) {
              toast.success('Booking confirmed!');
              await finalizeCompletedBooking(finData.bookingId, finData.manageToken || null);
              return;
            }

            const finErrText = await getFunctionsInvokeErrorMessage(finError, finData);
            console.error('[CustomerPortal] helcim-pay-finalize failed:', finErrText, finData);
            showCustomerError(
              finErrText && finErrText.length < 220 ? finErrText : 'Confirming booking… please wait.'
            );
            startPollingForCompletion(ref.checkoutToken);
            try {
              const token = ref.checkoutToken;
              if (!token) return;
              const { data: stData, error: stErr } = await supabase.functions.invoke('helcim-pay-status', {
                body: { checkoutToken: token },
              });
              if (!stErr && stData?.status === 'completed' && stData?.bookingId && !paymentFinalizedRef.current) {
                toast.success('Booking confirmed!');
                await finalizeCompletedBooking(stData.bookingId, stData.manageToken || null);
              }
            } catch (_) {}
          } catch (err) {
            console.error('Error waiting for booking finalization after HelcimPay:', err);
            showCustomerError('Payment received, but booking finalization is still processing. Please wait a moment.');
          }
        })();
      } else if (event.data.eventStatus === 'ABORTED') {
        showCustomerError(event.data.eventMessage || 'Payment was declined.');
        removeIframe();
      } else if (event.data.eventStatus === 'HIDE') {
        removeIframeElement();
        setHelcimPayLoading(false);
        startPollingForCompletion(ref.checkoutToken);
      }
    };
    helcimPayMessageHandlerRef.current = handler;
    window.addEventListener('message', handler);
    return () => {
      window.removeEventListener('message', handler);
      if (helcimPollingIntervalRef.current) {
        clearInterval(helcimPollingIntervalRef.current);
        helcimPollingIntervalRef.current = null;
      }
      if (helcimRealtimeChannelRef.current) {
        supabase.removeChannel(helcimRealtimeChannelRef.current);
        helcimRealtimeChannelRef.current = null;
      }
    };
  }, []);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [businessRes, brandingRes, activityRes, catalogRes, galleryRes] = await Promise.all([
        supabase.from('businesses').select('id, name, business_address, business_email, business_phone, business_website, timezone, holiday_hours, operating_hours').eq('id', businessId).single(),
        supabase.from('app_branding').select('logo_url').eq('business_id', businessId).maybeSingle(),
        supabase
          .from('booking_activities')
          .select('*')
          .eq('id', activitySlug)
          .eq('business_id', businessId)
          .eq('is_active', true)
          .single(),
        fetchTavariApiBookingCatalog(businessId).catch((catalogError) => {
          console.error('[CustomerPortal] booking catalog load failed:', catalogError);
          return { activities: [] };
        }),
        fetchTavariApiWebsiteGallery(businessId, { limit: 3 }).catch((galleryError) => {
          console.error('[CustomerPortal] website gallery load failed:', galleryError);
          return { images: [] };
        }),
      ]);

      if (businessRes.error || !businessRes.data) {
        setError('Business not found.');
        setLoading(false);
        return;
      }
      if (activityRes.error || !activityRes.data) {
        setError('Activity not found.');
        setLoading(false);
        return;
      }
      if (activityRes.data.portal_visible === false) {
        setError('This activity is not available for online booking. Please contact the venue if you need help.');
        setLoading(false);
        return;
      }

      setBusiness(businessRes.data);
      setBusinessTimezone(businessRes.data?.timezone || 'America/Toronto');
      setLogoUrl(brandingRes.data?.logo_url || null);

      const catalogActivity = (catalogRes?.activities || []).find((row) => row.id === activitySlug) || null;
      const mergedActivity = mergePortalActivityWithCatalog(activityRes.data, catalogActivity);
      setActivity(mergedActivity);

      const activityData = mergedActivity;
      if (activityData?.type_id) {
        const { data: typeRow } = await supabase
          .from('booking_types')
          .select('id, type_name, type_key, display_name, session_rules')
          .eq('id', activityData.type_id)
          .eq('business_id', businessId)
          .maybeSingle();
        setBookingType(typeRow || null);
      } else {
        setBookingType(null);
      }
      console.log('[CustomerPortal] Loaded activity:', {
        id: activityData?.id,
        name: activityData?.activity_name,
        max_advance_value: activityData?.max_advance_booking_value,
        max_advance_unit: activityData?.max_advance_booking_unit,
        min_notice_value: activityData?.min_advance_booking_value,
        min_notice_unit: activityData?.min_advance_booking_unit,
        ticket_settings: activityData?.ticket_settings,
        ticket_settings_type: typeof activityData?.ticket_settings,
        allKeys: Object.keys(activityData || {})
      });
      
      // Warn if max advance columns don't exist
      if (activityData && !('max_advance_booking_value' in activityData)) {
        console.warn('[CustomerPortal] WARNING: max_advance_booking_value column not found in activity data. The SQL migration may not have been run.');
      }

      let resolvedImages = resolveActivityImageUrls(activityRes.data, catalogActivity);
      if (resolvedImages.length === 0) {
        resolvedImages = (galleryRes?.images || [])
          .map((row) => row?.imageUrl || row?.image_url)
          .filter(Boolean)
          .slice(0, 3);
      }
      setImages(resolvedImages);

      const [sectionsRes, schedulesRes] = await Promise.all([
        supabase
          .from('booking_activity_sections')
          .select('id, section_header, section_details, display_order')
          .eq('activity_id', activitySlug)
          .order('display_order'),
        supabase
          .from('booking_activity_schedules')
          .select('id, day_of_week, start_time, start_date, end_date, spaces, resource_assignments, schedule_name')
          .eq('activity_id', activitySlug)
          .eq('business_id', businessId)
          .eq('is_active', true),
      ]);

      const sorted = ((sectionsRes.data || []).slice()).sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0));
      setSections(sorted);
      setSchedules(schedulesRes.data || []);
    } catch (e) {
      setError(e?.message || 'Failed to load activity.');
    } finally {
      setLoading(false);
    }
  };

  const getDaysInMonth = (baseDate) => {
    const d = dayjs(baseDate);
    const first = d.startOf('month');
    const last = d.endOf('month');
    const daysInMonth = last.date();
    const startPad = first.day();
    const days = [];
    for (let i = 0; i < startPad; i++) days.push(null);
    for (let day = 1; day <= daysInMonth; day++) days.push(first.date(day).toDate());
    return days;
  };

  const navigateMonth = (delta) => {
    setCalendarViewDate((d) => dayjs(d).add(delta, 'month').toDate());
  };

  const fmt = (date) => dayjs(date).tz(businessTimezone).format('YYYY-MM-DD');

  const getSchedulesForActivityOnDate = useCallback(
    (date) => {
      const raw = pickSchedulesForActivityOnDate(schedules, date, businessTimezone);
      return dedupeSchedulesByStartTime(raw);
    },
    [schedules, businessTimezone],
  );

  const todayStr = useMemo(
    () => dayjs().tz(businessTimezone).startOf('day').format('YYYY-MM-DD'),
    [businessTimezone]
  );

  /* Advanced booking rules (from activity settings): max advance + min notice */
  const maxAdvance = useMemo(() => {
    const v = activity?.max_advance_booking_value ?? 0;
    const u = activity?.max_advance_booking_unit || 'days';
    const numValue = typeof v === 'number' ? v : parseInt(v, 10) || 0;
    console.log('[CustomerPortal] Max advance calculation:', { rawValue: v, numValue, unit: u, activityId: activity?.id });
    if (!numValue || numValue <= 0) {
      console.log('[CustomerPortal] Max advance disabled (value is 0 or invalid)');
      return null;
    }
    const result = { value: numValue, unit: u };
    console.log('[CustomerPortal] Max advance enabled:', result);
    return result;
  }, [activity?.max_advance_booking_value, activity?.max_advance_booking_unit, activity?.id]);

  const minNotice = useMemo(() => {
    const v = activity?.min_advance_booking_value ?? 0;
    const u = activity?.min_advance_booking_unit || 'minutes';
    const numValue = typeof v === 'number' ? v : parseInt(v, 10) || 0;
    if (!numValue) return null;
    return { value: numValue, unit: u };
  }, [activity?.min_advance_booking_value, activity?.min_advance_booking_unit]);

  const latestAllowedDateStr = useMemo(() => {
    if (!maxAdvance) {
      console.log('[CustomerPortal] No max advance restriction');
      return null;
    }
    const today = dayjs().tz(businessTimezone).startOf('day');
    const u = maxAdvance.unit === 'months' ? 'month' : maxAdvance.unit;
    // Add the max advance period to today to get the latest allowed date
    // If max is 20 days, today + 20 days is the last allowed date (inclusive)
    const latestAllowed = today.add(maxAdvance.value, u).startOf('day');
    const result = latestAllowed.format('YYYY-MM-DD');
    console.log('[CustomerPortal] Max advance calculation:', {
      maxAdvance,
      today: today.format('YYYY-MM-DD'),
      latestAllowedDate: result,
      unit: u,
      value: maxAdvance.value
    });
    return result;
  }, [maxAdvance, businessTimezone]);

  const availableDatesForMonth = useMemo(() => {
    const year = dayjs(calendarViewDate).tz(businessTimezone).year();
    const month = dayjs(calendarViewDate).tz(businessTimezone).month();
    const first = dayjs.tz(`${year}-${String(month + 1).padStart(2, '0')}-01`, businessTimezone);
    const last = first.endOf('month');
    const out = new Set();
    let skippedCount = 0;
    const maxDate = latestAllowedDateStr ? dayjs(latestAllowedDateStr).tz(businessTimezone).startOf('day') : null;
    const today = dayjs().tz(businessTimezone).startOf('day');
    
    for (let d = first; d.isBefore(last) || d.isSame(last, 'day'); d = d.add(1, 'day')) {
      const dStart = d.startOf('day');
      
      // Skip past dates
      if (dStart.isBefore(today)) {
        continue;
      }
      
      // Skip dates beyond max advance
      if (maxDate && dStart.isAfter(maxDate)) {
        skippedCount++;
        continue;
      }
      
      const arr = getSchedulesForActivityOnDate(d.toDate());
      if (arr.length) {
        const ds = d.format('YYYY-MM-DD');
        // Portal trusts published activity schedules. Only hide fully closed days —
        // day camps often start before general open (e.g. 8:30 vs 10:00).
        if (isDateClosedForBookings(business?.operating_hours, business?.holiday_hours, ds)) {
          continue;
        }
        out.add(ds);
      }
    }
    if (latestAllowedDateStr && skippedCount > 0) {
      console.log('[CustomerPortal] Filtered out', skippedCount, 'dates beyond max advance', latestAllowedDateStr);
    }
    return out;
  }, [calendarViewDate, businessTimezone, getSchedulesForActivityOnDate, latestAllowedDateStr, business?.holiday_hours, business?.operating_hours]);

  const multiDayConfig = useMemo(
    () => parseMultiDaySettings(activity?.ticket_settings, activity?.duration_minutes),
    [activity?.ticket_settings, activity?.duration_minutes],
  );

  const isMultiDaySchedule = useMemo(
    () => shouldUseMultiDayPortalListing(schedules, activity?.ticket_settings),
    [schedules, activity?.ticket_settings],
  );

  const isIndividualSchedule = useMemo(
    () => !isMultiDaySchedule && isIndividualDatesSchedule(schedules),
    [schedules, isMultiDaySchedule],
  );

  const isPast = useCallback((date) => {
    if (!date) return false;
    const dateDayjs = dayjs(date).tz(businessTimezone).startOf('day');
    const todayDayjs = dayjs().tz(businessTimezone).startOf('day');
    return dateDayjs.isBefore(todayDayjs);
  }, [businessTimezone]);

  /** Multi-day / week camp: only series start dates are bookable (never Tue–Fri as separate picks). */
  const multiDaySeriesEntries = useMemo(() => {
    if (!isMultiDaySchedule) return [];
    const filterOpts = {
      todayStr,
      latestAllowedDateStr,
      isDateClosed: (dateStr) =>
        isDateClosedForBookings(business?.operating_hours, business?.holiday_hours, dateStr),
    };
    let entries = listMultiDaySeriesPortalEntries(schedules, filterOpts);
    if (!entries.length && multiDayConfig) {
      entries = listMultiDayAnchorPortalEntriesFromConfig(schedules, multiDayConfig, filterOpts);
    }
    const durationMins =
      multiDayConfig?.dailyDurationMinutes
      || Number(activity?.duration_minutes)
      || 0;
    const dayCount = multiDayConfig?.dayCount || entries[0]?.followingDateKeys?.length + 1 || 5;
    return entries.map((series) => {
      const date = dayjs.tz(series.anchorDateKey, businessTimezone).toDate();
      return {
        ...series,
        date,
        label: dayjs.tz(series.anchorDateKey, businessTimezone).format('dddd, D MMMM YYYY'),
        dayCount: series.dayCount || dayCount,
        durationMins,
      };
    });
  }, [
    isMultiDaySchedule,
    schedules,
    todayStr,
    latestAllowedDateStr,
    business?.operating_hours,
    business?.holiday_hours,
    businessTimezone,
    multiDayConfig,
    activity?.duration_minutes,
  ]);

  const isAvailable = useCallback((date) => {
    if (!date) return false;
    const dateStr = fmt(date);
    const dateDayjs = dayjs(dateStr).tz(businessTimezone).startOf('day');
    const todayDayjs = dayjs().tz(businessTimezone).startOf('day');

    if (dateDayjs.isBefore(todayDayjs)) {
      return false;
    }

    if (latestAllowedDateStr) {
      const maxDayjs = dayjs(latestAllowedDateStr).tz(businessTimezone).startOf('day');
      if (dateDayjs.isAfter(maxDayjs)) {
        return false;
      }
    }

    if (isDateClosedForBookings(business?.operating_hours, business?.holiday_hours, dateStr)) {
      return false;
    }

    if (isMultiDaySchedule) {
      return multiDaySeriesEntries.some((entry) => entry.anchorDateKey === dateStr);
    }
    if (isIndividualSchedule) {
      return getSchedulesForActivityOnDate(date).length > 0;
    }
    if (!availableDatesForMonth.has(dateStr)) {
      return false;
    }

    return true;
  }, [
    businessTimezone,
    latestAllowedDateStr,
    business?.operating_hours,
    business?.holiday_hours,
    isMultiDaySchedule,
    multiDaySeriesEntries,
    isIndividualSchedule,
    getSchedulesForActivityOnDate,
    availableDatesForMonth,
  ]);

  /** Specific-day activities: all future bookable dates (no month calendar walking). */
  const individualDateEntries = useMemo(() => {
    if (!isIndividualSchedule) return [];
    const keys = listIndividualScheduleDateKeys(schedules, {
      todayStr,
      latestAllowedDateStr,
      isDateClosed: (dateStr) =>
        isDateClosedForBookings(business?.operating_hours, business?.holiday_hours, dateStr),
    });
    return keys
      .map((dateKey) => {
        const date = dayjs.tz(dateKey, businessTimezone).toDate();
        const slots = getSchedulesForActivityOnDate(date);
        if (!slots.length) return null;
        return {
          dateKey,
          date,
          label: dayjs.tz(dateKey, businessTimezone).format('dddd, D MMMM YYYY'),
          slots,
        };
      })
      .filter(Boolean);
  }, [
    isIndividualSchedule,
    schedules,
    todayStr,
    latestAllowedDateStr,
    business?.operating_hours,
    business?.holiday_hours,
    businessTimezone,
    getSchedulesForActivityOnDate,
  ]);

  const hasAnyAvailableDates = useMemo(() => {
    if (isMultiDaySchedule) return multiDaySeriesEntries.length > 0;
    if (isIndividualSchedule) return individualDateEntries.length > 0;
    return [...availableDatesForMonth].some((d) => d >= todayStr);
  }, [isMultiDaySchedule, multiDaySeriesEntries, isIndividualSchedule, individualDateEntries, availableDatesForMonth, todayStr]);

  const isToday = (date) => {
    if (!date) return false;
    return fmt(date) === dayjs().tz(businessTimezone).format('YYYY-MM-DD');
  };

  const isSelected = (date) => {
    if (!date || !selectedDate) return false;
    return fmt(date) === fmt(selectedDate);
  };

  const days = useMemo(() => getDaysInMonth(calendarViewDate), [calendarViewDate]);
  const monthName = dayjs(calendarViewDate).tz(businessTimezone).format('MMMM YYYY');

  const parseSlotStart = useCallback(
    (date, startTime) => {
      if (!date || !startTime || typeof startTime !== 'string') return null;
      const dateStr = dayjs(date).tz(businessTimezone).format('YYYY-MM-DD');
      const s = startTime.trim();
      let h;
      let min;
      const amPm = s.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
      const h24 = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
      if (amPm) {
        h = parseInt(amPm[1], 10);
        min = parseInt(amPm[2], 10);
        const pm = (amPm[3] || '').toUpperCase() === 'PM';
        if (h === 12) h = pm ? 12 : 0;
        else if (pm) h += 12;
      } else if (h24) {
        h = parseInt(h24[1], 10);
        min = parseInt(h24[2], 10);
        if (h < 0 || h > 23 || min < 0 || min > 59) return null;
      } else return null;
      const timeStr = `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}:00`;
      return dayjs.tz(`${dateStr}T${timeStr}`, businessTimezone);
    },
    [businessTimezone]
  );

  const earliestSlotStart = useMemo(() => {
    if (!minNotice) return null;
    const t = dayjs().tz(businessTimezone);
    const u = minNotice.unit === 'months' ? 'month' : minNotice.unit;
    return t.add(minNotice.value, u);
  }, [minNotice, businessTimezone]);

  const slotsForSelectedDate = useMemo(() => {
    if (!selectedDate) return [];
    const dateStr = fmt(selectedDate);
    if (isDateClosedForBookings(business?.operating_hours, business?.holiday_hours, dateStr)) return [];
    // Always list published times for the day. Past / too-soon / room conflicts
    // are shown as Unavailable (same look for Classic, Super, Ultimate).
    return getSchedulesForActivityOnDate(selectedDate);
  }, [selectedDate, getSchedulesForActivityOnDate, business?.holiday_hours, business?.operating_hours, businessTimezone]);

  const isPortalSlotTooSoon = useCallback((slot) => {
    if (!earliestSlotStart || !selectedDate || !slot) return false;
    const slotStart = parseSlotStart(selectedDate, slot.start_time);
    if (!slotStart) return false;
    return slotStart.isBefore(earliestSlotStart);
  }, [earliestSlotStart, selectedDate, parseSlotStart]);

  const portalSlotKey = useCallback((slot) => {
    return normalizeBookingScheduleTime(slot?.start_time) || slot?.id || '';
  }, []);

  const getSlotOccupiedCount = useCallback(
    (slot) => {
      const slotKey = portalSlotKey(slot);
      return slotBookedCounts[slotKey] ?? 0;
    },
    [portalSlotKey, slotBookedCounts]
  );

  const getSlotSpacesLeft = useCallback(
    (slot) => {
      if (isPortalSlotTooSoon(slot)) return 0;
      const slotKey = portalSlotKey(slot);
      if (slotEffectiveRemaining[slotKey] != null) {
        return Math.max(0, Number.parseInt(slotEffectiveRemaining[slotKey], 10) || 0);
      }
      return getPortalSlotSpacesLeft(slot, getSlotOccupiedCount(slot));
    },
    [getSlotOccupiedCount, portalSlotKey, slotEffectiveRemaining, isPortalSlotTooSoon],
  );

  const refreshPortalSlotOccupancy = useCallback(async ({ silent = false } = {}) => {
    if (!selectedDate || !activitySlug || !businessId || slotsForSelectedDate.length === 0) {
      setSlotBookedCounts({});
      setSlotEffectiveRemaining({});
      setSlotOccupancyReady(false);
      return;
    }
    if (!silent) setSlotOccupancyLoading(true);
    const dateStr = fmt(selectedDate);
    try {
      const occupancyPromise = fetchPortalSlotOccupancy({
        businessId,
        activityId: activitySlug,
        bookingDate: dateStr,
        excludeHoldToken: slotHoldActive ? slotHoldToken : null,
      }).catch((err) => {
        console.warn('[CustomerPortal] Slot occupancy fetch failed:', err);
        return {};
      });
      const dayResourcesPromise = fetchDayResourceOccupancy({
        businessId,
        bookingDate: dateStr,
      }).catch((err) => {
        console.warn('[CustomerPortal] Day resource occupancy fetch failed:', err);
        return null; // null = unknown (fail closed for room-required slots)
      });
      const [occupancy, dayResourceBookings] = await Promise.all([
        occupancyPromise,
        dayResourcesPromise,
      ]);
      const dayResourcesUnknown = dayResourceBookings == null;
      const durationMinutes = Number(activity?.duration_minutes) > 0
        ? Number(activity.duration_minutes)
        : 90;
      const counts = {};
      const effective = {};
      await Promise.all(
        slotsForSelectedDate.map(async (slot) => {
          const slotKey = portalSlotKey(slot);
          counts[slotKey] = resolvePortalSlotOccupancyCount(occupancy, slot.start_time);
          let spacesLeft = getPortalSlotSpacesLeft(slot, counts[slotKey]);
          try {
            const ctx = await fetchEffectiveSlotCapacity({
              businessId,
              activityId: activitySlug,
              bookingDate: dateStr,
              bookingTime: slot.start_time,
            });
            spacesLeft = effectiveSpacesLeftFromCapacityContext(ctx, counts[slotKey]);
          } catch {
            /* keep spacesLeft from occupancy */
          }

          const hasResourceRequirement = listScheduleResourceRequirements(
            slot?.resource_assignments,
          ).length > 0;
          if (hasResourceRequirement && spacesLeft > 0) {
            if (dayResourcesUnknown) {
              spacesLeft = 0;
            } else {
              const resourceOk = areRequiredResourcesAvailableForSlot({
                schedule: slot,
                bookingDate: dateStr,
                bookingTime: normalizeBookingScheduleTime(slot.start_time) || slot.start_time,
                durationMinutes,
                dayBookings: dayResourceBookings,
              });
              if (!resourceOk.ok) {
                spacesLeft = 0;
              }
            }
          }

          if (isPortalSlotTooSoon(slot)) {
            spacesLeft = 0;
          }

          effective[slotKey] = Math.max(0, spacesLeft);
        }),
      );
      setSlotBookedCounts(counts);
      setSlotEffectiveRemaining(effective);
      setSlotOccupancyReady(true);
    } catch (e) {
      console.warn('[CustomerPortal] Error loading slot occupancy:', e);
      // Degraded mode: keep UI usable, but fail closed on slots that require shared rooms
      // so a Classic/Super booking cannot look "open" for Ultimate while occupancy is unknown.
      const fallbackCounts = {};
      const fallbackEffective = {};
      slotsForSelectedDate.forEach((slot) => {
        const slotKey = portalSlotKey(slot);
        fallbackCounts[slotKey] = 0;
        const needsRooms = listScheduleResourceRequirements(slot?.resource_assignments).length > 0;
        fallbackEffective[slotKey] = needsRooms ? 0 : getPortalSlotSpacesLeft(slot, 0);
      });
      setSlotBookedCounts(fallbackCounts);
      setSlotEffectiveRemaining(fallbackEffective);
      setSlotOccupancyReady(true);
    } finally {
      if (!silent) setSlotOccupancyLoading(false);
    }
  }, [
    selectedDate,
    activitySlug,
    businessId,
    activity?.duration_minutes,
    slotsForSelectedDate,
    portalSlotKey,
    slotHoldActive,
    slotHoldToken,
    isPortalSlotTooSoon,
  ]);

  // Load booked + held counts whenever a date is selected; poll while the time picker is open.
  useEffect(() => {
    const shouldLoad =
      selectedDate && activitySlug && businessId && slotsForSelectedDate.length > 0;
    if (!shouldLoad) {
      setSlotBookedCounts({});
      setSlotOccupancyReady(false);
      setSlotOccupancyLoading(false);
      return undefined;
    }

    refreshPortalSlotOccupancy();

    const shouldPoll = showTimeSlotsModal || slotHoldActive;
    if (!shouldPoll) return undefined;

    const poll = setInterval(() => refreshPortalSlotOccupancy({ silent: true }), PORTAL_SLOT_OCCUPANCY_POLL_MS);
    return () => clearInterval(poll);
  }, [
    selectedDate,
    activitySlug,
    businessId,
    slotsForSelectedDate,
    showTimeSlotsModal,
    slotHoldActive,
    refreshPortalSlotOccupancy,
  ]);

  useEffect(() => {
    if (!selectedTimeSlot || !slotOccupancyReady) return;
    const slot =
      slotsForSelectedDate.find(
        (s) =>
          normalizeBookingScheduleTime(s.start_time)
            === normalizeBookingScheduleTime(selectedTimeSlot.start_time)
      ) || null;
    if (slot && getSlotSpacesLeft(slot) <= 0) {
      setSelectedTimeSlot(null);
    }
  }, [
    selectedTimeSlot,
    slotOccupancyReady,
    slotBookedCounts,
    slotsForSelectedDate,
    getSlotSpacesLeft,
  ]);

  const handleDateModalBack = () => {
    setShowSelectDateModal(false);
  };

  const getSelectedBookingDateISO = useCallback(() => {
    if (!selectedDate) return null;
    return dayjs(selectedDate).tz(businessTimezone).format('YYYY-MM-DD');
  }, [selectedDate, businessTimezone]);

  const selectedBookingDateLabel = useMemo(() => {
    if (!selectedDate) return '';
    return dayjs(selectedDate).tz(businessTimezone).format('dddd, MMMM D, YYYY');
  }, [selectedDate, businessTimezone]);

  useEffect(() => {
    const dateStr = getSelectedBookingDateISO();
    if (
      dateStr
      && specialHoursAcknowledgedDateRef.current
      && specialHoursAcknowledgedDateRef.current !== dateStr
    ) {
      specialHoursAcknowledgedDateRef.current = null;
    }
  }, [getSelectedBookingDateISO]);

  const handleSpecialHoursReminderConfirm = () => {
    const dateStr = getSelectedBookingDateISO();
    if (dateStr) specialHoursAcknowledgedDateRef.current = dateStr;
    setShowSpecialHoursReminderModal(false);
    setSpecialHoursReminderEntry(null);
    const proceed = specialHoursProceedRef.current;
    specialHoursProceedRef.current = null;
    proceed?.();
  };

  const requireSpecialHoursAcknowledgment = useCallback((onProceed) => {
    const dateStr = getSelectedBookingDateISO();
    if (!dateStr) {
      onProceed();
      return;
    }
    if (isDateClosedForBookings(business?.operating_hours, business?.holiday_hours, dateStr)) {
      showCustomerError(
        getClosedHolidayMessage(business?.holiday_hours, dateStr, {
          dateLabel: selectedBookingDateLabel,
        }) || 'We are closed on that date. Please choose another date.',
      );
      return;
    }
    if (specialHoursAcknowledgedDateRef.current === dateStr) {
      onProceed();
      return;
    }
    const entry = getSpecialHoursForDate(business?.holiday_hours, dateStr);
    if (!entry) {
      onProceed();
      return;
    }
    specialHoursProceedRef.current = onProceed;
    setSpecialHoursReminderEntry(entry);
    setShowSpecialHoursReminderModal(true);
  }, [business?.holiday_hours, business?.operating_hours, getSelectedBookingDateISO, selectedBookingDateLabel]);

  const handleDateModalNext = () => {
    if (!selectedDate) return;

    // Double-check that the selected date is still available
    if (!isAvailable(selectedDate)) {
      showCustomerError('Selected date is no longer available. Please choose another date.');
      setSelectedDate(null);
      return;
    }

    requireSpecialHoursAcknowledgment(() => {
      setSelectedTimeSlot(null);
      setShowSelectDateModal(false);
      setShowTimeSlotsModal(true);
    });
  };

  const handleIndividualSlotBook = (date, slot, slotIndex = 0) => {
    if (!date || !slot) return;
    if (!isAvailable(date)) {
      showCustomerError('This date is no longer available. Please choose another date.');
      return;
    }
    requireSpecialHoursAcknowledgment(() => {
      pendingIndividualBookAdvanceRef.current = true;
      setSelectedDate(date);
      setSelectedTimeSlot({ ...slot, _index: slotIndex });
      setShowSelectDateModal(false);
      setShowTimeSlotsModal(true);
    });
  };

  const handleTimeSlotsModalBack = () => {
    pendingIndividualBookAdvanceRef.current = false;
    releaseActiveSlotHold();
    setSelectedTimeSlot(null);
    setShowTimeSlotsModal(false);
    setShowSelectDateModal(true);
  };

  // Load inventory items that are selected for this activity. Returns the loaded array so callers can use it without waiting for state.
  const loadInventoryItemsForTickets = async () => {
    console.log('[CustomerPortal] loadInventoryItemsForTickets called', {
      hasActivity: !!activity,
      hasTicketSettings: !!activity?.ticket_settings,
      businessId,
      ticketSettings: activity?.ticket_settings
    });

    if (!activity?.ticket_settings || !businessId) {
      console.log('[CustomerPortal] Missing activity ticket_settings or businessId');
      setInventoryItems([]);
      return [];
    }

    setTicketsLoading(true);
    try {
      const ticketSettings = typeof activity.ticket_settings === 'string' 
        ? JSON.parse(activity.ticket_settings) 
        : activity.ticket_settings;
      
      console.log('[CustomerPortal] Parsed ticket_settings:', ticketSettings);
      
      const inventoryItemIds = resolveTicketInventoryItemIds(ticketSettings);
      
      console.log('[CustomerPortal] Inventory item IDs:', inventoryItemIds);
      
      if (inventoryItemIds.length === 0) {
        console.log('[CustomerPortal] No inventory item IDs found in ticket_settings');
        setInventoryItems([]);
        return [];
      }

      // Load free-with-purchase promotions first so free infant/adult SKUs can be included
      const { data: promos, error: promosError } = await supabase
        .from('pos_free_with_purchase_promotions')
        .select('id, business_id, quantity, free_item_id, trigger_item_ids')
        .eq('business_id', businessId);
      if (!promosError) {
        fwpPromotionsRef.current = promos || [];
        setFwpPromotions(promos || []);
      } else {
        fwpPromotionsRef.current = [];
        setFwpPromotions([]);
      }

      const ticketIdsWithFwp = resolveTicketInventoryItemIds(ticketSettings, {
        extraInventoryItemIds: collectRelatedFwpFreeItemIds(inventoryItemIds, promos || []),
      });

      // Load only active inventory items that are selected for this activity
      const { data, error } = await supabase
        .from('pos_inventory')
        .select('*')
        .eq('business_id', businessId)
        .eq('is_active', true) // Only show active inventory items
        .in('id', ticketIdsWithFwp)
        .order('name', { ascending: true });

      console.log('[CustomerPortal] Inventory query result:', { data, error, count: data?.length });

      if (error) throw error;
      let items = data || [];

      // If free adult SKUs are present but no paid adult fallback, pull paid adult items
      // from business inventory so extras can be charged.
      const needsPaidAdultFallback = items.some(
        (item) => Number.parseFloat(item?.price || 0) <= 0 && /\badult\b/i.test(String(item?.name || '')),
      ) && !items.some(
        (item) => Number.parseFloat(item?.price || 0) > 0 && /\badult\b/i.test(String(item?.name || '')),
      );
      if (needsPaidAdultFallback) {
        const { data: adultCandidates } = await supabase
          .from('pos_inventory')
          .select('*')
          .eq('business_id', businessId)
          .eq('is_active', true)
          .ilike('name', '%adult%')
          .gt('price', 0)
          .limit(20);
        const extraIds = collectPaidAdultFallbackItemIds(items, adultCandidates || []);
        const extras = (adultCandidates || []).filter((row) => extraIds.includes(row.id));
        if (extras.length > 0) {
          items = [...items, ...extras];
        }
      }

      setInventoryItems(items);

      const { data: pricingPromos, error: pricingPromosError } = await supabase
        .from('booking_pricing_promotions')
        .select('*')
        .eq('business_id', businessId)
        .eq('is_active', true)
        .order('priority', { ascending: false });
      if (!pricingPromosError) setBookingPricingPromotions(pricingPromos || []);
      else setBookingPricingPromotions([]);
      
      if (items.length === 0) {
        console.warn('[CustomerPortal] No inventory items found for IDs:', ticketIdsWithFwp);
        showCustomerError('Ticket types for this activity could not be loaded. Please contact the business.');
      }
      return items;
    } catch (error) {
      console.error('Error loading inventory items for tickets:', error);
      showCustomerError('Error loading available tickets. Please try again.');
      setInventoryItems([]);
      return [];
    } finally {
      setTicketsLoading(false);
    }
  };

  const loadPortalOptionInventoryItems = useCallback(async () => {
    const inventoryItemIds = collectPortalOptionInventoryItemIds(activity?.addon_settings);
    if (!businessId || inventoryItemIds.length === 0) {
      setPortalOptionInventoryItems([]);
      setPortalOptionBundleContext({});
      return [];
    }
    try {
      const { data, error } = await supabase
        .from('pos_inventory')
        .select('*')
        .eq('business_id', businessId)
        .or('is_active.eq.true,is_active.is.null')
        .in('id', inventoryItemIds)
        .order('name', { ascending: true });
      if (error) throw error;
      const items = data || [];
      const bundleContext = await fetchBundleDataForInventoryIds(supabase, businessId, items);
      setPortalOptionInventoryItems(items);
      setPortalOptionBundleContext(bundleContext);
      return items;
    } catch (error) {
      console.error('Error loading portal option inventory items:', error);
      setPortalOptionInventoryItems([]);
      return [];
    }
  }, [activity?.addon_settings, businessId]);

  useEffect(() => {
    loadPortalOptionInventoryItems();
  }, [loadPortalOptionInventoryItems]);

  const getTicketConfigIssueMessage = useCallback(() => {
    if (!activity?.ticket_settings) {
      return 'Online tickets have not been set up for this activity yet. Please contact the business.';
    }
    const ticketSettings =
      typeof activity.ticket_settings === 'string'
        ? (() => {
            try {
              return JSON.parse(activity.ticket_settings);
            } catch {
              return {};
            }
          })()
        : activity.ticket_settings;
    const inventoryItemIds = resolveTicketInventoryItemIds(ticketSettings);
    if (inventoryItemIds.length === 0) {
      return 'This activity shows session times and capacity, but no online ticket types have been linked yet. The business needs to assign tickets in Bookings → Settings → [this activity] → Pricing → Search Inventory, then save the activity.';
    }
    return 'Ticket types for this activity could not be loaded. Please contact the business.';
  }, [activity?.ticket_settings]);

  const handleTimeSlotsModalNext = async () => {
    if (!selectedTimeSlot) {
      showCustomerError('Please select a time slot');
      return;
    }
    const idx = selectedTimeSlot._index;
    const slotFromList =
      typeof idx === 'number' ? slotsForSelectedDate[idx] : null;
    const slot = slotFromList && slotFromList.start_time === selectedTimeSlot.start_time
      ? slotFromList
      : slotsForSelectedDate.find(
          (s) =>
            (s.id && s.id === selectedTimeSlot.id) ||
            s.start_time === selectedTimeSlot.start_time
        );
    if (slot) {
      if (getSlotSpacesLeft(slot) <= 0) {
        showCustomerError('This time is no longer available. Please choose another slot.');
        setSelectedTimeSlot(null);
        await refreshPortalSlotOccupancy();
        return;
      }
    }
    if (!slotHoldToken || !activity?.id) {
      showCustomerError('Could not start your reservation. Please refresh and try again.');
      return;
    }
    setSlotHoldAcquiring(true);
    try {
      const dateStr = fmt(selectedDate);
      const result = await acquireBookingSlotHold({
        businessId,
        activityId: activity.id,
        bookingDate: dateStr,
        bookingTime: selectedTimeSlot.start_time,
        holdToken: slotHoldToken,
        customerId: customerAccount?.id || null,
      });
      if (!result?.ok) {
        showCustomerError(result?.message || 'This time is not available. Please choose another slot.');
        setSelectedTimeSlot(null);
        await refreshPortalSlotOccupancy();
        return;
      }
      setSlotHoldActive(true);
      setShowTimeSlotsModal(false);
      setShowParticipantModal(true);
    } catch (err) {
      console.error('[CustomerPortal] slot hold acquire failed:', err);
      showCustomerError('Could not reserve this time slot. Please try again.');
    } finally {
      setSlotHoldAcquiring(false);
    }
  };

  // Individual-date BOOK: once occupancy is ready, continue without an extra time-picker click.
  useEffect(() => {
    if (!pendingIndividualBookAdvanceRef.current) return;
    if (!showTimeSlotsModal || !selectedTimeSlot || !slotOccupancyReady || slotOccupancyLoading) return;
    if (slotHoldAcquiring) return;
    const spacesLeft = getSlotSpacesLeft(selectedTimeSlot);
    if (spacesLeft <= 0) {
      pendingIndividualBookAdvanceRef.current = false;
      showCustomerError('This time is no longer available. Please choose another slot.');
      return;
    }
    pendingIndividualBookAdvanceRef.current = false;
    handleTimeSlotsModalNext();
  }, [
    showTimeSlotsModal,
    selectedTimeSlot,
    slotOccupancyReady,
    slotOccupancyLoading,
    slotHoldAcquiring,
    getSlotSpacesLeft,
  ]);

  const handleLoginModalBack = () => {
    if (showAccountCreation) {
      setShowAccountCreation(false);
      return;
    }
    setShowLoginModal(false);
    setOtpSent(false);
    setOtpCode('');
    setPhoneNumber('');
    if (selectedDate && selectedTimeSlot) {
      setShowTimeSlotsModal(true);
    }
  };

  // Handle phone number submission and OTP generation
  const handlePhoneSubmit = async () => {
    if (!phoneNumber || phoneNumber.replace(/\D/g, '').length < 10) {
      showCustomerError('Please enter a valid phone number');
      return;
    }

    setLoadingOTP(true);
    try {
      const normalizedPhone = phoneNumber.replace(/\D/g, '');
      const existingCustomer = await fetchPortalCustomerByPhone(normalizedPhone);

      if (existingCustomer?.id && existingCustomer?.customer_email) {
        const result = await waiverOTPService.generateOTP(
          businessId,
          normalizedPhone,
          existingCustomer.customer_email,
          existingCustomer.id
        );

        if (result.success) {
          // Do not persist a portal session until OTP is verified — otherwise refresh skips OTP.
          clearCustomerPortalSession(businessId);
          setOtpSent(true);
          setShowAccountCreation(false);
          toast.success(`OTP sent to ${result.email || existingCustomer.customer_email || 'your email'}`);
        } else {
          showCustomerError(result.error || 'Failed to send OTP');
        }
        return;
      }

      if (existingCustomer?.id) {
        const existingNameParts = String(existingCustomer.customer_name || '').trim().split(/\s+/).filter(Boolean);
        setAccountForm((prev) => ({
          ...prev,
          firstName: prev.firstName || existingNameParts[0] || '',
          lastName: prev.lastName || existingNameParts.slice(1).join(' ') || '',
          email: prev.email || existingCustomer.customer_email || '',
        }));
      }

      setOtpSent(false);
      setShowAccountCreation(true);
      toast.success(
        existingCustomer?.id
          ? 'Please add your email address to continue.'
          : 'Create your account to continue.'
      );
    } catch (error) {
      console.error('Error sending OTP:', error);
      showCustomerError('Error sending OTP. Please try again.');
    } finally {
      setLoadingOTP(false);
    }
  };

  // Verify OTP
  const handleOTPVerify = async () => {
    if (!otpCode || otpCode.length !== 6) {
      showCustomerError('Please enter a valid 6-digit OTP code');
      return;
    }

    setLoadingOTP(true);
    try {
      const normalizedPhone = phoneNumber.replace(/\D/g, '');
      const result = await waiverOTPService.verifyOTP(normalizedPhone, otpCode, businessId);
      
      if (result.valid) {
        setOtpVerified(true);
        // RPC returns snake_case (customer_id); support both for compatibility
        const customerId = result.customerId ?? result.customer_id;
        const authenticatedCustomer = {
          id: customerId,
          phone: normalizedPhone || result.phone_number,
          email: result.email,
          customer_email: result.email,
        };
        setCustomerAccount(authenticatedCustomer);
        saveCustomerPortalSession(businessId, authenticatedCustomer);
        
        // Load customer account and participants (enriches customerAccount if RLS allows)
        if (customerId) {
          try {
            await loadCustomerAccount(customerId);
          } catch (e) {
            console.warn('[CustomerPortal] loadCustomerAccount failed, loading participants only:', e);
            // Still load participants from waiver_participants so saved participants persist on next login
            await loadParticipantsOnly(customerId, {
              id: customerId,
              email: result.email,
              customer_email: result.email,
              customer_name: result.email?.split('@')[0] || 'Account owner',
              phone: normalizedPhone || result.phone_number,
            });
          }
        }
        
        toast.success('OTP verified successfully');
        // If user logged in from "Select date" (no date/time yet), close login and open date selector
        if (!selectedDate) {
          setShowLoginModal(false);
          setShowSelectDateModal(true);
        }
      } else {
        showCustomerError(result.error || 'Invalid OTP code');
      }
    } catch (error) {
      console.error('Error verifying OTP:', error);
      showCustomerError('Error verifying OTP. Please try again.');
    } finally {
      setLoadingOTP(false);
    }
  };

  // Stable identity for deduplication: same person = same key (prefer row with waiver_id when merging)
  const participantIdentityKey = (p) => {
    const first = (p.first_name || '').trim().toLowerCase();
    const last = (p.last_name || '').trim().toLowerCase();
    const dob = p.date_of_birth != null ? String(p.date_of_birth).split('T')[0] : '';
    return `${first}|${last}|${dob}`;
  };

  // Load participants from BOTH tables and merge – deduplicate by identity, prefer row with waiver_id (waiver complete)
  // booking_customer_participant_id: id to use when inserting into booking_participants (FK references that table)
  const loadParticipantsFromTables = async (customerId) => {
  const normalize = (row, bookingCustomerParticipantId) => {
    const dob = row.date_of_birth ?? null;
    let participantType = row.participant_type || (row.is_account_owner ? 'primary' : null);
    if (!participantType && !row.is_account_owner && dob) {
      const ageYears = dayjs().diff(dayjs(String(dob).split('T')[0]), 'year');
      participantType = Number.isFinite(ageYears) && ageYears < 18 ? 'minor' : 'additional_adult';
    }
    if (!participantType) participantType = row.is_account_owner ? 'primary' : 'additional_adult';
    return {
      id: row.id,
      first_name: row.first_name || '',
      last_name: row.last_name || '',
      date_of_birth: dob,
      email: row.email ?? null,
      phone_number: row.phone_number ?? null,
      participant_type: participantType,
      is_account_owner: !!row.is_account_owner,
      is_active: row.is_active !== false,
      waiver_id: row.waiver_id ?? null,
      waiver_participant_id: row.waiver_participant_id ?? null,
      booking_customer_participant_id: bookingCustomerParticipantId ?? null,
    };
  };
    const byIdentity = new Map();
    const nameKey = (p) =>
      `${String(p.first_name || '').trim().toLowerCase()}|${String(p.last_name || '').trim().toLowerCase()}`;
    const findExistingKey = (norm) => {
      const full = participantIdentityKey(norm);
      if (byIdentity.has(full)) return full;
      const nk = nameKey(norm);
      for (const [key, existing] of byIdentity.entries()) {
        if (nameKey(existing) !== nk) continue;
        const eDob = existing.date_of_birth != null ? String(existing.date_of_birth).split('T')[0] : '';
        const nDob = norm.date_of_birth != null ? String(norm.date_of_birth).split('T')[0] : '';
        // Same name with matching or one-sided DOB → same person (waiver rows sometimes omit DOB).
        if (!eDob || !nDob || eDob === nDob) return key;
      }
      return full;
    };
    const add = (rows, fromBookingCustomerParticipants) => {
      if (!Array.isArray(rows)) return;
      rows.filter(r => r.is_active !== false).forEach(r => {
        const norm = normalize(r, fromBookingCustomerParticipants ? r.id : null);
        if (!fromBookingCustomerParticipants) {
          norm.waiver_participant_id = r.id;
        }
        const key = findExistingKey(norm);
        const existing = byIdentity.get(key);
        if (!existing) {
          byIdentity.set(key, norm);
          return;
        }
        // Merge both table rows for the same person: keep waiver + booking FK + DOB.
        const mergedDob = norm.date_of_birth || existing.date_of_birth || null;
        const mergedType = (() => {
          const type = norm.participant_type || existing.participant_type;
          if (type === 'minor' || existing.participant_type === 'minor') return 'minor';
          if (mergedDob) {
            const ageYears = dayjs().diff(dayjs(String(mergedDob).split('T')[0]), 'year');
            if (Number.isFinite(ageYears) && ageYears < 18) return 'minor';
          }
          return type || existing.participant_type;
        })();
        const merged = {
          ...existing,
          ...norm,
          id: existing.booking_customer_participant_id || norm.booking_customer_participant_id || existing.id || norm.id,
          date_of_birth: mergedDob,
          waiver_id: norm.waiver_id || existing.waiver_id || null,
          waiver_participant_id: norm.waiver_participant_id || existing.waiver_participant_id || null,
          booking_customer_participant_id:
            norm.booking_customer_participant_id || existing.booking_customer_participant_id || null,
          participant_type: mergedType,
          is_account_owner: !!(norm.is_account_owner || existing.is_account_owner),
        };
        byIdentity.delete(key);
        byIdentity.set(participantIdentityKey(merged), merged);
      });
    };
    // Query BOTH tables (portal writes to both: account creation → booking_customer_participants; add/upsert → waiver_participants)
    const [waiverRes, bookingRes] = await Promise.all([
      supabase.from('waiver_participants').select('*').eq('customer_id', customerId).eq('business_id', businessId),
      supabase.from('booking_customer_participants').select('*').eq('customer_id', customerId).eq('business_id', businessId),
    ]);
    add(waiverRes.data, false);
    add(bookingRes.data, true);
    const merged = Array.from(byIdentity.values());
    merged.sort((a, b) => (b.is_account_owner ? 1 : 0) - (a.is_account_owner ? 1 : 0));
    return merged;
  };

  // Load participants: try RPC first (bypasses RLS), then direct table read, then synthetic primary.
  const loadParticipantsOnly = async (customerId, minimalAccount) => {
    const applyParticipants = async (fromTables) => {
      if (!fromTables || fromTables.length === 0) return false;
      // Deduplicate by identity, prefer row with waiver_id
      const byIdentity = new Map();
      fromTables.forEach(p => {
        const key = participantIdentityKey(p);
        const existing = byIdentity.get(key);
        if (!existing || (p.waiver_id && !existing.waiver_id)) {
          byIdentity.set(key, { ...p });
        }
      });
      let deduped = Array.from(byIdentity.values());
      deduped = enforceSinglePortalAccountOwner(deduped, minimalAccount);
      const ownerRow = deduped.find(p => p.is_account_owner);
      const primary = ownerRow
        ? { ...ownerRow, is_account_owner: true }
        : {
            id: minimalAccount?.id || customerId,
            waiver_id: null,
            first_name: minimalAccount?.customer_name?.split(' ')[0] || '',
            last_name: minimalAccount?.customer_name?.split(' ').slice(1)?.join(' ') || '',
            date_of_birth: minimalAccount?.date_of_birth ?? null,
            email: minimalAccount?.customer_email || minimalAccount?.email,
            phone_number: minimalAccount?.phone,
            participant_type: 'primary',
            is_account_owner: true,
            is_active: true,
          };
      const others = ownerRow ? deduped.filter(p => p.id !== ownerRow.id) : deduped;
      const participantsWithStatus = await enrichParticipantsWithComplianceStatus(
        [primary, ...others],
        customerId
      );
      setCustomerParticipants(participantsWithStatus);
      setSelectedParticipantIds(
        mergeParticipantSelectionAfterLoad(
          participantsWithStatus,
          [],
          readSavedParticipantSelection(businessId, activitySlug)
        )
      );
      return true;
    };
    const syntheticPrimary = () => {
      const nameParts = (minimalAccount?.customer_name || minimalAccount?.email?.split('@')[0] || 'Account owner').trim().split(/\s+/);
      setCustomerParticipants([{
        id: minimalAccount?.id || customerId,
        waiver_id: null,
        first_name: nameParts[0] || '',
        last_name: nameParts.slice(1).join(' ') || '',
        date_of_birth: minimalAccount?.date_of_birth ?? null,
        email: minimalAccount?.customer_email || minimalAccount?.email,
        phone_number: minimalAccount?.phone,
        participant_type: 'primary',
        is_account_owner: true,
        is_active: true,
        camper_registration_document_id: null,
        camper_registration_status: 'not_required',
      }]);
      setSelectedParticipantIds([minimalAccount?.id || customerId]);
    };

    // 1) Try RPC first (bypasses RLS – returns participants even if anon can't read table)
    const { data: rows, error: rpcError } = await supabase.rpc('bookings_get_portal_participants', {
      p_customer_id: customerId,
      p_business_id: businessId,
    });
    if (!rpcError && rows) {
      const list = Array.isArray(rows) ? rows : (rows ? [rows] : []);
      if (list.length > 0) {
        await applyParticipants(list);
        return;
      }
    }
    // 2) Fallback: direct read from BOTH tables (needs anon SELECT policy – run bookings_portal_participants_ANON_READ_ONLY.sql)
    const fromTables = await loadParticipantsFromTables(customerId);
    if (fromTables.length > 0) {
      await applyParticipants(fromTables);
      return;
    }
    // 3) No data: show at least Participant 1 from minimalAccount
    syntheticPrimary();
  };

  // Load customer account and participants
  // Uses waiver_signatures (customer_id) + waiver_participants (waiver_id) so it works even if waiver_participants.customer_id column is not yet added
  const loadCustomerAccount = async (customerId) => {
    try {
      const customer = await fetchPortalCustomerAccount(customerId);
      if (!customer?.id) {
        throw new Error('Customer account not found');
      }
      setCustomerAccount(customer);
      // Session is saved only after OTP verify / explicit create-account auth — not on every account load.

      // Definer RPC: full roster (nested waiver_participants are often empty for anon clients due to RLS).
      const { data: rosterRows, error: rosterErr } = await supabase.rpc('bookings_get_portal_waiver_roster', {
        p_customer_id: customerId,
        p_business_id: businessId,
      });
      if (!rosterErr && rosterRows) {
        const rosterList = Array.isArray(rosterRows) ? rosterRows : [rosterRows];
        if (rosterList.length > 0) {
          const byRosterIdentity = new Map();
          rosterList.forEach((p) => {
            const key = participantIdentityKey(p);
            const existing = byRosterIdentity.get(key);
            if (!existing || (p.waiver_id && !existing.waiver_id)) {
              byRosterIdentity.set(key, { ...p });
            }
          });
          let rosterParticipants = Array.from(byRosterIdentity.values());
          rosterParticipants = enforceSinglePortalAccountOwner(rosterParticipants, customer);
          const rosterWithStatus = await enrichParticipantsWithComplianceStatus(
            rosterParticipants,
            customerId
          );
          const rosterSelectedPrimary =
            rosterWithStatus.find((p) => p.is_account_owner) || rosterWithStatus[0];
          setCustomerParticipants(rosterWithStatus);
          setSelectedParticipantIds((prev) =>
            mergeParticipantSelectionAfterLoad(
              rosterWithStatus,
              prev,
              readSavedParticipantSelection(businessId, activitySlug)
            )
          );
          return rosterWithStatus;
        }
      } else if (rosterErr) {
        console.warn('[CustomerPortal] bookings_get_portal_waiver_roster failed, using client waiver query:', rosterErr);
      }

      // Load participants via waiver_signatures (has customer_id) and its waiver_participants
      // This avoids querying waiver_participants by customer_id (which may not exist until migration is run)
      let { data: waiverRows, error: waiverError } = await supabase
        .from('waiver_signatures')
        .select('*, waiver_participants(*)')
        .eq('customer_id', customerId)
        .eq('business_id', businessId)
        .order('signed_at', { ascending: false })
        .limit(25);

      if (waiverError) throw waiverError;

      if ((!waiverRows || waiverRows.length === 0) && (customer?.customer_email || customer?.email || customer?.customer_phone || customer?.phone)) {
        const normalizedEmail = (customer?.customer_email || customer?.email || '').trim().toLowerCase();
        const normalizedPhone = String(customer?.customer_phone || customer?.phone || '').replace(/\D/g, '');
        const fallbackResults = [];

        if (normalizedEmail) {
          const { data: waiverRowsByEmail, error: waiverByEmailError } = await supabase
            .from('waiver_signatures')
            .select('*, waiver_participants(*)')
            .eq('business_id', businessId)
            .eq('email', normalizedEmail)
            .order('signed_at', { ascending: false })
            .limit(25);
          if (!waiverByEmailError && Array.isArray(waiverRowsByEmail)) {
            fallbackResults.push(...waiverRowsByEmail);
          }
        }

        if (normalizedPhone) {
          const { data: waiverRowsByPhone, error: waiverByPhoneError } = await supabase
            .from('waiver_signatures')
            .select('*, waiver_participants(*)')
            .eq('business_id', businessId)
            .eq('phone_number', normalizedPhone)
            .order('signed_at', { ascending: false })
            .limit(25);
          if (!waiverByPhoneError && Array.isArray(waiverRowsByPhone)) {
            fallbackResults.push(...waiverRowsByPhone);
          }
        }

        if (fallbackResults.length > 0) {
          const dedupedFallback = Array.from(new Map(fallbackResults.map((row) => [row.id, row])).values());
          dedupedFallback.sort((a, b) => new Date(b.signed_at || 0).getTime() - new Date(a.signed_at || 0).getTime());
          waiverRows = dedupedFallback;
        }
      }

      // All non-expired / valid waivers for this account — include participants from every waiver so
      // minors and additional adults from separate waivers still appear in the booking modal.
      const validWaivers = (waiverRows || [])
        .filter((entry) => {
          if (entry?.is_valid === false) return false;
          if (!entry?.expires_at) return true;
          return !isWaiverExpired(entry.expires_at);
        })
        .sort((a, b) => new Date(b.signed_at || 0).getTime() - new Date(a.signed_at || 0).getTime());

      // Load participants: try RPC first (bypasses RLS), then direct table read
      let customerScopedParticipants = [];
      const { data: byCustomer, error: customerScopeError } = await supabase.rpc('bookings_get_portal_participants', {
        p_customer_id: customerId,
        p_business_id: businessId,
      });
      if (!customerScopeError && byCustomer) {
        customerScopedParticipants = Array.isArray(byCustomer) ? byCustomer : (byCustomer ? [byCustomer] : []);
      }
      if (customerScopedParticipants.length === 0) {
        customerScopedParticipants = await loadParticipantsFromTables(customerId);
      }

      if (validWaivers.length > 0) {
        const allCandidates = [];
        for (const waiver of validWaivers) {
          const primaryParticipant = {
            id: waiver.id,
            waiver_id: waiver.id,
            first_name: waiver.first_name || customer.customer_name?.split(' ')[0] || '',
            last_name: waiver.last_name || customer.customer_name?.split(' ').slice(1).join(' ') || '',
            date_of_birth: waiver.date_of_birth,
            email: waiver.email || customer.customer_email,
            phone_number: waiver.phone_number || customer.customer_phone,
            participant_type: 'primary',
            is_account_owner: true,
            is_active: true,
            waiver_signature_id: waiver.id,
          };
          allCandidates.push(primaryParticipant);

          const fromWaiver = (waiver.waiver_participants || [])
            .filter((wp) => String(wp.participant_type || '').toLowerCase() !== 'primary')
            .map((wp) => ({
              id: wp.id,
              first_name: wp.first_name || '',
              last_name: wp.last_name || '',
              date_of_birth: wp.date_of_birth ?? null,
              email: wp.email ?? null,
              phone_number: wp.phone_number ?? null,
              participant_type: wp.participant_type || 'additional_adult',
              is_account_owner: false,
              is_active: true,
              waiver_id: wp.waiver_id ?? waiver.id,
              booking_customer_participant_id: null,
            }));
          allCandidates.push(...fromWaiver);
        }
        (customerScopedParticipants || []).forEach((p) => allCandidates.push({ ...p }));

        const byIdentity = new Map();
        allCandidates.forEach((p) => {
          const key = participantIdentityKey(p);
          const existing = byIdentity.get(key);
          if (!existing || (p.waiver_id && !existing.waiver_id)) {
            byIdentity.set(key, {
              ...p,
              is_account_owner: !!(p.is_account_owner || existing?.is_account_owner),
            });
          }
        });
        let participantsList = Array.from(byIdentity.values());
        participantsList = enforceSinglePortalAccountOwner(participantsList, customer);

        const participantsWithStatus = await enrichParticipantsWithComplianceStatus(
          participantsList,
          customerId
        );
        setCustomerParticipants(participantsWithStatus);
        setSelectedParticipantIds(
          mergeParticipantSelectionAfterLoad(
            participantsWithStatus,
            [],
            readSavedParticipantSelection(businessId, activitySlug)
          )
        );
        return participantsWithStatus;
      }

      // No waiver — use saved Participant 1 from waiver_participants if present, else synthetic from customer
      const savedOwner = (customerScopedParticipants || []).find(p => p.is_account_owner);
      const primaryParticipant = savedOwner
        ? { ...savedOwner, is_account_owner: true }
        : {
            id: customer.id,
            waiver_id: null,
            first_name: customer.customer_name?.split(' ')[0] || '',
            last_name: customer.customer_name?.split(' ').slice(1).join(' ') || '',
            date_of_birth: customer.date_of_birth,
            email: customer.customer_email,
            phone_number: customer.customer_phone,
            participant_type: 'primary',
            is_account_owner: true,
            is_active: true
          };
      const others = savedOwner
        ? (customerScopedParticipants || []).filter(p => p.id !== savedOwner.id)
        : (customerScopedParticipants || []);
      const participantsWithStatus = await enrichParticipantsWithComplianceStatus(
        [primaryParticipant, ...others],
        customerId
      );
      setCustomerParticipants(participantsWithStatus);
      setSelectedParticipantIds(
        mergeParticipantSelectionAfterLoad(
          participantsWithStatus,
          [],
          readSavedParticipantSelection(businessId, activitySlug)
        )
      );
      return participantsWithStatus;
    } catch (error) {
      console.error('Error loading customer account:', error);
      showCustomerError('Error loading account information');
      return null;
    }
  };

  const handlePortalComplianceReturn = useCallback(async (queryFlag) => {
    const params = new URLSearchParams(location.search);
    if (params.get(queryFlag) !== '1') return;
    // Wait until activity flags are known so registration/T&Cs gates are correct.
    if (!activity?.id) return;
    // Only handle each return flag once — concurrent effect re-runs were clearing
    // saved context mid-flight and skipping camper registration.
    if (portalComplianceReturnHandledRef.current[queryFlag]) return;
    portalComplianceReturnHandledRef.current[queryFlag] = true;

    try {
      const saved = readSavedBookingPortalContext(businessId, activitySlug);
      const customerId = customerAccount?.id || saved?.customerId || null;
      if (saved?.date) setSelectedDate(new Date(saved.date));
      if (saved?.timeSlot) setSelectedTimeSlot(saved.timeSlot);
      if (saved?.partyHostParticipantId) setPartyHostParticipantId(saved.partyHostParticipantId);
      if (saved?.partyBirthdayChildParticipantId) {
        setPartyBirthdayChildParticipantId(saved.partyBirthdayChildParticipantId);
      }

      const savedSelection = saved?.selectedParticipantIds?.length
        ? saved.selectedParticipantIds
        : readSavedParticipantSelection(businessId, activitySlug);

      let participants = customerParticipants;
      if (customerId) {
        const loaded = await loadCustomerAccount(customerId);
        if (Array.isArray(loaded) && loaded.length > 0) participants = loaded;
      }
      const remappedSelection = remapSavedParticipantSelection(
        savedSelection,
        saved?.selectedParticipantIdentities,
        participants
      );
      if (remappedSelection.length) {
        setSelectedParticipantIds(remappedSelection);
      }

      sessionStorage.removeItem(bookingPortalContextStorageKey(businessId, activitySlug));
      window.history.replaceState({}, '', location.pathname);

      openPostComplianceStep(
        participants,
        remappedSelection.length ? remappedSelection : selectedParticipantIds,
        { savedContext: saved }
      );
    } catch (_) {
      // Allow a retry if this attempt failed before opening the next step.
      portalComplianceReturnHandledRef.current[queryFlag] = false;
    }
  }, [
    activity?.id,
    businessId,
    activitySlug,
    customerAccount?.id,
    customerParticipants,
    location.pathname,
    location.search,
    loadCustomerAccount,
    openPostComplianceStep,
    selectedParticipantIds,
  ]);

  // When returning from waiver or camper registration, restore booking context and open the correct next step
  useEffect(() => {
    handlePortalComplianceReturn('waiverDone');
  }, [handlePortalComplianceReturn]);

  useEffect(() => {
    handlePortalComplianceReturn('regDone');
  }, [handlePortalComplianceReturn]);

  useEffect(() => {
    if (!businessId || otpVerified || customerAccount?.id) return;

    const savedSession = loadCustomerPortalSession(businessId);
    if (!savedSession?.id) return;

    const restorePortalSession = async () => {
      try {
        setOtpVerified(true);
        setCustomerAccount(savedSession);
        await loadCustomerAccount(savedSession.id);
      } catch (_error) {
        clearCustomerPortalSession(businessId);
        setOtpVerified(false);
        setCustomerAccount(null);
      }
    };

    restorePortalSession();
  }, [businessId, otpVerified, customerAccount?.id]);

  // Create customer account
  const handleCreateAccount = async () => {
    if (!accountForm.firstName || !accountForm.lastName || !accountForm.email) {
      showCustomerError('Please fill in all required fields');
      return;
    }

    setLoadingOTP(true);
    try {
      const normalizedPhone = phoneNumber.replace(/\D/g, '');
      const { data: customerRows, error: customerError } = await supabase.rpc('bookings_create_or_get_portal_customer', {
        p_business_id: businessId,
        p_phone_number: normalizedPhone,
        p_email: accountForm.email,
        p_first_name: accountForm.firstName,
        p_last_name: accountForm.lastName,
        p_city: accountForm.city || null,
      });

      if (customerError) throw customerError;

      const customer = Array.isArray(customerRows) ? customerRows[0] : customerRows;
      if (!customer?.id) {
        throw new Error('Failed to create account');
      }

      const { data: ownerRows, error: ownerError } = await supabase.rpc('bookings_upsert_portal_participant_owner', {
        p_customer_id: customer.id,
        p_business_id: businessId,
        p_first_name: accountForm.firstName.trim(),
        p_last_name: accountForm.lastName.trim(),
        p_date_of_birth: null
      });

      if (ownerError) throw ownerError;

      const ownerParticipant = Array.isArray(ownerRows) ? ownerRows[0] : ownerRows;

      setCustomerAccount(customer);
      if (ownerParticipant?.id) {
        const participantsWithStatus = await enrichParticipantsWithComplianceStatus(
          [ownerParticipant],
          customer.id
        );
        setCustomerParticipants(participantsWithStatus);
        setSelectedParticipantIds([participantsWithStatus[0]?.id || ownerParticipant.id]);
      } else {
        await loadCustomerAccount(customer.id);
      }

      setShowAccountCreation(false);
      setOtpVerified(true); // Treat as verified
      saveCustomerPortalSession(businessId, customer);
      toast.success('Account created successfully');
      // If user created account from "Select date" (no date/time yet), close login and open date selector
      if (!selectedDate) {
        setShowLoginModal(false);
        setShowSelectDateModal(true);
      }
    } catch (error) {
      console.error('Error creating account:', error);
      showCustomerError('Error creating account. Please try again.');
    } finally {
      setLoadingOTP(false);
    }
  };

  // Handle login modal next (proceed to participant selection/ticket selection)
  const handleLoginModalNext = async () => {
    if (!otpVerified) {
      showCustomerError('Please verify your OTP code first');
      return;
    }

    if (selectedParticipantIds.length === 0) {
      showCustomerError('Please select at least one participant');
      return;
    }

    // Clear previous ticket selection so we always reselect from current participants (e.g. after Back to add a participant)
    setSelectedTickets({});

    // Ensure inventory items are loaded before auto-selecting (use returned data so we don't rely on state having updated yet)
    let itemsToUse = inventoryItems;
    if (inventoryItems.length === 0) {
      itemsToUse = await loadInventoryItemsForTickets() || [];
    }
    console.log('[CustomerPortal] handleLoginModalNext → itemsToUse for auto-select:', {
      length: itemsToUse?.length,
      fromState: inventoryItems.length,
      itemIds: itemsToUse?.map(i => i.id),
      itemNames: itemsToUse?.map(i => i.name),
      ageRestrictions: itemsToUse?.map(i => ({ id: i.id, name: i.name, age_restriction: i.age_restriction }))
    });

    // Auto-select tickets based on participant ages (pass freshly loaded items when we just loaded)
    autoSelectTicketsForParticipants(itemsToUse);
    
    setShowLoginModal(false);
    setShowTicketSelectionModal(true);
  };

  // Check if participant's birthdate fits item's age_restriction (min/max in months or years)
  const participantMatchesAgeRestriction = useCallback((birthdate, ageRestriction) => {
    return matchesAgeRule(birthdate, ageRestriction, dayjs());
  }, []);

  // Auto-select tickets by age only — no fallback to wrong age brackets.
  // itemsOverride: when provided (e.g. freshly loaded), use it instead of inventoryItems so auto-selection works before state has updated.
  const autoSelectTicketsForParticipants = useCallback((itemsOverride) => {
    const rawItems = (itemsOverride != null && itemsOverride.length > 0) ? itemsOverride : inventoryItems;
    // Prefer explicit age-restricted paid tickets first; unrestricted/free tickets become fallbacks.
    const items = [...rawItems].sort((a, b) => {
      const restrictionA = parseAgeRestriction(a.age_restriction);
      const restrictionB = parseAgeRestriction(b.age_restriction);
      if (restrictionA.hasRestriction !== restrictionB.hasRestriction) {
        return restrictionA.hasRestriction ? -1 : 1;
      }
      const priceA = parseFloat(a.price || 0);
      const priceB = parseFloat(b.price || 0);
      if ((priceA <= 0) !== (priceB <= 0)) {
        return priceA <= 0 ? 1 : -1;
      }
      return priceA - priceB;
    });
    if (items.length === 0) {
      console.warn('[CustomerPortal] No inventory items loaded for auto-selection');
      setSelectedParticipantTicketAssignments({});
      setSelectedTickets({});
      return { unmatched: [] };
    }

    if (isPartyBooking) {
      const hostId = partyHostParticipantId || selectedParticipantIds[0] || null;
      const { participantAssignments, ticketCounts } = assignPartyPackageTicket({
        hostParticipantId: hostId,
        items,
      });
      setSelectedParticipantTicketAssignments(participantAssignments);
      setSelectedTickets(ticketCounts);
      return { unmatched: [] };
    }

    const selectedParticipants = resolvePortalSelectedParticipants(
      customerParticipants,
      selectedParticipantIds,
      customerAccount
    );
    console.log('[CustomerPortal] Selected participants for auto-select:', selectedParticipants.map(p => ({
      id: p.id,
      name: `${p.first_name} ${p.last_name}`,
      date_of_birth: p.date_of_birth,
      participant_type: p.participant_type,
      is_account_owner: p.is_account_owner,
    })));

    const strictResult = assignTicketsToParticipantsStrict({
      participants: selectedParticipants,
      items,
      ticketSettings: parsedTicketSettings,
    });

    let explicitAssignments = { ...strictResult.participantAssignments };
    let ticketCounts = { ...strictResult.ticketCounts };
    const maxTickets = selectedParticipants.length;

    const allParticipantsHaveValidTickets = strictResult.unmatched.length === 0;

    // Always remap assignments for free-with-purchase (even when activity pricing rules
    // also exist). Pricing rules only affect totals; without this, adults can all stay on $0 Free Adult.
    // Prefer ref so first auto-select right after inventory load sees promos before React state commits.
    const promotionsForFwp = (fwpPromotionsRef.current?.length ? fwpPromotionsRef.current : fwpPromotions) || [];
    if (allParticipantsHaveValidTickets && promotionsForFwp.length > 0) {
      const withFwp = applyFreeWithPurchaseTicketAssignments({
        participants: selectedParticipants,
        items,
        participantAssignments: explicitAssignments,
        ticketCounts,
        promotions: promotionsForFwp,
      });
      explicitAssignments = withFwp.participantAssignments;
      ticketCounts = withFwp.ticketCounts;
    }

    const finalTotal = Object.values(ticketCounts).reduce((sum, qty) => sum + (qty || 0), 0);
    if (finalTotal > maxTickets) {
      let toRemove = finalTotal - maxTickets;
      const ids = Object.keys(ticketCounts);
      while (toRemove > 0 && ids.length) {
        const id = ids.reduce((a, b) => (ticketCounts[a] > ticketCounts[b] ? a : b));
        const deduct = Math.min(toRemove, ticketCounts[id] || 0);
        if (deduct <= 0) break;
        ticketCounts[id] = (ticketCounts[id] || 0) - deduct;
        toRemove -= deduct;
        if (ticketCounts[id] <= 0) delete ticketCounts[id];
      }
    }

    // Prefer assignment-derived counts so FWP remaps always win in the cart.
    const finalTicketCounts = ticketCountsFromAssignments(explicitAssignments);

    setSelectedParticipantTicketAssignments(explicitAssignments);
    setSelectedTickets(finalTicketCounts);
    return { unmatched: strictResult.unmatched };
  }, [activity?.ticket_settings, customerAccount?.id, customerParticipants, selectedParticipantIds, inventoryItems, fwpPromotions, parsedTicketSettings, isPartyBooking, partyHostParticipantId]);

  // Re-run ticket assignment when payment modal opens if counts do not match selected headcount
  useEffect(() => {
    if (!showTicketSelectionModal || inventoryItems.length === 0) return;

    if (isPartyBooking) {
      const hostId = partyHostParticipantId || selectedParticipantIds[0] || null;
      const hostAssigned = Boolean(
        hostId && selectedParticipantTicketAssignments[hostId]?.inventory_item_id,
      );
      const hasPartyTicket = Object.values(selectedTickets).some((qty) => (qty || 0) > 0);
      if (hostAssigned && hasPartyTicket) return;
      autoSelectTicketsForParticipants(inventoryItems);
      return;
    }

    const selected = resolvePortalSelectedParticipants(
      customerParticipants,
      selectedParticipantIds,
      customerAccount
    );
    if (selected.length === 0) return;
    const ticketTotal = Object.values(selectedTickets).reduce((sum, qty) => sum + (qty || 0), 0);
    const assignmentTotal = Object.keys(selectedParticipantTicketAssignments).length;

    // Re-run when free-adult seats exceed free-with-purchase allowance (stale/wrong cart).
    // Only count adult free SKUs — infant free promos must not inflate the allowance.
    const promotionsForCheck = (fwpPromotionsRef.current?.length ? fwpPromotionsRef.current : fwpPromotions) || [];
    const freeAdultItemIds = new Set(
      promotionsForCheck
        .map((promo) => {
          const freeId = String(promo?.free_item_id || '').trim();
          if (!freeId) return null;
          const freeItem = inventoryItems.find((item) => String(item.id) === freeId);
          if (!freeItem) return freeId;
          const looksAdult =
            /\badult\b/i.test(String(freeItem.name || '')) ||
            (Number.parseFloat(freeItem.price || 0) <= 0 &&
              String(freeItem.name || '').toLowerCase().includes('adult'));
          return looksAdult ? freeId : null;
        })
        .filter(Boolean),
    );
    let freeAdultAssigned = 0;
    Object.values(selectedParticipantTicketAssignments || {}).forEach((row) => {
      if (freeAdultItemIds.has(String(row?.inventory_item_id || ''))) freeAdultAssigned += 1;
    });
    let freeAdultAllowed = 0;
    promotionsForCheck.forEach((promo) => {
      const freeId = String(promo?.free_item_id || '').trim();
      if (!freeAdultItemIds.has(freeId)) return;
      const triggerIds = Array.isArray(promo.trigger_item_ids) ? promo.trigger_item_ids : [];
      const triggerCount = triggerIds.reduce((sum, tid) => sum + (selectedTickets[tid] || 0), 0);
      freeAdultAllowed += (Math.max(1, Number.parseInt(promo.quantity, 10) || 1) * triggerCount);
    });
    const freeAdultOverAllowance = freeAdultAssigned > freeAdultAllowed && freeAdultAllowed >= 0;

    if (
      ticketTotal >= selected.length &&
      assignmentTotal >= selected.length &&
      !freeAdultOverAllowance
    ) {
      return;
    }
    const strictCheck = assignTicketsToParticipantsStrict({
      participants: selected,
      items: inventoryItems,
      ticketSettings: parsedTicketSettings,
    });
    if (strictCheck.unmatched.length > 0) return;
    autoSelectTicketsForParticipants(inventoryItems);
  }, [
    showTicketSelectionModal,
    inventoryItems,
    selectedParticipantIds,
    selectedTickets,
    selectedParticipantTicketAssignments,
    customerParticipants,
    customerAccount,
    parsedTicketSettings,
    autoSelectTicketsForParticipants,
    isPartyBooking,
    partyHostParticipantId,
    fwpPromotions,
  ]);

  // Calculate age from birthdate (years, integer)
  const calculateAge = (birthdate) => {
    if (!birthdate) return null;
    const today = dayjs();
    const birth = dayjs(birthdate);
    return today.diff(birth, 'year');
  };

  const onlineTicketLimits = useMemo(
    () => getOnlineTicketLimits(parsedTicketSettings),
    [parsedTicketSettings]
  );

  const validateSelectedParticipantCount = useCallback(
    (count) => {
      if (isPartyBooking) return { ok: true };
      return validateParticipantCountAgainstTicketLimits(count, onlineTicketLimits);
    },
    [isPartyBooking, onlineTicketLimits]
  );

  useEffect(() => {
    if (!showParticipantModal || !isPartyBooking) return;
    const { adults } = partitionRosterForParty(customerParticipants);
    const defaultHost =
      adults.find((p) => p.is_account_owner) ||
      adults[0] ||
      null;
    if (defaultHost?.id && !partyHostParticipantId) {
      setPartyHostParticipantId(defaultHost.id);
    }
  }, [showParticipantModal, isPartyBooking, customerParticipants, partyHostParticipantId]);

  useEffect(() => {
    if (!isPartyBooking) return;
    const { adults, minors } = partitionRosterForParty(customerParticipants);
    const adultIds = new Set(adults.map((p) => p.id));
    const minorIds = new Set(minors.map((p) => p.id));
    if (partyHostParticipantId && !adultIds.has(partyHostParticipantId)) {
      setPartyHostParticipantId(null);
    }
    if (partyBirthdayChildParticipantId && !minorIds.has(partyBirthdayChildParticipantId)) {
      setPartyBirthdayChildParticipantId(null);
    }
  }, [isPartyBooking, customerParticipants, partyHostParticipantId, partyBirthdayChildParticipantId]);

  useEffect(() => {
    if (!isPartyBooking) return;
    const ids = resolvePartySelectedParticipantIds({
      hostParticipantId: partyHostParticipantId,
      birthdayChildParticipantId: partyBirthdayChildParticipantId,
      requireBirthdayChild: partySettings.requireBirthdayChild,
    });
    setSelectedParticipantIds((prev) => {
      if (prev.length === ids.length && prev.every((id, idx) => id === ids[idx])) return prev;
      return ids;
    });
  }, [
    isPartyBooking,
    partyHostParticipantId,
    partyBirthdayChildParticipantId,
    partySettings.requireBirthdayChild,
  ]);

  const participantTicketIssues = useMemo(() => {
    if (isPartyBooking || !showTicketSelectionModal) return [];
    const bookingParty = resolvePortalSelectedParticipants(
      customerParticipants,
      selectedParticipantIds,
      customerAccount
    );
    if (!bookingParty.length || inventoryItems.length === 0) return [];
    return assignTicketsToParticipantsStrict({
      participants: bookingParty,
      items: inventoryItems,
      ticketSettings: parsedTicketSettings,
    }).unmatched;
  }, [
    showTicketSelectionModal,
    customerParticipants,
    selectedParticipantIds,
    customerAccount,
    inventoryItems,
    parsedTicketSettings,
    isPartyBooking,
  ]);

  const partyCanProceed = useMemo(
    () =>
      validatePartyRoleSelection({
        hostParticipantId: partyHostParticipantId,
        birthdayChildParticipantId: partyBirthdayChildParticipantId,
        requireBirthdayChild: partySettings.requireBirthdayChild,
        customerParticipants,
      }).ok,
    [
      partyHostParticipantId,
      partyBirthdayChildParticipantId,
      partySettings.requireBirthdayChild,
      customerParticipants,
    ]
  );

  const handleAddPartyBirthdayChild = useCallback(
    async (newChild) => {
      if (!customerAccount?.id || !businessId) {
        showCustomerError('Please sign in to add a child');
        return false;
      }

      const firstName = newChild.firstName?.trim();
      const lastName = newChild.lastName?.trim();
      const { year, month, day } = newChild.birthdate || {};
      if (!firstName || !lastName || !year || !month || !day) {
        showCustomerError('Please fill in all required fields');
        return false;
      }

      const dateOfBirth = `${year}-${month}-${day}`;
      if (!isRosterMinor({ date_of_birth: dateOfBirth, participant_type: 'minor' })) {
        showCustomerError('Birthday child must be under 18');
        return false;
      }

      setAddingPartyBirthdayChild(true);
      try {
        const { data: rows, error } = await supabase.rpc('bookings_add_portal_participant', {
          p_customer_id: customerAccount.id,
          p_business_id: businessId,
          p_first_name: firstName,
          p_last_name: lastName,
          p_date_of_birth: dateOfBirth,
          p_participant_type: 'minor',
        });

        if (error) {
          if (error.code === 'PGRST202' || error.message?.includes('Could not find')) {
            showCustomerError(
              "Children can't be saved yet. Run the database migration 'bookings_rpc_add_portal_participant.sql' on your Supabase project, then try again."
            );
            return false;
          }
          throw error;
        }

        const participant = Array.isArray(rows) ? rows[0] : rows;
        if (!participant?.id) {
          showCustomerError('Child was not saved. Please try again.');
          return false;
        }

        const enriched = await enrichParticipantsWithComplianceStatus(
          [{ ...participant, participant_type: participant.participant_type || 'minor' }],
          customerAccount.id
        );
        const saved = enriched[0] || participant;

        setCustomerParticipants((prev) => [...prev, saved]);
        setPartyBirthdayChildParticipantId(saved.id);
        toast.success('Child added');
        return true;
      } catch (error) {
        console.error('[CustomerPortal] Error adding birthday child:', error);
        showCustomerError(error?.message || 'Error adding child. Please try again.');
        return false;
      } finally {
        setAddingPartyBirthdayChild(false);
      }
    },
    [businessId, customerAccount?.id, enrichParticipantsWithComplianceStatus]
  );

  const hasParticipantTicketIssues = participantTicketIssues.length > 0;

  const tryAddParticipantToSelection = useCallback((participantId) => {
    if (!participantId) return false;
    if (isPartyBooking) return false;
    let added = false;
    setSelectedParticipantIds((prev) => {
      if (prev.includes(participantId)) {
        added = true;
        return prev;
      }
      const check = validateParticipantCountAgainstTicketLimits(prev.length + 1, onlineTicketLimits);
      if (!check.ok) {
        showCustomerError(check.message);
        return prev;
      }
      added = true;
      return [...prev, participantId];
    });
    return added;
  }, [isPartyBooking, onlineTicketLimits]);

  useEffect(() => {
    if (isPartyBooking || onlineTicketLimits.maxTickets == null) return;
    setSelectedParticipantIds((prev) => {
      const clamped = clampParticipantIdsToTicketLimits(prev, onlineTicketLimits);
      return clamped.length === prev.length ? prev : clamped;
    });
  }, [activity?.id, isPartyBooking, onlineTicketLimits.maxTickets]);

  const handleTicketSelectionBack = () => {
    setShowTicketSelectionModal(false);
    if (hasPortalOptions) {
      const isStepMode = portalOptionsConfig.displayMode === 'step_modals';
      const visibleGroups = filterVisiblePortalOptionGroups(
        portalOptionsConfig.groups,
        portalOptionSelections
      );
      setPortalOptionsStepIndex(
        isStepMode ? Math.max(0, visibleGroups.length - 1) : 0
      );
      setShowPortalOptionsModal(true);
      return;
    }
    if (isPartyBooking) {
      setShowParticipantModal(true);
    } else {
      setShowParticipantConfirmationModal(true);
    }
  };

  const handleAdditionalParticipantToggle = (participantId, checked) => {
    if (checked) {
      tryAddParticipantToSelection(participantId);
    } else {
      setSelectedParticipantIds((prev) => prev.filter((id) => id !== participantId));
    }
  };

  const handleParticipant1Toggle = (checked, participantId) => {
    const id =
      participantId ||
      customerParticipants.find((p) => p.is_account_owner)?.id ||
      customerAccount?.id;
    if (!id) return;
    if (checked) {
      tryAddParticipantToSelection(id);
    } else {
      setSelectedParticipantIds((prev) => prev.filter((pid) => pid !== id));
    }
  };

  const proceedToTicketSelection = async () => {
    setSelectedTickets({});
    let itemsToUse = inventoryItems;
    if (inventoryItems.length === 0) {
      itemsToUse = await loadInventoryItemsForTickets() || [];
    }
    if (itemsToUse.length === 0) {
      showCustomerError(getTicketConfigIssueMessage());
      return false;
    }
    autoSelectTicketsForParticipants(itemsToUse);
    setShowParticipantConfirmationModal(false);
    setShowPortalOptionsModal(false);
    setShowTicketSelectionModal(true);
    return true;
  };

  const proceedToOptionsOrCheckout = async () => {
    if (hasPortalOptions) {
      setPortalOptionSelections(buildDefaultPortalOptionSelections(activity?.addon_settings));
      setPortalBundleCustomizations({});
      setPortalOptionsStepIndex(0);
      setShowPortalOptionsModal(true);
      return true;
    }
    return proceedToTicketSelection();
  };
  proceedToOptionsOrCheckoutRef.current = proceedToOptionsOrCheckout;

  const handlePortalOptionsContinue = async (result) => {
    if (!result?.ok) {
      showCustomerError(result.message || 'Please complete required options.');
      return;
    }
    await proceedToTicketSelection();
  };

  const handlePortalOptionsBack = () => {
    const isStepMode = portalOptionsConfig.displayMode === 'step_modals';
    if (isStepMode && portalOptionsStepIndex > 0) {
      setPortalOptionsStepIndex((prev) => Math.max(0, prev - 1));
      return;
    }
    setShowPortalOptionsModal(false);
    if (isPartyBooking) {
      setShowParticipantModal(true);
    } else {
      setShowParticipantConfirmationModal(true);
    }
  };

  const handleParticipantModalBack = () => {
    releaseActiveSlotHold();
    setShowParticipantModal(false);
    setShowTimeSlotsModal(true);
  };

  const handleParticipantModalNext = async () => {
    if (isPartyBooking) {
      const partyCheck = validatePartyRoleSelection({
        hostParticipantId: partyHostParticipantId,
        birthdayChildParticipantId: partyBirthdayChildParticipantId,
        requireBirthdayChild: partySettings.requireBirthdayChild,
        customerParticipants,
      });
      if (!partyCheck.ok) {
        showCustomerError(partyCheck.message);
        return;
      }
    } else if (selectedParticipantIds.length === 0) {
      showCustomerError('Please select at least one participant');
      return;
    }
    if (!isPartyBooking) {
      const limitCheck = validateSelectedParticipantCount(selectedParticipantIds.length);
      if (!limitCheck.ok) {
        showCustomerError(limitCheck.message);
        return;
      }
    }
    const selectedParticipants = isPartyBooking
      ? customerParticipants.filter((p) =>
          [partyHostParticipantId, partyBirthdayChildParticipantId].filter(Boolean).includes(p.id)
        )
      : resolvePortalSelectedParticipants(
          customerParticipants,
          selectedParticipantIds,
          customerAccount
        );
    const anySelectedNeedsWaiver = selectedParticipants.some(
      (participant) => getParticipantWaiverStatus(participant) !== 'valid'
    );
    if (anySelectedNeedsWaiver) {
      setShowParticipantModal(false);
      setShowCamperRegistrationStepModal(false);
      setShowWaiverStepModal(true);
      return;
    }
    const anySelectedNeedsRegistration = selectedParticipants.some((participant) =>
      participantNeedsCamperRegistration(participant)
    );
    setShowParticipantModal(false);
    if (anySelectedNeedsRegistration) {
      setShowWaiverStepModal(false);
      setShowTermsCheckoutModal(false);
      setShowCamperRegistrationStepModal(true);
      return;
    }
    // Day camp / auto-approve with a terms package: collect T&Cs before confirmation/pay
    if (requiresTermsAcknowledgment && !termsAcknowledgment) {
      setShowWaiverStepModal(false);
      setShowCamperRegistrationStepModal(false);
      setShowTermsCheckoutModal(true);
      return;
    }
    if (isPartyBooking) {
      setShowCamperRegistrationStepModal(false);
      await proceedToOptionsOrCheckout();
    } else {
      setShowCamperRegistrationStepModal(false);
      setShowParticipantConfirmationModal(true);
    }
  };

  // Proceed from participant confirmation to ticket selection (same logic as old handleLoginModalNext)
  const handleParticipantConfirmationNext = async () => {
    if (selectedParticipantIds.length === 0) {
      showCustomerError('Please select at least one participant');
      return;
    }
    const limitCheck = validateSelectedParticipantCount(selectedParticipantIds.length);
    if (!limitCheck.ok) {
      showCustomerError(limitCheck.message);
      return;
    }
    await proceedToOptionsOrCheckout();
  };

  const handlePaymentMethodClick = () => {
    setShowPaymentStep(true);
  };

  const handlePayOnline = async () => {
    if (requiresTermsAcknowledgment && !termsAcknowledgment) {
      setShowTermsCheckoutModal(true);
      showCustomerError('Please acknowledge the Terms & Conditions to continue');
      return;
    }
    if (isPartyBooking) {
      const partyCheck = validatePartyRoleSelection({
        hostParticipantId: partyHostParticipantId,
        birthdayChildParticipantId: partyBirthdayChildParticipantId,
        requireBirthdayChild: partySettings.requireBirthdayChild,
        customerParticipants,
      });
      if (!partyCheck.ok) {
        showCustomerError(partyCheck.message);
        return;
      }
    } else {
      const limitCheck = validateSelectedParticipantCount(selectedParticipantIds.length);
      if (!limitCheck.ok) {
        showCustomerError(limitCheck.message);
        return;
      }
      const bookingParty = resolvePortalSelectedParticipants(
        customerParticipants,
        selectedParticipantIds,
        customerAccount
      );
      const ageTicketCheck = assignTicketsToParticipantsStrict({
        participants: bookingParty,
        items: inventoryItems,
        ticketSettings: parsedTicketSettings,
      });
      if (ageTicketCheck.unmatched.length > 0) {
        showCustomerError(summarizeParticipantTicketIssues(ageTicketCheck.unmatched));
        return;
      }
    }
    const totalWithTax = calculateTotal + taxCalculation.totalTax;
    const checkoutAmounts = calculateOnlineCheckoutAmounts(totalWithTax, onlinePaymentSettings);
    const chargeNow = checkoutAmounts.chargeNow;
    const giftApplied = Math.min(
      Number(appliedGiftCard?.appliedAmount) || 0,
      chargeNow
    );
    const helcimDue = Math.max(0, Math.round((chargeNow - giftApplied) * 100) / 100);
    const participantRows = isPartyBooking
      ? buildPartyParticipantRowsForCheckout({
          customerParticipants,
          customerAccount,
          hostParticipantId: partyHostParticipantId,
          birthdayChildParticipantId: partyBirthdayChildParticipantId,
          selectedParticipantTicketAssignments,
          inventoryItems,
          getParticipantWaiverStatus,
          getParticipantCamperRegistrationStatus,
        })
      : selectedParticipantIds.map((participantId) => {
      const participant = customerParticipants.find((p) => p.id === participantId);
      const waiverStatus = getParticipantWaiverStatus(participant);
      const camperRegistrationStatus = getParticipantCamperRegistrationStatus(participant);
      const assignedTicketId = selectedParticipantTicketAssignments[participantId]?.inventory_item_id || null;
      const matchingTicketId = assignedTicketId || Object.keys(selectedTickets).find((ticketId) => {
        const ticket = inventoryItems.find((i) => i.id === ticketId);
        if (!ticket || !participant?.date_of_birth) return false;
        const ar = ticket.age_restriction;
        if (!ar || (ar.min_value == null && ar.max_value == null)) return false;
        const parsed = typeof ar === 'string' ? (() => { try { return JSON.parse(ar); } catch { return null; } })() : ar;
        return parsed && participantMatchesAgeRestriction(participant.date_of_birth, parsed);
      });
      return {
        participant_id: participant?.booking_customer_participant_id ?? null,
        waiver_participant_id: participant?.waiver_participant_id ?? null,
        inventory_item_id: matchingTicketId || null,
        first_name: participant?.first_name || null,
        last_name: participant?.last_name || null,
        date_of_birth: participant?.date_of_birth ?? null,
        waiver_id: waiverStatus === 'valid' ? participant?.waiver_id ?? null : null,
        waiver_status: waiverStatus,
        camper_registration_document_id:
          camperRegistrationStatus === 'valid'
            ? participant?.camper_registration_document_id ?? participant?.camper_registration_document?.id ?? null
            : null,
        camper_registration_status: camperRegistrationStatus,
      };
    });
    const addonRows = buildPortalOptionCheckoutRowsFromConfig(
      portalOptionsConfig,
      portalOptionSelections,
      portalOptionInventoryItems,
      portalOptionBundleContext,
      { bundleCustomizations: portalBundleCustomizations }
    );
    const selectedDateISO = dayjs(selectedDate).tz(businessTimezone).format('YYYY-MM-DD');
    const timeSlotStartTimeForDb = timeToPostgres(selectedTimeSlot.start_time);
    const pending = {
      businessId,
      activityId: activity.id,
      selectedDate,
      timeSlotStartTime: selectedTimeSlot.start_time,
      selectedDateISO,
      timeSlotStartTimeForDb,
      customerAccountId: customerAccount?.id || null,
      subtotal: calculateTotal,
      totalWithTax,
      chargeNow,
      giftApplied,
      helcimDue,
      taxAmount: taxCalculation.totalTax,
      participantRows,
      addonRows,
    };

    requireSpecialHoursAcknowledgment(async () => {
    setHelcimPayLoading(true);
    paymentFinalizedRef.current = false;
    try {
      const { data: initData, error: initError } = await supabase.functions.invoke('helcim-pay-init', {
        body: {
          amount: Number(helcimDue.toFixed(2)),
          orderTotalWithTax: Number(totalWithTax.toFixed(2)),
          currency: 'CAD',
          businessId,
          activityId: activity.id,
          bookingDate: selectedDateISO,
          bookingTime: timeSlotStartTimeForDb,
          customerId: customerAccount?.id || null,
          participantRows,
          addonRows,
          customerCode: customerAccount?.helcim_customer_code || null,
          slotHoldToken,
          setAsDefaultPaymentMethod: true,
          promoCode: appliedPromoCode || null,
          pricingPromotionId: resolvedPricingPromotion?.id || null,
          giftCardCode: appliedGiftCard?.code || null,
          termsAcknowledgment: termsAcknowledgment || null,
        },
      });
      if (initError) {
        const msg = await getFunctionsInvokeErrorMessage(initError, initData);
        throw new Error(msg || 'Could not start payment');
      }
      if (initData?.error) throw new Error(initData.error);

      const newPendingId = initData?.pendingId;
      if (newPendingId) {
        reportBookingFunnel('payment_started', newPendingId);
      }

      // Gift card covers full amount due now — finalize without Helcim.
      if (initData?.giftCardOnly) {
        const { data: completeData, error: completeError } = await supabase.functions.invoke(
          'booking-complete-gift-card',
          { body: { pendingId: newPendingId } }
        );
        if (completeError) {
          const msg = await getFunctionsInvokeErrorMessage(completeError, completeData);
          throw new Error(msg || 'Could not complete gift card payment');
        }
        if (completeData?.error) throw new Error(completeData.error);
        const bookingId = completeData?.bookingId;
        const manageToken = completeData?.manageToken || null;
        setHelcimPayLoading(false);
        setShowTicketSelectionModal(false);
        setShowPaymentStep(false);
        setAppliedGiftCard(null);
        if (pending?.customerAccountId && pending?.subtotal && bookingId) {
          bookingLoyaltyIntegration.setBusinessId(pending.businessId);
          bookingLoyaltyIntegration.awardPointsForBooking(bookingId, pending.customerAccountId, pending.subtotal);
        }
        if (pending?.businessId && bookingId) {
          const token = await ensureBookingManageToken(pending.businessId, bookingId, manageToken);
          navigate(buildBookingConfirmedPath(pending.businessId, bookingId, token));
        }
        return;
      }

      const checkoutToken = initData?.checkoutToken;
      if (!checkoutToken) throw new Error(initData?.error || 'No checkout token');

      helcimPayRef.current = { checkoutToken, pending };

      const channelName = `helcim-payment-${checkoutToken}`;
      if (helcimRealtimeChannelRef.current) {
        supabase.removeChannel(helcimRealtimeChannelRef.current);
        helcimRealtimeChannelRef.current = null;
      }
      const ch = supabase
        .channel(channelName)
        .on('broadcast', { event: 'payment_completed' }, (payload) => {
          if (paymentFinalizedRef.current) return;
          paymentFinalizedRef.current = true;
          const bookingId = payload?.payload?.bookingId;
          const manageToken = payload?.payload?.manageToken || null;
          const frame = document.getElementById('helcimPayIframe');
          if (frame?.parentNode) frame.remove();
          if (helcimRealtimeChannelRef.current) {
            supabase.removeChannel(helcimRealtimeChannelRef.current);
            helcimRealtimeChannelRef.current = null;
          }
          if (helcimPollingIntervalRef.current) {
            clearInterval(helcimPollingIntervalRef.current);
            helcimPollingIntervalRef.current = null;
          }
          if (helcimPayMessageHandlerRef.current) {
            window.removeEventListener('message', helcimPayMessageHandlerRef.current);
          }
          const p = helcimPayRef.current.pending;
          helcimPayRef.current = { checkoutToken: null, pending: null };
          setHelcimPayLoading(false);
          setShowTicketSelectionModal(false);
          setShowPaymentStep(false);
          if (p?.customerAccountId && p?.subtotal && bookingId) {
            bookingLoyaltyIntegration.setBusinessId(p.businessId);
            bookingLoyaltyIntegration.awardPointsForBooking(bookingId, p.customerAccountId, p.subtotal);
          }
          if (p?.businessId && bookingId) {
            void (async () => {
              try {
                const token = await ensureBookingManageToken(p.businessId, bookingId, manageToken);
                navigate(buildBookingConfirmedPath(p.businessId, bookingId, token));
              } catch (tokenErr) {
                console.error('Confirmation token error:', tokenErr);
                showCustomerError(tokenErr?.message || 'Could not open confirmation page');
              }
            })();
          }
        });
      ch.subscribe();
      helcimRealtimeChannelRef.current = ch;

      const loadScript = () => {
        if (document.querySelector(`script[src="${HELCIM_PAY_SCRIPT_URL}"]`)) return Promise.resolve();
        return new Promise((resolve, reject) => {
          const script = document.createElement('script');
          script.src = HELCIM_PAY_SCRIPT_URL;
          script.onload = () => resolve();
          script.onerror = () => reject(new Error('Failed to load Helcim Pay'));
          document.head.appendChild(script);
        });
      };
      await loadScript();
      if (typeof window.watchForExit !== 'function') {
        throw new Error('Helcim Pay script did not load. Please refresh and try again.');
      }
      appendHelcimPayIframeCompat(checkoutToken);
    } catch (err) {
      setHelcimPayLoading(false);
      console.error('HelcimPay init error:', err);
      showCustomerError(err.message || 'Payment is unavailable. Please try again.');
    }
    });
  };

  const handleSubmitBookingRequest = async () => {
    if (!requiresStaffApproval) {
      return handlePayOnline();
    }
    if (isPartyBooking) {
      const partyCheck = validatePartyRoleSelection({
        hostParticipantId: partyHostParticipantId,
        birthdayChildParticipantId: partyBirthdayChildParticipantId,
        requireBirthdayChild: partySettings.requireBirthdayChild,
        customerParticipants,
      });
      if (!partyCheck.ok) {
        showCustomerError(partyCheck.message);
        return;
      }
    } else {
      const limitCheck = validateSelectedParticipantCount(selectedParticipantIds.length);
      if (!limitCheck.ok) {
        showCustomerError(limitCheck.message);
        return;
      }
    }
    const totalWithTax = calculateTotal + taxCalculation.totalTax;
    const participantRows = isPartyBooking
      ? buildPartyParticipantRowsForCheckout({
          customerParticipants,
          customerAccount,
          hostParticipantId: partyHostParticipantId,
          birthdayChildParticipantId: partyBirthdayChildParticipantId,
          selectedParticipantTicketAssignments,
          inventoryItems,
          getParticipantWaiverStatus,
          getParticipantCamperRegistrationStatus,
        })
      : selectedParticipantIds.map((participantId) => {
          const participant = customerParticipants.find((p) => p.id === participantId);
          const waiverStatus = getParticipantWaiverStatus(participant);
          const camperRegistrationStatus = getParticipantCamperRegistrationStatus(participant);
          const assignedTicketId = selectedParticipantTicketAssignments[participantId]?.inventory_item_id || null;
          return {
            participant_id: participant?.booking_customer_participant_id ?? null,
            waiver_participant_id: participant?.waiver_participant_id ?? null,
            inventory_item_id: assignedTicketId || null,
            first_name: participant?.first_name || null,
            last_name: participant?.last_name || null,
            date_of_birth: participant?.date_of_birth ?? null,
            waiver_id: waiverStatus === 'valid' ? participant?.waiver_id ?? null : null,
            waiver_status: waiverStatus,
            camper_registration_document_id:
              camperRegistrationStatus === 'valid'
                ? participant?.camper_registration_document_id ?? participant?.camper_registration_document?.id ?? null
                : null,
            camper_registration_status: camperRegistrationStatus,
          };
        });
    const addonRows = buildPortalOptionCheckoutRowsFromConfig(
      portalOptionsConfig,
      portalOptionSelections,
      portalOptionInventoryItems,
      portalOptionBundleContext,
      { bundleCustomizations: portalBundleCustomizations }
    );
    const selectedDateISO = dayjs(selectedDate).tz(businessTimezone).format('YYYY-MM-DD');
    const timeSlotStartTimeForDb = timeToPostgres(selectedTimeSlot.start_time);

    requireSpecialHoursAcknowledgment(async () => {
    setSubmitRequestLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('booking-submit-request', {
        body: {
          businessId,
          activityId: activity.id,
          bookingDate: selectedDateISO,
          bookingTime: timeSlotStartTimeForDb,
          customerId: customerAccount?.id || null,
          orderTotalWithTax: Number(totalWithTax.toFixed(2)),
          taxAmount: Number(taxCalculation.totalTax.toFixed(2)),
          participantRows,
          addonRows,
          slotHoldToken,
        },
      });
      if (error) {
        const msg = await getFunctionsInvokeErrorMessage(error, data);
        throw new Error(msg || 'Could not submit booking request');
      }
      if (data?.error) throw new Error(data.error);
      const bookingId = data?.bookingId;
      completeSlotHoldAfterBooking();
      setShowTicketSelectionModal(false);
      setShowPortalOptionsModal(false);
      const manageToken = await ensureBookingManageToken(businessId, bookingId, data?.manageToken || null);
      navigate(
        buildBookingConfirmedPath(businessId, bookingId, manageToken, {
          submitted: '1',
          ...(data?.termsAckToken ? { termsToken: data.termsAckToken } : {}),
        }),
      );
    } catch (err) {
      console.error('Submit booking request error:', err);
      showCustomerError(err.message || 'Could not submit your request. Please try again.');
    } finally {
      setSubmitRequestLoading(false);
    }
    });
  };

  const updateTicketQuantity = (inventoryItemId, delta) => {
    setSelectedTickets(prev => {
      const currentQty = prev[inventoryItemId] || 0;
      const newQty = Math.max(0, currentQty + delta);
      
      // Calculate total tickets after this change
      const totalTickets = Object.values(prev).reduce((sum, qty) => sum + (qty || 0), 0) - currentQty + newQty;
      
      const limitCheck = validateParticipantCountAgainstTicketLimits(totalTickets, onlineTicketLimits);
      if (!limitCheck.ok && delta > 0) {
        showCustomerError(limitCheck.message);
        return prev;
      }
      
      if (newQty === 0) {
        const { [inventoryItemId]: removed, ...rest } = prev;
        return rest;
      }
      return { ...prev, [inventoryItemId]: newQty };
    });
  };

  const ticketsForPricing = useMemo(() => {
    const fromAssignments = ticketCountsFromAssignments(selectedParticipantTicketAssignments);
    const assignmentTotal = Object.values(fromAssignments).reduce((sum, qty) => sum + (qty || 0), 0);
    const selectedTotal = Object.values(selectedTickets).reduce((sum, qty) => sum + (qty || 0), 0);
    return assignmentTotal >= selectedTotal ? fromAssignments : selectedTickets;
  }, [selectedTickets, selectedParticipantTicketAssignments]);

  const totalTicketsForPricing = useMemo(
    () => Object.values(ticketsForPricing).reduce((sum, qty) => sum + (qty || 0), 0),
    [ticketsForPricing],
  );

  const selectedBookingDateISO = useMemo(
    () => (selectedDate ? dayjs(selectedDate).tz(businessTimezone).format('YYYY-MM-DD') : null),
    [selectedDate, businessTimezone],
  );

  const selectedMultiDayWeekDayCount = useMemo(() => {
    if (!isMultiDaySchedule || !selectedBookingDateISO) return null;
    const entry = multiDaySeriesEntries.find((row) => row.anchorDateKey === selectedBookingDateISO);
    return entry?.dayCount || multiDayConfig?.dayCount || null;
  }, [isMultiDaySchedule, selectedBookingDateISO, multiDaySeriesEntries, multiDayConfig?.dayCount]);

  const resolvedPricingPromotion = useMemo(() => {
    if (!selectedBookingDateISO || !selectedTimeSlot?.start_time) return null;
    return resolveApplicableBookingPromotion(bookingPricingPromotions, {
      activityId: activity?.id,
      categoryKey: bookingType?.type_key,
      bookingDate: selectedBookingDateISO,
      bookingTime: selectedTimeSlot.start_time,
      promoCode: appliedPromoCode,
      channel: 'online',
      totalTickets: totalTicketsForPricing,
      purchaseAt: new Date(),
    });
  }, [
    bookingPricingPromotions,
    activity?.id,
    bookingType?.type_key,
    selectedBookingDateISO,
    selectedTimeSlot?.start_time,
    appliedPromoCode,
    totalTicketsForPricing,
  ]);

  const priceOverridesByItemId = useMemo(
    () => buildEffectiveTicketPriceOverrides({
      items: applyOnlineChannelPrices(inventoryItems),
      selectedTickets: ticketsForPricing,
      promotion: resolvedPricingPromotion,
      weekDayCount: selectedMultiDayWeekDayCount,
      fullWeekDayCount: multiDayConfig?.dayCount || null,
    }),
    [
      resolvedPricingPromotion,
      inventoryItems,
      ticketsForPricing,
      selectedMultiDayWeekDayCount,
      multiDayConfig?.dayCount,
    ],
  );

  const effectiveTicketSettings = useMemo(() => {
    if (resolvedPricingPromotion?.apply_conditional_free_rules === false) {
      return { ...parsedTicketSettings, pricing_rules: [] };
    }
    return parsedTicketSettings;
  }, [parsedTicketSettings, resolvedPricingPromotion]);

  const onlinePricedInventoryItems = useMemo(
    () => applyOnlineChannelPrices(inventoryItems),
    [inventoryItems],
  );

  const ticketPricing = useMemo(() => calculateTicketPricing({
    selectedTickets: ticketsForPricing,
    items: onlinePricedInventoryItems,
    ticketSettings: effectiveTicketSettings,
    legacyPromotions: fwpPromotions,
    priceOverridesByItemId,
  }), [ticketsForPricing, onlinePricedInventoryItems, effectiveTicketSettings, fwpPromotions, priceOverridesByItemId]);

  const freeQuantitiesByItem = ticketPricing.freeQuantitiesByItem || {};

  const getFreeQuantity = useCallback((inventoryItemId) => {
    return freeQuantitiesByItem[inventoryItemId] || 0;
  }, [freeQuantitiesByItem]);

  const calculateTotal = (ticketPricing.total || 0) + portalOptionsSubtotal;

  // Tax: use business tax config and ticket cart (paid lines only)
  const taxCalc = useTaxCalculations(businessId);
  const ticketCartItems = useMemo(() => {
    const ticketLines = ticketPricing.lineItems
      .filter((line) => line.paid_quantity > 0 && line.item)
      .map((line) => ({
        id: line.item.id,
        name: line.item.name,
        price: line.unit_price,
        quantity: line.paid_quantity,
        category_id: line.item.category_id ?? null,
        item_tax_overrides: line.item.item_tax_overrides ?? [],
        modifiers: [],
      }));
    const optionLines = selectedPortalOptionsDisplay.map((row) => ({
      id: row.inventory_item_id || row.option_id,
      name: row.name,
      price: row.unit_price,
      quantity: row.quantity,
      category_id: row.category_id ?? null,
      item_tax_overrides: row.item_tax_overrides ?? [],
      modifiers: [],
    }));
    return [...ticketLines, ...optionLines];
  }, [ticketPricing, selectedPortalOptionsDisplay]);
  const taxCalculation = useMemo(() => {
    if (ticketCartItems.length === 0 || calculateTotal <= 0) {
      return { totalTax: 0, aggregatedTaxes: {}, aggregatedRebates: {} };
    }
    return taxCalc.calculateTotalTax(ticketCartItems, 0, 0, calculateTotal);
  }, [ticketCartItems, calculateTotal, taxCalc.calculateTotalTax]);

  const totalWithTax = calculateTotal + taxCalculation.totalTax;
  const checkoutAmounts = useMemo(
    () => calculateOnlineCheckoutAmounts(totalWithTax, onlinePaymentSettings),
    [totalWithTax, onlinePaymentSettings]
  );
  const giftCardAppliedAmount = Number(appliedGiftCard?.appliedAmount) || 0;
  const cardDueNow = Math.max(
    0,
    Math.round((checkoutAmounts.chargeNow - giftCardAppliedAmount) * 100) / 100
  );

  const handleApplyPromoCode = useCallback(() => {
    setAppliedPromoCode(String(promoCodeInput || '').trim());
  }, [promoCodeInput]);

  const handleClearPromoCode = useCallback(() => {
    setAppliedPromoCode('');
    setPromoCodeInput('');
  }, []);

  const handleClearGiftCard = useCallback(() => {
    setAppliedGiftCard(null);
    setGiftCardError(null);
    setGiftCardCodeInput('');
  }, []);

  const handleApplyGiftCard = useCallback(async () => {
    const code = String(giftCardCodeInput || '').trim();
    if (!code) {
      setGiftCardError('Enter a gift card code');
      return;
    }
    if (!businessId) {
      setGiftCardError('Business not loaded');
      return;
    }
    const dueNow = Number(checkoutAmounts.chargeNow) || 0;
    if (dueNow <= 0) {
      setGiftCardError('Nothing is due to pay right now');
      return;
    }
    setGiftCardLoading(true);
    setGiftCardError(null);
    try {
      const { data, error } = await supabase.functions.invoke('booking-gift-card-preview', {
        body: {
          businessId,
          code,
          chargeNow: Number(dueNow.toFixed(2)),
        },
      });
      if (error) {
        const msg = await getFunctionsInvokeErrorMessage(error, data);
        throw new Error(msg || 'Could not apply gift card');
      }
      if (data?.error) throw new Error(data.error);
      setAppliedGiftCard({
        giftCardId: data.giftCardId,
        code: data.code,
        balance: data.balance,
        appliedAmount: data.appliedAmount,
        remainingDue: data.remainingDue,
      });
      setGiftCardCodeInput(data.code || code);
    } catch (err) {
      setAppliedGiftCard(null);
      setGiftCardError(err?.message || 'Could not apply gift card');
    } finally {
      setGiftCardLoading(false);
    }
  }, [giftCardCodeInput, businessId, checkoutAmounts.chargeNow]);

  // If the amount due changes (promo/tickets), rebalance an applied gift card.
  useEffect(() => {
    setAppliedGiftCard((prev) => {
      if (!prev) return prev;
      const due = Number(checkoutAmounts.chargeNow) || 0;
      const applied = Number(prev.appliedAmount) || 0;
      const nextApplied = Math.min(Number(prev.balance) || applied, due);
      const nextRemaining = Math.max(0, Math.round((due - nextApplied) * 100) / 100);
      if (
        Math.abs(nextApplied - applied) <= 0.009 &&
        Math.abs(nextRemaining - Number(prev.remainingDue || 0)) <= 0.009
      ) {
        return prev;
      }
      return {
        ...prev,
        appliedAmount: nextApplied,
        remainingDue: nextRemaining,
      };
    });
  }, [checkoutAmounts.chargeNow]);

  if (loading) {
    return (
      <div style={{ ...styles.page, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={styles.loading}>Loading…</div>
      </div>
    );
  }

  if (error || !business || !activity) {
    return (
      <div style={{ ...styles.page, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={styles.error}>
          {error || 'Activity not found.'}
          <Link to={portalUrl} style={styles.backLink}>← Back to portal</Link>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.page}>
      {/* Same header as portal: business info */}
      <header style={styles.header}>
        <div style={styles.headerInner}>
          {logoUrl && <img src={logoUrl} alt="" style={styles.logo} />}
          <div style={styles.businessInfo}>
            <h1 style={styles.businessName}>{business.name}</h1>
            {business.business_website && (
              <a
                href={business.business_website.startsWith('http') ? business.business_website : `https://${business.business_website}`}
                target="_blank"
                rel="noopener noreferrer"
                style={styles.link}
              >
                {business.business_website.replace(/^https?:\/\//, '')}
              </a>
            )}
            {business.business_address && <div style={styles.meta}>{business.business_address}</div>}
            {business.business_email && <div style={styles.meta}>{business.business_email}</div>}
            {business.business_phone && <div style={styles.meta}>{business.business_phone}</div>}
          </div>
        </div>
      </header>

      {/* Activity content */}
      <div style={styles.content}>
        <Link to={portalUrl} style={styles.backLink}>
          ← Back to portal
        </Link>
        <h2 style={styles.activityName}>{activity.activity_name}</h2>

        {/* Additional information sections (editable in Bookings → Settings → activity → Name tab) */}
        {sections.length > 0 && (
          <div style={styles.sections}>
            {sections.map((s) => (
              <div key={s.id} style={styles.sectionBlock}>
                <div style={styles.sectionHeader}>{s.section_header}</div>
                <div style={styles.sectionDetails}>{s.section_details}</div>
              </div>
            ))}
          </div>
        )}

        {/* Select Date button: if not logged in open login modal first; if logged in open date selector */}
        <div style={styles.buttonWrap}>
          <button
            type="button"
            onClick={() => {
              setCalendarViewDate(new Date());
              setSelectedDate(null);
              setSelectedTimeSlot(null);
              const isLoggedIn = !!(otpVerified && customerAccount?.id);
              if (isLoggedIn) {
                setShowSelectDateModal(true);
              } else {
                setShowLoginModal(true);
              }
            }}
            style={styles.bookButton}
          >
            Select Date
          </button>
        </div>

        {/* Images below Select Date */}
        {images.length > 0 && (
          <div
            style={{
              ...styles.images,
              gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, minmax(0, 1fr))',
            }}
          >
            {images.map((url, i) => (
              <img key={`${url}-${i}`} src={url} alt="" style={styles.image} />
            ))}
          </div>
        )}
      </div>

      {/* Select Date modal – same width as schedule modal */}
      {showSelectDateModal && (
        <div style={styles.modalOverlay}>
          <div style={styles.modalContent}>
            <div style={styles.modalHeader}>
              <div style={styles.modalTitle}>
                {isIndividualSchedule ? (activity?.activity_name || 'Select Date') : 'Select Date'}
              </div>
              <button
                type="button"
                onClick={() => setShowSelectDateModal(false)}
                style={styles.modalClose}
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <div style={styles.modalBody}>
              {!hasAnyAvailableDates ? (
                <div style={styles.noDatesWrap}>
                  <div style={styles.noDatesMessage}>No Available Dates For This Activity</div>
                  {!isIndividualSchedule ? (
                    <div style={styles.calendarHeader}>
                      <button type="button" onClick={() => navigateMonth(-1)} style={styles.calendarNavBtn}>
                        <FiChevronLeft size={20} />
                      </button>
                      <div style={styles.calendarMonthTitle}>{monthName}</div>
                      <button type="button" onClick={() => navigateMonth(1)} style={styles.calendarNavBtn}>
                        <FiChevronRight size={20} />
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : isMultiDaySchedule ? (
                <div style={styles.multiDayWeeksList} data-testid="portal-multi-day-series-list">
                  <div style={styles.individualDatesColumnHeaders}>
                    <span>Week starts</span>
                    <span>Session</span>
                    <span style={{ textAlign: 'right' }}>Book</span>
                  </div>
                  {multiDaySeriesEntries.map((entry) => (
                    <div key={entry.scheduleName} style={styles.multiDayWeekCard}>
                      <div style={styles.multiDayWeekHeading}>{entry.label}</div>
                      <div style={styles.multiDayWeekMeta}>
                        {entry.dayCount || 5}-day week (one booking)
                        {multiDayConfig?.dayCount
                          && entry.dayCount
                          && entry.dayCount < multiDayConfig.dayCount
                          ? ` · priced as ${entry.dayCount}/${multiDayConfig.dayCount}`
                          : ''}
                      </div>
                      {entry.anchorSlots.map((slot, slotIndex) => {
                        const timeLabel = formatBookingScheduleTimeDisplay(slot.start_time) || slot.start_time || '—';
                        const durationMins = entry.durationMins || 0;
                        let timeRange = timeLabel;
                        if (durationMins > 0) {
                          const startNorm = normalizeBookingScheduleTime(slot.start_time);
                          if (startNorm) {
                            const endLabel = formatBookingScheduleTimeDisplay(
                              dayjs(`1970-01-01 ${startNorm}`).add(durationMins, 'minute').format('HH:mm'),
                            );
                            if (endLabel) timeRange = `${timeLabel} - ${endLabel}`;
                          }
                        }
                        return (
                          <div key={`${entry.anchorDateKey}-${slot.id || slot.start_time}-${slotIndex}`} style={styles.multiDayWeekSlotRow}>
                            <div style={styles.individualSlotMain}>
                              <span style={styles.individualSlotTime}>{timeRange}</span>
                              <span style={styles.individualSlotActivity}>
                                {activity?.activity_name || 'Activity'}
                              </span>
                            </div>
                            <button
                              type="button"
                              data-testid="portal-multi-day-book"
                              onClick={() => handleIndividualSlotBook(entry.date, slot, slotIndex)}
                              style={styles.individualBookBtn}
                            >
                              BOOK
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
              ) : isIndividualSchedule ? (
                <div style={styles.individualDatesList} data-testid="portal-individual-dates-list">
                  <div style={styles.individualDatesColumnHeaders}>
                    <span>Date</span>
                    <span>Activity</span>
                    <span style={{ textAlign: 'right' }}>Book</span>
                  </div>
                  {individualDateEntries.map((entry) => (
                    <div key={entry.dateKey} style={styles.individualDateSection}>
                      <div style={styles.individualDateHeading}>{entry.label}</div>
                      {entry.slots.map((slot, slotIndex) => {
                        const timeLabel = formatBookingScheduleTimeDisplay(slot.start_time) || slot.start_time || '—';
                        const durationMins = Number(activity?.duration_minutes) || 0;
                        let timeRange = timeLabel;
                        if (durationMins > 0) {
                          const startNorm = normalizeBookingScheduleTime(slot.start_time);
                          if (startNorm) {
                            const endLabel = formatBookingScheduleTimeDisplay(
                              dayjs(`1970-01-01 ${startNorm}`).add(durationMins, 'minute').format('HH:mm'),
                            );
                            if (endLabel) timeRange = `${timeLabel} - ${endLabel}`;
                          }
                        }
                        return (
                          <div key={`${entry.dateKey}-${slot.id || slot.start_time}-${slotIndex}`} style={styles.individualSlotRow}>
                            <div style={styles.individualSlotMain}>
                              <span style={styles.individualSlotTime}>{timeRange}</span>
                              <span style={styles.individualSlotActivity}>
                                {activity?.activity_name || 'Activity'}
                              </span>
                            </div>
                            <button
                              type="button"
                              data-testid="portal-individual-date-book"
                              onClick={() => handleIndividualSlotBook(entry.date, slot, slotIndex)}
                              style={styles.individualBookBtn}
                            >
                              BOOK
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
              ) : (
                <div style={styles.calendarWrap}>
                  <div style={styles.calendarHeader}>
                    <button type="button" onClick={() => navigateMonth(-1)} style={styles.calendarNavBtn}>
                      <FiChevronLeft size={20} />
                    </button>
                    <div style={styles.calendarMonthTitle}>{monthName}</div>
                    <button type="button" onClick={() => navigateMonth(1)} style={styles.calendarNavBtn}>
                      <FiChevronRight size={20} />
                    </button>
                  </div>
                  <div style={styles.calendarGrid}>
                    {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((d) => (
                      <div key={d} style={styles.calendarDayHeader}>{d}</div>
                    ))}
                    {days.map((date, idx) => {
                      const available = date && isAvailable(date);
                      const isDisabled = date && !available;
                      return (
                        <div
                          key={idx}
                          role={available ? 'button' : undefined}
                          tabIndex={available ? 0 : -1}
                          data-testid={available ? 'portal-calendar-selectable-day' : undefined}
                          aria-label={date && available ? `Select ${fmt(date)}` : undefined}
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            
                            if (!available || !isAvailable(date)) {
                              if (date && latestAllowedDateStr) {
                                const dateStr = fmt(date);
                                const dateDayjs = dayjs(dateStr).tz(businessTimezone).startOf('day');
                                const maxDayjs = dayjs(latestAllowedDateStr).tz(businessTimezone).startOf('day');
                                if (dateDayjs.isAfter(maxDayjs)) {
                                  showCustomerError(`This date is beyond the maximum advance booking period of ${maxAdvance?.value || 'N/A'} ${maxAdvance?.unit || 'days'}.`);
                                  return;
                                }
                              }
                              showCustomerError('This date is not available for booking.');
                              return;
                            }
                            
                            setSelectedDate(date);
                          }}
                          onKeyDown={(e) => {
                            if (!available) {
                              e.preventDefault();
                              return;
                            }
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              setSelectedDate(date);
                            }
                          }}
                          style={{
                            ...styles.calendarDay,
                            ...(!date ? styles.calendarDayEmpty : {}),
                            ...(date && available && isToday(date) && !isSelected(date) ? styles.calendarDayToday : {}),
                            ...(date && available && isSelected(date) ? styles.calendarDaySelected : {}),
                            ...(isDisabled ? styles.calendarDayDisabled : {}),
                          }}
                        >
                          {date ? date.getDate() : ''}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
            <div style={styles.modalFooter}>
              <button type="button" onClick={handleDateModalBack} style={styles.footerBack}>
                Back
              </button>
              {hasAnyAvailableDates && !isIndividualSchedule && (
                <button
                  type="button"
                  onClick={handleDateModalNext}
                  disabled={!selectedDate}
                  style={{
                    ...styles.footerNext,
                    ...(!selectedDate ? styles.footerNextDisabled : {}),
                  }}
                >
                  Next
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Time slots modal – same width as schedule modal */}
      {showTimeSlotsModal && selectedDate && (
        <div style={styles.modalOverlay}>
          <div style={styles.modalContent}>
            <div style={styles.modalHeader}>
              <div style={styles.modalTitle}>
                Select Time – {dayjs(selectedDate).tz(businessTimezone).format('dddd, MMMM D, YYYY')}
              </div>
              <button
                type="button"
                onClick={() => {
                  setSelectedTimeSlot(null);
                  setShowTimeSlotsModal(false);
                }}
                style={styles.modalClose}
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <div style={styles.modalBody}>
              {slotOccupancyLoading && !slotOccupancyReady ? (
                <div style={{ ...styles.noDatesMessage, marginBottom: 12 }}>
                  Checking time slot availability…
                </div>
              ) : null}
              {slotsForSelectedDate.length === 0 ? (
                <div style={styles.noDatesMessage}>No time slots for this date.</div>
              ) : (
                <div style={styles.timeSlotsList}>
                  {slotsForSelectedDate.map((slot, idx) => {
                    const slotKey = portalSlotKey(slot) || `slot-${idx}-${slot.start_time}`;
                    const total = getPortalSlotCapacity(slot);
                    const spacesLeft = getSlotSpacesLeft(slot);
                    const isSelectable = slotOccupancyReady && !slotOccupancyLoading && spacesLeft > 0;
                    const isUnavailable = slotOccupancyReady && spacesLeft <= 0;
                    const isSelected = selectedTimeSlot
                      && normalizeBookingScheduleTime(selectedTimeSlot.start_time)
                        === normalizeBookingScheduleTime(slot.start_time);
                    const timeLabel = formatBookingScheduleTimeDisplay(slot.start_time) || slot.start_time || '—';
                    let statusLabel = 'Checking availability…';
                    if (slotOccupancyReady) {
                      if (spacesLeft <= 0) statusLabel = 'Unavailable';
                      else if (total > 1) statusLabel = `${spacesLeft} spaces left`;
                      else statusLabel = 'Available';
                    }

                    return (
                      <div
                        key={slotKey}
                        role={isSelectable ? 'button' : undefined}
                        tabIndex={isSelectable ? 0 : -1}
                        aria-disabled={!isSelectable}
                        data-testid={isSelectable ? 'portal-time-slot-selectable' : undefined}
                        onClick={() => {
                          if (!isSelectable) return;
                          setSelectedTimeSlot({ ...slot, _index: idx });
                        }}
                        onKeyDown={(e) => {
                          if (!isSelectable) return;
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            setSelectedTimeSlot({ ...slot, _index: idx });
                          }
                        }}
                        style={{
                          ...styles.timeSlotCard,
                          ...(isSelected ? styles.timeSlotCardSelected : {}),
                          ...(isUnavailable ? styles.timeSlotCardUnavailable : {}),
                          ...(isSelectable ? { cursor: 'pointer' } : {}),
                        }}
                      >
                        <span
                          style={{
                            ...styles.timeSlotTime,
                            ...(isUnavailable ? styles.timeSlotTimeUnavailable : {}),
                          }}
                        >
                          {timeLabel}
                        </span>
                        <span
                          style={{
                            ...styles.timeSlotSpaces,
                            ...(isUnavailable ? styles.timeSlotSpacesUnavailable : {}),
                          }}
                        >
                          {statusLabel}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            <div style={styles.modalFooter}>
              <button type="button" onClick={handleTimeSlotsModalBack} style={styles.footerBack}>
                Back
              </button>
              <button
                type="button"
                onClick={handleTimeSlotsModalNext}
                disabled={
                  !selectedTimeSlot
                  || slotsForSelectedDate.length === 0
                  || slotHoldAcquiring
                  || slotOccupancyLoading
                  || !slotOccupancyReady
                }
                style={{
                  ...styles.footerNext,
                  ...(!selectedTimeSlot
                  || slotsForSelectedDate.length === 0
                  || slotHoldAcquiring
                  || slotOccupancyLoading
                  || !slotOccupancyReady
                    ? styles.footerNextDisabled
                    : {}),
                }}
              >
                {slotHoldAcquiring ? 'Reserving time…' : 'Next'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Login/Account Creation Modal (at Select date if not logged in; no participant selection here) */}
      {showLoginModal && (
        <div style={styles.modalOverlay}>
          <div style={{ ...styles.modalContent, maxWidth: '600px' }}>
            <div style={styles.modalHeader}>
              <div style={styles.modalTitle}>
                {showAccountCreation ? 'Create Account' : !otpVerified ? 'Continue' : 'Taking you to date selection…'}
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowLoginModal(false);
                }}
                style={styles.modalClose}
                aria-label="Close"
              >
                <FiX size={24} />
              </button>
            </div>
            <div style={styles.modalBody}>
              {showAccountCreation ? (
                // Create account form (no account yet)
                <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                  <div>
                    <h3 style={{ fontSize: '18px', fontWeight: '600', marginBottom: '16px', color: TavariStyles.colors.gray900 }}>
                      Create Your Account
                    </h3>
                    <p style={{ fontSize: '14px', color: TavariStyles.colors.gray600, marginBottom: '20px' }}>
                      Please provide the following information to create your account
                    </p>
                  </div>
                  <div>
                    <label style={{ display: 'block', marginBottom: '8px', fontWeight: '600', fontSize: '14px', color: TavariStyles.colors.gray900 }}>
                      First Name *
                    </label>
                    <input
                      type="text"
                      value={accountForm.firstName}
                      onChange={(e) => setAccountForm(prev => ({ ...prev, firstName: e.target.value }))}
                      style={styles.modalInput}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', marginBottom: '8px', fontWeight: '600', fontSize: '14px', color: TavariStyles.colors.gray900 }}>
                      Last Name *
                    </label>
                    <input
                      type="text"
                      value={accountForm.lastName}
                      onChange={(e) => setAccountForm(prev => ({ ...prev, lastName: e.target.value }))}
                      style={styles.modalInput}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', marginBottom: '8px', fontWeight: '600', fontSize: '14px', color: TavariStyles.colors.gray900 }}>
                      Email Address *
                    </label>
                    <input
                      type="email"
                      value={accountForm.email}
                      onChange={(e) => setAccountForm(prev => ({ ...prev, email: e.target.value }))}
                      style={styles.modalInput}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', marginBottom: '8px', fontWeight: '600', fontSize: '14px', color: TavariStyles.colors.gray900 }}>
                      City
                    </label>
                    <input
                      type="text"
                      value={accountForm.city}
                      onChange={(e) => setAccountForm(prev => ({ ...prev, city: e.target.value }))}
                      style={styles.modalInput}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={handleCreateAccount}
                    disabled={loadingOTP || !accountForm.firstName || !accountForm.lastName || !accountForm.email}
                    style={{
                      ...styles.footerNext,
                      width: '100%',
                      marginTop: '8px',
                      ...((loadingOTP || !accountForm.firstName || !accountForm.lastName || !accountForm.email) ? styles.footerNextDisabled : {})
                    }}
                  >
                    {loadingOTP ? 'Creating Account...' : 'Create Account'}
                  </button>
                </div>
              ) : !otpVerified ? (
                // Phone Number and OTP Step (when phone is in system or first step)
                <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                  {!otpSent ? (
                    // Phone Number Input
                    <>
                      <div>
                        <label style={{ display: 'block', marginBottom: '8px', fontWeight: '600', fontSize: '14px', color: TavariStyles.colors.gray900 }}>
                          Phone Number
                        </label>
                        <p style={{ fontSize: '14px', color: TavariStyles.colors.gray600, marginBottom: '12px' }}>
                          Enter your phone number. You’ll receive a verification code by email if you have an account.
                        </p>
                        <input
                          type="tel"
                          value={phoneNumber}
                          onChange={(e) => setPhoneNumber(e.target.value)}
                          placeholder="(555) 123-4567"
                          style={styles.modalInput}
                        />
                      </div>
                      <button
                        type="button"
                        onClick={handlePhoneSubmit}
                        disabled={loadingOTP || !phoneNumber}
                        style={{
                          ...styles.footerNext,
                          width: '100%',
                          ...((loadingOTP || !phoneNumber) ? styles.footerNextDisabled : {})
                        }}
                      >
                        {loadingOTP ? 'Next...' : 'Next'}
                      </button>
                    </>
                  ) : (
                    // OTP Verification (phone in system)
                    <>
                      <div>
                        <label style={{ display: 'block', marginBottom: '8px', fontWeight: '600', fontSize: '14px', color: TavariStyles.colors.gray900 }}>
                          Verification Code
                        </label>
                        <p style={{ fontSize: '14px', color: TavariStyles.colors.gray600, marginBottom: '12px' }}>
                          OTP sent to your email. Enter the 6-digit code below.
                        </p>
                        <div
                          role="status"
                          style={{
                            marginBottom: 12,
                            padding: '10px 12px',
                            borderRadius: 8,
                            background: '#eff6ff',
                            border: '1px solid #bfdbfe',
                            color: '#1e3a8a',
                            fontSize: 13,
                            lineHeight: 1.5,
                          }}
                        >
                          <strong style={{ display: 'block', marginBottom: 4, color: '#1e40af' }}>
                            Check your junk or spam folder
                          </strong>
                          If you do not see the code in your inbox within a few minutes, check junk, spam, or promotions.
                          Mark the message as Not junk / Not spam so future emails reach you.
                        </div>
                        <input
                          type="text"
                          value={otpCode}
                          onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                          placeholder="000000"
                          maxLength={6}
                          style={{
                            ...styles.modalInput,
                            fontSize: '24px',
                            textAlign: 'center',
                            letterSpacing: '8px',
                            fontFamily: 'monospace',
                          }}
                        />
                      </div>
                      <button
                        type="button"
                        onClick={handleOTPVerify}
                        disabled={loadingOTP || otpCode.length !== 6}
                        style={{
                          ...styles.footerNext,
                          width: '100%',
                          ...((loadingOTP || otpCode.length !== 6) ? styles.footerNextDisabled : {})
                        }}
                      >
                        {loadingOTP ? 'Verifying...' : 'Verify Code'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setOtpSent(false);
                          setOtpCode('');
                        }}
                        style={{
                          ...styles.footerBack,
                          width: '100%',
                          background: 'transparent',
                          border: `1px solid ${TavariStyles.colors.gray300}`
                        }}
                      >
                        Change Phone Number
                      </button>
                    </>
                  )}
                </div>
              ) : (
                // After OTP verified we close and open date modal (no participant selection in login modal)
                <div style={{ padding: '24px', textAlign: 'center', color: TavariStyles.colors.gray600 }}>
                  Taking you to date selection…
                </div>
              )}
            </div>
            <div style={styles.modalFooter}>
              <button type="button" onClick={handleLoginModalBack} style={styles.footerBack}>
                Back
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Participant Selection Modal (after date + time; user is already logged in) */}
      {showParticipantModal && selectedDate && selectedTimeSlot && (
        <div style={styles.modalOverlay}>
          <div style={{ ...styles.modalContent, maxWidth: '600px' }}>
            <div style={styles.modalHeader}>
              <div style={styles.modalTitle}>{isPartyBooking ? 'Book your party' : 'Select Participants'}</div>
              <button type="button" onClick={() => setShowParticipantModal(false)} style={styles.modalClose} aria-label="Close">×</button>
            </div>
            <div style={styles.modalBody}>
              {slotHoldActive ? (
                <BookingSlotHoldBanner
                  secondsRemaining={slotHoldSecondsRemaining}
                  idleSecondsLeft={slotHoldIdleSecondsLeft}
                />
              ) : null}
              {isPartyBooking ? (
                <PartyBookingRoleSelector
                  customerParticipants={customerParticipants}
                  hostParticipantId={partyHostParticipantId}
                  birthdayChildParticipantId={partyBirthdayChildParticipantId}
                  requireBirthdayChild={partySettings.requireBirthdayChild}
                  onHostChange={setPartyHostParticipantId}
                  onBirthdayChildChange={setPartyBirthdayChildParticipantId}
                  getParticipantWaiverStatus={getParticipantWaiverStatus}
                  onAddBirthdayChild={handleAddPartyBirthdayChild}
                  addingBirthdayChild={addingPartyBirthdayChild}
                />
              ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                <div>
                  <h3 style={{ fontSize: '18px', fontWeight: '600', marginBottom: '8px', color: TavariStyles.colors.gray900 }}>
                    Select Participants
                  </h3>
                  <p style={{ fontSize: '14px', color: TavariStyles.colors.gray600 }}>
                    Select who will be attending this booking. Tickets will be automatically selected based on ages.
                    {onlineTicketLimits.maxTickets != null && (
                      <span style={{ display: 'block', marginTop: 8, fontWeight: 500 }}>
                        Up to {onlineTicketLimits.maxTickets} participant{onlineTicketLimits.maxTickets === 1 ? '' : 's'} per booking.
                      </span>
                    )}
                  </p>
                </div>

                {/* Participant 1 (account owner) - tap card to edit name & birthdate */}
                {customerAccount?.id && (() => {
                    const participant1 = customerParticipants.find(p => p.is_account_owner) || customerParticipants[0];
                    const nameFromAccount = customerAccount?.customer_name?.split(' ') || [];
                    const firstName = participant1?.first_name || nameFromAccount[0] || '';
                    const lastName = participant1?.last_name || (nameFromAccount.length > 1 ? nameFromAccount.slice(1).join(' ') : '') || (nameFromAccount[0] ? '' : (customerAccount?.email?.split('@')[0] || 'You'));
                    const participant1Id = participant1?.id || customerAccount.id;
                    const isP1Selected = participant1Id && selectedParticipantIds.includes(participant1Id);
                    const waiverStatusP1 = getParticipantWaiverStatus(participant1);
                    const displayName = (firstName || lastName) ? `${firstName} ${lastName}`.trim() : (customerAccount?.customer_name || customerAccount?.email || customerAccount?.customer_email || 'Account owner');
                    const openP1Edit = () => {
                      const dob = participant1?.date_of_birth || customerAccount?.date_of_birth;
                      let y = '', m = '', d = '';
                      if (dob) {
                        const parts = normalizeDateOnlyString(dob).split('-');
                        if (parts.length >= 3) { y = parts[0]; m = parts[1]; d = parts[2]; }
                      }
                      setEditP1Form({
                        firstName: firstName || '',
                        lastName: lastName || '',
                        birthdate: { year: y, month: m, day: d }
                      });
                      setEditingParticipant1(true);
                    };
                    return (
                      <div>
                        <label style={{ display: 'block', marginBottom: '12px', fontWeight: '600', fontSize: '14px', color: TavariStyles.colors.gray900 }}>
                          Participant 1
                        </label>
                        {!editingParticipant1 ? (
                          <div
                            role="button"
                            tabIndex={0}
                            onClick={(e) => { if (!e.target.closest('[data-participant-checkbox]')) openP1Edit(); }}
                            onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && !e.target.closest('[data-participant-checkbox]')) openP1Edit(); }}
                            style={{
                              padding: '16px',
                              border: `2px solid ${isP1Selected ? TavariStyles.colors.primary : TavariStyles.colors.gray200}`,
                              borderRadius: '8px',
                              backgroundColor: isP1Selected ? `${TavariStyles.colors.primary}15` : 'white',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '12px',
                              cursor: 'pointer'
                            }}
                          >
                            <div data-participant-checkbox onClick={(e) => e.stopPropagation()}>
                              <TavariCheckbox
                                checked={!!isP1Selected}
                                onChange={(checked) => handleParticipant1Toggle(checked, participant1Id)}
                                size="md"
                              />
                            </div>
                            <div style={{ flex: 1 }}>
                              <div style={{ fontWeight: '600', fontSize: '14px', color: TavariStyles.colors.gray900 }}>
                                {displayName}
                                <span style={{ fontSize: '13px', color: TavariStyles.colors.gray600, marginLeft: '8px' }}>
                                  (Account Owner) · Tap to edit
                                </span>
                              </div>
                              {participant1?.date_of_birth ? (
                                <div style={{ fontSize: '13px', color: TavariStyles.colors.gray600, marginTop: '4px' }}>
                                  Age: {calculateAge(participant1.date_of_birth)} years old
                                </div>
                              ) : (
                                <div style={{ fontSize: '13px', color: TavariStyles.colors.gray600, marginTop: '4px', fontStyle: 'italic' }}>
                                  Tap card to add birthdate for ticket selection
                                </div>
                              )}
                              <div style={{ fontSize: '13px', marginTop: '4px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                {waiverStatusP1 === 'valid' && (
                                  <span style={{ color: '#10b981', fontWeight: '600' }}>✓ Waiver Complete</span>
                                )}
                                {waiverStatusP1 === 'missing' && (
                                  <span style={{ color: '#ef4444', fontWeight: '600' }}>⚠ Waiver Required</span>
                                )}
                                {waiverStatusP1 === 'expired' && (
                                  <span style={{ color: '#f59e0b', fontWeight: '600' }}>⚠ Waiver Expired</span>
                                )}
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div style={{
                            padding: '20px',
                            border: `1px solid ${TavariStyles.colors.gray200}`,
                            borderRadius: '8px',
                            backgroundColor: TavariStyles.colors.gray50
                          }}>
                            <h4 style={{ fontSize: '16px', fontWeight: '600', color: TavariStyles.colors.gray900, marginBottom: '16px' }}>
                              Edit Participant 1
                            </h4>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '16px' }}>
                              <div>
                                <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', color: TavariStyles.colors.gray700, marginBottom: '4px' }}>First name</label>
                                <input
                                  type="text"
                                  value={editP1Form.firstName}
                                  onChange={(e) => setEditP1Form(prev => ({ ...prev, firstName: e.target.value }))}
                                  placeholder="First name"
                                  style={styles.portalFormInput}
                                />
                              </div>
                              <div>
                                <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', color: TavariStyles.colors.gray700, marginBottom: '4px' }}>Last name</label>
                                <input
                                  type="text"
                                  value={editP1Form.lastName}
                                  onChange={(e) => setEditP1Form(prev => ({ ...prev, lastName: e.target.value }))}
                                  placeholder="Last name"
                                  style={styles.portalFormInput}
                                />
                              </div>
                              <div>
                                <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', color: TavariStyles.colors.gray700, marginBottom: '4px' }}>Birthdate (for ticket selection)</label>
                                <BirthdateCalendarPicker
                                  value={editP1Form.birthdate}
                                  onChange={(birthdate) => setEditP1Form((prev) => ({ ...prev, birthdate }))}
                                />
                              </div>
                            </div>
                            <div style={{ display: 'flex', gap: '8px' }}>
                              <button
                                type="button"
                                onClick={async () => {
                                  if (!editP1Form.firstName?.trim() || !editP1Form.lastName?.trim()) {
                                    showCustomerError('First and last name are required');
                                    return;
                                  }
                                  try {
                                    const birthdate = (editP1Form.birthdate.year && editP1Form.birthdate.month && editP1Form.birthdate.day)
                                      ? `${editP1Form.birthdate.year}-${editP1Form.birthdate.month}-${editP1Form.birthdate.day}`
                                      : null;
                                    console.log('[CustomerPortal] Saving Participant 1 (upsert)...', { customerId: customerAccount.id, businessId, first_name: editP1Form.firstName.trim(), last_name: editP1Form.lastName.trim(), date_of_birth: birthdate });
                                    const { data: rows, error } = await supabase.rpc('bookings_upsert_portal_participant_owner', {
                                      p_customer_id: customerAccount.id,
                                      p_business_id: businessId,
                                      p_first_name: editP1Form.firstName.trim(),
                                      p_last_name: editP1Form.lastName.trim(),
                                      p_date_of_birth: birthdate
                                    });
                                    if (error) throw error;
                                    const row = Array.isArray(rows) ? rows[0] : rows;
                                    if (row?.id) {
                                      console.log('[CustomerPortal] Participant 1 saved:', { id: row.id, first_name: row.first_name, last_name: row.last_name, date_of_birth: row.date_of_birth });
                                      setCustomerParticipants(prev => {
                                        const others = prev.filter(p => !p.is_account_owner);
                                        return [{ ...row, is_account_owner: true }, ...others];
                                      });
                                      setSelectedParticipantIds(prev => {
                                        const next = prev.filter(id => id !== participant1Id);
                                        if (!next.includes(row.id)) next.push(row.id);
                                        return next;
                                      });
                                      setEditingParticipant1(false);
                                      toast.success('Participant 1 updated');
                                    }
                                  } catch (err) {
                                    console.error('[CustomerPortal] Error saving Participant 1:', err);
                                    showCustomerError(err?.message || 'Failed to update. Try again.');
                                  }
                                }}
                                style={{ flex: 1, padding: '12px', backgroundColor: TavariStyles.colors.primary, color: 'white', border: 'none', borderRadius: '8px', fontWeight: '600', cursor: 'pointer' }}
                              >
                                Save
                              </button>
                              <button
                                type="button"
                                onClick={() => setEditingParticipant1(false)}
                                style={{ padding: '12px 20px', backgroundColor: TavariStyles.colors.gray200, color: TavariStyles.colors.gray800, border: 'none', borderRadius: '8px', fontWeight: '600', cursor: 'pointer' }}
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  {/* Add Additional Participant — form opens directly under this button */}
                  {!showAddParticipant ? (
                    <button
                      type="button"
                      onClick={() => {
                        setEditingParticipantId(null);
                        setShowAddParticipant(true);
                      }}
                      style={{
                        padding: '12px 20px',
                        border: `2px dashed ${TavariStyles.colors.gray300}`,
                        borderRadius: '8px',
                        backgroundColor: 'transparent',
                        color: TavariStyles.colors.primary,
                        fontWeight: '600',
                        fontSize: '14px',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '8px'
                      }}
                    >
                      <FiPlus size={18} />
                      Add Additional Participant
                    </button>
                  ) : (
                    <div
                      ref={addParticipantFormRef}
                      style={{
                        padding: '20px',
                        border: `1px solid ${TavariStyles.colors.gray200}`,
                        borderRadius: '8px',
                        backgroundColor: TavariStyles.colors.gray50
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                        <h4 style={{ fontSize: '16px', fontWeight: '600', color: TavariStyles.colors.gray900 }}>
                          Add New Participant
                        </h4>
                        <button
                          type="button"
                          onClick={() => {
                            setShowAddParticipant(false);
                            setNewParticipant({ firstName: '', lastName: '', birthdate: { year: '', month: '', day: '' } });
                          }}
                          style={{
                            border: 'none',
                            background: 'transparent',
                            cursor: 'pointer',
                            padding: '4px'
                          }}
                        >
                          <FiX size={20} />
                        </button>
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                        <div>
                          <label style={{ display: 'block', marginBottom: '8px', fontWeight: '600', fontSize: '14px', color: TavariStyles.colors.gray900 }}>
                            First Name *
                          </label>
                          <input
                            type="text"
                            value={newParticipant.firstName}
                            onChange={(e) => setNewParticipant(prev => ({ ...prev, firstName: e.target.value }))}
                            style={styles.portalFormInput}
                          />
                        </div>

                        <div>
                          <label style={{ display: 'block', marginBottom: '8px', fontWeight: '600', fontSize: '14px', color: TavariStyles.colors.gray900 }}>
                            Last Name *
                          </label>
                          <input
                            type="text"
                            value={newParticipant.lastName}
                            onChange={(e) => setNewParticipant(prev => ({ ...prev, lastName: e.target.value }))}
                            style={styles.portalFormInput}
                          />
                        </div>

                        <div>
                          <label style={{ display: 'block', marginBottom: '8px', fontWeight: '600', fontSize: '14px', color: TavariStyles.colors.gray900 }}>
                            Birthdate *
                          </label>
                          <BirthdateCalendarPicker
                            value={newParticipant.birthdate}
                            onChange={(birthdate) => setNewParticipant((prev) => ({ ...prev, birthdate }))}
                          />
                        </div>

                        <button
                          type="button"
                          onClick={async () => {
                            if (!newParticipant.firstName || !newParticipant.lastName || !newParticipant.birthdate.year || !newParticipant.birthdate.month || !newParticipant.birthdate.day) {
                              showCustomerError('Please fill in all required fields');
                              return;
                            }

                            try {
                              const birthdate = `${newParticipant.birthdate.year}-${newParticipant.birthdate.month}-${newParticipant.birthdate.day}`;
                              const ageYears = (() => {
                                try {
                                  const dob = dayjs(birthdate);
                                  if (!dob.isValid()) return null;
                                  return dayjs().diff(dob, 'year');
                                } catch (_) {
                                  return null;
                                }
                              })();
                              const participantType =
                                ageYears != null && ageYears < 18 ? 'minor' : 'additional_adult';
                              
                              // Use RPC so anon can add participants (bypasses RLS; validates customer_id/business_id)
                              console.log('[CustomerPortal] Saving additional participant...', { customerId: customerAccount.id, businessId, first_name: newParticipant.firstName, last_name: newParticipant.lastName, date_of_birth: birthdate, participantType });
                              const { data: rows, error } = await supabase.rpc('bookings_add_portal_participant', {
                                p_customer_id: customerAccount.id,
                                p_business_id: businessId,
                                p_first_name: newParticipant.firstName,
                                p_last_name: newParticipant.lastName,
                                p_date_of_birth: birthdate || null,
                                p_participant_type: participantType,
                              });

                              if (error) {
                                console.error('[CustomerPortal] Add participant RPC error:', error);
                                if (error.code === 'PGRST202' || error.message?.includes('Could not find')) {
                                  showCustomerError(
                                    "Additional participants can't be saved yet. Run the database migration 'bookings_rpc_add_portal_participant.sql' on your Supabase project, then try again."
                                  );
                                  return;
                                }
                                throw error;
                              }

                              const participant = Array.isArray(rows) ? rows[0] : rows;
                              if (!participant?.id) {
                                console.error('[CustomerPortal] Add participant RPC returned no id:', rows);
                                showCustomerError('Participant was not saved. Please try again.');
                                return;
                              }
                              console.log('[CustomerPortal] Additional participant saved:', { id: participant.id, first_name: participant.first_name, last_name: participant.last_name, date_of_birth: participant.date_of_birth });

                              setCustomerParticipants(prev => [
                                ...prev,
                                {
                                  ...participant,
                                  camper_registration_document_id: null,
                                  camper_registration_status: camperRegistrationService.getParticipantStatus(
                                    { ...participant, participant_type: participant.participant_type || 'minor' },
                                    requiresCamperRegistration
                                  ),
                                },
                              ]);
                              tryAddParticipantToSelection(participant.id);
                              setNewParticipant({ firstName: '', lastName: '', birthdate: { year: '', month: '', day: '' } });
                              setShowAddParticipant(false);
                              toast.success('Participant added successfully');
                            } catch (error) {
                              console.error('[CustomerPortal] Error adding participant:', error);
                              showCustomerError(error?.message || 'Error adding participant. Please try again.');
                            }
                          }}
                          style={{
                            ...styles.footerNext,
                            width: '100%'
                          }}
                        >
                          Add Participant
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Additional participants (Participant 2, 3, ...) */}
                  {customerParticipants.filter(p => !p.is_account_owner).length > 0 && (
                    <div>
                      <label style={{ display: 'block', marginBottom: '12px', fontWeight: '600', fontSize: '14px', color: TavariStyles.colors.gray900 }}>
                        Additional Participants
                      </label>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {customerParticipants.filter(p => !p.is_account_owner).map((participant, idx) => {
                          const isSelected = selectedParticipantIds.includes(participant.id);
                          const waiverStatus = getParticipantWaiverStatus(participant);
                          const openEdit = () => {
                            let y = '', m = '', d = '';
                            if (participant.date_of_birth) {
                              const parts = normalizeDateOnlyString(participant.date_of_birth).split('-');
                              if (parts.length >= 3) { y = parts[0]; m = parts[1]; d = parts[2]; }
                            }
                            setShowAddParticipant(false);
                            setEditParticipantForm({
                              firstName: participant.first_name || '',
                              lastName: participant.last_name || '',
                              birthdate: { year: y, month: m, day: d }
                            });
                            setEditingParticipantId(participant.id);
                          };
                          const isEditingThis = editingParticipantId === participant.id && customerAccount?.id;
                          const cardStyle = {
                            padding: '16px',
                            border: `2px solid ${isSelected ? TavariStyles.colors.primary : TavariStyles.colors.gray200}`,
                            borderRadius: '8px',
                            backgroundColor: isSelected ? `${TavariStyles.colors.primary}15` : 'white',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '12px'
                          };
                          const participantDisplayName = [participant.first_name, participant.last_name]
                            .filter(Boolean)
                            .join(' ')
                            .trim()
                            .replace(/\}\}+/g, '')
                            .trim() || 'Participant';
                          const waiverCompleteSpanStyle = { color: '#10b981', fontWeight: '600' };
                          const waiverRequiredSpanStyle = { color: '#ef4444', fontWeight: '600' };
                          return (
                            <div key={participant.id} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                              <div style={cardStyle}>
                                <div data-participant-checkbox onClick={(e) => e.stopPropagation()}>
                                  <TavariCheckbox
                                    checked={isSelected}
                                    onChange={(checked) => handleAdditionalParticipantToggle(participant.id, checked)}
                                    size="md"
                                    label=""
                                  />
                                </div>
                                <div
                                  role="button"
                                  tabIndex={0}
                                  onClick={(e) => { if (!e.target.closest('[data-participant-checkbox]')) openEdit(); }}
                                  onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && !e.target.closest('[data-participant-checkbox]')) openEdit(); }}
                                  style={{ flex: 1, cursor: 'pointer' }}
                                >
                                  <div style={{ fontWeight: '600', fontSize: '14px', color: TavariStyles.colors.gray900 }}>
                                    {`Participant ${idx + 2}: ${participantDisplayName}`}
                                    <span style={{ fontSize: '13px', color: TavariStyles.colors.gray600, marginLeft: '8px' }}>
                                      Tap to edit or remove
                                    </span>
                                  </div>
                                  {participant.date_of_birth ? (
                                    <div style={{ fontSize: '13px', color: TavariStyles.colors.gray600, marginTop: '4px' }}>
                                      Age: {calculateAge(participant.date_of_birth)} years old
                                    </div>
                                  ) : (
                                    <div style={{ fontSize: '13px', color: '#f59e0b', marginTop: '4px', fontStyle: 'italic' }}>
                                      Birthdate optional (can skip)
                                    </div>
                                  )}
                                  <div style={{ fontSize: '13px', marginTop: '4px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    {waiverStatus === 'valid' && (
                                      <span style={waiverCompleteSpanStyle}>✓ Waiver Complete</span>
                                    )}
                                    {waiverStatus === 'missing' && (
                                      <span style={waiverRequiredSpanStyle}>⚠ Waiver Required</span>
                                    )}
                                    {waiverStatus === 'expired' && (
                                      <span style={{ color: '#f59e0b', fontWeight: '600' }}>⚠ Waiver Expired</span>
                                    )}
                                  </div>
                                </div>
                              </div>

                              {isEditingThis && (
                                <div
                                  ref={editParticipantFormRef}
                                  style={{
                                    padding: '20px',
                                    border: `1px solid ${TavariStyles.colors.gray200}`,
                                    borderRadius: '8px',
                                    backgroundColor: TavariStyles.colors.gray50
                                  }}
                                >
                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                                    <h4 style={{ fontSize: '16px', fontWeight: '600', color: TavariStyles.colors.gray900 }}>
                                      Edit participant
                                    </h4>
                                    <button
                                      type="button"
                                      onClick={() => { setEditingParticipantId(null); }}
                                      style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: '4px' }}
                                    >
                                      <FiX size={20} />
                                    </button>
                                  </div>
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                                    <div>
                                      <label style={{ display: 'block', marginBottom: '8px', fontWeight: '600', fontSize: '14px', color: TavariStyles.colors.gray900 }}>First Name *</label>
                                      <input
                                        type="text"
                                        value={editParticipantForm.firstName}
                                        onChange={(e) => setEditParticipantForm(prev => ({ ...prev, firstName: e.target.value }))}
                                        style={styles.portalFormInput}
                                      />
                                    </div>
                                    <div>
                                      <label style={{ display: 'block', marginBottom: '8px', fontWeight: '600', fontSize: '14px', color: TavariStyles.colors.gray900 }}>Last Name *</label>
                                      <input
                                        type="text"
                                        value={editParticipantForm.lastName}
                                        onChange={(e) => setEditParticipantForm(prev => ({ ...prev, lastName: e.target.value }))}
                                        style={styles.portalFormInput}
                                      />
                                    </div>
                                    <div>
                                      <label style={{ display: 'block', marginBottom: '8px', fontWeight: '600', fontSize: '14px', color: TavariStyles.colors.gray900 }}>Birthdate</label>
                                      <BirthdateCalendarPicker
                                        value={editParticipantForm.birthdate}
                                        onChange={(birthdate) => setEditParticipantForm((prev) => ({ ...prev, birthdate }))}
                                      />
                                    </div>
                                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                                      <button
                                        type="button"
                                        onClick={async () => {
                                          if (!editParticipantForm.firstName?.trim() || !editParticipantForm.lastName?.trim()) {
                                            showCustomerError('First and last name are required');
                                            return;
                                          }
                                          try {
                                            const birthdate = (editParticipantForm.birthdate.year && editParticipantForm.birthdate.month && editParticipantForm.birthdate.day)
                                              ? `${editParticipantForm.birthdate.year}-${editParticipantForm.birthdate.month}-${editParticipantForm.birthdate.day}`
                                              : null;
                                            const { data: rows, error } = await supabase.rpc('bookings_update_portal_participant', {
                                              p_customer_id: customerAccount.id,
                                              p_business_id: businessId,
                                              p_participant_id: editingParticipantId,
                                              p_first_name: editParticipantForm.firstName.trim(),
                                              p_last_name: editParticipantForm.lastName.trim(),
                                              p_date_of_birth: birthdate
                                            });
                                            if (error) throw error;
                                            const row = Array.isArray(rows) ? rows[0] : rows;
                                            if (row?.id) {
                                              setCustomerParticipants(prev => prev.map(p => p.id === row.id ? { ...p, ...row } : p));
                                              setEditingParticipantId(null);
                                              toast.success('Participant updated');
                                            }
                                          } catch (err) {
                                            console.error('[CustomerPortal] Error updating participant:', err);
                                            showCustomerError(err?.message || 'Failed to update. Try again.');
                                          }
                                        }}
                                        style={{ flex: 1, minWidth: '80px', padding: '12px', backgroundColor: TavariStyles.colors.primary, color: 'white', border: 'none', borderRadius: '8px', fontWeight: '600', cursor: 'pointer' }}
                                      >
                                        Save
                                      </button>
                                      <button
                                        type="button"
                                        onClick={async () => {
                                          if (!window.confirm('Remove this participant? They will no longer appear in your list.')) return;
                                          try {
                                            const { error } = await supabase.rpc('bookings_delete_portal_participant', {
                                              p_customer_id: customerAccount.id,
                                              p_business_id: businessId,
                                              p_participant_id: editingParticipantId
                                            });
                                            if (error) throw error;
                                            setCustomerParticipants(prev => prev.filter(p => p.id !== editingParticipantId));
                                            setSelectedParticipantIds(prev => prev.filter(id => id !== editingParticipantId));
                                            setEditingParticipantId(null);
                                            toast.success('Participant removed');
                                          } catch (err) {
                                            console.error('[CustomerPortal] Error deleting participant:', err);
                                            showCustomerError(err?.message || 'Failed to remove. Try again.');
                                          }
                                        }}
                                        style={{ padding: '12px 20px', backgroundColor: '#ef4444', color: 'white', border: 'none', borderRadius: '8px', fontWeight: '600', cursor: 'pointer' }}
                                      >
                                        Remove
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => setEditingParticipantId(null)}
                                        style={{ padding: '12px 20px', backgroundColor: TavariStyles.colors.gray200, color: TavariStyles.colors.gray800, border: 'none', borderRadius: '8px', fontWeight: '600', cursor: 'pointer' }}
                                      >
                                        Cancel
                                      </button>
                                    </div>
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
            <div style={styles.modalFooter}>
              <button type="button" onClick={handleParticipantModalBack} style={styles.footerBack}>
                Back
              </button>
              <button
                type="button"
                onClick={handleParticipantModalNext}
                disabled={isPartyBooking ? !partyCanProceed : selectedParticipantIds.length === 0}
                style={{
                  ...styles.footerNext,
                  ...((isPartyBooking ? !partyCanProceed : selectedParticipantIds.length === 0) ? styles.footerNextDisabled : {})
                }}
              >
                Next
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Waiver step modal: some participants need a waiver – complete for all in profile or only visiting today */}
      {showWaiverStepModal && (
        <div style={styles.modalOverlay}>
          <div style={{ ...styles.modalContent, maxWidth: '520px' }}>
            <div style={styles.modalHeader}>
              <div style={styles.modalTitle}>Waiver required</div>
              <button type="button" onClick={() => setShowWaiverStepModal(false)} style={styles.modalClose} aria-label="Close">×</button>
            </div>
            <div style={styles.modalBody}>
              <p style={{ marginBottom: 16, fontSize: 15, color: TavariStyles.colors.gray700 }}>
                Some selected participants still need a current waiver before booking. You can complete waivers for everyone in your profile who needs one, or only for those visiting today.
              </p>
              {selectedParticipantsNeedingWaiver.length > 0 && (
                <div
                  style={{
                    marginBottom: 16,
                    padding: '12px 14px',
                    borderRadius: 8,
                    backgroundColor: TavariStyles.colors.gray50,
                    border: `1px solid ${TavariStyles.colors.gray200}`
                  }}
                >
                  <div style={{ fontSize: 13, fontWeight: 700, color: TavariStyles.colors.gray900, marginBottom: 8 }}>
                    These selected participants need a new waiver:
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {selectedParticipantsNeedingWaiver.map((participant) => (
                      <div key={participant.id} style={{ fontSize: 14, color: TavariStyles.colors.gray700 }}>
                        {getParticipantDisplayName(participant)}
                        {getParticipantWaiverStatus(participant) === 'expired' ? ' (expired waiver)' : ' (missing waiver)'}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <p style={{ marginBottom: 20, fontSize: 14, color: TavariStyles.colors.gray600 }}>
                {isPartyBooking
                  ? 'After signing, you’ll return here to continue booking your party.'
                  : 'After signing, you’ll return here to confirm who’s attending and continue to tickets.'}
              </p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
                {(defaultWaiverTemplateKey || waiverTemplateLoadDone) ? (
                  <button
                    type="button"
                    onClick={handleCompleteWaiversClick}
                    disabled={!customerAccount?.id}
                    style={{
                      padding: '12px 24px',
                      backgroundColor: TavariStyles.colors.primary,
                      color: 'white',
                      fontWeight: 600,
                      borderRadius: 8,
                      border: 'none',
                      cursor: customerAccount?.id ? 'pointer' : 'not-allowed',
                      opacity: customerAccount?.id ? 1 : 0.7,
                    }}
                  >
                    Complete waivers
                  </button>
                ) : (
                  <span style={{ padding: '12px 24px', color: TavariStyles.colors.gray500 }}>Loading…</span>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setShowWaiverStepModal(false);
                    const partyIds = isPartyBooking
                      ? [partyHostParticipantId, partyBirthdayChildParticipantId].filter(Boolean)
                      : undefined;
                    openPostComplianceStep(undefined, partyIds, { skipWaiverCheck: true });
                  }}
                  style={{ padding: '12px 24px', border: `1px solid ${TavariStyles.colors.gray300}`, borderRadius: 8, background: 'white', fontWeight: 600, cursor: 'pointer' }}
                >
                  Skip for now
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Camper registration step modal: annual form per camper before check-in (payment still allowed) */}
      {showCamperRegistrationStepModal && (
        <div style={styles.modalOverlay}>
          <div style={{ ...styles.modalContent, maxWidth: '520px' }}>
            <div style={styles.modalHeader}>
              <div style={styles.modalTitle}>Annual camper registration</div>
              <button type="button" onClick={() => setShowCamperRegistrationStepModal(false)} style={styles.modalClose} aria-label="Close">×</button>
            </div>
            <div style={styles.modalBody}>
              <p style={{ marginBottom: 16, fontSize: 15, color: TavariStyles.colors.gray700 }}>
                {requiresCamperRegistration
                  ? 'Selected campers need a current annual registration and medical form that stays valid through camp day. Complete each form below to continue booking — this replaces the old post-booking email request.'
                  : 'Selected campers need a current annual registration and medical form before check-in.'}
              </p>
              {selectedParticipantsNeedingCamperRegistration.length > 0 && (
                <div
                  style={{
                    marginBottom: 16,
                    padding: '12px 14px',
                    borderRadius: 8,
                    backgroundColor: TavariStyles.colors.gray50,
                    border: `1px solid ${TavariStyles.colors.gray200}`,
                  }}
                >
                  <div style={{ fontSize: 13, fontWeight: 700, color: TavariStyles.colors.gray900, marginBottom: 8 }}>
                    Complete registration for:
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {selectedParticipantsNeedingCamperRegistration.map((participant) => (
                      <div
                        key={participant.id}
                        style={{
                          display: 'flex',
                          flexWrap: 'wrap',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: 8,
                        }}
                      >
                        <div style={{ fontSize: 14, color: TavariStyles.colors.gray700 }}>
                          {getParticipantDisplayName(participant)}
                          {getParticipantCamperRegistrationStatus(participant) === 'expired'
                            ? ' (expired registration)'
                            : ' (missing registration)'}
                        </div>
                        <button
                          type="button"
                          onClick={() => handleOpenCamperRegistration(participant)}
                          disabled={!customerAccount?.id}
                          style={{
                            padding: '8px 14px',
                            backgroundColor: TavariStyles.colors.primary,
                            color: 'white',
                            fontWeight: 600,
                            borderRadius: 8,
                            border: 'none',
                            cursor: customerAccount?.id ? 'pointer' : 'not-allowed',
                            fontSize: 13,
                          }}
                        >
                          Complete form
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <p style={{ marginBottom: 20, fontSize: 14, color: TavariStyles.colors.gray600 }}>
                After submitting, you’ll return here to continue booking.
              </p>
              {selectedParticipantsNeedingCamperRegistration.length === 0 ? (
                <button
                  type="button"
                  onClick={() => {
                    setShowCamperRegistrationStepModal(false);
                    openPostComplianceStep(undefined, undefined, { skipWaiverCheck: true });
                  }}
                  style={{
                    padding: '12px 24px',
                    border: 'none',
                    borderRadius: 8,
                    background: TavariStyles.colors.primary,
                    color: '#fff',
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  Continue
                </button>
              ) : requiresCamperRegistration ? (
                <p style={{ margin: 0, fontSize: 13, color: TavariStyles.colors.gray500 }}>
                  Complete every camper form above to continue. Names and account details are prefilled where possible.
                </p>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setShowCamperRegistrationStepModal(false);
                    if (isPartyBooking) {
                      setShowParticipantConfirmationModal(false);
                      proceedToOptionsOrCheckout();
                    } else {
                      setShowParticipantConfirmationModal(true);
                    }
                  }}
                  style={{
                    padding: '12px 24px',
                    border: `1px solid ${TavariStyles.colors.gray300}`,
                    borderRadius: 8,
                    background: 'white',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Continue without completing
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      <BookingTermsCheckoutModal
        open={showTermsCheckoutModal}
        businessId={businessId}
        packageId={activity?.terms_package_id || null}
        activityName={activity?.activity_name || 'this activity'}
        bookerName={
          customerAccount?.customer_name
          || [customerAccount?.first_name, customerAccount?.last_name].filter(Boolean).join(' ')
          || ''
        }
        onClose={() => setShowTermsCheckoutModal(false)}
        onComplete={(payload) => {
          setTermsAcknowledgment(payload);
          setShowTermsCheckoutModal(false);
          openPostComplianceStep(undefined, undefined, {
            skipWaiverCheck: true,
            termsAckOverride: payload,
          });
        }}
      />

      {/* Participant confirmation modal: confirm who is attending this booking, then ticket selection */}
      {showParticipantConfirmationModal && selectedDate && selectedTimeSlot && (
        <div style={styles.modalOverlay}>
          <div style={{ ...styles.modalContent, maxWidth: '560px' }}>
            <div style={styles.modalHeader}>
              <div style={styles.modalTitle}>Confirm participants</div>
              <button type="button" onClick={() => setShowParticipantConfirmationModal(false)} style={styles.modalClose} aria-label="Close">×</button>
            </div>
            <div style={styles.modalBody}>
              {slotHoldActive ? (
                <BookingSlotHoldBanner
                  secondsRemaining={slotHoldSecondsRemaining}
                  idleSecondsLeft={slotHoldIdleSecondsLeft}
                />
              ) : null}
              <p style={{ marginBottom: 16, fontSize: 14, color: TavariStyles.colors.gray600 }}>
                Select who is attending this booking. Then continue to ticket selection.
                {onlineTicketLimits.maxTickets != null && (
                  <span style={{ display: 'block', marginTop: 8 }}>
                    Up to {onlineTicketLimits.maxTickets} participant{onlineTicketLimits.maxTickets === 1 ? '' : 's'} per booking.
                  </span>
                )}
                {onlineTicketLimits.minTickets != null && onlineTicketLimits.minTickets > 1 && (
                  <span style={{ display: 'block', marginTop: 4 }}>
                    At least {onlineTicketLimits.minTickets} participants required.
                  </span>
                )}
              </p>
              {selectedParticipantsNeedingCamperRegistration.length > 0 && (
                <div
                  style={{
                    marginBottom: 16,
                    padding: '12px 14px',
                    borderRadius: 8,
                    backgroundColor: '#fff7ed',
                    border: '1px solid #fed7aa',
                    color: '#9a3412',
                    fontSize: 13,
                    lineHeight: 1.5,
                  }}
                >
                  <strong>Annual camper registration needed before arrival.</strong>
                  <div>
                    Payment can still be completed, but staff will need the annual camper registration
                    before check-in for: {selectedParticipantsNeedingCamperRegistration.map(getParticipantDisplayName).join(', ')}.
                  </div>
                </div>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {customerParticipants.map((p) => {
                  const isSelected = selectedParticipantIds.includes(p.id);
                  const name = [p.first_name, p.last_name].filter(Boolean).join(' ') || 'Participant';
                  return (
                    <label key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 12, border: `2px solid ${isSelected ? TavariStyles.colors.primary : TavariStyles.colors.gray200}`, borderRadius: 8, backgroundColor: isSelected ? `${TavariStyles.colors.primary}15` : 'white', cursor: 'pointer' }}>
                      <TavariCheckbox
                        checked={isSelected}
                        onChange={(checked) => {
                          if (checked) tryAddParticipantToSelection(p.id);
                          else setSelectedParticipantIds(prev => prev.filter(id => id !== p.id));
                        }}
                        size="md"
                      />
                      <span style={{ fontWeight: 500 }}>{name}</span>
                      {p.is_account_owner && <span style={{ fontSize: 13, color: TavariStyles.colors.gray600 }}>(Account owner)</span>}
                      {isSelected && participantNeedsCamperRegistration(p) && (
                        <span style={{ fontSize: 13, color: '#c2410c', fontWeight: 600 }}>
                          Annual registration required
                        </span>
                      )}
                      {isSelected && participantNeedsCamperRegistration(p) && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            handleOpenCamperRegistration(p);
                          }}
                          style={{
                            marginLeft: 'auto',
                            padding: '6px 10px',
                            fontSize: 13,
                            fontWeight: 600,
                            borderRadius: 6,
                            border: 'none',
                            background: TavariStyles.colors.primary,
                            color: '#fff',
                            cursor: 'pointer',
                          }}
                        >
                          Complete registration
                        </button>
                      )}
                    </label>
                  );
                })}
              </div>
            </div>
            <div style={styles.modalFooter}>
              <button type="button" onClick={() => { setShowParticipantConfirmationModal(false); setShowParticipantModal(true); }} style={styles.footerBack}>
                Back
              </button>
              <button
                type="button"
                onClick={handleParticipantConfirmationNext}
                disabled={selectedParticipantIds.length === 0}
                style={{ ...styles.footerNext, ...(selectedParticipantIds.length === 0 ? styles.footerNextDisabled : {}) }}
              >
                Next
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Party / activity options before payment */}
      <PortalActivityOptionsModal
        open={showPortalOptionsModal && !!selectedDate && !!selectedTimeSlot}
        optionsConfig={portalOptionsConfig}
        selections={portalOptionSelections}
        onSelectionsChange={setPortalOptionSelections}
        bundleCustomizations={portalBundleCustomizations}
        onBundleCustomizationsChange={setPortalBundleCustomizations}
        businessId={businessId}
        inventoryItems={portalOptionInventoryItems}
        bundleContext={portalOptionBundleContext}
        stepIndex={portalOptionsStepIndex}
        onStepIndexChange={setPortalOptionsStepIndex}
        onContinue={handlePortalOptionsContinue}
        onBack={handlePortalOptionsBack}
        onClose={() => setShowPortalOptionsModal(false)}
        isPartyBooking={isPartyBooking}
        requiresStaffApproval={requiresStaffApproval}
        checkoutActionLabel={requiresStaffApproval ? 'Review Your Booking' : 'Proceed to Payment'}
        addonSettingsRaw={activity?.addon_settings}
        modalStyles={styles}
      />

      <SpecialHoursReminderModal
        open={showSpecialHoursReminderModal}
        entry={specialHoursReminderEntry}
        dateLabel={selectedBookingDateLabel}
        onConfirm={handleSpecialHoursReminderConfirm}
      />

      <PortalCustomerErrorModal
        open={Boolean(customerError)}
        title={customerError?.title}
        message={customerError?.message}
        businessName={business?.name}
        phone={business?.business_phone}
        email={business?.business_email}
        onClose={() => setCustomerError(null)}
      />

      {/* Ticket confirmation – auto-assigned from selected participants (no manual selection) */}
      {showTicketSelectionModal && selectedDate && selectedTimeSlot && (
        <div style={styles.modalOverlay}>
          <div style={styles.modalContent}>
            <div style={styles.modalHeader}>
              <div style={styles.modalTitle}>
                {isPartyBooking
                  ? (requiresStaffApproval
                    ? `Review your party request – ${dayjs(selectedDate).tz(businessTimezone).format('dddd, MMMM D, YYYY')} at ${selectedTimeSlot.start_time}`
                    : `Review your party – ${dayjs(selectedDate).tz(businessTimezone).format('dddd, MMMM D, YYYY')} at ${selectedTimeSlot.start_time}`)
                  : `Pay with card – ${dayjs(selectedDate).tz(businessTimezone).format('dddd, MMMM D, YYYY')} at ${selectedTimeSlot.start_time}`}
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowTicketSelectionModal(false);
                  setShowPaymentStep(false);
                }}
                style={styles.modalClose}
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <div style={styles.modalBody}>
              {slotHoldActive ? (
                <BookingSlotHoldBanner
                  secondsRemaining={slotHoldSecondsRemaining}
                  idleSecondsLeft={slotHoldIdleSecondsLeft}
                />
              ) : null}
              {ticketsLoading ? (
                <div style={styles.noDatesMessage}>Loading tickets…</div>
              ) : inventoryItems.length === 0 ? (
                <div style={styles.noDatesMessage}>{getTicketConfigIssueMessage()}</div>
              ) : (() => {
                const bookingParty = resolvePortalSelectedParticipants(
                  customerParticipants,
                  selectedParticipantIds,
                  customerAccount
                );
                const ticketCountsForDisplay = ticketCountsFromAssignments(selectedParticipantTicketAssignments);
                const totalTickets = Object.values(ticketCountsForDisplay).reduce((sum, qty) => sum + (qty || 0), 0);
                const partyWithTickets = bookingParty.filter(
                  (p) => selectedParticipantTicketAssignments[p.id]?.inventory_item_id
                );
                const hostParticipant = customerParticipants.find((p) => p.id === partyHostParticipantId);
                const childParticipant = customerParticipants.find((p) => p.id === partyBirthdayChildParticipantId);
                const partyPackageAssignment = partyHostParticipantId
                  ? selectedParticipantTicketAssignments[partyHostParticipantId]
                  : null;
                const partyPackageItem =
                  inventoryItems.find((i) => i.id === partyPackageAssignment?.inventory_item_id) ||
                  inventoryItems[0] ||
                  null;

                const formatParticipantName = (p) =>
                  [p?.first_name, p?.last_name].filter(Boolean).join(' ').trim() || 'Guest';

                if (!isPartyBooking && hasParticipantTicketIssues) {
                  const hasMissingBirthdate = participantTicketIssues.some(
                    (issue) => issue.reason === 'missing_birthdate'
                  );
                  const hasAgeMismatch = participantTicketIssues.some(
                    (issue) => issue.reason === 'no_matching_ticket'
                  );
                  return (
                    <div style={{ padding: '24px 0' }}>
                      <div
                        style={{
                          padding: '14px 16px',
                          borderRadius: 8,
                          backgroundColor: '#fef2f2',
                          border: '1px solid #fecaca',
                          color: '#991b1b',
                          fontSize: 14,
                          lineHeight: 1.5,
                          marginBottom: 16,
                        }}
                      >
                        <strong style={{ display: 'block', marginBottom: 8 }}>
                          {hasMissingBirthdate && !hasAgeMismatch
                            ? 'Some participants need a birthdate before tickets can be assigned.'
                            : hasAgeMismatch && !hasMissingBirthdate
                              ? 'Unfortunately there are no spaces available for this age.'
                              : 'We could not assign tickets for everyone in your group.'}
                        </strong>
                        <ul style={{ margin: 0, paddingLeft: 20 }}>
                          {participantTicketIssues.map((issue) => (
                            <li key={issue.participant?.id || issue.reason} style={{ marginBottom: 8 }}>
                              {formatParticipantTicketIssueMessage(issue)}
                            </li>
                          ))}
                        </ul>
                      </div>
                      <p style={{ fontSize: 13, color: TavariStyles.colors.gray600, margin: 0 }}>
                        {hasMissingBirthdate
                          ? 'Update participant birthdates, remove participants who cannot be accommodated, or contact the business for help.'
                          : 'Remove participants who cannot be accommodated, or contact the business for help.'}
                      </p>
                    </div>
                  );
                }
                if (!isPartyBooking && (totalTickets === 0 || partyWithTickets.length < bookingParty.length)) {
                  return (
                    <div style={{ padding: '24px 0', color: TavariStyles.colors.gray700, fontSize: '14px' }}>
                      <p style={{ marginBottom: '12px' }}>We couldn’t assign tickets automatically. Make sure each participant has a birthdate (tap their card to add one).</p>
                      <p style={{ fontSize: '13px', color: TavariStyles.colors.gray600 }}>Tickets are chosen by age based on who’s coming.</p>
                    </div>
                  );
                }
                if (isPartyBooking && !partyCheckoutReady) {
                  return (
                    <div style={{ padding: '24px 0', color: TavariStyles.colors.gray700, fontSize: '14px' }}>
                      <p style={{ marginBottom: '12px' }}>
                        We couldn’t load your party package. Make sure a party package is linked to this activity in Bookings settings.
                      </p>
                      <p style={{ fontSize: '13px', color: TavariStyles.colors.gray600 }}>
                        Go back and confirm the party host{partySettings.requireBirthdayChild ? ' and birthday child' : ''}, or contact the business for help.
                      </p>
                    </div>
                  );
                }
                if (isPartyBooking) {
                  const packageBasePrice = resolveInventoryTicketPrice(partyPackageItem);
                  const packagePrice = partyPackageItem?.id && priceOverridesByItemId[partyPackageItem.id] != null
                    ? Number.parseFloat(priceOverridesByItemId[partyPackageItem.id]) || 0
                    : packageBasePrice;
                  return (
                    <>
                      <div
                        style={{
                          marginBottom: 16,
                          padding: '14px 16px',
                          borderRadius: 8,
                          backgroundColor: '#eff6ff',
                          border: '1px solid #bfdbfe',
                          fontSize: 13,
                          color: '#1e40af',
                          lineHeight: 1.5,
                        }}
                      >
                        You are booking <strong>one party space</strong> for this time slot.
                      </div>
                      <div style={{ marginBottom: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <div style={{ fontSize: 13, color: TavariStyles.colors.gray700, padding: '10px 12px', backgroundColor: TavariStyles.colors.gray50, borderRadius: 8 }}>
                          <span style={{ fontWeight: 600, color: TavariStyles.colors.gray900 }}>Party host:</span>{' '}
                          {formatParticipantName(hostParticipant)}
                        </div>
                        {partySettings.requireBirthdayChild && childParticipant && (
                          <div style={{ fontSize: 13, color: TavariStyles.colors.gray700, padding: '10px 12px', backgroundColor: TavariStyles.colors.gray50, borderRadius: 8 }}>
                            <span style={{ fontWeight: 600, color: TavariStyles.colors.gray900 }}>Birthday child:</span>{' '}
                            {formatParticipantName(childParticipant)}
                          </div>
                        )}
                      </div>
                      <div style={{ ...styles.ticketCard, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', marginBottom: '8px', borderRadius: '8px', border: `1px solid ${TavariStyles.colors.gray200}`, backgroundColor: 'white' }}>
                        <div>
                          <div style={{ fontWeight: '600', fontSize: '14px', color: TavariStyles.colors.gray900 }}>
                            1 × {activity?.activity_name || partyPackageItem?.name || partyPackageAssignment?.inventory_item_name || 'Party package'}
                          </div>
                          <div style={{ fontSize: '13px', color: TavariStyles.colors.gray600 }}>
                            Party room booking
                          </div>
                        </div>
                        <div style={{ fontWeight: 600, fontSize: 14 }}>${packagePrice.toFixed(2)}</div>
                      </div>
                      {requiresStaffApproval && (
                        <div
                          style={{
                            marginBottom: 16,
                            padding: '12px 14px',
                            borderRadius: 8,
                            backgroundColor: '#eff6ff',
                            border: '1px solid #bfdbfe',
                            fontSize: 13,
                            color: '#1e40af',
                            lineHeight: 1.5,
                          }}
                        >
                          Your spot will be held while our team reviews this request. No payment is due until your booking is approved.
                        </div>
                      )}
                      <PortalOrderReviewList
                        lines={selectedPortalOptionsDisplay}
                        title="Your order"
                        onRemove={handleOrderReviewRemove}
                        onEdit={handleOrderReviewEdit}
                      />
                      <div style={{ marginTop: '16px', paddingTop: '16px', borderTop: `1px solid ${TavariStyles.colors.gray200}` }}>
                        <div style={styles.ticketTotal}>
                          <div style={styles.ticketTotalLabel}>Subtotal:</div>
                          <div style={styles.ticketTotalAmount}>${calculateTotal.toFixed(2)}</div>
                        </div>
                        {taxCalculation.totalTax > 0 && (
                          <>
                            <TaxBreakdown taxCalculation={taxCalculation} taxCalc={taxCalc} />
                            <div style={{ ...styles.ticketTotal, marginTop: 8, backgroundColor: 'transparent', border: 'none', padding: '8px 20px' }}>
                              <div style={styles.ticketTotalLabel}>Tax:</div>
                              <div style={styles.ticketTotalAmount}>${taxCalc.formatTaxAmount(taxCalculation.totalTax)}</div>
                            </div>
                          </>
                        )}
                        <div style={{ ...styles.ticketTotal, marginTop: taxCalculation.totalTax > 0 ? 8 : 12, border: `2px solid ${TavariStyles.colors.primary}` }}>
                          <div style={styles.ticketTotalLabel}>Total with tax:</div>
                          <div style={styles.ticketTotalAmount}>${totalWithTax.toFixed(2)}</div>
                        </div>
                        {checkoutAmounts.isDeposit && !requiresStaffApproval && (
                          <>
                            <div style={{ ...styles.ticketTotal, marginTop: 8, backgroundColor: '#ecfdf5', border: '1px solid #a7f3d0' }}>
                              <div style={styles.ticketTotalLabel}>Deposit due now:</div>
                              <div style={styles.ticketTotalAmount}>${checkoutAmounts.chargeNow.toFixed(2)}</div>
                            </div>
                            <div style={{ ...styles.ticketTotal, marginTop: 8, backgroundColor: 'transparent', border: 'none', padding: '8px 20px' }}>
                              <div style={styles.ticketTotalLabel}>Balance due at check-in:</div>
                              <div style={styles.ticketTotalAmount}>${checkoutAmounts.balanceDue.toFixed(2)}</div>
                            </div>
                          </>
                        )}
                        {giftCardAppliedAmount > 0.009 && !requiresStaffApproval && (
                          <>
                            <div style={{ ...styles.ticketTotal, marginTop: 8, backgroundColor: '#ecfdf5', border: '1px solid #a7f3d0' }}>
                              <div style={styles.ticketTotalLabel}>Gift card:</div>
                              <div style={styles.ticketTotalAmount}>-${giftCardAppliedAmount.toFixed(2)}</div>
                            </div>
                            <div style={{ ...styles.ticketTotal, marginTop: 8, border: `2px solid ${TavariStyles.colors.primary}` }}>
                              <div style={styles.ticketTotalLabel}>{cardDueNow > 0.009 ? 'Pay by card now:' : 'Due now:'}</div>
                              <div style={styles.ticketTotalAmount}>${cardDueNow.toFixed(2)}</div>
                            </div>
                          </>
                        )}
                      </div>
                      {!requiresStaffApproval && (
                      <div style={{ marginTop: 24, paddingTop: 24, borderTop: `1px solid ${TavariStyles.colors.gray200}` }}>
                        <PortalPromoCodeSection
                          resolvedPricingPromotion={resolvedPricingPromotion}
                          promoCodeInput={promoCodeInput}
                          setPromoCodeInput={setPromoCodeInput}
                          onApplyPromoCode={handleApplyPromoCode}
                          onClearPromoCode={handleClearPromoCode}
                          appliedPromoCode={appliedPromoCode}
                        />
                        <PortalGiftCardSection
                          giftCardCodeInput={giftCardCodeInput}
                          setGiftCardCodeInput={setGiftCardCodeInput}
                          appliedGiftCard={appliedGiftCard}
                          giftCardError={giftCardError}
                          giftCardLoading={giftCardLoading}
                          onApplyGiftCard={handleApplyGiftCard}
                          onClearGiftCard={handleClearGiftCard}
                        />
                        <div style={{ fontSize: 15, fontWeight: 600, color: TavariStyles.colors.gray900, marginBottom: 12 }}>
                          {cardDueNow <= 0.009
                            ? 'Complete with gift card'
                            : checkoutAmounts.isDeposit
                              ? 'Pay party deposit with card'
                              : 'Pay for your party with card'}
                        </div>
                        <p style={{ fontSize: 14, color: TavariStyles.colors.gray600, marginBottom: 16 }}>
                          {cardDueNow <= 0.009
                            ? `Your gift card covers the $${checkoutAmounts.chargeNow.toFixed(2)} due now. No card payment is needed.`
                            : checkoutAmounts.isDeposit
                            ? `You will pay a deposit of $${cardDueNow.toFixed(2)} now${giftCardAppliedAmount > 0.009 ? ` (after $${giftCardAppliedAmount.toFixed(2)} gift card)` : ''}. The remaining $${checkoutAmounts.balanceDue.toFixed(2)} is due at check-in. Additional guests can be linked when you arrive.`
                            : `Enter your card details in the secure form when you click below. Additional party guests can be linked at check-in.${giftCardAppliedAmount > 0.009 ? ` Gift card covers $${giftCardAppliedAmount.toFixed(2)}; card charges $${cardDueNow.toFixed(2)}.` : ''}`}
                        </p>
                      </div>
                      )}
                    </>
                  );
                }
                if (totalTickets === 0 || partyWithTickets.length < bookingParty.length) {
                  return (
                    <div style={{ padding: '24px 0', color: TavariStyles.colors.gray700, fontSize: '14px' }}>
                      <p style={{ marginBottom: '12px' }}>We couldn’t assign tickets automatically. Make sure each participant has a birthdate (tap their card to add one).</p>
                      <p style={{ fontSize: '13px', color: TavariStyles.colors.gray600 }}>Tickets are chosen by age based on who’s coming.</p>
                    </div>
                  );
                }
                return (
                  <>
                    <p style={{ marginBottom: '16px', fontSize: '14px', color: TavariStyles.colors.gray700 }}>
                      Based on who’s coming, these tickets have been assigned:
                    </p>
                    {selectedParticipantsNeedingCamperRegistration.length > 0 && (
                      <div
                        style={{
                          marginBottom: 16,
                          padding: '12px 14px',
                          borderRadius: 8,
                          backgroundColor: '#fff7ed',
                          border: '1px solid #fed7aa',
                          color: '#9a3412',
                          fontSize: 13,
                          lineHeight: 1.5,
                        }}
                      >
                        <strong>Annual camper registration is still required.</strong>
                        <div>
                          You can pay now, but these campers must have the annual registration completed
                          before check-in: {selectedParticipantsNeedingCamperRegistration.map(getParticipantDisplayName).join(', ')}.
                        </div>
                      </div>
                    )}
                    <div style={{ marginBottom: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {bookingParty.map((participant) => {
                        const assignment = selectedParticipantTicketAssignments[participant.id];
                        const itemId = assignment?.inventory_item_id;
                        const item = inventoryItems.find((i) => i.id === itemId);
                        const name = [participant.first_name, participant.last_name].filter(Boolean).join(' ') || 'Participant';
                        return (
                          <div
                            key={participant.id}
                            style={{
                              fontSize: 13,
                              color: TavariStyles.colors.gray700,
                              padding: '8px 12px',
                              backgroundColor: TavariStyles.colors.gray50,
                              borderRadius: 8,
                            }}
                          >
                            <span style={{ fontWeight: 600, color: TavariStyles.colors.gray900 }}>{name}</span>
                            {' → '}
                            {item?.name || assignment?.inventory_item_name || 'Ticket'}
                          </div>
                        );
                      })}
                    </div>
                    <PortalOrderReviewList
                      lines={selectedPortalOptionsDisplay}
                      title="Your order"
                      onRemove={handleOrderReviewRemove}
                      onEdit={handleOrderReviewEdit}
                    />
                    <div style={styles.ticketSelectionList}>
                      {Object.entries(ticketCountsForDisplay)
                        .filter(([, qty]) => (qty || 0) > 0)
                        .map(([inventoryItemId, quantity]) => {
                          const item = inventoryItems.find(i => i.id === inventoryItemId);
                          const assignmentName = Object.values(selectedParticipantTicketAssignments).find(
                            (a) => a?.inventory_item_id === inventoryItemId
                          )?.inventory_item_name;
                          const displayItem = item || (assignmentName ? { id: inventoryItemId, name: assignmentName, price: 0 } : null);
                          if (!displayItem) return null;
                          const pricingLine = (ticketPricing.lineItems || []).find(
                            (line) => line.inventory_item_id === inventoryItemId,
                          );
                          const price = pricingLine?.unit_price ?? resolveInventoryTicketPrice(displayItem);
                          const freeQty = pricingLine?.free_quantity ?? getFreeQuantity(inventoryItemId);
                          const paidQty = pricingLine?.paid_quantity ?? Math.max(0, quantity - freeQty);
                          const subtotal = pricingLine?.subtotal ?? (price * paidQty);
                          return (
                            <div key={displayItem.id} style={{ ...styles.ticketCard, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', marginBottom: '8px', borderRadius: '8px', border: `1px solid ${TavariStyles.colors.gray200}`, backgroundColor: 'white' }}>
                              <div>
                                <div style={{ fontWeight: '600', fontSize: '14px', color: TavariStyles.colors.gray900 }}>
                                  {quantity} × {displayItem.name}
                                  {freeQty > 0 && (
                                    <span style={{ fontWeight: '500', fontSize: '13px', color: TavariStyles.colors.primary, marginLeft: '6px' }}>
                                      ({freeQty} free with purchase)
                                    </span>
                                  )}
                                </div>
                                <div style={{ fontSize: '13px', color: TavariStyles.colors.gray600 }}>
                                  {paidQty > 0 ? `${paidQty} × $${price.toFixed(2)} = $${subtotal.toFixed(2)}` : 'Free'}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                    </div>
                    <div style={{ marginTop: '16px', paddingTop: '16px', borderTop: `1px solid ${TavariStyles.colors.gray200}` }}>
                      <div style={styles.ticketTotal}>
                        <div style={styles.ticketTotalLabel}>Total:</div>
                        <div style={styles.ticketTotalAmount}>${calculateTotal.toFixed(2)}</div>
                      </div>
                      {taxCalculation.totalTax > 0 && (
                        <>
                          <TaxBreakdown taxCalculation={taxCalculation} taxCalc={taxCalc} />
                          <div style={{ ...styles.ticketTotal, marginTop: 8, backgroundColor: 'transparent', border: 'none', padding: '8px 20px' }}>
                            <div style={styles.ticketTotalLabel}>Tax:</div>
                            <div style={styles.ticketTotalAmount}>${taxCalc.formatTaxAmount(taxCalculation.totalTax)}</div>
                          </div>
                        </>
                      )}
                      <div style={{ ...styles.ticketTotal, marginTop: taxCalculation.totalTax > 0 ? 8 : 12, border: `2px solid ${TavariStyles.colors.primary}` }}>
                        <div style={styles.ticketTotalLabel}>Total with tax:</div>
                        <div style={styles.ticketTotalAmount}>${totalWithTax.toFixed(2)}</div>
                      </div>
                      {checkoutAmounts.isDeposit && (
                        <>
                          <div style={{ ...styles.ticketTotal, marginTop: 8, backgroundColor: '#ecfdf5', border: '1px solid #a7f3d0' }}>
                            <div style={styles.ticketTotalLabel}>Deposit due now:</div>
                            <div style={styles.ticketTotalAmount}>${checkoutAmounts.chargeNow.toFixed(2)}</div>
                          </div>
                          <div style={{ ...styles.ticketTotal, marginTop: 8, backgroundColor: 'transparent', border: 'none', padding: '8px 20px' }}>
                            <div style={styles.ticketTotalLabel}>Balance due at check-in:</div>
                            <div style={styles.ticketTotalAmount}>${checkoutAmounts.balanceDue.toFixed(2)}</div>
                          </div>
                        </>
                      )}
                      {giftCardAppliedAmount > 0.009 && (
                        <>
                          <div style={{ ...styles.ticketTotal, marginTop: 8, backgroundColor: '#ecfdf5', border: '1px solid #a7f3d0' }}>
                            <div style={styles.ticketTotalLabel}>Gift card:</div>
                            <div style={styles.ticketTotalAmount}>-${giftCardAppliedAmount.toFixed(2)}</div>
                          </div>
                          <div style={{ ...styles.ticketTotal, marginTop: 8, border: `2px solid ${TavariStyles.colors.primary}` }}>
                            <div style={styles.ticketTotalLabel}>{cardDueNow > 0.009 ? 'Pay by card now:' : 'Due now:'}</div>
                            <div style={styles.ticketTotalAmount}>${cardDueNow.toFixed(2)}</div>
                          </div>
                        </>
                      )}
                    </div>
                    <div style={{ marginTop: 24, paddingTop: 24, borderTop: `1px solid ${TavariStyles.colors.gray200}` }}>
                      <PortalPromoCodeSection
                        resolvedPricingPromotion={resolvedPricingPromotion}
                        promoCodeInput={promoCodeInput}
                        setPromoCodeInput={setPromoCodeInput}
                        onApplyPromoCode={handleApplyPromoCode}
                        onClearPromoCode={handleClearPromoCode}
                        appliedPromoCode={appliedPromoCode}
                      />
                      <PortalGiftCardSection
                        giftCardCodeInput={giftCardCodeInput}
                        setGiftCardCodeInput={setGiftCardCodeInput}
                        appliedGiftCard={appliedGiftCard}
                        giftCardError={giftCardError}
                        giftCardLoading={giftCardLoading}
                        onApplyGiftCard={handleApplyGiftCard}
                        onClearGiftCard={handleClearGiftCard}
                      />
                      <div style={{ fontSize: 15, fontWeight: 600, color: TavariStyles.colors.gray900, marginBottom: 12 }}>
                        {cardDueNow <= 0.009
                          ? 'Complete with gift card'
                          : checkoutAmounts.isDeposit
                            ? 'Pay deposit with card'
                            : 'Pay with card'}
                      </div>
                      <p style={{ fontSize: 14, color: TavariStyles.colors.gray600, marginBottom: 16 }}>
                        {cardDueNow <= 0.009
                          ? `Your gift card covers the $${checkoutAmounts.chargeNow.toFixed(2)} due now. No card payment is needed.`
                          : checkoutAmounts.isDeposit
                          ? `You will pay a deposit of $${cardDueNow.toFixed(2)} now${giftCardAppliedAmount > 0.009 ? ` (after $${giftCardAppliedAmount.toFixed(2)} gift card)` : ''}. The remaining $${checkoutAmounts.balanceDue.toFixed(2)} is due at check-in. Card data never touches our servers.`
                          : `Online bookings are paid by card${giftCardAppliedAmount > 0.009 ? ' and gift card' : ' only'}. Enter your card details in the secure form when you click below. Card data never touches our servers.${giftCardAppliedAmount > 0.009 ? ` Gift card covers $${giftCardAppliedAmount.toFixed(2)}; card charges $${cardDueNow.toFixed(2)}.` : ''}`}
                      </p>
                    </div>
                  </>
                );
              })()}
            </div>
            <div style={styles.modalFooter}>
              <button type="button" onClick={handleTicketSelectionBack} style={styles.footerBack}>
                Back
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowTicketSelectionModal(false);
                  setShowPaymentStep(false);
                }}
                style={{
                  ...styles.footerBack,
                  border: `1px solid ${TavariStyles.colors.gray300}`,
                  color: TavariStyles.colors.gray700,
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={requiresStaffApproval ? handleSubmitBookingRequest : handlePayOnline}
                disabled={
                  (isPartyBooking
                    ? !partyCheckoutReady
                    : hasParticipantTicketIssues)
                  || Object.keys(selectedTickets).length === 0
                  || Object.values(selectedTickets).reduce((s, q) => s + (q || 0), 0) === 0
                  || helcimPayLoading
                  || submitRequestLoading
                }
                style={{
                  ...styles.footerNext,
                  ...((isPartyBooking
                    ? !partyCheckoutReady
                    : hasParticipantTicketIssues)
                  || Object.keys(selectedTickets).length === 0
                  || Object.values(selectedTickets).reduce((s, q) => s + (q || 0), 0) === 0
                    ? styles.footerNextDisabled
                    : {}),
                }}
              >
                {submitRequestLoading
                  ? 'Submitting…'
                  : helcimPayLoading
                  ? (cardDueNow <= 0.009 ? 'Completing booking…' : 'Opening secure payment…')
                  : requiresStaffApproval
                    ? 'Submit'
                    : cardDueNow <= 0.009
                      ? 'Complete with gift card'
                      : checkoutAmounts.isDeposit
                      ? (isPartyBooking ? 'Pay party deposit with card' : 'Pay deposit with card')
                      : (isPartyBooking ? 'Pay for party with card' : 'Pay with card')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const styles = {
  page: {
    minHeight: '100vh',
    backgroundColor: TavariStyles.colors.gray50,
    fontFamily: TavariStyles.typography?.fontFamily || 'system-ui, sans-serif',
  },
  loading: {
    padding: 48,
    textAlign: 'center',
    color: TavariStyles.colors.gray600,
  },
  error: {
    padding: 48,
    textAlign: 'center',
    color: TavariStyles.colors.danger,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 12,
  },
  backLink: {
    fontSize: 14,
    fontWeight: 600,
    color: TavariStyles.colors.primary,
    textDecoration: 'none',
    alignSelf: 'flex-start',
  },
  header: {
    backgroundColor: 'white',
    borderBottom: `1px solid ${TavariStyles.colors.gray200}`,
    padding: '24px 32px',
  },
  headerInner: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 24,
    maxWidth: 1200,
    margin: '0 auto',
  },
  logo: {
    width: 80,
    height: 80,
    objectFit: 'contain',
    flexShrink: 0,
  },
  businessInfo: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    textAlign: 'left',
  },
  businessName: {
    fontSize: 24,
    fontWeight: 700,
    color: TavariStyles.colors.gray900,
    margin: '0 0 4px',
  },
  link: {
    fontSize: 14,
    color: TavariStyles.colors.primary,
    textDecoration: 'none',
  },
  meta: {
    fontSize: 14,
    color: TavariStyles.colors.gray600,
  },
  content: {
    maxWidth: 800,
    margin: '0 auto',
    padding: 32,
    display: 'flex',
    flexDirection: 'column',
    gap: 24,
  },
  activityName: {
    fontSize: 28,
    fontWeight: 700,
    color: TavariStyles.colors.gray900,
    margin: 0,
    textAlign: 'center',
  },
  descriptionList: {
    margin: 0,
    paddingLeft: 18,
    fontSize: 14,
    color: TavariStyles.colors.gray700,
    lineHeight: 1.6,
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  sections: {
    display: 'flex',
    flexDirection: 'column',
    gap: 20,
  },
  sectionBlock: {
    backgroundColor: 'white',
    borderRadius: 12,
    border: `1px solid ${TavariStyles.colors.gray200}`,
    padding: 20,
  },
  sectionHeader: {
    fontSize: 16,
    fontWeight: 600,
    color: TavariStyles.colors.gray900,
    marginBottom: 12,
  },
  sectionDetails: {
    fontSize: 14,
    color: TavariStyles.colors.gray700,
    lineHeight: 1.6,
    whiteSpace: 'pre-wrap',
  },
  buttonWrap: {
    display: 'flex',
    justifyContent: 'center',
  },
  bookButton: {
    padding: '14px 32px',
    borderRadius: 10,
    border: 'none',
    backgroundColor: TavariStyles.colors.primary,
    color: 'white',
    fontSize: 16,
    fontWeight: 600,
    cursor: 'pointer',
  },
  images: {
    display: 'grid',
    gap: 16,
    marginTop: 24,
    width: '100%',
  },
  image: {
    width: '100%',
    aspectRatio: '4 / 3',
    objectFit: 'cover',
    borderRadius: 12,
    border: `1px solid ${TavariStyles.colors.gray200}`,
    backgroundColor: 'white',
  },
  modalOverlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    zIndex: 100,
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'center',
    padding: '16px',
    overflowY: 'auto',
    WebkitOverflowScrolling: 'touch',
    boxSizing: 'border-box',
  },
  modalContent: {
    backgroundColor: 'white',
    borderRadius: 12,
    maxWidth: 800,
    width: '100%',
    // Cap to the visible viewport so footer actions stay reachable on phones.
    maxHeight: 'calc(100dvh - 32px)',
    margin: 'auto',
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
    boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)',
    boxSizing: 'border-box',
    minWidth: 0,
    minHeight: 0,
  },
  modalHeader: {
    padding: '16px 24px',
    borderBottom: `1px solid ${TavariStyles.colors.gray200}`,
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexShrink: 0,
    gap: 12,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 600,
    color: TavariStyles.colors.gray900,
    minWidth: 0,
    overflowWrap: 'anywhere',
  },
  modalClose: {
    border: 'none',
    background: 'transparent',
    fontSize: 24,
    lineHeight: 1,
    cursor: 'pointer',
    color: TavariStyles.colors.gray500,
    padding: 4,
    flexShrink: 0,
  },
  modalBody: {
    padding: 24,
    overflowY: 'auto',
    overflowX: 'hidden',
    WebkitOverflowScrolling: 'touch',
    // Critical: allow this flex child to shrink so overflow scrolling works
    // instead of stretching the modal past the viewport and hiding footer buttons.
    flex: '1 1 auto',
    minHeight: 0,
    minWidth: 0,
    boxSizing: 'border-box',
  },
  modalInput: {
    width: '100%',
    maxWidth: '100%',
    minWidth: 0,
    boxSizing: 'border-box',
    padding: '12px 16px',
    border: `1px solid ${TavariStyles.colors.gray300}`,
    borderRadius: '8px',
    fontSize: '16px',
  },
  modalFooter: {
    padding: '16px 24px',
    borderTop: `1px solid ${TavariStyles.colors.gray200}`,
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
    flexShrink: 0,
    flexWrap: 'wrap',
    backgroundColor: 'white',
  },
  footerBack: {
    padding: '10px 20px',
    borderRadius: 8,
    border: `1px solid ${TavariStyles.colors.gray300}`,
    backgroundColor: 'white',
    fontSize: 14,
    fontWeight: 600,
    color: TavariStyles.colors.gray700,
    cursor: 'pointer',
  },
  footerNext: {
    padding: '10px 24px',
    borderRadius: 8,
    border: 'none',
    backgroundColor: TavariStyles.colors.primary,
    fontSize: 14,
    fontWeight: 600,
    color: 'white',
    cursor: 'pointer',
  },
  footerNextDisabled: {
    backgroundColor: TavariStyles.colors.gray300,
    color: TavariStyles.colors.gray500,
    cursor: 'not-allowed',
  },
  portalFormInput: {
    width: '100%',
    boxSizing: 'border-box',
    padding: '10px 14px',
    border: `1px solid ${TavariStyles.colors.gray300}`,
    borderRadius: '8px',
    fontSize: '14px',
  },
  calendarWrap: {
    maxWidth: 360,
    margin: '0 auto',
  },
  calendarHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  calendarNavBtn: {
    border: 'none',
    background: 'transparent',
    cursor: 'pointer',
    padding: 8,
    color: TavariStyles.colors.gray700,
  },
  calendarMonthTitle: {
    fontSize: 18,
    fontWeight: 600,
    color: TavariStyles.colors.gray900,
  },
  calendarGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(7, 1fr)',
    gap: 4,
  },
  calendarDayHeader: {
    fontSize: 13,
    fontWeight: 600,
    color: TavariStyles.colors.gray600,
    textAlign: 'center',
    padding: '8px 0',
  },
  calendarDay: {
    aspectRatio: '1',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 14,
    fontWeight: 500,
    cursor: 'pointer',
    borderRadius: 8,
    border: '1px solid transparent',
    color: TavariStyles.colors.gray900,
  },
  calendarDayEmpty: {
    cursor: 'default',
    pointerEvents: 'none',
  },
  calendarDayDisabled: {
    color: TavariStyles.colors.gray400,
    backgroundColor: TavariStyles.colors.gray100,
    cursor: 'not-allowed',
    pointerEvents: 'none',
  },
  noDatesWrap: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 20,
    padding: '24px 0',
  },
  noDatesMessage: {
    fontSize: 16,
    fontWeight: 500,
    color: TavariStyles.colors.gray600,
    textAlign: 'center',
  },
  calendarDayToday: {
    backgroundColor: '#fef3c7',
    fontWeight: 700,
  },
  calendarDaySelected: {
    backgroundColor: TavariStyles.colors.primary,
    color: 'white',
    fontWeight: 700,
    borderColor: TavariStyles.colors.primary,
  },
  timeSlotsList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  timeSlotCard: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '14px 18px',
    borderRadius: 10,
    border: `1px solid ${TavariStyles.colors.gray200}`,
    backgroundColor: TavariStyles.colors.gray50,
    transition: 'all 0.2s ease',
  },
  timeSlotCardSelected: {
    border: `2px solid ${TavariStyles.colors.primary}`,
    backgroundColor: `${TavariStyles.colors.primary}15`,
    fontWeight: 600,
  },
  timeSlotCardUnavailable: {
    backgroundColor: TavariStyles.colors.gray100,
    border: `1px solid ${TavariStyles.colors.gray200}`,
    cursor: 'not-allowed',
    pointerEvents: 'none',
    opacity: 1,
  },
  timeSlotTime: {
    fontSize: 16,
    fontWeight: 600,
    color: TavariStyles.colors.gray900,
  },
  timeSlotTimeUnavailable: {
    color: TavariStyles.colors.gray400,
    fontWeight: 500,
  },
  timeSlotSpaces: {
    fontSize: 14,
    color: TavariStyles.colors.gray600,
  },
  timeSlotSpacesUnavailable: {
    color: TavariStyles.colors.gray400,
    fontWeight: 600,
  },
  individualDatesList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 22,
  },
  multiDayWeeksList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
  },
  multiDayWeekCard: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    padding: '16px 18px',
    border: `1px solid ${TavariStyles.colors.gray200}`,
    borderRadius: 12,
    backgroundColor: '#f8fafb',
    boxShadow: '0 1px 2px rgba(0, 0, 0, 0.04)',
  },
  multiDayWeekHeading: {
    fontSize: 18,
    fontWeight: 700,
    color: TavariStyles.colors.primary,
    lineHeight: 1.25,
  },
  multiDayWeekMeta: {
    fontSize: 13,
    color: TavariStyles.colors.gray600,
    marginBottom: 4,
  },
  multiDayWeekSlotRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    flexWrap: 'wrap',
    marginTop: 4,
    padding: '12px 14px',
    borderRadius: 10,
    backgroundColor: '#ffffff',
    border: `1px solid ${TavariStyles.colors.gray200}`,
  },
  individualDatesColumnHeaders: {
    display: 'grid',
    gridTemplateColumns: '1fr 1.2fr auto',
    gap: 12,
    padding: '0 4px 10px',
    borderBottom: `1px solid ${TavariStyles.colors.gray200}`,
    fontSize: 13,
    fontWeight: 600,
    color: TavariStyles.colors.gray600,
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
  },
  individualDateSection: {
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  individualDateHeading: {
    fontSize: 20,
    fontWeight: 700,
    color: TavariStyles.colors.primary,
    lineHeight: 1.25,
  },
  individualSlotRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    flexWrap: 'wrap',
    padding: '10px 4px',
  },
  individualSlotMain: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    minWidth: 0,
    flex: '1 1 200px',
  },
  individualSlotTime: {
    fontSize: 15,
    fontWeight: 600,
    color: TavariStyles.colors.primary,
  },
  individualSlotActivity: {
    fontSize: 14,
    color: TavariStyles.colors.gray700,
  },
  individualBookBtn: {
    border: 'none',
    borderRadius: 6,
    backgroundColor: TavariStyles.colors.primary,
    color: '#fff',
    fontWeight: 700,
    fontSize: 13,
    letterSpacing: '0.04em',
    padding: '10px 18px',
    cursor: 'pointer',
    flexShrink: 0,
  },
  ticketSelectionList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  ticketCard: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '16px 20px',
    borderRadius: 10,
    border: `1px solid ${TavariStyles.colors.gray200}`,
    backgroundColor: 'white',
  },
  ticketCardInfo: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  ticketCardName: {
    fontSize: 16,
    fontWeight: 600,
    color: TavariStyles.colors.gray900,
  },
  ticketCardDescription: {
    fontSize: 14,
    color: TavariStyles.colors.gray600,
  },
  ticketCardPrice: {
    fontSize: 14,
    fontWeight: 600,
    color: TavariStyles.colors.primary,
    marginTop: 4,
  },
  ticketQuantityControls: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
  },
  quantityButton: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 36,
    height: 36,
    borderRadius: 8,
    border: `1px solid ${TavariStyles.colors.gray300}`,
    backgroundColor: 'white',
    color: TavariStyles.colors.gray700,
    cursor: 'pointer',
    transition: 'all 0.2s ease',
  },
  quantityButtonDisabled: {
    opacity: 0.5,
    cursor: 'not-allowed',
    backgroundColor: TavariStyles.colors.gray100,
  },
  quantityDisplay: {
    fontSize: 18,
    fontWeight: 600,
    color: TavariStyles.colors.gray900,
    minWidth: 30,
    textAlign: 'center',
  },
  ticketTotal: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '16px 20px',
    marginTop: 20,
    borderRadius: 10,
    backgroundColor: TavariStyles.colors.gray50,
    border: `1px solid ${TavariStyles.colors.gray200}`,
  },
  ticketTotalLabel: {
    fontSize: 18,
    fontWeight: 600,
    color: TavariStyles.colors.gray900,
  },
  ticketTotalAmount: {
    fontSize: 20,
    fontWeight: 700,
    color: TavariStyles.colors.primary,
  },
};

export default CustomerPortalActivityPage;
